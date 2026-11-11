import { CURRENT_SCHEMA_VERSION } from '../../packages/contracts/src/schema.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap.ts';
import { migrateProjects } from '../../packages/storage/src/migrations/0001-projects.ts';
import { lifecycleChild, stopChild } from '../fixtures/lifecycle-process.ts';
import { fork } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve } from 'node:path';
const roots: string[] = [], engines: EngineHandle[] = [];
afterEach(async () => { for (const e of engines.splice(0)) await e.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function root() { const r = await mkdtemp(join(tmpdir(), 'libtv-lifecycle-')); roots.push(r); return r; }
async function open(r: string, assets?: Parameters<typeof startEngine>[0]['assets']) { const e = await startEngine({ root: r, assets }); if (!e.ok) throw Error(e.error.code); engines.push(e.value); return e.value; }
const command = (e: EngineHandle, id: string, name = id) => ({ schemaVersion: 1, libraryId: e.identity.libraryId, connectionEpoch: 'fixture', commandId: id, kind: 'project.create', payload: { name } });
it('recovers the original or fully installed candidate after a real process interruption during migration staging on Windows', async () => {
  const r = await root(); const db = new DatabaseSync(join(r, 'library.sqlite')); migrateProjects(db, 'migration-owner');
  db.exec("INSERT INTO project VALUES('p','migration-owner','Keep original','2026')"); db.close();
  const { mkdir } = await import('node:fs/promises'); await mkdir(join(r, 'temp'));
  let arrived!: () => void; const staged = new Promise<void>(resolve => { arrived = resolve; });
  const observer = watch(join(r, 'temp'), (_event, file) => { if (String(file).startsWith('migration-') && String(file).endsWith('.sqlite')) arrived(); });
  const child = fork(resolve('tests/fixtures/migration-child.ts'), [r], { execArgv: ['--experimental-strip-types'], stdio: ['ignore','ignore','pipe','ipc'] });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([staged, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No migration candidate observed')), 5000); })]);
    await stopChild(child);
  } finally { clearTimeout(timer); observer.close(); await stopChild(child); }
  const original = new DatabaseSync(join(r, 'library.sqlite'), { readOnly: true });
  expect([1, CURRENT_SCHEMA_VERSION]).toContain(original.prepare('PRAGMA user_version').get()!.user_version);
  expect(original.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
  expect(original.prepare('SELECT name FROM project').get()).toMatchObject({ name: 'Keep original' }); original.close();
  const backupName = (await readdir(join(r, 'backups'))).find(f => f.endsWith('.sqlite'))!;
  const backup = new DatabaseSync(join(r, 'backups', backupName), { readOnly: true }); expect(backup.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 }); backup.close();
  const recovered = await open(r); expect(recovered.identity).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, libraryId: 'migration-owner' }); expect(recovered.projects.list()).toMatchObject({ ok: true, value: [{ name: 'Keep original' }] });
});
it('serializes maintenance with collection and shutdown, rejects new writes, and keeps a schema-bound snapshot manifest', async () => {
  const r = await root(); let release!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { reached = resolve; });
  const e = await open(r, { onPhase: async phase => { if (phase === 'beforePublish') { reached(); await held; } } });
  const path = join(r, 'fixture.png'); await writeFile(path, await sharp({ create: { width: 2, height: 2, channels: 3, background: '#223344' } }).png().toBuffer()); const s = await stat(path);
  e.assets.registerGrant({ libraryId: e.identity.libraryId, grantId: 'g', importId: 'i', expiresAt: Date.now() + 60000, files: [{ path, realPath: path, allowedRoot: r, name: 'f', size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino }] });
  const importing = e.commands.execute({ ...command(e, 'i'), kind: 'asset.importGrantedFiles', payload: { grantId: 'g' } }); await entered;
  try {
    const snapshot = e.maintenance.snapshot();
    expect(await e.commands.execute(command(e, 'during-maintenance'))).toMatchObject({ ok: false, error: { code: 'MAINTENANCE_BUSY' } });
    expect(await e.maintenance.snapshot()).toMatchObject({ ok: false, error: { code: 'MAINTENANCE_BUSY' } });
    const closing = e.quiesceEngine('quit', Date.now() + 2000);
    expect(await e.maintenance.snapshot()).toMatchObject({ ok: false, error: { code: 'ENGINE_QUIESCING' } });
    release(); expect(await importing).toMatchObject({ ok: true });
    const result = await snapshot; expect(result.ok).toBe(true); if (!result.ok) throw Error(result.error.code);
    expect(await closing).toMatchObject({ persisted: true, resourcesExited: true, interrupted: false, cleanupPending: false });
    const manifest = JSON.parse(await readFile(join(r, 'backups', `${result.value.snapshotId}.json`), 'utf8'));
    expect(manifest).toMatchObject({ libraryId: e.identity.libraryId, schemaVersion: CURRENT_SCHEMA_VERSION, schedulingOnRestore: 'disabled', compatibleBackupRequired: true, objects: [{ hash: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
    const db = new DatabaseSync(join(r, 'backups', `${result.value.snapshotId}.sqlite`), { readOnly: true }); expect(db.prepare('SELECT count(*) AS n FROM asset_version').get()).toMatchObject({ n: 1 }); db.close();
  } finally { release(); await importing; }
});
it('retains real child ownership after final cleanup failure until that owned process exits', async () => {
  const r = await root(); await writeFile(join(r, 'fixture.png'), 'unused');
  const c = lifecycleChild(r, 'http://127.0.0.1:1', 'cleanup');
  try {
    const result = await c.phase('cleanup');
    expect(result.report).toMatchObject({ stoppedClaiming: true, persisted: true, resourcesExited: false, cleanupPending: true });
    const duplicate = await startEngine({ root: r });
    if (duplicate.ok) { engines.push(duplicate.value); }
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'LIBRARY_IN_USE' } });
  } finally { await stopChild(c.child); await rm(join(r, 'engine.lock'), { recursive: true, force: true }); }
  expect((await open(r)).projects.list()).toMatchObject({ ok: true, value: [{ name: 'Retained across cleanup failure' }] });
});
it('bounds quiesce honestly, closes admission immediately and holds ownership until collection really drains', async () => {
  const r = await root(); let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { reached = resolve; });
  const e = await open(r, { onPhase: async phase => { if (phase === 'beforePublish') { reached(); await gate; } } });
  const path = join(r, 'fixture.png'); await writeFile(path, await sharp({ create: { width: 2, height: 2, channels: 3, background: '#542517' } }).png().toBuffer()); const s = await stat(path);
  e.assets.registerGrant({ libraryId: e.identity.libraryId, grantId: 'g', importId: 'i', expiresAt: Date.now() + 60000, files: [{ path, realPath: path, allowedRoot: r, name: 'f', size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino }] });
  const importing = e.commands.execute({ ...command(e, 'import'), kind: 'asset.importGrantedFiles', payload: { grantId: 'g' } }); await entered;
  try {
    const quiesce = (e as any).quiesceEngine;
    expect(typeof quiesce).toBe('function');
    const closing = quiesce('quit', Date.now() + 50);
    expect(await e.commands.execute(command(e, 'late'))).toMatchObject({ ok: false, error: { code: 'ENGINE_QUIESCING' } });
    expect(await closing).toMatchObject({ stoppedClaiming: true, persisted: false, resourcesExited: false, cleanupPending: true, interrupted: true });
    expect(await startEngine({ root: r })).toMatchObject({ ok: false, error: { code: 'LIBRARY_IN_USE' } });
  } finally { release(); await importing; await e.close(); }
  let next!: EngineHandle;
  await vi.waitFor(async () => { const result = await startEngine({ root: r }); expect(result.ok).toBe(true); if (result.ok) { next = result.value; engines.push(next); } }, { timeout: 2000 });
  expect(next.assets.search()).toMatchObject({ assets: [expect.anything()] });
});
it('stages migrations against a consistent WAL snapshot and leaves the original schema and backup on failure', async () => {
  const r = await root(), path = join(r, 'library.sqlite'); const old = new DatabaseSync(path);
  old.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0'); migrateProjects(old, 'original-library');
  old.exec("INSERT INTO project VALUES('p','original-library','WAL only','2026'); CREATE TABLE canvas(poison TEXT)");
  // A second live connection keeps the WAL in place; the candidate must include it.
  expect(await startEngine({ root: r })).toMatchObject({ ok: false, error: { code: 'LIBRARY_OPEN_FAILED' } });
  expect(old.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
  expect(old.prepare('SELECT name FROM project').get()).toMatchObject({ name: 'WAL only' });
  const files = await readdir(join(r, 'backups'));
  const backup = files.find(f => f.endsWith('.sqlite')); expect(backup).toBeDefined();
  const b = new DatabaseSync(join(r, 'backups', backup!), { readOnly: true }); expect(b.prepare('SELECT name FROM project').get()).toMatchObject({ name: 'WAL only' }); expect(b.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 }); b.close();
  const diagnostics = await readdir(join(r, 'logs')); expect(diagnostics.some(f => f.startsWith('migration-'))).toBe(true);
  expect(JSON.parse(await readFile(join(r, 'logs', diagnostics.find(f => f.startsWith('migration-'))!), 'utf8'))).toMatchObject({ code: 'MIGRATION_FAILED', fromSchema: 1, toSchema: CURRENT_SCHEMA_VERSION, compatibleBackupRequired: true });
  old.exec('DROP TABLE canvas'); old.close(); const e = await open(r); expect(e.identity).toMatchObject({ libraryId: 'original-library', schemaVersion: CURRENT_SCHEMA_VERSION }); expect(e.projects.list()).toMatchObject({ ok: true, value: [{ name: 'WAL only' }] });
});
