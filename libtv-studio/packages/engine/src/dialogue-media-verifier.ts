import {randomUUID} from 'node:crypto';
import {mkdir,open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import type {LibraryHandle} from '../../storage/src/database.ts';
import type {assetsFor} from './asset-service.ts';
import type {MediaReference} from '../../contracts/src/assets.ts';
import type {MediaProbe,MediaRuntime,ReadLease} from '../../contracts/src/media-info.ts';
import {fail,ok,type Result} from '../../contracts/src/result.ts';
import {dialogueFrameRate,verifyDialogueRepair,type DialogueFrameRate} from './media/dialogue-repair.ts';
import type {mediaWorkQueue} from './media/work-queue.ts';
export function dialogueMediaVerifier(library:LibraryHandle,assets:ReturnType<typeof assetsFor>,queue:ReturnType<typeof mediaWorkQueue>,runtime?:MediaRuntime){
 return async(ref:MediaReference,hash:string,durationTicks:number,requireAudio=false,target?:{probeId:string;hash:string}):Promise<Result<void>>=>{
  try{return await queue.run(async signal=>{
   if(!runtime)return fail('MEDIA_RUNTIME_UNAVAILABLE','产物验收需要固定媒体运行时。');
   let fps:DialogueFrameRate|undefined;
   if(target){
    if(typeof target.probeId!=='string'||!target.probeId||typeof target.hash!=='string'||!/^[a-f0-9]{64}$/.test(target.hash))return fail('DIALOGUE_FRAME_RATE_REQUIRED','缺少固定来源视频的帧率记录。');
    const row=library.db.prepare('SELECT probe_json FROM media_probe WHERE probe_id=? AND object_hash=?').get(target.probeId,target.hash);
    const probe=row?JSON.parse(row.probe_json as string) as MediaProbe:undefined;
    if(!probe||probe.probeId!==target.probeId||probe.objectHash!==target.hash)return fail('DIALOGUE_FRAME_RATE_REQUIRED','缺少固定来源视频的帧率记录。');
    const rate=dialogueFrameRate(probe);if(!rate.ok)return rate;fps=rate.value;
   }else if(!requireAudio)return fail('DIALOGUE_FRAME_RATE_REQUIRED','修正版需要固定来源视频的帧率记录。');
   const root=join(library.root,'temp'),path=join(root,`dialogue-verify-${randomUUID()}.mp4`);let lease:ReadLease|undefined;
   const check=()=>{if(signal.aborted)throw Error('MEDIA_JOB_CANCELLED');};
   try{
    check();await mkdir(root,{recursive:true});const opened=await assets.openMediaRead(ref,hash);if(!opened.ok)return opened;lease=opened.value;
    if(lease.byteLength>64*1024*1024)return fail('OUTPUT_TOO_LARGE','产物超过64 MiB。');
    const target=await open(path,'wx',0o600);try{for(let offset=0;offset<lease.byteLength;){check();const chunk=await assets.readMediaRange({leaseId:lease.leaseId,offset,length:Math.min(1024*1024,lease.byteLength-offset)});if(!chunk.ok||!chunk.value.bytes.length)return fail('OBJECT_INTEGRITY_FAILED','产物读取失败。');check();await target.writeFile(chunk.value.bytes);offset+=chunk.value.bytes.length;}await target.sync();}finally{await target.close();}
    check();const result=await verifyDialogueRepair({runtime,path,stagingRoot:root,expectedDurationTicks:durationTicks,fps,requireAudio,signal});check();if(!result.ok)return result;
    return result.value.hash===hash?ok(undefined):fail('OBJECT_INTEGRITY_FAILED','产物固定 hash 不符。');
   }finally{if(lease)await assets.closeMediaRead(lease.leaseId);await unlink(path).catch(()=>undefined);}
  });}catch(error){return fail(error instanceof Error&&error.message==='MEDIA_JOB_CANCELLED'?'MEDIA_JOB_CANCELLED':'OUTPUT_VERIFICATION_FAILED','产物验收未完成。');}
 };
}
