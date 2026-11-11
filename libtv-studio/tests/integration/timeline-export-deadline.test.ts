import{afterEach,expect,it,vi}from'vitest';
import{randomUUID}from'node:crypto';import{join}from'node:path';
const publication=vi.hoisted(()=>({before:undefined as undefined|(()=>Promise<void>),after:undefined as undefined|(()=>void),write:undefined as undefined|(()=>Promise<void>)}));
vi.mock('node:fs/promises',async()=>{const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');return{...actual,open:async(...args:Parameters<typeof actual.open>)=>{const h=await actual.open(...args);if(String(args[0]).endsWith('.partial')){const write=h.write.bind(h);h.write=(async(...values:any[])=>{await publication.write?.();return (write as any)(...values);})as typeof h.write;}return h;},link:async(a:string,b:string)=>{await publication.before?.();await actual.link(a,b);publication.after?.();}};});
import{mkdir,readFile}from'node:fs/promises';
import{setup,cleanup,image,create,command,unwrap}from'./timeline-fixtures.ts';
import{timelineExporter}from'../../apps/desktop/src/main/timeline-export.ts';
import{serializeDirectoryOperation}from'../../apps/desktop/src/main/project-directories.ts';
const deferred=<T=void>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
const flush=async()=>{for(let i=0;i<30;i++)await new Promise<void>(r=>setImmediate(r));};
afterEach(async()=>{publication.before=undefined;publication.after=undefined;publication.write=undefined;vi.useRealTimers();await cleanup();});
async function fixture(){const f=await setup(),ref=await image(f.e,f.root),hash=unwrap(f.e.assets.metadata(ref)).hash;unwrap(await f.e.commands.execute(command(f.e,'timeline.create',create(f.projectId))));unwrap(await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'insert',clip:{id:'clip',kind:'image',media:ref,sourceHash:hash,sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:48000,fit:'contain',gainMilli:1000,mute:true}},{kind:'setCue',cue:{id:'cue',startTicks:0,endTicks:48000,text:'总预算验收'}}]})));const root=join(f.root,'导出 截止');await mkdir(root);return{...f,binding:{root,libraryId:f.e.identity.libraryId,projectId:f.projectId},input:{requestId:randomUUID(),projectId:f.projectId,timelineId:'cut',revision:2,kind:'srt' as const}};}
it.each(['prepare','close']as const)('returns within the total budget when %s never acknowledges',async phase=>{
 const f=await fixture(),input={...f.input,kind:phase==='close'?'sources' as const:'srt' as const},p=unwrap(await f.e.exports.prepareExport(input)),entered=deferred(),gate=deferred();
 const records={...f.e.exports,prepareExport:async(x:unknown)=>{if(phase==='prepare'){entered.resolve();await gate.promise;return{ok:true as const,value:p};}return f.e.exports.prepareExport(x);}};
 const io={...f.e.assets,closeMediaRead:async(id:string)=>{await f.e.assets.closeMediaRead(id);if(phase==='close'){entered.resolve();await gate.promise;}}};
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const exporter=timelineExporter(records,io);let result:any;const pending=exporter.exportTimeline(f.binding,input).then(r=>result=r);
 try{await entered.promise;await vi.advanceTimersByTimeAsync(phase==='prepare'?1680000:1800000);await vi.waitFor(()=>expect(result).toMatchObject({ok:false,error:{code:'EXPORT_TIMEOUT'}}));}finally{gate.resolve();await pending;await exporter.close();}
});
it('counts time spent waiting for the directory lock and keeps same-ID exclusion until work actually ends',async()=>{
 const f=await fixture(),entered=deferred(),gate=deferred();const lock=serializeDirectoryOperation(f.binding.root,async()=>{entered.resolve();await gate.promise;});await entered.promise;let prepares=0;
 const exporter=timelineExporter({...f.e.exports,prepareExport:async(x:unknown)=>{prepares++;return f.e.exports.prepareExport(x);}},f.e.assets);
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});let result:any;const pending=exporter.exportTimeline(f.binding,f.input).then(r=>result=r);
 try{await vi.advanceTimersByTimeAsync(1800000);await flush();expect(result).toMatchObject({ok:false,error:{code:'EXPORT_TIMEOUT'}});expect(prepares).toBe(0);expect(await exporter.exportTimeline(f.binding,f.input)).toMatchObject({ok:false,error:{code:'EXPORT_BUSY'}});}finally{gate.resolve();await lock;await pending;await exporter.close();}expect(prepares).toBe(0);
});
it('stops a stalled copy at the idle limit and closes a late source lease without reading or publishing it',async()=>{
 const f=await fixture(),gate=deferred(),entered=deferred();let opened=0,closed=0,reads=0;
 const io={...f.e.assets,openMediaRead:async(ref:any,hash?:string)=>{const r=await f.e.assets.openMediaRead(ref,hash);opened++;entered.resolve();await gate.promise;return r;},readMediaRange:async(x:any)=>{reads++;return f.e.assets.readMediaRange(x);},closeMediaRead:async(id:string)=>{closed++;await f.e.assets.closeMediaRead(id);}};
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const exporter=timelineExporter(f.e.exports,io);let result:any;const pending=exporter.exportTimeline(f.binding,{...f.input,kind:'sources'}).then(r=>result=r);
 try{await entered.promise;await vi.advanceTimersByTimeAsync(120000);await vi.waitFor(()=>expect(result).toMatchObject({ok:false,error:{code:'EXPORT_COPY_IDLE_TIMEOUT'}}));expect(reads).toBe(0);}finally{gate.resolve();await pending;await flush();await exporter.close();}expect(opened).toBe(1);expect(closed).toBe(1);expect(reads).toBe(0);
});
it('returns an uncertain publication at the deadline and reconciles its late atomic link once',async()=>{
 const f=await fixture(),entered=deferred(),gate=deferred(),linked=deferred();let links=0;publication.before=async()=>{entered.resolve();await gate.promise;};publication.after=()=>{links++;linked.resolve();};
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const exporter=timelineExporter(f.e.exports,f.e.assets);let result:any;const pending=exporter.exportTimeline(f.binding,f.input).then(r=>result=r);
 try{await entered.promise;await vi.advanceTimersByTimeAsync(1800000);await flush();expect(result).toMatchObject({ok:false,error:{code:'EXPORT_TIMEOUT'}});expect(await exporter.exportTimeline(f.binding,f.input)).toMatchObject({ok:false,error:{code:'EXPORT_BUSY'}});}finally{gate.resolve();await linked.promise;await pending;await exporter.close();publication.before=undefined;}
 const recovered=unwrap(await timelineExporter(f.e.exports,f.e.assets).exportTimeline(f.binding,f.input));expect(recovered.state).toBe('completed');expect(links).toBe(1);expect(await readFile(join(f.binding.root,recovered.relativePath),'utf8')).toContain('总预算验收');
});

it.each(['prepare','outcome']as const)('bounds the %s acknowledgement in failure reconciliation',async phase=>{
 const f=await fixture(),gate=deferred(),entered=deferred();let prepares=0;
 const records={...f.e.exports,prepareExport:async(x:unknown)=>{prepares++;if(phase==='prepare'&&prepares>1){entered.resolve();await gate.promise;}return f.e.exports.prepareExport(x);},recordExportOutcome:async(x:any)=>{const result=await f.e.exports.recordExportOutcome(x);if(x.state==='copying')throw Error('ENGINE_DISCONNECTED');if(phase==='outcome'&&x.state==='failed'){entered.resolve();await gate.promise;}return result;}};
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const exporter=timelineExporter(records,f.e.assets);let result:any;const pending=exporter.exportTimeline(f.binding,f.input).then(r=>result=r);
 try{await entered.promise;await vi.advanceTimersByTimeAsync(1800000);expect(result).toMatchObject({ok:false,error:{code:'EXPORT_TIMEOUT'}});}finally{gate.resolve();await pending;await exporter.close();}
});
it('reports a publication begun before cancellation as completed after its actual link settles',async()=>{
 const f=await fixture(),entered=deferred(),gate=deferred();let links=0;publication.before=async()=>{entered.resolve();await gate.promise;};publication.after=()=>{links++;};const exporter=timelineExporter(f.e.exports,f.e.assets),pending=exporter.exportTimeline(f.binding,f.input);await entered.promise;
 const cancelled=exporter.cancelTimelineExport({requestId:f.input.requestId});try{await vi.waitFor(()=>expect(unwrap(f.e.exports.list({projectId:f.input.projectId,timelineId:'cut'})).exports[0]!.state).toBe('cancelled'));gate.resolve();expect(unwrap(await pending).state).toBe('completed');expect(await cancelled).toMatchObject({ok:true});expect(links).toBe(1);}finally{gate.resolve();await pending;await cancelled;await exporter.close();}
});

it('releases an already-held source after a physical write outlives the caller deadline',async()=>{
 const f=await fixture(),entered=deferred(),gate=deferred();let closes=0,closeContext:any;const io={...f.e.assets,readMediaRange:async(x:any)=>{const r=await f.e.assets.readMediaRange(x);publication.write=async()=>{entered.resolve();await gate.promise;};return r;},closeMediaRead:async(id:string,c?:any)=>{closes++;closeContext=c;await f.e.assets.closeMediaRead(id);}};
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const exporter=timelineExporter(f.e.exports,io);let result:any;const pending=exporter.exportTimeline(f.binding,{...f.input,kind:'sources'}).then(r=>result=r);
 try{await entered.promise;await vi.advanceTimersByTimeAsync(1800000);expect(result).toMatchObject({ok:false,error:{code:'EXPORT_TIMEOUT'}});expect(closes).toBe(0);}finally{gate.resolve();await pending;await exporter.close();}expect(closes).toBe(1);expect(closeContext.stage).toBe('late-close');expect(closeContext.deadlineMonotonicMs).toBeUndefined();
});
