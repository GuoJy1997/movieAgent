import {MAX_RENDER_MANIFEST_ENTRIES} from './timeline-limits.ts';
import { isRecord } from './result.ts';
import { isMediaReference, type MediaReference } from './assets.ts';
import { isTimelineRevision, type TimelineRevision } from './timeline.ts';
export type ExportKind = 'mp4' | 'wav' | 'srt' | 'csv' | 'sources';
export type ExportState = 'prepared' | 'copying' | 'verified' | 'completed' | 'failed' | 'cancelled';
export interface ExportTimelineInput { requestId:string; projectId:string; timelineId:string; revision:number; kind:ExportKind; renderJobId?:string }
export interface ExportReceipt extends ExportTimelineInput { libraryId:string; exportId:string; relativePath:string; state:ExportState; byteLength:number; hash:string|null; errorCode:string|null }
export interface ExportSnapshot { libraryId:string; projectId:string; timelineId:string; exports:ExportReceipt[] }
export interface ExportSource { ref:MediaReference; hash:string; byteLength:number; mime:string; filename:string }
import {isDialogueTurn} from './character-voice.ts';
export interface ExportStoryboardVoice { takeId:string; voiceRef:{id:string;revision:number}; dialogueRef:{id:string;revision:number}; route:'native-reference'|'dubbed-lipsync'|'voiceover'; sourceVideoHash:string; audioHash:string|null; reviewRevision:number;turns?:import('./character-voice.ts').DialogueTurn[] }
export interface ExportStoryboardContext { clipId:string; shotId:string|null; shotRevision:number|null; dialogue:string|null; voice?:ExportStoryboardVoice|null }
/** Privileged main/engine protocol. Never exposed as an execute command. */
export interface ExportTemporary { id:string; dev:string; ino:string }
export interface PreparedExport { schemaVersion:1; snapshotHash:string; receipt:ExportReceipt; timeline:TimelineRevision; sources:ExportSource[]; storyboard:ExportStoryboardContext[]; output:ExportSource|null; temporary:ExportTemporary|null }
export interface ExportOutcome { requestId:string; exportId:string; state:Exclude<ExportState,'prepared'>; byteLength:number; hash:string|null; errorCode:string|null; temporary?:ExportTemporary; publishedAfterCancellation?:true }
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
export const isExportRequestId=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const int=(v:unknown,min=0,max=2*1024**3):v is number=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const code=(v:unknown)=>v===null||typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(v);
const fields=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
export function isExportTimelineInput(v:unknown):v is ExportTimelineInput {
 return isRecord(v)&&fields(v,['requestId','projectId','timelineId','revision','kind'],['renderJobId'])&&isExportRequestId(v.requestId)&&id(v.projectId)&&id(v.timelineId)&&int(v.revision,1,Number.MAX_SAFE_INTEGER)&&['mp4','wav','srt','csv','sources'].includes(String(v.kind))&&(['mp4','wav'].includes(String(v.kind))?id(v.renderJobId):v.renderJobId===undefined);
}
export const exportPolicy={mp4:{directory:'video',extension:'mp4',cap:1024**3},wav:{directory:'audio',extension:'wav',cap:128*1024**2},srt:{directory:'subtitles',extension:'srt',cap:4*1024**2},csv:{directory:'storyboards',extension:'csv',cap:4*1024**2},sources:{directory:'packages',extension:'zip',cap:2*1024**3}} as const;
export function exportRelativePath(v:Pick<ExportTimelineInput,'kind'|'timelineId'|'revision'>,exportId:string):string { const p=exportPolicy[v.kind];return `exports/${p.directory}/${v.timelineId}-r${v.revision}-${exportId}.${p.extension}`; }
export function isExportReceipt(v:unknown):v is ExportReceipt {
 if(!isRecord(v)||!fields(v,['requestId','projectId','timelineId','revision','kind','libraryId','exportId','relativePath','state','byteLength','hash','errorCode'],['renderJobId']))return false;
 const input={requestId:v.requestId,projectId:v.projectId,timelineId:v.timelineId,revision:v.revision,kind:v.kind,...(v.renderJobId===undefined?{}:{renderJobId:v.renderJobId})};
 return isExportTimelineInput(input)&&id(v.libraryId)&&isExportRequestId(v.exportId)&&v.relativePath===exportRelativePath(input,v.exportId)&&['prepared','copying','verified','completed','failed','cancelled'].includes(String(v.state))&&int(v.byteLength,0,exportPolicy[input.kind].cap)&&(v.hash===null||hash(v.hash))&&code(v.errorCode)&&(!['verified','completed'].includes(String(v.state))||hash(v.hash));
}
export function isExportSource(v:unknown):v is ExportSource {return isRecord(v)&&fields(v,['ref','hash','byteLength','mime','filename'])&&isMediaReference(v.ref)&&Object.keys(v.ref).length===(v.ref.kind==='artifact'?3:4)&&hash(v.hash)&&int(v.byteLength,1)&&['image/png','image/jpeg','image/webp','video/mp4','audio/wav','audio/mpeg','audio/mp4'].includes(String(v.mime))&&typeof v.filename==='string'&&/^original-[0-9]{4}\.(png|jpg|webp|mp4|wav|mp3|m4a)$/.test(v.filename);}
function isTemporary(v:unknown):v is ExportTemporary {return isRecord(v)&&fields(v,['id','dev','ino'])&&isExportRequestId(v.id)&&[v.dev,v.ino].every(n=>typeof n==='string'&&/^[0-9]{1,32}$/.test(n));}
export function isPreparedExport(v:unknown):v is PreparedExport {
 if(!isRecord(v)||!fields(v,['schemaVersion','snapshotHash','receipt','timeline','sources','storyboard','output','temporary'])||v.schemaVersion!==1||!hash(v.snapshotHash)||!isExportReceipt(v.receipt)||!isTimelineRevision(v.timeline))return false;
 const receipt=v.receipt,timeline=v.timeline;
 if(timeline.libraryId!==receipt.libraryId||timeline.projectId!==receipt.projectId||timeline.id!==receipt.timelineId||timeline.revision!==receipt.revision||!Array.isArray(v.sources)||v.sources.length>MAX_RENDER_MANIFEST_ENTRIES||!v.sources.every(s=>isExportSource(s)&&s.ref.libraryId===receipt.libraryId)||!(v.temporary===null||isTemporary(v.temporary)))return false;
 if(['mp4','wav'].includes(receipt.kind)?!isExportSource(v.output)||v.output.ref.libraryId!==receipt.libraryId||v.output.mime!==(receipt.kind==='mp4'?'video/mp4':'audio/wav')||v.output.byteLength>exportPolicy[receipt.kind].cap:v.output!==null)return false;
 if(!Array.isArray(v.storyboard)||v.storyboard.length!==timeline.videoClips.length)return false;
 return v.storyboard.every((s,i)=>{const clip=timeline.videoClips[i]!,voice=s.voice;return isRecord(s)&&fields(s,['clipId','shotId','shotRevision','dialogue'],['voice'])&&s.clipId===clip.id&&s.shotId===(clip.provenance?.shotId??null)&&s.shotRevision===(clip.provenance?.shotRevision??null)&&(s.dialogue===null||typeof s.dialogue==='string'&&s.dialogue.length<=2000)&&(voice===undefined||voice===null||isRecord(voice)&&fields(voice,['takeId','voiceRef','dialogueRef','route','sourceVideoHash','audioHash','reviewRevision'],['turns'])&&(voice.turns===undefined||Array.isArray(voice.turns)&&voice.turns.length<=16&&voice.turns.every(isDialogueTurn))&&id(voice.takeId)&&[voice.voiceRef,voice.dialogueRef].every(ref=>isRecord(ref)&&id(ref.id)&&int(ref.revision,1,Number.MAX_SAFE_INTEGER))&&['native-reference','dubbed-lipsync','voiceover'].includes(String(voice.route))&&hash(voice.sourceVideoHash)&&(voice.audioHash===null||hash(voice.audioHash))&&int(voice.reviewRevision,1,Number.MAX_SAFE_INTEGER));});
}
export function isExportOutcome(v:unknown):v is ExportOutcome {return isRecord(v)&&fields(v,['requestId','exportId','state','byteLength','hash','errorCode'],['temporary','publishedAfterCancellation'])&&(v.publishedAfterCancellation===undefined||v.publishedAfterCancellation===true&&v.state==='completed')&&isExportRequestId(v.requestId)&&isExportRequestId(v.exportId)&&['copying','verified','completed','failed','cancelled'].includes(String(v.state))&&int(v.byteLength)&&(v.hash===null||hash(v.hash))&&code(v.errorCode)&&(!['verified','completed'].includes(String(v.state))||hash(v.hash))&&(v.temporary===undefined||v.state==='copying'&&isTemporary(v.temporary));}
export function isExportSnapshot(v:unknown):v is ExportSnapshot {return isRecord(v)&&fields(v,['libraryId','projectId','timelineId','exports'])&&id(v.libraryId)&&id(v.projectId)&&id(v.timelineId)&&Array.isArray(v.exports)&&v.exports.every(r=>isExportReceipt(r)&&r.libraryId===v.libraryId&&r.projectId===v.projectId&&r.timelineId===v.timelineId);}
export function isCancelTimelineExport(v:unknown):v is {requestId:string} {return isRecord(v)&&fields(v,['requestId'])&&isExportRequestId(v.requestId);}
