import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { modelConfigStore } from '../../apps/desktop/src/main/model-config-store';
import { createTextOnboarding } from '../../apps/desktop/src/main/text-onboarding';
import { encodeTextRequest } from '../../packages/providers/src/text-protocol';
const roots: string[] = [], servers: Server[] = [];
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function fixture(adapterType='openai-chat-v1', path='/gateway') {
  const requests: {url:string;headers:any;body:any}[]=[];
  let mode='ok';let custom:((req:any,res:any)=>void)|undefined;
  const server=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{requests.push({url:req.url!,headers:req.headers,body:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null});if(custom){custom(req,res);return;}if(mode==='hang')return;if(mode==='redirect'){res.writeHead(302,{location:'/stolen'});res.end();return;}if(mode==='wrong'){res.writeHead(401);res.end('fixture-secret-key raw upstream');return;}if(req.method==='GET'){if(mode==='unsupported'){res.writeHead(404);res.end();return;}res.end(JSON.stringify({data:[{id:'fixture-model'},{id:'fixture-model'},{id:'fixture-secret-key'}],has_more:false}));return;}res.end(JSON.stringify(mode==='invalid'?{choices:[]} :adapterType==='anthropic-messages-v1'?{type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'Hello'}]}:{choices:[{message:{content:'Hello'},finish_reason:'stop'}]}));});});
  servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();if(!addr||typeof addr==='string')throw Error('port');
  const root=await mkdtemp(join(tmpdir(),'text-onboarding-'));roots.push(root);const file=join(root,'models.json');
  const provider={id:'chat',name:'Fixture',kind:'text',baseURL:`http://127.0.0.1:${addr.port}${path}`,apiKey:'fixture-secret-key',modelId:'fixture-model',allowPrivateEndpoint:true,adapterType,parameters:adapterType==='openai-chat-v1'?{max_completion_tokens:1024}:{max_tokens:1024},pricing:{status:'unknown'}};
  await writeFile(file,JSON.stringify({schemaVersion:2,providers:[provider]}));const store=modelConfigStore(file),read=await store.readPublic();expect(read.ok).toBe(true);if(!read.ok)throw Error('read');
  const input={expectedVersion:read.value.version,provider:{...provider,apiKey:'',clearKey:false}};
  return {store,file,input,requests,service:createTextOnboarding(store),mode:(v:string)=>{mode=v;},respond:(fn:(req:any,res:any)=>void)=>{custom=fn;}};
}
it.each(['openai-chat-v1','anthropic-messages-v1'])('lists and tests %s with retained main-only key and proper native paths/auth',async adapter=>{
  const s=await fixture(adapter,'');expect(await s.service.authorize(s.input)).toMatchObject({ok:false,error:{code:'MODEL_TEST_REQUIRED'}});
  expect(await s.service.listModels(s.input)).toMatchObject({ok:true,value:{models:['fixture-model'],truncated:false}});
  const tested=await s.service.test(s.input);expect(tested).toMatchObject({ok:true});if(!tested.ok)throw Error('test');
  const req=s.requests[1]!;expect(req.url).toBe(adapter==='openai-chat-v1'?'/v1/chat/completions':'/v1/messages');expect(req.body).toMatchObject({model:'fixture-model',stream:false,...(adapter==='openai-chat-v1'?{max_completion_tokens:1024}:{max_tokens:1024})});
  expect(req.headers).toMatchObject(adapter==='openai-chat-v1'?{authorization:'Bearer fixture-secret-key'}:{'x-api-key':'fixture-secret-key','anthropic-version':'2023-06-01'});expect(req.headers[adapter==='openai-chat-v1'?'x-api-key':'authorization']).toBeUndefined();
  for(const change of [{modelId:'different'},{apiKey:'different-key'},{adapterType:adapter==='openai-chat-v1'?'anthropic-messages-v1':'openai-chat-v1',parameters:{max_tokens:1024}},{parameters:adapter==='openai-chat-v1'?{max_tokens:2048}:{max_tokens:2048}},{baseURL:s.input.provider.baseURL+'/other'}])expect((await s.service.authorize({...s.input,provider:{...s.input.provider,...change},testReceipt:tested.value.receipt})).ok).toBe(false);
  expect(await s.service.authorize({...s.input,testReceipt:tested.value.receipt})).toMatchObject({ok:true});expect((await s.service.authorize({...s.input,testReceipt:tested.value.receipt})).ok).toBe(false);
});
it('accepts mixed Anthropic thinking and text without exposing internal content in its receipt',async()=>{
  const s=await fixture('anthropic-messages-v1');
  s.respond((_req,res)=>res.end(JSON.stringify({type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'thinking',thinking:'private fixture reasoning',signature:'fixture-signature'},{type:'redacted_thinking',data:'fixture-redacted-data'},{type:'text',text:'OK'}]})));
  const result=await s.service.test(s.input);expect(result).toMatchObject({ok:true});
  expect(Object.keys(result.ok?result.value:{})).toEqual(['receipt']);expect(JSON.stringify(result)).not.toContain('private fixture reasoning');expect(JSON.stringify(result)).not.toContain('fixture-redacted-data');
});
it.each([
  [{type:'thinking',thinking:'private fixture reasoning',signature:'fixture-signature'}],
  [{type:'redacted_thinking',data:'fixture-redacted-data'}],
  [{type:'text',text:' '},{type:'thinking',thinking:'private fixture reasoning',signature:'fixture-signature'}],
  [{type:'text',text:'OK'},{type:'tool_use',id:'tool',name:'fixture',input:{}}],
  [{type:'text',text:'OK'},{type:'thinking',thinking:42,signature:'fixture-signature'}],
  [{type:'text',text:'OK'},{type:'thinking',thinking:'invalid missing signature'}],
  [{type:'text',text:'OK'},{type:'redacted_thinking',data:42}],
  [{type:'text',text:'OK'},{type:'redacted_thinking'}],
  [{type:'text',text:42}],
  [{type:'text',text:'OK'},null],
  [{type:'text',text:'OK'},{type:'unknown'}],
].map(content=>[content]))('rejects thinking-only, tool or malformed Anthropic responses without leaking internals (%#)',async content=>{
  const s=await fixture('anthropic-messages-v1');s.respond((_req,res)=>res.end(JSON.stringify({type:'message',role:'assistant',stop_reason:'end_turn',content})));
  const result=await s.service.test(s.input);expect(result).toMatchObject({ok:false,error:{code:'INVALID_TEXT_RESPONSE'}});expect(JSON.stringify(result)).not.toContain('private fixture reasoning');expect(JSON.stringify(result)).not.toContain('fixture-redacted-data');
  if(!result.ok){expect(result.error.message).not.toContain('128');expect(result.error.message).toContain('高级设置');}
  expect((await s.service.authorize(s.input)).ok).toBe(false);expect(s.requests).toHaveLength(1);
});
it.each(['openai-chat-v1','anthropic-messages-v1'])('tests the selected %s budget, invalidates older receipts and saves the same production parameter',async adapter=>{
  const s=await fixture(adapter);const first=await s.service.test(s.input);if(!first.ok)throw Error('first test');
  const key=adapter==='openai-chat-v1'?'max_completion_tokens':'max_tokens';
  const edited={...s.input,provider:{...s.input.provider,parameters:{[key]:2048}}};
  expect(await s.service.authorize({...edited,testReceipt:first.value.receipt})).toMatchObject({ok:false,error:{code:'MODEL_TEST_REQUIRED'}});
  const second=await s.service.test(edited);if(!second.ok)throw Error('second test');expect(s.requests.map(r=>r.body[key])).toEqual([1024,2048]);
  expect(await s.service.authorize({...edited,testReceipt:second.value.receipt})).toMatchObject({ok:true});expect((await s.store.save(edited)).ok).toBe(true);
  const saved=await s.store.readPrivate();if(!saved.ok)throw Error('saved config');const provider=saved.value.config.providers[0]!;
  expect(provider.parameters).toEqual({[key]:2048});const production=encodeTextRequest(provider.adapterType,provider.modelId,'Production prompt',provider.parameters);if(!production.ok)throw Error('production encode');expect(JSON.parse(production.value.toString())[key]).toBe(2048);
});
it.each([1,8192])('allows selected budget boundary %s',async budget=>{
  const s=await fixture();const input={...s.input,provider:{...s.input.provider,parameters:{max_completion_tokens:budget}}};expect((await s.service.test(input)).ok).toBe(true);expect(s.requests[0]!.body.max_completion_tokens).toBe(budget);
});
it.each([0,8193,1.5])('rejects invalid selected budget %s before any request',async budget=>{
  const s=await fixture();expect((await s.service.test({...s.input,provider:{...s.input.provider,parameters:{max_completion_tokens:budget}}})).ok).toBe(false);expect(s.requests).toHaveLength(0);
});
it('allows explicit clear without test; conflicts and cancellation cannot authorize',async()=>{
  const s=await fixture();expect(await s.service.authorize({...s.input,provider:{...s.input.provider,clearKey:true}})).toMatchObject({ok:true});
  const tested=await s.service.test(s.input);if(!tested.ok)throw Error('test');await writeFile(s.file,JSON.stringify({schemaVersion:2,providers:[]}));expect(await s.service.authorize({...s.input,testReceipt:tested.value.receipt})).toMatchObject({ok:false,error:{code:'MODEL_CONFIG_CONFLICT'}});
  const slow=await fixture();slow.mode('hang');const pending=slow.service.test(slow.input);slow.service.cancel();expect((await pending).ok).toBe(false);
});
it('expires receipts after ten minutes and keeps receipts local to one window',async()=>{
  const s=await fixture();let time=100;const service=createTextOnboarding(s.store,{now:()=>time});const tested=await service.test(s.input);if(!tested.ok)throw Error('test');
  expect((await s.service.authorize({...s.input,testReceipt:tested.value.receipt})).ok).toBe(false);
  time+=600000;expect((await service.authorize({...s.input,testReceipt:tested.value.receipt})).ok).toBe(false);
});
it('times out a real hanging endpoint without a retry or raw upstream text',async()=>{
  const s=await fixture();s.mode('hang');const service=createTextOnboarding(s.store,{timeoutMs:40});
  expect(await service.test(s.input)).toMatchObject({ok:false,error:{code:'MODEL_TEST_NETWORK'}});expect(s.requests).toHaveLength(1);
});
it.each(['wrong','invalid','redirect','unsupported'])('returns sanitized %s failures and leaves manual entry available',async mode=>{
  const s=await fixture();s.mode(mode);const result=mode==='unsupported'?await s.service.listModels(s.input):await s.service.test(s.input);expect(result.ok).toBe(false);expect(JSON.stringify(result)).not.toContain('fixture-secret-key');expect(s.requests.length).toBe(1);
});

it('bounds Anthropic pagination by total inspected items and preserves the gateway path',async()=>{
  const s=await fixture('anthropic-messages-v1');s.respond((req,res)=>res.end(JSON.stringify({data:Array.from({length:600},(_,i)=>({id:`model-${i}`})),has_more:true,last_id:req.url.includes('after_id')?'page-two':'page-one'})));
  expect(await s.service.listModels(s.input)).toMatchObject({ok:true,value:{truncated:true}});expect(s.requests).toHaveLength(2);
  expect(s.requests[1]!.url).toBe('/gateway/models?limit=1000&after_id=page-one');
});
it('a late success cannot authorize an edited draft or an abandoned window',async()=>{
  const s=await fixture();let release:()=>void=()=>{};let contacted!:()=>void;const arrived=new Promise<void>(r=>{contacted=r;});
  s.respond((_req,res)=>{release=()=>res.end(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}]}));contacted();});
  const pending=s.service.test(s.input);await arrived;s.input.provider.modelId='changed';release();expect((await pending).ok).toBe(false);expect((await s.service.authorize(s.input)).ok).toBe(false);
});
it('rejects malformed and oversized list bodies without exposing data and keeps manual testing available',async()=>{
  const s=await fixture();s.respond((_req,res)=>res.end('fixture-secret-key '+ 'x'.repeat(1024*1024)));const bad=await s.service.listModels(s.input);expect(bad.ok).toBe(false);expect(JSON.stringify(bad)).not.toContain('fixture-secret-key');
  s.respond((_req,res)=>res.end(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}]})));expect((await s.service.test(s.input)).ok).toBe(true);
});
