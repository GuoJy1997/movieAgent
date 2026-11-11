import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap.ts';
import type { Result } from '../../packages/contracts/src/result.ts';
import type { AssetVersionRef } from '../../packages/contracts/src/assets.ts';
import sharp from 'sharp';
import { nativeFixture, execute as nativeExecute, value as nativeValue } from '../fixtures/native-generation.ts';
import { CommandOutbox } from '../../apps/desktop/src/main/command-outbox.ts';
import { LocalConnection } from '../../apps/desktop/src/main/local-connection.ts';

const roots: string[] = [], engines: EngineHandle[] = [];
const value = <T>(r: Result<T>): T => { if (!r.ok) throw Error(r.error.code); return r.value; };
afterEach(async () => { for (const e of engines.splice(0)) await e.close(); for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
async function setup(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'asset-management-')); roots.push(root);
  const engine = value(await startEngine({ root: join(root, 'library'), ...options })); engines.push(engine);
  let serial = 0;
  const command = (kind: string, payload: unknown, commandId = `command-${++serial}`) => ({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'fixture', commandId, kind, payload });
  const execute = (kind: string, payload: unknown, commandId?: string) => engine.commands.execute(command(kind, payload, commandId));
  async function grant(name = 'story.txt', content: string | Uint8Array = 'original text') {
    const path = join(root, `${++serial}-${name}`); await writeFile(path, content); const s = await stat(path);
    const grantId = `grant-${serial}`;
    value(engine.assets.registerGrant({ grantId, importId: `import-${serial}`, libraryId: engine.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path, realPath: path, allowedRoot: root, name, size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino }] })); return grantId;
  }
  async function imported() { const r = value(await execute('asset.importGrantedFiles', { grantId: await grant() })); return (r.result as { versions: AssetVersionRef[] }).versions[0]!; }
  return { root, engine, command, execute, grant, imported };
}

it('normalizes editable metadata, rejects stale revisions, and replays one event without altering originals', async () => {
  const s = await setup(), ref = await s.imported(); const before = value(s.engine.assets.metadata(ref));
  const input = s.command('asset.updateMetadata', { assetId: ref.assetId, expectedRevision: 1, name: '  Chapter One  ', tags: [' draft ', 'draft', '角色'] }, 'rename');
  const changed = await s.engine.commands.execute(input);
  expect(changed).toMatchObject({ ok: true, value: { result: { libraryId: ref.libraryId, name: 'Chapter One', tags: ['draft', '角色'], metadataRevision: 2 } } });
  expect(await s.engine.commands.execute(input)).toEqual(changed);
  expect(await s.execute('asset.trash', { assetId: ref.assetId, expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  expect(await s.execute('asset.updateMetadata', { assetId: ref.assetId, expectedRevision: 2, name: 'x', tags: ['x'.repeat(33)] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(s.engine.assets.metadata(ref)).toEqual({ ok: true, value: before });
  expect(s.engine.assets.search({ name: 'chapter', tag: '角色', mediaType: 'text', latestOnly: true }).assets).toHaveLength(1);
  expect(s.engine.assets.search({ tag: 'missing' }).assets).toHaveLength(0);
  const db = new DatabaseSync(join(s.root, 'library/library.sqlite')); expect(db.prepare("SELECT COUNT(*) n FROM domain_event WHERE kind='asset.metadataUpdated'").get()).toMatchObject({ n: 1 }); db.close();
});

it('keeps historical references readable in trash but rejects new selections and retains every version after restore', async () => {
  const s = await setup(), ref = await s.imported();
  const project = value(await s.execute('project.create', { name: 'project' })).result as { id: string };
  const canvasId = project.id;
  expect(await s.execute('canvas.applyCommand', { canvasId, baseRevision: 0, operations: [{ kind: 'create', nodeId: 'old', content: { type: 'image', media: ref }, layout: { x: 0, y: 0 } }] })).toMatchObject({ ok: true });
  expect(project).toBeDefined();
  expect(await s.execute('asset.trash', { assetId: ref.assetId, expectedRevision: 1 })).toMatchObject({ ok: true, value: { result: { metadataRevision: 2, deletedAt: expect.any(String) } } });
  expect(s.engine.assets.search().assets).toHaveLength(0);
  expect(s.engine.assets.search({ state: 'trash' }).assets).toHaveLength(1);
  expect(value(await s.engine.assets.readFixedOriginal(ref)).bytes.toString()).toBe('original text');
  expect(s.engine.assets.assertSelectable(ref)).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(await s.execute('canvas.applyCommand', { canvasId, baseRevision: 1, operations: [{ kind: 'create', nodeId: 'new', content: { type: 'image', media: ref }, layout: { x: 0, y: 0 } }] })).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(value(s.engine.canvas.read(canvasId)).nodes).toHaveLength(1);
  expect(await s.execute('asset.restore', { assetId: ref.assetId, expectedRevision: 2 })).toMatchObject({ ok: true, value: { result: { metadataRevision: 3, deletedAt: null } } });
  expect(s.engine.assets.assertSelectable(ref)).toMatchObject({ ok: true });
  expect(s.engine.assets.history({ assetId: ref.assetId })).toMatchObject({ ok: true, value: { versions: [{ ref, sourceArtifactRef: null, createdAt: expect.any(String) }] } });
  expect(JSON.stringify(s.engine.assets.history({ assetId: ref.assetId }))).not.toContain(s.root);
});

it('retains an explicit append target through interruption and restart without duplicate versions', async () => {
  let interrupt = false;
  const s = await setup({ assets: { onPhase: (phase: string) => { if (interrupt && phase === 'beforePublish') { interrupt = false; throw Error('fixture interruption'); } } } }), ref = await s.imported();
  const input = s.command('asset.importGrantedFiles', { grantId: await s.grant('revision.md', 'durable append'), assetId: ref.assetId, expectedVersion: 1 }, 'durable-append'); interrupt = true;
  expect(await s.engine.commands.execute(input)).toMatchObject({ ok: false, error: { code: 'COLLECTION_INTERRUPTED' } });
  await s.engine.close();
  const reopened = value(await startEngine({ root: join(s.root, 'library') })); engines.push(reopened);
  const result = await reopened.commands.execute(input);
  expect(result).toMatchObject({ ok: true, value: { result: { versions: [{ ...ref, version: 2 }] } } });
  expect(await reopened.commands.execute(input)).toEqual(result);
  expect(reopened.assets.search({ latestOnly: false }).assets.map(a => a.ref.version)).toEqual([1, 2]);
});

it('restores historical content on stored undo after trash while rejecting direct selections and forged bypasses', async () => {
  const s = await setup(), first = await s.imported(), second = await s.imported();
  const canvasId = (value(await s.execute('project.create', { name: 'Undo' })).result as { id: string }).id;
  const snapshot = () => value(s.engine.canvas.read(canvasId));
  const apply = (operations: unknown[], commandId?: string) => s.execute('canvas.applyCommand', { canvasId, baseRevision: snapshot().revision, operations }, commandId);
  value(await apply([{ kind: 'create', nodeId: 'media', content: { type: 'image', media: first }, layout: { x: 0, y: 0 } }]));
  const node = snapshot().nodes[0]!;
  value(await apply([{ kind: 'setContent', nodeId: node.nodeId, incarnation: node.incarnation, expectedRevision: 1, content: { type: 'image', media: second } }], 'replace-content'));
  value(await s.execute('asset.trash', { assetId: first.assetId, expectedRevision: 1 }));
  expect(value(await s.engine.assets.readFixedOriginal(first)).bytes.toString()).toBe('original text');
  const direct = { kind: 'setContent', nodeId: node.nodeId, incarnation: node.incarnation, expectedRevision: 2, content: { type: 'image', media: first } };
  expect(await apply([direct])).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(await apply([{ ...direct, trustedUndo: true }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(await s.execute('canvas.applyCommand', { canvasId, baseRevision: 2, operations: [direct], trustedUndo: true })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  const undo = s.command('canvas.applyCommand', { canvasId, baseRevision: 2, undoCommandId: 'replace-content' }, 'undo-content');
  expect(await s.engine.commands.execute({ ...undo, libraryId: 'foreign' })).toMatchObject({ ok: false, error: { code: 'WRONG_LIBRARY' } });
  const restored = await s.engine.commands.execute(undo);
  expect(restored.ok ? 'restored' : restored.error.code).toBe('restored');
  expect(snapshot()).toMatchObject({ revision: 3, nodes: [{ content: { type: 'image', media: first }, semanticRevision: 3 }] });
  expect(await s.engine.commands.execute(undo)).toEqual(restored);
  expect(snapshot().revision).toBe(3);
  expect(await apply([{ kind: 'create', nodeId: 'new', content: { type: 'image', media: first }, layout: { x: 0, y: 0 } }])).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
});

it('keeps library and fixed-reference existence validation on the stored content undo path', async () => {
  const s = await setup(), first = await s.imported(), second = await s.imported();
  const canvasId = (value(await s.execute('project.create', { name: 'Undo validation' })).result as { id: string }).id;
  value(await s.execute('canvas.applyCommand', { canvasId, baseRevision: 0, operations: [{ kind: 'create', nodeId: 'media', content: { type: 'image', media: first }, layout: { x: 0, y: 0 } }] }));
  const node = value(s.engine.canvas.read(canvasId)).nodes[0]!;
  value(await s.execute('canvas.applyCommand', { canvasId, baseRevision: 1, operations: [{ kind: 'setContent', nodeId: node.nodeId, incarnation: node.incarnation, expectedRevision: 1, content: { type: 'image', media: second } }] }, 'replace-content'));
  const db = new DatabaseSync(join(s.root, 'library/library.sqlite'));
  try {
    const inverse = JSON.parse(db.prepare('SELECT inverse_json FROM canvas_command WHERE command_id=?').get('replace-content')!.inverse_json as string);
    // Simulate unavailable/corrupt historical refs in this disposable journal only.
    for (const ref of [{ ...first, libraryId: 'foreign' }, { ...first, version: 999 }]) {
      inverse[0].content.media = ref;
      db.prepare('UPDATE canvas_command SET inverse_json=? WHERE command_id=?').run(JSON.stringify(inverse), 'replace-content');
      expect(await s.execute('canvas.applyCommand', { canvasId, baseRevision: 2, undoCommandId: 'replace-content' })).toMatchObject({ ok: false, error: { code: 'MEDIA_NOT_FOUND' } });
      expect(value(s.engine.canvas.read(canvasId))).toMatchObject({ revision: 2, nodes: [{ content: { media: second }, semanticRevision: 2 }] });
    }
  } finally { db.close(); }
});

it('appends explicit imported versions repeatedly without changing history and conflicts concurrent artifact saves', async () => {
  const s = await setup(), ref = await s.imported();
  for (const expectedVersion of [1, 2]) {
    expect(await s.execute('asset.importGrantedFiles', { grantId: await s.grant('chapter.md', `revision ${expectedVersion + 1}`), assetId: ref.assetId, expectedVersion })).toMatchObject({ ok: true, value: { result: { versions: [{ ...ref, version: expectedVersion + 1 }] } } });
  }
  expect(value(await s.engine.assets.readFixedOriginal(ref)).bytes.toString()).toBe('original text');
  const db = new DatabaseSync(join(s.root, 'library/library.sqlite'));
  db.prepare('INSERT INTO artifact(id,library_id,object_id,created_at) SELECT ?,?,object_id,? FROM asset_version WHERE asset_id=? AND version=1').run('generated', ref.libraryId, '2026-10-26', ref.assetId); db.close();
  const input = { artifactRef: { kind: 'artifact', libraryId: ref.libraryId, artifactId: 'generated' }, name: 'Ignored version name', assetId: ref.assetId, expectedVersion: 3 };
  const results = await Promise.all([s.execute('asset.saveArtifact', input), s.execute('asset.saveArtifact', input)]);
  expect(results.map(r => r.ok)).toEqual([true, false]); expect(results[1]).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });
  expect(s.engine.assets.search({ latestOnly: true }).assets).toMatchObject([{ ref: { version: 4 }, name: 'story.txt' }]);
  expect(s.engine.assets.history({ assetId: ref.assetId })).toMatchObject({ ok: true, value: { versions: [{ ref: { version: 1 } }, { ref: { version: 2 } }, { ref: { version: 3 } }, { ref: { version: 4 }, sourceArtifactRef: input.artifactRef }] } });
  expect(await s.engine.commands.execute({ ...s.command('asset.trash', { assetId: ref.assetId, expectedRevision: 1 }), libraryId: 'foreign' })).toMatchObject({ ok: false, error: { code: 'WRONG_LIBRARY' } });
});

it('rechecks the durable import target at publication after asynchronous collection', async () => {
  let hold = false, reached!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { release = r; });
  const s = await setup({ assets: { onPhase: async (phase: string) => { if (hold && phase === 'beforePublish') { reached(); await gate; } } } }), ref = await s.imported();
  const db = new DatabaseSync(join(s.root, 'library/library.sqlite')); db.prepare('INSERT INTO artifact(id,library_id,object_id,created_at) SELECT ?,?,object_id,? FROM asset_version WHERE asset_id=?').run('generated', ref.libraryId, '2026', ref.assetId); db.close();
  const grantId = await s.grant('chapter.txt', 'competing version'); hold = true;
  const pending = s.execute('asset.importGrantedFiles', { grantId, assetId: ref.assetId, expectedVersion: 1 }); await Promise.race([entered, Promise.resolve(pending).then(result => { expect(result).toMatchObject({ ok: true }); })]);
  try { expect(await s.execute('asset.saveArtifact', { artifactRef: { kind: 'artifact', libraryId: ref.libraryId, artifactId: 'generated' }, name: 'generated', assetId: ref.assetId, expectedVersion: 1 })).toMatchObject({ ok: true }); }
  finally { release(); }
  expect(await pending).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  expect(s.engine.assets.search({ latestOnly: false }).assets.map(a => a.ref.version)).toEqual([1, 2]);
});

it('rejects ordinary prepare from trash while an approved frozen reference still completes once', async () => {
  const s = await nativeFixture('openai-image-edit-v1');
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#234567' } }).png().toBuffer();
  const ref = await s.importFile(png), approved = await s.enqueue([{ role: 'reference', ref }]);
  nativeValue(await nativeExecute(s.engine, 'asset.trash', { assetId: ref.assetId, expectedRevision: 1 }));
  expect(await nativeExecute(s.engine, 'generation.prepare', s.prepareInput([{ role: 'reference', ref }]))).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  s.response({ data: [{ b64_json: png.toString('base64') }] });
  expect(nativeValue(await s.engine.scheduler.run(approved.task.attemptId))).toMatchObject({ state: 'SUCCEEDED' });
  expect(s.requests).toHaveLength(1); expect(s.requests[0]!.body.includes(png)).toBe(true);
});

it('never publishes a rejected append after its trashed target is restored or the engine restarts', async () => {
  let hold = false, reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const s = await setup({ assets: { onPhase: async (phase: string) => { if (hold && phase === 'beforePublish') { reached(); await gate; } } } }), ref = await s.imported();
  const input = s.command('asset.importGrantedFiles', { grantId: await s.grant('new.txt', 'must not publish later'), assetId: ref.assetId, expectedVersion: 1 }); hold = true;
  const pending = s.engine.commands.execute(input); await entered;
  try { expect(await s.execute('asset.trash', { assetId: ref.assetId, expectedRevision: 1 })).toMatchObject({ ok: true }); }
  finally { release(); }
  expect(await pending).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(await s.execute('asset.restore', { assetId: ref.assetId, expectedRevision: 2 })).toMatchObject({ ok: true });
  expect(await s.engine.commands.execute(input)).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(s.engine.assets.pendingImports()).toEqual([]);
  await s.engine.close();
  const reopened = value(await startEngine({ root: join(s.root, 'library') })); engines.push(reopened);
  expect(await reopened.commands.execute(input)).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(reopened.assets.search().assets.map(a => a.ref.version)).toEqual([1]);
});

it('returns indeterminate commit failure until terminal import rejection is durably persisted', async () => {
  let hold = false, reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const s = await setup({ assets: { onPhase: async (phase: string) => { if (hold && phase === 'beforePublish') { reached(); await gate; } } } }), ref = await s.imported();
  const outbox = new CommandOutbox(join(s.root, 'client.sqlite'));
  const connection = new LocalConnection({ identity: s.engine.identity, execute: async input => s.engine.commands.execute(input), query: async input => s.engine.commands.query(input), readEvents: async () => { throw Error('not used'); } }, outbox);
  const descriptor = value(await connection.describe());
  const input = { ...s.command('asset.importGrantedFiles', { grantId: await s.grant('new.txt', 'retained original'), assetId: ref.assetId, expectedVersion: 1 }), connectionEpoch: descriptor.connectionEpoch }; hold = true;
  const pending = connection.execute(input as never); await entered;
  const db = new DatabaseSync(join(s.root, 'library/library.sqlite'));
  try {
    // This trigger is scoped to this disposable DB and fails only terminal publication state.
    db.exec("CREATE TRIGGER fail_terminal_import BEFORE UPDATE OF terminal_error ON import_batch BEGIN SELECT RAISE(ABORT,'fixture terminal persistence failure'); END");
    expect(await s.execute('asset.trash', { assetId: ref.assetId, expectedRevision: 1 })).toMatchObject({ ok: true });
    release(); expect(await pending).toMatchObject({ ok: false, error: { code: 'COMMAND_COMMIT_FAILED' } });
    expect(outbox.hasPending()).toBe(true);
    db.exec('DROP TRIGGER fail_terminal_import');
    expect(await connection.execute(input as never)).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
    expect(outbox.hasPending()).toBe(false);
    expect(await s.execute('asset.restore', { assetId: ref.assetId, expectedRevision: 2 })).toMatchObject({ ok: true });
    expect(await s.engine.commands.execute(input)).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
    expect(s.engine.assets.search().assets.map(a => a.ref.version)).toEqual([1]);
  } finally { release(); await pending; db.close(); connection.disconnect(); outbox.close(); }
});
