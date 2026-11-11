import { isProjectName, isWorkspaceId } from './directory-projects.ts';
import { CURRENT_SCHEMA_VERSION } from './schema.ts';
import { fail, isRecord, ok, type Result } from './result.ts';

export const BACKUP_LIMITS = Object.freeze({ files: 100_000, depth: 32, fileBytes: 8 * 1024 ** 3, totalBytes: 256 * 1024 ** 3, manifestBytes: 16 * 1024 ** 2, projectManifestBytes: 64 * 1024 });
export interface BackupFile { path: string; byteLength: number; sha256: string }
export interface BackupManifest {
  format: 'movieagent.project-backup'; schemaVersion: 1; backupId: string; createdAt: string; appVersion: string; databaseSchema: number;
  source: { workspaceId: string; libraryId: string | null; projectId: string | null };
  directories: string[]; files: BackupFile[];
}
export interface BackupReceipt { root: string; backupId: string; fileCount: number; byteLength: number; manifestHash: string }
export interface TransferReceipt {
  root: string; workspaceId: string; sourceWorkspaceId: string; libraryId: string | null; projectId: string | null;
  backupId: string; manifestHash: string; scheduling: 'paused' | 'active'; sourceRetired?: boolean;
}
export interface MaintenanceInfo { appVersion: string; databaseSchema: number; backupFormat: 1 }
export function isBackupPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && value.length > 0 && value.split('/').length <= BACKUP_LIMITS.depth
    && value.split('/').every(part => part !== '.' && part !== '..' && isProjectName(part));
}
export function isBackupFile(value: unknown): value is BackupFile {
  return isRecord(value) && Object.keys(value).length === 3 && isBackupPath(value.path)
    && typeof value.byteLength === 'number' && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 && value.byteLength <= BACKUP_LIMITS.fileBytes
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
}
function identity(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/u.test(value); }
export function parseBackupManifest(value: unknown): Result<BackupManifest> {
  if (isRecord(value) && (typeof value.schemaVersion === 'number' && value.schemaVersion > 1 || typeof value.databaseSchema === 'number' && value.databaseSchema > CURRENT_SCHEMA_VERSION)) return fail('UNSUPPORTED_BACKUP_VERSION', '备份版本较新，请使用兼容版本恢复。');
  if (!isRecord(value) || Object.keys(value).length !== 9 || value.format !== 'movieagent.project-backup' || value.schemaVersion !== 1
    || !isWorkspaceId(value.backupId) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt
    || typeof value.appVersion !== 'string' || !/^[a-zA-Z0-9.+-]{1,80}$/.test(value.appVersion)
    || !Number.isInteger(value.databaseSchema) || (value.databaseSchema as number) < 0
    || !isRecord(value.source) || Object.keys(value.source).length !== 3 || !isWorkspaceId(value.source.workspaceId)
    || !(value.source.libraryId === null && value.source.projectId === null || identity(value.source.libraryId) && identity(value.source.projectId))
    || (value.databaseSchema === 0) !== (value.source.libraryId === null)
    || !Array.isArray(value.directories) || !value.directories.every(isBackupPath)
    || !Array.isArray(value.files) || !value.files.every(isBackupFile) || value.files.length + value.directories.length > BACKUP_LIMITS.files) return fail('INVALID_BACKUP_MANIFEST', '备份清单格式无效。');
  const paths = [...value.directories, ...value.files.map(file => file.path)];
  if (new Set(paths.map(path => path.toLowerCase())).size !== paths.length || value.files.reduce((n, file) => n + file.byteLength, 0) > BACKUP_LIMITS.totalBytes) return fail('INVALID_BACKUP_MANIFEST', '备份路径重复或超过容量限制。');
  for (const path of paths) if (path.startsWith('.movieagent/') && !['.movieagent/library', '.movieagent/library/objects', '.movieagent/library/library.sqlite'].includes(path)
    && !/^\.movieagent\/library\/objects\/[a-f0-9]{2}(?:\/[a-f0-9]{64})?$/.test(path)) return fail('INVALID_BACKUP_MANIFEST', '备份包含不支持的应用内部路径。');
  return ok(value as unknown as BackupManifest);
}
