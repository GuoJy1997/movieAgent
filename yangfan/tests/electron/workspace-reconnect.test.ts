import { packageExecutable, isolatedModelConfig } from './support/product-launch.ts';
import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChildProcess } from 'node:child_process';
import { build } from 'vite';
import { createRequire } from 'node:module';
import { startEngine } from '../../packages/engine/src/bootstrap.ts';
const apps: ElectronApplication[] = [], roots: string[] = [];
const owned = new Map<ElectronApplication, ChildProcess>();
afterEach(async () => { for (const app of apps.splice(0)) { if (owned.get(app)?.exitCode === null) await app.close(); } for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function launch() { const root = await mkdtemp(join(tmpdir(), 'libtv-reconnect-')); roots.push(root); const app = await _electron.launch({ executablePath: packageExecutable, args: [await isolatedModelConfig(root), `--library-root=${join(root, 'library')}`, `--user-data-dir=${join(root, 'profile')}`] }); apps.push(app); owned.set(app, app.process()); return { app, root }; }
it('invalidates provisional outbox recovery across a second suspend and reconciles the new wake before publishing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-repeat-suspend-')); roots.push(root);
  const electron = createRequire(import.meta.url)('electron') as string;
  const app = await _electron.launch({ executablePath: electron, args: [resolve('tests/electron/fixtures/reconnect-recovery-harness.cjs'), await isolatedModelConfig(root), `--production-entry=${resolve('apps/desktop/out/main/index.js')}`, `--library-root=${join(root, 'library')}`, `--user-data-dir=${join(root, 'profile')}`] }); apps.push(app); owned.set(app, app.process());
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); const first = await page.evaluate(() => window.studio.describe()); if (!first.ok) throw Error('descriptor');
  const path = join(root, 'profile/client-state/command-outbox.sqlite');
  const input = { schemaVersion: 1 as const, libraryId: first.value.libraryId, connectionEpoch: first.value.connectionEpoch, commandId: 'held-recovery', kind: 'project.create' as const, payload: { name: 'Late ACK survives second sleep' } };
  const { requestHash } = await import('../../packages/engine/src/command-router.ts');
  const db = new DatabaseSync(path); db.prepare('INSERT INTO pending_command VALUES(?,?,?,?)').run(input.libraryId, input.commandId, requestHash(input), JSON.stringify(input)); db.close();
  try {
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
    await expect.poll(() => app.evaluate(() => (globalThis as any).recoveryFixture.state())).toMatchObject({ reconciles: 1, reconcileResponses: 1, heldExecute: true });
    const held = await app.evaluate(() => (globalThis as any).recoveryFixture.state());
    await app.evaluate(({ powerMonitor }) => { powerMonitor.emit('suspend'); powerMonitor.emit('resume'); (globalThis as any).recoveryFixture.releaseExecute(); });
    await expect.poll(() => app.evaluate(() => (globalThis as any).recoveryFixture.state())).toMatchObject({ reconciles: 2, reconcileResponses: 2, heldFresh: true });
    // Fresh wake's actual reconciliation reply is held: neither old connection nor
    // its pre-suspend provisional epoch may be published in the meantime.
    expect(await page.evaluate(() => window.studio.describe())).toMatchObject({ ok: false, error: { code: 'STALE_CONNECTION' } });
    const queue = new DatabaseSync(path); expect(queue.prepare('SELECT count(*) AS n FROM pending_command').get()).toMatchObject({ n: 0 }); queue.close();
    await app.evaluate(() => (globalThis as any).recoveryFixture.releaseFresh());
    await expect.poll(() => page.evaluate(() => window.studio.describe())).toMatchObject({ ok: true });
    const current = await page.evaluate(() => window.studio.describe()); if (!current.ok) throw Error('current');
    expect(current.value.instanceId).toBe(first.value.instanceId); expect(current.value.connectionEpoch).not.toBe(held.heldEpoch); expect(current.value.connectionEpoch).not.toBe(first.value.connectionEpoch);
    expect(await page.evaluate(() => window.studio.listProjects())).toMatchObject({ ok: true, value: [{ name: 'Late ACK survives second sleep' }] });
    expect(await page.evaluate(({ libraryId, connectionEpoch }) => window.studio.query({ schemaVersion: 1, libraryId, connectionEpoch, queryId: 'old-provisional', kind: 'project.list', payload: {} }), { libraryId: input.libraryId, connectionEpoch: held.heldEpoch })).toMatchObject({ ok: false, error: { code: 'STALE_CONNECTION' } });
  } finally { await app.evaluate(() => { (globalThis as any).recoveryFixture.releaseExecute(); (globalThis as any).recoveryFixture.releaseFresh(); }); }
});
it('restarts the production utility after a crash during resume without transferring library identity or replaying completed work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-crash-resume-')); roots.push(root);
  const launcher = join(root, 'main.cjs');
  await writeFile(launcher, `const {utilityProcess}=require('electron'); const fork=utilityProcess.fork.bind(utilityProcess); globalThis.ownedEngines=[]; utilityProcess.fork=(...args)=>{const child=fork(...args);globalThis.ownedEngines.push(child);return child;};require(${JSON.stringify(resolve('apps/desktop/out/main/index.js'))});`);
  const electron = createRequire(import.meta.url)('electron') as string;
  const app = await _electron.launch({ executablePath: electron, args: [launcher, await isolatedModelConfig(root), `--library-root=${join(root, 'library')}`, `--user-data-dir=${join(root, 'profile')}`] }); apps.push(app); owned.set(app, app.process());
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); const before = await page.evaluate(() => window.studio.describe()); if (!before.ok) throw Error('initial');
  expect(await page.evaluate(() => window.studio.createProject({ name: 'Original owner context' }))).toMatchObject({ ok: true });
  await app.evaluate(({ powerMonitor }) => { powerMonitor.emit('resume'); (globalThis as any).ownedEngines[0].kill(); });
  await expect.poll(async () => { const result = await page.evaluate(() => window.studio.describe()); return result.ok ? result.value.instanceId : before.value.instanceId; }, { timeout: 15000 }).not.toBe(before.value.instanceId);
  const after = await page.evaluate(() => window.studio.describe()); expect(after).toMatchObject({ ok: true, value: { libraryId: before.value.libraryId } }); if (!after.ok) throw Error('restarted');
  expect(after.value.connectionEpoch).not.toBe(before.value.connectionEpoch);
  expect(await page.evaluate(() => window.studio.listProjects())).toMatchObject({ ok: true, value: [{ name: 'Original owner context' }] });
  expect(await app.evaluate(() => (globalThis as any).ownedEngines.length)).toBe(2);
});
it('owns late handshakes, excludes duplicate startup, allows slow graceful cleanup and truthfully reports forced interruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-host-lifecycle-')); roots.push(root);
  await build({ configFile: false, logLevel: 'error', build: { ssr: true, outDir: join(root, 'harness'), rollupOptions: { input: { main: resolve('tests/electron/fixtures/lifecycle-harness.ts'), 'engine-process': resolve('tests/electron/fixtures/lifecycle-engine.ts') }, external: ['electron', 'sharp', /^node:/], output: { format: 'cjs', entryFileNames: '[name].js' } } } });
  const electron = createRequire(import.meta.url)('electron') as string;
  const app = await _electron.launch({ executablePath: electron, args: [join(root, 'harness/main.js'), `--fixture-root=${root}`] }); apps.push(app); owned.set(app, app.process());
  await app.firstWindow();
  await app.evaluate(() => (globalThis as any).lifecycleFixture.choose(0));
  await expect.poll(() => app.evaluate(() => (globalThis as any).lifecycleFixture.choiceState())).toMatchObject({ visible: false, destroyed: false, quitRequests: 0, detail: expect.stringContaining('云端已接任务可能继续') });
  await app.evaluate(() => (globalThis as any).lifecycleFixture.choose(1));
  await expect.poll(() => app.evaluate(() => (globalThis as any).lifecycleFixture.choiceState())).toMatchObject({ visible: true, destroyed: false, quitRequests: 1, detail: expect.stringContaining('取消须在任务详情中单独操作') });
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.start('late'))).toMatchObject({ ok: false, error: { code: 'ENGINE_START_TIMEOUT' } });
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.state())).toMatchObject({ exited: true, unexpected: 0 });
  const afterLate = await startEngine({ root: join(root, 'late') }); expect(afterLate.ok).toBe(true); if (afterLate.ok) await afterLate.value.close();
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.start('slow'))).toMatchObject({ ok: true });
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.duplicate('slow'))).toMatchObject({ ok: false, error: { code: 'LIBRARY_IN_USE' } });
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.close())).toMatchObject({ persisted: true, resourcesExited: true, cleanupPending: false, interrupted: false });
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.start('forced'))).toMatchObject({ ok: true });
  const before = Date.now();
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.close(300))).toMatchObject({ persisted: false, resourcesExited: true, cleanupPending: true, interrupted: true });
  expect(Date.now() - before).toBeLessThan(1500);
  const restarted = await startEngine({ root: join(root, 'forced') }); expect(restarted.ok).toBe(true); if (restarted.ok) { expect(restarted.value.projects.list()).toMatchObject({ ok: true, value: [{ name: 'Persisted before cleanup' }] }); await restarted.value.close(); }
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.start('exhausted-forced'))).toMatchObject({ ok: true });
  const exhausted = await app.evaluate(() => (globalThis as any).lifecycleFixture.close(0));
  expect(exhausted).toMatchObject({ cleanupPending: true, interrupted: true });
  if (!exhausted.resourcesExited) expect(exhausted.stoppedClaiming).toBe(false);
  await expect.poll(() => app.evaluate(() => (globalThis as any).lifecycleFixture.state())).toMatchObject({ exited: true });
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.close())).toMatchObject({ resourcesExited: true, cleanupPending: true, interrupted: true });
  expect(await app.evaluate(() => (globalThis as any).lifecycleFixture.start('crash'))).toMatchObject({ ok: true });
  await app.evaluate(() => (globalThis as any).lifecycleFixture.crash());
  await expect.poll(() => app.evaluate(() => (globalThis as any).lifecycleFixture.state())).toMatchObject({ exited: true, unexpected: 1 });
});
it('rotates only connection epoch on renderer reload and sleep/resume, replays outbox once and rejects old views', async () => {
  const { app, root } = await launch(); const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  const first = await page.evaluate(() => window.studio.describe()); if (!first.ok) throw Error('handshake');
  expect(await page.evaluate(() => window.studio.createProject({ name: 'Before reload' }))).toMatchObject({ ok: true });
  // Seed one real ACK-lost command in the separate persisted client queue.
  const db = new DatabaseSync(join(root, 'profile/client-state/command-outbox.sqlite'));
  const envelope = { schemaVersion: 1 as const, libraryId: first.value.libraryId, connectionEpoch: first.value.connectionEpoch, commandId: 'reload-ack', kind: 'project.create' as const, payload: { name: 'Recovered exactly once' } };
  const { requestHash } = await import('../../packages/engine/src/command-router.ts'); db.prepare('INSERT INTO pending_command VALUES(?,?,?,?)').run(envelope.libraryId, envelope.commandId, requestHash(envelope), JSON.stringify(envelope)); db.close();
  const loaded = page.waitForEvent('domcontentloaded'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.reload()); await loaded;
  await expect.poll(async () => page.evaluate(() => window.studio.describe())).toMatchObject({ ok: true });
  const next = await page.evaluate(() => window.studio.describe()); if (!next.ok) throw Error('reconnect');
  expect(next.value.instanceId).toBe(first.value.instanceId); expect(next.value.connectionEpoch).not.toBe(first.value.connectionEpoch);
  await expect.poll(async () => page.evaluate(() => window.studio.listProjects())).toMatchObject({ ok: true, value: [{ name: 'Before reload' }, { name: 'Recovered exactly once' }] });
  expect(await page.evaluate(d => window.studio.query({ schemaVersion: 1, libraryId: d.libraryId, connectionEpoch: d.connectionEpoch, queryId: 'stale', kind: 'project.list', payload: {} }), first.value)).toMatchObject({ ok: false, error: { code: 'STALE_CONNECTION' } });
  await app.evaluate(({ powerMonitor }) => { powerMonitor.emit('suspend'); powerMonitor.emit('resume'); });
  await expect.poll(async () => { const d = await page.evaluate(() => window.studio.describe()); return d.ok ? d.value.connectionEpoch : null; }).not.toBe(next.value.connectionEpoch);
  expect(await page.evaluate(() => window.studio.listProjects())).toMatchObject({ ok: true, value: [{ name: 'Before reload' }, { name: 'Recovered exactly once' }] });
});
it.each(['close', 'reload'] as const)('handles immediate %s during first renderer load and releases the actual owned process/library', async action => {
  const { app, root } = await launch();
  const child = app.process();
  // Main-process observation only: no renderer/DOM/preload-ready prerequisite.
  const evidence = await app.evaluate(async ({ app, BrowserWindow }, action) => {
    const w = BrowserWindow.getAllWindows()[0] ?? await new Promise<Electron.BrowserWindow>(resolve => app.once('browser-window-created', (_event, win) => resolve(win)));
    const loading = w.webContents.isLoading();
    const engine = app.getAppMetrics().find(metric => metric.type === 'Utility' && metric.name === 'MovieAgent Library Engine');
    if (!engine) throw Error(`Missing owned engine metric: ${JSON.stringify(app.getAppMetrics())}`);
    const enginePid = engine.pid;
    if (action === 'reload') w.webContents.reload(); else w.close();
    return { loading, enginePid };
  }, action);
  if (action === 'reload') {
    // An early reload can replace the DevTools target before Playwright tracks
    // its first Page. Observe the native window and quit natively instead.
    const loaded = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      if (w.webContents.isLoading()) await new Promise<void>(resolve => w.webContents.once('did-stop-loading', () => resolve()));
      return { url: w.webContents.getURL(), loading: w.webContents.isLoading() };
    });
    expect(loaded).toMatchObject({ loading: false, url: expect.stringContaining('renderer/index.html') });
    await app.evaluate(({ app }) => app.quit());
  }
  await expect.poll(() => child.exitCode, { timeout: 25_000 }).not.toBeNull();
  await expect.poll(() => { try { process.kill(evidence.enginePid, 0); return true; } catch { return false; } }).toBe(false); // Signal 0 observes only the exact fixture's child; it never terminates it.
  const guard = new DatabaseSync(join(root, 'library/engine-guard.sqlite')); guard.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; ROLLBACK'); guard.close();
  const db = new DatabaseSync(join(root, 'library/library.sqlite')); expect(db.prepare('SELECT COUNT(*) AS n FROM engine_owner').get()).toMatchObject({ n: 0 }); db.close();
  expect(evidence.loading).toBe(true);
  expect(JSON.parse(await readFile(join(root, 'profile/shutdown-report.json'), 'utf8'))).toMatchObject({ stoppedClaiming: true, persisted: true, resourcesExited: true, cleanupPending: false, interrupted: false });
});
