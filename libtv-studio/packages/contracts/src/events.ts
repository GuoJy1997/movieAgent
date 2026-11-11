import {isCompletion,isProjectMemory,type Completion,type ProjectMemory} from './project-memory.ts';
import {isProjectAssetCatalog,isDeliverable,type ProjectAssetCatalog,type Deliverable} from './project-assets.ts';
import {isSubproject,isCanvasInfo,type Subproject,type CanvasInfo} from './subprojects.ts';
import {isVoiceCatalog,isVoiceCloneJob,type VoiceCatalog,type VoiceCloneJob} from './voice-management.ts';
import {isReplacedVoiceDialogues,type ReplacedVoiceDialogues, isCharacterVoiceBinding, type CharacterVoiceBinding } from './character-voice.ts';
import {isTimelineRevision,isPreparedAssembly,type TimelineRevision,type PreparedAssembly} from './timeline.ts';
import { isVoiceoverReview, type VoiceoverReview } from './voiceover.ts';
import { isResolvedMedia, type ResolvedMedia } from './render.ts';
import { isRenderPlan, isDerivedMediaPlan, isLocalJobRef, isRenderJobView, type LocalMediaPlan, type LocalJobRef, type RenderJobView } from './render.ts';
import { isVoiceLineRevision, isTranscriptRevision, isAudioBatchPlan, isAudioTaskBatch, isAudioBatchSnapshot, type VoiceLineRevision, type TranscriptRevision, type AudioBatchPlan, type AudioBatchSnapshot } from './audio.ts';
import { isAgentSession, isAgentRun, isPreparedAgentTurn, isAgentAction, type AgentSessionView, type AgentRunView, type PreparedAgentTurn, type AgentActionReceipt } from './agent.ts';
import { isFinishRun, isPreparedFinishTurn, isFinishAction, type FinishRunView, type PreparedFinishTurn, type FinishActionReceipt } from './finish-agent.ts';
import { isCharacterVoiceRevision, isShotDialogueRevision, type CharacterVoiceRevision, type ShotDialogueRevision } from './character-voice.ts';
import { isDialogueProductionPlan, isDialogueTaskBatch, isDialogueProductionView, isDialogueReview, type DialogueProductionPlan, type DialogueTaskBatch, type DialogueProductionView, type DialogueReview } from './dialogue-production.ts';
import {isConfirmedDialogueAudio,isDialogueTake,isDialogueSelection,type ConfirmedDialogueAudio,type DialogueTake,type DialogueSelection} from './dialogue-production.ts';
import {isPreparedWorkflow,isWorkflowView,type PreparedWorkflow,type WorkflowView} from './workflows.ts';
import { isPreparedGeneration, isTaskRef, isTaskView, type PreparedGeneration, type TaskRef, type TaskView } from './generation.ts';
import { validId } from './commands.ts';
import { isProject, type ProjectRef } from './projects.ts';
import { isSnapshot, type ProjectSnapshot } from './queries.ts';
import { fail, isRecord, ok, type Result } from './result.ts';
import { isRevisionRef, isCredentialStatus, type RevisionRef, type CredentialStatus } from './models.ts';
import { isAssetMetadataView, type AssetMetadataView, isImportRef, isAssetVersionRef, type ImportRef, type AssetVersionRef } from './assets.ts';
import { isCanvasCommit, type CanvasCommit } from './canvas.ts';
import { isEntityRevision, isScriptRevision, isShotRevision, isShotOutputSelection, type EntityRevision, type ScriptRevision, type ShotRevision, type ShotOutputSelection } from './creation.ts';
import { isPreparedShotProduction,isShotProductionView,isShotProductionOutput,type PreparedShotProduction,type ShotProductionView,type ShotProductionOutput } from './shot-production.ts';
export interface EventCursor { libraryId: string; streamId: string; seq: number }
export interface EventSubscription { libraryId: string; connectionEpoch: string; cursor?: EventCursor }
export type DomainEvent = { libraryId: string; streamId: string; seq: number } & (
  {kind:'subproject.changed';payload:Subproject|CanvasInfo|ProjectAssetCatalog|Deliverable|Completion|ProjectMemory} |
  { kind: 'audio.voiceoverReviewed'; payload: VoiceoverReview } |
  { kind:'media.inspected'; payload:ResolvedMedia } |
  { kind: 'render.prepared'; payload: LocalMediaPlan } |
  { kind: 'render.changed'; payload: LocalJobRef | RenderJobView } |
  { kind: 'audio.changed'; payload: VoiceLineRevision | TranscriptRevision | AudioBatchPlan | AudioBatchSnapshot | { libraryId: string; tasks: TaskRef[] } } |
  {kind:'timeline.changed';payload:TimelineRevision} |
  {kind:'timeline.prepared';payload:PreparedAssembly} |
  {kind:'shots.prepared';payload:PreparedShotProduction} |
  {kind:'shots.changed';payload:ShotProductionView} |
  {kind:'shots.outputCollected';payload:ShotProductionOutput} |
  {kind:'agent.sessionCreated';payload:AgentSessionView} |
  {kind:'agent.prepared';payload:PreparedAgentTurn} |
  {kind:'agent.changed';payload:AgentRunView} |
  {kind:'agent.accepted';payload:AgentActionReceipt} |
  {kind:'finish.prepared';payload:PreparedFinishTurn} |
  {kind:'finish.changed';payload:FinishRunView} |
  {kind:'finish.accepted';payload:FinishActionReceipt} |
  {kind:'voice.managementChanged';payload:VoiceCatalog|VoiceCloneJob} |
  {kind:'voice.changed';payload:CharacterVoiceRevision|CharacterVoiceBinding|ReplacedVoiceDialogues} |
  {kind:'dialogue.changed';payload:ShotDialogueRevision} |
  {kind:'dialogueProduction.changed';payload:DialogueProductionPlan | DialogueTaskBatch | DialogueProductionView | DialogueReview | DialogueTake | DialogueSelection | TaskView} |
  {kind:'dialogue.audioConfirmed';payload:ConfirmedDialogueAudio} |
  { kind: 'creation.entitySaved'; payload: EntityRevision } |
  { kind: 'creation.scriptSaved'; payload: ScriptRevision } |
  { kind: 'creation.shotSaved'; payload: ShotRevision } |
  { kind: 'creation.outputSelected'; payload: ShotOutputSelection } |
  {kind:'workflow.prepared';payload:PreparedWorkflow} |
  {kind:'workflow.changed';payload:WorkflowView} |
  { kind: 'canvas.changed'; payload: CanvasCommit } |
  { kind: 'generation.prepared'; payload: PreparedGeneration } |
  { kind: 'generation.enqueued'; payload: TaskRef } |
  { kind: 'task.changed'; payload: TaskView } |
  { kind: 'project.created'; payload: ProjectRef } |
  { kind: 'provider.connectionSaved' | 'model.definitionSaved' | 'profile.saved'; payload: RevisionRef } |
  { kind: 'credential.statusChanged'; payload: CredentialStatus } |
  { kind: 'asset.metadataUpdated' | 'asset.trashed' | 'asset.restored'; payload: AssetMetadataView } |
  { kind: 'asset.imported'; payload: ImportRef } |
  { kind: 'asset.versionSaved'; payload: AssetVersionRef });
export interface EventBatch { cursor: EventCursor; snapshot?: ProjectSnapshot; events: DomainEvent[] }
export function isCursor(value: unknown): value is EventCursor {
  return isRecord(value) && validId(value.libraryId) && validId(value.streamId) && Number.isSafeInteger(value.seq) && (value.seq as number) >= 0;
}
export function parseSubscription(value: unknown): Result<EventSubscription> {
  if (!isRecord(value) || !validId(value.libraryId) || !validId(value.connectionEpoch)) return fail('INVALID_INPUT', '订阅格式无效。');
  if (value.cursor !== undefined && !isCursor(value.cursor)) return fail('RESYNC_REQUIRED', '事件游标无效，请重新同步快照。');
  return ok({ libraryId: value.libraryId, connectionEpoch: value.connectionEpoch, ...(value.cursor === undefined ? {} : { cursor: value.cursor as EventCursor }) });
}
export function isDomainEvent(value: unknown): value is DomainEvent {
  if(isRecord(value)&&isCursor(value)&&value.seq>0&&value.kind==='subproject.changed')return (isSubproject(value.payload)||isCanvasInfo(value.payload)||isProjectAssetCatalog(value.payload)||isDeliverable(value.payload)||isCompletion(value.payload)||isProjectMemory(value.payload))&&value.payload.libraryId===value.libraryId;
  if(isRecord(value)&&isCursor(value)&&value.seq>0&&value.kind==='audio.voiceoverReviewed')return isVoiceoverReview(value.payload)&&value.payload.libraryId===value.libraryId;
  if (isRecord(value) && isCursor(value) && value.seq > 0 && value.kind === 'audio.changed') {
    const p = value.payload;
    return (isVoiceLineRevision(p) || isTranscriptRevision(p) || isAudioBatchPlan(p) || isAudioTaskBatch(p)) ? p.libraryId === value.libraryId : isAudioBatchSnapshot(p) && p.plan.libraryId === value.libraryId;
  }
  return isRecord(value) && isCursor(value) && value.seq > 0 && (
    value.kind === 'media.inspected' && isResolvedMedia(value.payload) && value.payload.ref.libraryId === value.libraryId ||
    value.kind === 'render.prepared' && (isRenderPlan(value.payload) || isDerivedMediaPlan(value.payload)) && value.payload.libraryId === value.libraryId ||
    value.kind === 'render.changed' && (isLocalJobRef(value.payload) || isRenderJobView(value.payload)) && value.payload.libraryId === value.libraryId ||
    value.kind === 'timeline.changed' && isTimelineRevision(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'timeline.prepared' && isPreparedAssembly(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'agent.sessionCreated' && isAgentSession(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'shots.prepared' && isPreparedShotProduction(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'shots.changed' && isShotProductionView(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'shots.outputCollected' && isShotProductionOutput(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'agent.prepared' && isPreparedAgentTurn(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'agent.changed' && isAgentRun(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'agent.accepted' && isAgentAction(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'finish.prepared' && isPreparedFinishTurn(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'finish.changed' && isFinishRun(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'finish.accepted' && isFinishAction(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'voice.managementChanged' && (isVoiceCatalog(value.payload)||isVoiceCloneJob(value.payload)) && value.payload.libraryId===value.libraryId ||
    value.kind === 'voice.changed' && (isCharacterVoiceRevision(value.payload)||isCharacterVoiceBinding(value.payload)||isReplacedVoiceDialogues(value.payload)) && value.payload.libraryId === value.libraryId ||
    value.kind === 'dialogue.changed' && isShotDialogueRevision(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'dialogue.audioConfirmed' && isConfirmedDialogueAudio(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'dialogueProduction.changed' && (isDialogueProductionPlan(value.payload) || isDialogueTaskBatch(value.payload) || isDialogueProductionView(value.payload) || isDialogueReview(value.payload) || isDialogueTake(value.payload) || isDialogueSelection(value.payload) || isTaskView(value.payload)) && value.payload.libraryId === value.libraryId ||
    value.kind === 'creation.entitySaved' && isEntityRevision(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'creation.scriptSaved' && isScriptRevision(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'creation.shotSaved' && isShotRevision(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'creation.outputSelected' && isShotOutputSelection(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'workflow.prepared' && isPreparedWorkflow(value.payload) && value.payload.libraryId===value.libraryId ||
    value.kind === 'workflow.changed' && isWorkflowView(value.payload) && value.payload.libraryId===value.libraryId ||
    value.kind === 'canvas.changed' && isCanvasCommit(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'generation.prepared' && isPreparedGeneration(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'generation.enqueued' && isTaskRef(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'task.changed' && isTaskView(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'project.created' && isProject(value.payload) && value.payload.libraryId === value.libraryId ||
    ['provider.connectionSaved', 'model.definitionSaved', 'profile.saved'].includes(value.kind as string) && isRevisionRef(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'credential.statusChanged' && isCredentialStatus(value.payload) && value.payload.ref.libraryId === value.libraryId ||
    ['asset.metadataUpdated','asset.trashed','asset.restored'].includes(value.kind as string) && isAssetMetadataView(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'asset.imported' && isImportRef(value.payload) && value.payload.libraryId === value.libraryId ||
    value.kind === 'asset.versionSaved' && isAssetVersionRef(value.payload) && value.payload.libraryId === value.libraryId);
}
export function isEventBatch(value: unknown): value is EventBatch {
  if (!isRecord(value) || !isCursor(value.cursor) || !Array.isArray(value.events) || !value.events.every(isDomainEvent)) return false;
  const cursor = value.cursor;
  if (value.snapshot !== undefined && (!isSnapshot(value.snapshot) || value.snapshot.snapshotSeq !== cursor.seq || value.snapshot.streamId !== cursor.streamId || value.snapshot.projects.some(p => p.libraryId !== cursor.libraryId))) return false;
  return value.events.every((event, index, events) => event.libraryId === cursor.libraryId && event.streamId === cursor.streamId && event.seq <= cursor.seq && (index === 0 || event.seq === events[index - 1]!.seq + 1));
}
