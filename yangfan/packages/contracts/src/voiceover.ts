import { fail, isRecord, ok, type Result } from './result.ts';
import { isAudioTake, isVoiceLineRevision, type AudioTake, type VoiceLineRevision } from './audio.ts';
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
export interface VoiceoverReviewInput { projectId: string; takeId: string; contextHash: string; checks: { timbre: 'pass' | 'needs-fix'; accent: 'pass' | 'needs-fix'; dialogue: 'pass' | 'needs-fix' }; notes: string }
export interface VoiceoverReview extends VoiceoverReviewInput { libraryId: string; reviewedAt: string; outputHash: string }
export interface VoiceoverContext { libraryId: string; projectId: string; take: AudioTake; line: VoiceLineRevision; contextHash: string; outputHash: string; review: VoiceoverReview | null }
export function parseVoiceoverRead(v: unknown): Result<{projectId:string;takeId:string}> {
  return isRecord(v) && exact(v,['projectId','takeId']) && id(v.projectId) && id(v.takeId) ? ok({projectId:v.projectId,takeId:v.takeId}) : fail('INVALID_INPUT','请选择固定旁白结果。');
}
export function parseVoiceoverReview(v: unknown): Result<VoiceoverReviewInput> {
  return isRecord(v) && exact(v,['projectId','takeId','contextHash','checks','notes']) && id(v.projectId) && id(v.takeId) && hash(v.contextHash) && isRecord(v.checks) && exact(v.checks,['timbre','accent','dialogue']) && Object.values(v.checks).every(value=>value==='pass'||value==='needs-fix') && typeof v.notes==='string' && v.notes.length<=2000 && !/[\u0000\u007f]/.test(v.notes) ? ok(structuredClone(v) as unknown as VoiceoverReviewInput) : fail('INVALID_VOICEOVER_REVIEW','请明确审核音色、口音与台词。');
}
export function isVoiceoverReview(v:unknown):v is VoiceoverReview {
  if(!isRecord(v))return false;
  const {libraryId,reviewedAt,outputHash,...input}=v;
  return id(libraryId)&&typeof reviewedAt==='string'&&Number.isFinite(Date.parse(reviewedAt))&&hash(outputHash)&&parseVoiceoverReview(input).ok;
}
export function isVoiceoverContext(v:unknown):v is VoiceoverContext {
  return isRecord(v)&&exact(v,['libraryId','projectId','take','line','contextHash','outputHash','review'])&&id(v.libraryId)&&id(v.projectId)&&isAudioTake(v.take)&&v.take.libraryId===v.libraryId&&v.take.projectId===v.projectId&&isVoiceLineRevision(v.line)&&v.line.libraryId===v.libraryId&&v.line.projectId===v.projectId&&!!v.line.dialogueSource&&hash(v.contextHash)&&hash(v.outputHash)&&(v.review===null||isVoiceoverReview(v.review)&&v.review.libraryId===v.libraryId&&v.review.projectId===v.projectId&&v.review.takeId===v.take.id);
}
