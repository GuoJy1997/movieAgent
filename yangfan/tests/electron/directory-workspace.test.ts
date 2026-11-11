import { packageExecutable, isolatedModelConfig } from './support/product-launch.ts';
import { afterEach, expect, it } from 'vitest';
import { _electron, chromium, type Browser, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, access, writeFile, readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const apps: ElectronApplication[] = [], roots: string[] = [];
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) { for (const page of browser.contexts().flatMap(c => c.pages())) await page.close().catch(() => {}); await browser.close().catch(() => {}); } for (const app of apps.splice(0)) await app.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });
it('default startup shows a dedicated launcher without opening a library or provider engine', async () => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-directory-')); roots.push(root);
  const app = await _electron.launch({ args: [resolve('apps/desktop/out/main/index.js'), await isolatedModelConfig(root), `--user-data-dir=${root}`] }); apps.push(app);
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(() => typeof (window as unknown as Record<string, unknown>).projectLauncher)).toBe('object');
  expect(await page.evaluate(() => typeof window.studio)).toBe('undefined');
  expect(await page.evaluate(() => Object.keys(window.projectLauncher).sort())).toEqual(['activateRestoredProject','backupProject','configInfo','createNew','fromFolder','listRecent','maintenanceInfo','migrateProject','openConfig','openExisting','openLegacy','openRecent','restoreProject','revealUpgradeInstaller'].sort());
  expect((await app.evaluate(({ app }) => app.getAppMetrics())).some(p => p.name === 'MovieAgent Library Engine')).toBe(false);
  await expect(access(join(root, 'library', 'library.sqlite'))).rejects.toThrow();
});

it('native launcher creates isolated workbenches, focuses repeats, imports dummy configuration, and reopens persisted canvas in the actual package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-directory-flow-')); roots.push(root);
  const config = join(root, 'models.json'), profile = join(root, 'launcher'), existing = join(root, 'existing 素材');
  await writeFile(config, JSON.stringify({ schemaVersion: 1, providers: [] })); await mkdir(existing); await writeFile(join(existing, 'original.txt'), 'untouched source');
  let calls = 0; const server = createServer((_req, res) => { calls++; res.end('{}'); }); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('server');
  const port = address.port;
  const debugPorts: number[] = [];
  for (let i = 0; i < 5; i++) { const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const a = server.address(); if (!a || typeof a === 'string') throw Error('port'); debugPorts.push(a.port); await new Promise<void>(r => server.close(() => r())); }
  const dev = process.env.DIRECTORY_TEST_DEV === '1';
  const app = await _electron.launch({ ...(dev ? {} : { executablePath: packageExecutable }), args: [...(dev ? [resolve('apps/desktop/out/main/index.js')] : []), `--user-data-dir=${profile}`, `--model-config=${config}`] }); apps.push(app);
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  await app.evaluate((_electron, ports) => {
    const cp: any = process.getBuiltinModule('child_process'); const original = cp.spawn; (globalThis as any).directoryChildren = [];
    cp.spawn = (exe: string, args: string[], options: unknown) => { const child = original(exe, [...args, `--remote-debugging-port=${ports.shift()}`], options); (globalThis as any).directoryChildren.push(child); return child; };
  }, [...debugPorts]);
  async function select(folder: string) { await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder); }
  async function connect(index: number) { const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPorts[index]}`); browsers.push(browser); const page = browser.contexts()[0]!.pages()[0]!; await page.waitForFunction(() => Boolean(window.studio)); await page.waitForLoadState('domcontentloaded'); return page; }
  try {
    await select(root);
    const first = await page.evaluate(() => window.projectLauncher.createNew('短剧 A')); expect(first).toMatchObject({ ok: true }); if (!first.ok || !first.value) throw Error('create');
    const a = await connect(0), info = await a.evaluate(() => window.studio.workspaceInfo()); expect(info).toMatchObject({ ok: true, value: { project: { root: first.value.root }, modelConfig: { state: 'unconfigured' } } });
    const descriptor = await a.evaluate(() => window.studio.describe()); if (!descriptor.ok) throw Error('identity');
    const binding = (await a.evaluate(() => window.studio.workspaceInfo())); if (!binding.ok || !binding.value.project?.manifest.binding) throw Error('binding');
    const canvasId = binding.value.project.manifest.binding.projectId;
    expect(await a.evaluate(() => window.studio.createProject({ name: 'unrelated' }))).toMatchObject({ ok: false, error: { code: 'DIRECTORY_PROJECT_FIXED' } });
    expect(await a.evaluate(({ d, canvasId }) => window.studio.execute({ schemaVersion: 1, libraryId: d.libraryId, connectionEpoch: d.connectionEpoch, commandId: 'directory-canvas', kind: 'canvas.applyCommand', payload: { canvasId, baseRevision: 0, operations: [{ kind: 'create', nodeId: 'persisted-text', content: { type: 'text', text: '目录项目保存验证' }, layout: { x: 100, y: 100 } }] } }), { d: descriptor.value, canvasId })).toMatchObject({ ok: true });
    console.info('directory milestone: repeat');
    expect(await page.evaluate(id => window.projectLauncher.openRecent(id), first.value.manifest.workspaceId)).toMatchObject({ ok: true });
    await expect.poll(() => app.evaluate(() => (globalThis as any).directoryChildren[1].exitCode)).toBe(0);
    expect(await a.evaluate(() => window.studio.describe())).toEqual(descriptor);
    console.info('directory milestone: second');
    await select(existing); const second = await page.evaluate(() => window.projectLauncher.fromFolder('短剧 B')); expect(second).toMatchObject({ ok: true }); if (!second.ok || !second.value) throw Error('second');
    const b = await connect(2), descriptorB = await b.evaluate(() => window.studio.describe()); if (!descriptorB.ok) throw Error('identity B'); expect(descriptorB.value.libraryId).not.toBe(descriptor.value.libraryId);
    expect(await b.evaluate(() => window.studio.listProjects())).toMatchObject({ ok: true, value: [{ name: '短剧 B' }] });
    expect(await readFile(join(existing, 'original.txt'), 'utf8')).toBe('untouched source');
    console.info('directory milestone: import');
    await writeFile(config, JSON.stringify({ schemaVersion: 1, providers: [{ id: 'image-default', name: 'Dummy fixture', kind: 'image', baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'dummy-directory-secret', modelId: 'image-1', allowPrivateEndpoint: true }] }));
    expect(await a.evaluate(() => window.studio.reloadModelConfig())).toMatchObject({ ok: true, value: { state: 'ready' } });
    const providers = await a.evaluate(d => window.studio.query({ schemaVersion: 1, libraryId: d.libraryId, connectionEpoch: d.connectionEpoch, queryId: 'providers', kind: 'provider.list', payload: {} }), descriptor.value);
    await a.evaluate(() => window.studio.reloadModelConfig());
    expect(await a.evaluate(d => window.studio.query({ schemaVersion: 1, libraryId: d.libraryId, connectionEpoch: d.connectionEpoch, queryId: 'providers', kind: 'provider.list', payload: {} }), descriptor.value)).toEqual(providers);
    expect(JSON.stringify(providers)).not.toContain('dummy-directory-secret'); expect(calls).toBe(0);
    const evidence = resolve('.superpowers/sdd/2026-10-25-directory-projects'); await mkdir(evidence, { recursive: true });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.screenshot({ path: join(evidence, 'task-3-launcher.png') }); await a.screenshot({ path: join(evidence, 'task-3-workbench.png') });
    console.info('directory milestone: close first');
    await a.close(); await expect.poll(() => app.evaluate(() => (globalThis as any).directoryChildren[0].exitCode), { timeout: 15000 }).toBe(0);
    console.info('directory milestone: reopen');
    await select(first.value.root); expect(await page.evaluate(() => window.projectLauncher.openExisting())).toMatchObject({ ok: true });
    const reopened = await connect(3); const d = await reopened.evaluate(() => window.studio.describe()); if (!d.ok) throw Error('reopen'); expect(d.value.libraryId).toBe(descriptor.value.libraryId);
    expect(await reopened.evaluate(({ d, canvasId }) => window.studio.query({ schemaVersion: 1, libraryId: d.libraryId, connectionEpoch: d.connectionEpoch, queryId: 'canvas', kind: 'canvas.read', payload: { canvasId } }), { d: d.value, canvasId })).toMatchObject({ ok: true, value: { nodes: [{ nodeId: 'persisted-text', content: { text: '目录项目保存验证' } }] } });
    expect(await reopened.evaluate(() => window.studio.workspaceInfo())).toMatchObject({ ok: true, value: { modelConfig: { state: 'ready' } } });
    await writeFile(config, '{"apiKey":"dummy-directory-secret"'); expect(await reopened.evaluate(() => window.studio.reloadModelConfig())).toMatchObject({ ok: true, value: { state: 'error', errorCode: 'MODEL_CONFIG_READ_FAILED' } });
    expect(await reopened.evaluate(() => window.studio.listProjects())).toMatchObject({ ok: true });
    expect((await readFile(join(first.value.root, '.movieagent/library/library.sqlite'))).includes(Buffer.from('dummy-directory-secret'))).toBe(false);
    expect(calls).toBe(0);
    console.info('directory milestone: close launcher');
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
    await expect.poll(() => app.process().exitCode, { timeout: 15000 }).toBe(0);
    apps.splice(apps.indexOf(app), 1);
    expect(await b.evaluate(() => window.studio.describe())).toMatchObject({ ok: true });
  } finally { await new Promise<void>(r => server.close(() => r())); }
}, 90_000);
