import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap.ts';
import { isDefinitiveCommandRejection } from '../../apps/desktop/src/main/command-rejection.ts';
import type { CommandEnvelope } from '../../packages/contracts/src/commands.ts';
import { queryOutputValidators } from '../../packages/contracts/src/queries.ts';
import { isDomainEvent } from '../../packages/contracts/src/events.ts';

const engines: EngineHandle[] = [], roots: string[] = [];
afterEach(async () => { for (const e of engines.splice(0)) await e.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
let serial = 0;
const command = (e: EngineHandle, kind: string, payload: unknown, commandId = `c-${++serial}`) => ({ schemaVersion: 1, libraryId: e.identity.libraryId, connectionEpoch: 'fixture', commandId, kind, payload });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'creation-')); roots.push(root);
  const started = await startEngine({ root }); if (!started.ok) throw Error(started.error.code); const e = started.value; engines.push(e);
  const result = await e.commands.execute(command(e, 'project.create', { name: 'Story' })); if (!result.ok) throw Error(result.error.code);
  return { e, root, projectId: (result.value.result as { id: string }).id };
}
const entity = (projectId: string, extra = {}) => ({ projectId, id: 'hero', expectedRevision: 0, kind: 'character', name: 'Hero', description: '', constraints: '', references: [], ...extra });
const script = (projectId: string, extra = {}) => ({ projectId, id: 'script', expectedRevision: 0, title: 'Story', synopsis: '', body: '', scenes: [{ id: 'scene', title: 'Arrival', location: 'Dock', time: 'Night', description: '' }], ...extra });
const shot = (projectId: string, extra = {}) => ({ projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0, title: 'Arrival', durationSeconds: 5, shotSize: 'wide', cameraMovement: 'pan', subject: 'Hero', action: 'arrives', dialogue: '', sound: '', aspectRatio: '16:9', prompt: 'a dock', entityRefs: [], ...extra });
const read = (e: EngineHandle, projectId: string, scriptId?: string) => e.commands.query({ ...command(e, 'creation.read', { projectId, ...(scriptId ? { scriptId } : {}) }), queryId: 'read' });
const history = (e: EngineHandle, projectId: string, kind: string, id: string) => e.commands.query({ ...command(e, 'creation.history', { projectId, kind, id }), queryId: 'history' });

it('persists immutable revisions, fixed entity refs, monotonic receipts/events and reopen history', async () => {
  const { e, root, projectId } = await setup();
  const initialEvents = e.events.read({ libraryId: e.identity.libraryId, connectionEpoch: 'fixture' });
  if (!initialEvents.ok) throw Error(initialEvents.error.code);
  const first = command(e, 'creation.saveEntity', entity(projectId), 'entity-create');
  expect(await e.commands.execute(first)).toMatchObject({ ok: true, value: { result: { revision: 1, name: 'Hero', libraryId: e.identity.libraryId } } });
  expect(await e.commands.execute(first)).toEqual(await e.commands.execute(first));
  expect(await e.commands.execute(command(e, 'creation.saveScript', script(projectId)))).toMatchObject({ ok: true });
  const ref = { libraryId: e.identity.libraryId, projectId, entityId: 'hero', revision: 1 };
  expect(await e.commands.execute(command(e, 'creation.saveShot', shot(projectId, { entityRefs: [ref] })))).toMatchObject({ ok: true });
  expect(await e.commands.execute(command(e, 'creation.saveEntity', entity(projectId, { expectedRevision: 1, name: 'Changed' })))).toMatchObject({ ok: true });
  const snapshot = read(e, projectId); expect(snapshot).toMatchObject({ ok: true, value: { entities: [{ revision: 2 }], shots: [{ revision: 1, entityRefs: [ref] }] } });
  if (!snapshot.ok) throw Error('read'); expect(queryOutputValidators['creation.read'](snapshot.value)).toBe(true);
  expect(history(e, projectId, 'entity', 'hero')).toMatchObject({ ok: true, value: { revisions: [{ revision: 1, name: 'Hero' }, { revision: 2, name: 'Changed' }] } });
  const events = e.events.read({ libraryId: e.identity.libraryId, connectionEpoch: 'fixture', cursor: initialEvents.value.cursor });
  expect(events.ok).toBe(true); if (events.ok) { expect(events.value.events.filter(x => x.kind.startsWith('creation.'))).toHaveLength(4); expect(events.value.events.every(isDomainEvent)).toBe(true); }
  await e.close(); const reopened = await startEngine({ root }); if (!reopened.ok) throw Error('reopen'); engines.push(reopened.value);
  expect(read(reopened.value, projectId)).toEqual(snapshot);
  expect(history(reopened.value, projectId, 'shot', 'shot')).toMatchObject({ ok: true, value: { revisions: [{ entityRefs: [ref] }] } });
});

it.each([
  ['entity', { name: 'x'.repeat(201) }], ['entity', { description: 'x'.repeat(8001) }], ['entity', { constraints: 'x'.repeat(8001) }],
  ['entity', { kind: 'sql' }], ['entity', { extra: 'injection' }], ['entity', { references: Array(5).fill({ kind: 'artifact', libraryId: 'lib', artifactId: 'x' }) }],
  ['script', { body: 'x'.repeat(64001) }], ['script', { synopsis: 'x'.repeat(4001) }], ['script', { scenes: Array(33).fill({ id: 's', title: 'a', location: '', time: '', description: '' }) }],
  ['script', { scenes: [{ id: 's', title: 'a', location: '', time: '', description: '' }, { id: 's', title: 'b', location: '', time: '', description: '' }] }],
  ['shot', { durationSeconds: 0 }], ['shot', { durationSeconds: 121 }], ['shot', { durationSeconds: 1.5 }], ['shot', { aspectRatio: 'cinema' }],
  ['shot', { prompt: 'x'.repeat(8001) }], ['shot', { action: 'x'.repeat(2001) }], ['shot', { entityRefs: Array(9).fill({ libraryId: 'lib', projectId: 'p', entityId: 'x', revision: 1 }) }],
] as const)('rejects invalid %s fields before writing (%j)', async (kind, extra) => {
  const { e, projectId } = await setup(); const builders = { entity, script, shot }, names = { entity: 'saveEntity', script: 'saveScript', shot: 'saveShot' };
  expect(await e.commands.execute(command(e, `creation.${names[kind]}`, builders[kind](projectId, extra)))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(read(e, projectId)).toMatchObject({ ok: true, value: { entities: [], scripts: [], shots: [] } });
});

it('enforces UTF8 JSON byte bounds as well as individual character bounds', async () => {
  const { e, projectId } = await setup();
  const scenes = Array.from({ length: 32 }, (_, i) => ({ id: `s${i}`, title: 's', location: '界'.repeat(2000), time: '', description: '界'.repeat(2000) }));
  expect(await e.commands.execute(command(e, 'creation.saveScript', script(projectId, { scenes })))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('accepts scene entities as fixed project references', async () => {
  const { e, projectId } = await setup();
  expect(await e.commands.execute(command(e, 'creation.saveEntity', entity(projectId, { id: 'harbor', kind: 'scene', name: 'Harbor' })))).toMatchObject({ ok: true, value: { result: { kind: 'scene' } } });
});

it('rejects stale CAS, foreign projects, dangling entities/scenes and scene removal without any write', async () => {
  const { e, projectId } = await setup();
  await e.commands.execute(command(e, 'creation.saveEntity', entity(projectId)));
  expect(await e.commands.execute(command(e, 'creation.saveEntity', entity(projectId)))).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  const other = await e.commands.execute(command(e, 'project.create', { name: 'Other' })); if (!other.ok) throw Error('project'); const otherId = (other.value.result as { id: string }).id;
  expect(await e.commands.execute(command(e, 'creation.saveEntity', entity(otherId, { expectedRevision: 1 })))).toMatchObject({ ok: false, error: { code: 'WRONG_PROJECT' } });
  expect(history(e, otherId, 'entity', 'hero')).toMatchObject({ ok: false, error: { code: 'WRONG_PROJECT' } });
  await e.commands.execute(command(e, 'creation.saveScript', script(projectId)));
  expect(await e.commands.execute(command(e, 'creation.saveShot', shot(projectId, { sceneId: 'absent' })))).toMatchObject({ ok: false, error: { code: 'SCENE_NOT_FOUND' } });
  expect(await e.commands.execute(command(e, 'creation.saveShot', shot(projectId, { entityRefs: [{ libraryId: e.identity.libraryId, projectId, entityId: 'hero', revision: 2 }] })))).toMatchObject({ ok: false, error: { code: 'ENTITY_NOT_FOUND' } });
  expect(await e.commands.execute(command(e, 'creation.saveShot', shot(otherId)))).toMatchObject({ ok: false, error: { code: 'WRONG_PROJECT' } });
  expect(await e.commands.execute(command(e, 'creation.saveShot', shot(projectId)))).toMatchObject({ ok: true });
  expect(await e.commands.execute(command(e, 'creation.saveScript', script(projectId, { expectedRevision: 1, scenes: [] })))).toMatchObject({ ok: false, error: { code: 'SCENE_IN_USE' } });
  const edits = await Promise.all([e.commands.execute(command(e, 'creation.saveShot', shot(projectId, { expectedRevision: 1, title: 'A' }))), e.commands.execute(command(e, 'creation.saveShot', shot(projectId, { expectedRevision: 1, title: 'B' })))]);
  expect(edits.map(x => x.ok)).toEqual([true, false]);
  expect(history(e, projectId, 'shot', 'shot')).toMatchObject({ ok: true, value: { revisions: [{ revision: 1 }, { revision: 2, title: 'A' }] } });
});

async function importImage(e: EngineHandle, root: string) {
  const path = join(root, 'fixture.png'); await writeFile(path, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer());
  const info = await stat(path); e.assets.registerGrant({ grantId: 'grant', importId: 'import', libraryId: e.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path, realPath: path, allowedRoot: root, name: 'fixture', size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino }] });
  const imported = await e.commands.execute(command(e, 'asset.importGrantedFiles', { grantId: 'grant' })); if (!imported.ok) throw Error(imported.error.code);
  return (imported.value.result as { versions: import('../../packages/contracts/src/assets.ts').AssetVersionRef[] }).versions[0]!;
}
it('validates real fixed media and separates late output selection CAS from content revisions', async () => {
  const { e, root, projectId } = await setup(); const ref = await importImage(e, root);
  expect(await e.commands.execute(command(e, 'creation.saveEntity', entity(projectId, { references: [ref] })))).toMatchObject({ ok: true });
  expect(await e.commands.execute(command(e, 'creation.saveEntity', entity(projectId, { expectedRevision: 1, references: [{ ...ref, version: 99 }] })))).toMatchObject({ ok: false, error: { code: 'MEDIA_NOT_FOUND' } });
  expect(await e.commands.execute(command(e, 'creation.saveEntity', entity(projectId, { expectedRevision: 1, references: [{ ...ref, libraryId: 'other' }] })))).toMatchObject({ ok: false, error: { code: 'WRONG_LIBRARY' } });
  await e.commands.execute(command(e, 'creation.saveScript', script(projectId))); await e.commands.execute(command(e, 'creation.saveShot', shot(projectId)));
  const selection = { projectId, shotId: 'shot', expectedRevision: 1, expectedSelectionRevision: 0, role: 'image', reference: ref };
  expect(await e.commands.execute(command(e, 'creation.selectOutput', selection))).toMatchObject({ ok: true, value: { result: { selectionRevision: 1, image: ref, video: null } } });
  expect(await e.commands.execute(command(e, 'creation.selectOutput', selection))).toMatchObject({ ok: false, error: { code: 'SELECTION_CONFLICT' } });
  await e.commands.execute(command(e, 'creation.saveShot', shot(projectId, { expectedRevision: 1, title: 'Edited' })));
  expect(await e.commands.execute(command(e, 'creation.selectOutput', { ...selection, expectedSelectionRevision: 1 }))).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  expect(await e.commands.execute(command(e, 'creation.selectOutput', { ...selection, expectedRevision: 2, expectedSelectionRevision: 1, role: 'video' }))).toMatchObject({ ok: false, error: { code: 'INVALID_MEDIA_TYPE' } });
  expect(read(e, projectId)).toMatchObject({ ok: true, value: { selections: [{ selectionRevision: 1, shotRevision: 1, image: ref }], shots: [{ revision: 2 }] } });
});

it('validates the whole normalized batch before writes and resolves staged entity/script revisions in caller transaction', async () => {
  const { e, root, projectId } = await setup();
  // A separate read-only connection proves no partial writes leaked out of failure.
  const db = new DatabaseSync(join(root, 'library.sqlite')); db.exec('PRAGMA foreign_keys=ON');
  const creation = (e as EngineHandle & { creation: { validateBatch(v: unknown): unknown; applyBatch(v: unknown): unknown } }).creation;
  expect(creation).toBeDefined();
  const batch = { projectId, entities: [entity(projectId)], scripts: [script(projectId)], shots: [shot(projectId, { entityRefs: [{ libraryId: e.identity.libraryId, projectId, entityId: 'hero', revision: 1 }] })] };
  expect(creation.validateBatch(batch)).toMatchObject({ ok: true, value: { entities: [{ revision: 1 }], scripts: [{ revision: 1 }], shots: [{ revision: 1 }] } });
  expect(read(e, projectId)).toMatchObject({ ok: true, value: { entities: [], scripts: [], shots: [] } });
  expect(creation.applyBatch(batch)).toMatchObject({ ok: false, error: { code: 'TRANSACTION_REQUIRED' } });
  // Use the actual LibraryHandle for the transaction rather than another connection.
  const { openLibrary } = await import('../../packages/storage/src/database.ts');
  const { assetsFor } = await import('../../packages/engine/src/asset-service.ts');
  const { creationFor } = await import('../../packages/engine/src/creation-service.ts');
  await e.close(); db.close(); const opened = await openLibrary({ root }); if (!opened.ok) throw Error('open'); const lib = opened.value;
  try {
    const service = creationFor(lib, assetsFor(lib)); lib.db.exec('BEGIN IMMEDIATE');
    expect(service.applyBatch({ ...batch, shots: [...batch.shots, shot(projectId, { id: 'bad', sceneId: 'missing' })] })).toMatchObject({ ok: false, error: { code: 'SCENE_NOT_FOUND' } });
    expect(lib.db.prepare('SELECT count(*) AS n FROM creation_revision').get()).toMatchObject({ n: 0 });
    expect(service.applyBatch(batch)).toMatchObject({ ok: true }); lib.db.exec('COMMIT');
    lib.db.exec('BEGIN IMMEDIATE');
    expect(service.applyBatch({ projectId, entities: [], scripts: [script(projectId, { expectedRevision: 1, scenes: [{ id: 'new', title: 'New', location: '', time: '', description: '' }] })], shots: [shot(projectId, { expectedRevision: 1, sceneId: 'new' })] })).toMatchObject({ ok: true });
    lib.db.exec('ROLLBACK');
    expect(service.read({ projectId })).toMatchObject({ ok: true, value: { scripts: [{ revision: 1 }], shots: [{ sceneId: 'scene' }] } });
  } finally { await lib.close(); }
});

it('classifies known creation conflicts as final while retaining uncertain storage errors', () => {
  const envelope = { kind: 'creation.saveShot' } as CommandEnvelope;
  expect(isDefinitiveCommandRejection(envelope, 'SCENE_NOT_FOUND')).toBe(true);
  expect(isDefinitiveCommandRejection(envelope, 'REVISION_CONFLICT')).toBe(true);
  expect(isDefinitiveCommandRejection(envelope, 'COMMAND_COMMIT_FAILED')).toBe(false);
});
