import { packageExecutable, isolatedModelConfig } from './support/product-launch.ts';
import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { createRequire } from 'node:module';
const applications: ElectronApplication[] = []; const roots: string[] = [];
afterEach(async () => { for (const app of applications.splice(0)) await app.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

// A shared/general preload or a two-way secret API would leak input into the workbench.
it('uses a separate one-way credential window and returns only an owned credential reference to the workbench', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-credential-entry-')); roots.push(root);
  const app = await _electron.launch({ executablePath: packageExecutable, args: [await isolatedModelConfig(root), `--library-root=${join(root, 'library')}`, `--user-data-dir=${join(root, 'profile')}`] }); applications.push(app);
  const page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.studio));
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'profile'));
  expect(await page.evaluate(() => typeof (window.studio as any).openCredentialEditor)).toBe('function');
  const descriptor = await page.evaluate(() => window.studio.describe()); if (!descriptor.ok) throw new Error('descriptor');
  const saved = await page.evaluate(async d => window.studio.execute({ schemaVersion: 1, libraryId: d.libraryId, connectionEpoch: d.connectionEpoch, commandId: 'connection-create', kind: 'provider.saveConnection', payload: { id: 'image-service', expectedRevision: 0, name: 'Images', adapterType: 'openai-image-v1', baseUrl: 'https://images.example/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1 } } as never), descriptor.value);
  if (!saved.ok) throw new Error('connection');
  const windowReady = app.waitForEvent('window');
  const outcome = page.evaluate(ref => (window.studio as any).openCredentialEditor(ref), saved.value.result).catch(error => ({ testError: String(error) }));
  const editor = await windowReady;
  await editor.waitForFunction(() => Boolean((window as any).credentials));
  expect(await app.evaluate(({ BrowserWindow }) => {
    const editor = BrowserWindow.getAllWindows().find(w => w.getTitle() === '保存 API 凭据')!;
    const prefs = (editor.webContents as unknown as { getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean } }).getLastWebPreferences();
    return { persistent: editor.webContents.session.isPersistent(), storagePath: editor.webContents.session.getStoragePath(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
  })).toEqual({ persistent: false, storagePath: null, sandbox: true, contextIsolation: true, nodeIntegration: false });
  const editorUrl = editor.url();
  expect(await editor.evaluate(async () => { try { await fetch('http://127.0.0.1:1/credential-network-probe'); return 'allowed'; } catch { return 'blocked'; } })).toBe('blocked');
  await editor.evaluate(() => { window.location.href = 'https://example.invalid/credential-navigation-probe'; });
  expect(editor.url()).toBe(editorUrl);
  // Electron cancels navigation; reset Playwright's pending navigation bookkeeping.
  await editor.reload({ waitUntil: 'domcontentloaded' });
  // A separate real window using even the credential preload cannot submit to this editor.
  const otherReady = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, preload) => { const w = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } }); await w.loadURL('about:blank'); }, resolve('apps/desktop/out/preload/credentials.js'));
  const other = await otherReady;
  expect(await other.evaluate(() => (window as any).credentials.submit({ secret: 'dummy-hostile-window-secret', mode: 'protected' }))).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(await other.evaluate(() => (window as any).credentials.info())).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  await other.close();
  await editor.getByLabel('API Key').fill('dummy-electron-key-only');
  expect(await editor.evaluate(() => ({ studio: typeof (window as any).studio, require: typeof (window as any).require, process: typeof (window as any).process, keys: Object.keys((window as any).credentials).sort() }))).toEqual({ studio: 'undefined', require: 'undefined', process: 'undefined', keys: ['info', 'revoke', 'submit'] });
  await editor.getByRole('button', { name: '安全保存' }).click();
  const result = await outcome;
  expect(result).toMatchObject({ ok: true, value: { status: 'saved', credentialRef: { libraryId: descriptor.value.libraryId, connectionId: 'image-service', version: 1 } } });
  expect(JSON.stringify(result)).not.toContain('dummy-electron-key-only');
  expect(await page.evaluate(() => ({ credentials: typeof (window as any).credentials, vault: typeof (window.studio as any).withSecret, secret: localStorage.getItem('apiKey') }))).toEqual({ credentials: 'undefined', vault: 'undefined', secret: null });
  const bound = await page.evaluate(async ({ d, credentialRef }) => window.studio.execute({ schemaVersion: 1, libraryId: d.libraryId, connectionEpoch: d.connectionEpoch, commandId: 'connection-bind', kind: 'provider.saveConnection', payload: { id: 'image-service', expectedRevision: 1, name: 'Images', adapterType: 'openai-image-v1', baseUrl: 'https://images.example/v1', credentialRef, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1 } }), { d: descriptor.value, credentialRef: result.value.credentialRef });
  expect(bound).toMatchObject({ ok: true, value: { result: { revision: 2 } } });
  const snapshot = await page.evaluate(d => window.studio.query({ schemaVersion: 1, libraryId: d.libraryId, connectionEpoch: d.connectionEpoch, queryId: 'list-connections', kind: 'provider.list', payload: {} }), descriptor.value);
  expect(snapshot).toMatchObject({ ok: true, value: { connections: [{ revision: 1, credentialRef: null }, { revision: 2, credentialRef: result.value.credentialRef }], credentialStatuses: [{ state: 'protected' }] } });
  expect(JSON.stringify([bound, snapshot])).not.toContain('dummy-electron-key-only');
  for (const name of await readdir(join(root, 'profile/credential-vault'))) expect((await readFile(join(root, 'profile/credential-vault', name))).includes(Buffer.from('dummy-electron-key-only'))).toBe(false);
  if (!bound.ok) throw new Error('bound revision');
  const revocationReady = app.waitForEvent('window');
  const revocation = page.evaluate(ref => window.studio.openCredentialEditor(ref), bound.value.result).catch(error => ({ testError: String(error) }));
  const revokeEditor = await revocationReady;
  await revokeEditor.getByRole('button', { name: '紧急撤销当前凭据' }).click();
  expect(await revocation).toMatchObject({ ok: true, value: { status: 'revoked', state: 'revoked', credentialRef: result.value.credentialRef } });
  await app.close(); applications.splice(applications.indexOf(app), 1);
  for (const path of [join(root, 'library/library.sqlite'), join(root, 'profile/client-state/command-outbox.sqlite')]) expect((await readFile(path)).includes(Buffer.from('dummy-electron-key-only'))).toBe(false);
  const reopened = await _electron.launch({ executablePath: packageExecutable, args: [await isolatedModelConfig(root), `--library-root=${join(root, 'library')}`, `--user-data-dir=${join(root, 'profile')}`] }); applications.push(reopened);
  const reopenedPage = await reopened.firstWindow(); await reopenedPage.waitForFunction(() => Boolean(window.studio)); await reopenedPage.waitForLoadState('domcontentloaded');
  const persisted = await reopenedPage.evaluate(async () => { const d = await window.studio.describe(); if (!d.ok) return d; return window.studio.query({ schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, queryId: 'reopened-connections', kind: 'provider.list', payload: {} }); });
  expect(persisted).toMatchObject({ ok: true, value: { connections: [{ revision: 1 }, { revision: 2 }], credentialStatuses: [{ state: 'revoked' }] } });
  await reopened.close(); applications.splice(applications.indexOf(reopened), 1);
  // A retained library with a completely fresh userData/vault must recover on its first save.
  const freshProfile = join(root, 'replacement-profile');
  const recovered = await _electron.launch({ executablePath: packageExecutable, args: [await isolatedModelConfig(root), `--library-root=${join(root, 'library')}`, `--user-data-dir=${freshProfile}`] }); applications.push(recovered);
  const recoveredPage = await recovered.firstWindow(); await recoveredPage.waitForFunction(() => Boolean(window.studio)); await recoveredPage.waitForLoadState('domcontentloaded');
  expect(await recovered.evaluate(({ app }) => app.getPath('userData'))).toBe(freshProfile);
  const replacementReady = recovered.waitForEvent('window');
  const replacement = recoveredPage.evaluate(ref => window.studio.openCredentialEditor(ref), bound.value.result);
  const replacementEditor = await replacementReady;
  await replacementEditor.getByLabel('API Key').fill('dummy-fresh-vault-replacement');
  await replacementEditor.getByRole('button', { name: '安全保存' }).click();
  expect(await replacement).toMatchObject({ ok: true, value: { status: 'saved', credentialRef: { version: 2, connectionId: 'image-service' }, state: 'protected' } });
  const recoveredSnapshot = await recoveredPage.evaluate(async () => { const d = await window.studio.describe(); if (!d.ok) return d; return window.studio.query({ schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, queryId: 'recovered-connections', kind: 'provider.list', payload: {} }); });
  expect(recoveredSnapshot).toMatchObject({ ok: true, value: { connections: [{ revision: 1, credentialRef: null }, { revision: 2, credentialRef: result.value.credentialRef }], credentialStatuses: [{ ref: result.value.credentialRef, state: 'revoked' }, { ref: { version: 2 }, state: 'protected' }] } });
});

// Exercises real Electron safeStorage and the real protected input surface with an unavailable-system fixture.
it('encrypts dummy keys with real safeStorage, retains old versions, and requires explicit session opt-in when protection is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-credential-vault-electron-')); roots.push(root);
  await build({ configFile: false, logLevel: 'error', build: { ssr: true, outDir: join(root, 'harness'), rollupOptions: { input: resolve('tests/electron/fixtures/credential-vault-harness.ts'), external: ['electron', /^node:/], output: { format: 'cjs', entryFileNames: 'main.cjs' } } } });
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron') as string, args: [join(root, 'harness/main.cjs'), `--fixture-root=${root}`, `--credential-assets=${resolve('apps/desktop/out')}`] }); applications.push(app);
  await app.firstWindow();
  await expect.poll(() => app.evaluate(() => Boolean((globalThis as any).credentialFixture))).toBe(true);
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'profile'));
  const protection = await app.evaluate(async () => (globalThis as any).credentialFixture.exerciseProtected());
  expect(protection).toMatchObject({ available: true, revisions: [1, 2], reopenedUse: true, oldStillUsable: true, revokedUse: { ok: false, error: { code: 'CREDENTIAL_REVOKED' } }, revokedState: 'revoked', wrongOwner: false, plaintextOnDisk: false });
  const ready = app.waitForEvent('window');
  const outcome = app.evaluate(async () => (globalThis as any).credentialFixture.openSessionEditor());
  const editor = await ready;
  await expect.poll(() => editor.getByRole('status').textContent()).toContain('系统保护不可用');
  expect(await editor.getByRole('button', { name: '安全保存' }).isDisabled()).toBe(true);
  await editor.getByLabel('API Key').fill('dummy-explicit-session-key');
  await editor.getByLabel('仅本次会话保存（退出后失效）').check();
  await editor.getByRole('button', { name: '安全保存' }).click();
  expect(await outcome).toMatchObject({ ok: true, value: { status: 'saved', state: 'session' } });
  expect(await app.evaluate(async () => (globalThis as any).credentialFixture.sessionEvidence())).toEqual({ usable: true, reopenedState: 'unavailable', plaintextOnDisk: false });
});

// Visual closure must never turn a consumed operation into a false cancellation or lose its new ref.
it.each([
  { action: 'save', stage: 'vault', rejectRegistration: false },
  { action: 'save', stage: 'registration', rejectRegistration: false },
  { action: 'revoke', stage: 'vault', rejectRegistration: false },
  { action: 'revoke', stage: 'registration', rejectRegistration: false },
  { action: 'save', stage: 'registration', rejectRegistration: true },
  { action: 'cancel', stage: 'vault', rejectRegistration: false },
] as const)('returns the actual $action outcome after closing mid-$stage (registration failure: $rejectRegistration)', async ({ action, stage, rejectRegistration }) => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-credential-close-')); roots.push(root);
  await build({ configFile: false, logLevel: 'error', build: { ssr: true, outDir: join(root, 'harness'), rollupOptions: { input: resolve('tests/electron/fixtures/credential-vault-harness.ts'), external: ['electron', /^node:/], output: { format: 'cjs', entryFileNames: 'main.cjs' } } } });
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron') as string, args: [join(root, 'harness/main.cjs'), `--fixture-root=${root}`, `--credential-assets=${resolve('apps/desktop/out')}`] }); applications.push(app);
  await app.firstWindow();
  await expect.poll(() => app.evaluate(() => Boolean((globalThis as any).credentialFixture))).toBe(true);
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'profile'));
  const ready = app.waitForEvent('window');
  await app.evaluate((_electron, { action, stage, rejectRegistration }) => { void (globalThis as any).credentialFixture.openDelayedEditor(action, stage, rejectRegistration); }, { action, stage, rejectRegistration });
  const editor = await ready;
  if (action === 'cancel') {
    await expect.poll(() => editor.getByRole('status').textContent()).toContain('系统保护可用');
    await editor.close();
    expect(await app.evaluate(() => (globalThis as any).credentialFixture.delayedOutcome())).toEqual({ ok: true, value: { status: 'cancelled' } });
    expect(await app.evaluate(() => (globalThis as any).credentialFixture.delayedEvidence())).toEqual({ statuses: [], vaultState: null, files: 0, plaintextOnDisk: false });
    return;
  }
  if (action === 'save') { await editor.getByLabel('API Key').fill('dummy-delayed-new-key'); await editor.getByRole('button', { name: '安全保存' }).click(); }
  else await editor.getByRole('button', { name: '紧急撤销当前凭据' }).click();
  await expect.poll(async () => { const state = await app.evaluate(() => (globalThis as any).credentialFixture.delayedState()); if (state.result) throw new Error(JSON.stringify(state.result)); return state; }).toMatchObject({ entered: true, settled: false });
  await editor.close();
  try {
    expect(await app.evaluate(() => (globalThis as any).credentialFixture.delayedState())).toMatchObject({ entered: true, settled: false });
  } finally { await app.evaluate(() => (globalThis as any).credentialFixture.releaseDelayed()); }
  const result = await app.evaluate(() => (globalThis as any).credentialFixture.delayedOutcome());
  expect(result).toMatchObject(rejectRegistration ? { ok: false, error: { code: 'FIXTURE_REGISTRATION_FAILED' } } : { ok: true, value: { status: action === 'save' ? 'saved' : 'revoked', credentialRef: { connectionId: 'delayed-connection', version: 1 }, state: action === 'save' ? 'protected' : 'revoked' } });
  const evidence = await app.evaluate(() => (globalThis as any).credentialFixture.delayedEvidence());
  expect(evidence).toMatchObject({ statuses: rejectRegistration ? [] : [{ ref: result.value.credentialRef, state: action === 'save' ? 'protected' : 'revoked' }], vaultState: action === 'save' && !rejectRegistration ? 'protected' : 'revoked', files: 1, plaintextOnDisk: false });
});
