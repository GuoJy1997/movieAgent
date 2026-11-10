import {CURRENT_SCHEMA_VERSION} from '../../packages/storage/src/schema.ts';
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink, unlink } from 'node:fs/promises';
import { createDirectoryProject, bindDirectoryProject } from '../../apps/desktop/src/main/project-directories.ts';
import { openLibrary } from '../../packages/storage/src/database.ts';
import { projectsFor } from '../../packages/engine/src/projects.ts';
import type { Result } from '../../packages/contracts/src/result.ts';

import * as api from '../../packages/storage/src/project-backup.ts';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function value<T>(result: Result<T>): T { if (!result.ok) throw Error(result.error.code); return result.value; }
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
async function fixture(bound = true) {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-p5-')); roots.push(root);
  let project = value(await createDirectoryProject({ mode: 'new', directory: root, name: '短剧 项目' }));
  await writeFile(join(project.root, 'scripts/outline.md'), '# 故事大纲\n不丢失的中文剧本。');
  await mkdir(join(project.root, '自建 空文件夹'));
  await writeFile(join(root, 'models.json'), '{"apiKey":"outside-project-never-copy"}');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const objectHash = hash(bytes);
  if (bound) {
    const library = value(await openLibrary({ root: project.libraryRoot }));
    try {
      const domain = value(projectsFor(library).create({ name: project.manifest.name }));
      const storageKey = `objects/${objectHash.slice(0, 2)}/${objectHash}`;
      await mkdir(join(project.libraryRoot, 'objects', objectHash.slice(0, 2)), { recursive: true });
      await writeFile(join(project.libraryRoot, storageKey), bytes);
      library.db.prepare('INSERT INTO blob_object VALUES(?,?,?,?,?,?,?)').run(objectHash, objectHash, bytes.length, storageKey, 'image/png', 1, 1);
      library.db.prepare('INSERT INTO asset(id,library_id,name) VALUES(?,?,?)').run('asset-fixture', library.libraryId, '固定原件');
      library.db.prepare('INSERT INTO asset_version VALUES(?,?,?,?,?,?)').run('asset-fixture', 1, library.libraryId, objectHash, null, new Date().toISOString());
      project = value(await bindDirectoryProject(project.root, { workspaceId: project.manifest.workspaceId, libraryId: library.libraryId, projectId: domain.id }));
    } finally { value(await library.close()); }
  }
  return { root, project, bytes, objectHash, destination: join(root, '完整备份'), restored: join(root, '恢复 项目') };
}
function required(name: keyof typeof api) { expect(api[name], name).toBeTypeOf('function'); }

it('backs up a closed real project and restores immutable IDs, original bytes and editable scripts into a paused new workspace', async () => {
  required('createProjectBackup'); required('inspectProjectBackup'); required('restoreProjectBackup');
  const f = await fixture();
  const before = await readFile(join(f.project.root, 'movieagent.project.json'));
  const saved = value(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' }));
  expect(saved).toMatchObject({ root: f.destination });
  const manifest = value<any>(await api.inspectProjectBackup(f.destination));
  expect(manifest).toMatchObject({ format: 'movieagent.project-backup', schemaVersion: 1, databaseSchema: CURRENT_SCHEMA_VERSION, source: { workspaceId: f.project.manifest.workspaceId, ...f.project.manifest.binding } });
  expect(manifest.files.some((x: any) => x.path.endsWith(f.objectHash) && x.sha256 === f.objectHash)).toBe(true);
  expect(manifest.files.some((x: any) => /models\.json|engine\.lock|engine-guard|backups\/|temp\//.test(x.path))).toBe(false);
  const restored = value<any>(await api.restoreProjectBackup({ backupRoot: f.destination, destination: f.restored }));
  expect(restored).toMatchObject({ root: f.restored, scheduling: 'paused' });
  const copy = JSON.parse(await readFile(join(f.restored, 'movieagent.project.json'), 'utf8'));
  expect(copy.binding).toEqual(f.project.manifest.binding);
  expect(copy.workspaceId).not.toBe(f.project.manifest.workspaceId);
  expect(await readFile(join(f.restored, 'scripts/outline.md'), 'utf8')).toContain('不丢失的中文剧本');
  expect(await readdir(join(f.restored, '自建 空文件夹'))).toEqual([]);
  expect(await readFile(join(f.restored, '.movieagent/library/objects', f.objectHash.slice(0, 2), f.objectHash))).toEqual(f.bytes);
  const db = new DatabaseSync(join(f.restored, '.movieagent/library/library.sqlite'), { readOnly: true });
  try { expect(db.prepare('SELECT id FROM project').get()?.id).toBe(f.project.manifest.binding!.projectId); expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok'); } finally { db.close(); }
  expect(await readFile(join(f.project.root, 'movieagent.project.json'))).toEqual(before);
  const repeated = value<any>(await api.restoreProjectBackup({ backupRoot: f.destination, destination: f.restored }));
  expect(repeated.workspaceId).toBe(copy.workspaceId);
});

it('refuses backup of an open project without creating a destination', async () => {
  required('createProjectBackup'); const f = await fixture();
  const library = value(await openLibrary({ root: f.project.libraryRoot }));
  try { expect(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' })).toMatchObject({ ok: false, error: { code: 'PROJECT_IN_USE' } }); }
  finally { value(await library.close()); }
  expect((await readdir(f.root)).includes('完整备份')).toBe(false);
});

it('rejects a changed backup file before publishing or modifying a restore destination', async () => {
  required('createProjectBackup'); required('restoreProjectBackup'); const f = await fixture();
  value(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' }));
  await writeFile(join(f.destination, 'project/scripts/outline.md'), '篡改');
  expect(await api.restoreProjectBackup({ backupRoot: f.destination, destination: f.restored })).toMatchObject({ ok: false, error: { code: 'BACKUP_HASH_MISMATCH' } });
  expect((await readdir(f.root)).includes('恢复 项目')).toBe(false);
});

it('preserves file-only projects without inventing a database', async () => {
  required('createProjectBackup'); required('restoreProjectBackup'); const f = await fixture(false);
  value(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' }));
  value(await api.restoreProjectBackup({ backupRoot: f.destination, destination: f.restored }));
  expect(JSON.parse(await readFile(join(f.restored, 'movieagent.project.json'), 'utf8')).binding).toBeNull();
  expect(await readdir(join(f.restored, '.movieagent/library'))).not.toContain('library.sqlite');
});

it('never overwrites an occupied target and rejects a backup nested in the source', async () => {
  required('createProjectBackup'); required('restoreProjectBackup'); const f = await fixture();
  expect(await api.createProjectBackup({ projectRoot: f.project.root, destination: join(f.project.root, 'backup'), appVersion: '0.2.0' })).toMatchObject({ ok: false, error: { code: 'TRANSFER_PATH_CONFLICT' } });
  value(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' }));
  await mkdir(f.restored); await writeFile(join(f.restored, 'keep.txt'), 'keep');
  expect(await api.restoreProjectBackup({ backupRoot: f.destination, destination: f.restored })).toMatchObject({ ok: false, error: { code: 'TRANSFER_TARGET_EXISTS' } });
  expect(await readFile(join(f.restored, 'keep.txt'), 'utf8')).toBe('keep');
});

it('does not publish a completed backup when a referenced original is missing', async () => {
  const f = await fixture(); await unlink(join(f.project.libraryRoot, 'objects', f.objectHash.slice(0, 2), f.objectHash));
  expect(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' })).toMatchObject({ ok: false, error: { code: 'BACKUP_OBJECT_MISSING' } });
  expect(await readdir(f.destination)).not.toContain('backup.json');
});
it('rejects database object identity that the engine cannot read, even when file bytes and foreign keys match', async () => {
  const f = await fixture(); const db = new DatabaseSync(join(f.project.libraryRoot, 'library.sqlite'));
  const bytes = Buffer.concat([f.bytes, Buffer.from([0])]), id = hash(bytes);
  await mkdir(join(f.project.libraryRoot, 'objects', id.slice(0, 2)), { recursive: true }); await writeFile(join(f.project.libraryRoot, 'objects', id.slice(0, 2), id), bytes);
  try { db.prepare('INSERT INTO blob_object VALUES(?,?,?,?,?,?,?)').run('wrong-id', id, bytes.length, `objects/${id.slice(0, 2)}/${id}`, 'image/png', 1, 1); } finally { db.close(); }
  expect(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' })).toMatchObject({ ok: false, error: { code: 'BACKUP_OBJECT_MISSING' } });
  expect(await readdir(f.destination)).not.toContain('backup.json');
});

it.each(['../escape.txt', 'scripts/CON.txt', 'scripts/outline.md/child', 'Scripts/Outline.md'])('refuses hostile or conflicting manifest paths: %s', async (path) => {
  const f = await fixture(false); value(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' }));
  const file = join(f.destination, 'backup.json'), manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.files.push({ path, byteLength: 0, sha256: hash(Buffer.alloc(0)) }); await writeFile(file, JSON.stringify(manifest));
  expect((await api.restoreProjectBackup({ backupRoot: f.destination, destination: f.restored })).ok).toBe(false);
  expect(await readdir(f.root)).not.toContain('恢复 项目');
});

it('refuses junctions in user files without reading or copying their contents', async () => {
  const f = await fixture(false); await symlink(f.root, join(f.project.root, 'linked'), 'junction');
  expect(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' })).toMatchObject({ ok: false, error: { code: 'TRANSFER_PATH_CONFLICT' } });
  expect(await readdir(f.root)).not.toContain('完整备份');
});

it('includes committed WAL bytes and rejects a future schema without altering the source', async () => {
  const f = await fixture(); const db = new DatabaseSync(join(f.project.libraryRoot, 'library.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
    db.prepare('UPDATE project SET name=?').run('WAL中最后的名字');
    value(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination, appVersion: '0.2.0' }));
    const snapshot = new DatabaseSync(join(f.destination, 'project/.movieagent/library/library.sqlite'), { readOnly: true });
    try { expect(snapshot.prepare('SELECT name FROM project').get()?.name).toBe('WAL中最后的名字'); } finally { snapshot.close(); }
    db.exec('PRAGMA user_version=999');
    expect(await api.createProjectBackup({ projectRoot: f.project.root, destination: f.destination + '-future', appVersion: '0.2.0' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_SCHEMA' } });
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(999);
  } finally { db.close(); }
});
