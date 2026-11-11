import type { MediaProbe } from '../../contracts/src/media-info.ts';
import type { TimelineRevision, TimelineSettings, VideoClip } from '../../contracts/src/timeline.ts';
export function frameTicks(fps: number | TimelineSettings['fps']): number { const num=typeof fps==='number'?fps:fps.num,den=typeof fps==='number'?1:fps.den;if(den!==1||![24,25,30].includes(num))throw Error('UNSUPPORTED_FPS');return 48000/num; }
export function alignFrameUp(ticks: number, fps: TimelineSettings['fps']): number { if(!Number.isSafeInteger(ticks)||ticks<0)throw Error('INVALID_TIME');const value=Math.ceil(ticks/frameTicks(fps))*frameTicks(fps);if(!Number.isSafeInteger(value))throw Error('INVALID_TIME');return value; }
export function timelineEndTicks(t: TimelineRevision): number { return alignFrameUp(Math.max(0,...t.videoClips.map(c=>c.startTicks+c.durationTicks),...t.audioClips.map(c=>c.startTicks+c.durationTicks),...t.subtitleCues.map(c=>c.endTicks)),t.fps); }
export function timelineWarnings(t: TimelineRevision): {code:'BLACK_VIDEO_TAIL';startTicks:number;endTicks:number}[] {const end=timelineEndTicks(t),videoEnd=Math.max(0,...t.videoClips.map(c=>c.startTicks+c.durationTicks));return end>videoEnd?[{code:'BLACK_VIDEO_TAIL',startTicks:videoEnd,endTicks:end}]:[];}
export function validateRenderContent(t: TimelineRevision, format: 'mp4'|'wav', hasVideoAudio: (clip:VideoClip)=>boolean = ()=>false): boolean {if(timelineEndTicks(t)===0)return false;if(format==='mp4')return t.videoClips.length>0;return t.audioClips.some(c=>!c.mute&&c.gainMilli>0)||t.videoClips.some(c=>c.kind==='video'&&!c.mute&&c.gainMilli>0&&hasVideoAudio(c));}

/** End of the relevant stream on the shared normalization origin. */
export function mediaStreamEndTicks(probe:MediaProbe,kind:'video'|'audio'):number {return Math.min(probe.durationTicks,Math.max(0,...probe.streams.filter(s=>s.kind===kind).map(s=>Math.round((s.startSeconds-probe.originSeconds)*48000)+s.durationTicks)));}
