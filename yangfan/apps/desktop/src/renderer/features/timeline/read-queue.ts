/** Bound a complete authorized read, including an RPC that cannot be cancelled mid-flight. */
export function createReadQueue(limit=4,observe?:(stats:{active:number;queued:number})=>void){
 if(!Number.isSafeInteger(limit)||limit<1)throw new RangeError('Invalid read concurrency');
 let active=0;const waiting:(()=>void)[]=[];
 const report=()=>{try{observe?.({active,queued:waiting.length});}catch{/* Diagnostics cannot fail a read. */}};
 const drain=()=>{while(active<limit&&waiting.length)waiting.shift()!();};
 return {run<T>(signal:AbortSignal,task:()=>Promise<T>):Promise<T>{return new Promise<T>((resolve,reject)=>{
  const aborted=()=>signal.reason??new DOMException('Aborted','AbortError');
  if(signal.aborted){reject(aborted());return;}
  let queued=true;
  const cancel=()=>{if(!queued)return;const index=waiting.indexOf(start);if(index>=0)waiting.splice(index,1);signal.removeEventListener('abort',cancel);report();reject(aborted());};
  const start=()=>{queued=false;signal.removeEventListener('abort',cancel);if(signal.aborted){report();reject(aborted());return;}active++;report();void Promise.resolve().then(task).then(resolve,reject).finally(()=>{active--;drain();report();});};
  signal.addEventListener('abort',cancel,{once:true});waiting.push(start);drain();report();
 });}};
}
