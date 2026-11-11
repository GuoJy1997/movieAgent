import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';
import { freezeRunConfig, authorizeModelAddress } from '../../packages/domain/src/model-config';
import type { ModelDefinition, ModelProfile, ProviderConnection } from '../../packages/contracts/src/models';

const roots: string[] = []; const engines: EngineHandle[] = [];
async function setup(root?: string) {
  root ??= await mkdtemp(join(tmpdir(), 'libtv-models-')); if (!roots.includes(root)) roots.push(root);
  const result = await startEngine({ root }); if (!result.ok) throw new Error(result.error.message);
  engines.push(result.value); return { root, engine: result.value };
}
const connection = { id: 'connection-a', expectedRevision: 0, name: 'Image service', adapterType: 'openai-image-v1', baseUrl: 'https://images.example/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1 };
const ref = (engine: EngineHandle, id: string, revision = 1) => ({ libraryId: engine.identity.libraryId, id, revision });
const execute = (engine: EngineHandle, kind: string, payload: unknown, commandId = `command-${crypto.randomUUID()}`) => engine.commands.execute({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'client-epoch', commandId, kind, payload });
function query(engine: EngineHandle, kind: string) { return engine.commands.query({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'client-epoch', queryId: 'list', kind, payload: {} }); }
const model = (engine: EngineHandle) => ({ id: 'model-a', expectedRevision: 0, name: 'Main image model', modelId: 'dummy-image-model', connectionRef: ref(engine, 'connection-a'), capabilities: { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 }, parameters: { size: { type: 'enum', values: ['1024x1024', '1536x1024'], default: '1024x1024' }, quality: { type: 'enum', values: ['standard', 'high'], default: 'standard' } }, pricing: { status: 'unknown' } });
const profile = (engine: EngineHandle) => ({ id: 'profile-a', expectedRevision: 0, name: 'Storyboard', modelRef: ref(engine, 'model-a'), parameters: { size: '1024x1024', quality: 'standard' } });
afterEach(async () => { for (const engine of engines.splice(0)) await engine.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

// Missing real handlers or an UPDATE in place loses configuration history on reopen.
it('persists connection, model and immutable profile revisions and original receipts across reopen', async () => {
  const { root, engine } = await setup();
  const first = (await execute(engine, 'provider.saveConnection', connection, 'save-connection'));
  expect(first).toMatchObject({ ok: true, value: { committedSeq: 1, result: { id: 'connection-a', revision: 1 } } });
  expect((await execute(engine, 'model.saveDefinition', model(engine)))).toMatchObject({ ok: true });
  expect((await execute(engine, 'profile.save', profile(engine)))).toMatchObject({ ok: true });
  expect((await execute(engine, 'profile.save', { ...profile(engine), expectedRevision: 1, name: 'Final image', parameters: { size: '1536x1024', quality: 'high' } }))).toMatchObject({ ok: true, value: { result: { revision: 2 } } });
  expect((await execute(engine, 'profile.save', { ...profile(engine), expectedRevision: 1 }))).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  await engine.close(); const reopened = (await setup(root)).engine;
  expect((await execute(reopened, 'provider.saveConnection', connection, 'save-connection'))).toEqual(first);
  expect((await execute(reopened, 'provider.saveConnection', { ...connection, name: 'different' }, 'save-connection'))).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_REUSED' } });
  expect(query(reopened, 'provider.list')).toMatchObject({ ok: true, value: { connections: [{ id: 'connection-a', revision: 1 }], snapshotSeq: 4 } });
  expect(query(reopened, 'model.list')).toMatchObject({ ok: true, value: { models: [{ modelId: 'dummy-image-model' }] } });
  expect(query(reopened, 'profile.list')).toMatchObject({ ok: true, value: { profiles: [{ name: 'Storyboard', revision: 1, parameters: { size: '1024x1024' } }, { name: 'Final image', revision: 2, parameters: { size: '1536x1024' } }] } });
  expect(reopened.events.read({ libraryId: reopened.identity.libraryId, connectionEpoch: 'epoch', cursor: { libraryId: reopened.identity.libraryId, streamId: (query(reopened, 'provider.list') as any).value.streamId, seq: 0 } })).toMatchObject({ ok: true, value: { events: [{ kind: 'provider.connectionSaved' }, { kind: 'model.definitionSaved' }, { kind: 'profile.saved' }, { kind: 'profile.saved' }] } });
});

// Model configuration cannot grant the ordinary media downloader access to a private host.
it('rejects invalid endpoints, private hosts without exact authorization, raw headers and unsupported capabilities', async () => {
  const { engine } = await setup();
  for (const baseUrl of ['file:///secret', 'http://images.example/v1', 'https://user:password@images.example', 'https://images.example/?token=dummy', 'http://127.0.0.1:8080/v1', 'http://[::1]:8080', 'http://10.1.1.2:8080', 'https://2130706433', 'https://images.example/#key']) expect((await execute(engine, 'provider.saveConnection', { ...connection, baseUrl })).ok, baseUrl).toBe(false);
  expect((await execute(engine, 'provider.saveConnection', { ...connection, baseUrl: 'http://localhost:8080/v1', networkPolicy: { privateEndpoint: { hostname: 'localhost', port: 8081, purpose: 'model-api' } } })).ok).toBe(false);
  expect((await execute(engine, 'provider.saveConnection', { ...connection, baseUrl: 'http://localhost:8080/v1', networkPolicy: { privateEndpoint: { hostname: 'localhost', port: 8080, purpose: 'model-api' } } })).ok).toBe(true);
  for (const headers of [{ Host: 'dummy' }, { Authorization: 'dummy-test-secret' }, { 'X-Test\r\n': 'dummy' }, { 'X-Api-Key': 'dummy-test-secret' }]) expect((await execute(engine, 'provider.saveConnection', { ...connection, id: 'other', headers })).ok).toBe(false);
  for (const capabilities of [{ ...model(engine).capabilities, maxBatch: 2 }, { ...model(engine).capabilities, taskTypes: ['image_to_image'] }, { ...model(engine).capabilities, tools: true }]) expect((await execute(engine, 'model.saveDefinition', { ...model(engine), capabilities })).ok).toBe(false);
  expect((await execute(engine, 'model.saveDefinition', { ...model(engine), parameters: { execute: { type: 'javascript', code: 'dummy' } } })).ok).toBe(false);
});

// Missing library/revision checks could bind a profile to another library or unavailable version.
it('requires owned existing revisions and checks parameters against the bounded model descriptors', async () => {
  const { engine } = await setup(); (await execute(engine, 'provider.saveConnection', connection));
  expect((await execute(engine, 'model.saveDefinition', { ...model(engine), connectionRef: { ...ref(engine, 'connection-a'), libraryId: 'foreign' } }))).toMatchObject({ ok: false, error: { code: 'WRONG_LIBRARY' } });
  expect((await execute(engine, 'model.saveDefinition', { ...model(engine), connectionRef: ref(engine, 'connection-a', 9) }))).toMatchObject({ ok: false, error: { code: 'REVISION_NOT_FOUND' } });
  expect((await execute(engine, 'model.saveDefinition', model(engine))).ok).toBe(true);
  expect((await execute(engine, 'profile.save', { ...profile(engine), parameters: { size: 'unimplemented' } })).ok).toBe(false);
  expect((await execute(engine, 'profile.save', { ...profile(engine), parameters: { code: 'dummy' } })).ok).toBe(false);
  expect((await execute(engine, 'profile.save', profile(engine))).ok).toBe(true);
});

// Failure after the revision insert must not leave a configuration without its receipt.
it('rolls back a configuration revision if its event cannot commit and refuses forged credential references', async () => {
  const { root, engine } = await setup();
  const db = new DatabaseSync(join(root, 'library.sqlite'));
  db.exec("CREATE TRIGGER fail_model_event BEFORE INSERT ON domain_event BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  try {
    expect((await execute(engine, 'provider.saveConnection', connection))).toMatchObject({ ok: false, error: { code: 'COMMAND_COMMIT_FAILED' } });
    expect(query(engine, 'provider.list')).toMatchObject({ ok: true, value: { connections: [], snapshotSeq: 0 } });
  } finally { db.exec('DROP TRIGGER fail_model_event'); db.close(); }
  expect((await execute(engine, 'provider.saveConnection', { ...connection, credentialRef: { libraryId: engine.identity.libraryId, connectionId: connection.id, id: 'forged', version: 1 } }))).toMatchObject({ ok: false, error: { code: 'CREDENTIAL_UNAVAILABLE' } });
  expect((await execute(engine, 'provider.saveConnection', { ...connection, apiKey: 'dummy-test-secret' })).ok).toBe(false);
  expect((await readFile(join(root, 'library.sqlite'))).includes(Buffer.from('dummy-test-secret'))).toBe(false);
});

// A copied reference must not gain a new owner; revoked refs cannot be reactivated or silently reused.
it('accepts credentials only via trusted status registration and exposes explicit revocation without mutating old config revisions', async () => {
  const { root, engine } = await setup();
  (await execute(engine, 'provider.saveConnection', connection));
  const credentialRef = { libraryId: engine.identity.libraryId, connectionId: 'connection-a', id: 'dummy-credential-id', version: 1 };
  expect((await execute(engine, 'credential.status', { ref: credentialRef, state: 'protected' }))).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
  expect(engine.modelConfig.updateCredentialStatus({ ref: credentialRef, state: 'protected' }).ok).toBe(true);
  const bound = (await execute(engine, 'provider.saveConnection', { ...connection, expectedRevision: 1, credentialRef }));
  expect(bound).toMatchObject({ ok: true, value: { result: { revision: 2 } } });
  expect((await execute(engine, 'provider.saveConnection', { ...connection, id: 'connection-b', credentialRef }))).toMatchObject({ ok: false, error: { code: 'WRONG_CREDENTIAL_OWNER' } });
  expect(engine.modelConfig.updateCredentialStatus({ ref: credentialRef, state: 'revoked' }).ok).toBe(true);
  expect(engine.modelConfig.updateCredentialStatus({ ref: credentialRef, state: 'protected' })).toMatchObject({ ok: false, error: { code: 'CREDENTIAL_BINDING_CONFLICT' } });
  expect(query(engine, 'provider.list')).toMatchObject({ ok: true, value: { connections: [{ revision: 1, credentialRef: null }, { revision: 2, credentialRef }], credentialStatuses: [{ ref: credentialRef, state: 'revoked' }] } });
  expect((await execute(engine, 'provider.saveConnection', { ...connection, expectedRevision: 2, credentialRef }))).toMatchObject({ ok: false, error: { code: 'CREDENTIAL_UNAVAILABLE' } });
  await engine.close(); const reopened = (await setup(root)).engine;
  expect(query(reopened, 'provider.list')).toMatchObject({ ok: true, value: { credentialStatuses: [{ state: 'revoked' }] } });
});

// Copying mutable defaults into a queued run or accepting a rebound DNS address corrupts its authorization.
it('freezes detached run configuration and rejects changed references or private DNS resolutions without an exact model grant', async () => {
  const { engine } = await setup(); (await execute(engine, 'provider.saveConnection', connection)); (await execute(engine, 'model.saveDefinition', model(engine))); (await execute(engine, 'profile.save', profile(engine)));
  const savedConnection = (query(engine, 'provider.list') as any).value.connections[0] as ProviderConnection;
  const savedModel = (query(engine, 'model.list') as any).value.models[0] as ModelDefinition;
  const savedProfile = (query(engine, 'profile.list') as any).value.profiles[0] as ModelProfile;
  const frozen = freezeRunConfig(savedConnection, savedModel, savedProfile); if (!frozen.ok) throw new Error('freeze');
  savedProfile.parameters.size = '1536x1024'; savedConnection.name = 'changed';
  expect(frozen.value.profile.parameters.size).toBe('1024x1024'); expect(frozen.value.connection.name).toBe('Image service');
  expect(Object.isFrozen(frozen.value.connection.headers)).toBe(true); expect(frozen.value.pricing).toEqual({ status: 'unknown' });
  expect(freezeRunConfig(savedConnection, savedModel, { ...savedProfile, modelRef: ref(engine, 'model-a', 8) }).ok).toBe(false);
  expect(authorizeModelAddress(savedConnection, 'images.example', 443, '127.0.0.1').ok).toBe(false);
  expect(authorizeModelAddress(savedConnection, 'images.example', 443, '93.184.216.34').ok).toBe(true);
  const granted = { ...savedConnection, networkPolicy: { privateEndpoint: { hostname: 'images.example', port: 443, purpose: 'model-api' as const } } };
  expect(authorizeModelAddress(granted, 'images.example', 443, '10.0.0.1').ok).toBe(true);
  expect(authorizeModelAddress(granted, 'assets.example', 443, '10.0.0.1').ok).toBe(false);
  expect(authorizeModelAddress(granted, 'images.example', 444, '10.0.0.1').ok).toBe(false);
});
