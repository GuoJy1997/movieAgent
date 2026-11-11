import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isProjectBinding, isProjectName, parseProjectManifest, type CreateDirectoryProjectInput, type DirectoryProject, type DirectoryProjectBinding, type ProjectManifest } from '../../../../packages/contracts/src/directory-projects.ts';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { dramaTemplate } from './drama-template.ts';

const manifestName = 'movieagent.project.json';
const maxManifestBytes = 64 * 1024;
const operations = new Map<string, Promise<unknown>>();
// Fixed names used by openLibrary/objectStoreFor. Check them without opening SQL or traversing contents.
const engineDirectories = ['objects', 'previews', 'temp', 'exports', 'backups', 'logs'] as const;
const engineFiles = [
  'library.sqlite', 'library.sqlite-wal', 'library.sqlite-shm', 'library.sqlite-journal',
  'engine-guard.sqlite', 'engine-guard.sqlite-wal', 'engine-guard.sqlite-shm', 'engine-guard.sqlite-journal', 'engine.lock',
] as const;

/** Main-process writes are serialized; launcher/workspace guards own cross-process exclusion. */
export async function serializeDirectoryOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = operations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  operations.set(key, current);
  try { return await current; } finally { if (operations.get(key) === current) operations.delete(key); }
}
export function isLocalAbsolutePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 32_000 && !/[\u0000-\u001f]/u.test(path)
    && isAbsolute(path) && !/^(?:\\\\|\/\/)/.test(path) && (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(path));
}
export function canonicalPath(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
export function hasFsCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

/** Bounded even if a file grows during reading. Caller checks path components first. */
export async function readBoundedFile(path: string, limit: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('INVALID_FILE_TYPE');
    if (stat.size > limit) throw new Error('FILE_TOO_LARGE');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('FILE_TOO_LARGE');
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

/** Exclusive publication on creation; atomic replacement on binding/index updates. */
export async function writeAtomicFile(path: string, source: string, replace: boolean): Promise<void> {
  const temporary = join(dirname(path), `.${manifestName}-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(source, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    if (replace) await rename(temporary, path);
    else await link(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (!hasFsCode(error, 'ENOENT')) throw error; }); }
}

async function directoryRoot(input: unknown): Promise<Result<string>> {
  if (!isLocalAbsolutePath(input)) return fail('INVALID_PROJECT_PATH', '请选择绝对本地文件夹路径。');
  try {
    const stat = await lstat(input);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return fail('PROJECT_PATH_CONFLICT', '项目根目录必须是普通文件夹。');
    const root = await realpath(input);
    if (!isLocalAbsolutePath(root)) return fail('INVALID_PROJECT_PATH', '请选择绝对本地文件夹路径。');
    return ok(root);
  } catch (error) {
    return fail(hasFsCode(error, 'ENOENT') ? 'PROJECT_DIRECTORY_MISSING' : 'PROJECT_READ_FAILED', '无法读取项目文件夹。');
  }
}

/** Ancestors are checked individually: no child lookup traverses a reserved junction. */
async function checkReserved(root: string): Promise<Result<void>> {
  const entries: [string, 'directory' | 'file'][] = [
    ...dramaTemplate.directories.map(path => [path, 'directory'] as [string, 'directory']),
    ...Object.keys(dramaTemplate.files).map(path => [path, 'file'] as [string, 'file']),
    ...engineDirectories.map(path => [`.movieagent/library/${path}`, 'directory'] as [string, 'directory']),
    ...engineFiles.map(path => [`.movieagent/library/${path}`, 'file'] as [string, 'file']),
    [manifestName, 'file'],
  ];
  try {
    for (const [relative, type] of entries) {
      const components = relative.split('/');
      let current = root;
      for (let index = 0; index < components.length; index++) {
        current = join(current, components[index]!);
        let stat;
        try { stat = await lstat(current); } catch (error) { if (hasFsCode(error, 'ENOENT')) break; throw error; }
        const directory = index < components.length - 1 || type === 'directory';
        if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
          return fail('PROJECT_PATH_CONFLICT', '项目保留路径存在链接或文件类型冲突，请先整理此文件夹。');
        }
      }
    }
    return ok(undefined);
  } catch { return fail('PROJECT_READ_FAILED', '无法检查项目保留路径。'); }
}
async function readManifest(root: string): Promise<Result<ProjectManifest>> {
  let source: Buffer;
  try { source = await readBoundedFile(join(root, manifestName), maxManifestBytes); }
  catch (error) {
    if (hasFsCode(error, 'ENOENT')) return fail('PROJECT_MANIFEST_MISSING', '此文件夹没有项目清单，请使用“从已有文件夹创建”。');
    if (error instanceof Error && error.message === 'FILE_TOO_LARGE') return fail('PROJECT_MANIFEST_TOO_LARGE', '项目清单超过 64 KiB。');
    return fail('PROJECT_READ_FAILED', '无法读取项目清单。');
  }
  try { return parseProjectManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source).replace(/^\uFEFF/, ''))); }
  catch { return fail('INVALID_PROJECT_MANIFEST', '项目清单不是有效的 UTF-8 JSON。'); }
}
async function requireBoundDatabase(project: DirectoryProject): Promise<Result<DirectoryProject>> {
  if (project.manifest.binding === null) return ok(project);
  try {
    const stat = await lstat(join(project.libraryRoot, 'library.sqlite'));
    if (!stat.isFile() || stat.isSymbolicLink()) return fail('PROJECT_PATH_CONFLICT', '资料库路径存在链接或类型冲突。');
    return ok(project);
  } catch (error) {
    return fail(hasFsCode(error, 'ENOENT') ? 'BOUND_LIBRARY_MISSING' : 'PROJECT_READ_FAILED', '已绑定的资料库不可用，请恢复原资料库，不可重新初始化为空项目。');
  }
}
function projectAt(root: string, manifest: ProjectManifest): DirectoryProject {
  return { root, manifest, libraryRoot: join(root, '.movieagent', 'library') };
}

/** Read-only; missing templates/business database files are never created. */
export async function inspectDirectoryProject(root: string): Promise<Result<DirectoryProject>> {
  const checked = await directoryRoot(root); if (!checked.ok) return checked;
  const reserved = await checkReserved(checked.value); if (!reserved.ok) return reserved;
  const manifest = await readManifest(checked.value); if (!manifest.ok) return manifest;
  return requireBoundDatabase(projectAt(checked.value, manifest.value));
}

export async function createDirectoryProject(input: CreateDirectoryProjectInput): Promise<Result<DirectoryProject>> {
  if (!isRecord(input) || !isProjectName(input.name)) return fail('INVALID_PROJECT_NAME', '项目名称须为安全的 1–200 字符文件夹名称。');
  if (input.mode !== 'new' && input.mode !== 'existing') return fail('INVALID_PROJECT_MODE', '请选择新建或从已有文件夹创建。');
  const parent = await directoryRoot(input.directory); if (!parent.ok) return parent;
  const root = input.mode === 'new' ? join(parent.value, input.name) : parent.value;
  return serializeDirectoryOperation(canonicalPath(root), async () => {
    try {
      if (input.mode === 'new') {
        try { await mkdir(root); } catch (error) {
          return fail(hasFsCode(error, 'EEXIST') ? 'PROJECT_DIRECTORY_EXISTS' : 'PROJECT_WRITE_FAILED', '新建项目需要一个尚不存在的文件夹。');
        }
      }
      const reserved = await checkReserved(root); if (!reserved.ok) return reserved;
      let manifest = await readManifest(root);
      if (!manifest.ok && manifest.error.code !== 'PROJECT_MANIFEST_MISSING') return manifest;
      if (manifest.ok) {
        const bound = await requireBoundDatabase(projectAt(root, manifest.value)); if (!bound.ok) return bound;
      } else {
        const initial: ProjectManifest = { format: 'movieagent.project', schemaVersion: 1, templateVersion: 1, workspaceId: randomUUID(), name: input.name, createdAt: new Date().toISOString(), binding: null };
        try { await writeAtomicFile(join(root, manifestName), `${JSON.stringify(initial, null, 2)}\n`, false); }
        catch (error) { if (!hasFsCode(error, 'EEXIST')) throw error; }
        manifest = await readManifest(root); if (!manifest.ok) return manifest;
      }
      // Publish identity before filling templates so interrupted initialization can resume.
      for (const relative of dramaTemplate.directories) {
        const safe = await checkReserved(root); if (!safe.ok) return safe;
        try { await mkdir(join(root, ...relative.split('/'))); } catch (error) { if (!hasFsCode(error, 'EEXIST')) throw error; }
      }
      for (const [relative, content] of Object.entries(dramaTemplate.files)) {
        const safe = await checkReserved(root); if (!safe.ok) return safe;
        try { await writeAtomicFile(join(root, ...relative.split('/')), content, false); }
        catch (error) { if (!hasFsCode(error, 'EEXIST')) throw error; }
      }
      return inspectDirectoryProject(root);
    } catch { return fail('PROJECT_WRITE_FAILED', '无法完成项目创建；已有文件已保留，可再次打开继续初始化。'); }
  });
}

/** T3 calls after engine-owned initialization/equality checks under its library/profile guard. */
export async function bindDirectoryProject(root: string, binding: DirectoryProjectBinding): Promise<Result<DirectoryProject>> {
  if (!isRecord(binding) || !isProjectBinding({ libraryId: binding.libraryId, projectId: binding.projectId }) || typeof binding.workspaceId !== 'string') {
    return fail('INVALID_PROJECT_BINDING', '项目绑定身份无效。');
  }
  const checked = await directoryRoot(root); if (!checked.ok) return checked;
  return serializeDirectoryOperation(canonicalPath(checked.value), async () => {
    const inspected = await inspectDirectoryProject(checked.value); if (!inspected.ok) return inspected;
    const project = inspected.value;
    if (binding.workspaceId !== project.manifest.workspaceId) return fail('PROJECT_WORKSPACE_MISMATCH', '项目工作区身份不一致。');
    const next = { libraryId: binding.libraryId, projectId: binding.projectId };
    if (project.manifest.binding !== null) {
      return project.manifest.binding.libraryId === next.libraryId && project.manifest.binding.projectId === next.projectId
        ? ok(project) : fail('PROJECT_BINDING_CONFLICT', '项目已绑定其他资料库或项目，不可替换。');
    }
    const bound = projectAt(project.root, { ...project.manifest, binding: next });
    const database = await requireBoundDatabase(bound); if (!database.ok) return database;
    try { await writeAtomicFile(join(project.root, manifestName), `${JSON.stringify(bound.manifest, null, 2)}\n`, true); return ok(bound); }
    catch { return fail('PROJECT_WRITE_FAILED', '无法保存项目绑定，请重新打开此项目。'); }
  });
}
