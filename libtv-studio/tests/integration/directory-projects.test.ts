import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindDirectoryProject, createDirectoryProject, inspectDirectoryProject } from '../../apps/desktop/src/main/project-directories.ts';
import { RecentProjects } from '../../apps/desktop/src/main/recent-projects.ts';
import type { Result } from '../../packages/contracts/src/result.ts';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function error(result: Result<unknown>, code: string) {
  expect(result).toMatchObject({ ok: false, error: { code } });
}
let fixture: string;
beforeEach(async () => { fixture = await mkdtemp(join(tmpdir(), 'directory-projects-')); });
afterEach(async () => { await rm(fixture, { recursive: true, force: true }); });
const create = (directory: string, name = '短剧 空间') => createDirectoryProject({ mode: 'new', directory, name });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('directory projects on a real filesystem', () => {
  it('creates a Chinese/spaced project with editable empty templates and no business DB', async () => {
    const project = value(await create(fixture));
    expect(project.root).toBe(join(fixture, '短剧 空间'));
    expect(project.libraryRoot).toBe(join(project.root, '.movieagent', 'library'));
    expect(project.manifest).toMatchObject({ format: 'movieagent.project', schemaVersion: 1, templateVersion: 1, name: '短剧 空间', binding: null });
    expect(project.manifest.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readFile(join(project.root, 'scripts', 'outline.md'), 'utf8')).toBe('# 故事大纲\n');
    expect(JSON.parse(await readFile(join(project.root, 'storyboards', 'episode-001.json'), 'utf8'))).toEqual({ schemaVersion: 1, shots: [] });
    expect(await readdir(project.libraryRoot)).toEqual([]);
    expect(value(await inspectDirectoryProject(project.root))).toEqual(project);
  });

  it('preserves all existing source bytes and manifest identity during repeated initialization', async () => {
    await mkdir(join(fixture, 'scripts'), { recursive: true });
    await writeFile(join(fixture, 'scripts', 'outline.md'), Buffer.from([0, 255, 33, 13, 10]));
    await writeFile(join(fixture, '原素材.bin'), Buffer.from([6, 7, 8]));
    const before = hash(await readFile(join(fixture, 'scripts', 'outline.md')));
    const first = value(await createDirectoryProject({ mode: 'existing', directory: fixture, name: '已有短剧' }));
    const manifestBytes = await readFile(join(fixture, 'movieagent.project.json'));
    const second = value(await createDirectoryProject({ mode: 'existing', directory: fixture, name: '其他名字' }));
    expect(second.manifest).toEqual(first.manifest);
    expect(await readFile(join(fixture, 'movieagent.project.json'))).toEqual(manifestBytes);
    expect(hash(await readFile(join(fixture, 'scripts', 'outline.md')))).toBe(before);
    expect(await readFile(join(fixture, '原素材.bin'))).toEqual(Buffer.from([6, 7, 8]));
  });

  it('resumes missing template items after initialization interruption without replacing workspaceId', async () => {
    const first = value(await create(fixture));
    await rm(join(first.root, 'storyboards'), { recursive: true });
    expect(value(await inspectDirectoryProject(first.root)).manifest.workspaceId).toBe(first.manifest.workspaceId);
    const resumed = value(await createDirectoryProject({ mode: 'existing', directory: first.root, name: '恢复' }));
    expect(resumed.manifest.workspaceId).toBe(first.manifest.workspaceId);
    expect(await readdir(join(first.root, 'storyboards'))).toEqual(['episode-001.json']);
  });

  it('never initializes an unknown folder on inspect or overwrites an occupied new destination', async () => {
    error(await inspectDirectoryProject(fixture), 'PROJECT_MANIFEST_MISSING');
    expect(await readdir(fixture)).toEqual([]);
    await mkdir(join(fixture, 'occupied'));
    await writeFile(join(fixture, 'occupied', 'keep.txt'), 'keep');
    error(await create(fixture, 'occupied'), 'PROJECT_DIRECTORY_EXISTS');
    expect(await readdir(join(fixture, 'occupied'))).toEqual(['keep.txt']);
  });

  it.each(['../escape', 'bad/name', 'bad\\name', 'NUL', 'COM1.txt', 'trail.', 'tail ', '.', '', 'x:y'])('rejects unsafe directory name %j before writing', async name => {
    error(await create(fixture, name), 'INVALID_PROJECT_NAME');
    expect(await readdir(fixture)).toEqual([]);
  });

  it.each(['relative', '\\\\server\\share', '\\\\?\\C:\\hidden'])('rejects nonlocal or nonabsolute paths %j', async directory => {
    error(await create(directory), 'INVALID_PROJECT_PATH');
  });

  it.each([['future schema', '{"schemaVersion":2}', 'UNSUPPORTED_PROJECT_VERSION'], ['malformed', '{broken', 'INVALID_PROJECT_MANIFEST'], ['large', ' '.repeat(65_537), 'PROJECT_MANIFEST_TOO_LARGE']])('rejects %s manifests and leaves their bytes untouched', async (_label, source, code) => {
    await writeFile(join(fixture, 'movieagent.project.json'), source);
    error(await inspectDirectoryProject(fixture), code!);
    error(await createDirectoryProject({ mode: 'existing', directory: fixture, name: '保留' }), code!);
    expect(await readFile(join(fixture, 'movieagent.project.json'), 'utf8')).toBe(source);
    expect(await readdir(fixture)).toEqual(['movieagent.project.json']);
  });

  it.each(['scripts', 'assets/characters', '.movieagent/library', 'storyboards/episode-001.json'])('rejects reserved type collision at %s before creating other paths', async relative => {
    const path = join(fixture, ...relative.split('/'));
    await mkdir(join(path, '..'), { recursive: true });
    if (relative.endsWith('.json')) await mkdir(path); else await writeFile(path, 'keep');
    error(await createDirectoryProject({ mode: 'existing', directory: fixture, name: '冲突' }), 'PROJECT_PATH_CONFLICT');
    expect(await readdir(fixture)).not.toContain('movieagent.project.json');
    if (!relative.endsWith('.json')) expect(await readFile(path, 'utf8')).toBe('keep');
  });

  it.each(['scripts', '.movieagent', 'assets/characters'])('rejects a reserved junction at %s without touching the external target', async relative => {
    const outside = join(fixture, 'outside');
    const root = join(fixture, 'project');
    await mkdir(outside); await mkdir(root);
    const link = join(root, ...relative.split('/'));
    await mkdir(join(link, '..'), { recursive: true });
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    error(await createDirectoryProject({ mode: 'existing', directory: root, name: '链接' }), 'PROJECT_PATH_CONFLICT');
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(root)).not.toContain('movieagent.project.json');
  });

  it('requires a bound database, fixes binding once, and rejects mismatched workspace identity', async () => {
    const project = value(await create(fixture));
    const binding = { workspaceId: project.manifest.workspaceId, libraryId: 'library-1', projectId: 'project-1' };
    error(await bindDirectoryProject(project.root, binding), 'BOUND_LIBRARY_MISSING');
    await writeFile(join(project.libraryRoot, 'library.sqlite'), 'fixture bytes, no SQL opened');
    const bound = value(await bindDirectoryProject(project.root, binding));
    expect(bound.manifest.binding).toEqual({ libraryId: 'library-1', projectId: 'project-1' });
    expect(value(await bindDirectoryProject(project.root, binding))).toEqual(bound);
    error(await bindDirectoryProject(project.root, { ...binding, projectId: 'other' }), 'PROJECT_BINDING_CONFLICT');
    error(await bindDirectoryProject(project.root, { ...binding, workspaceId: 'other' }), 'PROJECT_WORKSPACE_MISMATCH');
    await rm(join(project.libraryRoot, 'library.sqlite'));
    error(await inspectDirectoryProject(project.root), 'BOUND_LIBRARY_MISSING');
    error(await createDirectoryProject({ mode: 'existing', directory: project.root, name: '重开' }), 'BOUND_LIBRARY_MISSING');
  });

  it('rejects unsafe, extra-field and future-template manifests without rewriting them', async () => {
    const project = value(await create(fixture));
    for (const [patch, code] of [
      [{ name: '../escape' }, 'INVALID_PROJECT_MANIFEST'],
      [{ workspaceId: project.manifest.workspaceId.toUpperCase() }, 'INVALID_PROJECT_MANIFEST'],
      [{ apiKey: 'dummy-never-persist' }, 'INVALID_PROJECT_MANIFEST'],
      [{ templateVersion: 2 }, 'UNSUPPORTED_PROJECT_VERSION'],
      [{ binding: { libraryId: 'id', projectId: 'id', apiKey: 'dummy' } }, 'INVALID_PROJECT_MANIFEST'],
    ] as const) {
      const source = JSON.stringify({ ...project.manifest, ...patch });
      await writeFile(join(project.root, 'movieagent.project.json'), source);
      const result = await inspectDirectoryProject(project.root);
      error(result, code);
      expect(JSON.stringify(result)).not.toContain('dummy');
      expect(await readFile(join(project.root, 'movieagent.project.json'), 'utf8')).toBe(source);
    }
  });

  it('rejects junctions at manifest and database paths before reading or binding external bytes', async () => {
    const project = value(await create(fixture));
    const target = join(fixture, 'outside');
    await mkdir(target);
    await writeFile(join(target, 'keep.json'), JSON.stringify(project.manifest));
    await rm(join(project.root, 'movieagent.project.json'));
    await symlink(target, join(project.root, 'movieagent.project.json'), process.platform === 'win32' ? 'junction' : 'dir');
    error(await inspectDirectoryProject(project.root), 'PROJECT_PATH_CONFLICT');
    await rm(join(project.root, 'movieagent.project.json'));
    await writeFile(join(project.root, 'movieagent.project.json'), JSON.stringify(project.manifest));
    await symlink(target, join(project.libraryRoot, 'library.sqlite'), process.platform === 'win32' ? 'junction' : 'dir');
    error(await bindDirectoryProject(project.root, { workspaceId: project.manifest.workspaceId, libraryId: 'library-1', projectId: 'project-1' }), 'PROJECT_PATH_CONFLICT');
    expect(await readFile(join(target, 'keep.json'), 'utf8')).toBe(JSON.stringify(project.manifest));
  });

  it('serializes simultaneous existing-folder initialization with one durable identity', async () => {
    const results = await Promise.all(Array.from({ length: 3 }, () => createDirectoryProject({ mode: 'existing', directory: fixture, name: '并发' })));
    const projects = results.map(value);
    expect(new Set(projects.map(project => project.manifest.workspaceId)).size).toBe(1);
    expect(await readdir(fixture)).not.toEqual(expect.arrayContaining([expect.stringMatching(/\.tmp$/)]));
  });

  it.each(['objects', 'previews', 'temp', 'exports', 'backups', 'logs', 'engine-guard.sqlite', 'engine.lock', 'library.sqlite-wal', 'library.sqlite-shm'])('preflights engine path junction %s before initialization or binding', async relative => {
    const project = value(await create(fixture));
    const before = await readFile(join(project.root, 'movieagent.project.json'));
    const outside = join(fixture, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'keep.txt'), 'external bytes');
    await symlink(outside, join(project.libraryRoot, relative), process.platform === 'win32' ? 'junction' : 'dir');
    error(await inspectDirectoryProject(project.root), 'PROJECT_PATH_CONFLICT');
    error(await createDirectoryProject({ mode: 'existing', directory: project.root, name: project.manifest.name }), 'PROJECT_PATH_CONFLICT');
    error(await bindDirectoryProject(project.root, { workspaceId: project.manifest.workspaceId, libraryId: 'library', projectId: 'project' }), 'PROJECT_PATH_CONFLICT');
    expect(await readFile(join(project.root, 'movieagent.project.json'))).toEqual(before);
    expect(await readdir(outside)).toEqual(['keep.txt']);
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('external bytes');
  });

  it.each(['objects', 'temp', 'engine-guard.sqlite', 'engine.lock', 'library.sqlite-wal'])('rejects engine path type collision at %s before any template mutation', async relative => {
    await mkdir(join(fixture, '.movieagent', 'library'), { recursive: true });
    const path = join(fixture, '.movieagent', 'library', relative);
    if (relative === 'objects' || relative === 'temp') await writeFile(path, 'existing bytes');
    else await mkdir(path);
    error(await createDirectoryProject({ mode: 'existing', directory: fixture, name: '现有文件夹' }), 'PROJECT_PATH_CONFLICT');
    expect(await readdir(fixture)).toEqual(['.movieagent']);
    if (relative === 'objects' || relative === 'temp') expect(await readFile(path, 'utf8')).toBe('existing bytes');
  });
});

describe('recent directory registry', () => {
  it('persists display/identity only, reopens atomically, and reports missing roots', async () => {
    const project = value(await create(fixture));
    const path = join(fixture, 'state', 'recent.json');
    const registry = value(await RecentProjects.open(path));
    value(await registry.remember(project));
    value(await registry.remember(project));
    const reopened = value(await RecentProjects.open(path));
    expect(value(await reopened.list())).toMatchObject([{ workspaceId: project.manifest.workspaceId, root: project.root, name: '短剧 空间', availability: 'available' }]);
    const source = await readFile(path, 'utf8');
    expect(source).not.toMatch(/apiKey|binding|libraryId|projectId/);
    expect(await readdir(join(fixture, 'state'))).toEqual(['recent.json']);
    await rename(project.root, join(fixture, 'moved'));
    expect(value(await reopened.list())[0]?.availability).toBe('missing');
  });

  it('refuses a copied identity while its original exists and permits relocation only once the old root is missing', async () => {
    const project = value(await create(fixture));
    const registry = value(await RecentProjects.open(join(fixture, 'recent.json')));
    value(await registry.remember(project));
    const copyRoot = join(fixture, 'copy');
    await cp(project.root, copyRoot, { recursive: true });
    const copy = value(await inspectDirectoryProject(copyRoot));
    error(await registry.remember(copy), 'DUPLICATE_WORKSPACE');
    await rename(project.root, join(fixture, 'original-moved'));
    value(await registry.remember(copy));
    expect(value(await registry.list())).toMatchObject([{ root: copyRoot }]);
    expect(value(await registry.list())).toHaveLength(1);
  });

  it('revalidates caller objects, tolerates orphan temp files, and refuses corrupt or future registry state', async () => {
    const project = value(await create(fixture));
    const path = join(fixture, 'recent.json');
    await writeFile(`${path}.interrupted.tmp`, 'incomplete');
    const registry = value(await RecentProjects.open(path));
    error(await registry.remember({ ...project, manifest: { ...project.manifest, workspaceId: 'forged' } }), 'PROJECT_WORKSPACE_MISMATCH');
    await writeFile(path, '{bad');
    error(await RecentProjects.open(path), 'INVALID_RECENT_PROJECTS');
    await writeFile(path, '{"schemaVersion":2,"projects":[]}');
    error(await RecentProjects.open(path), 'UNSUPPORTED_RECENT_VERSION');
    expect(await readFile(path, 'utf8')).toBe('{"schemaVersion":2,"projects":[]}');
  });

  it('deduplicates differently cased paths and serializes separate index instances', async () => {
    const first = value(await create(fixture, '第一部'));
    const second = value(await create(fixture, '第二部'));
    const path = join(fixture, 'recent.json');
    const a = value(await RecentProjects.open(path));
    const b = value(await RecentProjects.open(path));
    (await Promise.all([a.remember(first), b.remember(second)])).forEach(value);
    const alias = value(await inspectDirectoryProject(process.platform === 'win32' ? first.root.toUpperCase() : first.root));
    value(await b.remember(alias));
    const recent = value(await a.list());
    expect(recent).toHaveLength(2);
    expect(recent[0]?.pathCanonical).toBe(process.platform === 'win32' ? first.root.toLowerCase() : first.root);
    await writeFile(join(first.root, 'movieagent.project.json'), '{broken');
    expect(value(await a.list())[0]?.availability).toBe('invalid');
  });

  it('rejects additions beyond capacity without evicting identity records', async () => {
    const project = value(await create(fixture));
    const path = join(fixture, 'recent.json');
    const projects = Array.from({ length: 10_000 }, (_, index) => {
      const root = join(fixture, `old-${index}`);
      return { workspaceId: `10000000-0000-4000-8000-${index.toString().padStart(12, '0')}`, root, pathCanonical: process.platform === 'win32' ? root.toLowerCase() : root, name: `旧项目${index}`, lastOpenedAt: '2026-10-25T00:00:00.000Z' };
    });
    const source = JSON.stringify({ schemaVersion: 1, projects });
    await writeFile(path, source);
    const registry = value(await RecentProjects.open(path));
    error(await registry.remember(project), 'RECENT_PROJECTS_FULL');
    expect(await readFile(path, 'utf8')).toBe(source);
  });

  it('rejects invalid registry entries and oversized state without leaking values', async () => {
    const path = join(fixture, 'recent.json');
    for (const source of [' '.repeat(4_194_305), '{"schemaVersion":1,"projects":[],"apiKey":"dummy"}', '{"schemaVersion":1,"projects":[{"workspaceId":"forged","apiKey":"dummy"}]}']) {
      await writeFile(path, source);
      const result = await RecentProjects.open(path);
      error(result, 'INVALID_RECENT_PROJECTS');
      expect(JSON.stringify(result)).not.toContain('dummy');
      expect(await readFile(path, 'utf8')).toBe(source);
    }
  });

  it('keeps hidden identities after fifty recent projects and rejects copied old projects', async () => {
    const project = value(await create(fixture));
    const path = join(fixture, 'recent.json');
    const registry = value(await RecentProjects.open(path));
    const original = value(await registry.remember(project));
    const newer = Array.from({ length: 50 }, (_, index) => {
      const root = join(fixture, `newer-${index}`);
      return { workspaceId: `20000000-0000-4000-8000-${index.toString().padStart(12, '0')}`, root, pathCanonical: process.platform === 'win32' ? root.toLowerCase() : root, name: `新项目${index}`, lastOpenedAt: '2026-10-25T00:00:00.000Z' };
    });
    await writeFile(path, JSON.stringify({ schemaVersion: 1, projects: [...newer, original] }));
    expect(value(await registry.list())).toHaveLength(50);
    expect(value(await registry.list()).some(entry => entry.workspaceId === original.workspaceId)).toBe(false);
    const copyRoot = join(fixture, 'older-copy');
    await cp(project.root, copyRoot, { recursive: true });
    error(await registry.remember(value(await inspectDirectoryProject(copyRoot))), 'DUPLICATE_WORKSPACE');
    expect(JSON.parse(await readFile(path, 'utf8')).projects).toHaveLength(51);
  });
});
