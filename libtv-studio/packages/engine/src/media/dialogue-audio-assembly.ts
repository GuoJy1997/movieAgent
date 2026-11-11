import type {MediaRuntime} from '../../../contracts/src/media-info.ts';
import {fail,ok,type Result} from '../../../contracts/src/result.ts';
import {compileMediaProcess,runMediaProcess,assertStagedFile} from './process.ts';
import {probeMediaFile,verifyAudioDecode} from './probe.ts';
import {hashMediaFile} from './verify.ts';
export async function assembleDialogueAudio(input:{runtime:MediaRuntime;inputs:{path:string;startTicks:number;allocatedTicks:number;durationTicks:number}[];durationTicks:number;output:string;stagingRoot:string;signal?:AbortSignal}):Promise<Result<{hash:string;mime:'audio/wav';byteLength:number;durationTicks:number;probeId:string}>>{
 const signal=input.signal??new AbortController().signal,items=input.inputs;
 if(!Number.isSafeInteger(input.durationTicks)||input.durationTicks<1||input.durationTicks>600*48000||items.length<1||items.length>16)return fail('INVALID_DIALOGUE_ASSEMBLY','合成时长或输入数量无效。');
 try{
  for(let i=0;i<items.length;i++){const item=items[i]!;await assertStagedFile(input.stagingRoot,item.path);if(!Number.isSafeInteger(item.startTicks)||item.startTicks<0||!Number.isSafeInteger(item.allocatedTicks)||item.allocatedTicks<1||item.startTicks+item.allocatedTicks>input.durationTicks||i>0&&items[i-1]!.startTicks+items[i-1]!.allocatedTicks>item.startTicks)return fail('INVALID_DIALOGUE_ASSEMBLY','配音时间区间无效。');
   const probe=await probeMediaFile(input.runtime,item.path,input.stagingRoot,'0'.repeat(64),signal);if(!probe.ok)return probe;
   if(!probe.value.hasAudio||probe.value.streams.some(s=>s.kind==='video')||probe.value.durationTicks!==item.durationTicks||item.durationTicks>item.allocatedTicks)return fail('AUDIO_TOO_LONG','某句配音时长变化或超出分配区间。');}
  const filters=items.map((item,i)=>'['+i+':a:0]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,adelay='+item.startTicks+'S:all=1[a'+i+']');
  filters.push(items.map((_,i)=>'[a'+i+']').join('')+'amix=inputs='+items.length+':normalize=0:dropout_transition=0,apad,atrim=end_sample='+input.durationTicks+'[out]');
  const args=['-v','error','-nostdin','-y','-xerror','-threads','4','-filter_complex_threads','1',...items.flatMap(item=>['-protocol_whitelist','file,pipe','-format_whitelist','wav,mp3,mov','-max_streams','4','-i',item.path]),'-filter_complex',filters.join(';'),'-map','[out]','-vn','-sn','-dn','-ac','1','-ar','48000','-c:a','pcm_s16le','-f','wav',input.output];
  const encoded=await runMediaProcess(compileMediaProcess({tool:'ffmpeg',runtime:input.runtime,stagingRoot:input.stagingRoot,timeoutMs:120000,maxStdoutBytes:4096,args}),signal);if(!encoded.ok)return encoded;
  const decoded=await verifyAudioDecode(input.runtime,input.output,input.stagingRoot);if(!decoded.ok)return decoded;
  const hash=await hashMediaFile(input.output,64*1024*1024,signal);if(!hash.ok)return hash;
  const probe=await probeMediaFile(input.runtime,input.output,input.stagingRoot,hash.value.hash,signal);if(!probe.ok)return probe;
  const stream=probe.value.streams.find(s=>s.kind==='audio');if(probe.value.durationTicks!==input.durationTicks||stream?.sampleRate!==48000||stream.channels!==1||stream.codec!=='pcm_s16le')return fail('AUDIO_ASSEMBLY_FAILED','合成时长或 PCM 格式验证失败。');
  return ok({hash:hash.value.hash,byteLength:hash.value.byteLength,durationTicks:input.durationTicks,mime:'audio/wav',probeId:probe.value.probeId});
 }catch{return fail('AUDIO_ASSEMBLY_FAILED','配音合成输入路径或媒体无效。');}
}
