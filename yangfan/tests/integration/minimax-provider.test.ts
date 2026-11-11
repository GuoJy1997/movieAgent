import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openLibrary, type LibraryHandle } from '../../packages/storage/src/database';
import { ProviderEvidence } from '../../packages/providers/src/probe';
import { MiniMaxVideoAdapter, videoRequestBody } from '../../packages/providers/src/minimax-video';
import { createImageGenerationCapability, createVideoGenerationCapability, createVideoQueryCapability } from '../../apps/desktop/src/main/provider-capability';
import { CredentialVault } from '../../apps/desktop/src/main/credential-vault';
import type { PreparedGeneration } from '../../packages/contracts/src/generation';
import { createHttpTransport } from '../../packages/providers/src/http-transport';

const roots: string[] = [], libraries: LibraryHandle[] = [], servers: Server[] = [];
const dispatch = { attemptId: 'attempt', outputStagingId: 'attempt-output', clientRequestId: 'client', requestHash: 'a'.repeat(64), retries: 0 as const };
export function videoPlan(baseUrl = 'https://api.minimax.cn/v1'): PreparedGeneration {
  const ref = (id: string) => ({ libraryId: 'lib', id, revision: 1 });
  const stored = { libraryId: 'lib', revision: 1, createdAt: new Date().toISOString() };
  const url = new URL(baseUrl);
  const pricing = { status: 'configured' as const, perSecond: 0.4, currency: 'CNY', version: '2026-10-25' };
  return { libraryId: 'lib', preparedId: 'prepared', planHash: 'a'.repeat(64), expiresAt: Date.now()+60000, projectId: 'project', inputVersion: 'v1', executionOwner: 'human', runId: 'r1', prompt: 'one moving tree', adapterId: 'minimax-video-v2', estimateMicros: 1600000, currency: 'CNY', config: { schemaVersion: 1, connection: { ...stored, id: 'c', name: 'Video', adapterType: 'minimax-video-v2', baseUrl, credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: url.hostname === '127.0.0.1' ? { hostname: url.hostname, port: Number(url.port), purpose: 'model-api' } : null }, timeoutMs: 1000, concurrency: 1 }, model: { ...stored, id: 'm', name: 'Video', modelId: 'MiniMax-H3-Highspeed', connectionRef: ref('c'), capabilities: { taskTypes: ['text_to_video'], inputKinds: ['text'], outputKinds: ['video'], maxBatch: 1 }, parameters: { duration: { type: 'integer', min: 4, max: 15, default: 4 }, resolution: { type: 'enum', values: ['768P'], default: '768P' }, ratio: { type: 'enum', values: ['21:9','16:9','4:3','1:1','3:4','9:16'], default: '9:16' } }, pricing }, profile: { ...stored, id: 'p', name: 'Video', modelRef: ref('m'), parameters: {} }, parameters: { duration: 4, resolution: '768P', ratio: '9:16' }, pricing } };
}
async function setup() {
  let response: unknown = { task_id: 'cloud-job' }, status = 200;
  const observed: { method: string; url: string; body: unknown; authorization?: string }[] = [];
  const server = createServer((req, res) => { let body = ''; req.on('data', c => body += c); req.on('end', () => { observed.push({ method: req.method!, url: req.url!, body: body ? JSON.parse(body) : null, authorization: req.headers.authorization }); res.writeHead(status); res.end(JSON.stringify(response)); }); }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw Error('server');
  const root = await mkdtemp(join(tmpdir(), 'minimax-fixture-')); roots.push(root); const opened = await openLibrary({ root: join(root, 'library') }); if (!opened.ok) throw Error('library'); libraries.push(opened.value);
  const p = videoPlan(`http://127.0.0.1:${address.port}/v1`); const vault = await CredentialVault.open(join(root, 'vault'), { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, []);
  const saved = await vault.put('fixture-video-key', { libraryId: 'lib', connectionId: 'c' }, 'session'); if (!saved.ok) throw Error('vault'); p.config.connection.credentialRef = saved.value;
  const adapter = new MiniMaxVideoAdapter(new ProviderEvidence(opened.value));
  const context = { evidence: 'fixture' as const, requestVideo: createVideoGenerationCapability('lib', vault), queryVideo: createVideoQueryCapability('lib', vault) };
  return { p, adapter, context, observed, vault, set: (v: unknown, code = 200) => { response = v; status = code; } };
}
afterEach(async () => { for (const s of servers.splice(0)) await new Promise<void>(r => s.close(() => r())); for (const l of libraries.splice(0)) await l.close(); for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
it('uses exact native POST/query paths, payload and credential scope', async () => {
  const s = await setup(); expect(await s.adapter.submit(s.p, { ...s.context, ...dispatch })).toEqual({ kind: 'accepted', providerTaskId: 'cloud-job' });
  expect(s.observed).toEqual([{ method: 'POST', url: '/v2/video_generation', body: { model: 'MiniMax-H3-Highspeed', content: [{ type: 'text', text: 'one moving tree' }], duration: 4, resolution: '768P', ratio: '9:16' }, authorization: 'Bearer fixture-video-key' }]);
  s.set({ task: { status: 'succeeded', content: { url: 'https://cdn.example/video.mp4?signature=private' } } });
  expect(await s.adapter.reconcile({ clientRequestId: 'client', providerTaskId: 'cloud-job', request: s.p }, s.context)).toEqual({ kind: 'completed', providerTaskId: 'cloud-job', output: { kind: 'url', url: 'https://cdn.example/video.mp4?signature=private' } });
  expect(s.observed[1]).toMatchObject({ method: 'GET', url: '/v2/query/video_generation/cloud-job', body: null });
});
it.each(['queued','running'])('keeps %s query accepted and retries only GET after transient failures', async status => {
  const s = await setup(), request = { clientRequestId: 'client', providerTaskId: 'cloud-job', request: s.p };
  s.set({ task: { status } }); expect(await s.adapter.reconcile(request, s.context)).toEqual({ kind: 'accepted', providerTaskId: 'cloud-job' });
  s.set({}, 503); expect(await s.adapter.reconcile(request, s.context)).toEqual({ kind: 'accepted', providerTaskId: 'cloud-job' });
  expect(await s.adapter.reconcile(request, { queryVideo: async () => { throw Error('offline'); } })).toEqual({ kind: 'accepted', providerTaskId: 'cloud-job' });
  expect(s.observed.every(x => x.method === 'GET')).toBe(true);
});
it.each(['failed','cancelled'])('maps terminal %s without inventing billing proof', async status => {
  const s = await setup(); s.set({ task: { status } }); expect(await s.adapter.reconcile({ clientRequestId: 'client', providerTaskId: 'cloud-job', request: s.p }, s.context)).toEqual({ kind: status, providerTaskId: 'cloud-job' });
});
it('does not resubmit malformed or ambiguous POST acceptance, and distinguishes explicit rejection', async () => {
  const s = await setup(); s.set({}); expect(await s.adapter.submit(s.p, { ...s.context, ...dispatch })).toEqual({ kind: 'unknown' });
  expect(await s.adapter.reconcile({ clientRequestId: 'client', providerTaskId: null, request: s.p }, s.context)).toEqual({ kind: 'unsupported' });
  s.set({}, 401); expect(await s.adapter.submit(s.p, { ...s.context, ...dispatch })).toEqual({ kind: 'rejected' }); expect(s.observed).toHaveLength(2);
  s.p.config.parameters.duration = 16; expect(videoRequestBody(s.p).ok).toBe(false);
  s.p.config.parameters.duration = 4; s.p.config.model.capabilities = { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 }; expect(videoRequestBody(s.p).ok).toBe(false);
});
it('keeps malformed query envelopes pending but records succeeded with missing or invalid output as completed unavailable', async () => {
  const s = await setup(), request = { clientRequestId: 'client', providerTaskId: 'cloud-job', request: s.p };
  for (const payload of [{}, { task: { id: 'other-job', status: 'succeeded', content: { url: 'https://cdn.example/other.mp4' } } }, { task: { status: 'new-unknown-state' } }]) {
    s.set(payload); expect(await s.adapter.reconcile(request, s.context)).toEqual({ kind: 'accepted', providerTaskId: 'cloud-job' });
  }
  for (const content of [{}, { url: 'not a URL' }, { url: 'file:///private.mp4' }]) {
    s.set({ task: { status: 'succeeded', content } }); expect(await s.adapter.reconcile(request, s.context)).toEqual({ kind: 'completed', providerTaskId: 'cloud-job', output: { kind: 'unavailable', reason: 'INVALID_VIDEO_RESPONSE' } });
  }
});
it('rejects forged query IDs and foreign credentials before network, and never shares model private grants with video downloads', async () => {
  const s = await setup();
  await expect(s.context.queryVideo(s.p, '../other')).rejects.toThrow('INVALID_VIDEO_CAPABILITY');
  s.p.config.connection.credentialRef!.connectionId = 'foreign';
  await expect(s.context.requestVideo(s.p, dispatch)).rejects.toThrow('INVALID_CREDENTIAL_OWNER');
  expect(s.observed).toHaveLength(0);
  await expect(createHttpTransport().download(s.p.config.connection.baseUrl + '/artifact.mp4', undefined, 64 * 1024 * 1024)).rejects.toThrow('NETWORK_POLICY');
  expect(s.observed).toHaveLength(0);
});
it('bounds native response bodies without retrying a POST', async () => {
  const s = await setup(); s.set({ padding: 'x'.repeat(1024 * 1024) });
  expect(await s.adapter.submit(s.p, { ...s.context, ...dispatch })).toEqual({ kind: 'unknown' }); expect(s.observed).toHaveLength(1);
});
it.each(['image POST','video POST','video GET'])('scopes and clears all credential headers when %s transport fails, rejecting foreign owners before transport', async kind => {
  const s = await setup(), extra = await s.vault.put('fixture-extra-secret', { libraryId: 'lib', connectionId: 'c' }, 'session'); if (!extra.ok) throw Error('vault');
  s.p.config.connection.headers['x-extra'] = extra.value;
  if (kind === 'image POST') {
    s.p.adapterId = 'openai-image-v1'; s.p.config.connection.adapterType = 'openai-image-v1';
    s.p.config.model.capabilities = { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 };
    s.p.config.model.parameters = {}; s.p.config.parameters = {}; s.p.config.model.pricing = { status: 'unknown' }; s.p.config.pricing = { status: 'unknown' };
  }
  let delivered: Record<string, string> | undefined, observed: Record<string, string> | undefined, calls = 0;
  async function failTransport(_connection: unknown, _body: unknown, headers: Record<string, string>): Promise<never> {
    calls++; delivered = headers; observed = { ...headers };
    throw Error('fixture transport failure');
  }
  const transport = { ...createHttpTransport(), model: failTransport, video: failTransport };
  const call = () => kind === 'image POST' ? createImageGenerationCapability('lib', s.vault, transport)(s.p, dispatch) : kind === 'video POST' ? createVideoGenerationCapability('lib', s.vault, transport)(s.p, dispatch) : createVideoQueryCapability('lib', s.vault, transport)(s.p, 'cloud-job');
  await expect(call()).rejects.toThrow('CREDENTIAL_USE_FAILED');
  expect(observed).toMatchObject({ authorization: 'Bearer fixture-video-key', 'x-extra': 'fixture-extra-secret', ...(kind === 'video GET' ? {} : { 'x-client-request-id': 'client' }) });
  expect(calls).toBe(1); expect(delivered).not.toHaveProperty('authorization'); expect(delivered).not.toHaveProperty('x-extra');
  s.p.config.connection.headers['x-extra'] = { ...extra.value, connectionId: 'foreign' };
  await expect(call()).rejects.toThrow('INVALID_CREDENTIAL_OWNER'); expect(calls).toBe(1);
});
it('enforces the native 7000-character prompt boundary before credentials or HTTP', async () => {
  const s = await setup(); s.p.prompt = '文'.repeat(7000); expect(videoRequestBody(s.p).ok).toBe(true);
  s.p.prompt += '文'; expect(videoRequestBody(s.p)).toMatchObject({ ok: false, error: { code: 'PROMPT_LIMIT' } });
  await expect(s.context.requestVideo(s.p, dispatch)).rejects.toThrow('INVALID_VIDEO_CAPABILITY'); expect(s.observed).toHaveLength(0);
});
it.each([7001, 16000])('queries an accepted legacy text-only snapshot with %i prompt characters while refusing a new submission', async length => {
  const s = await setup(); s.p.prompt = '文'.repeat(length);
  expect(videoRequestBody(s.p)).toMatchObject({ ok: false, error: { code: 'PROMPT_LIMIT' } });
  const url = 'https://cdn.example/accepted-legacy.mp4'; s.set({ task: { id: 'already-paid', status: 'succeeded', content: { url } } });
  expect(await s.adapter.reconcile({ clientRequestId: 'old-client', providerTaskId: 'already-paid', request: s.p }, s.context)).toEqual({ kind: 'completed', providerTaskId: 'already-paid', output: { kind: 'url', url } });
  expect((await s.context.queryVideo(s.p, 'already-paid')).status).toBe(200);
  expect(s.observed).toEqual(Array.from({ length: 2 }, () => ({ method: 'GET', url: '/v2/query/video_generation/already-paid', body: null, authorization: 'Bearer fixture-video-key' })));
  await expect(s.context.queryVideo(s.p, '../forged')).rejects.toThrow('INVALID_VIDEO_CAPABILITY');
  const wrongAdapter = structuredClone(s.p); wrongAdapter.adapterId = 'openai-image-v1';
  await expect(s.context.queryVideo(wrongAdapter, 'already-paid')).rejects.toThrow('INVALID_VIDEO_CAPABILITY');
  const wrongOwner = structuredClone(s.p); wrongOwner.config.model.connectionRef.libraryId = 'foreign';
  await expect(s.context.queryVideo(wrongOwner, 'already-paid')).rejects.toThrow('INVALID_VIDEO_CAPABILITY');
  const wrongEndpoint = structuredClone(s.p); wrongEndpoint.config.connection.baseUrl = 'http://public.example';
  await expect(s.context.queryVideo(wrongEndpoint, 'already-paid')).rejects.toThrow('INVALID_VIDEO_CAPABILITY');
  s.p.config.connection.credentialRef!.connectionId = 'foreign';
  await expect(s.context.queryVideo(s.p, 'already-paid')).rejects.toThrow('INVALID_CREDENTIAL_OWNER');
  expect(s.observed).toHaveLength(2);
});
