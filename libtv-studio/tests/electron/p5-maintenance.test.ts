import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bindDirectoryProject, createDirectoryProject } from '../../apps/desktop/src/main/project-directories.ts';
import { openLibrary } from '../../packages/storage/src/database.ts';
import { projectsFor } from '../../packages/engine/src/projects.ts';
import { isolatedModelConfig, packageExecutable } from './support/product-launch.ts';
const apps: ElectronApplication[] = [], roots: string[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
it('runs native backup, paused restore, confirmed activation, migration and manual installer location without starting an engine', async () => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-p5-desktop-')); roots.push(root);
  const source = await createDirectoryProject({ mode: 'new', directory: root, name: '桌面验收' }); if (!source.ok) throw Error(source.error.code);
  const app = await _electron.launch({ ...(process.env.P5_TEST_DEV === '1' ? {} : { executablePath: packageExecutable }), args: [...(process.env.P5_TEST_DEV === '1' ? [resolve('apps/desktop/out/main/index.js')] : []), `--user-data-dir=${join(root, 'profile')}`, await isolatedModelConfig(root)] }); apps.push(app);
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(() => typeof window.projectLauncher.backupProject)).toBe('function');
  expect(await page.evaluate(() => window.projectLauncher.maintenanceInfo())).toMatchObject({ ok: true, value: { appVersion: '0.2.0', databaseSchema: 23, backupFormat: 1 } });
  async function choose(paths: string[], confirmed = true) { await app.evaluate(({ dialog, shell }, { paths, confirmed }) => { dialog.showOpenDialog = async () => ({ canceled: paths.length === 0, filePaths: paths.length ? [paths.shift()!] : [] }); dialog.showMessageBox = async () => ({ response: confirmed ? 1 : 0, checkboxChecked: false }); shell.showItemInFolder = path => { (globalThis as any).p5Revealed = path; }; }, { paths, confirmed }); }
  await choose([source.value.root, root]);
  const backup = await page.evaluate(() => window.projectLauncher.backupProject()); expect(backup.ok).toBe(true); if (!backup.ok || !backup.value) throw Error('backup');
  await choose([backup.value.root, root]); const restored = await page.evaluate(() => window.projectLauncher.restoreProject('桌面恢复')); expect(restored).toMatchObject({ ok: true, value: { scheduling: 'paused' } }); if (!restored.ok || !restored.value) throw Error('restore');
  await choose([restored.value.root], false); expect(await page.evaluate(() => window.projectLauncher.activateRestoredProject())).toEqual({ ok: true, value: null });
  expect(JSON.parse(await readFile(join(restored.value.root, '.movieagent/library/.maintenance-state.json'), 'utf8')).state).toBe('paused');
  await choose([restored.value.root]); expect(await page.evaluate(() => window.projectLauncher.activateRestoredProject())).toMatchObject({ ok: true, value: { scheduling: 'active' } });
  await choose([source.value.root, root]); expect(await page.evaluate(() => window.projectLauncher.migrateProject('桌面迁移'))).toMatchObject({ ok: true, value: { sourceRetired: true, scheduling: 'active' } });
  const recent = await page.evaluate(() => window.projectLauncher.listRecent()); expect(recent.ok && recent.value.map(x => x.name)).toEqual(expect.arrayContaining(['桌面恢复','桌面迁移']));
  const installer = join(root, 'installer.exe'); await writeFile(installer, 'fixture-only-no-execution'); await choose([installer]);
  expect(await page.evaluate(() => window.projectLauncher.revealUpgradeInstaller())).toMatchObject({ ok: true });
  expect(await app.evaluate(() => (globalThis as any).p5Revealed)).toBe(installer);
  await choose([]); expect(await page.evaluate(() => window.projectLauncher.backupProject())).toEqual({ ok: true, value: null });
  expect((await app.evaluate(({ app }) => app.getAppMetrics())).some(x => x.name === 'MovieAgent Library Engine')).toBe(false);
  expect(await readdir(root)).toContain('桌面验收');
  await page.getByText('项目维护', { exact: true }).click();
  await page.getByLabel('恢复 / 迁移的目标项目名称').fill('界面恢复');
  await choose([backup.value.root, root]); await page.getByRole('button', { name: '从备份恢复', exact: true }).click();
  await expect.poll(() => page.getByRole('status').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('恢复完成：')]));
  expect(await page.getByRole('heading', { name: '界面恢复', exact: true }).count()).toBe(1);
  await choose([join(root, '界面恢复')]); expect(await page.evaluate(() => window.projectLauncher.activateRestoredProject())).toMatchObject({ ok: true });
  await choose([backup.value.root, root]); await page.getByRole('button', { name: '从备份恢复', exact: true }).click();
  await expect.poll(() => page.getByRole('status').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('目标项目已存在且已启用执行')]));
  await page.locator('details.project-maintenance').screenshot({ path: resolve('.superpowers/sdd/2026-10-29-p5-local-maintenance/task-3-maintenance.png') });
}, 60_000);

it('opens a restored bound project in the actual packaged utility engine and serves its exact original video while execution stays paused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-p5-bound-')); roots.push(root);
  const source = await createDirectoryProject({ mode: 'new', directory: root, name: '带视频的短剧' }); if (!source.ok) throw Error(source.error.code);
  const opened = await openLibrary({ root: source.value.libraryRoot }); if (!opened.ok) throw Error(opened.error.code); const library = opened.value;
  const bytes = await readFile(resolve('tests/fixtures/video-sample.mp4')), hash = createHash('sha256').update(bytes).digest('hex');
  let projectId = '';
  try {
    const project = projectsFor(library).create({ name: '带视频的短剧' }); if (!project.ok) throw Error(project.error.code); projectId = project.value.id;
    const key = `objects/${hash.slice(0, 2)}/${hash}`; await mkdir(join(source.value.libraryRoot, 'objects', hash.slice(0, 2)), { recursive: true }); await writeFile(join(source.value.libraryRoot, key), bytes);
    library.db.prepare('INSERT INTO blob_object VALUES(?,?,?,?,?,?,?)').run(hash, hash, bytes.length, key, 'video/mp4', 64, 48);
    library.db.prepare('INSERT INTO asset(id,library_id,name) VALUES(?,?,?)').run('asset', library.libraryId, '验收视频');
    library.db.prepare('INSERT INTO asset_version VALUES(?,?,?,?,?,?)').run('asset', 1, library.libraryId, hash, null, new Date().toISOString());
    expect(await bindDirectoryProject(source.value.root, { workspaceId: source.value.manifest.workspaceId, libraryId: library.libraryId, projectId })).toMatchObject({ ok: true });
  } finally { await library.close(); }
  const profile = join(root, 'profile'), config = await isolatedModelConfig(root);
  const executable = process.env.P5_TEST_DEV === '1' ? {} : { executablePath: packageExecutable }, entry = process.env.P5_TEST_DEV === '1' ? [resolve('apps/desktop/out/main/index.js')] : [];
  const launcher = await _electron.launch({ ...executable, args: [...entry, `--user-data-dir=${profile}`, config] }); apps.push(launcher);
  const page = await launcher.firstWindow(); await page.waitForLoadState('domcontentloaded');
  async function choose(paths: string[]) { await launcher.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.shift()!] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }, paths); }
  await choose([source.value.root, root]); const saved = await page.evaluate(() => window.projectLauncher.backupProject()); if (!saved.ok || !saved.value) throw Error('backup');
  await choose([saved.value.root, root]); const restored = await page.evaluate(() => window.projectLauncher.restoreProject('视频恢复')); if (!restored.ok || !restored.value) throw Error('restore');
  async function openCopy() { const app = await _electron.launch({ ...executable, args: [...entry, '--workspace-child', `--project-root=${restored.ok && restored.value!.root}`, `--launcher-data=${profile}`, config] }); apps.push(app); const view = await app.firstWindow(); await view.waitForFunction(() => Boolean(window.studio)); return { app, view }; }
  const copy = await openCopy(), descriptor = await copy.view.evaluate(() => window.studio.describe()); if (!descriptor.ok) throw Error('describe');
  expect(descriptor.value).toMatchObject({ libraryId: library.libraryId, schemaVersion: 23, schedulingPaused: true });
  await expect.poll(() => copy.view.getByText('恢复副本 · 任务执行已暂停', { exact: true }).count()).toBe(1);
  expect(await copy.view.evaluate(() => window.studio.listProjects())).toMatchObject({ ok: true, value: [{ id: projectId }] });
  const actual = await copy.view.evaluate(async libraryId => { const url = await window.studio.mediaUrl({ libraryId, ref: { kind: 'assetVersion', libraryId, assetId: 'asset', version: 1 }, variant: 'original' }); if (!url.ok) throw Error(url.error.code); return Array.from(new Uint8Array(await (await fetch(url.value)).arrayBuffer())); }, library.libraryId);
  expect(Buffer.from(actual)).toEqual(bytes);
  const denied = await copy.view.evaluate(d => window.studio.execute({ schemaVersion: 1, libraryId: d.libraryId, connectionEpoch: d.connectionEpoch, commandId: 'paused-render', kind: 'render.prepare', payload: { timelineRef: { libraryId: d.libraryId, projectId: 'fixture', id: 'cut', revision: 1 }, purpose: 'mp4', executionOwner: 'user', runId: 'fixture' } }), descriptor.value);
  expect(denied).toMatchObject({ ok: false, error: { code: 'RESTORED_PROJECT_PAUSED' } });
  await copy.view.screenshot({ path: resolve('.superpowers/sdd/2026-10-29-p5-local-maintenance/task-4-paused-workbench.png') });
  await copy.app.close(); apps.splice(apps.indexOf(copy.app), 1);
  await choose([restored.value.root]); expect(await page.evaluate(() => window.projectLauncher.activateRestoredProject())).toMatchObject({ ok: true, value: { scheduling: 'active' } });
  const active = await openCopy(); expect(await active.view.evaluate(() => window.studio.describe())).toMatchObject({ ok: true, value: { libraryId: library.libraryId, schedulingPaused: false } });
}, 60_000);
