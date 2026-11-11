import { fail, isRecord, ok, type Result } from './result.ts';

export interface ProjectBinding { libraryId: string; projectId: string }
export interface ProjectManifest {
  format: 'movieagent.project'; schemaVersion: 1; templateVersion: 1;
  workspaceId: string; name: string; createdAt: string; binding: ProjectBinding | null;
}
export interface DirectoryProject { root: string; manifest: ProjectManifest; libraryRoot: string }
export interface CreateDirectoryProjectInput { mode: 'new' | 'existing'; directory: string; name: string }
export interface DirectoryProjectBinding extends ProjectBinding { workspaceId: string }
export interface RecentProject { workspaceId: string; name: string; root: string; pathCanonical: string; lastOpenedAt: string }
export interface RecentProjectStatus extends RecentProject { availability: 'available' | 'missing' | 'invalid' }

export function isProjectName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value
    && !/[<>:"/\\|?*\u0000-\u001f]/u.test(value) && !/[. ]$/.test(value)
    && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value);
}
export function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
export function isProjectBinding(value: unknown): value is ProjectBinding {
  return isRecord(value) && Object.keys(value).length === 2
    && [value.libraryId, value.projectId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[\u0000-\u001f]/u.test(id));
}
export function parseProjectManifest(value: unknown): Result<ProjectManifest> {
  if (isRecord(value) && (typeof value.schemaVersion === 'number' && value.schemaVersion > 1 || typeof value.templateVersion === 'number' && value.templateVersion > 1)) {
    return fail('UNSUPPORTED_PROJECT_VERSION', '项目版本较新，请使用支持此版本的应用。');
  }
  if (!isRecord(value) || Object.keys(value).length !== 7 || value.format !== 'movieagent.project' || value.schemaVersion !== 1
    || value.templateVersion !== 1 || !isWorkspaceId(value.workspaceId) || !isProjectName(value.name)
    || typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)
    || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt
    || !(value.binding === null || isProjectBinding(value.binding))) {
    return fail('INVALID_PROJECT_MANIFEST', '项目清单格式无效，请检查项目文件。');
  }
  return ok(value as unknown as ProjectManifest);
}
