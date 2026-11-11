import { CURRENT_SCHEMA_VERSION } from '../../packages/contracts/src/schema.ts';
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap.ts';
import { imageProviderServer } from '../fixtures/image-provider-server.ts';
import { CredentialVault } from '../../apps/desktop/src/main/credential-vault.ts';
import { createImageGenerationCapability } from '../../apps/desktop/src/main/provider-capability.ts';
import sharp from 'sharp';
import { LocalConnection } from '../../apps/desktop/src/main/local-connection.ts';
import { CommandOutbox } from '../../apps/desktop/src/main/command-outbox.ts';
import { migrateProjects } from '../../packages/storage/src/migrations/0001-projects.ts';
import { migrateCommandEvents } from '../../packages/storage/src/migrations/0002-command-events.ts';
import { migrateModelConfig } from '../../packages/storage/src/migrations/0003-model-config.ts';
import { migrateAssets } from '../../packages/storage/src/migrations/0004-assets-collection.ts';
import { migrateGeneration } from '../../packages/storage/src/migrations/0005-generation.ts';
import { migrateProviderVerification } from '../../packages/storage/src/migrations/0006-provider-verification.ts';

const roots: string[] = [];
const engines: EngineHandle[] = [];
const servers: Awaited<ReturnType<typeof imageProviderServer>>[] = [];
function value(result: any): any {
  expect(result).toMatchObject({ ok: true });
  return result.value?.result ?? result.value;
}
const execute = (engine: EngineHandle, kind: string, payload: unknown, commandId: string = crypto.randomUUID()) =>
  engine.commands.execute({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'canvas-client', commandId, kind, payload });
function read(engine: EngineHandle, canvasId: string): any {
  return value(engine.commands.query({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'canvas-client', queryId: 'read', kind: 'canvas.read', payload: { canvasId } }));
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'libtv-canvas-'));
  roots.push(root);
  const server = await imageProviderServer();
  servers.push(server);
  server.setProtocol(true);
  server.setMode('completed');
  server.setImage(await sharp({ create: { width: 10, height: 5, channels: 3, background: '#ed3212' } }).png().toBuffer());
  let libraryId = '';
  async function open() {
    const vault = await CredentialVault.open(join(root, 'vault'), { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, []);
    const engine = value(await startEngine({ root, providerContext: { evidence: 'fixture', requestImage: (input, identity) => createImageGenerationCapability(libraryId, vault)(input, identity) } })) as EngineHandle;
    libraryId = engine.identity.libraryId;
    engines.push(engine);
    return engine;
  }
  const engine = await open();
  const projectId = value(await execute(engine, 'project.create', { name: 'Canvas' })).id;
  const profileRef = { libraryId, id: 'p', revision: 1 };
  value(await execute(engine, 'provider.saveConnection', { id: 'c', expectedRevision: 0, name: 'Fixture', adapterType: 'openai-image-v1', baseUrl: server.url, credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: { hostname: '127.0.0.1', port: Number(new URL(server.url).port), purpose: 'model-api' } }, timeoutMs: 1000, concurrency: 2 }));
  value(await execute(engine, 'model.saveDefinition', { id: 'm', expectedRevision: 0, name: 'Fixture', modelId: 'dummy', connectionRef: { libraryId, id: 'c', revision: 1 }, capabilities: { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } }));
  value(await execute(engine, 'profile.save', { id: 'p', expectedRevision: 0, name: 'Fixture', modelRef: { libraryId, id: 'm', revision: 1 }, parameters: {} }));
  const apply = (operations: unknown[], commandId: string = crypto.randomUUID(), target = engine) => execute(target, 'canvas.applyCommand', { canvasId: projectId, baseRevision: read(target, projectId).revision, operations }, commandId);
  const node = (target = engine, id = 'g') => read(target, projectId).nodes.find((n: any) => n.nodeId === id);
  const create = async () => value(await apply([{ kind: 'create', nodeId: 'g', content: { type: 'generation', prompt: 'A', profileRef, inputs: [] }, layout: { x: 10, y: 20 } }]));
  const edit = async (prompt: string) => { const n = node(); return value(await apply([{ kind: 'setContent', nodeId: 'g', incarnation: n.incarnation, expectedRevision: n.semanticRevision, content: { ...n.content, prompt } }])); };
  const prepare = async () => value(await execute(engine, 'generation.prepare', { projectId, canvasNode: { canvasId: projectId, nodeId: 'g' }, executionOwner: 'human', runId: 'run' }));
  const approve = (prepared: any) => execute(engine, 'generation.approveAndEnqueue', { preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, currency: 'USD', allowanceMicros: 1, budgetLimitMicros: 100, acknowledgeUnknown: true, executionOwner: 'human', runId: 'run' });
  const enqueue = async () => value(await approve(await prepare()));
  return { engine, root, server, projectId, profileRef, open, apply, node, create, edit, prepare, approve, enqueue };
}
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const engine of engines.splice(0)) await engine.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// Losing the independent field preconditions would reject a valid edit after an unrelated drag.
it('persists nodes and layout, replays receipts, and reports only relevant field conflicts', async () => {
  const s = await setup();
  await s.create();
  expect(s.node().freshness).toBe('none');
  const n = s.node();
  const content = { canvasId: s.projectId, baseRevision: 1, operations: [{ kind: 'setContent', nodeId: 'g', incarnation: n.incarnation, expectedRevision: 1, content: { ...n.content, prompt: 'B' } }] };
  value(await s.apply([{ kind: 'setLayout', nodeId: 'g', incarnation: n.incarnation, expectedRevision: 1, layout: { x: 99, y: 8 } }]));
  const committed = await execute(s.engine, 'canvas.applyCommand', content, 'content');
  value(committed);
  expect(await execute(s.engine, 'canvas.applyCommand', content, 'content')).toEqual(committed);
  const conflict = await execute(s.engine, 'canvas.applyCommand', content);
  expect(conflict).toMatchObject({ ok: false, error: { code: 'CANVAS_CONFLICT', fieldErrors: { 'g.content': expect.stringContaining('2') } } });
  if (!conflict.ok) expect(conflict.error.fieldErrors?.['g.content']).toContain('"prompt":"B"');
  expect(s.node()).toMatchObject({ content: { prompt: 'B' }, layout: { x: 99, y: 8 }, semanticRevision: 2, layoutRevision: 2 });
  await s.engine.close();
  const reopened = await s.open();
  expect(read(reopened, s.projectId)).toMatchObject({ revision: 3, nodes: [{ content: { prompt: 'B' }, layout: { x: 99, y: 8 } }] });
  expect(await execute(reopened, 'canvas.applyCommand', content, 'content')).toEqual(committed);
});

// Hash-only result guards would let A -> B -> A restore an obsolete run's ownership.
it('keeps a dispatched A result in history after A to B to A content edits', async () => {
  const s = await setup();
  await s.create();
  const task = await s.enqueue();
  s.server.hold();
  const running = s.engine.scheduler.run(task.attemptId);
  await expect.poll(() => s.server.posts).toBe(1);
  await s.edit('B');
  await s.edit('A');
  s.server.release();
  value(await running);
  expect(s.node()).toMatchObject({ selectedOutput: null, semanticRevision: 3 });
  expect(read(s.engine, s.projectId).outputs).toMatchObject([{ taskId: task.taskId, selection: 'history', artifactRef: { kind: 'artifact' } }]);
  expect(s.engine.modelConfig.listConnections().connections).toHaveLength(1);
  const db = new DatabaseSync(join(s.root, 'library.sqlite'), { readOnly: true });
  expect(JSON.parse(db.prepare('SELECT state_json FROM provider_verification').get()!.state_json as string)).toMatchObject({ fixtureGeneration: true, generation: 'unverified' });
  db.close();
});

it('gives repeated identical generations distinct bindings and restores selected output after reopen', async () => {
  const s = await setup();
  await s.create();
  const firstPrepared = await s.prepare();
  const secondPrepared = await s.prepare();
  const first = value(await s.approve(firstPrepared));
  const firstBinding = s.node().activeRunBindingId;
  const second = value(await s.approve(secondPrepared));
  expect(s.node().activeRunBindingId).not.toBe(firstBinding);
  value(await s.engine.scheduler.run(first.attemptId));
  expect(s.node().selectedOutput).toBeNull();
  value(await s.engine.scheduler.run(second.attemptId));
  const selected = value(s.engine.generation.read(second.taskId)).artifactRef;
  expect(s.node().selectedOutput).toEqual(selected);
  expect(s.node()).toMatchObject({ freshness: 'current', activeTask: { taskId: second.taskId, state: 'SUCCEEDED' } });
  await s.engine.close();
  const reopened = await s.open();
  expect(s.node(reopened).selectedOutput).toEqual(selected);
  expect(read(reopened, s.projectId).outputs).toHaveLength(2);
  expect(value(reopened.generation.read(first.taskId)).artifactRef).not.toBeNull();
});

it('manual selection of an old output prevents a later current run from replacing it', async () => {
  const s = await setup();
  await s.create();
  const first = await s.enqueue();
  value(await s.engine.scheduler.run(first.attemptId));
  const old = s.node().selectedOutput;
  const second = await s.enqueue();
  s.server.hold();
  const pending = s.engine.scheduler.run(second.attemptId);
  await expect.poll(() => s.server.posts).toBe(2);
  const n = s.node();
  value(await s.apply([{ kind: 'selectOutput', nodeId: 'g', incarnation: n.incarnation, expectedRevision: n.selectionRevision, output: old }]));
  s.server.release();
  value(await pending);
  expect(s.node().selectedOutput).toEqual(old);
  expect(read(s.engine, s.projectId).outputs.at(-1)).toMatchObject({ taskId: second.taskId, selection: 'history' });
  expect(await s.apply([{ kind: 'selectOutput', nodeId: 'g', incarnation: n.incarnation, expectedRevision: n.selectionRevision, output: old }])).toMatchObject({ ok: false, error: { code: 'CANVAS_CONFLICT', fieldErrors: { 'g.selection': expect.any(String) } } });
});

it('restores stored selected-output and reference-content undo after trash without admitting new selections', async () => {
  const s = await setup(); await s.create();
  const task = await s.enqueue(); value(await s.engine.scheduler.run(task.attemptId));
  const artifactRef = value(s.engine.generation.read(task.taskId)).artifactRef;
  const first = value(await execute(s.engine, 'asset.saveArtifact', { artifactRef, name: 'First' }));
  const second = value(await execute(s.engine, 'asset.saveArtifact', { artifactRef, name: 'Second' }));
  const select = (output: unknown, commandId?: string) => s.apply([{ kind: 'selectOutput', nodeId: 'g', incarnation: s.node().incarnation, expectedRevision: s.node().selectionRevision, output }], commandId);
  const reference = (ref: unknown, commandId?: string) => s.apply([{ kind: 'setContent', nodeId: 'g', incarnation: s.node().incarnation, expectedRevision: s.node().semanticRevision, content: { ...s.node().content, referenceImages: [{ role: 'reference', ref }] } }], commandId);
  value(await select(first)); value(await select(second, 'replace-selected-output'));
  value(await reference(first)); value(await reference(second, 'replace-reference-content'));
  value(await execute(s.engine, 'asset.trash', { assetId: first.assetId, expectedRevision: 1 }));
  expect(await select(first)).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(await reference(first)).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(await s.apply([{ kind: 'create', nodeId: 'new-reference', content: { ...s.node().content, referenceImages: [{ role: 'reference', ref: first }] }, layout: { x: 0, y: 0 } }])).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  const before = s.node();
  const undo = (commandId: string) => execute(s.engine, 'canvas.applyCommand', { canvasId: s.projectId, baseRevision: read(s.engine, s.projectId).revision, undoCommandId: commandId });
  const selected = await undo('replace-selected-output');
  expect(selected.ok ? 'restored' : selected.error.code).toBe('restored');
  expect(s.node()).toMatchObject({ selectedOutput: first, selectionRevision: before.selectionRevision + 1 });
  expect(await undo('replace-reference-content')).toMatchObject({ ok: true });
  expect(s.node()).toMatchObject({ content: { referenceImages: [{ ref: first }] }, semanticRevision: before.semanticRevision + 1 });
  expect(await execute(s.engine, 'generation.prepare', { projectId: s.projectId, canvasNode: { canvasId: s.projectId, nodeId: 'g' }, executionOwner: 'human', runId: 'after-undo' })).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(s.server.posts).toBe(1);
});

it('undoing deletion creates a new incarnation and cannot revive ownership of the old dispatched task', async () => {
  const s = await setup();
  await s.create();
  const task = await s.enqueue();
  s.server.hold();
  const pending = s.engine.scheduler.run(task.attemptId);
  await expect.poll(() => s.server.posts).toBe(1);
  const n = s.node();
  const deleted = value(await s.apply([{ kind: 'delete', nodeId: 'g', incarnation: n.incarnation, expectedSemanticRevision: n.semanticRevision, expectedLayoutRevision: n.layoutRevision, expectedSelectionRevision: n.selectionRevision, expectedRunBindingId: n.activeRunBindingId }], 'delete'));
  expect(read(s.engine, s.projectId).nodes).toHaveLength(0);
  value(await execute(s.engine, 'canvas.applyCommand', { canvasId: s.projectId, baseRevision: deleted.revision, undoCommandId: 'delete' }));
  expect(s.node().incarnation).not.toBe(n.incarnation);
  expect(s.node().activeRunBindingId).toBeNull();
  s.server.release();
  value(await pending);
  expect(s.node().selectedOutput).toBeNull();
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'SUCCEEDED', reservationMicros: 1 });
  expect(read(s.engine, s.projectId).outputs[0]).toMatchObject({ reason: 'incarnation' });
  const restored = s.node();
  value(await s.apply([{ kind: 'selectOutput', nodeId: 'g', incarnation: restored.incarnation, expectedRevision: restored.selectionRevision, output: value(s.engine.generation.read(task.taskId)).artifactRef }]));
  expect(s.node().selectedOutput).toMatchObject({ kind: 'artifact' });
});

it('undo preserves a later content edit while reversing the layout still owned by the original command', async () => {
  const s = await setup();
  await s.create();
  const n = s.node();
  value(await s.apply([
    { kind: 'setContent', nodeId: 'g', incarnation: n.incarnation, expectedRevision: 1, content: { ...n.content, prompt: 'B' } },
    { kind: 'setLayout', nodeId: 'g', incarnation: n.incarnation, expectedRevision: 1, layout: { x: 30, y: 40 } },
  ], 'combined'));
  await s.edit('C');
  const undo = value(await execute(s.engine, 'canvas.applyCommand', { canvasId: s.projectId, baseRevision: 3, undoCommandId: 'combined' }));
  expect(undo.skipped).toContain('g.content');
  expect(s.node()).toMatchObject({ content: { prompt: 'C' }, layout: { x: 10, y: 20 }, semanticRevision: 3, layoutRevision: 3 });
});

it('resolves fixed text input in the engine and rejects stale preparation after semantic editing', async () => {
  const s = await setup();
  await s.create();
  value(await s.apply([{ kind: 'create', nodeId: 'text', content: { type: 'text', text: 'fixed words' }, layout: { x: 0, y: 0 } }]));
  const text = s.node(s.engine, 'text');
  const n = s.node();
  value(await s.apply([{ kind: 'setContent', nodeId: 'g', incarnation: n.incarnation, expectedRevision: 1, content: { ...n.content, inputs: [{ nodeId: 'text', incarnation: text.incarnation, semanticRevision: 1 }] } }]));
  value(await s.apply([{ kind: 'setContent', nodeId: 'text', incarnation: text.incarnation, expectedRevision: 1, content: { type: 'text', text: 'new live text' } }]));
  const prepared = await s.prepare();
  expect(prepared.prompt).toBe('A\n\nfixed words');
  expect(prepared.canvasInput).toMatchObject({ canvasId: s.projectId, nodeId: 'g', semanticRevision: 2 });
  expect(await execute(s.engine, 'generation.prepare', { projectId: s.projectId, canvasNode: { canvasId: s.projectId, nodeId: 'g' }, prompt: 'forged', executionOwner: 'human', runId: 'run' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  await s.edit('changed');
  expect(await s.approve(prepared)).toMatchObject({ ok: false, error: { code: 'INPUT_CHANGED' } });
  expect(s.server.posts).toBe(0);
});

it('accepts fixed-text-only preparation but rejects an empty combined prompt', async () => {
  const s = await setup(); await s.create();
  await s.edit('');
  expect(await execute(s.engine, 'generation.prepare', { projectId: s.projectId, canvasNode: { canvasId: s.projectId, nodeId: 'g' }, executionOwner: 'human', runId: 'empty' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  value(await s.apply([{ kind: 'create', nodeId: 'text', content: { type: 'text', text: 'fixed only' }, layout: { x: 0, y: 0 } }]));
  const n = s.node(), text = s.node(s.engine, 'text');
  value(await s.apply([{ kind: 'setContent', nodeId: 'g', incarnation: n.incarnation, expectedRevision: n.semanticRevision, content: { ...n.content, inputs: [{ nodeId: 'text', incarnation: text.incarnation, semanticRevision: 1 }] } }]));
  value(await s.apply([{ kind: 'setContent', nodeId: 'text', incarnation: text.incarnation, expectedRevision: 1, content: { type: 'text', text: '' } }]));
  expect((await s.prepare()).prompt).toBe('fixed only');
  expect(s.server.posts).toBe(0);
});

it('rolls back canvas edit and run binding when receipt publication fails', async () => {
  const s = await setup();
  await s.create();
  const db = new DatabaseSync(join(s.root, 'library.sqlite'));
  db.exec("CREATE TRIGGER deny_canvas BEFORE INSERT ON command_receipt BEGIN SELECT RAISE(ABORT,'fixture'); END");
  expect(await s.apply([{ kind: 'setLayout', nodeId: 'g', incarnation: s.node().incarnation, expectedRevision: 1, layout: { x: 55, y: 55 } }])).toMatchObject({ ok: false, error: { code: 'COMMAND_COMMIT_FAILED' } });
  expect(s.node().layout).toEqual({ x: 10, y: 20 });
  db.exec('DROP TRIGGER deny_canvas');
  const prepared = await s.prepare();
  db.exec("CREATE TRIGGER deny_enqueue BEFORE INSERT ON domain_event WHEN NEW.kind='generation.enqueued' BEGIN SELECT RAISE(ABORT,'fixture'); END");
  expect(await s.approve(prepared)).toMatchObject({ ok: false, error: { code: 'COMMAND_COMMIT_FAILED' } });
  expect(s.node().activeRunBindingId).toBeNull();
  expect(db.prepare('SELECT COUNT(*) AS n FROM run_binding').get()).toMatchObject({ n: 0 });
  db.close();
});

it('publishes output history and current selection atomically with artifact and provider evidence', async () => {
  const s = await setup();
  await s.create();
  const task = await s.enqueue();
  const db = new DatabaseSync(join(s.root, 'library.sqlite'));
  db.exec("CREATE TRIGGER deny_verification BEFORE UPDATE ON provider_verification WHEN EXISTS(SELECT 1 FROM artifact) BEGIN SELECT RAISE(ABORT,'fixture'); END");
  value(await s.engine.scheduler.run(task.attemptId));
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ providerState: 'completed', collectionState: 'retryable_failure', artifactRef: null });
  expect(db.prepare('SELECT COUNT(*) AS n FROM artifact').get()).toMatchObject({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM canvas_output').get()).toMatchObject({ n: 0 });
  expect(JSON.parse(db.prepare('SELECT state_json FROM provider_verification').get()!.state_json as string)).toMatchObject({ generation: 'unverified' });
  expect(s.node().selectedOutput).toBeNull();
  db.exec('DROP TRIGGER deny_verification');
  const recovered = value(await execute(s.engine, 'task.retryCollection', { taskId: task.taskId }));
  expect(recovered).toMatchObject({ state: 'SUCCEEDED' });
  expect(s.node().selectedOutput).toEqual(recovered.artifactRef);
  expect(read(s.engine, s.projectId).outputs).toHaveLength(1);
  expect(db.prepare('SELECT COUNT(*) AS n FROM provider_verification').get()).toMatchObject({ n: 1 });
  expect(s.server.posts).toBe(1);
  db.close();
});

it('places a saved immutable asset version back onto an image node without following later asset versions', async () => {
  const s = await setup();
  await s.create();
  const task = await s.enqueue();
  value(await s.engine.scheduler.run(task.attemptId));
  const artifactRef = value(s.engine.generation.read(task.taskId)).artifactRef;
  const ref = value(await execute(s.engine, 'asset.saveArtifact', { artifactRef, name: 'Saved' }));
  value(await s.apply([{ kind: 'create', nodeId: 'image', content: { type: 'image', media: ref }, layout: { x: 3, y: 4 } }]));
  const ref2 = value(await execute(s.engine, 'asset.saveArtifact', { artifactRef, name: 'Saved', assetId: ref.assetId, expectedVersion: 1 }));
  expect(ref2.version).toBe(2);
  expect(s.node(s.engine, 'image').content.media).toEqual(ref);
  await s.edit('B');
  expect(s.node().freshness).toBe('stale');
  const queued = await s.enqueue();
  expect(s.node()).toMatchObject({ freshness: 'stale', activeTask: { taskId: queued.taskId, state: 'QUEUED' }, selectedOutput: artifactRef });
  value(await s.apply([{ kind: 'selectOutput', nodeId: 'g', incarnation: s.node().incarnation, expectedRevision: s.node().selectionRevision, output: ref }]));
  expect(s.node().freshness).toBe('unknown');
  expect(s.node(s.engine, 'image').freshness).toBeNull();
  expect(await s.apply([{ kind: 'create', nodeId: 'foreign', content: { type: 'image', media: { ...ref, libraryId: 'foreign' } }, layout: { x: 0, y: 0 } }])).toMatchObject({ ok: false, error: { code: 'MEDIA_NOT_FOUND' } });
  expect(await s.apply([{ kind: 'create', nodeId: 'bad', content: { type: 'generation', prompt: 'x', profileRef: s.profileRef, inputs: [{ nodeId: 'image', incarnation: s.node(s.engine, 'image').incarnation, semanticRevision: 1 }] }, layout: { x: 0, y: 0 } }])).toMatchObject({ ok: false, error: { code: 'INPUT_NOT_FOUND' } });
  await s.engine.close();
  expect(s.node(await s.open(), 'image').content.media).toEqual(ref);
});

it('rejects ambiguous same-field operations instead of producing an incomplete inverse', async () => {
  const s = await setup();
  await s.create();
  const n = s.node();
  expect(await s.apply([
    { kind: 'setContent', nodeId: 'g', incarnation: n.incarnation, expectedRevision: 1, content: { ...n.content, prompt: 'B' } },
    { kind: 'setContent', nodeId: 'g', incarnation: n.incarnation, expectedRevision: 2, content: { ...n.content, prompt: 'C' } },
  ])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(s.node()).toMatchObject({ semanticRevision: 1, content: { prompt: 'A' } });
});

it('backfills the default canvas for an actual schema 6 project during migration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-canvas-migrate-'));
  roots.push(root);
  const db = new DatabaseSync(join(root, 'library.sqlite'));
  db.exec('PRAGMA foreign_keys=ON');
  migrateProjects(db, 'existing-library');
  migrateCommandEvents(db, 'existing-stream');
  migrateModelConfig(db);
  migrateAssets(db);
  migrateGeneration(db);
  migrateProviderVerification(db);
  db.prepare('INSERT INTO project(id,library_id,name,created_at) VALUES(?,?,?,?)').run('existing-project', 'existing-library', 'Before canvas', new Date().toISOString());
  db.close();
  const engine = value(await startEngine({ root })) as EngineHandle;
  engines.push(engine);
  expect(read(engine, 'existing-project')).toMatchObject({ canvasId: 'existing-project', projectId: 'existing-project', revision: 0, nodes: [], outputs: [] });
  expect(engine.identity.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
});

it('advertises and validates canvas commands, snapshots and events through the desktop connection', async () => {
  const s = await setup();
  const outbox = new CommandOutbox(join(s.root, 'outbox.sqlite'));
  try {
    const connection = new LocalConnection({ identity: s.engine.identity, execute: async input => s.engine.commands.execute(input), query: async input => s.engine.commands.query(input), readEvents: async input => s.engine.events.read(input) }, outbox);
    const descriptor = value(await connection.describe());
    expect(descriptor.capabilities.events).toContain('canvas.changed');
    const envelope = { schemaVersion: 1 as const, libraryId: s.engine.identity.libraryId, connectionEpoch: descriptor.connectionEpoch, commandId: 'desktop-canvas', kind: 'canvas.applyCommand' as const, payload: { canvasId: s.projectId, baseRevision: 0, operations: [{ kind: 'create' as const, nodeId: 'text', content: { type: 'text' as const, text: 'desktop' }, layout: { x: 1, y: 2 } }] } };
    value(await connection.execute(envelope));
    const snapshot = value(await connection.query({ schemaVersion: 1, libraryId: envelope.libraryId, connectionEpoch: descriptor.connectionEpoch, queryId: 'desktop-read', kind: 'canvas.read', payload: { canvasId: s.projectId } }));
    expect(snapshot.nodes).toMatchObject([{ content: { text: 'desktop' } }]);
    const events = value(await connection.readEvents({ libraryId: envelope.libraryId, connectionEpoch: descriptor.connectionEpoch, cursor: { libraryId: envelope.libraryId, streamId: snapshot.streamId, seq: snapshot.snapshotSeq - 1 } }));
    expect(events.events).toMatchObject([{ kind: 'canvas.changed' }]);
    expect(outbox.pending(envelope.libraryId)).toHaveLength(0);
  } finally { outbox.close(); }
});

it('routes applyCanvasCommand through receipts and rejects an unrelated command at that entry point', async () => {
  const s = await setup();
  const before = value(s.engine.projects.list()).length;
  expect(await s.engine.canvas.applyCanvasCommand({ schemaVersion: 1, libraryId: s.engine.identity.libraryId, connectionEpoch: 'client', commandId: 'wrong-entry', kind: 'project.create', payload: { name: 'Wrong route' } } as any)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(value(s.engine.projects.list())).toHaveLength(before);
  const input = { schemaVersion: 1 as const, libraryId: s.engine.identity.libraryId, connectionEpoch: 'client', commandId: 'canvas-entry', kind: 'canvas.applyCommand' as const, payload: { canvasId: s.projectId, baseRevision: 0, operations: [{ kind: 'create' as const, nodeId: 'text', content: { type: 'text' as const, text: 'fixed' }, layout: { x: 0, y: 0 } }] } };
  const first = await s.engine.canvas.applyCanvasCommand(input);
  expect(first).toMatchObject({ ok: true, value: { commandId: 'canvas-entry', revision: 1 } });
  expect(await s.engine.canvas.applyCanvasCommand(input)).toEqual(first);
});

it('checks real canvas ownership again before dispatch without relying on a renderer snapshot', async () => {
  const s = await setup();
  await s.create();
  const task = await s.enqueue();
  await s.edit('B');
  await s.edit('A');
  expect(await s.engine.scheduler.run(task.attemptId)).toMatchObject({ ok: false, error: { code: 'INPUT_CHANGED' } });
  value(await s.engine.scheduler.start());
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'FAILED', errorCode: 'INPUT_CHANGED', reservationMicros: 0 });
  expect(s.node().activeTask).toMatchObject({ taskId: task.taskId, state: 'FAILED' });
  expect(s.server.posts).toBe(0);
});

it('allows preparation and current result attachment across unrelated layout drags', async () => {
  const s = await setup();
  await s.create();
  const prepared = await s.prepare();
  const before = s.node();
  value(await s.apply([{ kind: 'setLayout', nodeId: 'g', incarnation: before.incarnation, expectedRevision: 1, layout: { x: 100, y: 200 } }]));
  const task = value(await s.approve(prepared));
  s.server.hold();
  const pending = s.engine.scheduler.run(task.attemptId);
  await expect.poll(() => s.server.posts).toBe(1);
  value(await s.apply([{ kind: 'setLayout', nodeId: 'g', incarnation: before.incarnation, expectedRevision: 2, layout: { x: 300, y: 400 } }]));
  s.server.release();
  value(await pending);
  expect(s.node()).toMatchObject({ semanticRevision: 1, layoutRevision: 3, selectedOutput: { kind: 'artifact' }, freshness: 'current' });
});
