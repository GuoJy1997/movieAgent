import type {CreationRef} from './creation.ts';
import { fail, isRecord, ok, type Result } from './result.ts';
import { isMediaReference, type MediaReference, type ArtifactRef } from './assets.ts';
import { isRevisionRef, type RevisionRef } from './models.ts';
import { isPreparedGeneration, isTaskRef, parseApproveGeneration, type PreparedGeneration, type TaskRef, type ApproveGenerationInput } from './generation.ts';

export const AUDIO_LIMITS = { lineCharacters: 4000, batchLines: 16, batchCharacters: 16000, uploadBytes: 24000000, durationTicks: 600 * 48000 } as const;
export interface DialogueVoiceSource { dialogueRef: { id: string; revision: number }; turnId: string; voiceRef: { id: string; revision: number } }
export interface SaveVoiceLineInput { projectId: string; id: string; expectedRevision: number; text: string; shotRef?: RevisionRef; entityRef?: RevisionRef; dialogueSource?: DialogueVoiceSource; voiceRef?:CreationRef; auditionEmotion?:'calm'|'excited'|'quiet' }
export interface VoiceLineRevision extends Omit<SaveVoiceLineInput, 'expectedRevision'> { libraryId: string; revision: number; createdAt: string }
export interface AudioTake { libraryId: string; projectId: string; id: string; lineId: string; lineRevision: number; task: TaskRef; output: ArtifactRef; profileRef: RevisionRef; providerUsage: { usageCharacters: number } | null; createdAt: string }
export interface TranscriptSegment { startTicks: number; endTicks: number; text: string }
export interface SaveTranscriptInput { projectId: string; id: string; expectedRevision: number; text: string; segments: TranscriptSegment[]; timing: 'none' | 'segments' }
export interface TranscriptRevision extends Omit<SaveTranscriptInput, 'expectedRevision'> { libraryId: string; revision: number; source: MediaReference | null; sourceHash: string | null; sourceDurationTicks: number | null; task: TaskRef | null; createdAt: string }
export interface FrozenAudioSource { ref: MediaReference; hash: string; mime: string; byteLength: number; durationTicks: number }
export interface AudioBilling { rule: 'unicode-codepoints' | 'minimax-weighted-han' | 'audio-seconds'; units: number }
export interface PrepareSpeechInput { projectId: string; lines: { lineId: string; revision: number; profileRef: RevisionRef }[]; executionOwner: string; runId: string; exception?:{reason:string} }
export interface AudioBatchItem { lineId: string; revision: number; prepared: PreparedGeneration }
export interface AudioBatchPlan { libraryId: string; projectId: string; planId: string; planHash: string; expiresAt: number; executionOwner: string; runId: string; items: AudioBatchItem[]; estimateMicros: number | null; currency: string | null; exception?:{reason:string} }
export type AudioApproval = Omit<ApproveGenerationInput, 'preparedId' | 'approvedPlanHash' | 'executionOwner' | 'runId'>;
export interface ApproveSpeechInput { planId: string; planHash: string; executionOwner: string; runId: string; approval: AudioApproval }
export interface PrepareTranscriptionInput { projectId: string; source: MediaReference; profileRef: RevisionRef; executionOwner: string; runId: string }
export interface AudioBatchSnapshot { libraryId: string; plan: AudioBatchPlan; state: 'prepared' | 'approved' | 'stopped'; tasks: { lineId: string; revision: number; task: TaskRef | null; diagnostic: string | null }[] }
export interface AudioSnapshot { libraryId: string; projectId: string; voiceLines: VoiceLineRevision[]; takes: AudioTake[]; transcripts: TranscriptRevision[]; diagnostics: { task: TaskRef; code: string; rawOutput: ArtifactRef | null }[] }
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const revision = (v: unknown, min = 1): v is number => Number.isSafeInteger(v) && (v as number) >= min;
export function parseSaveVoiceLine(v: unknown): Result<SaveVoiceLineInput> {
  if (!isRecord(v) || !exact(v, [
    'projectId', 'id', 'expectedRevision', 'text',
    ...(v.shotRef === undefined ? [] : ['shotRef']),
    ...(v.entityRef === undefined ? [] : ['entityRef']),
    ...(v.dialogueSource === undefined ? [] : ['dialogueSource']),
    ...(v.voiceRef===undefined?[]:['voiceRef']),...(v.auditionEmotion===undefined?[]:['auditionEmotion']),
  ]) || !id(v.projectId) || !id(v.id) || !revision(v.expectedRevision, 0)
    || typeof v.text !== 'string' || !v.text.trim()
    || Array.from(v.text).length > AUDIO_LIMITS.lineCharacters || /[\u0000\u007f]/.test(v.text)
    || v.voiceRef!==undefined&&(!isRecord(v.voiceRef)||!exact(v.voiceRef,['id','revision'])||!id(v.voiceRef.id)||!revision(v.voiceRef.revision))
    ||v.auditionEmotion!==undefined&&(!v.voiceRef||!['calm','excited','quiet'].includes(v.auditionEmotion as string))
    ||v.voiceRef!==undefined&&v.dialogueSource!==undefined
    || v.shotRef !== undefined && !isRevisionRef(v.shotRef)
    || v.entityRef !== undefined && !isRevisionRef(v.entityRef)
    || v.dialogueSource !== undefined && (!isDialogueVoiceSource(v.dialogueSource) || !v.shotRef || !v.entityRef)) {
    return fail('INVALID_VOICE_LINE', '台词最多4000字符，关联需使用固定修订。');
  }
  return ok(structuredClone(v) as unknown as SaveVoiceLineInput);
}
export function isDialogueVoiceSource(v: unknown): v is DialogueVoiceSource {
  const ref = (r: unknown) => isRecord(r) && exact(r, ['id', 'revision']) && id(r.id) && revision(r.revision);
  return isRecord(v) && exact(v, ['dialogueRef', 'turnId', 'voiceRef']) && ref(v.dialogueRef) && id(v.turnId) && ref(v.voiceRef);
}
export function parsePrepareSpeech(v: unknown): Result<PrepareSpeechInput> {
  if (!isRecord(v) || !exact(v, ['projectId', 'lines', 'executionOwner', 'runId',...(v.exception===undefined?[]:['exception'])])||v.exception!==undefined&&(!isRecord(v.exception)||!exact(v.exception,['reason'])||typeof v.exception.reason!=='string'||!v.exception.reason.trim()||v.exception.reason.length>2000)
    || !id(v.projectId) || !id(v.executionOwner) || !id(v.runId)
    || !Array.isArray(v.lines) || !v.lines.length || v.lines.length > AUDIO_LIMITS.batchLines
    || !v.lines.every(line => isRecord(line) && exact(line, ['lineId', 'revision', 'profileRef'])
      && id(line.lineId) && revision(line.revision) && isRevisionRef(line.profileRef))
    || new Set(v.lines.map(line => line.lineId)).size !== v.lines.length) {
    return fail('INVALID_AUDIO_BATCH', '每批需要1–16条不同的固定台词与配音预设。');
  }
  return ok(structuredClone(v) as unknown as PrepareSpeechInput);
}
export function parseSaveTranscript(v: unknown): Result<SaveTranscriptInput> {
  if (!isRecord(v) || !exact(v, ['projectId', 'id', 'expectedRevision', 'text', 'segments', 'timing'])
    || !id(v.projectId) || !id(v.id) || !revision(v.expectedRevision, 0)
    || typeof v.text !== 'string' || v.text.length > 1000000 || /[\u0000\u007f]/.test(v.text)
    || !['none', 'segments'].includes(v.timing as string)
    || !Array.isArray(v.segments) || v.segments.length > 1000
    || v.timing === 'none' && v.segments.length !== 0
    || v.timing === 'segments' && v.segments.length === 0) {
    return fail('INVALID_TRANSCRIPT', '转写格式或时间信息无效。');
  }
  let previous = 0;
  for (const s of v.segments) {
    if (!isRecord(s) || !exact(s, ['startTicks', 'endTicks', 'text'])
      || !revision(s.startTicks, 0) || !revision(s.endTicks)
      || s.startTicks < previous || s.endTicks <= s.startTicks || s.endTicks > AUDIO_LIMITS.durationTicks
      || typeof s.text !== 'string' || !s.text.trim() || Array.from(s.text).length > 200
      || /[\u0000\u007f]/.test(s.text)) {
      return fail('INVALID_TRANSCRIPT_TIMING', '转写句段必须具有有限、顺序正确且不越界的起止时间。');
    }
    previous = s.endTicks;
  }
  return ok(structuredClone(v) as unknown as SaveTranscriptInput);
}
export function parsePrepareTranscription(v: unknown): Result<PrepareTranscriptionInput> {
  return isRecord(v) && exact(v, ['projectId', 'source', 'profileRef', 'executionOwner', 'runId']) && id(v.projectId) && isMediaReference(v.source) && isRevisionRef(v.profileRef) && id(v.executionOwner) && id(v.runId) ? ok(structuredClone(v) as unknown as PrepareTranscriptionInput) : fail('INVALID_INPUT', '请选择固定音频原件与转写预设。');
}
export function isFrozenAudioSource(v: unknown): v is FrozenAudioSource {
  return isRecord(v) && exact(v, ['ref', 'hash', 'mime', 'byteLength', 'durationTicks'])
    && isMediaReference(v.ref) && Object.keys(v.ref).length === (v.ref.kind === 'artifact' ? 3 : 4)
    && typeof v.hash === 'string' && /^[a-f0-9]{64}$/.test(v.hash)
    && ['audio/wav', 'audio/mpeg', 'audio/mp4'].includes(v.mime as string)
    && revision(v.byteLength) && v.byteLength <= AUDIO_LIMITS.uploadBytes
    && revision(v.durationTicks) && v.durationTicks <= AUDIO_LIMITS.durationTicks;
}
export function parseApproveSpeech(v: unknown): Result<ApproveSpeechInput> {
  if (!isRecord(v) || !exact(v, ['planId', 'planHash', 'executionOwner', 'runId', 'approval']) || !id(v.planId) || !isRecord(v.approval) || !exact(v.approval, ['currency', 'allowanceMicros', 'budgetLimitMicros', 'acknowledgeUnknown'])) return fail('INVALID_INPUT', '配音批准格式无效。');
  const approved = parseApproveGeneration({ ...v.approval, preparedId: v.planId, approvedPlanHash: v.planHash, executionOwner: v.executionOwner, runId: v.runId });
  return approved.ok ? ok(structuredClone(v) as unknown as ApproveSpeechInput) : approved;
}
export function parseAudioRead(v: unknown): Result<{ projectId: string }> {
  return isRecord(v) && exact(v, ['projectId']) && id(v.projectId) ? ok({ projectId: v.projectId }) : fail('INVALID_INPUT', '项目身份无效。');
}
export function parseAudioBatchRead(v: unknown): Result<{ projectId: string; planId: string }> {
  return isRecord(v) && exact(v, ['projectId', 'planId']) && id(v.projectId) && id(v.planId) ? ok({ projectId: v.projectId, planId: v.planId }) : fail('INVALID_INPUT', '批次身份无效。');
}
export function parseStopAudioBatch(v: unknown): Result<{ projectId: string; planId: string; executionOwner: string }> {
  if (!isRecord(v) || !exact(v, ['projectId', 'planId', 'executionOwner']) || !id(v.executionOwner)) return fail('INVALID_INPUT', '停止批次身份无效。');
  const parsed = parseAudioBatchRead({ projectId: v.projectId, planId: v.planId });
  return parsed.ok ? ok({ ...parsed.value, executionOwner: v.executionOwner }) : parsed;
}
const created = (v: Record<string, unknown>) => id(v.libraryId) && revision(v.revision) && typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt));
export function isVoiceLineRevision(v: unknown): v is VoiceLineRevision {
  if (!isRecord(v) || !created(v)) return false;
  const { libraryId, revision, createdAt, ...input } = v;
  return parseSaveVoiceLine({ ...input, expectedRevision: (revision as number) - 1 }).ok;
}
export function isTranscriptRevision(v: unknown): v is TranscriptRevision {
  if (!isRecord(v) || !created(v)) return false;
  const { libraryId, revision, createdAt, source, sourceHash, sourceDurationTicks, task, ...input } = v;
  const parsed = parseSaveTranscript({ ...input, expectedRevision: (revision as number) - 1 });
  const duration = typeof sourceDurationTicks === 'number' ? sourceDurationTicks : 0;
  if (!parsed.ok || parsed.value.segments.some(segment => segment.endTicks > duration)) return false;
  const validSource = source === null
    ? sourceHash === null && sourceDurationTicks === null && parsed.value.timing === 'none'
    : isMediaReference(source) && source.libraryId === libraryId
      && typeof sourceHash === 'string' && /^[a-f0-9]{64}$/.test(sourceHash)
      && Number.isSafeInteger(sourceDurationTicks) && (sourceDurationTicks as number) > 0;
  return validSource && (task === null || isTaskRef(task) && task.libraryId === libraryId);
}
export function isAudioTake(v: unknown): v is AudioTake {
  return isRecord(v) && exact(v, [
    'libraryId', 'projectId', 'id', 'lineId', 'lineRevision', 'task', 'output', 'profileRef', 'providerUsage', 'createdAt',
  ]) && id(v.libraryId) && id(v.projectId) && id(v.id) && id(v.lineId) && revision(v.lineRevision)
    && isTaskRef(v.task) && v.task.libraryId === v.libraryId
    && isMediaReference(v.output) && v.output.kind === 'artifact' && v.output.libraryId === v.libraryId
    && isRevisionRef(v.profileRef) && v.profileRef.libraryId === v.libraryId
    && (v.providerUsage === null || isRecord(v.providerUsage)
      && exact(v.providerUsage, ['usageCharacters']) && revision(v.providerUsage.usageCharacters, 0))
    && typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt));
}
export function isAudioBatchPlan(v: unknown): v is AudioBatchPlan {
  return isRecord(v) && exact(v, [
    'libraryId', 'projectId', 'planId', 'planHash', 'expiresAt', 'executionOwner', 'runId', 'items', 'estimateMicros', 'currency',...(v.exception===undefined?[]:['exception']),
  ]) && id(v.libraryId) && id(v.projectId) && id(v.planId) && id(v.executionOwner) && id(v.runId)
    && typeof v.planHash === 'string' && /^[a-f0-9]{64}$/.test(v.planHash) && revision(v.expiresAt)
    && (v.estimateMicros === null || revision(v.estimateMicros, 0))
    && (v.currency === null || typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency))
    && Array.isArray(v.items) && v.items.length > 0 && v.items.length <= 16
    && v.items.every(item => isRecord(item) && exact(item, ['lineId', 'revision', 'prepared'])
      && id(item.lineId) && revision(item.revision) && isPreparedGeneration(item.prepared)
      && item.prepared.libraryId === v.libraryId && item.prepared.projectId === v.projectId);
}
export function isAudioBatchSnapshot(v: unknown): v is AudioBatchSnapshot {
  return isRecord(v) && exact(v, ['libraryId', 'plan', 'state', 'tasks']) && id(v.libraryId)
    && isAudioBatchPlan(v.plan) && v.plan.libraryId === v.libraryId
    && ['prepared', 'approved', 'stopped'].includes(v.state as string)
    && Array.isArray(v.tasks) && v.tasks.length === v.plan.items.length
    && v.tasks.every(item => isRecord(item) && exact(item, ['lineId', 'revision', 'task', 'diagnostic'])
      && id(item.lineId) && revision(item.revision)
      && (item.task === null || isTaskRef(item.task) && item.task.libraryId === v.libraryId)
      && (item.diagnostic === null || typeof item.diagnostic === 'string'));
}
export function isAudioSnapshot(v: unknown): v is AudioSnapshot {
  return isRecord(v) && exact(v, ['libraryId', 'projectId', 'voiceLines', 'takes', 'transcripts', 'diagnostics'])
    && id(v.libraryId) && id(v.projectId)
    && Array.isArray(v.voiceLines) && v.voiceLines.every(item => isVoiceLineRevision(item)
      && item.libraryId === v.libraryId && item.projectId === v.projectId)
    && Array.isArray(v.takes) && v.takes.every(item => isAudioTake(item)
      && item.libraryId === v.libraryId && item.projectId === v.projectId)
    && Array.isArray(v.transcripts) && v.transcripts.every(item => isTranscriptRevision(item)
      && item.libraryId === v.libraryId && item.projectId === v.projectId)
    && Array.isArray(v.diagnostics) && v.diagnostics.every(item => isRecord(item)
      && exact(item, ['task', 'code', 'rawOutput']) && isTaskRef(item.task)
      && item.task.libraryId === v.libraryId && typeof item.code === 'string'
      && (item.rawOutput === null || isMediaReference(item.rawOutput)
        && item.rawOutput.kind === 'artifact' && item.rawOutput.libraryId === v.libraryId));
}
export function isAudioTaskBatch(v: unknown): v is { libraryId: string; tasks: TaskRef[] } {
  return isRecord(v) && exact(v, ['libraryId', 'tasks']) && id(v.libraryId) && Array.isArray(v.tasks) && v.tasks.length > 0 && v.tasks.length <= 16 && v.tasks.every(task => isTaskRef(task) && task.libraryId === v.libraryId);
}

export interface PrepareVoiceAuditionInput {projectId:string;voiceRef:CreationRef;profileRef:RevisionRef;emotion:'calm'|'excited'|'quiet';text:string;executionOwner:string;runId:string}
export function parsePrepareVoiceAudition(x:unknown):Result<PrepareVoiceAuditionInput>{if(!isRecord(x)||!exact(x,['projectId','voiceRef','profileRef','emotion','text','executionOwner','runId'])||!id(x.executionOwner)||!id(x.runId)||!isRevisionRef(x.profileRef))return fail('INVALID_INPUT','试听配置无效。');const line=parseSaveVoiceLine({projectId:x.projectId,id:'audition',expectedRevision:0,text:x.text,voiceRef:x.voiceRef,auditionEmotion:x.emotion});return line.ok?ok(structuredClone(x) as unknown as PrepareVoiceAuditionInput):line;}
