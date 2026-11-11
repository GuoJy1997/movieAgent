import { adapterDefaults, adapterParameterOptions } from '../../../../packages/domain/src/model-config.ts';
import type { AdapterType, ParameterValue, Pricing } from '../../../../packages/contracts/src/models.ts';
import type { ModelConfigEditOutcome, ModelList, PublicModelConfig, RedactedProvider } from '../../../../packages/contracts/src/model-config-file.ts';
import type { Result } from '../../../../packages/contracts/src/result.ts';
import { priceMicros } from '../../../../packages/domain/src/approval.ts';
declare global { interface Window { modelConfigEntry: { info(): Promise<Result<{config:PublicModelConfig;providerId:string|null}>>; listModels(input:unknown):Promise<Result<ModelList>>; test(input:unknown):Promise<Result<{receipt:string}>>; prepareAudioTest(input:unknown):Promise<Result<{testId:string;planHash:string;summary:string;expiresAt:number}>>; runAudioTest(input:unknown):Promise<Result<{receipt:string}>>; submit(input:unknown):Promise<Result<ModelConfigEditOutcome>> } } }
const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
const isAudioProtocol = (value: string) => ['openai-speech-v1', 'minimax-speech-v1', 'openai-transcription-v1', 'minimax-transcription-v1'].includes(value);
const isSpeechProtocol = (value: string) => value === 'openai-speech-v1' || value === 'minimax-speech-v1';
const button=(id:string)=>document.getElementById(id) as HTMLButtonElement;
const select=(id:string)=>document.getElementById(id) as HTMLSelectElement;
const message=document.getElementById('message')!, comparison=document.getElementById('comparison')!;
let receipt='',revision=0,probeBusy=false,saving=false,expiry:ReturnType<typeof setTimeout>|undefined;
let version='', latestVersion='', provider:RedactedProvider|undefined;
let audioTest: { testId: string; planHash: string } | undefined;
const isAudio = () => isAudioProtocol(select('adapter').value);
const needsTest = () => isText() || isAudio();
const category = (adapter: AdapterType) => isSpeechProtocol(adapter) ? 'speech' : adapter.includes('transcription') ? 'transcription' : adapterDefaults(adapter).capabilities.outputKinds[0];
const rate = (pricing: Pricing) => pricing.status === 'unknown' ? '' : 'perSecond' in pricing ? pricing.perSecond : 'perThousandCharacters' in pricing ? pricing.perThousandCharacters : 'perAudioSecond' in pricing ? pricing.perAudioSecond : pricing.perImage;
const isText=()=>['openai-chat-v1','anthropic-messages-v1'].includes(select('adapter').value);
function parameterOptions(){
  const adapter = select('adapter').value as AdapterType;
  if (isSpeechProtocol(adapter)) return {
    voice: { type: 'enum' as const, values: ['manual-voice'], default: '' },
    response_format: { type: 'enum' as const, values: ['mp3', 'wav'], default: 'mp3' },
    speedMilli: { type: 'integer' as const, min: 500, max: 2000, default: 1000 },
  };
  if (adapter.includes('transcription')) return {
    response_format: { type: 'enum' as const, values: ['json', 'verbose_json'], default: 'json' },
    timestamps: { type: 'enum' as const, values: ['segments'], default: 'segments' },
    ...(select('language-field').value === 'none' ? {} : { [select('language-field').value]: { type: 'enum' as const, values: ['zh'], default: '' } }),
  };
  return adapter==='openai-chat-v1'?{[select('token-parameter').value]:{type:'integer' as const,min:1,max:8192,default:1024}}:adapterParameterOptions(adapter);
}
function updateSave(){button('save').disabled=saving||(needsTest()&&!input('clear').checked&&!receipt);}
function testBudget(){
  if (isAudio()) {
    document.getElementById('test-budget')!.textContent = isSpeechProtocol(select('adapter').value) ? '测试将先展示不超过20字符的台词。确认有限额度后仅发送一次配音请求。' : '请选择自有或许可的最长5秒音频，先核对测试与有限额度，再发送一次转写请求。';
    return;
  }
  if(!isText())return;const key=select('adapter').value==='openai-chat-v1'?select('token-parameter').value:'max_tokens',control=document.getElementById(`parameter-${key}`) as HTMLInputElement|null;
  const value=control?.value===''?1024:Number(control?.value);
  document.getElementById('test-budget')!.textContent=Number.isSafeInteger(value)&&value>=1&&value<=8192?`测试会发送一次最多 ${value} token（${key}）的文本请求，与正式生成使用相同输出预算，可能产生费用；30 秒超时，不会自动重试。`:'请在高级设置中填写 1–8192 的整数输出预算；测试与正式生成使用相同设置，可能产生费用；30 秒超时，不会自动重试。';
}
function invalidate(){clearTimeout(expiry);revision++;receipt='';audioTest=undefined;document.getElementById('audio-test-approval')!.hidden=true;document.getElementById('test-result')!.textContent='配置已更改，保存前请重新测试。';testBudget();updateSave();}
function parameters(values:Record<string,ParameterValue>={}) {
  const adapter=select('adapter').value as AdapterType, defaults=adapterDefaults(adapter), container=document.getElementById('parameters')!; container.replaceChildren();
  const voiceContainer = document.getElementById('audio-voice')!; voiceContainer.replaceChildren();
  document.getElementById('capabilities')!.textContent=defaults.capabilities.taskTypes.join(' / ') + (adapter==='minimax-video-v2'?' · 首帧使用 adaptive，纯文本视频使用其他画幅。':'');
  document.getElementById('token-choice')!.hidden=adapter!=='openai-chat-v1';
  const options=parameterOptions(), optional=adapter==='openai-image-v1'||adapter==='openai-image-edit-v1'||isAudio();
  for(const [key,d] of Object.entries(options)) {
    const label=document.createElement('label'); label.textContent=key;label.htmlFor=`parameter-${key}`;
    const free = ['voice', 'language', 'languages'].includes(key);
    const control=d.type==='enum'&&!free?document.createElement('select'):document.createElement('input');control.id=`parameter-${key}`;
    if(d.type==='enum'&&!free) { if(optional){const option=document.createElement('option');option.value='';option.textContent='服务默认（不发送）';control.append(option);} for(const v of d.values){const option=document.createElement('option');option.value=v;option.textContent=v;control.append(option);} }
    else if(d.type==='integer'){(control as HTMLInputElement).type='number';(control as HTMLInputElement).min=String(d.min);(control as HTMLInputElement).max=String(d.max);(control as HTMLInputElement).step='1';}
    control.value=String(values[key]??(optional?'':d.default));
    if (key === 'voice') { label.textContent = '音色 ID'; (control as HTMLInputElement).required = true; voiceContainer.append(label, control); }
    else container.append(label,control);
  }
  if(!Object.keys(options).length) container.textContent='此协议当前没有可配置默认参数。';
  select('pricing').disabled=isText(); if(select('pricing').disabled) select('pricing').value='unknown';priceFields();testBudget();
}
function priceFields(){document.getElementById('price-fields')!.hidden=select('pricing').value!=='configured';document.getElementById('rate-label')!.textContent=isSpeechProtocol(select('adapter').value)?'单价 / 千计费字符':select('adapter').value.includes('transcription')?'单价 / 音频秒':select('adapter').value==='minimax-video-v2'?'单价 / 秒':'单价 / 张';}
function compatibility(){
  const adapter=select('adapter').value as AdapterType,kind=category(adapter);select('category').value=kind!;
  document.getElementById('text-onboarding')!.hidden=!needsTest();
  document.getElementById('audio-license')!.hidden=kind!=='transcription';
  document.getElementById('language-choice')!.hidden=kind!=='transcription';
  if (isAudio()) {
    document.getElementById('compatibility')!.textContent = '音频模型可手动填写ID。模型列表不证明音频能力；音色、格式、语言与速度按当前配置单独测试。';
    return;
  }
  document.getElementById('compatibility')!.textContent=kind==='text'?(adapter==='anthropic-messages-v1'?'支持 Anthropic 兼容 Messages 文本接口。':'支持 OpenAI 兼容 Chat Completions 文本接口。'):kind==='video'?'当前支持 MiniMax 原生视频接口，包括文生视频和受支持的图片输入。':adapter==='openai-image-edit-v1'?'支持 OpenAI 兼容参考图生成接口（images/edits）。':'支持 OpenAI 兼容单张文生图接口。参考图生成可在高级设置中选择。';
}
function changeAdapter(){invalidate();const defaults=adapterDefaults(select('adapter').value as AdapterType);select('pricing').value=defaults.pricing.status;if(defaults.pricing.status==='configured'){input('currency').value=defaults.pricing.currency;input('price-version').value=defaults.pricing.version;input('rate').value=String(rate(defaults.pricing));}parameters();compatibility();}
select('category').onchange=()=>{select('adapter').value=select('category').value==='speech'?'openai-speech-v1':select('category').value==='transcription'?'openai-transcription-v1':select('category').value==='text'?'openai-chat-v1':select('category').value==='video'?'minimax-video-v2':'openai-image-v1';changeAdapter();};
select('language-field').onchange=()=>{parameters();invalidate();};
select('adapter').onchange=changeAdapter;select('token-parameter').onchange=()=>{parameters();invalidate();};
select('models').onchange=()=>{if(select('models').value){input('modelId').value=select('models').value;invalidate();}};
document.querySelector('form')!.addEventListener('input', event => { if (!(event.target as HTMLElement).id.startsWith('audio-')) invalidate(); });document.querySelector('form')!.addEventListener('change',event=>{if((event.target as HTMLElement).id!=='models'&&!(event.target as HTMLElement).id.startsWith('audio-'))invalidate();});select('pricing').onchange=priceFields;
input('clear').onchange=()=>{input('key').disabled=input('clear').checked;input('key').required=!provider&&!input('clear').checked;if(input('clear').checked)input('key').value='';};
button('cancel').onclick=()=>window.close();
button('refresh').onclick=async()=>{const result=await window.modelConfigEntry.info();if(!result.ok){message.textContent=result.error.message;return;}latestVersion=result.value.config.version;comparison.textContent='最新文件（请核对；草稿仍在上方）：\n'+JSON.stringify(result.value.config.providers,null,2);button('rebase').hidden=false;};
button('rebase').onclick=()=>{version=latestVersion;invalidate();button('rebase').hidden=true;button('refresh').hidden=true;message.textContent='已采用最新文件版本，保存仍需再次检查。';};
function draft(){
  const adapterType=select('adapter').value as AdapterType,values:Record<string,ParameterValue>={};
  for(const [key,d]of Object.entries(parameterOptions())){const value=input(`parameter-${key}`).value;if(value!=='')values[key]=d.type==='integer'?Number(value):value;else if(isText())values[key]=d.default;}
  const pricing:Pricing=select('pricing').value==='unknown'?{status:'unknown'}:{status:'configured',currency:input('currency').value,version:input('price-version').value,...(isSpeechProtocol(adapterType)?{perThousandCharacters:Number(input('rate').value)}:adapterType.includes('transcription')?{perAudioSecond:Number(input('rate').value)}:adapterType==='minimax-video-v2'?{perSecond:Number(input('rate').value)}:{perImage:Number(input('rate').value)})};
  return {expectedVersion:version,provider:{id:input('id').value,name:input('name').value.trim()||input('modelId').value.trim().slice(0,120)||'模型',kind:category(adapterType),baseURL:input('baseURL').value,modelId:input('modelId').value,allowPrivateEndpoint:input('private').checked,adapterType,parameters:values,pricing,apiKey:input('key').value,clearKey:input('clear').checked}};
}
async function probe(list:boolean){
  if(probeBusy||saving)return;invalidate();const own=revision;probeBusy=true;button('test-model').disabled=true;button('list-models').disabled=true;
  const resultNode=document.getElementById(list?'list-result':'test-result')!;resultNode.textContent=list?'正在获取模型列表…':'正在测试连接…';
  try{
    if (!list && isAudio()) {
      const prepared = await window.modelConfigEntry.prepareAudioTest({ ...draft(), licensed: input('audio-licensed').checked });
      if (own !== revision) return;
      if (!prepared.ok) resultNode.textContent = prepared.error.message;
      else {
        audioTest = { testId: prepared.value.testId, planHash: prepared.value.planHash };
        document.getElementById('audio-test-summary')!.textContent = prepared.value.summary;
        document.getElementById('audio-test-approval')!.hidden = false;
        resultNode.textContent = '请核对测试内容，填写有限额度后批准。';
      }
      return;
    }
    if(list){const result=await window.modelConfigEntry.listModels(draft());if(own!==revision)return;
      if(!result.ok)resultNode.textContent=result.error.message;else{select('models').replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='选择模型，或手动填写 ID';select('models').append(empty);for(const id of result.value.models){const option=document.createElement('option');option.value=id;option.textContent=id;select('models').append(option);}resultNode.textContent=`已获取 ${result.value.models.length} 个模型${result.value.truncated?'（列表已截断）':''}；仍需测试连接。`;}
    }else{const result=await window.modelConfigEntry.test(draft());if(own!==revision)return;if(result.ok){receipt=result.value.receipt;expiry=setTimeout(()=>{invalidate();resultNode.textContent='测试已过期，请重新测试。';},10*60*1000);resultNode.textContent='测试通过 · 当前配置可保存（10 分钟内有效）。';}else{resultNode.textContent=result.error.message;button('refresh').hidden=result.error.code!=='MODEL_CONFIG_CONFLICT';}}
  }catch{if(own===revision)resultNode.textContent='请求未完成，请检查连接后重试；也可手动填写模型 ID。';}
  finally{probeBusy=false;button('test-model').disabled=false;button('list-models').disabled=false;updateSave();}
}
button('list-models').onclick=()=>void probe(true);button('test-model').onclick=()=>void probe(false);
button('audio-run').onclick = async () => {
  if (!audioTest || probeBusy || !input('audio-risk').checked) return;
  const amount = priceMicros(Number(input('audio-allowance').value));
  if (!amount.ok || amount.value <= 0) { document.getElementById('test-result')!.textContent = '请填写大于零且最多六位小数的有限额度。'; return; }
  const own = revision, pending = audioTest; audioTest = undefined; probeBusy = true;
  button('audio-run').disabled = true;
  try {
    const result = await window.modelConfigEntry.runAudioTest({ ...draft(), ...pending, approval: { currency: input('audio-currency').value, allowanceMicros: amount.value, budgetLimitMicros: amount.value, acknowledgeUnknown: true } });
    if (own !== revision) return;
    document.getElementById('audio-test-approval')!.hidden = true;
    if (result.ok) {
      receipt = result.value.receipt;
      expiry = setTimeout(invalidate, 10 * 60000);
      document.getElementById('test-result')!.textContent = '音频测试通过，当前配置10分钟内可保存。';
    } else document.getElementById('test-result')!.textContent = result.error.message;
  } finally { probeBusy = false; button('audio-run').disabled = false; updateSave(); }
};
document.querySelector('form')!.onsubmit=async(event)=>{
  event.preventDefault();saving=true;updateSave();message.textContent='';
  try {
    const result=await window.modelConfigEntry.submit({...draft(),...(receipt?{testReceipt:receipt}:{})});
    if(!result.ok){message.textContent=result.error.message;button('refresh').hidden=result.error.code!=='MODEL_CONFIG_CONFLICT';invalidate();}
    else input('key').value='';
  }catch{message.textContent='保存未完成，草稿已保留，请重试。';invalidate();}finally{saving=false;updateSave();}
};
void window.modelConfigEntry.info().then(result=>{
  if(!result.ok){message.textContent=result.error.message;return;}
  version=result.value.config.version;provider=result.value.config.providers.find(p=>p.id===result.value.providerId);
  input('id').value=provider?.id??crypto.randomUUID();input('key').required=!provider;
  if(provider){for(const k of ['id','name','baseURL','modelId'] as const)input(k).value=provider[k];input('id').readOnly=true;select('adapter').value=provider.adapterType;input('private').checked=provider.allowPrivateEndpoint;select('pricing').value=provider.pricing.status;if(provider.pricing.status==='configured'){input('currency').value=provider.pricing.currency;input('price-version').value=provider.pricing.version;input('rate').value=String(rate(provider.pricing));}}
  if (provider?.parameters.language) select('language-field').value = 'language';
  if (provider?.parameters.languages) select('language-field').value = 'languages';
  document.getElementById('key-state')!.textContent=provider?.hasKey?'已有 Key，留空保留；明确勾选才会清除。':'尚无 Key，填写后才能用于新任务。';
  if(provider?.adapterType==='openai-chat-v1')select('token-parameter').value=Object.hasOwn(provider.parameters,'max_completion_tokens')?'max_completion_tokens':'max_tokens';
  parameters(provider?.parameters);compatibility();(document.getElementById('entry') as HTMLFieldSetElement).disabled=false;updateSave();
}).catch(()=>{message.textContent='无法读取配置，请关闭后重试。';});
