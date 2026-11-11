import {expect,it} from 'vitest';
import {mediaWorkQueue} from '../../packages/engine/src/media/work-queue.ts';
it('serializes heavy work, cancels waiting work without spawning and drains active shutdown',async()=>{
 const queue=mediaWorkQueue();let release!:()=>void;const held=new Promise<void>(r=>release=r),seen:string[]=[];
 const first=queue.run(async signal=>{seen.push('first');await held;expect(signal.aborted).toBe(true);});
 const waiting=new AbortController();const second=queue.run(async()=>{seen.push('second');},waiting.signal);waiting.abort();
 await Promise.resolve();expect(seen).toEqual(['first']);const closed=queue.close();release();await first;await expect(second).rejects.toThrow('MEDIA_JOB_CANCELLED');await closed;expect(seen).toEqual(['first']);
 await expect(queue.run(async()=>{})).rejects.toThrow('MEDIA_QUEUE_CLOSED');
});
