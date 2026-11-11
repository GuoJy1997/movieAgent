import { lstat, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isProjectName, isWorkspaceId, type DirectoryProject, type RecentProject, type RecentProjectStatus } from '../../../../packages/contracts/src/directory-projects.ts';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { canonicalPath, hasFsCode, inspectDirectoryProject, isLocalAbsolutePath, readBoundedFile, serializeDirectoryOperation, writeAtomicFile } from './project-directories.ts';

const maxRegistryBytes = 4 * 1024 * 1024;
const maxRegisteredProjects = 10_000;
const displayedRecentProjects = 50;
function validEntry(entry: unknown): entry is RecentProject {
  return isRecord(entry) && Object.keys(entry).length === 5 && isWorkspaceId(entry.workspaceId) && isProjectName(entry.name)
    && isLocalAbsolutePath(entry.root) && entry.root === resolve(entry.root) && entry.pathCanonical === canonicalPath(entry.root)
    && typeof entry.lastOpenedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.lastOpenedAt)
    && Number.isFinite(Date.parse(entry.lastOpenedAt));
}
async function load(path: string): Promise<Result<RecentProject[]>> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return fail('INVALID_RECENT_PROJECTS', '最近项目索引必须是普通文件。');
    const bytes = await readBoundedFile(path, maxRegistryBytes);
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''));
    if (isRecord(data) && typeof data.schemaVersion === 'number' && data.schemaVersion > 1) return fail('UNSUPPORTED_RECENT_VERSION', '最近项目索引版本较新。');
    if (!isRecord(data) || Object.keys(data).length !== 2 || data.schemaVersion !== 1 || !Array.isArray(data.projects)
      || data.projects.length > maxRegisteredProjects || !data.projects.every(validEntry)
      || new Set(data.projects.map(project => project.workspaceId)).size !== data.projects.length
      || new Set(data.projects.map(project => project.pathCanonical)).size !== data.projects.length) {
      return fail('INVALID_RECENT_PROJECTS', '最近项目索引格式无效，请保留原文件后检查。');
    }
    return ok(data.projects);
  } catch (error) {
    if (hasFsCode(error, 'ENOENT')) return ok([]);
    return fail('INVALID_RECENT_PROJECTS', '无法读取最近项目索引，请保留原文件后检查。');
  }
}

/** Main-only display/path/identity index, without credentials or database bindings. */
export class RecentProjects {
  private constructor(private readonly path: string) {}
  static async open(path: string): Promise<Result<RecentProjects>> {
    if (!isLocalAbsolutePath(path)) return fail('INVALID_RECENT_PATH', '最近项目索引需要绝对本地路径。');
    const loaded = await load(resolve(path)); if (!loaded.ok) return loaded;
    return ok(new RecentProjects(resolve(path)));
  }
  async list(): Promise<Result<RecentProjectStatus[]>> {
    const loaded = await load(this.path); if (!loaded.ok) return loaded;
    const projects: RecentProjectStatus[] = [];
    for (const entry of loaded.value.slice(0, displayedRecentProjects)) {
      let availability: RecentProjectStatus['availability'] = 'invalid';
      try {
        await lstat(entry.root);
        const inspected = await inspectDirectoryProject(entry.root);
        if (inspected.ok && inspected.value.manifest.workspaceId === entry.workspaceId) availability = 'available';
      } catch (error) { if (hasFsCode(error, 'ENOENT')) availability = 'missing'; }
      projects.push({ ...entry, availability });
    }
    return ok(projects);
  }
  /** Read-only child admission over every retained identity, including hidden UI entries. */
  async validate(project: DirectoryProject): Promise<Result<void>> {
    const loaded = await load(this.path); if (!loaded.ok) return loaded;
    const entry = loaded.value.find(item => item.workspaceId === project.manifest.workspaceId);
    return entry?.pathCanonical === canonicalPath(project.root)
      ? ok(undefined) : fail('WORKSPACE_NOT_REGISTERED', '请通过项目启动器登记并打开此文件夹。');
  }
  async find(workspaceId: string): Promise<Result<RecentProject>> {
    const loaded = await load(this.path); if (!loaded.ok) return loaded;
    const entry = loaded.value.find(item => item.workspaceId === workspaceId);
    return entry ? ok(entry) : fail('PROJECT_NOT_REGISTERED', '最近项目不存在。');
  }
  async remember(project: DirectoryProject): Promise<Result<RecentProject>> {
    if (!isRecord(project) || typeof project.root !== 'string' || !isRecord(project.manifest)) return fail('INVALID_DIRECTORY_PROJECT', '项目身份无效。');
    const inspected = await inspectDirectoryProject(project.root); if (!inspected.ok) return inspected;
    if (inspected.value.manifest.workspaceId !== project.manifest.workspaceId) return fail('PROJECT_WORKSPACE_MISMATCH', '项目工作区身份不一致。');
    const actual = inspected.value;
    return serializeDirectoryOperation(canonicalPath(this.path), async () => {
      const loaded = await load(this.path); if (!loaded.ok) return loaded;
      const key = canonicalPath(actual.root);
      const sameId = loaded.value.find(entry => entry.workspaceId === actual.manifest.workspaceId && entry.pathCanonical !== key);
      if (sameId) {
        try {
          await lstat(sameId.root);
          return fail('DUPLICATE_WORKSPACE', '另一个仍存在的文件夹使用相同项目身份，请打开原项目。');
        } catch (error) {
          if (!hasFsCode(error, 'ENOENT')) return fail('RECENT_PROJECT_CHECK_FAILED', '无法确认原项目已搬移，请检查原文件夹。');
        }
      }
      const entry: RecentProject = { workspaceId: actual.manifest.workspaceId, name: actual.manifest.name, root: actual.root, pathCanonical: key, lastOpenedAt: new Date().toISOString() };
      const projects = [entry, ...loaded.value.filter(previous => previous.workspaceId !== entry.workspaceId && previous.pathCanonical !== key)];
      if (projects.length > maxRegisteredProjects) return fail('RECENT_PROJECTS_FULL', '项目索引已达 10000 条，请先保留并整理原索引。');
      const source = `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`;
      if (Buffer.byteLength(source, 'utf8') > maxRegistryBytes) return fail('RECENT_PROJECTS_TOO_LARGE', '最近项目索引超过 4 MiB。');
      try {
        await mkdir(dirname(this.path), { recursive: true });
        await writeAtomicFile(this.path, source, true);
        return ok(entry);
      } catch { return fail('RECENT_PROJECT_WRITE_FAILED', '无法保存最近项目索引。'); }
    });
  }
}
