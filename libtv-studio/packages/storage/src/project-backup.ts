import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseProjectManifest, isProjectName, type ProjectManifest } from '../../contracts/src/directory-projects.ts';
import { BACKUP_LIMITS, isBackupPath, parseBackupManifest, type BackupFile, type BackupManifest, type BackupReceipt, type TransferReceipt } from '../../contracts/src/project-maintenance.ts';
import { CURRENT_SCHEMA_VERSION } from '../../contracts/src/schema.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { acquireProjectMaintenance } from './project-maintenance-lock.ts';
import { localDirectory, plainPath, readLimited, sha256, transferDestination, transferError, transferFile, TransferError, writeTransferJson } from './project-transfer-files.ts';
import { readTransferReceipt } from './project-transfer-receipt.ts';
import { snapshotDatabase } from './maintenance.ts';

const projectFile = 'movieagent.project.json';
const databaseFile = '.movieagent/library/library.sqlite';
const objectsPath = '.movieagent/library/objects';
const statePath = '.movieagent/library/.maintenance-state.json';
const receiptPath = '.movieagent/transfer.json';
const errorResult = (error: unknown): Result<never> => fail(transferError(error), '操作未完成。源项目保持原样；请检查目标位置和项目状态后重试。');
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new TransferError(result.error.code); return result.value; }
function json(bytes: Uint8Array): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')); } catch { throw new TransferError('INVALID_BACKUP_MANIFEST'); } }
async function readProject(root: string): Promise<ProjectManifest> { return unwrap(parseProjectManifest(json(await readLimited(root, projectFile, BACKUP_LIMITS.projectManifestBytes)))); }
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
async function newDirectory(path: string): Promise<void> { try { await mkdir(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new TransferError('TRANSFER_TARGET_EXISTS'); throw e; } }

interface Tree { directories: string[]; paths: string[] }
/** All project files outside .movieagent are user-owned. Internal caches and credentials are excluded. */
async function tree(root: string, payloadOnly = false): Promise<Tree> {
  const directories: string[] = [], paths: string[] = [], seen = new Set<string>();
  async function visit(path: string) {
    for (const entry of await readdir(path ? join(root, path) : root, { withFileTypes: true })) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (!payloadOnly && child.toLowerCase() === '.movieagent') continue;
      if (!isBackupPath(child) || seen.has(child.toLowerCase())) throw new TransferError('INVALID_BACKUP_PATH');
      seen.add(child.toLowerCase());
      if (seen.size > BACKUP_LIMITS.files) throw new TransferError('BACKUP_LIMIT_EXCEEDED');
      if (entry.isDirectory()) { await plainPath(root, child, 'directory'); directories.push(child); await visit(child); }
      else if (entry.isFile()) { await plainPath(root, child, 'file'); paths.push(child); }
      else throw new TransferError('TRANSFER_PATH_CONFLICT');
    }
  }
  await visit('');
  return { directories: directories.sort(), paths: paths.sort() };
}
async function durableObjects(root: string): Promise<Tree> {
  const directories = ['.movieagent', '.movieagent/library'], paths: string[] = [];
  if (!(await exists(join(root, objectsPath)))) return { directories, paths };
  await plainPath(root, objectsPath, 'directory'); directories.push(objectsPath);
  for (const prefix of await readdir(join(root, objectsPath))) {
    if (!/^[a-f0-9]{2}$/.test(prefix)) throw new TransferError('INVALID_OBJECT_PATH');
    const dir = `${objectsPath}/${prefix}`; await plainPath(root, dir, 'directory'); directories.push(dir);
    for (const file of await readdir(join(root, dir))) {
      if (!/^[a-f0-9]{64}$/.test(file) || !file.startsWith(prefix)) throw new TransferError('INVALID_OBJECT_PATH');
      const path = `${dir}/${file}`; await plainPath(root, path, 'file'); paths.push(path);
      if (paths.length + directories.length > BACKUP_LIMITS.files) throw new TransferError('BACKUP_LIMIT_EXCEEDED');
    }
  }
  return { directories, paths };
}
function checkDatabase(path: string, project: ProjectManifest, files: BackupFile[]): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > CURRENT_SCHEMA_VERSION) throw new TransferError('UNSUPPORTED_SCHEMA');
    if (version < 1 || db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new TransferError('BACKUP_DATABASE_INVALID');
    const identity = db.prepare('SELECT id,schema_version FROM library WHERE singleton=1').get();
    if (!project.binding || identity?.id !== project.binding.libraryId || identity.schema_version !== version || !db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(project.binding.projectId, project.binding.libraryId)) throw new TransferError('PROJECT_BINDING_CONFLICT');
    if (version >= 4) {
      const lookup = new Map(files.map(file => [file.path, file]));
      const rows = db.prepare('SELECT object_id,hash,byte_length,storage_key FROM blob_object LIMIT 100001').all();
      if (rows.length > BACKUP_LIMITS.files) throw new TransferError('BACKUP_LIMIT_EXCEEDED');
      for (const row of rows) {
        const hash = String(row.hash), key = String(row.storage_key), file = lookup.get(`.movieagent/library/${key}`);
        if (!/^[a-f0-9]{64}$/.test(hash) || row.object_id !== hash || key !== `objects/${hash.slice(0, 2)}/${hash}` || !file || file.sha256 !== hash || file.byteLength !== row.byte_length) throw new TransferError('BACKUP_OBJECT_MISSING');
      }
    }
    return version;
  } finally { db.close(); }
}
async function checkedFiles(root: string, paths: string[], copyRoot?: string): Promise<BackupFile[]> {
  const files: BackupFile[] = []; let total = 0;
  for (const path of paths) {
    const file = await transferFile(root, path, copyRoot ? join(copyRoot, path) : undefined);
    total += file.byteLength; if (total > BACKUP_LIMITS.totalBytes) throw new TransferError('BACKUP_LIMIT_EXCEEDED');
    if (path.startsWith(objectsPath + '/') && file.sha256 !== path.split('/').at(-1)) throw new TransferError('BACKUP_HASH_MISMATCH');
    if (copyRoot) { const copied = await transferFile(copyRoot, path); if (copied.sha256 !== file.sha256 || copied.byteLength !== file.byteLength) throw new TransferError('BACKUP_HASH_MISMATCH'); }
    files.push(file);
  }
  return files;
}

/** Caller owns the cold project's guard. Used by backup and migration without racing a reopened engine. */
export async function createBackupUnderGuard(root: string, destination: string, appVersion: string): Promise<BackupReceipt> {
  const project = await readProject(root);
  const hasDatabase = await exists(join(root, databaseFile));
  if (hasDatabase !== (project.binding !== null)) throw new TransferError(hasDatabase ? 'PROJECT_INITIALIZATION_PENDING' : 'BOUND_LIBRARY_MISSING');
  const external = await tree(root), internal = await durableObjects(root);
  const directories = [...external.directories, ...internal.directories].sort();
  const paths = [...external.paths, ...internal.paths].sort();
  if (directories.length + paths.length + Number(hasDatabase) > BACKUP_LIMITS.files) throw new TransferError('BACKUP_LIMIT_EXCEEDED');
  await newDirectory(destination); const payload = join(destination, 'project'); await mkdir(payload);
  for (const path of directories) await mkdir(join(payload, path), { recursive: true });
  const files = await checkedFiles(root, paths, payload);
  let databaseSchema = 0;
  if (hasDatabase) {
    const source = new DatabaseSync(await plainPath(root, databaseFile, 'file'), { readOnly: true });
    try { snapshotDatabase(source, join(payload, databaseFile)); } finally { source.close(); }
    files.push(await transferFile(payload, databaseFile));
    databaseSchema = checkDatabase(join(payload, databaseFile), project, files);
  }
  const manifest: BackupManifest = { format: 'movieagent.project-backup', schemaVersion: 1, backupId: randomUUID(), createdAt: new Date().toISOString(), appVersion, databaseSchema, source: { workspaceId: project.workspaceId, libraryId: project.binding?.libraryId ?? null, projectId: project.binding?.projectId ?? null }, directories, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  unwrap(parseBackupManifest(manifest));
  const raw = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (raw.length > BACKUP_LIMITS.manifestBytes) throw new TransferError('BACKUP_LIMIT_EXCEEDED');
  await writeTransferJson(destination, 'backup.json', manifest); // completion marker is always last
  return { root: destination, backupId: manifest.backupId, fileCount: files.length, byteLength: files.reduce((n, file) => n + file.byteLength, 0), manifestHash: sha256(raw) };
}
export async function createProjectBackup(input: { projectRoot: string; destination: string; appVersion: string }): Promise<Result<BackupReceipt>> {
  let guard: Awaited<ReturnType<typeof acquireProjectMaintenance>> | undefined;
  try {
    const root = await localDirectory(input.projectRoot), destination = await transferDestination(root, input.destination);
    await readProject(root); guard = await acquireProjectMaintenance(root);
    return ok(await createBackupUnderGuard(root, destination, input.appVersion));
  } catch (error) { return errorResult(error); } finally { guard?.close(); }
}

async function inspectBackup(root: string): Promise<{ manifest: BackupManifest; project: ProjectManifest; manifestHash: string }> {
  const raw = await readLimited(root, 'backup.json', BACKUP_LIMITS.manifestBytes), manifest = unwrap(parseBackupManifest(json(raw)));
  const payload = await localDirectory(join(root, 'project')), actual = await tree(payload, true);
  if (JSON.stringify([...manifest.directories].sort()) !== JSON.stringify(actual.directories) || JSON.stringify(manifest.files.map(file => file.path).sort()) !== JSON.stringify(actual.paths)) throw new TransferError('BACKUP_CONTENT_MISMATCH');
  const lookup = new Map((await checkedFiles(payload, actual.paths)).map(file => [file.path, file]));
  for (const file of manifest.files) { const other = lookup.get(file.path)!; if (file.sha256 !== other.sha256 || file.byteLength !== other.byteLength) throw new TransferError('BACKUP_HASH_MISMATCH'); }
  const project = await readProject(payload);
  if (project.workspaceId !== manifest.source.workspaceId || (project.binding?.libraryId ?? null) !== manifest.source.libraryId || (project.binding?.projectId ?? null) !== manifest.source.projectId) throw new TransferError('PROJECT_BINDING_CONFLICT');
  if (manifest.databaseSchema === 0 ? lookup.has(databaseFile) : !lookup.has(databaseFile) || checkDatabase(join(payload, databaseFile), project, manifest.files) !== manifest.databaseSchema) throw new TransferError('BACKUP_DATABASE_INVALID');
  return { manifest, project, manifestHash: sha256(raw) };
}
export async function inspectProjectBackup(backupRoot: string): Promise<Result<BackupManifest>> {
  try { return ok((await inspectBackup(await localDirectory(backupRoot))).manifest); } catch (error) { return errorResult(error); }
}
export async function restoreProjectBackup(input: { backupRoot: string; destination: string; name?: string }): Promise<Result<TransferReceipt>> {
  try {
    const root = await localDirectory(input.backupRoot), destination = await transferDestination(root, input.destination);
    const { manifest, project, manifestHash } = await inspectBackup(root);
    if (input.name !== undefined && !isProjectName(input.name)) throw new TransferError('INVALID_PROJECT_NAME');
    if (await exists(destination)) {
      await localDirectory(destination);
      try { await readProject(destination); await plainPath(destination, receiptPath, 'file'); } catch { throw new TransferError('TRANSFER_TARGET_EXISTS'); }
      const targetGuard = await acquireProjectMaintenance(destination);
      try {
        const receipt = await readTransferReceipt(destination);
        if (receipt.backupId !== manifest.backupId || receipt.manifestHash !== manifestHash || receipt.sourceWorkspaceId !== project.workspaceId || project.binding && (receipt.libraryId !== project.binding.libraryId || receipt.projectId !== project.binding.projectId)) throw new TransferError('TRANSFER_TARGET_EXISTS');
        return ok(receipt);
      } finally { targetGuard.close(); }
    }
    await newDirectory(destination);
    for (const path of manifest.directories) await mkdir(join(destination, path), { recursive: true });
    const receipt: TransferReceipt = { root: destination, workspaceId: randomUUID(), sourceWorkspaceId: project.workspaceId, libraryId: manifest.source.libraryId, projectId: manifest.source.projectId, backupId: manifest.backupId, manifestHash, scheduling: 'paused' };
    await writeTransferJson(destination, statePath, { format: 'movieagent.maintenance-state', schemaVersion: 1, state: 'paused', transferId: manifest.backupId, sourceWorkspaceId: project.workspaceId });
    for (const file of manifest.files) {
      if (file.path === projectFile) continue;
      const copied = await transferFile(join(root, 'project'), file.path, join(destination, file.path));
      const readback = await transferFile(destination, file.path);
      if (copied.sha256 !== file.sha256 || copied.byteLength !== file.byteLength || readback.sha256 !== file.sha256 || readback.byteLength !== file.byteLength) throw new TransferError('BACKUP_HASH_MISMATCH');
    }
    await writeTransferJson(destination, receiptPath, receipt);
    await writeTransferJson(destination, projectFile, { ...project, workspaceId: receipt.workspaceId, name: input.name ?? project.name });
    return ok(receipt);
  } catch (error) { return errorResult(error); }
}
