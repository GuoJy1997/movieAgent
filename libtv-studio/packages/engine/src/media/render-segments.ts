import {randomUUID} from 'node:crypto';
import {open,writeFile,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fail,ok,type Result} from '../../../contracts/src/result.ts';
import type {RenderPlan,ResolvedMediaManifest} from '../../../contracts/src/render.ts';
import type {MediaRuntime} from '../../../contracts/src/media-info.ts';
import type {TimelineRevision} from '../../../contracts/src/timeline.ts';
import {compileMediaProcess,runMediaProcess,type ProcessOutcome} from './process.ts';
export const DEFAULT_SEGMENT_BUDGET=2*1024**3,MAX_SEGMENT_BUDGET=8*1024**3;
export interface RenderWindow {startTicks:number;endTicks:number;indices:number[]}
export type SingleRenderer=(p:RenderPlan,r:MediaRuntime,d:string,i:string[],o:string,s:AbortSignal,progress?:((ticks:number)=>void),mode?:'pcm-segment'|'video-segment')=>Promise<Result<ProcessOutcome>>;
const refKey=(ref:unknown)=>JSON.stringify(ref);
export function segmentRenderPlan(plan:RenderPlan):Result<RenderWindow[]>{
 const frame=48000/plan.timeline.fps.num,map=new Map(plan.manifest.entries.map((e,i)=>[refKey(e.ref),i]));
 const clips=[...plan.timeline.videoClips,...plan.timeline.audioClips];
 const points=new Set<number>([0,plan.durationTicks]);
 for(let t=30*48000;t<plan.durationTicks;t+=30*48000)points.add(t);
 for(const c of clips)for(const t of [c.startTicks,c.startTicks+c.durationTicks]){points.add(Math.max(0,Math.min(plan.durationTicks,Math.floor(t/frame)*frame)));points.add(Math.max(0,Math.min(plan.durationTicks,Math.ceil(t/frame)*frame)));}
 const sorted=[...points].sort((a,b)=>a-b),windows:RenderWindow[]=[];
 const inputs=(start:number,end:number)=>[...new Set(clips.filter(c=>c.startTicks<end&&c.startTicks+c.durationTicks>start).map(c=>map.get(refKey(c.media))!))];
 let start=0;while(start<plan.durationTicks){
  let end=start,indices:number[]=[];for(const candidate of sorted){if(candidate<=start)continue;if(candidate-start>30*48000)break;const refs=inputs(start,candidate);if(refs.length>32)break;end=candidate;indices=refs;}
  if(end===start)return fail('MEDIA_INPUT_DENSITY_LIMIT','单帧区间超过32个独立输入，请合并过密音频或减少片段密度。');
  windows.push({startTicks:start,endTicks:end,indices});start=end;
 }
 return ok(windows);
}
export function windowTimeline(t:TimelineRevision,start:number,end:number):TimelineRevision{
 const crop=<T extends TimelineRevision['videoClips'][number]|TimelineRevision['audioClips'][number]>(c:T):T=>{const left=Math.max(start,c.startTicks),right=Math.min(end,c.startTicks+c.durationTicks);return {...c,startTicks:left-start,durationTicks:right-left,sourceInTicks:c.kind==='image'?0:c.sourceInTicks+left-c.startTicks};};
 return {...t,videoClips:t.videoClips.filter(c=>c.startTicks<end&&c.startTicks+c.durationTicks>start).map(crop),audioClips:t.audioClips.filter(c=>c.startTicks<end&&c.startTicks+c.durationTicks>start).map(crop),subtitleCues:t.subtitleCues.filter(c=>c.startTicks<end&&c.endTicks>start).map(c=>({...c,startTicks:Math.max(start,c.startTicks)-start,endTicks:Math.min(end,c.endTicks)-start}))};
}
async function appendRaw(from:string,to:Awaited<ReturnType<typeof open>>,signal:AbortSignal):Promise<void>{
 const input=await open(from,'r');try{const buffer=Buffer.alloc(1024*1024);let offset=0;for(;;){if(signal.aborted)throw Error('MEDIA_CANCELLED');const r=await input.read(buffer,0,buffer.length,offset);if(!r.bytesRead)break;offset+=r.bytesRead;let n=0;while(n<r.bytesRead){const w=await to.write(buffer,n,r.bytesRead-n);if(!w.bytesWritten)throw Error('MEDIA_WRITE_FAILED');n+=w.bytesWritten;}}}finally{await input.close();}
}
export async function renderSegmentedMedia(plan:RenderPlan,runtime:MediaRuntime,root:string,inputs:string[],output:string,signal:AbortSignal,single:SingleRenderer,onProgress?:(ticks:number)=>void,budget=DEFAULT_SEGMENT_BUDGET):Promise<Result<ProcessOutcome>>{
 const windows=segmentRenderPlan(plan);if(!windows.ok)return windows;
 if(!Number.isSafeInteger(budget)||budget<=0||budget>MAX_SEGMENT_BUDGET)return fail('MEDIA_STAGING_BUDGET','临时文件预算无效。');
 const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),1800000),combined=AbortSignal.any([signal,deadline.signal]);
 const owned:string[]=[];let raw:Awaited<ReturnType<typeof open>>|undefined;let bytes=0;
 try{
  if(combined.aborted)return fail('MEDIA_CANCELLED','渲染已取消。');
  const prefix='segments-'+randomUUID(),audioName=prefix+'-audio.f32',listName=prefix+'.txt';
  const audio=join(root,audioName);raw=await open(audio,'wx',0o600);owned.push(audio);
  const videoNames:string[]=[];
  for(let i=0;i<windows.value.length;i++){
   const w=windows.value[i]!,duration=w.endTicks-w.startTicks;
   const manifest:ResolvedMediaManifest={...plan.manifest,entries:w.indices.map(n=>plan.manifest.entries[n]!)};
   const local:RenderPlan={...plan,timeline:windowTimeline(plan.timeline,w.startTicks,w.endTicks),manifest,durationTicks:duration};
   const paths=w.indices.map(n=>inputs[n]!);
   const videoAllowance=budget-bytes-duration*16;
   if(videoAllowance<=0)return fail('MEDIA_STAGING_BUDGET','临时文件达到预算，请提高磁盘预算后重试。');
   if(plan.purpose!=='wav'){
    const name=prefix+'-'+i+'.mp4',path=join(root,name);owned.push(path);videoNames.push(name);
    const video=await single({...local,maxOutputBytes:Math.min(local.maxOutputBytes,videoAllowance)},runtime,root,paths,path,combined,t=>onProgress?.(w.startTicks+Math.floor(Math.min(t,duration)/2)),'video-segment');if(!video.ok)return video.error.code==='OUTPUT_TOO_LARGE'&&videoAllowance<local.maxOutputBytes?fail('MEDIA_STAGING_BUDGET','临时文件达到预算，请提高磁盘预算后重试。'):video;
    bytes+=(await stat(path)).size;
   }
   const pcm=join(root,prefix+'-'+i+'.f32');owned.push(pcm);
   const a=await single({...local,purpose:'wav',burnSubtitles:undefined},runtime,root,paths,pcm,combined,t=>onProgress?.(w.startTicks+(plan.purpose==='wav'?Math.min(t,duration):Math.floor((duration+Math.min(t,duration))/2))),'pcm-segment');if(!a.ok)return a;
   if((await stat(pcm)).size!==duration*8)return fail('MEDIA_AUDIO_LENGTH','分段音频采样数不符。');
   // Account for peak duplication while copying raw PCM, and all retained video segments.
   bytes+=duration*8;if(bytes+duration*8>budget)return fail('MEDIA_STAGING_BUDGET','临时文件达到预算，请提高磁盘预算后重试。');
   await appendRaw(pcm,raw,combined);await unlink(pcm);owned.splice(owned.indexOf(pcm),1);
  }
  await raw.sync();await raw.close();raw=undefined;
  if((await stat(audio)).size!==plan.durationTicks*8)return fail('MEDIA_AUDIO_LENGTH','整集音频采样数不符。');
  const args=['-hide_banner','-nostdin','-y','-v','info','-xerror','-threads','4'];
  if(plan.purpose!=='wav'){
   const list=join(root,listName);await writeFile(list,videoNames.map(name=>"file '"+name+"'").join('\n')+'\n',{mode:0o600});owned.push(list);
   args.push('-protocol_whitelist','file','-f','concat','-safe','1','-i',listName);
  }
  args.push('-protocol_whitelist','file','-f','f32le','-ar','48000','-ac','2','-i',audioName);
  const index=plan.purpose==='wav'?0:1;
  args.push('-map',index+':a:0','-af','alimiter=limit=0.95:level=0:latency=1,apad,atrim=end_sample='+plan.durationTicks+',asetpts=N/SR/TB');
  if(plan.purpose==='wav')args.push('-vn','-c:a','pcm_s16le','-f','wav');
  else args.push('-map','0:v:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart','-video_track_timescale','48000','-f','mp4');
  args.push('-t',String(plan.durationTicks/48000),'-fs',String(plan.maxOutputBytes+1),'-progress','pipe:1','-nostats',output);
  const result=await runMediaProcess(compileMediaProcess({tool:'ffmpeg',runtime,stagingRoot:root,timeoutMs:1800000,maxStdoutBytes:1024*1024,args}),combined);
  if(deadline.signal.aborted&&!signal.aborted)return fail('MEDIA_PROCESS_TIMEOUT','整次渲染超过30分钟。');
  if(result.ok&&(await stat(output)).size>plan.maxOutputBytes)return fail('OUTPUT_TOO_LARGE','渲染产物超出上限。');
  return result;
 }catch(e){return fail(combined.aborted?'MEDIA_CANCELLED':e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'MEDIA_RENDER_FAILED','本地分段渲染失败，原件保留。');}
 finally{clearTimeout(timer);await raw?.close().catch(()=>undefined);for(const file of owned)await unlink(file).catch(()=>undefined);}
}
