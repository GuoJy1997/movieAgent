import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, stat, unlink, mkdir, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';
import { openLibrary } from '../../packages/storage/src/database';
import { collectionJournalFor } from '../../packages/storage/src/collection-journal';
import { objectStoreFor } from '../../packages/storage/src/object-store';
import { isAssetSnapshot } from '../../packages/contracts/src/assets';

const roots: string[] = [], engines: EngineHandle[] = [];
async function setup(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'libtv-assets-')); roots.push(root);
  const result = await startEngine({ root: join(root, 'library'), ...options });
  if (!result.ok) throw new Error(result.error.message);
  engines.push(result.value);
  expect(result.value).toHaveProperty('assets');
  return { root, engine: result.value };
}
async function source(root: string, format: 'png' | 'jpeg' | 'webp' = 'png') {
  const path = join(root, `source-${Math.random()}.${format}`);
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#ed3212' } }).toFormat(format).toBuffer();
  await writeFile(path, bytes); return { path, bytes };
}
async function grant(engine: EngineHandle, path: string, id = 'grant-1', extra = {}) {
  const s = await stat(path);
  return engine.assets.registerGrant({ grantId: id, importId: `import-${id}`, libraryId: engine.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path, realPath: path, allowedRoot: dirname(path), name: 'Image', size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino }], ...extra });
}
function command(engine: EngineHandle, grantId = 'grant-1', commandId = 'import-1') {
  return { schemaVersion: 1 as const, libraryId: engine.identity.libraryId, connectionEpoch: 'test-epoch', commandId, kind: 'asset.importGrantedFiles' as const, payload: { grantId } };
}
afterEach(async () => { for (const engine of engines.splice(0)) await engine.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it.each(['png', 'jpeg', 'webp'] as const)('keeps %s originals after the source is deleted and replays one immutable version', async format => {
  const { root, engine } = await setup(); const file = await source(root, format);
  expect(await grant(engine, file.path)).toMatchObject({ ok: true });
  const first = await engine.commands.execute(command(engine));
  expect(first).toMatchObject({ ok: true, value: { result: { state: 'ready', versions: [{ version: 1 }] } } });
  if (!first.ok || !('versions' in first.value.result)) throw new Error('import');
  await unlink(file.path);
  const ref = first.value.result.versions[0]!;
  const original = await engine.assets.read({ libraryId: engine.identity.libraryId, ref, variant: 'original' });
  expect(original).toMatchObject({ ok: true, value: { mime: `image/${format}` } });
  if (!original.ok) throw new Error('original'); expect(original.value.bytes).toEqual(file.bytes);
  expect(await engine.commands.execute(command(engine))).toEqual(first);
  const preview = await engine.assets.read({ libraryId: engine.identity.libraryId, ref, variant: 'thumbnail' });
  expect(preview).toMatchObject({ ok: true, value: { mime: 'image/png' } });
  const db = new DatabaseSync(join(root, 'library/library.sqlite'), { readOnly: true });
  expect(db.prepare('SELECT COUNT(*) AS n FROM asset_version').get()).toMatchObject({ n: 1 }); db.close();
});

it('reuses equal blobs without merging logical assets and publishes only real artifact records', async () => {
  const { root, engine } = await setup(); const file = await source(root);
  await grant(engine, file.path); const first = await engine.commands.execute(command(engine));
  await grant(engine, file.path, 'grant-2'); const second = await engine.commands.execute(command(engine, 'grant-2', 'import-2'));
  expect(first.ok && second.ok && first.value.result).not.toEqual(second.ok && second.value.result);
  const db = new DatabaseSync(join(root, 'library/library.sqlite'));
  expect(db.prepare('SELECT COUNT(*) AS n FROM blob_object').get()).toMatchObject({ n: 1 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM asset').get()).toMatchObject({ n: 2 });
  const save = { ...command(engine), commandId: 'save-artifact', kind: 'asset.saveArtifact' as const, payload: { artifactRef: { kind: 'artifact' as const, libraryId: engine.identity.libraryId, artifactId: 'missing' }, name: 'Saved' } };
  expect(await engine.commands.execute(save)).toMatchObject({ ok: false, error: { code: 'ARTIFACT_NOT_FOUND' } });
  const blob = db.prepare('SELECT object_id FROM blob_object').get()!;
  db.prepare('INSERT INTO artifact(id,library_id,object_id,created_at) VALUES(?,?,?,?)').run('real-artifact', engine.identity.libraryId, blob.object_id as string, new Date().toISOString()); db.close();
  const savedInput = { ...save, payload: { ...save.payload, artifactRef: { ...save.payload.artifactRef, artifactId: 'real-artifact' } } };
  const saved = await engine.commands.execute(savedInput);
  expect(saved).toMatchObject({ ok: true, value: { result: { kind: 'assetVersion', version: 1 } } });
  expect(await engine.commands.execute(savedInput)).toEqual(saved);
  const snapshot = engine.assets.search();
  expect(snapshot.assets.slice(0, 2).map(a => a.sourceArtifactRef)).toEqual([null, null]);
  expect(snapshot.assets.at(-1)?.sourceArtifactRef).toEqual(savedInput.payload.artifactRef);
  expect(isAssetSnapshot({ ...snapshot, assets: [{ ...snapshot.assets.at(-1), sourceArtifactRef: { ...savedInput.payload.artifactRef, libraryId: 'foreign' } }] })).toBe(false);
});

it.each(['staging', 'renamed', 'beforePublish'] as const)('recovers interruption at %s without duplicate publication', async phase => {
  let interrupted = false;
  const { root, engine } = await setup({ assets: { onPhase: (value: string) => { if (value === phase && !interrupted) { interrupted = true; throw new Error('interrupted fixture'); } } } });
  const file = await source(root); await grant(engine, file.path);
  const input = command(engine); expect(await engine.commands.execute(input)).toMatchObject({ ok: false });
  const db = new DatabaseSync(join(root, 'library/library.sqlite'), { readOnly: true });
  expect(db.prepare('SELECT COUNT(*) AS n FROM asset_version').get()).toMatchObject({ n: 0 }); db.close();
  await unlink(file.path); await engine.close();
  const reopened = await startEngine({ root: join(root, 'library') }); if (!reopened.ok) throw new Error('reopen'); engines.push(reopened.value);
  const result = await reopened.value.commands.execute(input);
  expect(result).toMatchObject({ ok: true, value: { result: { state: 'ready', versions: [{ version: 1 }] } } });
  expect(await reopened.value.commands.execute(input)).toEqual(result);
});

it('bounds object bytes, decoded pixels, capacity and actual writes without publishing failures', async () => {
  const { root, engine } = await setup({ assets: { limits: { maxBytes: 100, maxPixels: 100, reserveBytes: 0 } } });
  const file = await source(root); await grant(engine, file.path);
  expect(await engine.commands.execute(command(engine))).toMatchObject({ ok: false, error: { code: 'OBJECT_TOO_LARGE' } });
  const second = await setup({ assets: { limits: { maxBytes: 100000, maxPixels: 100, reserveBytes: 0 } } });
  const f2 = await source(second.root); await grant(second.engine, f2.path);
  expect(await second.engine.commands.execute(command(second.engine))).toMatchObject({ ok: false, error: { code: 'PIXEL_LIMIT' } });
  const third = await setup({ assets: { limits: { maxBytes: 100000, maxPixels: 1000, reserveBytes: Number.MAX_SAFE_INTEGER } } });
  const f3 = await source(third.root); await grant(third.engine, f3.path);
  expect(await third.engine.commands.execute(command(third.engine))).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_SPACE' } });
  const fourth = await setup(); const f4 = await source(fourth.root); await grant(fourth.engine, f4.path);
  await rm(join(fourth.root, 'library/temp'), { recursive: true }); await writeFile(join(fourth.root, 'library/temp'), 'not a directory');
  expect(await fourth.engine.commands.execute(command(fourth.engine))).toMatchObject({ ok: false, error: { code: 'COLLECTION_WRITE_FAILED' } });
  expect(fourth.engine.assets.search()).toMatchObject({ assets: [] });
});

it('rejects expired or foreign grants, changed links, forged refs and corruption; rebuilds previews independently', async () => {
  const { root, engine } = await setup(); const file = await source(root);
  expect(await grant(engine, file.path, 'foreign', { libraryId: 'other' })).toMatchObject({ ok: false, error: { code: 'WRONG_LIBRARY' } });
  await grant(engine, file.path, 'expired', { expiresAt: Date.now() - 1 });
  expect(await engine.commands.execute(command(engine, 'expired'))).toMatchObject({ ok: false, error: { code: 'FILE_GRANT_EXPIRED' } });
  await grant(engine, file.path); const result = await engine.commands.execute(command(engine));
  if (!result.ok || !('versions' in result.value.result)) throw new Error('import'); const ref = result.value.result.versions[0]!;
  expect(await engine.assets.read({ libraryId: 'other', ref, variant: 'original' })).toMatchObject({ ok: false, error: { code: 'WRONG_LIBRARY' } });
  expect(await engine.assets.read({ libraryId: engine.identity.libraryId, ref: { ...ref, assetId: 'forged' }, variant: 'original' })).toMatchObject({ ok: false, error: { code: 'MEDIA_NOT_FOUND' } });
  await rm(join(root, 'library/previews'), { recursive: true }); await mkdir(join(root, 'library/previews'));
  expect(await engine.assets.read({ libraryId: engine.identity.libraryId, ref, variant: 'thumbnail' })).toMatchObject({ ok: true });
  const db = new DatabaseSync(join(root, 'library/library.sqlite'), { readOnly: true }); const blob = db.prepare('SELECT storage_key FROM blob_object').get()!; db.close();
  await writeFile(join(root, 'library', blob.storage_key as string), 'corrupted');
  expect(await engine.assets.read({ libraryId: engine.identity.libraryId, ref, variant: 'original' })).toMatchObject({ ok: false, error: { code: 'OBJECT_INTEGRITY_FAILED' } });
  const actual = join(root, 'actual'); await mkdir(actual); const linkedFile = await source(actual);
  const linkDirectory = join(root, 'linked'); await symlink(actual, linkDirectory, 'junction');
  const linked = join(linkDirectory, linkedFile.path.split(/[\\/]/).pop()!);
  await grant(engine, linked, 'linked');
  expect(await engine.commands.execute(command(engine, 'linked', 'import-link'))).toMatchObject({ ok: false, error: { code: 'FILE_GRANT_CHANGED' } });
});

it('collects through the internal journal without an import batch or logical asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-object-')); roots.push(root);
  const library = await openLibrary({ root: join(root, 'library') }); if (!library.ok) throw new Error('library');
  try {
    const file = await source(root); const s = await stat(file.path);
    const sourceRef = { path: file.path, realPath: file.path, allowedRoot: root, name: 'Original', size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino };
    const journal = collectionJournalFor(library.value);
    expect(journal).toHaveProperty('create');
    journal.create('internal-collection', sourceRef);
    journal.update('internal-collection', 'collecting');
    await writeFile(join(root, 'library/temp/internal-collection.part'), 'interrupted partial copy');
    await writeFile(join(root, 'library/temp/unrelated.part'), 'belongs to another operation');
    const collected = await objectStoreFor(library.value).collect({ collectionId: 'internal-collection', sourceRef });
    expect(collected).toMatchObject({ ok: true, value: { mime: 'image/png', width: 20, height: 10 } });
    expect(await readFile(join(root, 'library/temp/unrelated.part'), 'utf8')).toBe('belongs to another operation');
    expect(await objectStoreFor(library.value).collect({ collectionId: 'internal-collection', sourceRef: { ...sourceRef, path: join(root, 'rebound.png') } })).toMatchObject({ ok: false, error: { code: 'COLLECTION_SOURCE_CHANGED' } });
    expect(library.value.db.prepare('SELECT COUNT(*) AS n FROM import_batch').get()).toMatchObject({ n: 0 });
    expect(library.value.db.prepare('SELECT COUNT(*) AS n FROM asset').get()).toMatchObject({ n: 0 });
  } finally { await library.value.close(); }
});

it('handshakes before slow restart collection completes and leaves other commands outside its I/O', async () => {
  const { root, engine } = await setup({ assets: { onPhase: (phase: string) => { if (phase === 'staging') throw new Error('stop fixture'); } } });
  const file = await source(root); await grant(engine, file.path); await engine.commands.execute(command(engine)); await engine.close();
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const pending = startEngine({ root: join(root, 'library'), assets: { onPhase: async phase => { if (phase === 'renamed') await held; } } });
  const result = await Promise.race([pending, new Promise<null>(resolve => setTimeout(() => resolve(null), 250))]);
  release(); const opened = await pending; if (opened.ok) engines.push(opened.value);
  expect(result).not.toBeNull();
});

it('rechecks final original integrity immediately before publishing a ready version', async () => {
  let libraryRoot = '';
  const { root, engine } = await setup({ assets: { onPhase: async (phase: string) => {
    if (phase !== 'beforePublish') return;
    const prefix = (await readdir(join(libraryRoot, 'objects')))[0]!;
    const name = (await readdir(join(libraryRoot, 'objects', prefix)))[0]!;
    await writeFile(join(libraryRoot, 'objects', prefix, name), 'corrupted before publish');
  } } });
  libraryRoot = join(root, 'library'); const file = await source(root); await grant(engine, file.path);
  expect(await engine.commands.execute(command(engine))).toMatchObject({ ok: false, error: { code: 'OBJECT_INTEGRITY_FAILED' } });
  expect(engine.assets.search()).toMatchObject({ assets: [] });
});

it('rolls back asset publication with its event and safely retries already durable originals', async () => {
  const { root, engine } = await setup(); const file = await source(root); await grant(engine, file.path);
  const db = new DatabaseSync(join(root, 'library/library.sqlite'));
  try {
    db.exec("CREATE TRIGGER fail_asset_event BEFORE INSERT ON domain_event BEGIN SELECT RAISE(ABORT,'fixture publication failure'); END");
    expect(await engine.commands.execute(command(engine))).toMatchObject({ ok: false, error: { code: 'COMMAND_COMMIT_FAILED' } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM asset_version').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM command_receipt').get()).toMatchObject({ n: 0 });
    await unlink(file.path); db.exec('DROP TRIGGER fail_asset_event');
    const ready = await engine.commands.execute(command(engine)); expect(ready).toMatchObject({ ok: true });
    expect(await engine.commands.execute(command(engine))).toEqual(ready);
    expect(await engine.commands.execute({ ...command(engine), payload: { grantId: 'changed' } })).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_REUSED' } });
  } finally { db.close(); }
});

it('retains an interrupted import identity against a different command kind until original publication', async () => {
  let interrupted = false;
  const { root, engine } = await setup({ assets: { onPhase: (phase: string) => {
    if (phase === 'staging' && !interrupted) { interrupted = true; throw new Error('interrupted accepted import'); }
  } } });
  const file = await source(root); await grant(engine, file.path);
  const input = command(engine);
  expect(await engine.commands.execute(input)).toMatchObject({ ok: false });
  expect(await engine.commands.execute({ ...input, kind: 'project.create', payload: { name: 'Cannot take import identity' } })).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_REUSED' } });
  expect(engine.projects.list()).toMatchObject({ ok: true, value: [] });
  await unlink(file.path);
  const published = await engine.commands.execute(input);
  expect(published).toMatchObject({ ok: true, value: { result: { state: 'ready' } } });
  expect(await engine.commands.execute(input)).toEqual(published);
});
