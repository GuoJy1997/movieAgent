import {MAX_TIMELINE_VIDEO_CLIPS,MAX_TIMELINE_AUDIO_CLIPS_PER_TRACK} from './timeline-limits.ts';
import { isMediaReference, type MediaReference } from './assets.ts';
import { fail, isRecord, ok, type Result } from './result.ts';

export const TIMELINE_TIMEBASE = 48000;
export const MAX_TIMELINE_TICKS = 600 * TIMELINE_TIMEBASE;
export interface TimelineSettings { fps: { num: 24 | 25 | 30; den: 1 }; canvas: { width: 1920 | 1080; height: 1080 | 1920 } }
export interface ShotProvenance { shotId: string; shotRevision: number; selectionRevision: number; productionId: string | null; productionShotRevision: number | null }
interface ClipSource { id: string; media: MediaReference; sourceHash: string; sourceProbeId: string | null; sourceInTicks: number; startTicks: number; durationTicks: number; gainMilli: number; mute: boolean; dialogueGroupId?: string }
export interface VideoClip extends ClipSource { kind: 'video' | 'image'; fit: 'contain' | 'cover'; provenance?: ShotProvenance }
export interface AudioClip extends ClipSource { kind: 'audio'; sourceProbeId: string; track: 'voice' | 'music'; textSource?: { id: string; revision: number; segmentId?: string } }
export interface SubtitleCue { id: string; startTicks: number; endTicks: number; text: string; transcript?: { id: string; revision: number; segmentId: string } }
export interface SubtitleStyle { fontId: 'noto-sans-cjk-sc'; fontSize: number; color: string; bottomMargin: number; outline: number }
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = { fontId: 'noto-sans-cjk-sc', fontSize: 48, color: '#ffffff', bottomMargin: 60, outline: 2 };
export const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = { fps: { num: 30, den: 1 }, canvas: { width: 1920, height: 1080 } };
export interface TimelineRevision extends TimelineSettings { libraryId: string; projectId: string; id: string; revision: number; scriptRef: { id: string; revision: number }; title: string; timebase: 48000; videoClips: VideoClip[]; audioClips: AudioClip[]; subtitleCues: SubtitleCue[]; subtitleStyle: SubtitleStyle; createdAt: string }
export type TimelineOp =
 | { kind: 'insert'; clip: VideoClip | AudioClip }
 | { kind: 'move'; clipId: string; startTicks: number }
 | { kind: 'trim'; clipId: string; sourceInTicks: number; durationTicks: number }
 | { kind: 'split'; clipId: string; atTicks: number; operationId: string }
 | { kind: 'delete'; clipId: string }
 | { kind: 'unlinkDialogueGroup'; clipId: string }
 | { kind: 'rippleDelete'; clipId: string; operationId: string }
 | { kind: 'setGain'; clipId: string; gainMilli: number; mute: boolean }
 | { kind: 'setFit'; clipId: string; fit: 'contain' | 'cover' }
 | { kind: 'replaceMedia'; clipId: string; media: MediaReference; sourceHash: string; sourceProbeId: string | null; sourceInTicks: number; durationTicks: number }
 | { kind: 'setCue'; cue: SubtitleCue }
 | { kind: 'setSettings'; settings: TimelineSettings; subtitleStyle?: SubtitleStyle; title?: string };
export interface CreateTimelineInput { projectId: string; id: string; scriptRef: { id: string; revision: number }; title: string; settings: TimelineSettings }
export interface TimelineReadInput { projectId: string; timelineId: string; revision?: number }
export interface ApplyTimelineOpsInput { projectId: string; timelineId: string; expectedRevision: number; operations: TimelineOp[] }
export interface RestoreTimelineInput { projectId: string; timelineId: string; expectedRevision: number; sourceRevision: number; operations?: TimelineOp[] }
export interface TimelineList { libraryId: string; projectId: string; timelines: TimelineRevision[] }
export interface TimelineHistory { libraryId: string; projectId: string; timelineId: string; revisions: TimelineRevision[] }
export interface PrepareAssemblyInput { projectId: string; scriptRef: { id: string; revision: number }; shots: { id: string; revision: number; selectionRevision: number }[]; target: { id: string; expectedRevision: number }; allowImages: boolean; settings: TimelineSettings; executionOwner: string; runId: string }
export interface AssemblyDifference { shotId: string; intendedTicks: number; actualTicks: number; deltaTicks: number }
export interface PreparedAssembly extends PrepareAssemblyInput { libraryId: string; planId: string; planHash: string; expiresAt: number; draft: TimelineRevision; differences: AssemblyDifference[] }
export interface ApplyAssemblyInput { planId: string; planHash: string; executionOwner: string; runId: string }

const id = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
const integer = (x: unknown, min=0, max=Number.MAX_SAFE_INTEGER): x is number => Number.isSafeInteger(x) && (x as number)>=min && (x as number)<=max;
const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const fields = (x: Record<string,unknown>, required: string[], optional: string[]=[]) => required.every(k=>Object.hasOwn(x,k)) && Object.keys(x).every(k=>required.includes(k)||optional.includes(k));
export const timelinePayloadBounded = (x: unknown): boolean => { try { return new TextEncoder().encode(JSON.stringify(x)).byteLength <= 1024*1024; } catch { return false; } };
const fixed = (x: unknown): x is MediaReference => isMediaReference(x) && fields(x as unknown as Record<string,unknown>,x.kind==='artifact'?['kind','libraryId','artifactId']:['kind','libraryId','assetId','version']);
const ref = (x: unknown): x is {id:string;revision:number} => isRecord(x)&&fields(x,['id','revision'])&&id(x.id)&&integer(x.revision,1);
export function isTimelineSettings(x: unknown): x is TimelineSettings { return isRecord(x)&&fields(x,['fps','canvas'])&&isRecord(x.fps)&&fields(x.fps,['num','den'])&&[24,25,30].includes(x.fps.num as number)&&x.fps.den===1&&isRecord(x.canvas)&&fields(x.canvas,['width','height'])&&[[1920,1080],[1080,1920],[1080,1080]].some(([w,h])=>x.canvas && (x.canvas as Record<string,unknown>).width===w&&(x.canvas as Record<string,unknown>).height===h); }
export function isSubtitleStyle(x: unknown): x is SubtitleStyle { return isRecord(x)&&fields(x,['fontId','fontSize','color','bottomMargin','outline'])&&x.fontId==='noto-sans-cjk-sc'&&integer(x.fontSize,12,120)&&typeof x.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(x.color)&&integer(x.bottomMargin,0,400)&&integer(x.outline,0,10); }
function provenance(x: unknown): x is ShotProvenance { return isRecord(x)&&fields(x,['shotId','shotRevision','selectionRevision','productionId','productionShotRevision'])&&id(x.shotId)&&integer(x.shotRevision,1)&&integer(x.selectionRevision)&&((x.productionId===null&&x.productionShotRevision===null)||(id(x.productionId)&&integer(x.productionShotRevision,1))); }
const sourceKeys=['id','kind','media','sourceHash','sourceProbeId','sourceInTicks','startTicks','durationTicks','gainMilli','mute'];
function clipSource(x: Record<string,unknown>): boolean { return id(x.id)&&fixed(x.media)&&hash(x.sourceHash)&&(x.sourceProbeId===null||id(x.sourceProbeId))&&integer(x.sourceInTicks)&&integer(x.startTicks,0,MAX_TIMELINE_TICKS)&&integer(x.durationTicks,1,MAX_TIMELINE_TICKS)&&integer(Number(x.startTicks)+Number(x.durationTicks),1,MAX_TIMELINE_TICKS)&&integer(Number(x.sourceInTicks)+Number(x.durationTicks))&&integer(x.gainMilli,0,2000)&&typeof x.mute==='boolean'&&(x.dialogueGroupId===undefined||id(x.dialogueGroupId)); }
export function isVideoClip(x: unknown): x is VideoClip { return isRecord(x)&&fields(x,[...sourceKeys,'fit'],['provenance','dialogueGroupId'])&&clipSource(x)&&(x.kind==='video'&&id(x.sourceProbeId)||x.kind==='image'&&x.sourceProbeId===null&&x.sourceInTicks===0)&&(x.fit==='contain'||x.fit==='cover')&&(x.provenance===undefined||provenance(x.provenance)); }
export function isAudioClip(x: unknown): x is AudioClip { return isRecord(x)&&fields(x,[...sourceKeys,'track'],['textSource','dialogueGroupId'])&&clipSource(x)&&x.kind==='audio'&&id(x.sourceProbeId)&&(x.track==='voice'||x.track==='music')&&(x.textSource===undefined||isRecord(x.textSource)&&fields(x.textSource,['id','revision'],['segmentId'])&&id(x.textSource.id)&&integer(x.textSource.revision,1)&&(x.textSource.segmentId===undefined||id(x.textSource.segmentId))); }
export function isSubtitleCue(x: unknown): x is SubtitleCue { return isRecord(x)&&fields(x,['id','startTicks','endTicks','text'],['transcript'])&&id(x.id)&&integer(x.startTicks,0,MAX_TIMELINE_TICKS)&&integer(x.endTicks,1,MAX_TIMELINE_TICKS)&&x.endTicks>x.startTicks&&typeof x.text==='string'&&x.text.trim().length>0&&Array.from(x.text).length<=200&&!/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|\{[^}]*\}|\\[Nnh]/.test(x.text)&&(x.transcript===undefined||isRecord(x.transcript)&&fields(x.transcript,['id','revision','segmentId'])&&id(x.transcript.id)&&integer(x.transcript.revision,1)&&id(x.transcript.segmentId)); }
export function isTimelineOp(x: unknown): x is TimelineOp {
 if(!isRecord(x))return false;
 switch(x.kind){
 case 'insert':return fields(x,['kind','clip'])&&(isVideoClip(x.clip)||isAudioClip(x.clip));
 case 'move':return fields(x,['kind','clipId','startTicks'])&&id(x.clipId)&&integer(x.startTicks,0,MAX_TIMELINE_TICKS);
 case 'trim':return fields(x,['kind','clipId','sourceInTicks','durationTicks'])&&id(x.clipId)&&integer(x.sourceInTicks)&&integer(x.durationTicks,1,MAX_TIMELINE_TICKS);
 case 'split':return fields(x,['kind','clipId','atTicks','operationId'])&&id(x.clipId)&&id(x.operationId)&&integer(x.atTicks,1,MAX_TIMELINE_TICKS);
 case 'delete':return fields(x,['kind','clipId'])&&id(x.clipId);
 case 'unlinkDialogueGroup':return fields(x,['kind','clipId'])&&id(x.clipId);
 case 'rippleDelete':return fields(x,['kind','clipId','operationId'])&&id(x.clipId)&&id(x.operationId);
 case 'setGain':return fields(x,['kind','clipId','gainMilli','mute'])&&id(x.clipId)&&integer(x.gainMilli,0,2000)&&typeof x.mute==='boolean';
 case 'setFit':return fields(x,['kind','clipId','fit'])&&id(x.clipId)&&(x.fit==='contain'||x.fit==='cover');
 case 'replaceMedia':return fields(x,['kind','clipId','media','sourceHash','sourceProbeId','sourceInTicks','durationTicks'])&&id(x.clipId)&&fixed(x.media)&&hash(x.sourceHash)&&(x.sourceProbeId===null||id(x.sourceProbeId))&&integer(x.sourceInTicks)&&integer(x.durationTicks,1,MAX_TIMELINE_TICKS);
 case 'setCue':return fields(x,['kind','cue'])&&isSubtitleCue(x.cue);
 case 'setSettings':return fields(x,['kind','settings'],['subtitleStyle','title'])&&isTimelineSettings(x.settings)&&(x.subtitleStyle===undefined||isSubtitleStyle(x.subtitleStyle))&&(x.title===undefined||title(x.title));
 default:return false;
 }
}
const title=(x: unknown): x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
const bad=()=>fail('INVALID_INPUT','时间线字段、时钟、范围或大小无效。');
export function parseCreateTimeline(x: unknown): Result<CreateTimelineInput> { return isRecord(x)&&timelinePayloadBounded(x)&&fields(x,['projectId','id','scriptRef','title','settings'])&&id(x.projectId)&&id(x.id)&&ref(x.scriptRef)&&title(x.title)&&isTimelineSettings(x.settings)?ok(structuredClone(x) as unknown as CreateTimelineInput):bad(); }
export function parseApplyTimelineOps(x: unknown): Result<ApplyTimelineOpsInput> { return isRecord(x)&&timelinePayloadBounded(x)&&fields(x,['projectId','timelineId','expectedRevision','operations'])&&id(x.projectId)&&id(x.timelineId)&&integer(x.expectedRevision,1,Number.MAX_SAFE_INTEGER-1)&&Array.isArray(x.operations)&&x.operations.length<=100&&x.operations.every(isTimelineOp)?ok(structuredClone(x) as unknown as ApplyTimelineOpsInput):bad(); }
export function parseRestoreTimeline(x: unknown): Result<RestoreTimelineInput> { return isRecord(x)&&timelinePayloadBounded(x)&&fields(x,['projectId','timelineId','expectedRevision','sourceRevision'],['operations'])&&id(x.projectId)&&id(x.timelineId)&&integer(x.expectedRevision,1,Number.MAX_SAFE_INTEGER-1)&&integer(x.sourceRevision,1)&&(x.operations===undefined||Array.isArray(x.operations)&&x.operations.length<=100&&x.operations.every(isTimelineOp))?ok(structuredClone(x) as unknown as RestoreTimelineInput):bad(); }
export function parseTimelineList(x: unknown): Result<{projectId:string}> { return isRecord(x)&&fields(x,['projectId'])&&id(x.projectId)?ok({projectId:x.projectId}):bad(); }
export function parseTimelineRead(x: unknown): Result<TimelineReadInput> { return isRecord(x)&&fields(x,['projectId','timelineId'],['revision'])&&id(x.projectId)&&id(x.timelineId)&&(x.revision===undefined||integer(x.revision,1))?ok(structuredClone(x) as unknown as TimelineReadInput):bad(); }
export function parseTimelineHistory(x: unknown): Result<Omit<TimelineReadInput,'revision'>> { return isRecord(x)&&fields(x,['projectId','timelineId'])&&id(x.projectId)&&id(x.timelineId)?ok(structuredClone(x) as unknown as Omit<TimelineReadInput,'revision'>):bad(); }
export function parsePrepareAssembly(x: unknown): Result<PrepareAssemblyInput> { if(isRecord(x)&&Array.isArray(x.shots)&&x.shots.length>MAX_TIMELINE_VIDEO_CLIPS)return fail('TIMELINE_CAPACITY_EXCEEDED','粗剪画面片段 '+x.shots.length+' 超过上限 '+MAX_TIMELINE_VIDEO_CLIPS+'，请减少本次镜头数量。'); return isRecord(x)&&timelinePayloadBounded(x)&&fields(x,['projectId','scriptRef','shots','target','allowImages','settings','executionOwner','runId'])&&id(x.projectId)&&ref(x.scriptRef)&&Array.isArray(x.shots)&&x.shots.length>0&&x.shots.length<=MAX_TIMELINE_VIDEO_CLIPS&&x.shots.every(s=>isRecord(s)&&fields(s,['id','revision','selectionRevision'])&&id(s.id)&&integer(s.revision,1)&&integer(s.selectionRevision))&&new Set(x.shots.map(s=>s.id)).size===x.shots.length&&isRecord(x.target)&&fields(x.target,['id','expectedRevision'])&&id(x.target.id)&&integer(x.target.expectedRevision,0,Number.MAX_SAFE_INTEGER-1)&&typeof x.allowImages==='boolean'&&isTimelineSettings(x.settings)&&id(x.executionOwner)&&id(x.runId)?ok(structuredClone(x) as unknown as PrepareAssemblyInput):bad(); }
export function parseApplyAssembly(x: unknown): Result<ApplyAssemblyInput> { return isRecord(x)&&fields(x,['planId','planHash','executionOwner','runId'])&&id(x.planId)&&hash(x.planHash)&&id(x.executionOwner)&&id(x.runId)?ok(structuredClone(x) as unknown as ApplyAssemblyInput):bad(); }

function nonoverlap(list: {startTicks:number;durationTicks?:number;endTicks?:number}[]): boolean { const sorted=[...list].sort((a,b)=>a.startTicks-b.startTicks);return sorted.every((c,i)=>!i||sorted[i-1]!.startTicks+(sorted[i-1]!.durationTicks??sorted[i-1]!.endTicks!-sorted[i-1]!.startTicks)<=c.startTicks); }
/** Final-write policy is separate from historical structural readability. */
export function hasValidDialogueGroups(t:Pick<TimelineRevision,'videoClips'|'audioClips'>):boolean{
 const v=t.videoClips,a=t.audioClips;
 const groups=new Set([...v,...a].flatMap(c=>c.dialogueGroupId?[c.dialogueGroupId]:[]));
 for(const group of groups){
  const video=v.filter(c=>c.dialogueGroupId===group),audio=a.filter(c=>c.dialogueGroupId===group);
  if(video.length!==1||video[0]!.kind!=='video'||audio.length>1)return false;
  const picture=video[0]!;
  if(!audio.length){if(picture.mute)return false;}
  else {const sound=audio[0]!;if(!picture.mute||sound.mute||sound.track!=='voice'||sound.startTicks!==picture.startTicks||sound.durationTicks!==picture.durationTicks||sound.sourceInTicks!==picture.sourceInTicks)return false;}
 }return true;
}
export function isTimelineRevision(x: unknown): x is TimelineRevision {
 if(!isRecord(x)||!timelinePayloadBounded(x)||!fields(x,['libraryId','projectId','id','revision','scriptRef','title','fps','timebase','canvas','videoClips','audioClips','subtitleCues','subtitleStyle','createdAt'])||!id(x.libraryId)||!id(x.projectId)||!id(x.id)||!integer(x.revision,1)||!ref(x.scriptRef)||!title(x.title)||!isTimelineSettings({fps:x.fps,canvas:x.canvas})||x.timebase!==48000||!isSubtitleStyle(x.subtitleStyle)||typeof x.createdAt!=='string'||!Number.isFinite(Date.parse(x.createdAt)))return false;
 if(!Array.isArray(x.videoClips)||x.videoClips.length>MAX_TIMELINE_VIDEO_CLIPS||!x.videoClips.every(isVideoClip)||!Array.isArray(x.audioClips)||!x.audioClips.every(isAudioClip)||!Array.isArray(x.subtitleCues)||x.subtitleCues.length>1000||!x.subtitleCues.every(isSubtitleCue))return false;
 const v=x.videoClips as VideoClip[],a=x.audioClips as AudioClip[],s=x.subtitleCues as SubtitleCue[],frame=48000/(x.fps as TimelineSettings['fps']).num;
 return new Set([...v,...a,...s].map(c=>c.id)).size===v.length+a.length+s.length&&[...v,...a].every(c=>c.media.libraryId===x.libraryId)&&v.every(c=>c.startTicks%frame===0&&c.durationTicks%frame===0&&c.sourceInTicks%frame===0)&&s.every(c=>c.startTicks%frame===0&&c.endTicks%frame===0)&&nonoverlap(v)&&nonoverlap(s)&&(['voice','music'] as const).every(track=>{const clips=a.filter(c=>c.track===track);return clips.length<=MAX_TIMELINE_AUDIO_CLIPS_PER_TRACK&&nonoverlap(clips);});
}
export function isTimelineList(x: unknown): x is TimelineList { return isRecord(x)&&fields(x,['libraryId','projectId','timelines'])&&id(x.libraryId)&&id(x.projectId)&&Array.isArray(x.timelines)&&x.timelines.every(t=>isTimelineRevision(t)&&t.libraryId===x.libraryId&&t.projectId===x.projectId)&&new Set(x.timelines.map(t=>t.id)).size===x.timelines.length; }
export function isTimelineHistory(x: unknown): x is TimelineHistory { return isRecord(x)&&fields(x,['libraryId','projectId','timelineId','revisions'])&&id(x.libraryId)&&id(x.projectId)&&id(x.timelineId)&&Array.isArray(x.revisions)&&x.revisions.length>0&&x.revisions.every((r,i)=>isTimelineRevision(r)&&r.libraryId===x.libraryId&&r.projectId===x.projectId&&r.id===x.timelineId&&r.revision===i+1); }
export function isPreparedAssembly(x: unknown): x is PreparedAssembly {
 if(!isRecord(x))return false;
 const {libraryId,planId,planHash,expiresAt,draft,differences,...rawInput}=x;
 const parsed=parsePrepareAssembly(rawInput);if(!parsed.ok)return false;const input=parsed.value;
 return id(libraryId)&&id(planId)&&hash(planHash)&&integer(expiresAt,1)&&isTimelineRevision(draft)&&draft.libraryId===libraryId&&draft.projectId===input.projectId&&isRecord(input.target)&&draft.id===input.target.id&&draft.revision===Number(input.target.expectedRevision)+1&&JSON.stringify(draft.scriptRef)===JSON.stringify(input.scriptRef)&&JSON.stringify({fps:draft.fps,canvas:draft.canvas})===JSON.stringify(input.settings)&&Array.isArray(input.shots)&&draft.videoClips.length===input.shots.length&&draft.audioClips.every(a=>a.dialogueGroupId!==undefined&&draft.videoClips.some(v=>v.dialogueGroupId===a.dialogueGroupId&&v.startTicks===a.startTicks&&v.durationTicks===a.durationTicks))&&draft.subtitleCues.length===0&&draft.videoClips.every((c,i)=>c.provenance!==undefined&&c.provenance.shotId===input.shots[i]!.id&&c.provenance.shotRevision===input.shots[i]!.revision&&c.provenance.selectionRevision===input.shots[i]!.selectionRevision)&&Array.isArray(differences)&&differences.length===input.shots.length&&differences.every((d,i)=>isRecord(d)&&fields(d,['shotId','intendedTicks','actualTicks','deltaTicks'])&&d.shotId===draft.videoClips[i]?.provenance?.shotId&&integer(d.intendedTicks,1)&&d.actualTicks===draft.videoClips[i]?.durationTicks&&integer(d.actualTicks,1)&&Number.isSafeInteger(d.deltaTicks)&&d.deltaTicks===d.actualTicks-d.intendedTicks);
}
