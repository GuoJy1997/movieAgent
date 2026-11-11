import { afterEach, expect, it } from 'vitest';
import sharp from 'sharp';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';
import { ArtifactSource } from '../../packages/providers/src/artifact-source';
import { createImageGenerationCapability, createVideoGenerationCapability, createVideoQueryCapability } from '../../apps/desktop/src/main/provider-capability';
import { CredentialVault } from '../../apps/desktop/src/main/credential-vault';
const roots: string[] = [], engines: EngineHandle[] = [], servers: Server[] = [];
const sample = await readFile(new URL('../fixtures/video-sample.mp4', import.meta.url));
const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#234567' } }).png().toBuffer();
function value(result: any): any { expect(result).toMatchObject({ ok: true }); return result.value?.result ?? result.value; }
const execute = (e: EngineHandle, kind: string, payload: unknown) => e.commands.execute({ schemaVersion: 1, libraryId: e.identity.libraryId, connectionEpoch: 'test', commandId: crypto.randomUUID(), kind, payload });
async function setup() {
  let posts = 0, images = 0, queries = 0, status = 'running', queryError = false, disconnect = false;
  const server = createServer((req, res) => { req.resume(); req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v2/video_generation') { posts++; if (disconnect) { req.socket.destroy(); return; } res.end(JSON.stringify({ task_id: 'video-task' })); return; }
    if (req.method === 'POST' && req.url === '/v1/images/generations') { images++; res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })); return; }
    if (req.method === 'GET' && req.url === '/v2/query/video_generation/video-task') { queries++; res.writeHead(queryError ? 503 : 200); res.end(JSON.stringify({ task: { id: 'video-task', status, content: status === 'succeeded' ? { url: 'https://cdn.example/fixture.mp4?private=signature' } : {} } })); return; }
    res.writeHead(404); res.end();
  }); }); servers.push(server); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const address = server.address(); if (!address || typeof address === 'string') throw Error('server');
  const root = await mkdtemp(join(tmpdir(), 'video-engine-')); roots.push(root);
  const vault = await CredentialVault.open(join(root, 'vault'), { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, []);
  let libraryId = '';
  const providerContext = { evidence: 'fixture' as const, requestImage: (input: any, dispatch: any) => createImageGenerationCapability(libraryId, vault)(input, dispatch), requestVideo: (input: any, dispatch: any) => createVideoGenerationCapability(libraryId, vault)(input, dispatch), queryVideo: (input: any, id: string) => createVideoQueryCapability(libraryId, vault)(input, id) };
  async function open() { const e: EngineHandle = value(await startEngine({ root, providerContext })); engines.push(e); libraryId = e.identity.libraryId; return e; }
  const engine = await open(), projectId = value(await execute(engine, 'project.create', { name: 'Video fixture' })).id;
  for (const kind of ['video','image']) {
    const connectionRef = value(await execute(engine, 'provider.saveConnection', { id: kind, expectedRevision: 0, name: kind, adapterType: kind === 'video' ? 'minimax-video-v2' : 'openai-image-v1', baseUrl: `http://127.0.0.1:${address.port}/v1`, credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: { hostname: '127.0.0.1', port: address.port, purpose: 'model-api' } }, timeoutMs: 1000, concurrency: 1 }));
    const modelRef = value(await execute(engine, 'model.saveDefinition', { id: kind, expectedRevision: 0, name: kind, modelId: kind === 'video' ? 'MiniMax-H3-Highspeed' : 'image-fixture', connectionRef, capabilities: { taskTypes: [kind === 'video' ? 'text_to_video' : 'text_to_image'], inputKinds: ['text'], outputKinds: [kind], maxBatch: 1 }, parameters: kind === 'video' ? { duration: { type: 'integer', min: 4, max: 15, default: 4 }, resolution: { type: 'enum', values: ['768P'], default: '768P' }, ratio: { type: 'enum', values: ['9:16'], default: '9:16' } } : {}, pricing: kind === 'video' ? { status: 'configured', currency: 'CNY', perSecond: 0.4, version: '2026-10-25' } : { status: 'unknown' } }));
    value(await execute(engine, 'profile.save', { id: kind, expectedRevision: 0, name: kind, modelRef, parameters: {} }));
  }
  async function enqueue(kind = 'video', e = engine) {
    const prepared = value(await execute(e, 'generation.prepare', { projectId, profileRef: { libraryId, id: kind, revision: 1 }, prompt: 'moving clouds', inputVersion: 'v1', executionOwner: 'human', runId: crypto.randomUUID() }));
    const input = { preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, currency: 'CNY', allowanceMicros: 1600000, budgetLimitMicros: 10000000, acknowledgeUnknown: true, executionOwner: prepared.executionOwner, runId: prepared.runId };
    const task = value(await execute(e, 'generation.approveAndEnqueue', input)); expect(value(await execute(e, 'generation.approveAndEnqueue', input))).toEqual(task); return task;
  }
  return { engine, root, open, enqueue, counts: () => ({ posts, images, queries }), status: (v: string) => { status = v; }, queryError: (v: boolean) => { queryError = v; }, disconnect: () => { disconnect = true; } };
}
afterEach(async () => { for (const e of engines.splice(0)) await e.close(); for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); } for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
it('persists native acceptance, preserves it on query failure, recovers without POST and publishes playable bytes alongside image tasks', async () => {
  const s = await setup(), task = await s.enqueue();
  expect(value(await s.engine.scheduler.run(task.attemptId))).toMatchObject({ state: 'RUNNING', providerState: 'accepted', providerTaskId: 'video-task', estimateMicros: 1600000 });
  s.queryError(true); expect(value(await s.engine.scheduler.run(task.attemptId))).toMatchObject({ state: 'RUNNING', providerState: 'accepted', providerTaskId: 'video-task' });
  await s.engine.close(); const reopened = await s.open(); value(await reopened.scheduler.recover()); expect(s.counts()).toMatchObject({ posts: 1, queries: 2 });
  // Public artifact downloads are covered separately; pre-stage the real immutable fixture so
  // the production bootstrap materializer must choose the video spool during recovery.
  value(await new ArtifactSource(s.root, undefined, 'video').stage(`${task.attemptId}-output`, sample));
  s.queryError(false); s.status('succeeded'); value(await reopened.scheduler.recover());
  const completed = value(reopened.generation.read(task.taskId)); expect(completed).toMatchObject({ state: 'SUCCEEDED', collectionState: 'durable', reportedActualMicros: null, reservationMicros: 1600000 });
  const original = value(await reopened.assets.read({ libraryId: reopened.identity.libraryId, ref: completed.artifactRef, variant: 'original' })); expect(original.mime).toBe('video/mp4'); expect(Buffer.from(original.bytes)).toEqual(sample);
  const saved = value(await execute(reopened, 'asset.saveArtifact', { artifactRef: completed.artifactRef, name: 'Video result' })); expect(reopened.assets.search().assets[0]).toMatchObject({ ref: saved, mime: 'video/mp4' });
  const image = await s.enqueue('image', reopened); expect(value(await reopened.scheduler.run(image.attemptId))).toMatchObject({ state: 'SUCCEEDED' });
  const evidence = reopened.modelConfig.listConnections().verification; expect(evidence.find(x => x.adapterId === 'minimax-video-v2')).toMatchObject({ generation: 'unverified', fixtureGeneration: true, capabilities: { textToVideo: 'adapter-declared', reconcile: 'provider-task-id' } }); expect(evidence.find(x => x.adapterId === 'openai-image-v1')?.fixtureGeneration).toBe(true);
  await reopened.close(); const again = await s.open(); value(await again.scheduler.recover()); expect(value(await again.assets.read({ libraryId: again.identity.libraryId, ref: saved, variant: 'original' })).mime).toBe('video/mp4'); expect(s.counts()).toMatchObject({ posts: 1, images: 1 });
  expect(JSON.stringify(again.generation.list())).not.toContain('private=signature');
});
it('keeps ambiguous native acceptance unreconciled across restart without a second paid request', async () => {
  const s = await setup(); s.disconnect(); const task = await s.enqueue(); value(await s.engine.scheduler.run(task.attemptId));
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ providerState: 'unknown', providerTaskId: null });
  await s.engine.close(); const reopened = await s.open(); value(await reopened.scheduler.recover()); value(await reopened.scheduler.run(task.attemptId));
  expect(value(reopened.generation.read(task.taskId))).toMatchObject({ state: 'RECONCILE_REQUIRED', reconcileStatus: 'unsupported' }); expect(s.counts()).toEqual({ posts: 1, images: 0, queries: 0 });
});
it.each(['failed','cancelled'])('journals native terminal %s and retains unknown bill reservation', async status => {
  const s = await setup(), task = await s.enqueue(); value(await s.engine.scheduler.run(task.attemptId)); s.status(status); value(await s.engine.scheduler.run(task.attemptId));
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: status === 'failed' ? 'FAILED' : 'CANCELLED', providerTaskId: 'video-task', providerState: 'rejected', reservationMicros: 1600000, settlementStatus: 'unknown' });
  value(await s.engine.scheduler.run(task.attemptId)); expect(s.counts()).toEqual({ posts: 1, images: 0, queries: 1 });
});
it('rejects an image returned for a video task without publishing a misleading video result or retrying POST', async () => {
  const s = await setup(), task = await s.enqueue(); value(await s.engine.scheduler.run(task.attemptId));
  value(await new ArtifactSource(s.root, undefined, 'video').stage(`${task.attemptId}-output`, png)); s.status('succeeded');
  expect(value(await s.engine.scheduler.run(task.attemptId))).toMatchObject({ providerState: 'completed', collectionState: 'unrecoverable', artifactRef: null, errorCode: 'UNEXPECTED_OUTPUT_MEDIA' });
  expect(s.counts()).toEqual({ posts: 1, images: 0, queries: 1 });
});
