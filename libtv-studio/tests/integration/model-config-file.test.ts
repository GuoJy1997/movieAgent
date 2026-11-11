import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModelConfig } from '../../apps/desktop/src/main/model-config-file';
import { importModelConfig, createModelConfigSynchronizer } from '../../apps/desktop/src/main/model-config-import';
import { modelConfigStore } from '../../apps/desktop/src/main/model-config-store';
import { CredentialVault } from '../../apps/desktop/src/main/credential-vault';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';
import { ok } from '../../packages/contracts/src/result';
import { isProviderSnapshot, type CredentialStatus } from '../../packages/contracts/src/models';

const roots: string[] = [], engines: EngineHandle[] = [];
const provider = { id: 'image-default', name: '默认图像服务', kind: 'image', baseURL: 'https://images.example/v1', apiKey: 'dummy-import-secret', modelId: 'image-1', allowPrivateEndpoint: false };
const blank = { ...provider, baseURL: '', apiKey: '', modelId: '' };
const protection = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(Buffer.from(s).map(v => v ^ 123)), decryptString: (b: Buffer) => Buffer.from(b).map(v => v ^ 123).toString() };
async function root() { const path = await mkdtemp(join(tmpdir(), 'model-file-')); roots.push(path); return path; }
async function file(path: string, providers: unknown[] = [provider]) { await writeFile(path, JSON.stringify({ schemaVersion: 1, providers })); return loadModelConfig(path); }
async function setup(available = true) {
  const path = await root(); const started = await startEngine({ root: join(path, 'library') }); if (!started.ok) throw Error('engine');
  const engine = started.value; engines.push(engine);
  const wire: unknown[] = [];
  const host = { identity: engine.identity, execute: async (v: unknown) => { wire.push(v); return engine.commands.execute(v); }, query: async (v: unknown) => { wire.push(v); return engine.commands.query(v); }, updateCredentialStatus: async (v: CredentialStatus) => { wire.push(v); return engine.modelConfig.updateCredentialStatus(v); }, credentialStatuses: async () => ok(engine.modelConfig.credentialStatuses()) };
  const vault = await CredentialVault.open(join(path, 'vault'), { ...protection, isEncryptionAvailable: () => available }, []);
  const loaded = await file(join(path, 'models.json')); if (!loaded.ok) throw Error('config');
  return { path, engine, host, vault, config: loaded.value, wire };
}
afterEach(async () => { for (const engine of engines.splice(0)) await engine.close(); for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });

// Removing full-file validation would import a valid first entry before an invalid second.
it('accepts BOM, blank entries and normalized URLs, and rejects malformed inputs without reflecting values', async () => {
  const path = join(await root(), 'models.json');
  await writeFile(path, '\ufeff' + JSON.stringify({ schemaVersion: 1, providers: [blank] }));
  expect(await loadModelConfig(path)).toMatchObject({ ok: true, value: { providers: [{ state: 'unconfigured' }] } });
  expect(await file(path, [{ ...provider, baseURL: 'https://IMAGES.example:443/v1/' }])).toMatchObject({ ok: true, value: { providers: [{ baseURL: 'https://images.example/v1' }] } });
  for (const data of [
    '{"apiKey":"dummy-import-secret"',
    JSON.stringify({ schemaVersion: 3, providers: [] }),
    JSON.stringify({ schemaVersion: 1, providers: [], unexpected: 'dummy-import-secret' }),
    JSON.stringify({ schemaVersion: 1, providers: Array.from({ length: 33 }, (_, i) => ({ ...provider, id: `p${i}` })) }),
    JSON.stringify({ schemaVersion: 1, providers: [provider, provider] }),
    ...[{ ...provider, kind: 'audio' }, { ...provider, apiKey: '' }, { ...provider, apiKey: 'dummy\nsecret' }, { ...provider, extra: true }, { ...provider, id: 'x'.repeat(114) }, { ...provider, modelId: 'invalid space' }].map(p => JSON.stringify({ schemaVersion: 1, providers: [p] })),
    ' '.repeat(65537),
  ]) {
    await writeFile(path, data); const result = await loadModelConfig(path); expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('dummy-import-secret');
  }
  await writeFile(path, Buffer.from([0xff])); expect((await loadModelConfig(path)).ok).toBe(false);
  expect(await loadModelConfig(join(path, 'missing'))).toMatchObject({ ok: false, error: { code: 'MODEL_CONFIG_READ_FAILED' } });
  const maximum = JSON.stringify({ schemaVersion: 1, providers: Array.from({ length: 8 }, (_, i) => ({ ...blank, id: `p${i}` })) });
  await writeFile(path, maximum + ' '.repeat(65536 - Buffer.byteLength(maximum)));
  expect((await loadModelConfig(path)).ok).toBe(true);
});

it('imports an explicit video entry with native defaults and preserves credential provenance on reload and legacy-kind correction', async () => {
  const s = await setup();
  expect((await importModelConfig(s)).ok).toBe(true);
  const before = s.engine.modelConfig.listConnections().connections.at(-1)!;
  const loaded = await file(join(s.path, 'video.json'), [{ ...provider, kind: 'video', modelId: 'MiniMax-H3-Highspeed', baseURL: 'https://api.minimax.cn/v1' }]);
  expect(loaded.ok).toBe(true); if (!loaded.ok) return;
  expect((await importModelConfig({ ...s, config: loaded.value })).ok).toBe(true);
  const connections = s.engine.modelConfig.listConnections().connections;
  expect(connections.at(-1)).toMatchObject({ adapterType: 'minimax-video-v2', credentialRef: before.credentialRef });
  expect(s.engine.modelConfig.listModels().models.at(-1)).toMatchObject({ modelId: 'MiniMax-H3-Highspeed', capabilities: { taskTypes: ['text_to_video','image_to_video'], inputKinds: ['text','image'], outputKinds: ['video'] }, pricing: { status: 'configured', perSecond: 0.4, currency: 'CNY', version: '2026-10-25' } });
  expect(s.engine.modelConfig.listProfiles().profiles.at(-1)?.parameters).toEqual({ duration: 4, ratio: '9:16', resolution: '768P' });
  expect((await importModelConfig({ ...s, config: loaded.value })).ok).toBe(true);
  expect(s.engine.modelConfig.listConnections().connections).toHaveLength(connections.length);
  expect(JSON.stringify(s.wire)).not.toContain('dummy-import-secret');
});

it('requires exact opt-in for private endpoints and always refuses public plaintext HTTP', async () => {
  const path = join(await root(), 'models.json');
  for (const baseURL of ['http://127.0.0.1:54321/v1', 'https://10.0.0.1/v1', 'http://[::1]:8765/v1']) {
    expect((await file(path, [{ ...provider, baseURL }])).ok).toBe(false);
    const result = await file(path, [{ ...provider, baseURL, allowPrivateEndpoint: true }]);
    expect(result).toMatchObject({ ok: true, value: { providers: [{ networkPolicy: { privateEndpoint: { hostname: new URL(baseURL).hostname, port: Number(new URL(baseURL).port || 443), purpose: 'model-api' } } }] } });
  }
  for (const baseURL of ['http://images.example/v1', 'https://user:dummy-import-secret@images.example', 'https://images.example/?key=dummy-import-secret']) {
    const result = await file(path, [{ ...provider, baseURL, allowPrivateEndpoint: true }]); expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('dummy-import-secret');
  }
});

it('rejects secrets pasted into public fields even when JSON or URL normalization escapes them', async () => {
  const path = join(await root(), 'models.json'); const apiKey = 'dummy-quoted-"-secret';
  for (const entry of [{ ...provider, apiKey, name: apiKey }, { ...provider, apiKey, baseURL: `https://images.example/${apiKey}` }]) {
    const result = await file(path, [entry]); expect(result).toMatchObject({ ok: false, error: { code: 'MODEL_CONFIG_SECRET_IN_PUBLIC_FIELD' } }); expect(JSON.stringify(result)).not.toContain('dummy-quoted');
  }
});

it('imports idempotently, preserves manual configs and old protected credentials, and sends no secret to engine', async () => {
  const s = await setup();
  const manual = { id: 'manual', expectedRevision: 0, name: 'Manual', adapterType: 'openai-image-v1', baseUrl: 'https://manual.example', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1 };
  expect((await s.host.execute({ schemaVersion: 1, libraryId: s.host.identity.libraryId, connectionEpoch: 'fixture', commandId: 'manual', kind: 'provider.saveConnection', payload: manual }) as { ok: boolean }).ok).toBe(true);
  expect(await importModelConfig(s)).toMatchObject({ ok: true, value: { state: 'ready', providerIds: ['image-default'], source: join(s.path, 'models.json') } });
  const before = s.engine.modelConfig.listConnections(); const old = before.connections.at(-1)!.credentialRef!;
  const envelopes = await readdir(join(s.path, 'vault'));
  expect((await importModelConfig(s)).ok).toBe(true);
  expect(s.engine.modelConfig.listConnections()).toEqual(before);
  expect(await readdir(join(s.path, 'vault'))).toEqual(envelopes);
  const changed = await file(join(s.path, 'models.json'), [{ ...provider, apiKey: 'dummy-changed-secret', baseURL: 'https://changed.example/v1' }]); if (!changed.ok) throw Error('changed');
  expect((await importModelConfig({ ...s, config: changed.value })).ok).toBe(true);
  const latest = s.engine.modelConfig.listConnections().connections.at(-1)!;
  expect(latest.revision).toBe(3); expect(latest.baseUrl).toBe('https://changed.example/v1'); expect(latest.credentialRef?.version).toBe(2);
  expect(await s.vault.withSecret(old, async secret => secret === provider.apiKey)).toEqual(ok(true));
  expect(s.engine.modelConfig.listModels().models).toHaveLength(2); expect(s.engine.modelConfig.listProfiles().profiles).toHaveLength(2);
  for (const providers of [[blank], []]) { const config = await file(join(s.path, 'models.json'), providers); if (!config.ok) throw Error('blank'); expect((await importModelConfig({ ...s, config: config.value })).ok).toBe(true); }
  expect(s.engine.modelConfig.listConnections().connections[0]).toMatchObject({ id: 'manual', revision: 1, name: 'Manual' });
  expect(s.engine.modelConfig.listConnections().connections).toHaveLength(5);
  expect(JSON.stringify(s.wire)).not.toContain('dummy-import-secret'); expect(JSON.stringify(s.wire)).not.toContain('dummy-changed-secret');
  await s.engine.close();
  const bytes = await readFile(join(s.path, 'library', 'library.sqlite')); expect(bytes.includes(Buffer.from(provider.apiKey))).toBe(false); expect(bytes.includes(Buffer.from('dummy-changed-secret'))).toBe(false);
});

it('keeps all revisions and credentials unchanged when repeatedly importing trailing-slash endpoints', async () => {
  const s = await setup();
  const loaded = await file(join(s.path, 'models.json'), [{ ...provider, baseURL: 'https://images.example/v1/////' }]);
  if (!loaded.ok) throw Error('fixture config');
  const options = { ...s, config: loaded.value };
  expect((await importModelConfig(options)).ok).toBe(true);
  const connections = s.engine.modelConfig.listConnections(), models = s.engine.modelConfig.listModels(), profiles = s.engine.modelConfig.listProfiles();
  const credentials = await readdir(join(s.path, 'vault'));
  for (let attempt = 0; attempt < 3; attempt++) {
    expect((await importModelConfig(options)).ok).toBe(true);
    expect(s.engine.modelConfig.listConnections()).toEqual(connections);
    expect(s.engine.modelConfig.listModels()).toEqual(models);
    expect(s.engine.modelConfig.listProfiles()).toEqual(profiles);
    expect(await readdir(join(s.path, 'vault'))).toEqual(credentials);
  }
});

it('fails before writes when protection is unavailable or later config validation fails', async () => {
  const s = await setup(false);
  expect(await importModelConfig(s)).toMatchObject({ ok: false, error: { code: 'SYSTEM_PROTECTION_UNAVAILABLE' } });
  expect(s.engine.modelConfig.listConnections().connections).toEqual([]); expect(await readdir(join(s.path, 'vault'))).toEqual([]);
  expect(await importModelConfig({ ...s, config: { ...s.config, providers: [...s.config.providers, { ...provider, apiKey: '' }] } as never })).toMatchObject({ ok: false });
  expect(s.engine.modelConfig.listConnections().connections).toEqual([]);
});

it('recovers lost command responses and orphan vault saves without adding credentials or revisions', async () => {
  const s = await setup(); let drop = true;
  const host = { ...s.host, execute: async (input: unknown) => { const result = await s.host.execute(input); if (drop) { drop = false; throw Error('dummy-import-secret'); } return result; } };
  const first = await importModelConfig({ ...s, host }); expect(first.ok).toBe(false); expect(JSON.stringify(first)).not.toContain(provider.apiKey);
  expect(s.engine.modelConfig.listConnections().connections).toHaveLength(1);
  const orphan = await s.vault.put(provider.apiKey, { libraryId: s.host.identity.libraryId, connectionId: 'file-image-default-connection' }); expect(orphan.ok).toBe(true);
  expect((await importModelConfig(s)).ok).toBe(true); expect(await readdir(join(s.path, 'vault'))).toHaveLength(1);
  expect(s.engine.modelConfig.listConnections().connections.at(-1)?.credentialRef).toEqual(orphan.ok && orphan.value);
  expect((await importModelConfig(s)).ok).toBe(true); expect(s.engine.modelConfig.listConnections().connections).toHaveLength(2);
});

it('does not adopt manual configs that collide with file-owned IDs', async () => {
  const s = await setup(); const payload = { id: 'file-image-default-connection', expectedRevision: 0, name: 'Manual', adapterType: 'openai-image-v1', baseUrl: 'https://manual.example', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1 };
  await s.host.execute({ schemaVersion: 1, libraryId: s.host.identity.libraryId, connectionEpoch: 'fixture', commandId: 'manual', kind: 'provider.saveConnection', payload });
  expect(await importModelConfig(s)).toMatchObject({ ok: false, error: { code: 'MODEL_CONFIG_ID_CONFLICT' } });
  expect(s.engine.modelConfig.listConnections().connections).toHaveLength(1); expect(await readdir(join(s.path, 'vault'))).toEqual([]);
});

it('retries a failed status sync using the same protected envelope and serializes simultaneous reloads', async () => {
  const s = await setup();
  const host = { ...s.host, updateCredentialStatus: async () => { throw Error(provider.apiKey); } };
  const first = await importModelConfig({ ...s, host }); expect(first.ok).toBe(false); expect(JSON.stringify(first)).not.toContain(provider.apiKey);
  expect(await readdir(join(s.path, 'vault'))).toHaveLength(1);
  const retry = await Promise.all([importModelConfig(s), importModelConfig(s)]); expect(retry.every(v => v.ok)).toBe(true);
  expect(await readdir(join(s.path, 'vault'))).toHaveLength(1); expect(s.engine.modelConfig.listConnections().connections).toHaveLength(2);
  expect(s.engine.modelConfig.listModels().models).toHaveLength(1); expect(s.engine.modelConfig.listProfiles().profiles).toHaveLength(1);
});

it('never reuses revoked, foreign-owner or session-only matches, and blank configs need no system protection', async () => {
  const s = await setup(); const owner = { libraryId: s.host.identity.libraryId, connectionId: 'file-image-default-connection' };
  const revoked = await s.vault.put(provider.apiKey, owner); if (!revoked.ok) throw Error('fixture credential'); await s.vault.revoke(revoked.value);
  await s.vault.put(provider.apiKey, { ...owner, connectionId: 'foreign' });
  await s.vault.put(provider.apiKey, owner, 'session');
  expect((await importModelConfig(s)).ok).toBe(true);
  expect(s.engine.modelConfig.listConnections().connections.at(-1)?.credentialRef?.version).toBe(3);
  expect(await s.vault.status(revoked.value)).toMatchObject({ ok: true, value: { state: 'revoked' } });
  const disabled = await setup(false); const config = await file(join(disabled.path, 'models.json'), [blank]); if (!config.ok) throw Error('blank');
  expect(await importModelConfig({ ...disabled, config: config.value })).toMatchObject({ ok: true, value: { state: 'unconfigured' } });
  expect(disabled.wire.every(v => typeof v === 'object' && v !== null && 'queryId' in v)).toBe(true);
});

it('imports V1 text with native bounded defaults and no repeated configuration revisions', async () => {
  const s = await setup(); const loaded = await file(join(s.path, 'text.json'), [{ ...provider, kind: 'text', modelId: 'text-fixture' }]);
  expect(loaded.ok).toBe(true); if (!loaded.ok) return;
  expect((await importModelConfig({ ...s, config: loaded.value })).ok).toBe(true);
  expect(s.engine.modelConfig.listConnections().connections.at(-1)).toMatchObject({ adapterType: 'openai-chat-v1' });
  expect(s.engine.modelConfig.listModels().models.at(-1)).toMatchObject({ capabilities: { taskTypes: ['text_to_text'], outputKinds: ['text'] }, parameters: { max_tokens: { type: 'integer', min: 1, max: 8192, default: 1024 } }, pricing: { status: 'unknown' } });
  expect(s.engine.modelConfig.listProfiles().profiles.at(-1)?.parameters).toEqual({ max_tokens: 1024 });
  expect((await importModelConfig({ ...s, config: loaded.value })).ok).toBe(true); expect(s.engine.modelConfig.listModels().models).toHaveLength(1);
  expect(JSON.stringify(s.wire)).not.toContain('dummy-import-secret');
});

it('deactivates only receipt-owned file connections and defaults, preserving historical credentials across retry', async () => {
  const s = await setup(); expect((await importModelConfig(s)).ok).toBe(true);
  const original = s.engine.modelConfig.listConnections().connections.at(-1)!;
  const manual = { id: 'file-manual-connection', expectedRevision: 0, name: 'Manual', adapterType: 'openai-image-v1', baseUrl: 'https://manual.example', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1 };
  await s.host.execute({ schemaVersion: 1, libraryId: s.host.identity.libraryId, connectionEpoch: 'fixture', commandId: 'manual-prefixed', kind: 'provider.saveConnection', payload: manual });
  const loaded = await file(join(s.path, 'models.json'), []); if (!loaded.ok) throw Error('config');
  expect((await importModelConfig({ ...s, config: loaded.value })).ok).toBe(true);
  const connections = s.engine.modelConfig.listConnections().connections;
  expect(connections.at(-1)).toMatchObject({ id: original.id, revision: 3, credentialRef: null });
  expect(connections.filter(p => p.id === manual.id)).toHaveLength(1);
  expect(s.engine.modelConfig.listModels().models.at(-1)).toMatchObject({ connectionRef: { revision: 3 } });
  expect(s.engine.modelConfig.listProfiles().profiles.at(-1)).toMatchObject({ modelRef: { revision: 2 } });
  expect(await s.vault.withSecret(original.credentialRef!, async secret => secret === provider.apiKey)).toEqual(ok(true));
  expect((await importModelConfig({ ...s, config: loaded.value })).ok).toBe(true);
  expect(s.engine.modelConfig.listConnections().connections).toEqual(connections);
});

it('retries project import after a successful file write and lost import ACK without rewriting the file or adding revisions',async()=>{
  const s=await setup();expect((await importModelConfig(s)).ok).toBe(true);
  const store=modelConfigStore(join(s.path,'models.json')),before=await store.readPublic();if(!before.ok)throw Error('read');
  const {hasKey:_k,state:_s,...fields}=before.value.providers[0]!;
  expect((await store.save({expectedVersion:before.value.version,provider:{...fields,name:'Changed image',parameters:{size:'1536x1024',quality:'high'},apiKey:'',clearKey:false}})).ok).toBe(true);
  const saved=await store.readPrivate();if(!saved.ok)throw Error('read');
  let drop=true;const host={...s.host,execute:async(input:unknown)=>{const result=await s.host.execute(input);if(drop){drop=false;throw Error('lost ACK');}return result;}};
  expect((await importModelConfig({...s,host,config:saved.value.config})).ok).toBe(false);
  expect((await importModelConfig({...s,config:saved.value.config})).ok).toBe(true);
  const snapshots=[s.engine.modelConfig.listConnections(),s.engine.modelConfig.listModels(),s.engine.modelConfig.listProfiles()];
  expect(snapshots[2]).toMatchObject({profiles:expect.arrayContaining([expect.objectContaining({parameters:{size:'1536x1024',quality:'high'}})])});
  expect((await importModelConfig({...s,config:saved.value.config})).ok).toBe(true);
  expect([s.engine.modelConfig.listConnections(),s.engine.modelConfig.listModels(),s.engine.modelConfig.listProfiles()]).toEqual(snapshots);
  expect(await store.readPrivate()).toEqual(saved);
  expect(await readdir(join(s.path,'vault'))).toHaveLength(1);
});

it('invalidates admission cache after partial import even when the file reverts to an earlier successful version',async()=>{
  const s=await setup(),path=join(s.path,'models.json'),original=await readFile(path,'utf8');let drop=false;
  const host={...s.host,execute:async(input:unknown)=>{const result=await s.host.execute(input);if(drop){drop=false;throw Error('lost ACK');}return result;}};
  const sync=createModelConfigSynchronizer({host,vault:s.vault,store:modelConfigStore(path)});
  expect((await sync.synchronize()).ok).toBe(true);
  await file(path,[{...provider,name:'Partially imported'}]);drop=true;
  expect((await sync.synchronize()).ok).toBe(false);
  expect(s.engine.modelConfig.listConnections().connections.at(-1)?.name).toBe('Partially imported');
  await writeFile(path,original);
  expect((await sync.synchronize()).ok).toBe(true);
  expect(s.engine.modelConfig.listConnections().connections.at(-1)?.name).toBe(provider.name);
});

it('imports and upgrades text connections to a five-minute timeout without rewriting older snapshots',async()=>{
 const s=await setup(),loaded=await file(join(s.path,'models.json'),[{...provider,id:'text-long',kind:'text',modelId:'text-model'}]);if(!loaded.ok)throw Error('fixture config');
 expect((await importModelConfig({...s,config:loaded.value})).ok).toBe(true);
 const current=()=>{const r=s.engine.commands.query({schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'fixture',queryId:'long-timeout',kind:'provider.list',payload:{}});if(!r.ok||!isProviderSnapshot(r.value))throw Error('connections');return r.value.connections.filter(x=>x.id==='file-text-long-connection');};
 const imported=current().at(-1)!;expect(imported.timeoutMs).toBe(300000);
 const {libraryId,createdAt,revision,...fields}=imported;
 expect((await s.engine.commands.execute({schemaVersion:1,libraryId,connectionEpoch:'fixture',commandId:'legacy-short-timeout',kind:'provider.saveConnection',payload:{...fields,timeoutMs:60000,expectedRevision:revision}})).ok).toBe(true);
 expect((await importModelConfig({...s,config:loaded.value})).ok).toBe(true);
 expect(current().at(-1)!.timeoutMs).toBe(300000);expect(current().find(x=>x.revision===revision+1)!.timeoutMs).toBe(60000);
 const count=current().length;expect((await importModelConfig({...s,config:loaded.value})).ok).toBe(true);expect(current()).toHaveLength(count);expect(s.engine.generation.list().tasks).toHaveLength(0);
});
