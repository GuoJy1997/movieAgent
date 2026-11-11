import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SyncLipSyncAdapter } from '../../packages/providers/src/sync-lipsync.ts';

const video = Uint8Array.from([1, 2, 3]), audio = Uint8Array.from([4, 5, 6]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const prepared = {
  libraryId: 'library', preparedId: 'prepared', planHash: 'a'.repeat(64), expiresAt: Date.now() + 600000,
  projectId: 'project', inputVersion: 'v1', executionOwner: 'human', runId: 'run', prompt: '口型修正',
  adapterId: 'sync-lipsync-v2', estimateMicros: null, currency: null,
  config: {
    schemaVersion: 1,
    connection: { libraryId: 'library', id: 'connection', revision: 1, createdAt: new Date().toISOString(), name: 'Sync', adapterType: 'sync-lipsync-v2', baseUrl: 'https://api.sync.so', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 1000, concurrency: 1 },
    model: { libraryId: 'library', id: 'model', revision: 1, createdAt: new Date().toISOString(), name: 'Sync', modelId: 'lipsync-2', connectionRef: { libraryId: 'library', id: 'connection', revision: 1 }, capabilities: { taskTypes: ['lip_sync'], inputKinds: ['video', 'audio'], outputKinds: ['video'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } },
    profile: { libraryId: 'library', id: 'profile', revision: 1, createdAt: new Date().toISOString(), name: 'Sync', modelRef: { libraryId: 'library', id: 'model', revision: 1 }, parameters: {} }, parameters: {}, pricing: { status: 'unknown' },
  },
  lipSyncVideo: { ref: { kind: 'assetVersion', libraryId: 'library', assetId: 'video', version: 1 }, hash: hash(video), mime: 'video/mp4', byteLength: 3, durationTicks: 5 * 48000, probeId: 'probe-video' },
  lipSyncAudio: { ref: { kind: 'artifact', libraryId: 'library', artifactId: 'audio' }, hash: hash(audio), mime: 'audio/wav', byteLength: 3, durationTicks: 2 * 48000, probeId: 'probe-audio' },
} as any;

it('reposts an unknown submission only through explicit same-key reconciliation', async () => {
  const adapter = new SyncLipSyncAdapter();
  let posts = 0;
  const context: any = {
    requestLipSync: async (_input: unknown, dispatch: { clientRequestId: string }) => {
      posts++;
      expect(dispatch.clientRequestId).toBe('original-client');
      return { status: 200, bytes: Buffer.from(JSON.stringify({ id: 'sync-task' })) };
    },
  };
  const request = { clientRequestId: 'original-client', providerTaskId: null, request: prepared, outputStagingId: 'attempt-output' };
  expect(await adapter.reconcile(request, context)).toEqual({ kind: 'unsupported' });
  expect(posts).toBe(0);
  expect(await adapter.reconcile(request, { ...context, allowUnknownSubmission: true })).toEqual({ kind: 'accepted', providerTaskId: 'sync-task' });
  expect(posts).toBe(1);
  const gateway={...prepared,config:{...prepared.config,connection:{...prepared.config.connection,baseUrl:'https://compatible.example'}}};
  expect(await adapter.reconcile({...request,request:gateway},{...context,allowUnknownSubmission:true})).toEqual({kind:'unsupported'});
  expect(posts).toBe(1);
});

import { audioFixture, audioValue, audioExecute, fixtureWav } from '../fixtures/audio-generation.ts';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

async function unknownSyncTask(official=true) {
  let posts = 0, status = 503;
  const s = await audioFixture('sync-lipsync-v2', { native: true, providerContext: {
    requestLipSync: async () => { posts++; return { status, bytes: Buffer.from(posts > 1 ? JSON.stringify({ id: 'sync-task' }) : '') }; },
    queryLipSync: async () => { throw Error('known-id query must not be used for an unknown submission'); },
  } });
  // Only dispatch hooks above handle these inputs; no request reaches the official URL.
  if(official){
    const connection=s.engine.modelConfig.listConnections().connections.filter(c=>c.id==='audio').sort((a,b)=>b.revision-a.revision)[0]!;
    const {libraryId,revision,createdAt,...connectionInput}=connection;
    const connectionRef=audioValue(await audioExecute(s.engine,'provider.saveConnection',{...connectionInput,expectedRevision:revision,baseUrl:'https://api.sync.so',networkPolicy:{privateEndpoint:null}}));
    const model=s.engine.modelConfig.listModels().models.find(m=>m.id==='audio')!;const {libraryId:_l,revision:modelRevision,createdAt:_c,...modelInput}=model;
    const modelRef=audioValue(await audioExecute(s.engine,'model.saveDefinition',{...modelInput,connectionRef,expectedRevision:modelRevision}));
    s.profileRef=audioValue(await audioExecute(s.engine,'profile.save',{id:'audio',expectedRevision:1,name:'Official contract fixture',modelRef,parameters:{}}));
  }
  const audio = await s.importAudio(fixtureWav(1));
  const videoPath = join(s.root, 'source.mp4');
  expect(spawnSync(s.runtime!.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=32x32:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { shell: false, windowsHide: true }).status).toBe(0);
  const info = await stat(videoPath), grantId = crypto.randomUUID();
  audioValue(s.engine.assets.registerGrant({ grantId, importId: crypto.randomUUID(), libraryId: s.engine.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path: videoPath, realPath: await realpath(videoPath), allowedRoot: s.root, name: 'source.mp4', size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino }] }));
  const video = audioValue(await audioExecute(s.engine, 'asset.importGrantedFiles', { grantId })).versions[0];
  const audioProbe = audioValue(await s.engine.mediaInfo.ensure(audio)), videoProbe = audioValue(await s.engine.mediaInfo.ensure(video));
  const audioMetadata = audioValue(s.engine.assets.metadata(audio)), videoMetadata = audioValue(s.engine.assets.metadata(video));
  const plan = audioValue(s.engine.generation.prepare({ projectId: s.projectId, profileRef: s.profileRef, prompt: '单人口型修正', inputVersion: 'v1', executionOwner: 'human', runId: 'repair', lipSyncVideo: { ref: video, hash: videoMetadata.hash, mime: 'video/mp4', byteLength: videoMetadata.byteLength, durationTicks: videoProbe.durationTicks, probeId: videoProbe.probeId }, lipSyncAudio: { ref: audio, hash: audioMetadata.hash, mime: 'audio/wav', byteLength: audioMetadata.byteLength, durationTicks: audioProbe.durationTicks, probeId: audioProbe.probeId } }));
  const task = audioValue(await audioExecute(s.engine, 'generation.approveAndEnqueue', { preparedId: plan.preparedId, approvedPlanHash: plan.planHash, executionOwner: 'human', runId: 'repair', ...s.approval }));
  expect(audioValue(await s.engine.scheduler.run(task.attemptId)).state).toBe('SUBMISSION_UNKNOWN');
  expect(posts).toBe(1);
  return { s, task, posts: () => posts, accept: () => { status = 200; } };
}

it('does not repost on reopen and explicitly reconciles the original task within seven days', async () => {
  const { s, task, posts, accept } = await unknownSyncTask();
  await s.engine.close();
  const reopened = await s.open();
  audioValue(await reopened.scheduler.recover());
  expect(audioValue(reopened.generation.read(task.taskId)).state).toBe('RECONCILE_REQUIRED');
  expect(posts()).toBe(1);
  accept();
  expect(await reopened.generation.reconcile(task.taskId, true)).toMatchObject({ ok: true, value: { providerState: 'accepted', providerTaskId: 'sync-task' } });
  expect(posts()).toBe(2);
});

it('keeps a compatible gateway unknown with zero repeat POST even when explicitly requested',async()=>{
 const {s,task,posts,accept}=await unknownSyncTask(false);accept();
 expect(await s.engine.generation.reconcile(task.taskId,true)).toMatchObject({ok:false,error:{code:'IDEMPOTENCY_UNVERIFIED'}});expect(posts()).toBe(1);
});

it('refuses explicit unknown-submission replay after seven days', async () => {
  const { s, task, posts, accept } = await unknownSyncTask();
  accept();
  const db = new DatabaseSync(join(s.root, 'library.sqlite'));
  const intent = JSON.parse(db.prepare('SELECT intent_json FROM task_attempt WHERE attempt_id=?').get(task.attemptId)!.intent_json as string);
  intent.intendedAt = Date.now() - 7 * 86400000 - 1;
  db.prepare('UPDATE task_attempt SET intent_json=? WHERE attempt_id=?').run(JSON.stringify(intent), task.attemptId);
  db.close();
  expect(await s.engine.generation.reconcile(task.taskId, true)).toMatchObject({ ok: false, error: { code: 'SUBMISSION_RECONCILE_EXPIRED' } });
  expect(posts()).toBe(1);
});

it('exposes owner-scoped explicit reconciliation as an idempotent command', async () => {
  const { s, task, posts, accept } = await unknownSyncTask();
  accept();
  const input = { projectId: s.projectId, taskId: task.taskId, executionOwner: 'human' };
  expect(await audioExecute(s.engine, 'dialogue.reconcileSubmission', { ...input, executionOwner: 'other' })).toMatchObject({ ok: false, error: { code: 'APPROVAL_MISMATCH' } });
  const commandId = crypto.randomUUID();
  const [first, replay] = await Promise.all([
    audioExecute(s.engine, 'dialogue.reconcileSubmission', input, commandId),
    audioExecute(s.engine, 'dialogue.reconcileSubmission', input, commandId),
  ]);
  expect(first).toEqual(replay);
  expect(first).toMatchObject({ ok: true, value: { result: { providerState: 'accepted', providerTaskId: 'sync-task' } } });
  expect(posts()).toBe(2);
});

it('streams multipart chunks identical to the verified buffered encoding', async () => {
  const module = await import('../../packages/providers/src/sync-lipsync.ts');
  expect(module.streamLipSyncMultipart).toBeTypeOf('function');
  async function* chunks(bytes: Uint8Array) { yield bytes.subarray(0, 1); yield bytes.subarray(1); }
  const streamed = module.streamLipSyncMultipart!(prepared, { video: chunks(video), audio: chunks(audio) }, 'boundary-test');
  expect(streamed).toMatchObject({ ok: true }); if (!streamed.ok) return;
  const parts: Uint8Array[] = [];
  for await (const part of streamed.value.body) parts.push(part);
  const expected = module.buildLipSyncMultipart(prepared, { video, audio }, 'boundary-test');
  expect(expected.ok && Buffer.concat(parts).equals(expected.value)).toBe(true);
  expect(streamed.value.byteLength).toBe(expected.ok ? expected.value.byteLength : -1);
});

import { createHttpTransport } from '../../packages/providers/src/http-transport.ts';
import { createServer } from 'node:http';

it('writes an async request body with backpressure and an exact content length', async () => {
  let received = Buffer.alloc(0), contentLength: string | undefined;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      received = Buffer.concat(chunks); contentLength = request.headers['content-length'] as string;
      response.statusCode = 201; response.end(JSON.stringify({ id: 'sync-task' }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture address');
    async function* body() { yield Uint8Array.from([1, 2]); yield Uint8Array.from([3, 4]); }
    const connection: any = { adapterType: 'sync-lipsync-v2', baseUrl: `http://127.0.0.1:${address.port}`, networkPolicy: { privateEndpoint: { hostname: '127.0.0.1', port: address.port, purpose: 'model-api' } }, timeoutMs: 1000 };
    const response = await createHttpTransport().lipsync(connection, body(), 'multipart/form-data; boundary=sync-test', { 'content-length': '4' });
    expect(response.status).toBe(201);
    expect(received).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(contentLength).toBe('4');
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

import { createLipSyncCapability } from '../../apps/desktop/src/main/provider-capability.ts';

it('keeps media streaming through the privileged lip-sync capability', async () => {
  async function* chunks(bytes: Uint8Array) { yield bytes.subarray(0, 1); yield bytes.subarray(1); }
  let streaming = false, declaredLength = 0, uploaded = 0;
  const transport: any = { lipsync: async (_connection: unknown, body: AsyncIterable<Uint8Array>, _type: string, headers: Record<string, string>) => {
    streaming = !Buffer.isBuffer(body); declaredLength = Number(headers['content-length']);
    for await (const chunk of body) uploaded += chunk.byteLength;
    return { status: 201, bytes: Buffer.from(JSON.stringify({ id: 'sync-task' })) };
  } };
  const capability = createLipSyncCapability('library', {} as any, transport);
  const response = await capability(prepared, { attemptId: 'attempt', outputStagingId: 'attempt-output', clientRequestId: 'client', requestHash: 'a'.repeat(64), retries: 0 }, { video: chunks(video), audio: chunks(audio) });
  expect(response.status).toBe(201);
  expect(streaming).toBe(true);
  expect(uploaded).toBe(declaredLength);
  expect(uploaded).toBeGreaterThan(video.byteLength + audio.byteLength);
});
