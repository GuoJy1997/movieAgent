import { createHash, randomUUID } from 'node:crypto';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import type { ProviderConnection } from '../../../../packages/contracts/src/models.ts';
import type { ModelList } from '../../../../packages/contracts/src/model-config-file.ts';
import { createHttpTransport } from '../../../../packages/providers/src/http-transport.ts';
import { encodeTextRequest, extractTextResponse, isTextProtocol, textAuthHeaders } from '../../../../packages/providers/src/text-protocol.ts';
import { parseModelConfigFile, type LocalModelProvider } from './model-config-file.ts';
import type { modelConfigStore } from './model-config-store.ts';
export interface TextProbeInput { expectedVersion:string; provider:unknown; testReceipt?:string }
const required=()=>fail('MODEL_TEST_REQUIRED','请先对当前连接、模型和参数完成测试，再保存。');
const conflict=()=>fail('MODEL_CONFIG_CONFLICT','文件已修改，请读取最新版本并重新测试。');
const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):isRecord(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
/** One instance belongs to one protected window; receipts never cross its lifetime. */
export function createTextOnboarding(store:ReturnType<typeof modelConfigStore>, options:{now?:()=>number;timeoutMs?:number}={}) {
  const transport=createHttpTransport(),now=options.now??Date.now;
  let sequence=0,closed=false,active:AbortController|undefined,receipt:{id:string;fingerprint:string;expires:number}|undefined;
  function cancel(){closed=true;sequence++;active?.abort();receipt=undefined;}
  async function resolve(input:unknown,list=false):Promise<Result<{provider:LocalModelProvider;fingerprint:string;clear:boolean}>>{
    if(closed)return fail('MODEL_TEST_CANCELLED','窗口已关闭，请重新打开。');
    if(!isRecord(input)||Object.keys(input).some(k=>!['expectedVersion','provider','testReceipt'].includes(k))||typeof input.expectedVersion!=='string'||!isRecord(input.provider))return fail('INVALID_INPUT','测试输入无效。');
    const current=await store.readPrivate();if(!current.ok)return current;if(current.value.version!==input.expectedVersion)return conflict();
    const draft=input.provider,fields=['id','name','kind','baseURL','apiKey','modelId','allowPrivateEndpoint','adapterType','parameters','pricing','clearKey'];
    if(Object.keys(draft).length!==fields.length||fields.some(k=>!Object.hasOwn(draft,k))||typeof draft.apiKey!=='string'||typeof draft.clearKey!=='boolean'||draft.clearKey&&draft.apiKey!=='')return fail('INVALID_INPUT','测试草稿格式无效。');
    const old=current.value.config.providers.find(p=>p.id===draft.id);
    const {clearKey,...raw}=draft;raw.apiKey=clearKey?'':draft.apiKey||old?.apiKey||'';
    if(list&&!raw.modelId)raw.modelId='manual-model';
    const checked=parseModelConfigFile({schemaVersion:2,providers:[...current.value.config.providers.filter(p=>p.id!==draft.id).map(({state:_s,networkPolicy:_n,...p})=>p),raw]},current.value.config.source);
    if(!checked.ok)return checked;const provider=checked.value.providers.find(p=>p.id===draft.id)!;
    const fingerprint=createHash('sha256').update(JSON.stringify(stable({revision:input.expectedVersion,provider}))).digest('hex');
    return ok({provider,fingerprint,clear:clearKey===true});
  }
  const connection=(p:LocalModelProvider):ProviderConnection=>({libraryId:'onboarding',id:p.id,name:p.name,adapterType:p.adapterType,baseUrl:p.baseURL,credentialRef:null,headers:{},networkPolicy:p.networkPolicy,timeoutMs:options.timeoutMs??30000,concurrency:1,revision:1,createdAt:new Date().toISOString()});
  function status(code:number,list=false):Result<never>{
    return code===401||code===403?fail('MODEL_AUTH_REJECTED','认证失败，请检查 API Key 与服务权限。'):code>=300&&code<400?fail('MODEL_REDIRECT_DENIED','服务返回重定向，请直接填写最终 API 地址。'):list&&[404,405,501].includes(code)?fail('MODEL_LIST_UNSUPPORTED','此服务不支持模型列表，请手动填写模型 ID 后测试。'):fail('MODEL_HTTP_ERROR',`服务返回 HTTP ${code}，请检查协议、地址和模型 ID。`);
  }
  async function test(input:unknown):Promise<Result<{receipt:string}>>{
    const own=++sequence;active?.abort();const abort=new AbortController();active=abort;receipt=undefined;
    try{
      const resolved=await resolve(input);if(!resolved.ok)return resolved;const {provider:p,fingerprint}=resolved.value;
      if(!isTextProtocol(p.adapterType)||!p.apiKey||resolved.value.clear)return fail('MODEL_TEST_INCOMPLETE','请填写文本协议、地址、Key 和模型 ID。');
      const body=encodeTextRequest(p.adapterType,p.modelId,'Reply with OK.',p.parameters);if(!body.ok)return body;
      if(own!==sequence||closed)return fail('MODEL_TEST_CANCELLED','测试已取消。');
      const response=await transport.text(connection(p),body.value,textAuthHeaders(p.adapterType,p.apiKey),abort.signal);
      if(response.status!==200)return status(response.status);const text=extractTextResponse(p.adapterType,response.bytes);if(!text.ok)return fail(text.error.code,`${text.error.message} 可在高级设置中手动提高输出预算后重新测试，可能产生费用。`);
      const latest=await resolve(input);if(!latest.ok)return latest;if(own!==sequence||closed||latest.value.fingerprint!==fingerprint)return fail('MODEL_TEST_CANCELLED','草稿已更改，请重新测试。');
      const id=randomUUID();receipt={id,fingerprint,expires:now()+10*60*1000};return ok({receipt:id});
    }catch{return fail('MODEL_TEST_NETWORK','测试未完成：连接失败、超时或响应超过限制；请核对地址后重试。');}
    finally{if(active===abort)active=undefined;}
  }
  async function listModels(input:unknown):Promise<Result<ModelList>>{
    const own=++sequence;active?.abort();const abort=new AbortController();active=abort;receipt=undefined;
    try{
      const resolved=await resolve(input,true);if(!resolved.ok)return resolved;const p=resolved.value.provider;
      if(!isTextProtocol(p.adapterType)||!p.apiKey)return fail('MODEL_TEST_INCOMPLETE','请先填写文本协议、地址与 Key。');
      const models=new Set<string>();let after:string|undefined,truncated=false,inspected=0;
      for(let page=0;page<3;page++){
        if(own!==sequence||closed)return fail('MODEL_TEST_CANCELLED','列表请求已取消。');
        const response=await transport.listModels(connection(p),textAuthHeaders(p.adapterType,p.apiKey),after,abort.signal);if(response.status!==200)return status(response.status,true);
        let data:unknown;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.bytes));}catch{return fail('MODEL_LIST_INVALID','模型列表格式无效，请手动填写 ID 后测试。');}
        if(!isRecord(data)||!Array.isArray(data.data))return fail('MODEL_LIST_INVALID','模型列表格式无效，请手动填写 ID 后测试。');
        for(const item of data.data){if(inspected>=1000){truncated=true;break;}inspected++;if(isRecord(item)&&typeof item.id==='string'&&/^[a-zA-Z0-9_./:-]{1,200}$/.test(item.id)&&!item.id.includes(p.apiKey))models.add(item.id);}
        const more=p.adapterType==='anthropic-messages-v1'&&data.has_more===true;
        if(!more)break;if(page===2||inspected>=1000){truncated=true;break;}
        if(typeof data.last_id!=='string'||!/^[a-zA-Z0-9_./:-]{1,200}$/.test(data.last_id)||data.last_id===after)return fail('MODEL_LIST_INVALID','分页格式无效，请手动填写 ID 后测试。');after=data.last_id;
      }
      if(own!==sequence||closed)return fail('MODEL_TEST_CANCELLED','列表请求已取消。');const latest=await resolve(input,true);if(!latest.ok)return latest;
      return ok({models:[...models],truncated});
    }catch{return fail('MODEL_LIST_NETWORK','获取列表失败或超时，请手动填写模型 ID 后测试。');}
    finally{if(active===abort)active=undefined;}
  }
  async function authorize(input:unknown):Promise<Result<void>>{
    const resolved=await resolve(input);if(!resolved.ok)return resolved;const {provider:p,fingerprint,clear}=resolved.value;
    if(!isTextProtocol(p.adapterType)||clear||!p.apiKey)return ok(undefined);
    if(!isRecord(input)||!receipt||input.testReceipt!==receipt.id||receipt.expires<=now()||receipt.fingerprint!==fingerprint)return required();
    receipt=undefined;return ok(undefined);
  }
  return {test,listModels,authorize,cancel};
}
