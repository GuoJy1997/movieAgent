import {open,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
export interface ExportTraceContext {requestId:string;exportId?:string;fixedRevision:number;stage:string;deadlineMonotonicMs?:number}
export const EXPORT_RPC_TIMEOUTS:Readonly<Record<string,number>>={'timeline.prepareExportInternal':60000,'timeline.recordExportOutcomeInternal':30000,'timeline.cancelExportInternal':30000,'media.openInternal':120000,'media.derivedOpenInternal':120000,'media.rangeInternal':30000,'media.derivedRangeInternal':30000,'media.closeInternal':10000,'media.derivedCloseInternal':10000};
export function createExportDeadline(startedAtMs=performance.now()){
 const executionDeadline=startedAtMs+1680000,settlementDeadline=startedAtMs+1800000;
 return {executionDeadline,settlementDeadline,remaining(phase:'execute'|'settle'){return Math.max(0,(phase==='execute'?executionDeadline:settlementDeadline)-performance.now());}};
}
export type ExportDeadline=ReturnType<typeof createExportDeadline>;
export function exportRpcTimeout(kind:string,context:ExportTraceContext):number{
 const cap=EXPORT_RPC_TIMEOUTS[kind]??5000;
 return context.deadlineMonotonicMs===undefined?cap:Number.isFinite(context.deadlineMonotonicMs)?Math.max(0,Math.min(cap,context.deadlineMonotonicMs-performance.now())):0;
}
let queued=0;
export function traceExport(root:string,context:ExportTraceContext,kind:string,elapsedMs:number,errorCode?:string,bytes?:number):void{
 if(queued>=32)return;queued++;
 void(async()=>{try{
  const dir=join(root,'logs'),resolved=await realpath(dir);if(resolved.toLowerCase()!==dir.toLowerCase()||(await lstat(dir)).isSymbolicLink())return;
  const file=join(dir,'timeline-export-rpc.jsonl');const st=await lstat(file).catch(()=>undefined);if(st&&(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>=2*1024*1024))return;
  const handle=await open(file,'a',0o600);try{const held=await handle.stat(),current=await lstat(file);if(current.isSymbolicLink()||!held.isFile()||held.nlink!==1||held.ino!==current.ino||held.dev!==current.dev||held.size>=2*1024*1024||(await realpath(file)).toLowerCase()!==file.toLowerCase())return;await handle.write(JSON.stringify({requestId:context.requestId,exportId:context.exportId,fixedRevision:context.fixedRevision,stage:context.stage,kind,startedMs:Math.round(performance.now()-elapsedMs),endedMs:Math.round(performance.now()),elapsedMs:Math.round(elapsedMs),...(context.deadlineMonotonicMs===undefined?{}:{remainingMs:Math.max(0,Math.round(context.deadlineMonotonicMs-performance.now()))}),...(bytes===undefined?{}:{bytes}),...(errorCode?{errorCode}:{})})+'\n');}finally{await handle.close();}
 }catch{}finally{queued--;}})();
}
