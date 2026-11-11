import {timelineCapacityIssue,capacityMessage} from '../../contracts/src/timeline-limits.ts';
import { isTimelineRevision, isTimelineOp, timelinePayloadBounded, type TimelineRevision, type TimelineOp, type VideoClip, type AudioClip, type SubtitleCue } from '../../contracts/src/timeline.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import {hasValidDialogueGroups} from '../../contracts/src/timeline.ts';

// FNV-1a over the operation identity and original ID is deterministic and browser-safe.
export function timelineSegmentId(operationId:string,id:string): string {let h=2166136261;for(const c of `${operationId}/${id}`){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return `segment_${(h>>>0).toString(16)}_${id.slice(0,96)}`;}
type Clip=VideoClip|AudioClip;
export function applyTimelineOps(current: TimelineRevision, operations: TimelineOp[]): Result<TimelineRevision> {
 if(!isTimelineRevision(current)||!Array.isArray(operations)||operations.length>100||!timelinePayloadBounded(operations)||!operations.every(isTimelineOp))return fail('INVALID_INPUT','时间线操作无效或超过上限。');
 const t=structuredClone(current),hasContent=current.videoClips.length+current.audioClips.length+current.subtitleCues.length>0;
 const missing=()=>fail('CLIP_NOT_FOUND','时间线中没有此片段或字幕。');
 for(const op of operations){
  if(op.kind==='insert'){if(op.clip.kind==='audio')t.audioClips.push(structuredClone(op.clip));else t.videoClips.push(structuredClone(op.clip));continue;}
  if(op.kind==='setCue'){const i=t.subtitleCues.findIndex(c=>c.id===op.cue.id);if(i<0)t.subtitleCues.push(structuredClone(op.cue));else t.subtitleCues[i]=structuredClone(op.cue);continue;}
  if(op.kind==='setSettings'){if((hasContent||t.videoClips.length+t.audioClips.length+t.subtitleCues.length>0)&&op.settings.fps.num!==t.fps.num)return fail('FPS_LOCKED','已有内容的时间线不能修改帧率。');t.fps=structuredClone(op.settings.fps);t.canvas=structuredClone(op.settings.canvas);if(op.subtitleStyle)t.subtitleStyle=structuredClone(op.subtitleStyle);if(op.title!==undefined)t.title=op.title;continue;}
  const clip=[...t.videoClips,...t.audioClips].find(c=>c.id===op.clipId),cue=t.subtitleCues.find(c=>c.id===op.clipId);
  if(op.kind==='unlinkDialogueGroup'){if(!clip?.dialogueGroupId)return fail('INVALID_INPUT','此片段没有可取消的对白关联。');const groupId=clip.dialogueGroupId;for(const linked of [...t.videoClips,...t.audioClips])if(linked.dialogueGroupId===groupId)delete linked.dialogueGroupId;continue;}
  if(clip?.dialogueGroupId&&['move','trim','split','delete'].includes(op.kind)){
   const group=[...t.videoClips,...t.audioClips].filter(c=>c.dialogueGroupId===clip.dialogueGroupId);
   if(op.kind==='delete'){t.videoClips=t.videoClips.filter(c=>c.dialogueGroupId!==clip.dialogueGroupId);t.audioClips=t.audioClips.filter(c=>c.dialogueGroupId!==clip.dialogueGroupId);continue;}
   if(op.kind==='move'){const delta=op.startTicks-clip.startTicks;for(const linked of group)linked.startTicks+=delta;continue;}
   if(op.kind==='trim'){for(const linked of group){linked.sourceInTicks=op.sourceInTicks;linked.durationTicks=op.durationTicks;}continue;}
   if(op.kind==='split'){
    const offset=op.atTicks-clip.startTicks;if(offset<=0||offset>=clip.durationTicks)return fail('INVALID_INPUT','分割点必须在关联片段内部。');
    const rightGroupId=timelineSegmentId(op.operationId,clip.dialogueGroupId);
    for(const linked of group){const right={...linked,id:timelineSegmentId(op.operationId,linked.id),dialogueGroupId:rightGroupId,startTicks:op.atTicks,sourceInTicks:linked.kind==='image'?0:linked.sourceInTicks+offset,durationTicks:linked.durationTicks-offset};linked.durationTicks=offset;if(right.kind==='audio')t.audioClips.push(right);else t.videoClips.push(right);}continue;
   }
  }
  if(op.kind==='delete'){if(!clip&&!cue)return missing();t.videoClips=t.videoClips.filter(c=>c.id!==op.clipId);t.audioClips=t.audioClips.filter(c=>c.id!==op.clipId);t.subtitleCues=t.subtitleCues.filter(c=>c.id!==op.clipId);continue;}
  if(op.kind==='move'){if(clip)clip.startTicks=op.startTicks;else if(cue){const d=cue.endTicks-cue.startTicks;cue.startTicks=op.startTicks;cue.endTicks=op.startTicks+d;}else return missing();continue;}
  if(op.kind==='rippleDelete'){
   if(!clip||clip.kind==='audio')return fail('INVALID_INPUT','波纹删除需要一个视频轨片段。');
   const s=clip.startTicks,e=s+clip.durationTicks,d=e-s;
   function cut<C extends Clip>(items:C[]):C[]{return items.flatMap(c=>{const a=c.startTicks,b=a+c.durationTicks;if(b<=s)return[c];if(a>=e)return[{...c,startTicks:a-d}];const left=a<s?{...c,durationTicks:s-a}:null;const right=b>e?{...c,id:left?timelineSegmentId(op.kind==='rippleDelete'?op.operationId:'',c.id):c.id,startTicks:s,sourceInTicks:c.kind==='image'?0:c.sourceInTicks+e-a,durationTicks:b-e}:null;return [left,right].filter((x):x is C=>x!==null);});}
   function cues(items:SubtitleCue[]):SubtitleCue[]{return items.flatMap(c=>{const a=c.startTicks,b=c.endTicks;if(b<=s)return[c];if(a>=e)return[{...c,startTicks:a-d,endTicks:b-d}];const left=a<s?{...c,endTicks:s}:null,right=b>e?{...c,id:left?timelineSegmentId(op.kind==='rippleDelete'?op.operationId:'',c.id):c.id,startTicks:s,endTicks:b-d}:null;return[left,right].filter((x):x is SubtitleCue=>x!==null);});}
   t.videoClips=cut(t.videoClips);t.audioClips=cut(t.audioClips);t.subtitleCues=cues(t.subtitleCues);continue;
  }
  if(op.kind==='split'){
   if(clip){const offset=op.atTicks-clip.startTicks;if(offset<=0||offset>=clip.durationTicks)return fail('INVALID_INPUT','分割点必须在片段内部。');const right={...clip,id:timelineSegmentId(op.operationId,clip.id),startTicks:op.atTicks,sourceInTicks:clip.kind==='image'?0:clip.sourceInTicks+offset,durationTicks:clip.durationTicks-offset};clip.durationTicks=offset;if(right.kind==='audio')t.audioClips.push(right);else t.videoClips.push(right);}
   else if(cue){if(op.atTicks<=cue.startTicks||op.atTicks>=cue.endTicks)return fail('INVALID_INPUT','分割点必须在字幕内部。');t.subtitleCues.push({...cue,id:timelineSegmentId(op.operationId,cue.id),startTicks:op.atTicks});cue.endTicks=op.atTicks;}else return missing();continue;
  }
  if(!clip)return missing();
  if(op.kind==='trim'){clip.sourceInTicks=op.sourceInTicks;clip.durationTicks=op.durationTicks;}
  else if(op.kind==='setGain'){clip.gainMilli=op.gainMilli;clip.mute=op.mute;}
  else if(op.kind==='setFit'){if(clip.kind==='audio')return fail('INVALID_INPUT','音频不支持画面适配。');clip.fit=op.fit;}
  else if(op.kind==='replaceMedia'){if(clip.dialogueGroupId)return fail('DIALOGUE_GROUP_REPLACE_REQUIRED','请用完整对白版本替换关联组，不能只替换其中一路媒体。');clip.media=structuredClone(op.media);clip.sourceHash=op.sourceHash;clip.sourceProbeId=op.sourceProbeId as never;clip.sourceInTicks=op.sourceInTicks;clip.durationTicks=op.durationTicks;if(clip.kind!=='audio')delete clip.provenance;}
 }
 t.videoClips.sort((a,b)=>a.startTicks-b.startTicks||a.id.localeCompare(b.id));t.audioClips.sort((a,b)=>a.track.localeCompare(b.track)||a.startTicks-b.startTicks||a.id.localeCompare(b.id));t.subtitleCues.sort((a,b)=>a.startTicks-b.startTicks||a.id.localeCompare(b.id));
 const capacity=timelineCapacityIssue(t);if(capacity)return fail('INVALID_TIMELINE',capacityMessage(capacity));
 return isTimelineRevision(t)&&hasValidDialogueGroups(t)?ok(t):fail('INVALID_TIMELINE','最终时间线存在重叠、未对齐边界、时长、对白声音或片段上限错误。');
}
