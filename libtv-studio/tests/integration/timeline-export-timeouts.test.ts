import {EventEmitter} from 'node:events';
import {afterEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({fork:vi.fn()}));
vi.mock('electron',()=>({utilityProcess:{fork:mock.fork}}));
vi.mock('../../apps/desktop/src/main/media-runtime.ts',()=>({resolveMediaRuntime:async()=>({ok:false,error:{code:'MEDIA_RUNTIME_UNAVAILABLE',message:'fixture'}})}));
import {startEngineHost} from '../../apps/desktop/src/main/engine-host.ts';
import {CURRENT_SCHEMA_VERSION} from '../../packages/contracts/src/schema.ts';
const hash='a'.repeat(64),ref={kind:'assetVersion' as const,libraryId:'library',assetId:'asset',version:1};
const trace={requestId:'28e00401-480a-4a05-89bd-f05343dd2377',fixedRevision:2,stage:'open'};
afterEach(()=>vi.useRealTimers());
async function fixture(){
 const messages:any[]=[];const child=new EventEmitter() as any;child.kill=()=>child.emit('exit');
 child.postMessage=(m:any)=>{if(m.type==='initialize')queueMicrotask(()=>child.emit('message',{type:'ready',launchId:m.launchId,result:{ok:true,value:{instanceId:'instance',libraryId:'library',schemaVersion:CURRENT_SCHEMA_VERSION,nodeVersion:'24',sqliteVersion:'3'}}}));else messages.push(m);};
 mock.fork.mockImplementation(()=>{queueMicrotask(()=>child.emit('spawn'));return child;});
 const h=await startEngineHost('isolated-fixture');if(!h.ok)throw Error(h.error.code);
 const reply=(m:any,value:any)=>child.emit('message',{type:'response',launchId:m.launchId,requestId:m.requestId,result:{ok:true,value}});
 return {host:h.value,messages,child,reply};
}
it('scopes longer media/export RPC waits to export context and cleans a late opened lease',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});const f=await fixture();
 let result:any;const read=f.host.openMediaRead(ref,hash,trace).then(r=>{result=r;});
 await vi.advanceTimersByTimeAsync(6000);expect(result).toBeUndefined();
 f.reply(f.messages[0],{leaseId:'lease',hash,byteLength:1,mime:'image/png',expiresAt:Date.now()+120000});await read;expect(result.ok).toBe(true);
 let ordinary:any;const regular=f.host.openMediaRead(ref,hash).then(r=>ordinary=r);
 await vi.advanceTimersByTimeAsync(5001);await regular;expect(ordinary.error.code).toBe('ENGINE_REQUEST_TIMEOUT');
 let late:any;const pending=f.host.openMediaRead(ref,hash,trace).then(r=>late=r),m=f.messages.at(-1);
 await vi.advanceTimersByTimeAsync(120001);await pending;expect(late.error.code).toBe('ENGINE_REQUEST_TIMEOUT');
 f.reply(m,{leaseId:'late-lease',hash,byteLength:1,mime:'image/png',expiresAt:Date.now()+120000});
 await vi.advanceTimersByTimeAsync(0);expect(f.messages.at(-1)).toMatchObject({kind:'media.closeInternal',payload:{leaseId:'late-lease'}});
 f.child.emit('exit');
});


it.each(['prepare','read','outcome','cancel'] as const)('keeps the %s export RPC alive past the legacy five-second window',async kind=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});const f=await fixture();let settled=false;
 const request=kind==='prepare'?f.host.prepareExport({requestId:trace.requestId,projectId:'project',timelineId:'cut',revision:2,kind:'sources'}):
 kind==='read'?f.host.readMediaRange({leaseId:'lease',offset:0,length:1},trace):
 kind==='outcome'?f.host.recordExportOutcome({requestId:trace.requestId,exportId:'f789e71f-fbe0-4f18-b7d9-9ec974421f9d',state:'copying',byteLength:0,hash:null,errorCode:null}):
 f.host.cancelExport({requestId:trace.requestId});
 void request.then(()=>settled=true);await vi.advanceTimersByTimeAsync(6000);expect(settled).toBe(false);f.child.emit('exit');await request;
});

it.each(['prepare','read','outcome','cancel','close']as const)('clamps the %s RPC to the remaining shared deadline',async kind=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});const f=await fixture(),context={...trace,deadlineMonotonicMs:performance.now()+10};let result:any;
 const input={requestId:trace.requestId,projectId:'project',timelineId:'cut',revision:2,kind:'sources' as const};
 const request=kind==='prepare'?f.host.prepareExport(input,context):kind==='read'?f.host.readMediaRange({leaseId:'lease',offset:0,length:1},context):kind==='outcome'?f.host.recordExportOutcome({requestId:trace.requestId,exportId:'f789e71f-fbe0-4f18-b7d9-9ec974421f9d',state:'copying',byteLength:0,hash:null,errorCode:null},context):kind==='cancel'?f.host.cancelExport({requestId:trace.requestId},context):f.host.closeMediaRead('lease',context);
 const done=request.then(r=>{result={returned:true,value:r};});
 try{await vi.advanceTimersByTimeAsync(11);expect(result?.returned).toBe(true);const before=f.messages.length;await f.host.openMediaRead(ref,hash,{...context,deadlineMonotonicMs:performance.now()-1});expect(f.messages.length).toBe(before);}finally{f.child.emit('exit');await done;}
});

it.each(['original','derived']as const)('closes a late ordinary %s preview open after its five-second caller timeout',async kind=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});const f=await fixture();const opened=kind==='original'?f.host.openMediaRead(ref,hash):f.host.openDerivedMediaRead({libraryId:'library',cacheId:'b'.repeat(64),sourceHash:hash,recipeHash:'c'.repeat(64)});const m=f.messages.at(-1);await vi.advanceTimersByTimeAsync(5001);expect(await opened).toMatchObject({ok:false,error:{code:'ENGINE_REQUEST_TIMEOUT'}});f.reply(m,{leaseId:'late-preview',hash,byteLength:1,mime:'image/png',expiresAt:Date.now()+120000});await vi.advanceTimersByTimeAsync(0);expect(f.messages.at(-1)).toMatchObject({kind:kind==='original'?'media.closeInternal':'media.derivedCloseInternal',payload:{leaseId:'late-preview'}});f.child.emit('exit');
});
