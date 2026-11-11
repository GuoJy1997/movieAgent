/** Per-library serial ownership for heavy native work; no detached execution. */
export function mediaWorkQueue(){
 let tail:Promise<unknown>=Promise.resolve(),closed=false;
 const owned=new Set<AbortController>();
 return {
  run<T>(operation:(signal:AbortSignal)=>Promise<T>,parent?:AbortSignal):Promise<T>{
   if(closed)return Promise.reject(Error('MEDIA_QUEUE_CLOSED'));
   const controller=new AbortController(),abort=()=>controller.abort();owned.add(controller);
   if(parent?.aborted)abort();else parent?.addEventListener('abort',abort,{once:true});
   const result=tail.then(()=>{if(controller.signal.aborted)throw Error('MEDIA_JOB_CANCELLED');return operation(controller.signal);}).finally(()=>{owned.delete(controller);parent?.removeEventListener('abort',abort);});
   tail=result.catch(()=>undefined);return result;
  },
  async close(){closed=true;for(const controller of owned)controller.abort();await tail;},
 };
}
