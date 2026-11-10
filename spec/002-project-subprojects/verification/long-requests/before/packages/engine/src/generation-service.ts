import {compileVoiceInstructions} from '../../domain/src/voice-identity.ts';
import {voiceInputResolver} from './voice-input-resolver.ts';
import type {CreationRef} from '../../contracts/src/creation.ts';
import type { PreparedWorkflow, WorkflowApproveInput, WorkflowStep } from '../../contracts/src/workflows.ts';
import { speechBilling, isSpeechProtocol } from '../../providers/src/audio-protocol.ts';
import type { AudioBatchPlan } from '../../contracts/src/audio.ts';
import type { assetsFor } from './asset-service.ts';
import { isFrozenReferenceImage, isFrozenReferenceAudio, isFrozenLipSyncMedia, type FrozenReferenceImage, type FrozenReferenceAudio, type FrozenLipSyncMedia } from '../../contracts/src/generation.ts';
import { createHash, randomUUID } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import type { LibraryHandle } from '../../storage/src/database.ts';
import { collectionJournalFor, type FileSourceRef } from '../../storage/src/collection-journal.ts';
import { objectStoreFor, type ObjectStoreOptions } from '../../storage/src/object-store.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { isPreparedGeneration, isTaskView, parseApproveGeneration, parsePrepareGeneration, type ApproveGenerationInput, type DispatchPermit, type PreparedGeneration, type PrepareGenerationInput, type TaskRef, type TaskSnapshot, type TaskView } from '../../contracts/src/generation.ts';
import { freezeRunConfig } from '../../domain/src/model-config.ts';
import { estimateMicros, verifyApproval } from '../../domain/src/approval.ts';
import {hasVerifiedSyncReplayContract} from '../../providers/src/sync-lipsync.ts';
import { requestCancellation, schedulerFailure } from '../../domain/src/task-state.ts';
import type { modelConfigFor } from './model-config-service.ts';
import { isSubmissionOutcome, type ImageProviderAdapter, type ProviderContext, type ImageOutput } from '../../providers/src/image-provider.ts';
import type { CommandEnvelope } from '../../contracts/src/commands.ts';
import type { canvasFor } from './canvas-service.ts';
import { attachRunOutput } from './result-attachment.ts';
import type { CanvasInputOwnership } from '../../contracts/src/canvas.ts';
import type { PrepareInlineGenerationInput } from '../../contracts/src/generation.ts';
import { fileImportIdentity, isFileImportReceipt } from '../../contracts/src/model-config-file.ts';
export interface GenerationOptions {
  adapter?: ImageProviderAdapter;
  resolveAdapter?: import('../../providers/src/adapter-registry.ts').AdapterResolver;
  context: ProviderContext;
  now?: () => number;
  /** Optional trusted owner of a mutable input; inline prompt itself is immutable in plan_json. */
  inputCurrent?: (prepared: PreparedGeneration) => boolean;
  dispatchCapacity?: () => Promise<boolean>;
  /** Synchronous engine-owned verification state update, committed with artifact publication. */
  outputCollected?: (prepared: PreparedGeneration, evidence: 'real' | 'fixture' | 'unknown') => void;
  inspectPublication?: (prepared: PreparedGeneration, source: FileSourceRef) => Promise<unknown>;
  publishAudio?: (prepared: PreparedGeneration, task: TaskView, detail: unknown) => Result<void>;
  /** Private output locator never appears in public task/event/receipt DTOs. */
  materializeOutput?: (output: ImageOutput, prepared: PreparedGeneration, context: ProviderContext, outputStagingId: string) => Promise<Result<FileSourceRef>>;
}
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function generationFor(library: LibraryHandle, models: ReturnType<typeof modelConfigFor>, options?: GenerationOptions, storageOptions?: ObjectStoreOptions, canvas?: ReturnType<typeof canvasFor>, assets?: ReturnType<typeof assetsFor>) {
  const now = options?.now ?? Date.now, journal = collectionJournalFor(library), store = objectStoreFor(library, storageOptions);
  let tail = Promise.resolve();
  const collections = new Map<string, Promise<Result<TaskView>>>();
  function atomic<T>(work: () => Result<T>): Result<T> {
    const own = library.checkOwnership(); if (!own.ok) return own;
    try { library.db.exec('BEGIN IMMEDIATE'); const result = work(); library.db.exec(result.ok ? 'COMMIT' : 'ROLLBACK'); return result; }
    catch { try { library.db.exec('ROLLBACK'); } catch { /* No transaction. */ } return fail('GENERATION_COMMIT_FAILED', '任务状态未提交，请检查资料库与磁盘。'); }
  }
  function read(taskId: string): Result<TaskView> {
    const own = library.checkOwnership(); if (!own.ok) return own;
    const row = library.db.prepare('SELECT view_json FROM task_attempt WHERE task_id=?').get(taskId);
    if (!row) return fail('TASK_NOT_FOUND', '任务不存在。');
    const task: unknown = JSON.parse(row.view_json as string); return isTaskView(task) && task.libraryId === library.libraryId ? ok(task) : fail('INVALID_STORED_DATA', '任务数据无效。');
  }
  function attempt(attemptId: string) { return library.db.prepare('SELECT * FROM task_attempt WHERE attempt_id=?').get(attemptId); }
  function plan(preparedId: string): Result<PreparedGeneration> {
    const row = library.db.prepare('SELECT plan_json FROM generation_prepared WHERE prepared_id=?').get(preparedId);
    if (!row) return fail('PREPARATION_NOT_FOUND', '准备记录不存在。');
    const value: unknown = JSON.parse(row.plan_json as string); return isPreparedGeneration(value) && value.libraryId === library.libraryId ? ok(value) : fail('INVALID_STORED_DATA', '准备记录无效。');
  }
  function preparedFor(attemptId: string): Result<PreparedGeneration> {
    const row = library.db.prepare('SELECT prepared_id FROM generation_task JOIN task_attempt USING(task_id) WHERE attempt_id=?').get(attemptId);
    return row ? plan(row.prepared_id as string) : fail('TASK_NOT_FOUND', '任务不存在。');
  }
  function persist(task: TaskView) {
    library.db.prepare('UPDATE task_attempt SET view_json=? WHERE attempt_id=?').run(JSON.stringify(task), task.attemptId);
    library.db.prepare('UPDATE generation_task SET reservation_micros=? WHERE task_id=?').run(task.reservationMicros, task.taskId);
    library.db.prepare('INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,?,?)').run(library.libraryId, 'task.changed', JSON.stringify(task));
  }
  function adapterFor(adapterId: string) { return options?.resolveAdapter?.(adapterId) ?? (options?.adapter?.adapterId === adapterId ? options.adapter : undefined); }
  function approvedWorkflow(preparedId: string) { return library.db.prepare('SELECT workflow.plan_json,workflow.approval_json,workflow.state,workflow_step.step_id FROM workflow_step JOIN workflow ON workflow.plan_id=workflow_step.workflow_id WHERE prepared_id=? AND approval_json IS NOT NULL').get(preparedId); }
  function waitingReservations(projectId: string,currency: string): number { return Number(library.db.prepare("SELECT COALESCE(SUM(json_extract(data_json,'$.approval.allowanceMicros')),0) AS total FROM voice_clone_job WHERE project_id=? AND json_extract(data_json,'$.approval.currency')=?").get(projectId,currency)!.total)+Number(library.db.prepare('SELECT COALESCE(SUM(reservation_micros),0) AS total FROM workflow_step JOIN workflow ON workflow.plan_id=workflow_step.workflow_id WHERE project_id=? AND currency=?').get(projectId,currency)!.total); }
  function current(prepared: PreparedGeneration): Result<void> {
    const trusted = approvedWorkflow(prepared.preparedId);
    const dialogue = library.db.prepare('SELECT p.state,p.plan_json,a.approval_json FROM dialogue_production_item i JOIN dialogue_production_plan p ON p.plan_id=i.plan_id LEFT JOIN dialogue_batch_approval a ON a.plan_id=p.plan_id WHERE i.prepared_id=?').get(prepared.preparedId);
    if(dialogue?.state==='stopped')return fail('DIALOGUE_PRODUCTION_STOPPED','对白批次已停止。');
    if(dialogue?.approval_json){const item=JSON.parse(dialogue.plan_json as string).items.find((item: {prepared:PreparedGeneration})=>item.prepared.preparedId===prepared.preparedId);if(!item||JSON.stringify(item.prepared)!==JSON.stringify(prepared))return fail('DIALOGUE_BATCH_AUTHORIZATION','冻结对白计划不符。');}
    const audio = library.db.prepare('SELECT audio_batch.state,audio_batch.plan_json,audio_batch.approval_json FROM audio_batch_item JOIN audio_batch USING(plan_id) WHERE prepared_id=?').get(prepared.preparedId);
    if (audio?.state === 'stopped') return fail('AUDIO_BATCH_STOPPED', '配音批次已停止。');
    if (audio?.approval_json) {
      const item = (JSON.parse(audio.plan_json as string) as AudioBatchPlan).items.find(item => item.prepared.preparedId === prepared.preparedId);
      if (!item || JSON.stringify(item.prepared) !== JSON.stringify(prepared)) return fail('AUDIO_BATCH_AUTHORIZATION', '冻结配音计划不符。');
      // A paid batch freezes the chosen revisions, while credentials remain revocable below.
    }
    if (trusted) {
      const step = (JSON.parse(trusted.plan_json as string) as PreparedWorkflow).steps.find(s => s.stepId === trusted.step_id);
      if (!step || JSON.stringify(step.template.config) !== JSON.stringify(prepared.config)) return fail('WORKFLOW_AUTHORIZATION','冻结配置与批准计划不符。');
    }
    if (!trusted && !audio?.approval_json && !dialogue?.approval_json && prepared.expiresAt <= now()) return fail('APPROVAL_EXPIRED', '审批已到期，请重新准备并批准。');
    if (!trusted && prepared.canvasInput && !canvas?.inputCurrent(prepared.canvasInput)) return fail('INPUT_CHANGED', '画布节点身份或语义版本已变化，请重新准备。');
    if (!trusted && options?.inputCurrent && !options.inputCurrent(prepared)) return fail('INPUT_CHANGED', '输入版本已变化，请重新准备。');
    if (!adapterFor(prepared.adapterId)) return fail('CONFIG_CHANGED', '适配器版本已变化。');
    const config = prepared.config;
    if(prepared.voiceIdentity){const resolved=voiceInputResolver(library).tts(prepared.projectId,prepared.voiceIdentity.voiceRef,config);if(!resolved.ok)return resolved;if(JSON.stringify(resolved.value)!==JSON.stringify(prepared.voiceIdentity))return fail('VOICE_IDENTITY_CHANGED','固定声音身份发生变化。');}
    const audioRoles=new Set<string>();
    for(const reference of prepared.referenceAudio??[]){
      if(audioRoles.has(reference.characterRef.id))return fail('VOICE_ROLE_CONFLICT','角色声音映射重复。');audioRoles.add(reference.characterRef.id);
      const fixed=voiceInputResolver(library).usable(prepared.projectId,reference.voiceRef);if(!fixed.ok)return fixed;const source=fixed.value.videoReference??fixed.value.reference;
      const metadata=assets?.assertSelectable(reference.ref);if(!metadata?.ok)return metadata??fail('REFERENCE_UNAVAILABLE','声音原件不可用。');
      const row=library.db.prepare('SELECT probe_id,probe_json FROM media_probe WHERE object_hash=? ORDER BY rowid DESC LIMIT 1').get(reference.hash);
      if(!source||!fixed.value.production.ready||fixed.value.entityRef.id!==reference.characterRef.id||JSON.stringify(source.ref)!==JSON.stringify(reference.ref)||source.hash!==reference.hash||source.probeId!==reference.probeId||source.sourceInTicks!==0||source.durationTicks!==reference.durationTicks||metadata.value.hash!==reference.hash||metadata.value.byteLength!==reference.byteLength||!row||row.probe_id!==reference.probeId||JSON.parse(row.probe_json as string).durationTicks!==reference.durationTicks)return fail('REFERENCE_CHANGED','固定角色声音来源已改变。');
    }
    if (prepared.audioSource && !library.db.prepare('SELECT 1 FROM generation_task WHERE prepared_id=?').get(prepared.preparedId)) {
      const selected = assets?.assertSelectable(prepared.audioSource.ref);
      if (!selected?.ok || selected.value.hash !== prepared.audioSource.hash || selected.value.byteLength !== prepared.audioSource.byteLength || selected.value.mime !== prepared.audioSource.mime) return fail('INPUT_CHANGED', '批准前固定音频不可选择或已经变化。');
    }
    if (!trusted && !audio?.approval_json && !dialogue?.approval_json) for (const [table, ref] of [['connection_revision', config.connection], ['model_revision', config.model], ['profile_revision', config.profile]] as const) {
      const row = library.db.prepare(`SELECT MAX(revision) AS revision FROM ${table} WHERE id=? AND library_id=?`).get(ref.id, library.libraryId);
      if (row?.revision !== ref.revision) return fail('CONFIG_CHANGED', '连接、模型、Profile 或报价已变化，请重新准备。');
    }
    if (!config.connection.credentialRef) {
      const commandId = `file-init-${createHash('sha256').update(fileImportIdentity(library.libraryId, 'provider.saveConnection', config.connection.id)).digest('hex')}`;
      const receipt = library.db.prepare('SELECT receipt_json FROM command_receipt WHERE command_id=? AND library_id=?').get(commandId, library.libraryId);
      if (receipt && isFileImportReceipt(JSON.parse(receipt.receipt_json as string), library.libraryId, config.connection.id)) return fail('CREDENTIAL_UNAVAILABLE', '文件管理的连接尚无 Key 或已停用，请重新配置后再生成。');
    }
    for (const ref of [...(config.connection.credentialRef ? [config.connection.credentialRef] : []), ...Object.values(config.connection.headers)]) {
      const row = library.db.prepare('SELECT state FROM credential_authorization WHERE id=? AND version=? AND library_id=? AND connection_id=?').get(ref.id, ref.version, ref.libraryId, ref.connectionId);
      if (!row || !['protected','session'].includes(row.state as string)) return fail('CREDENTIAL_UNAVAILABLE', '凭据不可用，请重新配置。');
    }
    return ok(undefined);
  }
  /** Router calls these two synchronous handlers inside its event/receipt transaction. */
  function prepare(request: PrepareGenerationInput, dialogueExpiresAt?: number, persist=true, voiceRef?:CreationRef): Result<PreparedGeneration> {
    if (!options) return fail('PROVIDER_UNAVAILABLE', '尚未配置可用的图像适配器。');
    let input: PrepareInlineGenerationInput;
    let ownership: CanvasInputOwnership | undefined;
    if ('canvasNode' in request) {
      if (!canvas) return fail('CANVAS_UNAVAILABLE', '画布输入不可用。');
      const resolved = canvas.resolveGeneration(request);
      if (!resolved.ok) return resolved;
      if (canvas.shotBinding(request.canvasNode.canvasId,request.canvasNode.nodeId)) return fail('SHOT_BOUND','镜头绑定节点须通过关联生产工作流执行。');
      input = resolved.value.input;
      ownership = resolved.value.ownership;
    } else {
      input = request;
    }
    if (input.profileRef.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', 'Profile 属于其他资料库。');
    if (!library.db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(input.projectId, library.libraryId)) return fail('PROJECT_NOT_FOUND', '项目不存在。');
    const profile = models.listProfiles().profiles.find(v => v.id === input.profileRef.id && v.revision === input.profileRef.revision);
    const model = profile && models.listModels().models.find(v => v.id === profile.modelRef.id && v.revision === profile.modelRef.revision);
    const connection = model && models.listConnections().connections.find(v => v.id === model.connectionRef.id && v.revision === model.connectionRef.revision);
    if (!profile || !model || !connection) return fail('REVISION_NOT_FOUND', '固定配置版本不存在。');
    const config = freezeRunConfig(connection, model, profile); if (!config.ok) return config;
    const voiceIdentity=voiceRef?voiceInputResolver(library).tts(input.projectId,voiceRef,config.value):undefined;if(voiceIdentity&&!voiceIdentity.ok)return voiceIdentity;const resolvedConfig=voiceIdentity?.ok?{...config.value,parameters:{...config.value.parameters,voice:voiceIdentity.value.providerVoiceId}}:config.value;
    const billing = isSpeechProtocol(connection.adapterType) ? speechBilling(connection.adapterType, input.prompt) : input.audioSource ? { rule: 'audio-seconds' as const, units: input.audioSource.durationTicks / 48000 } : undefined;
    const estimate = estimateMicros(resolvedConfig, billing?.units); if (!estimate.ok) return estimate;
    const base = { libraryId: library.libraryId, preparedId: randomUUID(), projectId: input.projectId, inputVersion: input.inputVersion, executionOwner: input.executionOwner, runId: input.runId, prompt: input.prompt, expiresAt: dialogueExpiresAt===undefined?now()+300000:Math.min(dialogueExpiresAt,now()+600000), config: resolvedConfig, adapterId: options.resolveAdapter ? connection.adapterType : options.adapter?.adapterId ?? connection.adapterType, estimateMicros: estimate.value, currency: model.pricing.status === 'configured' ? model.pricing.currency : null };
    const referenceImages: FrozenReferenceImage[] = [];
    for (const reference of input.referenceImages ?? []) {
      if (!assets) return fail('REFERENCE_UNAVAILABLE', '固定原件解析不可用。');
      const metadata = assets.assertSelectable(reference.ref); if (!metadata.ok) return metadata;
      const fixed = { ...structuredClone(reference), ...metadata.value };
      if (!isFrozenReferenceImage(fixed)) return fail('INVALID_REFERENCE', '参考图需 PNG/JPEG/WebP，单张最多10 MiB。');
      referenceImages.push(fixed);
    }
    const referenceAudio: FrozenReferenceAudio[] = []; const audioRoles=new Set<string>();
    for (const reference of input.referenceAudio ?? []) {
      if(audioRoles.has(reference.characterRef.id))return fail('VOICE_ROLE_CONFLICT','同一角色只能明确绑定一份声音参考。');audioRoles.add(reference.characterRef.id);
      if (!assets) return fail('REFERENCE_UNAVAILABLE', '固定声音原件解析不可用。');
      const metadata = assets.assertSelectable(reference.ref); if (!metadata.ok) return metadata;
      const row = library.db.prepare('SELECT probe_id,probe_json FROM media_probe WHERE object_hash=? ORDER BY rowid DESC LIMIT 1').get(metadata.value.hash);
      if (!row) return fail('MEDIA_ANALYSIS_REQUIRED', '请先准备标准角色声音。');
      const probe = JSON.parse(row.probe_json as string);
      const voiceResult=voiceInputResolver(library).usable(input.projectId,reference.voiceRef);if(!voiceResult.ok)return voiceResult;
      const voice=voiceResult.value,voiceReference=voice.videoReference??voice.reference,stream=probe.streams?.find((stream:{kind:string})=>stream.kind==='audio');
      if(voice.archived||!voice.production.ready||voice.entityRef.id!==reference.characterRef.id||!voiceReference||JSON.stringify(voiceReference.ref)!==JSON.stringify(reference.ref)||voiceReference.hash!==metadata.value.hash||voiceReference.probeId!==row.probe_id||voiceReference.sourceInTicks!==0||voiceReference.durationTicks!==probe.durationTicks||metadata.value.mime!=='audio/wav'||probe.container!=='wav'||stream?.codec!=='pcm_s16le'||stream.sampleRate!==48000||stream.channels!==1)return fail('REFERENCE_PREPARATION_REQUIRED','声音必须绑定角色档案及完整标准 WAV。');
      const fixed = { ...structuredClone(reference), hash: metadata.value.hash, mime: 'audio/wav' as const, byteLength: metadata.value.byteLength, durationTicks: probe.durationTicks as number, probeId: row.probe_id as string };
      if (!isFrozenReferenceAudio(fixed)) return fail('INVALID_REFERENCE', '角色声音必须是已准备的2–15秒标准 WAV。');
      referenceAudio.push(fixed);
    }
    const lipSync = (reference: FrozenLipSyncMedia | undefined): Result<FrozenLipSyncMedia | undefined> => {
      if (!reference) return ok(undefined);
      if (!assets) return fail('REFERENCE_UNAVAILABLE', '固定口型原件解析不可用。');
      const metadata = assets.assertSelectable(reference.ref); if (!metadata.ok) return metadata;
      const row = library.db.prepare('SELECT probe_id,probe_json FROM media_probe WHERE object_hash=? ORDER BY rowid DESC LIMIT 1').get(metadata.value.hash);
      if (!row) return fail('MEDIA_ANALYSIS_REQUIRED', '请先分析口型输入媒体。');
      const probe = JSON.parse(row.probe_json as string);
      const fixed = { ...structuredClone(reference), hash: metadata.value.hash, byteLength: metadata.value.byteLength, durationTicks: probe.durationTicks as number, probeId: row.probe_id as string };
      return isFrozenLipSyncMedia(fixed) ? ok(fixed) : fail('INVALID_REFERENCE', '口型输入媒体格式或时长无效。');
    };
    const lipSyncVideo = lipSync(input.lipSyncVideo); if (!lipSyncVideo.ok) return lipSyncVideo;
    const lipSyncAudio = lipSync(input.lipSyncAudio); if (!lipSyncAudio.ok) return lipSyncAudio;
    const voiceInstructions=referenceAudio.map((ref,i)=>{const voice=voiceInputResolver(library).read(input.projectId,ref.voiceRef);return voice.ok?compileVoiceInstructions(voice.value,i+1):'';}).filter(Boolean);
    const frozen = { ...base, ...(voiceInstructions.length?{prompt:[base.prompt,...voiceInstructions].join('\n')}:{}), ...(voiceIdentity?.ok?{voiceIdentity:voiceIdentity.value}:{}), ...(input.audioSource ? { audioSource: structuredClone(input.audioSource) } : {}), ...(billing ? { audioBilling: billing } : {}), ...(input.referenceImages === undefined ? {} : { referenceImages }), ...(input.referenceAudio === undefined ? {} : { referenceAudio, voiceBindings: referenceAudio.map(({ characterRef, voiceRef }) => ({ characterRef, voiceRef })) }), ...(input.lipSyncVideo === undefined ? {} : { lipSyncVideo: lipSyncVideo.value }), ...(input.lipSyncAudio === undefined ? {} : { lipSyncAudio: lipSyncAudio.value }), ...(ownership ? { canvasInput: ownership } : {}) };
    const prepared: PreparedGeneration = { ...frozen, planHash: digest(frozen) };
    const fresh = current(prepared); if (!fresh.ok) return fresh;
    const adapter = adapterFor(prepared.adapterId); if (!adapter) return fail('PROVIDER_UNAVAILABLE', '适配器不可用。');
    const valid = adapter.validate(prepared); if (!valid.ok) return valid;
    if(persist)library.db.prepare('INSERT INTO generation_prepared(prepared_id,project_id,plan_json) VALUES(?,?,?)').run(prepared.preparedId, input.projectId, JSON.stringify(prepared));
    return ok(prepared);
  }
  function approve(input: ApproveGenerationInput, agentRunId?: string, audioPlanId?: string, dialoguePlanId?: string): Result<TaskRef> {
    const dialogue=library.db.prepare('SELECT plan_id FROM dialogue_production_item WHERE prepared_id=?').get(input.preparedId);
    if(dialogue&&dialogue.plan_id!==dialoguePlanId)return fail('DIALOGUE_BATCH_AUTHORIZATION','对白必须通过所属批次一次批准。');
    const audio = library.db.prepare('SELECT plan_id FROM audio_batch_item WHERE prepared_id=?').get(input.preparedId);
    if (audio && audio.plan_id !== audioPlanId) return fail('AUDIO_BATCH_AUTHORIZATION', '配音需一次批准整个冻结批次。');
    const agent = library.db.prepare("SELECT run_id,stopped FROM agent_run WHERE json_extract(prepared_json,'$.generation.preparedId')=?").get(input.preparedId);
    if (agent && agent.run_id !== agentRunId) return fail('AGENT_AUTHORIZATION', '创作规划必须通过所属轮次批准。');
    const finish = library.db.prepare("SELECT run_id,stopped FROM finish_run WHERE json_extract(prepared_json,'$.generation.preparedId')=?").get(input.preparedId);
    if (finish && finish.run_id !== agentRunId) return fail('AGENT_AUTHORIZATION', '成片规划必须通过所属轮次批准。');
    const existing = library.db.prepare('SELECT task_id,approval_json FROM generation_task WHERE prepared_id=?').get(input.preparedId);
    if (existing) {
      if (existing.approval_json !== JSON.stringify(input)) return fail('APPROVAL_REUSED', '本次批准已经消费，不能改变其范围。');
      const task = read(existing.task_id as string); return task.ok ? ok({ libraryId: library.libraryId, taskId: task.value.taskId, attemptId: task.value.attemptId }) : task;
    }
    const prepared = plan(input.preparedId); if (!prepared.ok) return prepared;
    if(prepared.value.canvasInput && canvas?.shotBinding(prepared.value.canvasInput.canvasId,prepared.value.canvasInput.nodeId) && !approvedWorkflow(prepared.value.preparedId))return fail('SHOT_BOUND','镜头绑定节点须通过关联生产工作流执行。');
    const verified = verifyApproval(prepared.value, input, now()); if (!verified.ok) return verified;
    const fresh = current(prepared.value); if (!fresh.ok) return fresh;
    const reserved = library.db.prepare('SELECT COALESCE(SUM(reservation_micros),0) AS total FROM generation_task WHERE project_id=? AND currency=?').get(prepared.value.projectId, input.currency)!.total as number + waitingReservations(prepared.value.projectId,input.currency);
    if (!approvedWorkflow(prepared.value.preparedId) && reserved > input.budgetLimitMicros - input.allowanceMicros) return fail('BUDGET_EXCEEDED', '项目该币种预算不足；未知账单占用仍需核实。');
    const task: TaskView = { libraryId: library.libraryId, taskId: randomUUID(), attemptId: randomUUID(), state: 'QUEUED', providerState: 'unsubmitted', collectionState: 'pending', providerTaskId: null, clientRequestId: null, cancelRequested: false, cancelStatus: 'none', reconcileStatus: 'none', estimateMicros: prepared.value.estimateMicros, reportedActualMicros: null, reservationMicros: input.allowanceMicros, currency: input.currency, settlementStatus: 'unknown', artifactRef: null, errorCode: null };
    library.db.prepare('INSERT INTO generation_task(task_id,prepared_id,project_id,approval_json,currency,reservation_micros) VALUES(?,?,?,?,?,?)').run(task.taskId, input.preparedId, prepared.value.projectId, JSON.stringify(input), input.currency, input.allowanceMicros);
    library.db.prepare('INSERT INTO task_attempt(attempt_id,task_id,view_json) VALUES(?,?,?)').run(task.attemptId, task.taskId, JSON.stringify(task));
    const association=approvedWorkflow(prepared.value.preparedId);
    const step=association ? (JSON.parse(association.plan_json as string) as PreparedWorkflow).steps.find(s=>s.stepId===association.step_id) : undefined;
    let expectedInputSignature='';
    if(step && association){
      const workflow=JSON.parse(association.plan_json as string) as PreparedWorkflow, inputs=structuredClone(step.graphInputs);
      const byStep = new Map(workflow.steps.map(producer => [producer.stepId, producer]));
      const substitutions = new Map<string, WorkflowStep>();
      const visited = new Set<string>(), frozenAncestry = new Set<string>();
      function retainBoundary(nodeId: string): void {
        if (frozenAncestry.has(nodeId)) return;
        frozenAncestry.add(nodeId);
        for (const edge of inputs.edges.filter(edge => edge.targetNodeId === nodeId)) retainBoundary(edge.sourceNodeId);
      }
      function visitDependencies(producer: WorkflowStep): void {
        if (visited.has(producer.stepId)) return;
        visited.add(producer.stepId);
        const dependencies = producer.inputs.flatMap(input => input.kind === 'stepOutput' ? [byStep.get(input.stepId)!] : []);
        const dynamicSources = new Set(dependencies.map(dependency => dependency.nodeId));
        // Observed ancestry beneath an external fixed input is not an execution dependency.
        for (const edge of inputs.edges.filter(edge => edge.targetNodeId === producer.nodeId)) {
          if (!dynamicSources.has(edge.sourceNodeId)) retainBoundary(edge.sourceNodeId);
        }
        for (const dependency of dependencies) {
          substitutions.set(dependency.nodeId, dependency);
          visitDependencies(dependency);
        }
      }
      visitDependencies(step);
      for (const source of inputs.nodes) {
        const producing = substitutions.get(source.nodeId);
        // A producer can occur on both paths. Its frozen-boundary provenance must still
        // mismatch a later live replacement, even though the direct input consumes its new output.
        if (!producing || frozenAncestry.has(source.nodeId)) continue;
        const linked=library.db.prepare('SELECT task_id FROM workflow_step WHERE workflow_id=? AND step_id=?').get(workflow.planId,producing.stepId);
        const task=linked?.task_id?read(linked.task_id as string):null;
        if(!task?.ok||!task.value.artifactRef)return fail('WORKFLOW_INPUT_UNAVAILABLE','计划内输入尚未持久保存。');
        source.selectedOutput=task.value.artifactRef;source.selectionRevision=producing.selectionRevision+1;
      }
      expectedInputSignature=JSON.stringify(inputs);
    }
    const bound = step ? canvas?.bindApproved(prepared.value,task,step.selectionRevision,expectedInputSignature) : canvas?.bind(prepared.value, task);
    if (bound && !bound.ok) return bound;
    library.db.prepare('INSERT INTO scheduler_job(attempt_id,next_run_at,deadline) VALUES(?,?,?)').run(task.attemptId, now(), now() + 86400000);
    return ok({ libraryId: library.libraryId, taskId: task.taskId, attemptId: task.attemptId });
  }
  function liveLease(attemptId: string, token: number): boolean {
    const row = library.db.prepare('SELECT * FROM task_lease WHERE attempt_id=?').get(attemptId);
    return !!row && row.token === token && row.owner === library.instanceId && (row.expires_at as number) > now();
  }
  function claim(attemptId: string): Result<{ leaseToken: number }> {
    return atomic(() => {
      if (!attempt(attemptId)) return fail('TASK_NOT_FOUND', '任务不存在。');
      const old = library.db.prepare('SELECT * FROM task_lease WHERE attempt_id=?').get(attemptId);
      if (old && old.owner === library.instanceId && (old.expires_at as number) > now()) return fail('LEASE_BUSY', '此任务已有工作者。');
      // A new exclusive engine may fence the previous engine even before wall-clock expiry.
      const token = Number(old?.token ?? 0) + 1;
      library.db.prepare('INSERT INTO task_lease(attempt_id,token,owner,expires_at) VALUES(?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET token=excluded.token,owner=excluded.owner,expires_at=excluded.expires_at').run(attemptId, token, library.instanceId, now() + 30000);
      return ok({ leaseToken: token });
    });
  }
  async function acquireDispatch(attemptId: string, leaseToken: number): Promise<Result<DispatchPermit>> {
    const capacity = options?.dispatchCapacity ? await options.dispatchCapacity() : await statfs(library.root).then(s => s.bavail * s.bsize >= 192 * 1024 * 1024, () => false);
    if (!capacity) return fail('DISK_CAPACITY', '磁盘空间不足，暂停新提交并优先收存已有结果。');
    return atomic(() => {
      if (!liveLease(attemptId, leaseToken)) return fail('STALE_LEASE', '工作者租约已失效。');
      const row = attempt(attemptId); if (!row) return fail('TASK_NOT_FOUND', '任务不存在。');
      if (row.intent_json) return fail('DISPATCH_ALREADY_INTENDED', '已存在提交意图，只能对账原请求。');
      const task = read(row.task_id as string); if (!task.ok) return task;
      if (task.value.state !== 'QUEUED' || task.value.cancelRequested) return fail('DISPATCH_NOT_QUEUED', '任务不在可提交队列中。');
      const prepared = preparedFor(attemptId); if (!prepared.ok) return prepared;
      const fresh = current(prepared.value); if (!fresh.ok) return fresh;
      const connection = prepared.value.config.connection;
      const occupied = library.db.prepare('SELECT view_json,plan_json FROM task_attempt JOIN generation_task USING(task_id) JOIN generation_prepared USING(prepared_id) WHERE attempt_id<>?').all(attemptId).filter(r => {
        const other = JSON.parse(r.view_json as string) as TaskView, plan = JSON.parse(r.plan_json as string) as PreparedGeneration;
        return plan.config.connection.id === connection.id && ['submitting','accepted','unknown'].includes(other.providerState);
      }).length;
      if (occupied >= connection.concurrency) return fail('CONCURRENCY_LIMIT', '此连接已有任务或待核实提交占用并发额度。');
      const clientRequestId = randomUUID(), requestHash = digest(prepared.value);
      const outputStagingId = `${attemptId}-output`;
      const permit = { attemptId, leaseToken, clientRequestId, requestHash, outputStagingId, prepared: prepared.value };
      library.db.prepare('UPDATE task_attempt SET client_request_id=?,intent_json=? WHERE attempt_id=?').run(clientRequestId, JSON.stringify({ requestHash, clientRequestId, outputStagingId, adapterId: prepared.value.adapterId, intendedAt: now(), idempotency: 'unproven', retries: 0, evidence: options?.context.evidence ?? 'unknown' }), attemptId);
      persist({ ...task.value, state: 'SUBMITTING', providerState: 'submitting', clientRequestId, errorCode: null });
      return ok(permit);
    });
  }
  function recordOutcome(attemptId: string, leaseToken: number, outcome: unknown, source: string, reconciledFactId?: number): Result<TaskView> {
    if (!isSubmissionOutcome(outcome)) return fail('INVALID_PROVIDER_OUTCOME', '供应商事实无效；原提交保持待核实，不能重发。');
    // Facts survive fencing; stale workers never mutate the current task/lease.
    const own = library.checkOwnership(); if (!own.ok) return own;
    const row = attempt(attemptId); if (!row) return fail('TASK_NOT_FOUND', '任务不存在。');
    const prepared = preparedFor(attemptId); if (!prepared.ok) return prepared;
    if (source !== prepared.value.adapterId) return fail('FACT_SOURCE_MISMATCH', '供应商事实来源不符。');
    const fresh = liveLease(attemptId, leaseToken);
    const result = atomic(() => {
      library.db.prepare('INSERT INTO generation_fact(attempt_id,source,lease_token,received_at,outcome_json,applied) VALUES(?,?,?,?,?,?)').run(attemptId, source, leaseToken, now(), JSON.stringify(outcome), fresh ? 1 : 0);
      if (fresh && reconciledFactId !== undefined) library.db.prepare('UPDATE generation_fact SET applied=1 WHERE id<=? AND attempt_id=? AND source=?').run(reconciledFactId, attemptId, source);
      const readTask = read(row.task_id as string); if (!readTask.ok) return readTask;
      if (!fresh) return ok(readTask.value);
      const task = readTask.value;
      if (['completed','rejected'].includes(task.providerState)) return ok(task); // No late fact may regress a terminal provider state.
      if (outcome.kind === 'completed') {
        if (outcome.sourceRef) {
          const collectionId = randomUUID(); journal.create(collectionId, outcome.sourceRef);
          library.db.prepare('UPDATE task_attempt SET collection_id=? WHERE attempt_id=?').run(collectionId, attemptId);
        } else library.db.prepare('UPDATE task_attempt SET output_json=? WHERE attempt_id=?').run(JSON.stringify(outcome.output), attemptId);
        Object.assign(task, { state: 'COLLECTING', providerState: 'completed', providerTaskId: outcome.providerTaskId, collectionState: 'pending', errorCode: null });
      } else if (outcome.kind === 'accepted') Object.assign(task, { state: 'RUNNING', providerState: 'accepted', providerTaskId: outcome.providerTaskId, reconcileStatus: 'pending' });
      else if (outcome.kind === 'unknown') { if (task.providerState !== 'accepted') Object.assign(task, { state: 'SUBMISSION_UNKNOWN', providerState: 'unknown', reconcileStatus: 'pending' }); }
      else if (outcome.kind === 'failed' || outcome.kind === 'cancelled') Object.assign(task, { state: outcome.kind === 'failed' ? 'FAILED' : 'CANCELLED', providerState: 'rejected', providerTaskId: outcome.providerTaskId, reconcileStatus: 'none', errorCode: outcome.kind === 'failed' ? 'PROVIDER_FAILED' : 'PROVIDER_CANCELLED' });
      else Object.assign(task, { state: 'FAILED', providerState: 'rejected', errorCode: 'PROVIDER_REJECTED' });
      // Explicit rejection is not billing/refund proof; retain the risk reservation.
      persist(task); return ok(task);
    });
    return result.ok && !fresh ? fail('STALE_LEASE', '迟到事实已记录；工作者租约已失效，需当前工作者对账。') : result;
  }
  async function performCollect(taskId: string): Promise<Result<TaskView>> {
    const task = read(taskId); if (!task.ok) return task;
    if (task.value.providerState !== 'completed') return fail('PROVIDER_NOT_COMPLETED', '供应商尚未确认完成。');
    if (task.value.collectionState === 'durable') return task;
    let row = attempt(task.value.attemptId)!;
    if (!row.collection_id && row.output_json) {
      const output: ImageOutput = JSON.parse(row.output_json as string);
      if (output.kind === 'unavailable') return collectionFailure(taskId, 'OUTPUT_UNAVAILABLE', true);
      if (!options?.materializeOutput) return collectionFailure(taskId, 'OUTPUT_MATERIALIZER_UNAVAILABLE');
      const prepared = preparedFor(task.value.attemptId); if (!prepared.ok) return prepared;
      let materialized; try { materialized = await options.materializeOutput(output, prepared.value, options.context, `${task.value.attemptId}-output`); } catch { return collectionFailure(taskId, 'OUTPUT_MATERIALIZATION_FAILED'); }
      if (!materialized.ok) return collectionFailure(taskId, materialized.error.code);
      const accepted = atomic(() => {
        const latest = attempt(task.value.attemptId)!;
        if (!latest.collection_id) { const collectionId = randomUUID(); journal.create(collectionId, materialized.value); library.db.prepare('UPDATE task_attempt SET collection_id=? WHERE attempt_id=?').run(collectionId, task.value.attemptId); }
        return ok(undefined);
      });
      if (!accepted.ok) return accepted;
      row = attempt(task.value.attemptId)!;
    }
    const job = row.collection_id ? journal.get(row.collection_id as string) : null;
    if (!job) return collectionFailure(taskId, 'COLLECTION_NOT_FOUND');
    const mark = atomic(() => { const latest = read(taskId); if (!latest.ok) return latest; persist({ ...latest.value, collectionState: 'collecting' }); return ok(undefined); }); if (!mark.ok) return mark;
    const durable = await store.collect({ collectionId: job.collectionId, sourceRef: job.sourceRef });
    if (!durable.ok) return atomic(() => { const currentTask = read(taskId); if (!currentTask.ok) return currentTask; const next: TaskView = { ...currentTask.value, collectionState: 'retryable_failure', errorCode: durable.error.code }; persist(next); return ok(next); });
    const outputPlan = preparedFor(task.value.attemptId); if (!outputPlan.ok) return outputPlan;
    const expectedKind = outputPlan.value.config.model.capabilities.outputKinds[0];
    if (expectedKind === 'audio' ? !durable.value.mime.startsWith('audio/') : expectedKind === 'video' ? durable.value.mime !== 'video/mp4' : expectedKind === 'text' ? durable.value.mime !== 'text/plain' : !durable.value.mime.startsWith('image/')) {
      journal.update(job.collectionId, 'unrecoverable', undefined, 'UNEXPECTED_OUTPUT_MEDIA'); journal.release(job.collectionId);
      return collectionFailure(taskId, 'UNEXPECTED_OUTPUT_MEDIA', true);
    }
    const verified = await store.verify(durable.value); if (!verified.ok) return verified;
    let publication: unknown;
    if (options?.inspectPublication) {
      try { publication = await options.inspectPublication(outputPlan.value, job.sourceRef); }
      catch { return collectionFailure(taskId, 'AUDIO_PUBLICATION_PENDING'); }
    }
    const published = atomic(() => {
      const currentTask = read(taskId); if (!currentTask.ok) return currentTask;
      if (currentTask.value.artifactRef) return currentTask;
      const receipt = durable.value;
      library.db.prepare('INSERT INTO blob_object(object_id,hash,byte_length,storage_key,mime,width,height) VALUES(?,?,?,?,?,?,?) ON CONFLICT(hash) DO NOTHING').run(receipt.objectId, receipt.hash, receipt.byteLength, receipt.storageKey, receipt.mime, receipt.width, receipt.height);
      const object = library.db.prepare('SELECT object_id FROM blob_object WHERE hash=?').get(receipt.hash)!;
      const artifactId = randomUUID();
      library.db.prepare('INSERT INTO artifact(id,library_id,object_id,created_at) VALUES(?,?,?,?)').run(artifactId, library.libraryId, object.object_id as string, new Date(now()).toISOString());
      const next: TaskView = { ...currentTask.value, state: 'SUCCEEDED', collectionState: 'durable', errorCode: null, artifactRef: { kind: 'artifact', libraryId: library.libraryId, artifactId } };
      const audioPublished = options?.publishAudio?.(outputPlan.value, next, publication);
      if (audioPublished && !audioPublished.ok) return audioPublished;
      journal.update(job.collectionId, 'ready'); journal.release(job.collectionId); persist(next);
      if (canvas && next.artifactRef) {
        const attached = attachRunOutput(library, canvas, taskId, next.artifactRef);
        if (!attached.ok) return attached;
      }
      const prepared = preparedFor(task.value.attemptId); if (!prepared.ok) return prepared;
      const originalEvidence: unknown = row.intent_json ? JSON.parse(row.intent_json as string).evidence : undefined;
      options?.outputCollected?.(prepared.value, originalEvidence === 'real' || originalEvidence === 'fixture' ? originalEvidence : 'unknown');
      return ok(next);
    });
    if (published.ok) return published;
    return atomic(() => { const currentTask = read(taskId); if (!currentTask.ok) return currentTask; const next: TaskView = { ...currentTask.value, collectionState: 'retryable_failure', errorCode: published.error.code }; persist(next); return ok(next); });
  }
  function collectionFailure(taskId: string, errorCode: string, unrecoverable = false): Result<TaskView> {
    return atomic(() => { const currentTask = read(taskId); if (!currentTask.ok) return currentTask; const next: TaskView = { ...currentTask.value, collectionState: unrecoverable ? 'unrecoverable' : 'retryable_failure', errorCode }; persist(next); return ok(next); });
  }
  function collect(taskId: string): Promise<Result<TaskView>> {
    const existing = collections.get(taskId); if (existing) return existing;
    const work = performCollect(taskId).finally(() => { collections.delete(taskId); }); collections.set(taskId, work); return work;
  }
  async function reconcile(taskId: string, explicitUnknown = false): Promise<Result<TaskView>> {
    const task = read(taskId); if (!task.ok) return task;
    if (task.value.providerState === 'completed') return collect(taskId);
    if (task.value.providerState === 'unsubmitted' || task.value.providerState === 'rejected') return task;
    if (!options || !task.value.clientRequestId) return fail('PROVIDER_UNAVAILABLE', '无法对账此任务。');
    const lease = claim(task.value.attemptId); if (!lease.ok) return lease;
    const prepared = preparedFor(task.value.attemptId); if (!prepared.ok) { release(task.value.attemptId, lease.value.leaseToken); return prepared; }
    if (explicitUnknown && !task.value.providerTaskId) {
      if(!hasVerifiedSyncReplayContract(prepared.value)){release(task.value.attemptId,lease.value.leaseToken);return fail('IDEMPOTENCY_UNVERIFIED','此连接未验证同键契约；请人工核对供应商任务。');}
      let intent: any;
      try { intent = JSON.parse(String(attempt(task.value.attemptId)!.intent_json)); } catch { intent = null; }
      const eligible = prepared.value.adapterId === 'sync-lipsync-v2' && intent && intent.adapterId === prepared.value.adapterId && intent.clientRequestId === task.value.clientRequestId && intent.requestHash === digest(prepared.value) && Number.isSafeInteger(intent.intendedAt) && intent.intendedAt <= now() && now() - intent.intendedAt <= 7 * 86400000;
      if (!eligible) { release(task.value.attemptId, lease.value.leaseToken); return fail('SUBMISSION_RECONCILE_EXPIRED', '原提交已超期或固定输入不符，不能重放；请人工核对供应商任务。'); }
    }
    const facts = library.db.prepare('SELECT id,outcome_json FROM generation_fact WHERE attempt_id=? AND source=? AND applied=0 ORDER BY id DESC').all(task.value.attemptId, prepared.value.adapterId).map(row => ({ id: row.id as number, outcome: JSON.parse(row.outcome_json as string) as unknown }));
    const fact = facts.find(f => isSubmissionOutcome(f.outcome) && f.outcome.kind === 'completed') ?? facts.find(f => isSubmissionOutcome(f.outcome));
    if (fact) {
      const reconciled = recordOutcome(task.value.attemptId, lease.value.leaseToken, fact.outcome, prepared.value.adapterId, fact.id);
      release(task.value.attemptId, lease.value.leaseToken);
      return reconciled.ok && reconciled.value.providerState === 'completed' ? collect(taskId) : reconciled;
    }
    const adapter = adapterFor(prepared.value.adapterId);
    if (!adapter) { release(task.value.attemptId, lease.value.leaseToken); return fail('PROVIDER_UNAVAILABLE', '固定适配器不可用。'); }
    let outcome; try { outcome = await adapter.reconcile({ clientRequestId: task.value.clientRequestId, providerTaskId: task.value.providerTaskId, request: prepared.value, outputStagingId: `${task.value.attemptId}-output` }, { ...options.context, ...(explicitUnknown && !task.value.providerTaskId ? { allowUnknownSubmission: true } : {}) }); } catch { outcome = { kind: 'unknown' as const }; }
    if (outcome.kind === 'unsupported') return atomic(() => {
      if (!liveLease(task.value.attemptId, lease.value.leaseToken)) return fail('STALE_LEASE', '工作者租约已失效。');
      const latest = read(taskId); if (!latest.ok) return latest;
      const next: TaskView = { ...latest.value, state: 'RECONCILE_REQUIRED', reconcileStatus: 'unsupported' }; persist(next); release(task.value.attemptId, lease.value.leaseToken); return ok(next);
    });
    const result = recordOutcome(task.value.attemptId, lease.value.leaseToken, outcome, prepared.value.adapterId);
    release(task.value.attemptId, lease.value.leaseToken);
    return result.ok && result.value.providerState === 'completed' ? collect(taskId) : result;
  }
  function release(attemptId: string, token: number) { const own = library.checkOwnership(); if (own.ok) library.db.prepare('UPDATE task_lease SET expires_at=0 WHERE attempt_id=? AND token=? AND owner=?').run(attemptId, token, library.instanceId); }
  return {
    // Internal engine capability: frozen configuration is loaded only from an approved persisted step.
    enqueueWorkflowStep(workflowId: string, stepId: string, resolved: {prompt:string;referenceImages:FrozenReferenceImage[]}): Result<TaskRef> {
      const association=library.db.prepare('SELECT workflow.plan_json,workflow.approval_json,workflow.state AS workflow_state,workflow_step.* FROM workflow_step JOIN workflow ON workflow.plan_id=workflow_step.workflow_id WHERE workflow_id=? AND step_id=?').get(workflowId,stepId);
      if (!association || !association.approval_json || !['running','needs_attention'].includes(association.workflow_state as string)) return fail('WORKFLOW_STOPPED','工作流不再接收新任务。');
      if (association.task_id) {const task=read(association.task_id as string);return task.ok?ok({libraryId:library.libraryId,taskId:task.value.taskId,attemptId:task.value.attemptId}):task;}
      if (association.state!=='waiting') return fail('WORKFLOW_STEP_STATE','步骤不是等待状态。');
      const workflow=JSON.parse(association.plan_json as string) as PreparedWorkflow, approval=JSON.parse(association.approval_json as string) as WorkflowApproveInput;
      const step=workflow.steps.find(s=>s.stepId===stepId)!;
      if(association.reservation_micros!==approval.stepAllowances[stepId])return fail('WORKFLOW_RESERVATION','步骤预留额度不完整；停止自动转移。');
      const frozen={...step.template,...resolved,preparedId:association.command_id as string,expiresAt:now()+300000};
      const prepared={...frozen,planHash:digest(frozen)};
      if (!isPreparedGeneration(prepared)) return fail('WORKFLOW_INPUT_LIMIT','依赖产物超过目标提示词或参考图限制。');
      const adapter=adapterFor(prepared.adapterId); if (!adapter) return fail('PROVIDER_UNAVAILABLE','适配器不可用。');
      const valid=adapter.validate(prepared); if (!valid.ok) return valid;
      library.db.prepare('INSERT INTO generation_prepared(prepared_id,project_id,plan_json) VALUES(?,?,?)').run(prepared.preparedId,prepared.projectId,JSON.stringify(prepared));
      library.db.prepare('UPDATE workflow_step SET prepared_id=?,reservation_micros=0 WHERE workflow_id=? AND step_id=?').run(prepared.preparedId,workflowId,stepId);
      const child=approve({preparedId:prepared.preparedId,approvedPlanHash:prepared.planHash,currency:approval.currency,budgetLimitMicros:approval.budgetLimitMicros,allowanceMicros:approval.stepAllowances[stepId]!,acknowledgeUnknown:approval.acknowledgeUnknown,executionOwner:workflow.executionOwner,runId:workflow.runId});
      if(!child.ok)return child;
      library.db.prepare("UPDATE workflow_step SET task_id=?,state='queued' WHERE workflow_id=? AND step_id=?").run(child.value.taskId,workflowId,stepId);
      return child;
    },
    checkCurrent: current, waitingReservations,
    approveAudioItem: (planId: string, input: ApproveGenerationInput) => approve(input, undefined, planId),
    now, options, adapterFor, prepare, approve, read, claim, release, acquireDispatch, recordOutcome, collect, reconcile, preparedFor, attempt,
    recordSchedulerFailure(attemptId: string, errorCode: string, retryable = false): Result<TaskView> {
      return atomic(() => {
        const row = attempt(attemptId); if (!row) return fail('TASK_NOT_FOUND', '任务不存在。');
        const task = read(row.task_id as string); if (!task.ok) return task;
        const next = schedulerFailure(task.value, row.intent_json !== null, errorCode, retryable);
        if (JSON.stringify(next) !== JSON.stringify(task.value)) persist(next);
        return ok(next);
      });
    },
    prepareGeneration: async (input: unknown) => { const parsed = parsePrepareGeneration(input); return parsed.ok ? atomic(() => prepare(parsed.value)) : parsed; },
    approveAndEnqueue: async (input: unknown) => { const parsed = parseApproveGeneration(input); return parsed.ok ? atomic(() => approve(parsed.value)) : parsed; },
    cancel(taskId: string): Result<TaskView> { const task = read(taskId); if (!task.ok) return task; const next = requestCancellation(task.value); persist(next); return ok(next); },
    list(): TaskSnapshot {
      const own = library.checkOwnership(); if (!own.ok) throw new Error(own.error.code);
      const tasks = library.db.prepare('SELECT view_json FROM task_attempt ORDER BY rowid').all().map(r => JSON.parse(r.view_json as string));
      if (!tasks.every(isTaskView)) throw new Error('INVALID_STORED_DATA');
      return { tasks, snapshotSeq: library.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM domain_event').get()!.seq as number, streamId: library.db.prepare('SELECT stream_id FROM event_stream WHERE singleton=1').get()!.stream_id as string };
    },
    prepareAction(command: CommandEnvelope<'task.reconcile' | 'task.retryCollection' | 'dialogue.reconcileSubmission'>, hash: string, checkIdentity: () => Result<void>, action?: () => Promise<Result<unknown>>): Promise<Result<void>> {
      const work = tail.then(async () => {
        const checked = checkIdentity(); if (!checked.ok) return checked;
        if (library.db.prepare('SELECT 1 FROM command_receipt WHERE command_id=?').get(command.commandId)) return ok(undefined);
        const task = read(command.payload.taskId); if (!task.ok) return task;
        const accepted = atomic(() => { const identity = checkIdentity(); if (!identity.ok) return identity; library.db.prepare('INSERT INTO generation_command(command_id,request_hash,kind,task_id) VALUES(?,?,?,?) ON CONFLICT(command_id) DO NOTHING').run(command.commandId, hash, command.kind, command.payload.taskId); return ok(undefined); });
        if (!accepted.ok) return accepted;
        const result = action ? await action() : command.kind === 'task.reconcile' ? await reconcile(command.payload.taskId) : await collect(command.payload.taskId);
        return result.ok ? ok(undefined) : result;
      });
      tail = work.then(() => undefined, () => undefined); return work;
    },
    async drain() { await tail; await Promise.allSettled([...collections.values()]); },
  };
}
