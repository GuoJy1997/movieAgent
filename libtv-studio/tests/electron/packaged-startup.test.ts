import { CURRENT_SCHEMA_VERSION } from '../../packages/contracts/src/schema.ts';
import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, access, mkdir, rename, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const packageDirectory = resolve(process.env.MOVIEAGENT_TEST_PACKAGE ?? 'apps/desktop/release/win-unpacked');
const executablePath = join(packageDirectory, 'MovieAgent.exe');
const apps: ElectronApplication[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('packaged app handshakes with its utility engine, writes through the sandboxed bridge, and reopens the project', async () => {
  await access(executablePath); // An absent package is a failure, never a skipped green check.
  const frozenBefore = await readFile(resolve('docs/verification/task-10/local-performance.json'));
  const packageIdentity = await Promise.all([executablePath, join(packageDirectory, 'resources/app.asar')].map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
  const root = await mkdtemp(join(tmpdir(), 'libtv-packaged-test-'));
  roots.push(root);
  const library = join(root, '资料库 中文 with spaces');
  const profile = join(root, '用户 profile 中文');
  const modelConfig = join(root, 'models.json'); await writeFile(modelConfig, '{"schemaVersion":1,"providers":[]}');
  async function launch() {
    const app = await _electron.launch({ executablePath, args: [`--library-root=${library}`, `--user-data-dir=${profile}`, `--model-config=${modelConfig}`], timeout: 20_000 });
    apps.push(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.studio));
    await page.waitForLoadState('domcontentloaded');
    return { app, page };
  }
  const start = performance.now();
  const first = await launch();
  const startupMs = performance.now() - start;
  const initialMetrics = await first.app.evaluate(({ app }) => app.getAppMetrics());
  expect(await first.app.evaluate(({ app }) => app.isPackaged)).toBe(true);
  expect(await first.app.evaluate(({ app }) => app.getName())).toBe('MovieAgent');
  expect(await first.page.title()).toBe('MovieAgent');
  const identity = await first.page.evaluate(() => window.studio.describe());
  expect(identity).toMatchObject({ ok: true, value: { transport: 'utility-process', schemaVersion: CURRENT_SCHEMA_VERSION, sqliteVersion: expect.any(String), nodeVersion: expect.any(String) } });
  console.info('Packaged utility engine runtime:', JSON.stringify(identity));
  await first.page.getByLabel('项目名称').fill('打包恢复验证');
  await first.page.getByRole('button', { name: '新建项目' }).click();
  await first.page.getByRole('heading', { name: '打包恢复验证' }).waitFor();
  const listed = await first.page.evaluate(() => window.studio.listProjects());
  if (!listed.ok || listed.value.length !== 1) throw new Error('UI project write did not commit');
  const project = { ok: true as const, value: listed.value[0]! };
  expect(project).toMatchObject({ ok: true, value: { id: expect.any(String), name: '打包恢复验证' } });
  const afterWriteMetrics = await first.app.evaluate(({ app }) => app.getAppMetrics());
  const measurement = {
    packageIdentity,
    measuredAt: new Date().toISOString(), startupMs, readiness: 'launch to firstWindow + studio bridge + DOMContentLoaded; fresh fixture, one project, developer machine',
    os: { release: release(), cpu: cpus()[0]?.model, logicalProcessors: cpus().length, totalMemoryBytes: totalmem() },
    display: await first.app.evaluate(({ screen, BrowserWindow }) => ({ scaleFactor: screen.getPrimaryDisplay().scaleFactor, bounds: BrowserWindow.getAllWindows()[0]!.getBounds() })),
    renderer: await first.page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })),
    samples: [initialMetrics, afterWriteMetrics],
    units: 'Electron CPU percentCPUUsage and cumulativeCPUUsage seconds; memory workingSetSize/peakWorkingSetSize KiB. Two event-bound snapshots only, excludes processes Electron does not report; process lifetime peaks are not simultaneous family peak.',
    limitations: 'Not cold OS boot or installed/clean-machine measurement; no 500-node workload, OS-wide peak/continuous sampling/other DPI claim.',
  };
  expect(await first.page.evaluate(() => window.studio.createProject({ name: 42 }))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  await mkdir(resolve('test-results'), { recursive: true });
  await first.page.screenshot({ path: resolve('test-results/packaged-startup.png') });
  expect(await first.page.evaluate(() => {
    const globals = window as unknown as Record<string, unknown>;
    return { node: typeof globals.require, process: typeof globals.process };
  })).toEqual({ node: 'undefined', process: 'undefined' });
  await first.app.close();
  apps.splice(apps.indexOf(first.app), 1);
  const second = await launch();
  expect(await second.page.evaluate(() => window.studio.listProjects())).toEqual({ ok: true, value: project.ok ? [project.value] : [] });
  const nextIdentity = await second.page.evaluate(() => window.studio.describe());
  if (!identity.ok || !nextIdentity.ok) throw new Error('Handshake failed');
  expect(nextIdentity.value.libraryId).toBe(identity.value.libraryId);
  expect(nextIdentity.value.instanceId).not.toBe(identity.value.instanceId);
  await second.app.close();
  apps.splice(apps.indexOf(second.app), 1);
  const db = new DatabaseSync(join(library, 'library.sqlite'), { readOnly: true });
  expect(db.prepare('SELECT name FROM project').get()).toMatchObject({ name: '打包恢复验证' });
  expect(db.prepare('SELECT COUNT(*) AS count FROM engine_owner').get()).toMatchObject({ count: 0 });
  db.close();
  expect(await readFile(resolve('docs/verification/task-10/local-performance.json'))).toEqual(frozenBefore);
  const measurementPath = resolve(`test-results/packaged-startup-${Date.now()}.json`);
  await writeFile(measurementPath, JSON.stringify({ status: 'passed', ...measurement }, null, 2));
  console.info('Successful performance measurement:', measurementPath);
});

it('authorizes the packaged renderer from a Chinese/space executable parent path containing # and %', async () => {
  const specialDirectory = resolve(packageDirectory, '..', 'installed 中文 # 100%');
  const root = await mkdtemp(join(tmpdir(), 'libtv-special-path-test-'));
  roots.push(root);
  const modelConfig = join(root, 'models.json'); await writeFile(modelConfig, '{"schemaVersion":1,"providers":[]}');
  await rename(packageDirectory, specialDirectory);
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ executablePath: join(specialDirectory, 'MovieAgent.exe'), args: [`--library-root=${join(root, 'library')}`, `--user-data-dir=${join(root, 'profile')}`, `--model-config=${modelConfig}`], timeout: 20_000 });
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.studio));
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('installed%20%E4%B8%AD%E6%96%87%20%23%20100');
    expect(await page.evaluate(() => window.studio.describe())).toMatchObject({ ok: true, value: { transport: 'utility-process' } });
    expect(await page.evaluate(() => window.studio.createProject({ name: '特殊路径项目' }))).toMatchObject({ ok: true, value: { name: '特殊路径项目' } });
  } finally {
    try { await app?.close(); }
    finally { await rename(specialDirectory, packageDirectory); }
  }
});
