import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { createRequire } from 'node:module';
const applications: ElectronApplication[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const app of applications.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// These calls originate in real renderer frames. A mocked event cannot prove Electron authorization.
it('rejects unauthorized windows, unknown channels, malformed envelopes, and exposes only narrow APIs in the packaged app', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-ipc-policy-')); roots.push(root);
  const configPath = join(root, 'models.json'); await writeFile(configPath, JSON.stringify({ schemaVersion: 2, providers: [] }));
  const probePath = join(root, 'probe.cjs');
  await writeFile(probePath, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('ipcProbe',{invoke:async(channel,payload)=>{try{return await ipcRenderer.invoke(channel,payload)}catch{return {rejected:true}}}});");
  const app = await _electron.launch({ executablePath: resolve(process.env.MOVIEAGENT_TEST_PACKAGE ?? 'apps/desktop/release/win-unpacked', 'MovieAgent.exe'), args: [`--library-root=${join(root, 'library')}`, `--user-data-dir=${join(root, 'profile')}`, `--model-config=${configPath}`] });
  applications.push(app);
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.studio));
  await page.waitForLoadState('domcontentloaded');
  const descriptor = await page.evaluate(() => window.studio.describe());
  if (!descriptor.ok) throw new Error('No descriptor');
  expect(await page.evaluate(value => window.studio.execute(value as never), { schemaVersion: 1, libraryId: descriptor.value.libraryId, connectionEpoch: descriptor.value.connectionEpoch, commandId: 'bad-input', kind: 'project.create', payload: { name: 42 } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(await page.evaluate(() => {
    const globals = window as unknown as Record<string, unknown>;
    return { require: typeof globals.require, process: typeof globals.process, ipcRenderer: typeof globals.ipcRenderer, fs: typeof globals.fs, keys: Object.keys(window.studio).sort() };
  })).toEqual({ require: 'undefined', process: 'undefined', ipcRenderer: 'undefined', fs: 'undefined', keys: ['cancelTimelineExport', 'createProject', 'derivedMediaUrl', 'describe', 'execute', 'exportCreation', 'exportTimeline', 'exportVoice', 'listProjects', 'mcpConfigure', 'mcpSelectImportDirectory', 'mcpStatus', 'mediaUrl', 'openCredentialEditor', 'openModelConfigEditor', 'openProjectFolder', 'openProjectLauncher', 'query', 'readEvents', 'readModelConfig', 'releaseMediaUrl', 'reloadModelConfig', 'removeModelConfigProvider', 'selectImportFiles', 'selectSubtitleFile', 'setTimelineDraftState', 'workspaceInfo'] });
  const reloadReady = page.waitForEvent('domcontentloaded');
  await app.evaluate(({ BrowserWindow }, probe) => {
    const main = BrowserWindow.getAllWindows()[0]!;
    main.webContents.session.registerPreloadScript({ type: 'frame', filePath: probe });
    main.reload();
  }, probePath);
  await reloadReady;
  await page.waitForFunction(() => Boolean((window as unknown as { ipcProbe?: unknown }).ipcProbe));
  const invoke = (channel: string, payload?: unknown) => page.evaluate(async ({ channel, payload }) => (window as unknown as { ipcProbe: { invoke(c: string, p: unknown): Promise<unknown> } }).ipcProbe.invoke(channel, payload), { channel, payload });
  expect(await invoke('studio:execute', { nonsense: true })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(await invoke('studio:query', { kind: 'provider.list' })).toMatchObject({ ok: false });
  expect(await invoke('studio:unknown')).toEqual({ rejected: true });
  expect(await invoke('studio:creation:export',{projectId:'p',scriptId:'../escape',revision:1,format:'json'})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  expect(await invoke('studio:creation:export',{projectId:'p',scriptId:'s',revision:1,format:'json'})).toMatchObject({ok:false,error:{code:'NO_DIRECTORY_PROJECT'}});
  expect(await invoke('studio:timeline:export',{requestId:'11111111-1111-4111-8111-111111111111',projectId:'p',timelineId:'t',revision:1,kind:'srt',path:'outside'})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  expect(await invoke('studio:timeline:export',{requestId:'11111111-1111-4111-8111-111111111111',projectId:'p',timelineId:'t',revision:1,kind:'srt'})).toMatchObject({ok:false,error:{code:'NO_DIRECTORY_PROJECT'}});
  expect(await invoke('studio:timeline:cancel-export',{requestId:'filename',path:'outside'})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  expect(await invoke('timeline.recordExportOutcomeInternal',{})).toEqual({rejected:true});
  expect(await invoke('studio:voice:export',{projectId:'p',voiceRef:{id:'v',revision:1},requestId:'11111111-1111-4111-8111-111111111111',path:'outside'})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  const unauthorizedPagePromise = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, probe) => {
    const other = new BrowserWindow({ show: false, webPreferences: { preload: probe, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await other.loadURL('about:blank');
  }, probePath);
  const other = await unauthorizedPagePromise;
  expect(await other.evaluate(() => (window as unknown as { ipcProbe: { invoke(c: string, p?: unknown): Promise<unknown> } }).ipcProbe.invoke('studio:describe'))).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(await other.evaluate(() => (window as any).ipcProbe.invoke('studio:voice:export',{projectId:'p',voiceRef:{id:'v',revision:1},requestId:'11111111-1111-4111-8111-111111111111'}))).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});
  expect(await other.evaluate(() => (window as any).ipcProbe.invoke('studio:creation:export',{projectId:'p',scriptId:'s',revision:1,format:'json'}))).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});
  expect(await other.evaluate(() => (window as any).ipcProbe.invoke('studio:timeline:export',{requestId:'11111111-1111-4111-8111-111111111111',projectId:'p',timelineId:'t',revision:1,kind:'srt'}))).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});
  expect(await page.evaluate(() => window.studio.listProjects())).toEqual({ ok: true, value: [] });
});

// Production disables subframe preload entirely. This isolated harness enables it
// solely to exercise the same production policy with an actual hostile child frame.
it('rejects a real same-origin child frame even when its authorized parent can invoke the production policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-ipc-frame-')); roots.push(root);
  const configPath=join(root,'models.json');await writeFile(configPath,JSON.stringify({schemaVersion:2,providers:[]}));
  const probePath = join(root, 'probe.cjs');
  await writeFile(probePath, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('ipcProbe',{describe:()=>ipcRenderer.invoke('studio:describe')});");
  await writeFile(join(root, 'index.html'), '<html><body>Parent<iframe srcdoc="<html><body>Child</body></html>"></iframe></body></html>');
  await build({ configFile: false, logLevel: 'error', build: { ssr: true, outDir: join(root, 'harness'), rollupOptions: { input: resolve('tests/electron/fixtures/ipc-frame-harness.ts'), external: ['electron', /^node:/], output: { format: 'cjs', entryFileNames: 'main.cjs' } } } });
  const electronExecutable = createRequire(import.meta.url)('electron') as string;
  const app = await _electron.launch({ executablePath: electronExecutable, args: [join(root, 'harness/main.cjs'), `--fixture-root=${root}`, `--model-config=${configPath}`] });
  applications.push(app);
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean((window as unknown as { ipcProbe?: unknown }).ipcProbe));
  expect(await page.evaluate(() => (window as unknown as { ipcProbe: { describe(): Promise<unknown> } }).ipcProbe.describe())).toMatchObject({ ok: true, value: { libraryId: 'fixture-library' } });
  const child = page.frames().find(frame => frame !== page.mainFrame());
  if (!child) throw new Error('No real child frame');
  await child.waitForFunction(() => Boolean((window as unknown as { ipcProbe?: unknown }).ipcProbe));
  expect(await child.evaluate(() => (window as unknown as { ipcProbe: { describe(): Promise<unknown> } }).ipcProbe.describe())).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
