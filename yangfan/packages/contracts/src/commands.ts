import {parseAssignAsset} from './project-assets.ts';
import {parseComplete,parseMemoryConfig,parseSaveMemory,parseContinuity,isCompletion,isProjectMemory,type CompleteSubproject,type ConfigureMemory,type SaveMemory,type ContinuityInput,type Completion,type ProjectMemory} from './project-memory.ts';
import {parseTagAsset,parseDeliverable,isProjectAssetCatalog,isDeliverable,type TagProjectAsset,type ProjectAssetCatalog,type RegisterDeliverable,type Deliverable} from './project-assets.ts';
import {isWorkScope,isSubproject,isCanvasInfo,parseSubprojectCreate,parseSubprojectUpdate,parseCreateCanvas,parseScope,type WorkScope,type CreateSubproject,type UpdateSubproject,type CreateCanvas,type Subproject,type CanvasInfo} from './subprojects.ts';
import {parsePrepareVoiceAudition,type PrepareVoiceAuditionInput} from './audio.ts';
import {parsePrepareDialogueAssembly,type PrepareDialogueAssemblyInput} from './dialogue-assembly.ts';
import {parseRefreshVoiceCatalog,parsePrepareVoiceClone,parseApproveVoiceClone,parseReconcileVoiceClone,isVoiceCatalog,isVoiceCloneJob,type RefreshVoiceCatalogInput,type PrepareVoiceCloneInput,type ApproveVoiceCloneInput,type ReconcileVoiceCloneInput,type VoiceCatalog,type VoiceCloneJob} from './voice-management.ts';
import {parseReplaceVoiceDialogues,isReplacedVoiceDialogues,type ReplaceVoiceDialoguesInput,type ReplacedVoiceDialogues} from './character-voice.ts';
import { parseBindCharacterVoice, isCharacterVoiceBinding, type BindCharacterVoiceInput, type CharacterVoiceBinding } from './character-voice.ts';
import { parsePrepareRender, isRenderPlan, parseEnqueueRender, isLocalJobRef, parseLocalJob, isRenderJobView, parseRetryRender, parsePrepareDerived, isDerivedMediaPlan } from './render.ts';
import { parseInspectMedia, isResolvedMedia } from './render.ts';
import {parseCreateTimeline,parseApplyTimelineOps,parseRestoreTimeline,parsePrepareAssembly,parseApplyAssembly,isTimelineRevision,isPreparedAssembly} from './timeline.ts';
import { parseAgentCreate, parseAgentPrepare, parseAgentApprove, parseAgentAccept, parseAgentStop, isAgentSession, isPreparedAgentTurn, isAgentRun, isAgentAction, type AgentCreateSessionInput, type AgentPrepareTurnInput, type AgentApproveTurnInput, type AgentAcceptProposalInput, type AgentStopInput, type AgentSessionView, type PreparedAgentTurn, type AgentRunView, type AgentActionReceipt } from './agent.ts';
import { parseFinishPrepare, parseFinishApprove, parseFinishAccept, parseFinishStop, isPreparedFinishTurn, isFinishRun, isFinishAction, type FinishPrepareTurnInput, type FinishApproveTurnInput, type FinishAcceptProposalInput, type FinishStopInput, type PreparedFinishTurn, type FinishRunView, type FinishActionReceipt } from './finish-agent.ts';
import { parseSaveCharacterVoice, parseSaveShotDialogue, parsePrepareVoiceReference, isCharacterVoiceRevision, isShotDialogueRevision, type SaveCharacterVoiceInput, type SaveShotDialogueInput, type PrepareVoiceReferenceInput, type CharacterVoiceRevision, type ShotDialogueRevision } from './character-voice.ts';
import { parsePrepareDialogueProduction, parseApproveDialogueProduction, parseStopDialogueProduction, parseReviewDialogueTake, parseConfirmDialogueAudio, parsePrepareDialogueAlignment, parseImportDialogueRepair, parsePrepareDialogueRepair, parseReconcileDialogueSubmission, parseSelectDialogueTake, isDialogueProductionPlan, isDialogueTaskBatch, isDialogueProductionView, isDialogueReview, isConfirmedDialogueAudio, isDialogueTake, isDialogueSelection, type PrepareDialogueProductionInput, type ApproveDialogueProductionInput, type StopDialogueProductionInput, type ReviewDialogueTakeInput, type PrepareDialogueAlignmentInput, type ImportDialogueRepairInput, type PrepareDialogueRepairInput, type ReconcileDialogueSubmissionInput, type SelectDialogueTakeInput, type DialogueProductionPlan, type DialogueTaskBatch, type DialogueProductionView, type DialogueReview, type ConfirmedDialogueAudio, type DialogueTake, type DialogueSelection } from './dialogue-production.ts';
import {parseWorkflowPrepare,parseWorkflowApprove,parseWorkflowId,isPreparedWorkflow,isWorkflowView,type WorkflowPrepareInput,type WorkflowApproveInput,type PreparedWorkflow,type WorkflowView} from './workflows.ts';
import { parseReleaseUnknownTask, type ReleaseUnknownTaskInput, parsePrepareGeneration, parseApproveGeneration, parseTaskInput, isPreparedGeneration, isTaskRef, isTaskView, type PrepareGenerationInput, type ApproveGenerationInput, type PreparedGeneration, type TaskRef, type TaskView, type TaskInput } from './generation.ts';
import { isProject, parseCreateProject, type CreateProjectInput, type ProjectRef } from './projects.ts';
import { fail, isRecord, ok, type Result } from './result.ts';
import { parseSaveEntity, parseSaveScript, parseSaveShot, parseSelectShotOutput, isEntityRevision, isScriptRevision, isShotRevision, isShotOutputSelection, type SaveEntityInput, type SaveScriptInput, type SaveShotInput, type SelectShotOutputInput, type EntityRevision, type ScriptRevision, type ShotRevision, type ShotOutputSelection } from './creation.ts';
import { isRevisionRef, parseSaveConnection, parseSaveModel, parseSaveProfile, type SaveConnectionInput, type SaveModelInput, type SaveProfileInput, type RevisionRef } from './models.ts';
import { isAssetMetadataView, parseAssetRevision, parseUpdateAssetMetadata, type AssetMetadataView, type AssetRevisionInput, type UpdateAssetMetadataInput, isAssetVersionRef, isImportRef, parseImportGrantedFiles, parseSaveArtifact, type AssetVersionRef, type ImportGrantedFilesInput, type ImportRef, type SaveArtifactInput } from './assets.ts';
import { isCanvasCommit, parseCanvasCommand, type CanvasCommand, type CanvasCommit } from './canvas.ts';
import { parsePrepareShotProduction,parseApplyShotProduction,parseStopShotProduction,parseAttachShotWorkflow,parseSelectShotProductionOutput,isPreparedShotProduction,isShotProductionView,type PrepareShotProductionInput,type ApplyShotProductionInput,type StopShotProductionInput,type AttachShotWorkflowInput,type SelectShotProductionOutputInput,type PreparedShotProduction,type ShotProductionView } from './shot-production.ts';

import { parseSaveVoiceLine, parsePrepareSpeech, parseApproveSpeech, parsePrepareTranscription, parseSaveTranscript, parseStopAudioBatch, isVoiceLineRevision, isTranscriptRevision, isAudioBatchPlan, isAudioTaskBatch, isAudioBatchSnapshot } from './audio.ts';
import { parseVoiceoverReview, isVoiceoverReview } from './voiceover.ts';
/** Add a named entry and its parser/validator together when a feature is implemented. */
export interface CommandMap {
 'subproject.complete':{input:CompleteSubproject;output:Completion};
 'project.memoryConfigure':{input:ConfigureMemory;output:ProjectMemory};
 'project.memorySave':{input:SaveMemory;output:ProjectMemory};
 'subproject.memoryRetry':{input:WorkScope;output:ProjectMemory};
 'subproject.continuity':{input:ContinuityInput;output:ProjectMemory};
 'project.assetAssign':{input:import('./project-assets.ts').AssignProjectAsset;output:ProjectAssetCatalog};
 'project.assetTag':{input:TagProjectAsset;output:ProjectAssetCatalog};
 'subproject.deliver':{input:RegisterDeliverable;output:Deliverable};
 'subproject.create':{input:CreateSubproject;output:Subproject};
 'subproject.update':{input:UpdateSubproject;output:Subproject};
 'subproject.createCanvas':{input:CreateCanvas;output:CanvasInfo};
  'media.inspect': { input: import('./render.ts').InspectMediaInput; output: import('./render.ts').ResolvedMedia };
  'render.prepare': { input: import('./render.ts').PrepareRenderInput; output: import('./render.ts').RenderPlan };
  'render.enqueue': { input: import('./render.ts').EnqueueRenderInput; output: import('./render.ts').LocalJobRef };
  'render.cancel': { input: import('./render.ts').LocalJobInput; output: import('./render.ts').RenderJobView };
  'render.resume': { input: import('./render.ts').LocalJobInput; output: import('./render.ts').RenderJobView };
  'render.retry': { input: import('./render.ts').RetryRenderInput; output: import('./render.ts').LocalJobRef };
  'media.prepareDerived': { input: import('./render.ts').PrepareDerivedInput; output: import('./render.ts').DerivedMediaPlan };
  'media.enqueueDerived': { input: import('./render.ts').EnqueueRenderInput; output: import('./render.ts').LocalJobRef };
  'audio.saveVoiceLine': { input: import('./audio.ts').SaveVoiceLineInput; output: import('./audio.ts').VoiceLineRevision };
  'audio.reviewVoiceover': { input: import('./voiceover.ts').VoiceoverReviewInput; output: import('./voiceover.ts').VoiceoverReview };
  'audio.prepareSpeech': { input: import('./audio.ts').PrepareSpeechInput; output: import('./audio.ts').AudioBatchPlan };
  'audio.approveSpeech': { input: import('./audio.ts').ApproveSpeechInput; output: { libraryId: string; tasks: TaskRef[] } };
  'audio.prepareTranscription': { input: import('./audio.ts').PrepareTranscriptionInput; output: PreparedGeneration };
  'audio.saveTranscript': { input: import('./audio.ts').SaveTranscriptInput; output: import('./audio.ts').TranscriptRevision };
  'audio.stopBatch': { input: { projectId: string; planId: string; executionOwner: string }; output: import('./audio.ts').AudioBatchSnapshot };
  'timeline.create': {input:import('./timeline.ts').CreateTimelineInput;output:import('./timeline.ts').TimelineRevision};
  'timeline.applyOps': {input:import('./timeline.ts').ApplyTimelineOpsInput;output:import('./timeline.ts').TimelineRevision};
  'timeline.restore': {input:import('./timeline.ts').RestoreTimelineInput;output:import('./timeline.ts').TimelineRevision};
  'timeline.prepareAssembly': {input:import('./timeline.ts').PrepareAssemblyInput;output:import('./timeline.ts').PreparedAssembly};
  'timeline.applyAssembly': {input:import('./timeline.ts').ApplyAssemblyInput;output:import('./timeline.ts').TimelineRevision};
  'shots.prepareProduction':{input:PrepareShotProductionInput;output:PreparedShotProduction};
  'shots.applyProduction':{input:ApplyShotProductionInput;output:ShotProductionView};
  'shots.stopProduction':{input:StopShotProductionInput;output:ShotProductionView};
  'shots.attachWorkflow':{input:AttachShotWorkflowInput;output:ShotProductionView};
  'shots.selectOutput':{input:SelectShotProductionOutputInput;output:ShotOutputSelection};
  'agent.createSession': {input:AgentCreateSessionInput;output:AgentSessionView};
  'agent.prepareTurn': {input:AgentPrepareTurnInput;output:PreparedAgentTurn};
  'agent.approveTurn': {input:AgentApproveTurnInput;output:AgentRunView};
  'agent.acceptProposal': {input:AgentAcceptProposalInput;output:AgentActionReceipt};
  'agent.stop': {input:AgentStopInput;output:AgentRunView};
  'finish.prepareTurn': {input:FinishPrepareTurnInput;output:PreparedFinishTurn};
  'finish.approveTurn': {input:FinishApproveTurnInput;output:FinishRunView};
  'finish.acceptProposal': {input:FinishAcceptProposalInput;output:FinishActionReceipt};
  'finish.stop': {input:FinishStopInput;output:FinishRunView};
  'voice.prepareAudition':{input:PrepareVoiceAuditionInput;output:import('./audio.ts').AudioBatchPlan};
  'voice.refreshCatalog':{input:RefreshVoiceCatalogInput;output:VoiceCatalog};
  'voice.clone.prepare':{input:PrepareVoiceCloneInput;output:VoiceCloneJob};
  'voice.clone.approve':{input:ApproveVoiceCloneInput;output:VoiceCloneJob};
  'voice.clone.verify':{input:ApproveVoiceCloneInput;output:VoiceCloneJob};
  'voice.clone.reconcile':{input:ReconcileVoiceCloneInput;output:VoiceCloneJob};
  'voice.replaceDialogues':{input:ReplaceVoiceDialoguesInput;output:ReplacedVoiceDialogues};
  'voice.bindDefault': {input:BindCharacterVoiceInput;output:CharacterVoiceBinding};
  'voice.save': {input:SaveCharacterVoiceInput;output:CharacterVoiceRevision};
  'voice.prepareReference': {input:PrepareVoiceReferenceInput;output:import('./render.ts').DerivedMediaPlan};
  'dialogue.prepareAssembly':{input:PrepareDialogueAssemblyInput;output:import('./render.ts').DerivedMediaPlan};
  'dialogue.save': {input:SaveShotDialogueInput;output:ShotDialogueRevision};
  'dialogue.prepareProduction': {input:PrepareDialogueProductionInput;output:DialogueProductionPlan};
  'dialogue.approveProduction': {input:ApproveDialogueProductionInput;output:DialogueTaskBatch};
  'dialogue.stopProduction': {input:StopDialogueProductionInput;output:DialogueProductionView};
  'dialogue.reviewTake': {input:ReviewDialogueTakeInput;output:DialogueReview};
  'dialogue.confirmAudio': {input:Parameters<typeof parseConfirmDialogueAudio>[0];output:ConfirmedDialogueAudio};
  'dialogue.prepareAlignment': {input:PrepareDialogueAlignmentInput;output:import('./render.ts').DerivedMediaPlan};
  'dialogue.importRepair': {input:ImportDialogueRepairInput;output:DialogueTake};
  'dialogue.prepareRepair': {input:PrepareDialogueRepairInput;output:DialogueProductionPlan};
  'dialogue.reconcileSubmission': {input:ReconcileDialogueSubmissionInput;output:TaskView};
  'dialogue.selectTake': {input:SelectDialogueTakeInput;output:DialogueSelection};
  'creation.saveEntity': { input: SaveEntityInput; output: EntityRevision };
  'creation.saveScript': { input: SaveScriptInput; output: ScriptRevision };
  'creation.saveShot': { input: SaveShotInput; output: ShotRevision };
  'creation.selectOutput': { input: SelectShotOutputInput; output: ShotOutputSelection };
  'workflow.prepare': {input:WorkflowPrepareInput;output:PreparedWorkflow};
  'workflow.approveAndEnqueue': {input:WorkflowApproveInput;output:WorkflowView};
  'workflow.stop': {input:{workflowId:string};output:WorkflowView};
  'canvas.applyCommand': { input: CanvasCommand; output: CanvasCommit };
  'generation.prepare': { input: PrepareGenerationInput; output: PreparedGeneration };
  'generation.approveAndEnqueue': { input: ApproveGenerationInput; output: TaskRef };
  'task.requestCancel': { input: TaskInput; output: TaskView };
  'task.releaseUnknownSlot': { input: ReleaseUnknownTaskInput; output: TaskView };
  'task.reconcile': { input: TaskInput; output: TaskView };
  'task.retryCollection': { input: TaskInput; output: TaskView };
  'project.create': { input: CreateProjectInput; output: ProjectRef };
  'provider.saveConnection': { input: SaveConnectionInput; output: RevisionRef };
  'model.saveDefinition': { input: SaveModelInput; output: RevisionRef };
  'profile.save': { input: SaveProfileInput; output: RevisionRef };
  'asset.importGrantedFiles': { input: ImportGrantedFilesInput; output: ImportRef };
  'asset.updateMetadata': { input: UpdateAssetMetadataInput; output: AssetMetadataView };
  'asset.trash': { input: AssetRevisionInput; output: AssetMetadataView };
  'asset.restore': { input: AssetRevisionInput; output: AssetMetadataView };
  'asset.saveArtifact': { input: SaveArtifactInput; output: AssetVersionRef };
}
export type CommandKind = keyof CommandMap;
export interface CommandEnvelope<K extends CommandKind = CommandKind> {
  schemaVersion: 1; libraryId: string; connectionEpoch: string; commandId: string; kind: K; payload: CommandMap[K]['input']; scope?: WorkScope;
}
export interface CommandReceipt<T = CommandMap[CommandKind]['output']> { libraryId: string; commandId: string; requestHash: string; committedSeq: number; result: T }
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export const commandContracts = {
 'subproject.complete':{parse:parseComplete,isOutput:isCompletion},
 'project.memoryConfigure':{parse:parseMemoryConfig,isOutput:isProjectMemory},
 'project.memorySave':{parse:parseSaveMemory,isOutput:isProjectMemory},
 'subproject.memoryRetry':{parse:parseScope,isOutput:isProjectMemory},
 'subproject.continuity':{parse:parseContinuity,isOutput:isProjectMemory},
 'project.assetAssign':{parse:parseAssignAsset,isOutput:isProjectAssetCatalog},
 'project.assetTag':{parse:parseTagAsset,isOutput:isProjectAssetCatalog},
 'subproject.deliver':{parse:parseDeliverable,isOutput:isDeliverable},
 'subproject.create':{parse:parseSubprojectCreate,isOutput:isSubproject},
 'subproject.update':{parse:parseSubprojectUpdate,isOutput:isSubproject},
 'subproject.createCanvas':{parse:parseCreateCanvas,isOutput:isCanvasInfo},
  'media.inspect': { parse: parseInspectMedia, isOutput: isResolvedMedia },
  'render.prepare': { parse: parsePrepareRender, isOutput: isRenderPlan },
  'render.enqueue': { parse: parseEnqueueRender, isOutput: isLocalJobRef },
  'render.cancel': { parse: parseLocalJob, isOutput: isRenderJobView },
  'render.resume': { parse: parseLocalJob, isOutput: isRenderJobView },
  'render.retry': { parse: parseRetryRender, isOutput: isLocalJobRef },
  'media.prepareDerived': { parse: parsePrepareDerived, isOutput: isDerivedMediaPlan },
  'media.enqueueDerived': { parse: parseEnqueueRender, isOutput: isLocalJobRef },
  'audio.saveVoiceLine': { parse: parseSaveVoiceLine, isOutput: isVoiceLineRevision },
  'audio.reviewVoiceover': { parse: parseVoiceoverReview, isOutput: isVoiceoverReview },
  'audio.prepareSpeech': { parse: parsePrepareSpeech, isOutput: isAudioBatchPlan },
  'audio.approveSpeech': { parse: parseApproveSpeech, isOutput: isAudioTaskBatch },
  'audio.prepareTranscription': { parse: parsePrepareTranscription, isOutput: isPreparedGeneration },
  'audio.saveTranscript': { parse: parseSaveTranscript, isOutput: isTranscriptRevision },
  'audio.stopBatch': { parse: parseStopAudioBatch, isOutput: isAudioBatchSnapshot },
  'timeline.create':{parse:parseCreateTimeline,isOutput:isTimelineRevision},
  'timeline.applyOps':{parse:parseApplyTimelineOps,isOutput:isTimelineRevision},
  'timeline.restore':{parse:parseRestoreTimeline,isOutput:isTimelineRevision},
  'timeline.prepareAssembly':{parse:parsePrepareAssembly,isOutput:isPreparedAssembly},
  'timeline.applyAssembly':{parse:parseApplyAssembly,isOutput:isTimelineRevision},
  'shots.prepareProduction':{parse:parsePrepareShotProduction,isOutput:isPreparedShotProduction},
  'shots.applyProduction':{parse:parseApplyShotProduction,isOutput:isShotProductionView},
  'shots.stopProduction':{parse:parseStopShotProduction,isOutput:isShotProductionView},
  'shots.attachWorkflow':{parse:parseAttachShotWorkflow,isOutput:isShotProductionView},
  'shots.selectOutput':{parse:parseSelectShotProductionOutput,isOutput:isShotOutputSelection},
  'agent.createSession': {parse:parseAgentCreate,isOutput:isAgentSession},
  'agent.prepareTurn': {parse:parseAgentPrepare,isOutput:isPreparedAgentTurn},
  'agent.approveTurn': {parse:parseAgentApprove,isOutput:isAgentRun},
  'agent.acceptProposal': {parse:parseAgentAccept,isOutput:isAgentAction},
  'agent.stop': {parse:parseAgentStop,isOutput:isAgentRun},
  'finish.prepareTurn': {parse:parseFinishPrepare,isOutput:isPreparedFinishTurn},
  'finish.approveTurn': {parse:parseFinishApprove,isOutput:isFinishRun},
  'finish.acceptProposal': {parse:parseFinishAccept,isOutput:isFinishAction},
  'finish.stop': {parse:parseFinishStop,isOutput:isFinishRun},
  'voice.prepareAudition':{parse:parsePrepareVoiceAudition,isOutput:isAudioBatchPlan},
  'voice.refreshCatalog':{parse:parseRefreshVoiceCatalog,isOutput:isVoiceCatalog},
  'voice.clone.prepare':{parse:parsePrepareVoiceClone,isOutput:isVoiceCloneJob},
  'voice.clone.approve':{parse:parseApproveVoiceClone,isOutput:isVoiceCloneJob},
  'voice.clone.verify':{parse:parseApproveVoiceClone,isOutput:isVoiceCloneJob},
  'voice.clone.reconcile':{parse:parseReconcileVoiceClone,isOutput:isVoiceCloneJob},
  'voice.replaceDialogues':{parse:parseReplaceVoiceDialogues,isOutput:isReplacedVoiceDialogues},
  'voice.bindDefault': {parse:parseBindCharacterVoice,isOutput:isCharacterVoiceBinding},
  'voice.save': {parse:parseSaveCharacterVoice,isOutput:isCharacterVoiceRevision},
  'voice.prepareReference': {parse:parsePrepareVoiceReference,isOutput:isDerivedMediaPlan},
  'dialogue.prepareAssembly':{parse:parsePrepareDialogueAssembly,isOutput:isDerivedMediaPlan},
  'dialogue.save': {parse:parseSaveShotDialogue,isOutput:isShotDialogueRevision},
  'dialogue.prepareProduction': {parse:parsePrepareDialogueProduction,isOutput:isDialogueProductionPlan},
  'dialogue.approveProduction': {parse:parseApproveDialogueProduction,isOutput:isDialogueTaskBatch},
  'dialogue.stopProduction': {parse:parseStopDialogueProduction,isOutput:isDialogueProductionView},
  'dialogue.reviewTake': {parse:parseReviewDialogueTake,isOutput:isDialogueReview},
  'dialogue.confirmAudio': {parse:parseConfirmDialogueAudio,isOutput:isConfirmedDialogueAudio},
  'dialogue.prepareAlignment': {parse:parsePrepareDialogueAlignment,isOutput:isDerivedMediaPlan},
  'dialogue.importRepair': {parse:parseImportDialogueRepair,isOutput:isDialogueTake},
  'dialogue.prepareRepair': {parse:parsePrepareDialogueRepair,isOutput:isDialogueProductionPlan},
  'dialogue.reconcileSubmission': {parse:parseReconcileDialogueSubmission,isOutput:isTaskView},
  'dialogue.selectTake': {parse:parseSelectDialogueTake,isOutput:isDialogueSelection},
  'creation.saveEntity': { parse: parseSaveEntity, isOutput: isEntityRevision },
  'creation.saveScript': { parse: parseSaveScript, isOutput: isScriptRevision },
  'creation.saveShot': { parse: parseSaveShot, isOutput: isShotRevision },
  'creation.selectOutput': { parse: parseSelectShotOutput, isOutput: isShotOutputSelection },
  'workflow.prepare': {parse:parseWorkflowPrepare,isOutput:isPreparedWorkflow},
  'workflow.approveAndEnqueue': {parse:parseWorkflowApprove,isOutput:isWorkflowView},
  'workflow.stop': {parse:parseWorkflowId,isOutput:isWorkflowView},
  'canvas.applyCommand': { parse: parseCanvasCommand, isOutput: isCanvasCommit },
  'generation.prepare': { parse: parsePrepareGeneration, isOutput: isPreparedGeneration },
  'generation.approveAndEnqueue': { parse: parseApproveGeneration, isOutput: isTaskRef },
  'task.requestCancel': { parse: parseTaskInput, isOutput: isTaskView },
  'task.releaseUnknownSlot': { parse: parseReleaseUnknownTask, isOutput: isTaskView },
  'task.reconcile': { parse: parseTaskInput, isOutput: isTaskView },
  'task.retryCollection': { parse: parseTaskInput, isOutput: isTaskView },
  'project.create': { parse: parseCreateProject, isOutput: isProject },
  'provider.saveConnection': { parse: parseSaveConnection, isOutput: isRevisionRef },
  'model.saveDefinition': { parse: parseSaveModel, isOutput: isRevisionRef },
  'profile.save': { parse: parseSaveProfile, isOutput: isRevisionRef },
  'asset.importGrantedFiles': { parse: parseImportGrantedFiles, isOutput: isImportRef },
  'asset.updateMetadata': { parse: parseUpdateAssetMetadata, isOutput: isAssetMetadataView },
  'asset.trash': { parse: parseAssetRevision, isOutput: isAssetMetadataView },
  'asset.restore': { parse: parseAssetRevision, isOutput: isAssetMetadataView },
  'asset.saveArtifact': { parse: parseSaveArtifact, isOutput: isAssetVersionRef },
} satisfies { [K in CommandKind]: { parse(value: unknown): Result<CommandMap[K]['input']>; isOutput(value: unknown): value is CommandMap[K]['output'] } };
export function parseCommand(value: unknown): Result<CommandEnvelope> {
  if (!isRecord(value) || value.schemaVersion !== 1 || !validId(value.libraryId) || !validId(value.connectionEpoch) || !validId(value.commandId) || typeof value.kind !== 'string') return fail('INVALID_INPUT', '命令格式无效。');
  if(value.scope!==undefined&&!isWorkScope(value.scope))return fail('INVALID_INPUT','子项目作用域无效。');
  if (!Object.hasOwn(commandContracts, value.kind)) return fail('UNKNOWN_COMMAND', '此命令尚未实现。');
  const kind = value.kind as CommandKind;
  const payload = commandContracts[kind].parse(value.payload);
  return payload.ok ? ok({ schemaVersion: 1, libraryId: value.libraryId, connectionEpoch: value.connectionEpoch, commandId: value.commandId, kind, payload: payload.value,...(value.scope===undefined?{}:{scope:value.scope}) }) : payload;
}
export function isReceipt(value: unknown): value is CommandReceipt {
 if(isRecord(value)&&(isSubproject(value.result)||isCanvasInfo(value.result)||isProjectAssetCatalog(value.result)||isDeliverable(value.result)||isCompletion(value.result)||isProjectMemory(value.result)))return validId(value.libraryId)&&validId(value.commandId)&&typeof value.requestHash==='string'&&/^[a-f0-9]{64}$/.test(value.requestHash)&&Number.isSafeInteger(value.committedSeq)&&Number(value.committedSeq)>0&&value.result.libraryId===value.libraryId;
  if(isRecord(value)&&isVoiceoverReview(value.result))return validId(value.libraryId)&&validId(value.commandId)&&typeof value.requestHash==='string'&&/^[a-f0-9]{64}$/.test(value.requestHash)&&Number.isSafeInteger(value.committedSeq)&&(value.committedSeq as number)>0&&value.result.libraryId===value.libraryId;
  if(isRecord(value)&&isResolvedMedia(value.result))return validId(value.libraryId)&&validId(value.commandId)&&typeof value.requestHash==='string'&&/^[a-f0-9]{64}$/.test(value.requestHash)&&Number.isSafeInteger(value.committedSeq)&&(value.committedSeq as number)>0&&value.result.ref.libraryId===value.libraryId;
  if (isRecord(value) && isRecord(value.result) && (isVoiceLineRevision(value.result) || isTranscriptRevision(value.result) || isAudioBatchPlan(value.result) || isAudioTaskBatch(value.result) || isAudioBatchSnapshot(value.result))) {
    return validId(value.libraryId) && validId(value.commandId) && typeof value.requestHash === 'string' && /^[a-f0-9]{64}$/.test(value.requestHash) && Number.isSafeInteger(value.committedSeq) && (value.committedSeq as number) > 0 && value.result.libraryId === value.libraryId;
  }
  return isRecord(value) && validId(value.libraryId) && validId(value.commandId) && typeof value.requestHash === 'string' && /^[a-f0-9]{64}$/.test(value.requestHash) && Number.isSafeInteger(value.committedSeq) && (value.committedSeq as number) > 0 && (isRenderPlan(value.result) || isDerivedMediaPlan(value.result) || isLocalJobRef(value.result) || isRenderJobView(value.result) || isTimelineRevision(value.result) || isPreparedAssembly(value.result) || isPreparedShotProduction(value.result) || isShotProductionView(value.result) || isAgentSession(value.result) || isPreparedAgentTurn(value.result) || isAgentRun(value.result) || isAgentAction(value.result) || isPreparedFinishTurn(value.result) || isFinishRun(value.result) || isFinishAction(value.result) || isDialogueProductionPlan(value.result) || isDialogueTaskBatch(value.result) || isDialogueProductionView(value.result) || isDialogueReview(value.result) || isConfirmedDialogueAudio(value.result) || isDialogueTake(value.result) || isDialogueSelection(value.result) || isVoiceCloneJob(value.result) || isVoiceCatalog(value.result) || isCharacterVoiceBinding(value.result) || isCharacterVoiceRevision(value.result) || isShotDialogueRevision(value.result) || isEntityRevision(value.result) || isScriptRevision(value.result) || isShotRevision(value.result) || isShotOutputSelection(value.result) || isPreparedWorkflow(value.result) || isWorkflowView(value.result) || isAssetMetadataView(value.result) || isCanvasCommit(value.result) || isProject(value.result) || isRevisionRef(value.result) || isImportRef(value.result) || isAssetVersionRef(value.result) || isPreparedGeneration(value.result) || isTaskRef(value.result) || isTaskView(value.result)) && value.result.libraryId === value.libraryId;
}
