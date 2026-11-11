import { isMediaReference, type MediaReference, type MediaMetadata } from './assets.ts';
import { isRevisionRef, type RevisionRef } from './models.ts';
import { isPreparedGeneration, isTaskRef, parseApproveGeneration, type PreparedGeneration, type TaskRef, type ApproveGenerationInput } from './generation.ts';
import { isScriptRevision, isShotRevision, isEntityRevision,type EntityRevision, type CreationRef, type ScriptRevision, type ShotRevision } from './creation.ts';
import { isVoiceLineRevision, type VoiceLineRevision } from './audio.ts';
import { isCharacterVoiceRevision, isShotDialogueRevision, type CharacterVoiceRevision, type ShotDialogueRevision, type DialogueEmotion, type DialogueRoute } from './character-voice.ts';
import { isTimelineRevision, type TimelineRevision, type SubtitleCue } from './timeline.ts';
import type { TimelineRef } from './render.ts';
import { fail, isRecord, ok, type Result } from './result.ts';
import { AGENT_MESSAGE_MAX_LENGTH } from './agent.ts';
import {isDialogueSelection,type DialogueSelection} from './dialogue-production.ts';
export interface CapturedDialogueAssembly {selection:DialogueSelection;video:{hash:string;probeId:string;durationTicks:number};audio?:{hash:string;probeId:string}}

export type FinishKind = 'voice-lines' | 'subtitle-edits' | 'rough-cut';
export interface FinishTemplate { id: string; revision: number; kind: FinishKind; name: string; description: string; instructions: string; suggestedOutputTokens: number }
export type FinishTargets =
  | { kind: 'voice-lines'; scriptRef: CreationRef; shotRefs: CreationRef[]; voiceLineRefs: CreationRef[] }
  | { kind: 'subtitle-edits'; timelineRef: TimelineRef; cueIds: string[] }
  | { kind: 'rough-cut'; timelineRef: TimelineRef; shots: { id: string; revision: number; selectionRevision: number }[]; mediaRefs: MediaReference[] };
export interface FinishPrepareTurnInput { sessionId: string; templateId: string; targets: FinishTargets; profileRef: RevisionRef; message: string; outputTokens?: number }
export interface FinishApproveTurnInput { runId: string; approval: ApproveGenerationInput }
export interface FinishAcceptProposalInput { projectId: string; runId: string; proposalHash: string; selectedKeys: string[]; executionOwner: string }
export interface FinishStopInput { runId: string; executionOwner: string }
export interface FinishProtocol { name: 'finish'; version: 1; parser: 'finish-proposal-v1' }
export type CapturedFinishTargets =
  | { kind: 'voice-lines'; script: ScriptRevision; shots: { key: string; value: ShotRevision }[]; voiceLines: { key: string; value: VoiceLineRevision }[]; voices?: CharacterVoiceRevision[]; characters?:EntityRevision[]; dialogues?: { shotId: string; value: ShotDialogueRevision | null }[] }
  | { kind: 'subtitle-edits'; timeline: TimelineRevision; cues: { key: string; value: SubtitleCue }[] }
  | { kind: 'rough-cut'; timeline: TimelineRevision; shots: { key: string; value: ShotRevision; selectionRevision: number; media: MediaReference | null;dialogue?:CapturedDialogueAssembly }[]; media: { key: string; ref: MediaReference; metadata: MediaMetadata; sourceProbeId: string | null }[] };
export interface FinishContextManifest { projectId: string; sources: { kind: string; key: string; id: string; revision: number }[]; included: string[]; omitted: string[]; promptCharacters: number; notice: string }
export interface PreparedFinishTurn {
  libraryId: string; sessionId: string; runId: string; projectId: string; executionOwner: string;
  protocol: FinishProtocol; message: string; template: FinishTemplate; targets: CapturedFinishTargets;
  context: FinishContextManifest; generation: PreparedGeneration; sourceProfileRef: RevisionRef; createdAt: number;
}
export type FinishProposalDraft =
  | { version: 1; kind: 'voice-lines'; reply: string; lines: { key: string; text: string; shotKey?: string; role?: string; emotion?: DialogueEmotion; route?: DialogueRoute; startTicks?: number; durationTicks?: number }[] }
  | { version: 1; kind: 'subtitle-edits'; reply: string; edits: { key: string; text: string; startTicks?: number; endTicks?: number }[] }
  | { version: 1; kind: 'rough-cut'; reply: string; clips: { key: string; mediaKey: string; shotKey?: string; sourceInTicks: number; startTicks: number; durationTicks: number; fit: 'contain' | 'cover' }[] };
export interface FinishProposal { proposalHash: string; expiresAt: number; draft: FinishProposalDraft }
export type FinishActionResult =
  | { kind: 'voice-lines'; voiceLines: VoiceLineRevision[]; dialogues?: ShotDialogueRevision[] }
  | { kind: 'subtitle-edits' | 'rough-cut'; timeline: TimelineRevision };
export interface FinishActionReceipt {
  libraryId: string; runId: string; projectId: string; actionId: string; selectionHash: string; proposalHash: string;
  selectedKeys: string[]; skippedKeys: string[]; result: FinishActionResult; createdAt: number;
}
export type FinishRunState = 'PREPARED' | 'PLANNING' | 'PROPOSED' | 'REPLIED' | 'INVALID' | 'FAILED' | 'UNKNOWN' | 'STOPPED' | 'ACCEPTED';
export interface FinishMessage { runId: string; role: 'user' | 'assistant'; text: string; createdAt: number }
export interface FinishRunView {
  libraryId: string; sessionId: string; runId: string; projectId: string; state: FinishRunState; stopped: boolean;
  prepared: PreparedFinishTurn; task: TaskRef | null; proposal: FinishProposal | null; action: FinishActionReceipt | null;
  messages: FinishMessage[]; errorCode: string | null; harvested: boolean;
}
export interface FinishRunList { libraryId: string; sessionId: string; runs: FinishRunView[] }
export interface FinishTemplateList { templates: FinishTemplate[] }

const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const ids = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every(id) && new Set(v).size === v.length;
const revision = (v: unknown, min = 1): v is number => Number.isSafeInteger(v) && (v as number) >= min;
const creationRef = (v: unknown): v is CreationRef => isRecord(v) && exact(v, ['id', 'revision']) && id(v.id) && revision(v.revision);
const creationRefs = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every(creationRef) && new Set(v.map(x => x.id)).size === v.length;
const timelineRef = (v: unknown): v is TimelineRef => isRecord(v) && exact(v, ['libraryId', 'projectId', 'id', 'revision']) && id(v.libraryId) && id(v.projectId) && id(v.id) && revision(v.revision);
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000\u007f]/.test(v);

export function isFinishTargets(v: unknown): v is FinishTargets {
  if (!isRecord(v) || !['voice-lines', 'subtitle-edits', 'rough-cut'].includes(v.kind as string)) return false;
  if (v.kind === 'voice-lines') return exact(v, ['kind', 'scriptRef', 'shotRefs', 'voiceLineRefs']) && creationRef(v.scriptRef) && creationRefs(v.shotRefs, 16) && creationRefs(v.voiceLineRefs, 16);
  if (v.kind === 'subtitle-edits') return exact(v, ['kind', 'timelineRef', 'cueIds']) && timelineRef(v.timelineRef) && ids(v.cueIds, 100) && v.cueIds.length > 0;
  return exact(v, ['kind', 'timelineRef', 'shots', 'mediaRefs']) && timelineRef(v.timelineRef) && Array.isArray(v.shots) && v.shots.length > 0 && v.shots.length <= 32 && v.shots.every(s => isRecord(s) && exact(s, ['id', 'revision', 'selectionRevision']) && id(s.id) && revision(s.revision) && revision(s.selectionRevision, 0)) && new Set(v.shots.map(s => s.id)).size === v.shots.length && Array.isArray(v.mediaRefs) && v.mediaRefs.length > 0 && v.mediaRefs.length <= 32 && v.mediaRefs.every(r => isMediaReference(r) && Object.keys(r).length === (r.kind === 'artifact' ? 3 : 4)) && new Set(v.mediaRefs.map(r => JSON.stringify(r))).size === v.mediaRefs.length;
}
export function parseFinishPrepare(v: unknown): Result<FinishPrepareTurnInput> {
  return isRecord(v) && exact(v, ['sessionId', 'templateId', 'targets', 'profileRef', 'message'], ['outputTokens']) && id(v.sessionId) && id(v.templateId) && isFinishTargets(v.targets) && isRevisionRef(v.profileRef) && text(v.message, AGENT_MESSAGE_MAX_LENGTH) && (v.outputTokens === undefined || Number.isSafeInteger(v.outputTokens) && (v.outputTokens as number) >= 1 && (v.outputTokens as number) <= 8192) ? ok(structuredClone(v) as unknown as FinishPrepareTurnInput) : fail('INVALID_INPUT', '成片助手上下文、需求或输出预算无效。');
}
export function parseFinishApprove(v: unknown): Result<FinishApproveTurnInput> {
  if (!isRecord(v) || !exact(v, ['runId', 'approval']) || !id(v.runId)) return fail('INVALID_INPUT', '成片规划审批无效。');
  const approval = parseApproveGeneration(v.approval);
  return approval.ok ? ok({ runId: v.runId, approval: approval.value }) : approval;
}
export function parseFinishAccept(v: unknown): Result<FinishAcceptProposalInput> {
  return isRecord(v) && exact(v, ['projectId', 'runId', 'proposalHash', 'selectedKeys', 'executionOwner']) && id(v.projectId) && id(v.runId) && hash(v.proposalHash) && ids(v.selectedKeys, 100) && v.selectedKeys.length > 0 && id(v.executionOwner) ? ok(structuredClone(v) as unknown as FinishAcceptProposalInput) : fail('INVALID_INPUT', '成片提案采用范围无效。');
}
export function parseFinishStop(v: unknown): Result<FinishStopInput> {
  return isRecord(v) && exact(v, ['runId', 'executionOwner']) && id(v.runId) && id(v.executionOwner) ? ok({ runId: v.runId, executionOwner: v.executionOwner }) : fail('INVALID_INPUT', '停止身份无效。');
}
export function isFinishTemplate(v: unknown): v is FinishTemplate {
  return isRecord(v) && exact(v, ['id', 'revision', 'kind', 'name', 'description', 'instructions', 'suggestedOutputTokens']) && id(v.id) && revision(v.revision) && ['voice-lines', 'subtitle-edits', 'rough-cut'].includes(v.kind as string) && text(v.name, 200) && typeof v.description === 'string' && typeof v.instructions === 'string' && revision(v.suggestedOutputTokens);
}
export function isFinishTemplateList(v: unknown): v is FinishTemplateList { return isRecord(v) && exact(v, ['templates']) && Array.isArray(v.templates) && v.templates.every(isFinishTemplate); }
export function isCapturedFinishTargets(v: unknown): v is CapturedFinishTargets {
  if (!isRecord(v)) return false;
  if (v.kind === 'voice-lines') return exact(v, ['kind', 'script', 'shots', 'voiceLines'], ['voices', 'characters','dialogues']) && isScriptRevision(v.script) && Array.isArray(v.shots) && v.shots.length <= 16 && v.shots.every(x => isRecord(x) && id(x.key) && isShotRevision(x.value)) && Array.isArray(v.voiceLines) && v.voiceLines.length <= 16 && v.voiceLines.every(x => isRecord(x) && id(x.key) && isVoiceLineRevision(x.value)) && (v.voices === undefined || Array.isArray(v.voices) && v.voices.every(isCharacterVoiceRevision)) && (v.characters===undefined||Array.isArray(v.characters)&&v.characters.every(isEntityRevision)) && (v.dialogues === undefined || Array.isArray(v.dialogues) && v.dialogues.every(x => isRecord(x) && exact(x, ['shotId', 'value']) && id(x.shotId) && (x.value === null || isShotDialogueRevision(x.value))));
  if (v.kind === 'subtitle-edits') return exact(v, ['kind', 'timeline', 'cues']) && isTimelineRevision(v.timeline) && Array.isArray(v.cues) && v.cues.length <= 100 && v.cues.every(x => isRecord(x) && id(x.key) && isRecord(x.value));
  if (v.kind !== 'rough-cut') return false;
  if(Array.isArray(v.shots)&&v.shots.some(x=>isRecord(x)&&x.dialogue!==undefined&&(!isRecord(x.dialogue)||!isDialogueSelection(x.dialogue.selection)||!isRecord(x.dialogue.video)||!hash(x.dialogue.video.hash)||!id(x.dialogue.video.probeId)||!revision(x.dialogue.video.durationTicks)||x.dialogue.audio!==undefined&&(!isRecord(x.dialogue.audio)||!hash(x.dialogue.audio.hash)||!id(x.dialogue.audio.probeId)))))return false;
  return exact(v, ['kind', 'timeline', 'shots', 'media']) && isTimelineRevision(v.timeline) && Array.isArray(v.shots) && v.shots.length <= 32 && v.shots.every(x => isRecord(x) && id(x.key) && isShotRevision(x.value) && revision(x.selectionRevision, 0) && (x.media === null || isMediaReference(x.media))) && Array.isArray(v.media) && v.media.length <= 32 && v.media.every(x => isRecord(x) && id(x.key) && isMediaReference(x.ref) && isRecord(x.metadata) && (x.sourceProbeId === null || id(x.sourceProbeId)));
}
export function isPreparedFinishTurn(v: unknown): v is PreparedFinishTurn {
  return isRecord(v) && id(v.libraryId) && id(v.sessionId) && id(v.runId) && id(v.projectId) && id(v.executionOwner) && isRecord(v.protocol) && exact(v.protocol, ['name', 'version', 'parser']) && v.protocol.name === 'finish' && v.protocol.version === 1 && v.protocol.parser === 'finish-proposal-v1' && text(v.message, AGENT_MESSAGE_MAX_LENGTH) && isFinishTemplate(v.template) && isCapturedFinishTargets(v.targets) && v.targets.kind === v.template.kind && isRecord(v.context) && Array.isArray(v.context.sources) && Array.isArray(v.context.included) && Array.isArray(v.context.omitted) && isPreparedGeneration(v.generation) && v.generation.libraryId === v.libraryId && v.generation.runId === v.runId && isRevisionRef(v.sourceProfileRef) && Number.isSafeInteger(v.createdAt);
}
export function isFinishAction(v: unknown): v is FinishActionReceipt {
  if (!isRecord(v) || !id(v.libraryId) || !id(v.runId) || !id(v.projectId) || !id(v.actionId) || !hash(v.selectionHash) || !hash(v.proposalHash) || !ids(v.selectedKeys, 100) || !ids(v.skippedKeys, 100) || !Number.isSafeInteger(v.createdAt) || !isRecord(v.result)) return false;
  return v.result.kind === 'voice-lines' && Array.isArray(v.result.voiceLines) && v.result.voiceLines.every(isVoiceLineRevision) || (v.result.kind === 'subtitle-edits' || v.result.kind === 'rough-cut') && isTimelineRevision(v.result.timeline);
}
export function isFinishRun(v: unknown): v is FinishRunView {
  return isRecord(v) && id(v.libraryId) && id(v.sessionId) && id(v.runId) && id(v.projectId) && ['PREPARED', 'PLANNING', 'PROPOSED', 'REPLIED', 'INVALID', 'FAILED', 'UNKNOWN', 'STOPPED', 'ACCEPTED'].includes(v.state as string) && typeof v.stopped === 'boolean' && typeof v.harvested === 'boolean' && isPreparedFinishTurn(v.prepared) && (v.task === null || isTaskRef(v.task)) && (v.proposal === null || isRecord(v.proposal) && hash(v.proposal.proposalHash) && Number.isSafeInteger(v.proposal.expiresAt) && isRecord(v.proposal.draft)) && (v.action === null || isFinishAction(v.action)) && Array.isArray(v.messages) && v.messages.every(m => isRecord(m) && id(m.runId) && ['user', 'assistant'].includes(m.role as string) && typeof m.text === 'string' && m.text.length <= 8000 && Number.isSafeInteger(m.createdAt)) && (v.errorCode === null || typeof v.errorCode === 'string');
}
export function isFinishRunList(v: unknown): v is FinishRunList { return isRecord(v) && exact(v, ['libraryId', 'sessionId', 'runs']) && id(v.libraryId) && id(v.sessionId) && Array.isArray(v.runs) && v.runs.every(isFinishRun); }
