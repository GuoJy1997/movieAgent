import {createExportDeadline,traceExport,type ExportDeadline,type ExportTraceContext} from './export-request-policy.ts';
import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { lstat, mkdir, open, realpath, link, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { isPreparedExport, isExportTimelineInput, isCancelTimelineExport, exportPolicy, type PreparedExport, type ExportOutcome, type ExportReceipt, type ExportSource, type ExportTemporary } from '../../../../packages/contracts/src/timeline-export.ts';
import type { MediaReference } from '../../../../packages/contracts/src/assets.ts';
import type { ReadLease, MediaChunk, MediaRangeRequest } from '../../../../packages/contracts/src/media-info.ts';
import { timelineSrt, timelineCsv } from '../../../../packages/domain/src/timeline-export-format.ts';
import { canonicalPath, serializeDirectoryOperation } from './project-directories.ts';
export {verifyFile};
type Binding={root:string;logRoot?:string;libraryId:string;projectId:string};
interface Records {prepareExport(input:unknown,context?:ExportTraceContext):Promise<Result<PreparedExport>>;recordExportOutcome(input:ExportOutcome,context?:ExportTraceContext):Promise<Result<ExportReceipt>>;cancelExport(input:unknown,context?:ExportTraceContext):Promise<Result<void>>}
interface MediaIO {openMediaRead(ref:MediaReference,hash?:string,context?:ExportTraceContext):Promise<Result<ReadLease>>;readMediaRange(input:MediaRangeRequest,context?:ExportTraceContext):Promise<Result<MediaChunk>>;closeMediaRead(id:string,context?:ExportTraceContext):Promise<void>}
const block=1024*1024;
const errorCode=(e:unknown):string=>{const code=e instanceof Error?e.message:'';return /^[A-Z][A-Z0-9_]{0,95}$/.test(code)?code:'EXPORT_IO_FAILED';};
function unwrap<T>(r:Result<T>):T{if(!r.ok)throw Error(/^[A-Z][A-Z0-9_]{0,95}$/.test(r.error.code)?r.error.code:'EXPORT_IO_FAILED');return r.value;}
const snapshotHash=(p:PreparedExport)=>createHash('sha256').update(JSON.stringify({timeline:p.timeline,sources:p.sources,storyboard:p.storyboard,output:p.output})).digest('hex');
function cancelled(signal:AbortSignal){if(signal.aborted)throw Error(typeof signal.reason==='string'?signal.reason:'EXPORT_CANCELLED');}
async function checkDirectory(path:string){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||canonicalPath(await realpath(path))!==canonicalPath(path))throw Error('EXPORT_PATH_UNSAFE');}
async function checkParents(binding:Binding,kind:ExportReceipt['kind'],create:boolean){await checkDirectory(binding.root);let dir=binding.root;for(const part of ['exports',exportPolicy[kind].directory]){dir=join(dir,part);if(create)await mkdir(dir).catch(e=>{if(e.code!=='EEXIST')throw e;});await checkDirectory(dir);}return dir;}
async function exists(path:string){try{return await lstat(path,{bigint:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}}
const temporaryPath=(dir:string,p:PreparedExport,t:ExportTemporary)=>join(dir,`.export-${p.receipt.exportId}-${t.id}.partial`);
async function cleanJournaledTemporary(dir:string,p:PreparedExport,target?:string){
 if(!p.temporary)return;const path=temporaryPath(dir,p,p.temporary),s=await exists(path);if(!s)return;
 if(!s.isFile()||s.isSymbolicLink()||s.dev.toString()!==p.temporary.dev||s.ino.toString()!==p.temporary.ino)throw Error('EXPORT_PATH_UNSAFE');
 if(target){const dest=await lstat(target,{bigint:true});if(s.nlink!==2n||dest.nlink!==2n||dest.dev!==s.dev||dest.ino!==s.ino||p.receipt.hash===null||s.size!==BigInt(p.receipt.byteLength))throw Error('EXPORT_TARGET_EXISTS');}
 else if(s.nlink!==1n)throw Error('EXPORT_PATH_UNSAFE');
 await unlink(path);
}
async function verifyFile(path:string,expected:{hash:string;byteLength:number},signal:AbortSignal){const before=await lstat(path,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size!==BigInt(expected.byteLength))throw Error('EXPORT_TARGET_EXISTS');const h=await open(path,'r');try{const held=await h.stat({bigint:true});if(held.dev!==before.dev||held.ino!==before.ino)throw Error('EXPORT_PATH_UNSAFE');const hash=createHash('sha256'),buffer=Buffer.alloc(block);let offset=0;while(offset<expected.byteLength){cancelled(signal);const chunk=await h.read(buffer,0,Math.min(block,expected.byteLength-offset),offset);if(!chunk.bytesRead)throw Error('EXPORT_VERIFY_FAILED');hash.update(buffer.subarray(0,chunk.bytesRead));offset+=chunk.bytesRead;}const after=await lstat(path,{bigint:true}),end=await h.stat({bigint:true});if(hash.digest('hex')!==expected.hash||end.size!==before.size||end.mtimeNs!==before.mtimeNs||after.ino!==held.ino||after.dev!==held.dev||after.nlink!==1n)throw Error('EXPORT_VERIFY_FAILED');}finally{await h.close();}}
async function abortable<T>(promise:Promise<T>,signal:AbortSignal,onLate?:(value:T)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{let done=false;const stop=()=>{if(done)return;done=true;reject(Error(typeof signal.reason==='string'?signal.reason:'EXPORT_CANCELLED'));};
 if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
 void promise.then(value=>{if(done){onLate?.(value);return;}done=true;signal.removeEventListener('abort',stop);resolve(value);},error=>{if(done)return;done=true;signal.removeEventListener('abort',stop);reject(error);});
 });
}
const contextFor=(p:PreparedExport,stage:string,deadlineMonotonicMs?:number):ExportTraceContext=>({requestId:p.receipt.requestId,exportId:p.receipt.exportId,fixedRevision:p.receipt.revision,stage,deadlineMonotonicMs});
async function* original(source:ExportSource,io:MediaIO,signal:AbortSignal,context:ExportTraceContext,cleanupDeadline?:number):AsyncGenerator<Uint8Array>{
 let lease:ReadLease|undefined;
 const close=async()=>{if(lease){const id=lease.leaseId;lease=undefined;const late=cleanupDeadline!==undefined&&cleanupDeadline<=performance.now();await io.closeMediaRead(id,{...context,stage:late?'late-close':'close',deadlineMonotonicMs:late?undefined:cleanupDeadline}).catch(()=>undefined);}};
 const reopen=async()=>{await close();cancelled(signal);lease=unwrap(await abortable(io.openMediaRead(source.ref,source.hash,context),signal,r=>{if(r.ok)void io.closeMediaRead(r.value.leaseId,{...context,stage:'late-close',deadlineMonotonicMs:undefined}).catch(()=>undefined);}));
 if(lease.byteLength!==source.byteLength||lease.hash!==source.hash||lease.mime!==source.mime)throw Error('REFERENCE_CHANGED');};
 try{
  await reopen();const hash=createHash('sha256');let offset=0,reopened=false;
  while(offset<source.byteLength){cancelled(signal);
   if(lease!.expiresAt-Date.now()<45000)await reopen();
   let read=await abortable(io.readMediaRange({leaseId:lease!.leaseId,offset,length:Math.min(block,source.byteLength-offset)},{...context,stage:'read'}),signal);
   if(!read.ok&&read.error.code==='MEDIA_LEASE_EXPIRED'&&!reopened){reopened=true;await reopen();continue;}
   const chunk=unwrap(read);cancelled(signal);
   if(chunk.leaseId!==lease!.leaseId||chunk.offset!==offset||chunk.bytes.byteLength===0||chunk.bytes.byteLength>Math.min(block,source.byteLength-offset))throw Error('EXPORT_SOURCE_INVALID');
   hash.update(chunk.bytes);offset+=chunk.bytes.byteLength;reopened=false;yield chunk.bytes;
  }
  if(hash.digest('hex')!==source.hash)throw Error('REFERENCE_CHANGED');
 }finally{await close();}
}
// ZIP32 STORE, UTF-8 names, signed data descriptors. A bounded central directory is
// retained; original media is yielded one <=1 MiB chunk at a time. No paths enter it.
async function* zip(p:PreparedExport,io:MediaIO,signal:AbortSignal,deadline:ExportDeadline):AsyncGenerator<Uint8Array>{
 const manifest=Buffer.from(JSON.stringify({schemaVersion:1,notice:'Original media snapshot; not a project exchange package.',timelineRef:{libraryId:p.timeline.libraryId,projectId:p.timeline.projectId,id:p.timeline.id,revision:p.timeline.revision},sources:p.sources},null,2));
 const unique=[...new Map(p.sources.map(s=>[s.filename,s])).values()];
 const entries=[{name:'manifest.json',size:manifest.length,read:async function*(){yield manifest;}},...unique.map(s=>({name:s.filename,size:s.byteLength,read:()=>original(s,io,signal,contextFor(p,'open',deadline.executionDeadline),deadline.settlementDeadline)}))];const central:Buffer[]=[];let offset=0;
 for(const entry of entries){cancelled(signal);const name=Buffer.from(entry.name),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x808,6);header.writeUInt16LE(33,12);header.writeUInt16LE(name.length,26);const start=offset;yield header;yield name;offset+=header.length+name.length;let crc=0,size=0;for await(const bytes of entry.read()){cancelled(signal);size+=bytes.byteLength;if(size>entry.size)throw Error('EXPORT_SOURCE_INVALID');crc=crc32(bytes,crc);yield bytes;offset+=bytes.byteLength;}if(size!==entry.size)throw Error('EXPORT_SOURCE_INVALID');const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(size,8);descriptor.writeUInt32LE(size,12);yield descriptor;offset+=16;const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x808,8);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(size,20);record.writeUInt32LE(size,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(start,42);central.push(Buffer.concat([record,name]));}
 const centralStart=offset;for(const entry of central){yield entry;offset+=entry.length;}const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(offset-centralStart,12);end.writeUInt32LE(centralStart,16);yield end;
}
async function* contents(p:PreparedExport,io:MediaIO,signal:AbortSignal,deadline:ExportDeadline){if(p.receipt.kind==='sources')yield* zip(p,io,signal,deadline);else if(p.output)yield* original(p.output,io,signal,contextFor(p,'open',deadline.executionDeadline),deadline.settlementDeadline);else {const bytes=Buffer.from(p.receipt.kind==='srt'?timelineSrt(p.timeline):timelineCsv(p.timeline,p.storyboard),'utf8');for(let offset=0;offset<bytes.length;offset+=block){cancelled(signal);yield bytes.subarray(offset,Math.min(offset+block,bytes.length));}}}
export function timelineExporter(records:Records,io:MediaIO){
 const running=new Map<string,Promise<void>>();const active=new Map<string,AbortController>(),pending=new Set<Promise<void>>(),budgets=new Map<string,{deadline:ExportDeadline;boundary:AbortController}>();let closed=false;
 async function exportTimeline(binding:Binding|null,input:unknown):Promise<Result<ExportReceipt>>{
  if(!isExportTimelineInput(input))return fail('INVALID_INPUT','导出参数无效。');if(closed)return fail('EXPORT_UNAVAILABLE','导出入口已停止。');if(!binding)return fail('NO_DIRECTORY_PROJECT','请先打开目录项目。');if(input.projectId!==binding.projectId)return fail('WRONG_PROJECT','导出项目与目录绑定不符。');
  // Install cancellation before queueing for the shared directory lock.
  if(active.has(input.requestId))return fail('EXPORT_BUSY','同一导出正在进行，请读取导出记录。');const controller=new AbortController(),boundary=new AbortController(),exportStarted=performance.now(),deadline=createExportDeadline(exportStarted);active.set(input.requestId,controller);budgets.set(input.requestId,{deadline,boundary});const executionLimit=setTimeout(()=>controller.abort('EXPORT_TIMEOUT'),deadline.remaining('execute')),hardLimit=setTimeout(()=>boundary.abort('EXPORT_TIMEOUT'),deadline.remaining('settle'));let idle:ReturnType<typeof setTimeout>|undefined;const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>controller.abort('EXPORT_COPY_IDLE_TIMEOUT'),120000);};let settled!:()=>void;const done=new Promise<void>(resolve=>settled=resolve);pending.add(done);running.set(input.requestId,done);
  const work=serializeDirectoryOperation(binding.root,async()=>{
   let p:PreparedExport|undefined,temp:string|undefined,handle:FileHandle|undefined,identity:{dev:string;ino:string}|undefined;
   const outcome=(value:ExportOutcome)=>{const settling=value.state==='completed',signal=settling?boundary.signal:controller.signal;cancelled(signal);return abortable(records.recordExportOutcome(value,{requestId:input.requestId,exportId:value.exportId,fixedRevision:input.revision,stage:value.state,deadlineMonotonicMs:settling?deadline.settlementDeadline:deadline.executionDeadline}),signal);};
   async function measured<T>(stage:string,work:()=>Promise<T>,bytes?:number):Promise<T>{const began=performance.now();let code:string|undefined;try{return await work();}catch(error){code=errorCode(error);throw error;}finally{if(p)traceExport(binding!.logRoot??binding!.root,contextFor(p,stage),'export.'+stage,performance.now()-began,code,bytes);}}
   try {cancelled(controller.signal);p=unwrap(await abortable(records.prepareExport(input,{requestId:input.requestId,fixedRevision:input.revision,stage:'prepare',deadlineMonotonicMs:deadline.executionDeadline}),controller.signal));if(!isPreparedExport(p)||snapshotHash(p)!==p.snapshotHash||p.receipt.libraryId!==binding.libraryId||p.receipt.projectId!==binding.projectId||p.receipt.requestId!==input.requestId||p.receipt.timelineId!==input.timelineId||p.receipt.revision!==input.revision||p.receipt.kind!==input.kind||p.receipt.renderJobId!==input.renderJobId)throw Error('EXPORT_SNAPSHOT_INVALID');cancelled(controller.signal);
    if(p.receipt.state==='completed')return ok(p.receipt);
    if(p.receipt.state==='cancelled'){
     const target=join(binding.root,p.receipt.relativePath),stat=await exists(target);
     if(p.receipt.hash&&p.temporary&&stat?.dev.toString()===p.temporary.dev&&stat.ino.toString()===p.temporary.ino){const dir=await checkParents(binding,p.receipt.kind,false);await cleanJournaledTemporary(dir,p,target);await verifyFile(target,{hash:p.receipt.hash,byteLength:p.receipt.byteLength},controller.signal);return await outcome({requestId:input.requestId,exportId:p.receipt.exportId,state:'completed',hash:p.receipt.hash,byteLength:p.receipt.byteLength,errorCode:null,publishedAfterCancellation:true});}
     if(p.temporary){const dir=join(binding.root,'exports',exportPolicy[p.receipt.kind].directory);if(await exists(temporaryPath(dir,p,p.temporary))){await checkParents(binding,p.receipt.kind,false);await cleanJournaledTemporary(dir,p);}}
     return ok(p.receipt);
    }
    const dir=await checkParents(binding,p.receipt.kind,true),target=join(binding.root,p.receipt.relativePath);
    if(p.receipt.hash!==null&&await exists(target)){await cleanJournaledTemporary(dir,p,target);await verifyFile(target,{hash:p.receipt.hash,byteLength:p.receipt.byteLength},controller.signal);cancelled(controller.signal);if(p.receipt.state!=='verified')p.receipt=unwrap(await outcome({requestId:input.requestId,exportId:p.receipt.exportId,state:'verified',hash:p.receipt.hash,byteLength:p.receipt.byteLength,errorCode:null}));return await outcome({requestId:input.requestId,exportId:p.receipt.exportId,state:'completed',hash:p.receipt.hash,byteLength:p.receipt.byteLength,errorCode:null,publishedAfterCancellation:true});}
    if(await exists(target))throw Error('EXPORT_TARGET_EXISTS');
    if(p.receipt.state==='verified')unwrap(await outcome({requestId:input.requestId,exportId:p.receipt.exportId,state:'failed',hash:p.receipt.hash,byteLength:p.receipt.byteLength,errorCode:'EXPORT_COPY_INTERRUPTED'}));
    await cleanJournaledTemporary(dir,p);
    // Random private attempt name avoids deleting or trusting leftovers from a crash.
    const temporaryId=randomUUID();temp=join(dir,`.export-${p.receipt.exportId}-${temporaryId}.partial`);await checkParents(binding,p.receipt.kind,false);cancelled(controller.signal);handle=await open(temp,'wx',0o600);const held=await handle.stat({bigint:true});identity={dev:held.dev.toString(),ino:held.ino.toString()};p.receipt=unwrap(await outcome({requestId:input.requestId,exportId:p.receipt.exportId,state:'copying',hash:null,byteLength:0,errorCode:null,temporary:{id:temporaryId,...identity}}));const hash=createHash('sha256');let count=0,lastReported=0;
    const copyStarted=performance.now();touch();for await(const bytes of contents(p,io,controller.signal,deadline)){cancelled(controller.signal);if(bytes.byteLength>block||count+bytes.byteLength>exportPolicy[p.receipt.kind].cap)throw Error('EXPORT_TOO_LARGE');let written=0;while(written<bytes.byteLength){cancelled(controller.signal);const n=await handle.write(bytes,written,bytes.byteLength-written,count+written);if(!n.bytesWritten)throw Error('EXPORT_WRITE_FAILED');written+=n.bytesWritten;}hash.update(bytes);count+=bytes.byteLength;touch();if(count-lastReported>=4*block){unwrap(await outcome({requestId:input.requestId,exportId:p.receipt.exportId,state:'copying',hash:null,byteLength:count,errorCode:null}));lastReported=count;}}
    traceExport(binding.logRoot??binding.root,contextFor(p,'copy'),'export.copy',performance.now()-copyStarted,undefined,count);clearTimeout(idle);await handle.sync();await handle.close();handle=undefined;cancelled(controller.signal);const expected={hash:hash.digest('hex'),byteLength:count};await measured('verify',()=>verifyFile(temp!,expected,controller.signal),count);await checkParents(binding,p.receipt.kind,false);cancelled(controller.signal);
    p.receipt=unwrap(await outcome({requestId:input.requestId,exportId:p.receipt.exportId,state:'verified',...expected,errorCode:null}));await checkParents(binding,p.receipt.kind,false);cancelled(controller.signal);
    // link is atomic and fails if ANY destination exists; rename would overwrite.
    await measured('publish',()=>link(temp!,target));await unlink(temp);temp=undefined;await checkParents(binding,p.receipt.kind,false);await measured('verify-published',()=>verifyFile(target,expected,boundary.signal),count);
    return await outcome({requestId:input.requestId,exportId:p.receipt.exportId,state:'completed',...expected,errorCode:null,publishedAfterCancellation:true});
   }catch(e){const code=controller.signal.aborted?(typeof controller.signal.reason==='string'?controller.signal.reason:'EXPORT_CANCELLED'):errorCode(e);if(p){
     const latest=boundary.signal.aborted?undefined:await abortable(records.prepareExport(input,{requestId:input.requestId,fixedRevision:input.revision,stage:'reconcile',deadlineMonotonicMs:deadline.settlementDeadline}),boundary.signal).catch(()=>undefined);if(latest?.ok)p=latest.value;
     if(p.receipt.state==='completed')return ok(p.receipt); // A verified receipt survives any ambiguous acknowledgement/publication failure.
     if(!boundary.signal.aborted&&(p.receipt.state!=='verified'||code==='EXPORT_CANCELLED'))await abortable(records.recordExportOutcome({requestId:input.requestId,exportId:p.receipt.exportId,state:code==='EXPORT_CANCELLED'?'cancelled':'failed',hash:p.receipt.hash,byteLength:p.receipt.byteLength,errorCode:code},contextFor(p,'reconcile-outcome',deadline.settlementDeadline)),boundary.signal).catch(()=>undefined);
    }return fail(code,'导出复制未完成；可用同一请求重试复制或核对发布。');
   }finally{clearTimeout(idle);if(handle)await handle.close().catch(()=>undefined);if(temp&&identity){try{const s=await lstat(temp,{bigint:true});if(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&s.dev.toString()===identity.dev&&s.ino.toString()===identity.ino)await unlink(temp);}catch{/* Lost directory is reported by the persisted operation. */}}}
  });
  const finish=()=>{traceExport(binding.logRoot??binding.root,{requestId:input.requestId,fixedRevision:input.revision,stage:'resources-settled',deadlineMonotonicMs:deadline.settlementDeadline},'export.resources',performance.now()-exportStarted);clearTimeout(executionLimit);clearTimeout(hardLimit);clearTimeout(idle);active.delete(input.requestId);budgets.delete(input.requestId);settled();pending.delete(done);running.delete(input.requestId);};
  void work.then(finish,finish);
  try{return await abortable(work,boundary.signal);}catch(error){return fail(errorCode(error),'导出等待已停止，结果待核对；请沿用同一请求核对。');}finally{traceExport(binding.logRoot??binding.root,{requestId:input.requestId,fixedRevision:input.revision,stage:'caller-returned',deadlineMonotonicMs:deadline.settlementDeadline},'export.total',performance.now()-exportStarted);}
 }
 async function cancelTimelineExport(input:unknown):Promise<Result<void>>{
  if(!isCancelTimelineExport(input))return fail('INVALID_INPUT','取消导出参数无效。');active.get(input.requestId)?.abort('EXPORT_CANCELLED');
  const budget=budgets.get(input.requestId),until=budget?.deadline.settlementDeadline??performance.now()+30000;
  if(until<=performance.now())return fail('EXPORT_TIMEOUT','取消结果待核对。');
  const stop=new AbortController(),timer=setTimeout(()=>stop.abort('EXPORT_TIMEOUT'),until-performance.now());
  try{const result=await abortable(records.cancelExport(input,{requestId:input.requestId,fixedRevision:0,stage:'cancel',deadlineMonotonicMs:until}),stop.signal);await abortable(running.get(input.requestId)??Promise.resolve(),stop.signal);return result;}catch(error){return fail(errorCode(error),'取消结果待核对。');}finally{clearTimeout(timer);}
 }
 return {exportTimeline,cancelTimelineExport,close():Promise<void>{closed=true;for(const c of active.values())c.abort();return Promise.allSettled([...pending]).then(()=>undefined);}};
}
