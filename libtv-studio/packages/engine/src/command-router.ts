import {projectMemoryFor} from './project-memory-service.ts';
import {projectAssetsFor} from './project-assets-service.ts';
import {subprojectsFor} from './subproject-service.ts';
import {contentScopesFor} from './content-scope.ts';
import type {voiceManagementFor} from './voice-management-service.ts';
import type {VoiceCatalog,VoiceCloneJob} from '../../contracts/src/voice-management.ts';
import type { rendersFor } from './render-service.ts';
import type { exportRecordsFor } from './export-records.ts';
import {isDerivedMediaPlan,type LocalMediaPlan,type ResolvedMedia } from '../../contracts/src/render.ts';
import type {timelinesFor} from './timeline-service.ts';
import type { audioFor } from './audio-service.ts';
import type { FrozenAudioSource } from '../../contracts/src/audio.ts';
import type {PreparedAssembly} from '../../contracts/src/timeline.ts';
import type { agentsFor } from './agent-service.ts';
import type { finishFor } from './finish-agent-service.ts';
import type { characterVoiceFor } from './character-voice-service.ts';
import type { dialogueProductionFor } from './dialogue-production-service.ts';
import type { DialogueProductionPlan, DialogueTake, ConfirmedDialogueAudio } from '../../contracts/src/dialogue-production.ts';
import type {workflowsFor} from './workflow-service.ts';
import type {PreparedWorkflow} from '../../contracts/src/workflows.ts';
import type { generationFor } from './generation-service.ts';
import { createHash } from 'node:crypto';
import { commandContracts, isReceipt, parseCommand, type CommandEnvelope, type CommandReceipt } from '../../contracts/src/commands.ts';
import { parseQuery } from '../../contracts/src/queries.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { projectsFor } from './projects.ts';
import type { eventStreamFor } from './event-stream.ts';
import type { modelConfigFor } from './model-config-service.ts';
import type { DomainEvent } from '../../contracts/src/events.ts';
import type { assetsFor } from './asset-service.ts';
import type { canvasFor } from './canvas-service.ts';
import type { creationFor } from './creation-service.ts';
import type { shotProductionFor } from './shot-production-service.ts';
import type { PreparedShotProduction } from '../../contracts/src/shot-production.ts';
/** Epoch is transport identity, not command identity; a restart can replay the same command. */
export function requestHash(command: CommandEnvelope): string {
  return createHash('sha256').update(JSON.stringify({ schemaVersion: command.schemaVersion, libraryId: command.libraryId, kind: command.kind, payload: command.payload,...(command.scope?{scope:command.scope}:{}) })).digest('hex');
}
export function commandRouterFor(library: LibraryHandle, projects: ReturnType<typeof projectsFor>, events: ReturnType<typeof eventStreamFor>, models: ReturnType<typeof modelConfigFor>, assets: ReturnType<typeof assetsFor>, generation: ReturnType<typeof generationFor>, canvas: ReturnType<typeof canvasFor>, workflows: ReturnType<typeof workflowsFor>, creation: ReturnType<typeof creationFor>, agents: ReturnType<typeof agentsFor>, finish: ReturnType<typeof finishFor>, voices: ReturnType<typeof characterVoiceFor>, dialogueProduction: ReturnType<typeof dialogueProductionFor>, shots: ReturnType<typeof shotProductionFor>, timelines: ReturnType<typeof timelinesFor>, audio: ReturnType<typeof audioFor>, renders: ReturnType<typeof rendersFor>, exports: ReturnType<typeof exportRecordsFor>,voiceManagement:ReturnType<typeof voiceManagementFor>,memory?:ReturnType<typeof projectMemoryFor>) {
  const subprojects=subprojectsFor(library),scopes=contentScopesFor(library),projectAssets=projectAssetsFor(library,assets,generation),projectMemory=memory??projectMemoryFor(library,creation,assets,generation,models);
  const handlers: { [K in keyof typeof commandContracts]: (payload: unknown, commandId: string) => Result<CommandReceipt['result']> } = {
    'subproject.complete':p=>projectMemory.complete(p),
    'project.memoryConfigure':p=>projectMemory.configure(p),
    'project.memorySave':p=>projectMemory.save(p),
    'subproject.memoryRetry':p=>projectMemory.retry(p as import('../../contracts/src/subprojects.ts').WorkScope),
    'subproject.continuity':p=>projectMemory.continuity(p),
    'project.assetAssign':p=>projectAssets.assign(p),
    'project.assetTag':p=>projectAssets.tag(p),
    'subproject.deliver':p=>projectAssets.deliver(p),
    'subproject.create':p=>subprojects.create(p),
    'subproject.update':p=>subprojects.update(p),
    'subproject.createCanvas':p=>subprojects.createCanvas(p as import('../../contracts/src/subprojects.ts').CreateCanvas),
    'media.inspect': () => fail('MEDIA_PREFLIGHT','请明确分析固定素材。'),
    'render.prepare': () => fail('RENDER_PREFLIGHT','需要先检查固定素材。'),
    'render.enqueue': payload => renders.enqueue(payload as CommandEnvelope<'render.enqueue'>['payload']),
    'render.cancel': payload => renders.cancel(payload as CommandEnvelope<'render.cancel'>['payload']),
    'render.resume': payload => renders.resume(payload as CommandEnvelope<'render.resume'>['payload']),
    'render.retry': payload => renders.retry(payload as CommandEnvelope<'render.retry'>['payload']),
    'media.prepareDerived': () => fail('RENDER_PREFLIGHT','需要先检查固定素材。'),
    'media.enqueueDerived': payload => {
      const input=payload as CommandEnvelope<'media.enqueueDerived'>['payload'];
      const row=library.db.prepare('SELECT data_json FROM render_plan WHERE plan_id=?').get(input.planId),plan=row&&JSON.parse(row.data_json as string);
      const accepted=library.db.prepare('SELECT 1 FROM local_media_job WHERE plan_id=? AND approval_run_id=?').get(input.planId,input.runId);
      if(!accepted&&isDerivedMediaPlan(plan)&&plan.dialogueAssembly){const checked=dialogueProduction.checkAssemblyPlan(plan);if(!checked.ok)return checked;}
      return renders.enqueueDerived(input);
    },
    'audio.saveVoiceLine': payload => audio.saveVoiceLine(payload as CommandEnvelope<'audio.saveVoiceLine'>['payload']),
    'audio.reviewVoiceover': payload => audio.reviewVoiceover(payload as CommandEnvelope<'audio.reviewVoiceover'>['payload']),
    'audio.prepareSpeech': payload => audio.prepareSpeech(payload as CommandEnvelope<'audio.prepareSpeech'>['payload']),
    'audio.approveSpeech': payload => audio.approveSpeech(payload as CommandEnvelope<'audio.approveSpeech'>['payload']),
    'audio.prepareTranscription': () => fail('AUDIO_PREFLIGHT', '需要先分析固定音频。'),
    'audio.saveTranscript': payload => audio.saveTranscript(payload as CommandEnvelope<'audio.saveTranscript'>['payload']),
    'audio.stopBatch': payload => audio.stopBatch(payload as CommandEnvelope<'audio.stopBatch'>['payload']),
    'timeline.create':payload=>timelines.create(payload as CommandEnvelope<'timeline.create'>['payload']),
    'timeline.applyOps':payload=>timelines.applyOps(payload as CommandEnvelope<'timeline.applyOps'>['payload']),
    'timeline.restore':payload=>timelines.restore(payload as CommandEnvelope<'timeline.restore'>['payload']),
    'timeline.prepareAssembly':()=>fail('TIMELINE_PREFLIGHT','需要先分析固定素材。'),
    'timeline.applyAssembly':payload=>timelines.applyAssembly(payload as CommandEnvelope<'timeline.applyAssembly'>['payload']),
    'shots.prepareProduction':()=>fail('PRODUCTION_PREFLIGHT','需要先读取固定镜头上下文。'),
    'shots.applyProduction':(payload,commandId)=>shots.apply(payload as CommandEnvelope<'shots.applyProduction'>['payload'],commandId),
    'shots.stopProduction':payload=>shots.stop(payload as CommandEnvelope<'shots.stopProduction'>['payload']),
    'shots.attachWorkflow':payload=>shots.attach(payload as CommandEnvelope<'shots.attachWorkflow'>['payload']),
    'shots.selectOutput':payload=>shots.selectOutput(payload as CommandEnvelope<'shots.selectOutput'>['payload']),
    'agent.createSession': payload => agents.createSession(payload as CommandEnvelope<'agent.createSession'>['payload']),
    'agent.prepareTurn': () => fail('AGENT_PREFLIGHT','需要先读取固定上下文。'),
    'agent.approveTurn': payload => agents.approveTurn(payload as CommandEnvelope<'agent.approveTurn'>['payload']),
    'agent.acceptProposal': payload => agents.acceptProposal(payload as CommandEnvelope<'agent.acceptProposal'>['payload']),
    'agent.stop': payload => agents.stop(payload as CommandEnvelope<'agent.stop'>['payload']),
    'finish.prepareTurn': () => fail('FINISH_PREFLIGHT','需要先读取固定成片上下文。'),
    'finish.approveTurn': payload => finish.approveTurn(payload as CommandEnvelope<'finish.approveTurn'>['payload']),
    'finish.acceptProposal': payload => finish.acceptProposal(payload as CommandEnvelope<'finish.acceptProposal'>['payload']),
    'finish.stop': payload => finish.stop(payload as CommandEnvelope<'finish.stop'>['payload']),
    'voice.refreshCatalog':()=>fail('VOICE_PREFLIGHT','需要先查询声音服务。'),
    'voice.clone.prepare':()=>fail('VOICE_PREFLIGHT','需要先检查声音样本。'),
    'voice.clone.approve':()=>fail('VOICE_PREFLIGHT','需要先执行原克隆计划。'),
    'voice.clone.verify':()=>fail('VOICE_PREFLIGHT','需要先执行验证计划。'),
    'voice.clone.reconcile':()=>fail('VOICE_PREFLIGHT','需要先核对原操作。'),
    'voice.replaceDialogues':payload=>voices.replaceDialogues(payload as CommandEnvelope<'voice.replaceDialogues'>['payload']),
    'voice.bindDefault': payload => voices.bindDefault(payload as CommandEnvelope<'voice.bindDefault'>['payload']),
    'voice.prepareAudition':payload=>audio.prepareAudition(payload as CommandEnvelope<'voice.prepareAudition'>['payload']),
    'voice.save': payload => voices.saveVoice(payload as CommandEnvelope<'voice.save'>['payload']),
    'voice.prepareReference': () => fail('VOICE_PREFLIGHT','需要先检查固定声音。'),
    'dialogue.prepareAssembly':()=>fail('DIALOGUE_PREFLIGHT','需要检查逐句配音。'),
    'dialogue.save': payload => voices.saveDialogue(payload as CommandEnvelope<'dialogue.save'>['payload']),
    'dialogue.prepareProduction': payload => { const prepared = dialogueProduction.prepare(payload as CommandEnvelope<'dialogue.prepareProduction'>['payload']); return prepared.ok ? dialogueProduction.savePrepared(prepared.value) : prepared; },
    'dialogue.approveProduction': payload => dialogueProduction.approve(payload as CommandEnvelope<'dialogue.approveProduction'>['payload']),
    'dialogue.stopProduction': payload => { const stopped = dialogueProduction.stop(payload as CommandEnvelope<'dialogue.stopProduction'>['payload']); return stopped.ok ? dialogueProduction.production(payload as CommandEnvelope<'dialogue.stopProduction'>['payload']) : stopped; },
    'dialogue.reviewTake': payload => dialogueProduction.reviewTake(payload as CommandEnvelope<'dialogue.reviewTake'>['payload']),
    'dialogue.confirmAudio': () => fail('DIALOGUE_PREFLIGHT','需要确认固定配音。'),
    'dialogue.prepareAlignment': () => fail('DIALOGUE_ALIGNMENT_PREFLIGHT','需要先检查口型输入。'),
    'dialogue.importRepair': () => fail('DIALOGUE_PREFLIGHT','需要检查手工修正版。'),
    'dialogue.prepareRepair': () => fail('DIALOGUE_PREFLIGHT','需要检查口型修正计划。'),
    'dialogue.reconcileSubmission': payload => generation.read((payload as { taskId: string }).taskId),
    'dialogue.selectTake': payload => dialogueProduction.selectTake(payload as CommandEnvelope<'dialogue.selectTake'>['payload']),
    'creation.saveEntity': payload => creation.saveEntity(payload as CommandEnvelope<'creation.saveEntity'>['payload']),
    'creation.saveScript': payload => creation.saveScript(payload as CommandEnvelope<'creation.saveScript'>['payload']),
    'creation.saveShot': payload => creation.saveShot(payload as CommandEnvelope<'creation.saveShot'>['payload']),
    'creation.selectOutput': payload => creation.selectOutput(payload as CommandEnvelope<'creation.selectOutput'>['payload']),
    'workflow.prepare': () => fail('WORKFLOW_PREFLIGHT','需要先读取固定输入。'),
    'workflow.approveAndEnqueue': payload => workflows.approve(payload as CommandEnvelope<'workflow.approveAndEnqueue'>['payload']),
    'workflow.stop': payload => workflows.stop((payload as {workflowId:string}).workflowId),
    'canvas.applyCommand': (payload, commandId) => canvas.apply(payload as CommandEnvelope<'canvas.applyCommand'>['payload'], commandId),
    'generation.prepare': payload => generation.prepare(payload as CommandEnvelope<'generation.prepare'>['payload']),
    'generation.approveAndEnqueue': payload => generation.approve(payload as CommandEnvelope<'generation.approveAndEnqueue'>['payload']),
    'task.requestCancel': payload => generation.cancel((payload as { taskId: string }).taskId),
    'task.releaseUnknownSlot': payload => generation.releaseUnknownSlot(payload as CommandEnvelope<'task.releaseUnknownSlot'>['payload']),
    'task.reconcile': payload => generation.read((payload as { taskId: string }).taskId),
    'task.retryCollection': payload => generation.read((payload as { taskId: string }).taskId),
    'project.create': payload => projects.create(payload),
    'provider.saveConnection': payload => models.saveConnection(payload as CommandEnvelope<'provider.saveConnection'>['payload']),
    'model.saveDefinition': payload => models.saveModel(payload as CommandEnvelope<'model.saveDefinition'>['payload']),
    'profile.save': payload => models.saveProfile(payload as CommandEnvelope<'profile.save'>['payload']),
    'asset.importGrantedFiles': () => fail('COLLECTION_NOT_DURABLE', '请先收存原件。'),
    'asset.updateMetadata': payload => assets.updateMetadata(payload as CommandEnvelope<'asset.updateMetadata'>['payload']),
    'asset.trash': payload => assets.trash(payload as CommandEnvelope<'asset.trash'>['payload']),
    'asset.restore': payload => assets.restore(payload as CommandEnvelope<'asset.restore'>['payload']),
    'asset.saveArtifact': payload => assets.saveArtifact(payload as CommandEnvelope<'asset.saveArtifact'>['payload']),
  };
  const eventKinds: Record<keyof typeof commandContracts, DomainEvent['kind']> = { 'subproject.complete':'subproject.changed','project.memoryConfigure':'subproject.changed','project.memorySave':'subproject.changed','subproject.memoryRetry':'subproject.changed','subproject.continuity':'subproject.changed','project.assetAssign':'subproject.changed','project.assetTag':'subproject.changed','subproject.deliver':'subproject.changed','subproject.create':'subproject.changed','subproject.update':'subproject.changed','subproject.createCanvas':'subproject.changed', 'audio.reviewVoiceover':'audio.voiceoverReviewed', 'media.inspect':'media.inspected', 'render.prepare':'render.prepared', 'render.enqueue':'render.changed', 'render.cancel':'render.changed', 'render.resume':'render.changed', 'render.retry':'render.changed', 'media.prepareDerived':'render.prepared', 'media.enqueueDerived':'render.changed', 'audio.saveVoiceLine': 'audio.changed', 'audio.prepareSpeech': 'audio.changed', 'audio.approveSpeech': 'audio.changed', 'audio.prepareTranscription': 'generation.prepared', 'audio.saveTranscript': 'audio.changed', 'audio.stopBatch': 'audio.changed', 'timeline.create':'timeline.changed','timeline.applyOps':'timeline.changed','timeline.restore':'timeline.changed','timeline.prepareAssembly':'timeline.prepared','timeline.applyAssembly':'timeline.changed', 'shots.prepareProduction':'shots.prepared','shots.applyProduction':'shots.changed','shots.stopProduction':'shots.changed','shots.attachWorkflow':'shots.changed','shots.selectOutput':'creation.outputSelected', 'agent.createSession':'agent.sessionCreated','agent.prepareTurn':'agent.prepared','agent.approveTurn':'agent.changed','agent.acceptProposal':'agent.accepted','agent.stop':'agent.changed', 'finish.prepareTurn':'finish.prepared','finish.approveTurn':'finish.changed','finish.acceptProposal':'finish.accepted','finish.stop':'finish.changed', 'voice.refreshCatalog':'voice.managementChanged','voice.clone.prepare':'voice.managementChanged','voice.clone.approve':'voice.managementChanged','voice.clone.verify':'voice.managementChanged','voice.clone.reconcile':'voice.managementChanged','voice.replaceDialogues':'voice.changed','voice.bindDefault':'voice.changed','voice.prepareAudition':'audio.changed','voice.save':'voice.changed','voice.prepareReference':'render.prepared','dialogue.prepareAssembly':'render.prepared','dialogue.save':'dialogue.changed','dialogue.prepareProduction':'dialogueProduction.changed','dialogue.approveProduction':'dialogueProduction.changed','dialogue.stopProduction':'dialogueProduction.changed','dialogue.reviewTake':'dialogueProduction.changed','dialogue.confirmAudio':'dialogueProduction.changed','dialogue.prepareAlignment':'render.prepared','dialogue.importRepair':'dialogueProduction.changed','dialogue.prepareRepair':'dialogueProduction.changed','dialogue.reconcileSubmission':'dialogueProduction.changed','dialogue.selectTake':'dialogueProduction.changed', 'creation.saveEntity':'creation.entitySaved','creation.saveScript':'creation.scriptSaved','creation.saveShot':'creation.shotSaved','creation.selectOutput':'creation.outputSelected', 'workflow.prepare':'workflow.prepared','workflow.approveAndEnqueue':'workflow.changed','workflow.stop':'workflow.changed', 'canvas.applyCommand': 'canvas.changed', 'generation.prepare': 'generation.prepared', 'generation.approveAndEnqueue': 'generation.enqueued', 'task.releaseUnknownSlot':'task.changed', 'task.requestCancel': 'task.changed', 'task.reconcile': 'task.changed', 'task.retryCollection': 'task.changed', 'project.create': 'project.created', 'provider.saveConnection': 'provider.connectionSaved', 'model.saveDefinition': 'model.definitionSaved', 'profile.save': 'profile.saved', 'asset.importGrantedFiles': 'asset.imported', 'asset.saveArtifact': 'asset.versionSaved', 'asset.updateMetadata': 'asset.metadataUpdated', 'asset.trash': 'asset.trashed', 'asset.restore': 'asset.restored' };
  eventKinds['media.inspect'] = 'media.inspected';
  eventKinds['dialogue.confirmAudio'] = 'dialogue.audioConfirmed';
  function receipt(commandId: string): Result<CommandReceipt | null> {
    try {
      const row = library.db.prepare('SELECT receipt_json FROM command_receipt WHERE command_id=?').get(commandId);
      if (!row) return ok(null);
      const value: unknown = JSON.parse(row.receipt_json as string);
      return isReceipt(value) && value.libraryId === library.libraryId ? ok(value) : fail('INVALID_STORED_DATA', '已保存的命令回执无效。');
    } catch { return fail('RECEIPT_READ_FAILED', '无法读取命令回执。'); }
  }
  /** Accepted long-running commands reserve identity before their final receipt exists. */
  function identity(commandId: string, hash: string): Result<CommandReceipt | null> {
    const committed = receipt(commandId); if (!committed.ok) return committed;
    try {
      const accepted = library.db.prepare('SELECT request_hash FROM import_batch WHERE command_id=? UNION ALL SELECT request_hash FROM generation_command WHERE command_id=?').all(commandId, commandId);
      if ((committed.value && committed.value.requestHash !== hash) || accepted.some(row => row.request_hash !== hash)) return fail('COMMAND_ID_REUSED', '同一个命令 ID 已用于不同参数。');
      return committed;
    } catch { return fail('COMMAND_IDENTITY_READ_FAILED', '无法核实命令身份，请检查资料库。'); }
  }
  function commit(command: CommandEnvelope, hash: string, workflowPlan?: PreparedWorkflow, agentFlight?: Extract<Awaited<ReturnType<ReturnType<typeof agentsFor>['prepare']>>, {ok:true}>['value'], shotPlan?:PreparedShotProduction, timelinePlan?:PreparedAssembly, audioSource?: FrozenAudioSource, localPlan?: LocalMediaPlan, inspected?:ResolvedMedia, finishFlight?: Extract<Awaited<ReturnType<ReturnType<typeof finishFor>['prepare']>>, {ok:true}>['value'], dialoguePlan?: DialogueProductionPlan | DialogueTake | ConfirmedDialogueAudio,voiceFlight?:VoiceCatalog|VoiceCloneJob): Result<CommandReceipt> {
      const ownership = library.checkOwnership(); if (!ownership.ok) return ownership;
      try {
        library.db.exec('BEGIN IMMEDIATE');
        const previous = identity(command.commandId, hash);
        if (!previous.ok) { library.db.exec('ROLLBACK'); return previous; }
        if (previous.value) {
          library.db.exec('ROLLBACK');
          return ok(previous.value);
        }
        const scoped=scopes.guard(command);if(!scoped.ok){library.db.exec('ROLLBACK');return scoped;}
        if(inspected){const check=assets.assertSelectable(inspected.ref);if(!check.ok){library.db.exec('ROLLBACK');return check;}const {ref,probe,...metadata}=inspected;if(JSON.stringify(check.value)!==JSON.stringify(metadata)){library.db.exec('ROLLBACK');return fail('REFERENCE_CHANGED','媒体在分析期间改变。');}}
        if(localPlan&&'dialogueAssembly' in localPlan&&localPlan.dialogueAssembly){const checked=dialogueProduction.checkAssemblyPlan(localPlan);if(!checked.ok){library.db.exec('ROLLBACK');return checked;}}
        if(localPlan&&'dialogueAlignment' in localPlan&&localPlan.dialogueAlignment){const checked=dialogueProduction.checkAlignmentPlan(localPlan);if(!checked.ok){library.db.exec('ROLLBACK');return checked;}}
        const result = voiceFlight ? ok(voiceFlight) : inspected ? ok(inspected) : localPlan ? renders.savePrepared(localPlan) : audioSource ? audio.prepareTranscription(command.payload as CommandEnvelope<'audio.prepareTranscription'>['payload'], audioSource) : timelinePlan ? timelines.savePrepared(timelinePlan) : shotPlan ? shots.savePrepared(shotPlan) : finishFlight ? finish.savePrepared(finishFlight) : agentFlight ? agents.savePrepared(agentFlight) : workflowPlan ? workflows.savePrepared(workflowPlan) : dialoguePlan ? 'confirmedAt' in dialoguePlan ? dialogueProduction.saveConfirmedAudio(dialoguePlan) : 'origin' in dialoguePlan ? dialogueProduction.saveImportedRepair(dialoguePlan) : dialogueProduction.savePrepared(dialoguePlan) : command.kind === 'asset.importGrantedFiles'
          ? assets.publishImport(command.commandId, hash)
          : handlers[command.kind](command.payload, command.commandId);
        if (!result.ok) { library.db.exec('ROLLBACK'); return command.kind === 'asset.importGrantedFiles' ? assets.rejectImportTarget(command.commandId, hash, result.error) : result; }
        const registered=scopes.record(command,result.value);if(!registered.ok){library.db.exec('ROLLBACK');return registered;}
        if (!commandContracts[command.kind].isOutput(result.value)) throw new Error('Invalid command output');
        const inserted = library.db.prepare('INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,?,?)').run(library.libraryId, eventKinds[command.kind], JSON.stringify(result.value));
        const value: CommandReceipt = { libraryId: library.libraryId, commandId: command.commandId, requestHash: hash, committedSeq: Number(inserted.lastInsertRowid), result: result.value };
        library.db.prepare('INSERT INTO command_receipt(command_id,library_id,request_hash,receipt_json,committed_seq) VALUES(?,?,?,?,?)').run(command.commandId, library.libraryId, hash, JSON.stringify(value), value.committedSeq);
        library.db.exec('COMMIT');
        return ok(value);
      } catch { try { library.db.exec('ROLLBACK'); } catch { /* No open transaction. */ } return fail('COMMAND_COMMIT_FAILED', '命令未能提交，请检查资料库与磁盘空间。'); }
  }
  const router = {
    execute(input: unknown): Result<CommandReceipt> | Promise<Result<CommandReceipt>> {
      const ownership = library.checkOwnership(); if (!ownership.ok) return ownership;
      const parsed = parseCommand(input); if (!parsed.ok) return parsed;
      const command = parsed.value;
      if (command.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '命令不属于当前资料库。');
      if(command.scope){const synced=projectAssets.sync(command.scope.projectId);if(!synced.ok)return synced;}const checkedScope=scopes.guard(command);if(!checkedScope.ok)return checkedScope;
      const hash = requestHash(command);
      const previous = identity(command.commandId, hash); if (!previous.ok) return previous;
      if (previous.value) return ok(previous.value);
      if(['voice.refreshCatalog','voice.clone.prepare','voice.clone.approve','voice.clone.verify','voice.clone.reconcile'].includes(command.kind)){
        const flight=command.kind==='voice.refreshCatalog'?voiceManagement.refreshCatalog(command.payload as CommandEnvelope<'voice.refreshCatalog'>['payload']):command.kind==='voice.clone.prepare'?voiceManagement.prepare(command.payload as CommandEnvelope<'voice.clone.prepare'>['payload'],command.commandId):command.kind==='voice.clone.approve'?voiceManagement.approve(command.payload as CommandEnvelope<'voice.clone.approve'>['payload']):command.kind==='voice.clone.verify'?voiceManagement.verify(command.payload as CommandEnvelope<'voice.clone.verify'>['payload']):voiceManagement.reconcile(command.payload as CommandEnvelope<'voice.clone.reconcile'>['payload']);
        return flight.then(result=>result.ok?commit(command,hash,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,result.value):result);
      }
      if(command.kind==='media.inspect')return renders.inspectMedia(command.payload as CommandEnvelope<'media.inspect'>['payload']).then(result=>result.ok?commit(command,hash,undefined,undefined,undefined,undefined,undefined,undefined,result.value):result);
      if (command.kind === 'render.prepare') return renders.inspectPrepare(command.payload as CommandEnvelope<'render.prepare'>['payload']).then(result => result.ok ? commit(command,hash,undefined,undefined,undefined,undefined,undefined,result.value) : result);
      if (command.kind === 'media.prepareDerived') return renders.inspectDerived(command.payload as CommandEnvelope<'media.prepareDerived'>['payload']).then(result => result.ok ? commit(command,hash,undefined,undefined,undefined,undefined,undefined,result.value) : result);
      if(command.kind==='dialogue.prepareAssembly')return dialogueProduction.prepareAssembly(command.payload).then(result=>result.ok?commit(command,hash,undefined,undefined,undefined,undefined,undefined,result.value):result);
      if (command.kind === 'voice.prepareReference') return voices.prepareReference(command.payload as CommandEnvelope<'voice.prepareReference'>['payload']).then(result => result.ok ? commit(command,hash,undefined,undefined,undefined,undefined,undefined,result.value) : result);
      if (command.kind === 'dialogue.prepareAlignment') return dialogueProduction.prepareAlignment(command.payload as CommandEnvelope<'dialogue.prepareAlignment'>['payload']).then(result => result.ok ? commit(command,hash,undefined,undefined,undefined,undefined,undefined,result.value) : result);
      if (command.kind === 'dialogue.confirmAudio') return dialogueProduction.confirmAudio(command.payload as never).then(result => result.ok ? commit(command,hash,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,result.value) : result);
      if (command.kind === 'dialogue.importRepair') return dialogueProduction.importRepair(command.payload as CommandEnvelope<'dialogue.importRepair'>['payload']).then(result => result.ok ? commit(command,hash,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,result.value) : result);
      if (command.kind === 'dialogue.prepareRepair') return dialogueProduction.prepareRepair(command.payload as CommandEnvelope<'dialogue.prepareRepair'>['payload']).then(result => result.ok ? commit(command,hash,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,result.value) : result);
      if (command.kind === 'audio.prepareTranscription') return audio.inspectTranscription(command.payload as CommandEnvelope<'audio.prepareTranscription'>['payload']).then(result => result.ok ? commit(command, hash, undefined, undefined, undefined, undefined, result.value) : result);
      if(command.kind==='timeline.prepareAssembly')return timelines.prepareAssembly(command.payload as CommandEnvelope<'timeline.prepareAssembly'>['payload']).then(result=>result.ok?commit(command,hash,undefined,undefined,undefined,result.value):result);
      if(command.kind==='shots.prepareProduction') return shots.prepare(command.payload as CommandEnvelope<'shots.prepareProduction'>['payload']).then(prepared=>prepared.ok?commit(command,hash,undefined,undefined,prepared.value):prepared);
      if(command.kind==='agent.prepareTurn')return agents.prepare(command.payload as CommandEnvelope<'agent.prepareTurn'>['payload']).then(result=>result.ok?commit(command,hash,undefined,result.value):result);
      if(command.kind==='finish.prepareTurn')return finish.prepare(command.payload as CommandEnvelope<'finish.prepareTurn'>['payload']).then(result=>result.ok?commit(command,hash,undefined,undefined,undefined,undefined,undefined,undefined,undefined,result.value):result);
      if(command.kind==='workflow.prepare')return workflows.prepare(command.payload as CommandEnvelope<'workflow.prepare'>['payload']).then(result=>result.ok?commit(command,hash,result.value):result);
      if (command.kind === 'dialogue.reconcileSubmission') return generation.prepareAction(command as CommandEnvelope<'dialogue.reconcileSubmission'>, hash, () => { const checked = identity(command.commandId, hash); return checked.ok ? ok(undefined) : checked; }, () => dialogueProduction.reconcileSubmission(command.payload)).then(result => result.ok ? commit(command, hash) : result);
      if (command.kind === 'task.reconcile' || command.kind === 'task.retryCollection') return generation.prepareAction(command as CommandEnvelope<'task.reconcile' | 'task.retryCollection'>, hash, () => { const checked = identity(command.commandId, hash); return checked.ok ? ok(undefined) : checked; }).then(result => result.ok ? commit(command, hash) : result);
      if (command.kind === 'asset.importGrantedFiles') return assets.prepareImport(command as CommandEnvelope<'asset.importGrantedFiles'>, hash, () => {
        const checked = identity(command.commandId, hash); return checked.ok ? ok(undefined) : checked;
      }).then(result => result.ok ? commit(command, hash) : result);
      return commit(command, hash);
    },
    query(input: unknown) {
      const ownership = library.checkOwnership(); if (!ownership.ok) return ownership;
      const parsed = parseQuery(input); if (!parsed.ok) return parsed;
      const request = parsed.value;
      if (request.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '查询不属于当前资料库。');
      if (request.kind === 'project.list') return events.snapshot();
      if (request.kind === 'command.receipt') return receipt((request.payload as { commandId: string }).commandId);
      try {
        if(request.kind==='project.memory')return projectMemory.read((request.payload as {projectId:string}).projectId);
        if(request.kind==='project.assets')return projectAssets.catalog(request.payload);
        if(request.kind==='project.tasks'){const projectId=(request.payload as {projectId:string}).projectId,valid=subprojects.project(projectId);if(!valid.ok)return valid;return ok({libraryId:library.libraryId,projectId,items:generation.list().tasks.flatMap(task=>{const o=scopes.inferred('task',task.taskId);if(o?.projectId!==projectId)return [];const row=library.db.prepare('SELECT p.plan_json FROM generation_prepared p JOIN generation_task t USING(prepared_id) WHERE t.task_id=?').get(task.taskId),plan=row?JSON.parse(String(row.plan_json)):null;return [{task,subprojectId:o.subprojectId,canvasId:plan?.canvasInput?.canvasId??null}];})});}
        if(request.kind==='subproject.deliverables')return projectAssets.list(request.payload as import('../../contracts/src/subprojects.ts').WorkScope);
        if(request.kind==='subproject.list')return subprojects.list((request.payload as {projectId:string}).projectId);
        if(request.kind==='subproject.read')return subprojects.read(request.payload as import('../../contracts/src/subprojects.ts').WorkScope);
        if(request.kind==='subproject.canvases')return subprojects.listCanvases(request.payload as import('../../contracts/src/subprojects.ts').WorkScope);
        if (request.kind === 'render.list') return renders.list(request.payload as {projectId:string});
        if (request.kind === 'render.read') return renders.read(request.payload as {projectId:string;jobId:string});
        if (request.kind === 'render.plan') return renders.plan(request.payload as {projectId:string;planId:string});
        if (request.kind === 'media.derived') return renders.derived(request.payload as {projectId:string;planId:string});
        if (request.kind === 'audio.read') return audio.read(request.payload as { projectId: string });
        if (request.kind === 'audio.voiceoverContext') return audio.voiceoverContext(request.payload as { projectId: string; takeId: string });
        if (request.kind === 'audio.batch') return audio.batch(request.payload as { projectId: string; planId: string });
        if(request.kind==='timeline.exports')return exports.list(request.payload as {projectId:string;timelineId:string});
        if(request.kind==='timeline.list')return timelines.list(request.payload as {projectId:string});
        if(request.kind==='timeline.read')return timelines.read(request.payload as import('../../contracts/src/timeline.ts').TimelineReadInput);
        if(request.kind==='timeline.history')return timelines.history(request.payload as {projectId:string;timelineId:string});
        if(request.kind==='shots.production')return shots.read((request.payload as {productionId:string}).productionId);
        if(request.kind==='shots.collectionIssues')return shots.collectionIssues((request.payload as {productionId:string}).productionId);
        if(request.kind==='shots.history'){const p=request.payload as {projectId:string;shotId:string};return shots.history(p.projectId,p.shotId);}
        if (request.kind === 'agent.list') return agents.list((request.payload as {projectId:string}).projectId);
        if (request.kind === 'agent.read') return agents.read((request.payload as {sessionId:string}).sessionId);
        if (request.kind === 'agent.run') return agents.run((request.payload as {runId:string}).runId);
        if (request.kind === 'agent.templates') return ok(agents.templates());
        if (request.kind === 'finish.read') { const p=request.payload as {projectId:string;runId:string}; return finish.run(p.runId,p.projectId); }
        if (request.kind === 'finish.list') return finish.list((request.payload as {sessionId:string}).sessionId);
        if (request.kind === 'finish.templates') return ok(finish.templates());
        if(request.kind==='voice.qualification')return audio.qualification(request.payload as never);
        if(request.kind==='voice.catalog')return voiceManagement.catalog(request.payload as CommandEnvelope<'voice.refreshCatalog'>['payload']);
        if(request.kind==='voice.clone.list')return voiceManagement.list(request.payload as never);
        if(request.kind==='voice.clone.get')return voiceManagement.get(request.payload as {projectId:string;jobId:string});
        if(request.kind === 'voice.history')return voices.history(request.payload as {projectId:string;entityId?:string});
        if (request.kind === 'voice.list') return voices.list(request.payload as {projectId:string;entityId?:string});
        if (request.kind === 'voice.read') return voices.read(request.payload as {projectId:string;voiceRef:import('../../contracts/src/creation.ts').CreationRef});
        if (request.kind === 'dialogue.read') return voices.readDialogue(request.payload as {projectId:string;shotId:string;revision?:number});
        if (request.kind === 'dialogue.production') return dialogueProduction.production(request.payload as {projectId:string;planId:string});
        if (request.kind === 'dialogue.productions') return dialogueProduction.productions(request.payload as import('../../contracts/src/dialogue-production.ts').DialogueProductionListInput);
        if (request.kind === 'dialogue.takes') return dialogueProduction.takes(request.payload as {projectId:string;shotId:string});
        if(request.kind==='dialogue.reviewContext')return dialogueProduction.reviewContext(request.payload as {projectId:string;takeId:string});
        if (request.kind === 'voice.auditionStatus') return dialogueProduction.auditionStatus(request.payload as {projectId:string;voiceRef:import('../../contracts/src/creation.ts').CreationRef;profileRef:import('../../contracts/src/models.ts').RevisionRef;route:import('../../contracts/src/character-voice.ts').DialogueRoute});
        if (request.kind === 'creation.read') return creation.read(request.payload as import('../../contracts/src/creation.ts').CreationReadInput);
        if (request.kind === 'creation.history') return creation.history(request.payload as import('../../contracts/src/creation.ts').CreationHistoryInput);
        if(request.kind==='workflow.read')return workflows.read((request.payload as {workflowId:string}).workflowId);
        if(request.kind==='workflow.list')return ok(workflows.list());
        if (request.kind === 'canvas.read') return canvas.read((request.payload as { canvasId: string }).canvasId);
        if (request.kind === 'task.list') return ok(generation.list());
        if (request.kind === 'task.read') return generation.read((request.payload as { taskId: string }).taskId);
        if (request.kind === 'asset.search') return ok(assets.search(request.payload as import('../../contracts/src/assets.ts').AssetSearchInput));
        if (request.kind === 'asset.history') return assets.history(request.payload as { assetId: string });
        return ok(request.kind === 'provider.list' ? models.listConnections() : request.kind === 'model.list' ? models.listModels() : models.listProfiles());
      } catch { return fail('CONFIG_READ_FAILED', '无法读取模型配置快照。'); }
    },
  };
  return {...router,query(input:unknown){const parsed=parseQuery(input);if(!parsed.ok)return parsed;if(parsed.value.scope){const synced=projectAssets.sync(parsed.value.scope.projectId);if(!synced.ok)return synced;}const checked=scopes.guard(parsed.value,false);if(!checked.ok)return checked;return scopes.filter(parsed.value,router.query(input));}};
}
