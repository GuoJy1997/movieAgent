import { expect, it } from 'vitest';
import { SyncLipSyncAdapter, validateLipSyncInput, buildLipSyncMultipart } from '../../packages/providers/src/sync-lipsync.ts';
import { createHash } from 'node:crypto';

const video = Uint8Array.from([1, 2, 3]), audio = Uint8Array.from([4, 5, 6]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const prepared = {
  libraryId: 'library', preparedId: 'prepared', planHash: 'a'.repeat(64), expiresAt: Date.now() + 600000, projectId: 'project', inputVersion: 'v1', executionOwner: 'human', runId: 'run', prompt: '口型修正', adapterId: 'sync-lipsync-v2', providerTaskId: 'sync-task', estimateMicros: null, currency: null,
  config: {
    schemaVersion: 1,
    connection: { libraryId: 'library', id: 'connection', revision: 1, createdAt: new Date().toISOString(), name: 'Sync', adapterType: 'sync-lipsync-v2', baseUrl: 'https://api.sync.so', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 1000, concurrency: 1 },
    model: { libraryId: 'library', id: 'model', revision: 1, createdAt: new Date().toISOString(), name: 'Sync', modelId: 'lipsync-2', connectionRef: { libraryId: 'library', id: 'connection', revision: 1 }, capabilities: { taskTypes: ['lip_sync'], inputKinds: ['video', 'audio'], outputKinds: ['video'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } },
    profile: { libraryId: 'library', id: 'profile', revision: 1, createdAt: new Date().toISOString(), name: 'Sync', modelRef: { libraryId: 'library', id: 'model', revision: 1 }, parameters: {} }, parameters: {}, pricing: { status: 'unknown' },
  },
  lipSyncVideo: { ref: { kind: 'assetVersion', libraryId: 'library', assetId: 'video', version: 1 }, hash: hash(video), mime: 'video/mp4', byteLength: 3, durationTicks: 5 * 48000, probeId: 'probe-video' },
  lipSyncAudio: { ref: { kind: 'artifact', libraryId: 'library', artifactId: 'audio' }, hash: hash(audio), mime: 'audio/wav', byteLength: 3, durationTicks: 2 * 48000, probeId: 'probe-audio' },
} as any;

it('validates fixed lip-sync inputs and encodes cut_off multipart', () => {
  expect(validateLipSyncInput(prepared)).toMatchObject({ ok: true });
  const multipart = buildLipSyncMultipart(prepared, { video, audio }, 'boundary-test');
  expect(multipart.ok && multipart.value.toString()).toContain('cut_off');
  expect(multipart.ok && multipart.value.toString()).toContain('lipsync-2');
  expect(multipart.ok && multipart.value.toString()).toContain('filename="video.mp4"');
  expect(multipart.ok && multipart.value.toString()).toContain('filename="audio.wav"');
  expect(validateLipSyncInput({ ...prepared, lipSyncAudio: { ...prepared.lipSyncAudio, durationTicks: 6 * 48000 } }).ok).toBe(false);
  expect(validateLipSyncInput({ ...prepared, lipSyncAudio: { ...prepared.lipSyncAudio, byteLength: 4 * 1024 * 1024 + 1 } }).ok).toBe(false);
});

it('maps original-id submission, pending states, completion and recoverable 409/503', async () => {
  const adapter = new SyncLipSyncAdapter();
  const context: any = {
    requestLipSync: async () => ({ status: 201, bytes: Buffer.from(JSON.stringify({ id: 'sync-task' })) }),
    queryLipSync: async () => {
      const data = JSON.stringify({ id: 'sync-task', status: 'COMPLETED', output: { url: 'https://cdn.example/repaired.mp4' } });
      return { status: 200, bytes: Buffer.from(data) };
    },
  };
  expect(await adapter.submit(prepared, { ...context, retries: 0 })).toEqual({ kind: 'accepted', providerTaskId: 'sync-task' });
  expect(await adapter.reconcile({ clientRequestId: 'client', providerTaskId: 'sync-task', request: prepared }, context)).toEqual({ kind: 'completed', providerTaskId: 'sync-task', output: { kind: 'url', url: 'https://cdn.example/repaired.mp4' } });
  context.requestLipSync = async () => ({ status: 409, bytes: Buffer.alloc(0) });
  expect(await adapter.submit(prepared, { ...context, retries: 0 })).toEqual({ kind: 'accepted', providerTaskId: 'sync-task' });
  context.requestLipSync = async () => ({ status: 503, bytes: Buffer.alloc(0) });
  expect(await adapter.submit(prepared, { ...context, retries: 0 })).toEqual({ kind: 'accepted', providerTaskId: 'sync-task' });
});

import { audioFixture, audioValue, audioExecute, fixtureWav } from '../fixtures/audio-generation.ts';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { fileModelDefaults } from '../../packages/domain/src/model-config.ts';

it('confirms fixed audio, aligns local media, freezes repair and imports a manual take', async () => {
  const s = await audioFixture('openai-speech-v1', { native: true });
  const projectId = s.projectId;
  audioValue(await audioExecute(s.engine, 'creation.saveEntity', { projectId, id: 'a', expectedRevision: 0, kind: 'character', name: 'A', description: '', constraints: '', references: [] }));
  audioValue(await audioExecute(s.engine, 'creation.saveScript', { projectId, id: 'script', expectedRevision: 0, title: 'Story', synopsis: '', body: '', scenes: [{ id: 'scene', title: 'Scene', location: '', time: '', description: '' }] }));
  audioValue(await audioExecute(s.engine, 'creation.saveShot', { projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0, title: 'Shot', durationSeconds: 4, shotSize: 'wide', cameraMovement: '', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
  const voice = await s.importAudio(fixtureWav(1), 'voice.wav');
  const videoPath = join(s.root, 'source.mp4');
  expect(spawnSync(s.runtime!.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=32x32:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { shell: false, windowsHide: true }).status).toBe(0);
  const info = await stat(videoPath), real = await realpath(videoPath), grantId = crypto.randomUUID();
  audioValue(s.engine.assets.registerGrant({ grantId, importId: crypto.randomUUID(), libraryId: s.engine.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path: videoPath, realPath: real, allowedRoot: s.root, name: 'source.mp4', size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino }] }));
  const video = audioValue(await audioExecute(s.engine, 'asset.importGrantedFiles', { grantId })).versions[0];
  const voiceProbe = audioValue(await s.engine.mediaInfo.ensure(voice));
  audioValue(await audioExecute(s.engine, 'voice.save', { projectId, id: 'voice', expectedRevision: 0, draft: { entityRef: { id: 'a', revision: 1 }, name: 'A voice', dialect: '', performanceNotes: '', reference: { ref: voice, hash: voiceProbe.objectHash, probeId: voiceProbe.probeId, sourceInTicks: 0, durationTicks: 48000 } } }));
  audioValue(await audioExecute(s.engine, 'dialogue.save', { projectId, id: 'dialogue', expectedRevision: 0, draft: { shotRef: { id: 'shot', revision: 1 }, turns: [{ turnId: 'turn', characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, text: '你好', emotion: 'calm', startTicks: 24000, durationTicks: 48000, mode: 'dubbed-lipsync' }] } }));
  const confirmed = audioValue(await audioExecute(s.engine,'dialogue.confirmAudio',{ projectId, dialogueRef: { id: 'dialogue', revision: 1 }, source: { kind: 'imported-audio', media: voice }, expectedRevision: 1 }));
  expect(confirmed.source.probeId).toBeTruthy();
  const plan = audioValue(await audioExecute(s.engine, 'dialogue.prepareAlignment', { projectId, dialogueRef: { id: 'dialogue', revision: 1 }, sourceVideo: video, confirmedAudioRef: voice, startTicks: 24000, executionOwner: 'human', runId: 'align' }));
  const job = audioValue(s.engine.renders.enqueueDerived({ planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'align', diskBudgetBytes: plan.requiredFreeBytes }));
  expect(s.engine.renders.claim()).toBe(job.jobId);
  await s.engine.renders.execute(job.jobId, new AbortController());
  const aligned = audioValue(s.engine.renders.read({ projectId, jobId: job.jobId }));
  expect(aligned.outputRef, JSON.stringify(aligned)).not.toBeNull();
  const alignedProbe = audioValue(await s.engine.mediaInfo.ensure(aligned.outputRef));
  const alignedMetadata = audioValue(s.engine.assets.metadata(aligned.outputRef));
  const connectionRef = audioValue(await audioExecute(s.engine, 'provider.saveConnection', { id: 'sync', expectedRevision: 0, name: 'Sync', adapterType: 'sync-lipsync-v2', baseUrl: 'https://api.sync.so', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 1000, concurrency: 1 }));
  const modelRef = audioValue(await audioExecute(s.engine, 'model.saveDefinition', { id: 'sync', expectedRevision: 0, name: 'Sync', modelId: 'lipsync-2', connectionRef, ...fileModelDefaults('sync-lipsync-v2', {}) }));
  const profileRef = audioValue(await audioExecute(s.engine, 'profile.save', { id: 'sync', expectedRevision: 0, name: 'Sync', modelRef, parameters: {} }));
  const videoHash=audioValue(s.engine.assets.metadata(video)).hash;
  expect(await audioExecute(s.engine, 'dialogue.prepareRepair', { projectId, dialogueRef: { id: 'dialogue', revision: 1 }, alignedInput: { videoRef: video, audioRef: aligned.outputRef, durationTicks: alignedProbe.durationTicks, videoHash: alignedMetadata.hash, audioHash: alignedMetadata.hash }, profileRef, executionOwner: 'human', runId: 'forged' })).toMatchObject({ok:false});
  const repair = audioValue(await audioExecute(s.engine, 'dialogue.prepareRepair', { projectId, dialogueRef: { id: 'dialogue', revision: 1 }, alignedInput: { videoRef: video, audioRef: aligned.outputRef, durationTicks: alignedProbe.durationTicks, videoHash, audioHash: alignedMetadata.hash }, profileRef, executionOwner: 'human', runId: 'repair' }));
  expect(repair.route).toBe('dubbed-lipsync');
  expect(repair.items[0].prepared.lipSyncVideo.byteLength).toBeGreaterThan(0);
  const take = audioValue(await audioExecute(s.engine, 'dialogue.importRepair', { projectId, dialogueRef: { id: 'dialogue', revision: 1 }, sourceVideo: video, confirmedAudioRef: aligned.outputRef, repairedVideo: video }));
  expect(take.origin).toMatchObject({ kind: 'manual' });
  expect(take.reviewRevision).toBe(0);
  s.response(fixtureWav(1));
  const speechPlan = await s.batch(['固定配音']);
  const speechTasks = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: speechPlan.planId, planHash: speechPlan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  audioValue(await s.engine.scheduler.run(speechTasks.tasks[0].attemptId));
  const audioTake = audioValue(s.engine.audio.read({ projectId })).takes[0];
  const confirmedTake = await s.engine.dialogueProduction.confirmAudio({ projectId, dialogueRef: { id: 'dialogue', revision: 1 }, source: { kind: 'audio-take', takeId: audioTake.id }, expectedRevision: 1 });
  expect(confirmedTake).toMatchObject({ ok: true, value: { source: { hash: voiceProbe.objectHash } } });
  audioValue(await audioExecute(s.engine, 'creation.saveEntity', { projectId, id: 'b', expectedRevision: 0, kind: 'character', name: 'B', description: '', constraints: '', references: [] }));
  audioValue(await audioExecute(s.engine, 'voice.save', { projectId, id: 'voice-b', expectedRevision: 0, draft: { entityRef: { id: 'b', revision: 1 }, name: 'B voice', dialect: '', performanceNotes: '', reference: { ref: voice, hash: voiceProbe.objectHash, probeId: voiceProbe.probeId, sourceInTicks: 0, durationTicks: 48000 } } }));
  audioValue(await audioExecute(s.engine, 'dialogue.save', { projectId, id: 'dialogue', expectedRevision: 1, draft: { shotRef: { id: 'shot', revision: 1 }, turns: [{ turnId: 'turn', characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, text: '你好', emotion: 'calm', startTicks: 24000, durationTicks: 48000, mode: 'dubbed-lipsync' }, { turnId: 'turn-b', characterRef: { id: 'b', revision: 1 }, voiceRef: { id: 'voice-b', revision: 1 }, text: '你好', emotion: 'calm', startTicks: 72000, durationTicks: 48000, mode: 'dubbed-lipsync' }] } }));
  expect(await audioExecute(s.engine, 'dialogue.prepareRepair', { projectId, dialogueRef: { id: 'dialogue', revision: 2 }, alignedInput: { videoRef: video, audioRef: aligned.outputRef, durationTicks: alignedProbe.durationTicks, videoHash: alignedMetadata.hash, audioHash: alignedMetadata.hash }, profileRef, executionOwner: 'human', runId: 'repair-multi' })).toMatchObject({ ok: false, error: { code: 'MULTI_SPEAKER_LIPSYNC' } });
});
