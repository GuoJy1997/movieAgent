export const MAX_TIMELINE_VIDEO_CLIPS=256;
export const MAX_TIMELINE_AUDIO_CLIPS_PER_TRACK=256;
export const MAX_RENDER_MANIFEST_ENTRIES=768;
export const MAX_DERIVED_MEDIA_REFERENCES=64;
export interface TimelineCapacityIssue {limitKind:'videoClips'|'voiceClips'|'musicClips'|'payloadBytes';limit:number;actual:number}
export function timelineCapacityIssue(t:{videoClips:readonly unknown[];audioClips:readonly {track:string}[]}):TimelineCapacityIssue|null{
 if(t.videoClips.length>MAX_TIMELINE_VIDEO_CLIPS)return {limitKind:'videoClips',limit:MAX_TIMELINE_VIDEO_CLIPS,actual:t.videoClips.length};
 for(const track of ['voice','music'] as const){const actual=t.audioClips.filter(c=>c.track===track).length;if(actual>MAX_TIMELINE_AUDIO_CLIPS_PER_TRACK)return {limitKind:track==='voice'?'voiceClips':'musicClips',limit:MAX_TIMELINE_AUDIO_CLIPS_PER_TRACK,actual};}
 const actual=new TextEncoder().encode(JSON.stringify(t)).byteLength;return actual>1024*1024?{limitKind:'payloadBytes',limit:1024*1024,actual}:null;
}
export const capacityMessage=(issue:TimelineCapacityIssue)=>({'videoClips':'画面片段','voiceClips':'配音片段','musicClips':'音乐片段','payloadBytes':'时间线字节数'}[issue.limitKind]+'超过上限 '+issue.limit+'（当前 '+issue.actual+'）。请删除部分内容或分成另一条时间线。');
