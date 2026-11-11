import {projectMemoryFor} from './project-memory-service.ts';
import {voiceManagementFor} from './voice-management-service.ts';
import {timelinesFor} from './timeline-service.ts';
import { exportRecordsFor } from './export-records.ts';
import { rendersFor, type LocalMediaOptions } from './render-service.ts';
import { renderSchedulerFor } from './render-scheduler.ts';
import { audioFor } from './audio-service.ts';
import { audioCoordinatorFor } from './audio-coordinator.ts';
import { OpenAISpeechAdapter } from '../../providers/src/openai-speech.ts';
import { MiniMaxSpeechAdapter } from '../../providers/src/minimax-speech.ts';
import { OpenAITranscriptionAdapter } from '../../providers/src/openai-transcription.ts';
import { MiniMaxTranscriptionAdapter } from '../../providers/src/minimax-transcription.ts';
import { agentsFor } from './agent-service.ts';
import { finishFor } from './finish-agent-service.ts';
import { characterVoiceFor } from './character-voice-service.ts';
import { dialogueProductionFor } from './dialogue-production-service.ts';
import { dialogueCoordinatorFor } from './dialogue-coordinator.ts';
import {mediaWorkQueue} from './media/work-queue.ts';
import {dialogueMediaVerifier} from './dialogue-media-verifier.ts';
import {workflowsFor} from './workflow-service.ts';
import { generationFor, type GenerationOptions } from './generation-service.ts';
import { schedulerFor } from './scheduler.ts';
import { openLibrary } from '../../storage/src/database.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { EngineIdentity } from '../../contracts/src/desktop.ts';
import { projectsFor } from './projects.ts';
import { commandRouterFor } from './command-router.ts';
import { eventStreamFor } from './event-stream.ts';
import { modelConfigFor } from './model-config-service.ts';
import { assetsFor } from './asset-service.ts';
import { mediaInfoFor } from './media-info-service.ts';
import { probeMediaFile, verifyAudioDecode } from './media/probe.ts';
import type { MediaRuntime } from '../../contracts/src/media-info.ts';
import type { ObjectStoreOptions } from '../../storage/src/object-store.ts';
import { OpenAIChatAdapter, AnthropicMessagesAdapter } from '../../providers/src/openai-chat.ts';
import { OpenAIImageEditAdapter } from '../../providers/src/openai-image-edit.ts';
import type { PreparedGeneration } from '../../contracts/src/generation.ts';
import { OpenAIImagesAdapter } from '../../providers/src/openai-images.ts';
import { MiniMaxVideoAdapter } from '../../providers/src/minimax-video.ts';
import { MiniMaxH3Adapter } from '../../providers/src/minimax-h3.ts';
import { SyncLipSyncAdapter } from '../../providers/src/sync-lipsync.ts';
import { adapterRegistry } from '../../providers/src/adapter-registry.ts';
import { ArtifactSource } from '../../providers/src/artifact-source.ts';
import { ProviderEvidence } from '../../providers/src/probe.ts';
import { LocalInputUnavailable, type ProviderContext } from '../../providers/src/image-provider.ts';
import { canvasFor } from './canvas-service.ts';
import { creationFor } from './creation-service.ts';
import { shotProductionFor } from './shot-production-service.ts';
import { parseCommand } from '../../contracts/src/commands.ts';
import type { CanvasCommit } from '../../contracts/src/canvas.ts';
import { shutdownFor, GRACEFUL_SHUTDOWN_MS, type ShutdownReport } from './shutdown.ts';
import { maintenanceFor } from './maintenance.ts';

export interface EngineHandle {
 readonly projectMemory:ReturnType<typeof projectMemoryFor>;
  readonly identity: EngineIdentity;
  readonly projects: ReturnType<typeof projectsFor>;
  readonly commands: ReturnType<typeof commandRouterFor>;
  readonly events: ReturnType<typeof eventStreamFor>;
  readonly modelConfig: ReturnType<typeof modelConfigFor>;
  readonly generation: ReturnType<typeof generationFor>;
  readonly workflows: ReturnType<typeof workflowsFor>;
  readonly scheduler: ReturnType<typeof schedulerFor>;
  readonly assets: ReturnType<typeof assetsFor>;
  readonly mediaInfo: ReturnType<typeof mediaInfoFor>;
  readonly timelines: ReturnType<typeof timelinesFor>;
  readonly renders: ReturnType<typeof rendersFor>;
  readonly exports: ReturnType<typeof exportRecordsFor>;
  readonly renderScheduler: ReturnType<typeof renderSchedulerFor>;
  readonly audio: ReturnType<typeof audioFor>;
  readonly agents: ReturnType<typeof agentsFor>;
  readonly finish: ReturnType<typeof finishFor>;
  readonly voiceManagement: ReturnType<typeof voiceManagementFor>;
  readonly voices: ReturnType<typeof characterVoiceFor>;
  readonly dialogue: { save: ReturnType<typeof characterVoiceFor>['saveDialogue']; read: ReturnType<typeof characterVoiceFor>['readDialogue'] };
  readonly dialogueProduction: ReturnType<typeof dialogueProductionFor>;
  readonly creation: ReturnType<typeof creationFor>;
  readonly shots: ReturnType<typeof shotProductionFor>;
  readonly canvas: ReturnType<typeof canvasFor> & { applyCanvasCommand(command: unknown): Promise<Result<CanvasCommit>> };
  close(): Promise<Result<void>>;
  quiesceEngine(reason: string, deadline: number): Promise<ShutdownReport>;
  readonly maintenance: ReturnType<typeof maintenanceFor>;
}
export async function startEngine(options: { root: string; identityGuardRoot?: string; runtime?: MediaRuntime; localMedia?: LocalMediaOptions; assets?: ObjectStoreOptions; generation?: GenerationOptions; providerContext?: ProviderContext }): Promise<Result<EngineHandle>> {
  const opened = await openLibrary(options);
  if (!opened.ok) return opened;
  const library = opened.value;
  const restoredPaused = library.schedulingPaused === true;
  const paused = () => fail('RESTORED_PROJECT_PAUSED', '恢复副本尚未启用执行。请关闭此项目，在项目启动页确认原项目已停止后启用。');
  const projects = projectsFor(library);
  const events = eventStreamFor(library);
  const modelConfig = modelConfigFor(library);
  const storageOptions: ObjectStoreOptions = { ...options.assets, ...(options.runtime ? { inspectAudio: async (path: string, stagingRoot: string, hash: string) => {
    const probe = await probeMediaFile(options.runtime!, path, stagingRoot, hash); if (!probe.ok) return probe;
    if (probe.value.width !== 0 || !probe.value.hasAudio) return fail('UNSUPPORTED_AUDIO', '请选择单音轨音频文件。');
    const decoded = await verifyAudioDecode(options.runtime!, path, stagingRoot); if (!decoded.ok) return decoded;
    return ok({ mime: probe.value.container === 'wav' ? 'audio/wav' : probe.value.container === 'mp3' ? 'audio/mpeg' : 'audio/mp4', width: 0, height: 0 });
  } } : {}) };
  const assets = assetsFor(library, storageOptions);
  const mediaInfo = mediaInfoFor({ library, assets, runtime: options.runtime, objectIO: assets });
  const timelines = timelinesFor({library,assets,mediaInfo});
  const mediaQueue=mediaWorkQueue();
  const rawRenders = rendersFor({ library, assets, timelines, mediaInfo, runtime: options.runtime, options: options.localMedia });
  const renders={...rawRenders,execute:async(jobId:string,controller:AbortController)=>{
    try{await mediaQueue.run(async signal=>{const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});try{await rawRenders.execute(jobId,controller);}finally{signal.removeEventListener('abort',abort);}},controller.signal);}
    catch{controller.abort();await rawRenders.execute(jobId,controller);}
  }};
  const verifyDialogueMedia=dialogueMediaVerifier(library,assets,mediaQueue,options.runtime);
  const exports = exportRecordsFor(library, assets, timelines, renders);
  const renderScheduler = renderSchedulerFor(renders);
  const creation = creationFor(library, assets);
  const canvas = canvasFor(library, assets);
  const spool = new ArtifactSource(library.root), videoSpool = new ArtifactSource(library.root, undefined, 'video'), textSpool = new ArtifactSource(library.root, undefined, 'text'), evidence = new ProviderEvidence(library);
  const audioSpool = new ArtifactSource(library.root, undefined, 'audio');
  async function referenceBytes(input: PreparedGeneration): Promise<Uint8Array[]> {
    const bytes: Uint8Array[] = [];
    for (const ref of input.referenceImages ?? []) { const read = await assets.readFixedOriginal(ref.ref, ref); if (!read.ok) throw new LocalInputUnavailable(read.error.code); bytes.push(read.value.bytes); }
    return bytes;
  }
  const context: ProviderContext | undefined = options.providerContext && {
    ...options.providerContext,
    requestLipSyncReconcile:async(input,dispatch)=>{
      if(!options.providerContext?.requestLipSyncReconcile){if(!context?.requestLipSync)throw Error('PROVIDER_UNAVAILABLE');return context.requestLipSync(input,dispatch,{video:new Uint8Array(),audio:new Uint8Array()});}
      // Desktop main obtains bounded hash-checked leases from this owned engine.
      return options.providerContext.requestLipSyncReconcile(input,dispatch,{video:new Uint8Array(),audio:new Uint8Array()});
    },
    requestAudio: async (input, dispatch) => {
      if (!options.providerContext?.requestAudio) throw Error('PROVIDER_UNAVAILABLE');
      let bytes: Uint8Array | undefined;
      if (input.audioSource) {
        const opened = await assets.openMediaRead(input.audioSource.ref, input.audioSource.hash);
        if (!opened.ok) throw Error(opened.error.code);
        try {
          if (opened.value.byteLength !== input.audioSource.byteLength || opened.value.byteLength > 24000000) throw Error('AUDIO_UPLOAD_LIMIT');
          const chunks: Uint8Array[] = [];
          for (let offset = 0; offset < opened.value.byteLength;) {
            const chunk = await assets.readMediaRange({ leaseId: opened.value.leaseId, offset, length: Math.min(1024 * 1024, opened.value.byteLength - offset) });
            if (!chunk.ok || !chunk.value.bytes.byteLength) throw Error('AUDIO_READ_FAILED');
            chunks.push(chunk.value.bytes); offset += chunk.value.bytes.byteLength;
          }
          bytes = Buffer.concat(chunks);
        } finally { await assets.closeMediaRead(opened.value.leaseId); }
      }
      const task = generation.attempt(dispatch.attemptId);
      const latest = task ? generation.read(task.task_id as string) : undefined;
      if (!latest?.ok || latest.value.cancelRequested || !generation.checkCurrent(input).ok) throw Error('AUDIO_BATCH_STOPPED');
      return options.providerContext.requestAudio(input, dispatch, bytes);
    },
    requestImageEdit: async (input, dispatch) => { if (!options.providerContext?.requestImageEdit) throw Error('PROVIDER_UNAVAILABLE'); return options.providerContext.requestImageEdit(input, dispatch, await referenceBytes(input)); },
    requestVideo: async (input, dispatch) => {
      if (!options.providerContext?.requestVideo) throw Error('PROVIDER_UNAVAILABLE');
      const audioBytes: Uint8Array[] = [];
      for (const ref of input.referenceAudio ?? []) {
        const opened = await assets.openMediaRead(ref.ref, ref.hash); if (!opened.ok) throw Error(opened.error.code);
        try {
          if (opened.value.byteLength !== ref.byteLength) throw Error('REFERENCE_INTEGRITY_FAILED');
          const chunks: Uint8Array[] = [];
          for (let offset = 0; offset < opened.value.byteLength;) {
            const chunk = await assets.readMediaRange({ leaseId: opened.value.leaseId, offset, length: Math.min(1024 * 1024, opened.value.byteLength - offset) });
            if (!chunk.ok || !chunk.value.bytes.byteLength) throw Error('REFERENCE_INTEGRITY_FAILED');
            chunks.push(chunk.value.bytes); offset += chunk.value.bytes.byteLength;
          }
          audioBytes.push(Buffer.concat(chunks));
        } finally { await assets.closeMediaRead(opened.value.leaseId); }
      }
      return options.providerContext.requestVideo(input, dispatch, await referenceBytes(input), audioBytes);
    },
    requestLipSync: async (input, dispatch) => {
      if (!options.providerContext?.requestLipSync) throw Error('PROVIDER_UNAVAILABLE');
      const read = (ref: NonNullable<PreparedGeneration['lipSyncVideo']>): AsyncIterable<Uint8Array> => (async function* () {
        const opened = await assets.openMediaRead(ref.ref, ref.hash); if (!opened.ok) throw Error(opened.error.code);
        try {
          if (opened.value.byteLength !== ref.byteLength) throw Error('REFERENCE_INTEGRITY_FAILED');
          for (let offset = 0; offset < opened.value.byteLength;) {
            const chunk = await assets.readMediaRange({ leaseId: opened.value.leaseId, offset, length: Math.min(1024 * 1024, opened.value.byteLength - offset) });
            if (!chunk.ok || !chunk.value.bytes.byteLength) throw Error('REFERENCE_INTEGRITY_FAILED');
            yield chunk.value.bytes; offset += chunk.value.bytes.byteLength;
          }
        } finally { await assets.closeMediaRead(opened.value.leaseId); }
      })();
      if (!input.lipSyncVideo || !input.lipSyncAudio) throw Error('INVALID_REFERENCE');
      return options.providerContext.requestLipSync(input, dispatch, { video: read(input.lipSyncVideo), audio: read(input.lipSyncAudio) });
    },
  };
  const configured = context ? {
    resolveAdapter: adapterRegistry([new OpenAIImagesAdapter(spool, evidence), new OpenAIImageEditAdapter(spool, evidence), new OpenAIChatAdapter(textSpool, evidence), new AnthropicMessagesAdapter(textSpool, evidence), new MiniMaxVideoAdapter(evidence), new MiniMaxH3Adapter(evidence), new SyncLipSyncAdapter(), new OpenAISpeechAdapter(audioSpool), new MiniMaxSpeechAdapter(audioSpool, textSpool), new OpenAITranscriptionAdapter(textSpool), new MiniMaxTranscriptionAdapter(textSpool)]), context,
    materializeOutput: (output, prepared, context, stagingId) => ((prepared.adapterId === 'openai-chat-v1' || prepared.adapterId === 'anthropic-messages-v1') ? textSpool : ['minimax-video-v2', 'minimax-h3-v2', 'sync-lipsync-v2'].includes(prepared.adapterId) ? videoSpool : spool).materialize(output, stagingId, context.signal),
    outputCollected: (prepared, source) => { if (!prepared.adapterId.includes('speech') && !prepared.adapterId.includes('transcription')) evidence.record(prepared, source === 'real' ? { authentication: 'accepted', generation: 'verified' } : source === 'fixture' ? { fixtureGeneration: true } : {}); },
  } satisfies GenerationOptions : options.generation;
  const generation = generationFor(library, modelConfig, configured ? { ...configured, ...audioCoordinatorFor(library, textSpool) } : undefined, storageOptions, canvas, assets);
  const audio = audioFor(library, generation, assets, mediaInfo);
  const workflows=workflowsFor(library,canvas,generation,modelConfig,assets);
  const shots=shotProductionFor(library,canvas,creation,modelConfig,assets,workflows);
  const projectMemory=projectMemoryFor(library,creation,assets,generation,modelConfig);
  const agents = agentsFor(library,generation,modelConfig,creation,assets);
  const voices = characterVoiceFor({library,creation,assets,mediaInfo,renders});
  const finish = finishFor(library,generation,modelConfig,creation,assets,timelines,audio,mediaInfo,voices);
  const dialogueProduction = dialogueProductionFor(library,generation,creation,assets,voices,renders,mediaInfo,audio,verifyDialogueMedia);
  const dialogueCoordinator = dialogueCoordinatorFor(library,generation,assets,options.runtime,verifyDialogueMedia);
  const baseScheduler=schedulerFor(library,generation);
  const scheduler={...baseScheduler,
    claim: (...args: Parameters<typeof baseScheduler.claim>) => restoredPaused ? paused() : baseScheduler.claim(...args),
    run: (...args: Parameters<typeof baseScheduler.run>) => restoredPaused ? Promise.resolve(paused()) : baseScheduler.run(...args),
    recover: () => restoredPaused ? Promise.resolve(paused()) : baseScheduler.recover(),
    wake: () => restoredPaused ? Promise.resolve(paused()) : baseScheduler.wake(),
    resume: () => { if (!restoredPaused) baseScheduler.resume(); },
    async start(){if(restoredPaused)return paused();const memoryStarted=await projectMemory.start();if(!memoryStarted.ok)return memoryStarted;const harvested=await agents.start();if(!harvested.ok)return harvested;const finishHarvested=await finish.start();if(!finishHarvested.ok)return finishHarvested;const dialogueHarvested=await dialogueCoordinator.start();if(!dialogueHarvested.ok)return dialogueHarvested;const started=await workflows.start();if(!started.ok)return started;void shots.start();renderScheduler.start();return baseScheduler.start();}};
  const voiceManagement=voiceManagementFor(library,modelConfig,generation,voices,audio,assets,mediaInfo,options.providerContext);
  const router = commandRouterFor(library, projects, events, modelConfig, assets, generation, canvas, workflows, creation, agents, finish, voices, dialogueProduction, shots, timelines, audio, renders, exports,voiceManagement,projectMemory);
  let admitting = true;
  const pending = new Set<Promise<unknown>>();
  const commands: ReturnType<typeof commandRouterFor> = { ...router, execute(input) {
    // These commands initialize/configure or edit a copy, without claiming work.
    const safeWhenPaused = new Set(['project.create','provider.saveConnection','model.saveDefinition','profile.save','credential.updateStatus','creation.saveEntity','creation.saveScript','creation.saveShot','voice.save','dialogue.save','audio.saveVoiceLine','audio.saveTranscript','timeline.create','timeline.applyOps','timeline.restore','canvas.applyCommand']);
    if (restoredPaused && (!input || typeof input !== 'object' || !safeWhenPaused.has(String((input as {kind?:unknown}).kind)))) return paused();
    if (!admitting) return fail('ENGINE_QUIESCING', '本机编排正在停止。云端任务可能继续；取消需要单独请求。');
    if (maintenance.active) return fail('MAINTENANCE_BUSY', '维护正在进行，请稍后再试。');
    const result = router.execute(input);
    if (result instanceof Promise) { pending.add(result); void result.finally(() => pending.delete(result)); }
    return result;
  } };
  // Resume persisted local collection only. This never contacts a provider.
  const recovery = restoredPaused ? Promise.resolve([]) : Promise.all(assets.pendingImports().map(pending => router.execute(pending)));
  const maintenance = maintenanceFor(library, async () => { shots.pause(); const memoryDrain=projectMemory.pause(); const agentDrain=agents.pause(); const finishDrain=finish.pause(); const dialogueDrain=dialogueCoordinator.pause(); const workflowDrain=workflows.pause(); const taskDrain=scheduler.pause(); const mediaDrain=renderScheduler.pause(); await memoryDrain; await agentDrain; await finishDrain; await dialogueDrain; await workflowDrain; await taskDrain; await mediaDrain; await recovery; await Promise.allSettled([...pending]); await assets.drain(); }, () => { if (admitting && !restoredPaused) { projectMemory.resume(); scheduler.resume(); workflows.resume(); agents.resume(); finish.resume(); dialogueCoordinator.resume(); shots.resume(); renderScheduler.resume(); } }, () => admitting);
  let schedulerDrain: Promise<void>;
  const quiesceEngine = shutdownFor(() => { admitting = false; const mediaDrain=mediaQueue.close(); shots.close(); const workflowDrain=workflows.close(); schedulerDrain = Promise.all([mediaDrain,projectMemory.close(),agents.close(),finish.close(),dialogueCoordinator.close(),workflowDrain,scheduler.close(),renderScheduler.close()]).then(()=>undefined); }, async () => { await schedulerDrain; await maintenance.drain(); await recovery; await Promise.allSettled([...pending]); await assets.drain(); await mediaInfo.drain(); await assets.closeMediaReads(); await renders.closeDerivedMediaReads(); }, () => library.close());
  return ok({
    projectMemory,
    voiceManagement,
    identity: {
      instanceId: library.instanceId,
      libraryId: library.libraryId,
      schemaVersion: library.schemaVersion,
      schedulingPaused: restoredPaused,
      nodeVersion: process.versions.node,
      sqliteVersion: (library.db.prepare('SELECT sqlite_version() AS version').get() as { version: string }).version,
    },
    projects,
    events,
    modelConfig,
    assets,
    mediaInfo,
    timelines,
    renders,
    exports,
    renderScheduler,
    audio,
    creation,
    shots,
    agents,
    finish,
    voices,
    dialogue: { save: voices.saveDialogue, read: voices.readDialogue },
    dialogueProduction,
    canvas: { ...canvas, async applyCanvasCommand(command) {
      const parsed = parseCommand(command);
      if (!parsed.ok) return parsed;
      if (parsed.value.kind !== 'canvas.applyCommand') return fail('INVALID_INPUT', '此入口只接受画布命令。');
      const result = await commands.execute(parsed.value);
      return result.ok ? ok(result.value.result as CanvasCommit) : result;
    } },
    generation,
    workflows,
    scheduler,
    commands,
    quiesceEngine,
    maintenance,
    close: async () => { const report = await quiesceEngine('close', Date.now() + GRACEFUL_SHUTDOWN_MS); return report.resourcesExited ? ok(undefined) : fail(report.errorCode ?? 'ENGINE_CLEANUP_PENDING', '本机编排已停止，清理尚未完成；下次启动将对账恢复。'); },
  });
}
