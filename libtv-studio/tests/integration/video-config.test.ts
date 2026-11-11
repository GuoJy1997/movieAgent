import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';
import { parseSaveConnection, parseSaveModel, parseSaveProfile } from '../../packages/contracts/src/models';
import { estimateMicros } from '../../packages/domain/src/approval';

const engines: EngineHandle[] = [], roots: string[] = [];
const capabilities = { taskTypes: ['text_to_video'], inputKinds: ['text'], outputKinds: ['video'], maxBatch: 1 };
const parameters = { duration: { type: 'integer', min: 4, max: 15, default: 4 }, resolution: { type: 'enum', values: ['768P'], default: '768P' }, ratio: { type: 'enum', values: ['21:9','16:9','4:3','1:1','3:4','9:16'], default: '9:16' } };
const connection = { id: 'c', expectedRevision: 0, name: 'Video', adapterType: 'minimax-video-v2', baseUrl: 'https://api.minimax.cn/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1 };
const model = { id: 'm', expectedRevision: 0, name: 'Video', modelId: 'MiniMax-H3-Highspeed', connectionRef: { libraryId: 'lib', id: 'c', revision: 1 }, capabilities, parameters, pricing: { status: 'configured', currency: 'CNY', perSecond: 0.4, version: '2026-10-25' } };
afterEach(async () => { for (const e of engines.splice(0)) await e.close(); for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
it('accepts native video configuration while rejecting mismatched media parameters and pricing', () => {
  expect(parseSaveConnection(connection).ok).toBe(true);
  expect(parseSaveModel(model).ok).toBe(true);
  expect(parseSaveProfile({ id: 'p', expectedRevision: 0, name: 'Video', modelRef: { libraryId: 'lib', id: 'm', revision: 1 }, parameters: { duration: 15, ratio: '16:9', resolution: '768P' } }).ok).toBe(true);
  expect(parseSaveModel({ ...model, parameters: { size: { type: 'enum', values: ['1024x1024'], default: '1024x1024' } } }).ok).toBe(false);
  expect(parseSaveModel({ ...model, pricing: { status: 'configured', currency: 'CNY', perImage: 0.4, version: 'old' } }).ok).toBe(false);
  expect(parseSaveModel({ ...model, parameters: { ...parameters, duration: { type: 'integer', min: 1, max: 99, default: 4 } } }).ok).toBe(false);
});
it('freezes seconds and integer cost and rejects adapter/capability mismatch before enqueue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'video-config-')); roots.push(root);
  const opened = await startEngine({ root, providerContext: {} }); if (!opened.ok) throw Error('engine'); const e = opened.value; engines.push(e);
  async function run(kind: string, payload: unknown) { return e.commands.execute({ schemaVersion: 1, libraryId: e.identity.libraryId, connectionEpoch: 'test', commandId: crypto.randomUUID(), kind, payload }); }
  function value(r: any): any { expect(r).toMatchObject({ ok: true }); return r.value.result; }
  const projectId = value(await run('project.create', { name: 'Video' })).id;
  const ref = value(await run('provider.saveConnection', connection));
  value(await run('model.saveDefinition', { ...model, connectionRef: ref }));
  const profileRef = value(await run('profile.save', { id: 'p', expectedRevision: 0, name: 'Video', modelRef: { ...ref, id: 'm' }, parameters: {} }));
  const prepared = value(await run('generation.prepare', { projectId, profileRef, prompt: 'clouds move', inputVersion: 'v1', executionOwner: 'human', runId: 'r1' }));
  expect(prepared).toMatchObject({ adapterId: 'minimax-video-v2', estimateMicros: 1600000, currency: 'CNY', config: { parameters: { duration: 4, resolution: '768P', ratio: '9:16' } } });
  expect(estimateMicros({ ...prepared.config, parameters: { ...prepared.config.parameters, duration: 15 } })).toEqual({ ok: true, value: 6000000 });
  expect(estimateMicros({ ...prepared.config, pricing: { status: 'configured', currency: 'CNY', perSecond: 1000000, version: 'overflow' } })).toMatchObject({ ok: false, error: { code: 'PRICE_PRECISION' } });
  expect(estimateMicros({ ...prepared.config, parameters: { ...prepared.config.parameters, duration: 0 } }).ok).toBe(false);
  const imageRef = value(await run('provider.saveConnection', { ...connection, id: 'image', adapterType: 'openai-image-v1' }));
  expect(await run('model.saveDefinition', { ...model, id: 'bad', connectionRef: imageRef })).toMatchObject({ ok: false, error: { code: 'CONFIG_MISMATCH' } });
});
