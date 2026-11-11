import { BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import type { CredentialEditorOutcome, CredentialEditorInfo } from '../../../../packages/contracts/src/desktop.ts';
import type { CredentialRef, CredentialStatus, ProviderConnection } from '../../../../packages/contracts/src/models.ts';
import type { CredentialVault } from './credential-vault.ts';

/** Short-lived, local-only input surface. Main binds owner identity; input cannot choose refs. */
export async function openCredentialWindow(options: {
  parent: BrowserWindow; connection: ProviderConnection; vault: CredentialVault;
  synchronize(status: CredentialStatus): Promise<Result<void>>;
  documentPath?: string; preloadPath?: string;
}): Promise<Result<CredentialEditorOutcome>> {
  const documentPath = options.documentPath ?? join(__dirname, '../renderer/credentials/index.html');
  const expectedUrl = pathToFileURL(documentPath).href;
  // Only this trusted document and its build-emitted local script/style may load.
  const html = await readFile(documentPath, 'utf8');
  const resources = new Set([expectedUrl]);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(match[1]!, expectedUrl);
    if (url.protocol !== 'file:') return fail('CREDENTIAL_UI_UNAVAILABLE', '凭据入口必须使用本机文件。');
    resources.add(url.href);
  }
  const isolated = session.fromPartition(`credential-${randomUUID()}`, { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', event => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !resources.has(details.url) }));
  const window = new BrowserWindow({ parent: options.parent, modal: true, show: false, width: 480, height: 430, resizable: false, title: '保存 API 凭据',
    webPreferences: { session: isolated, preload: options.preloadPath ?? join(__dirname, '../preload/credentials.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, devTools: false, spellcheck: false, webgl: false, navigateOnDragDrop: false, v8CacheOptions: 'none' } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const channels = ['credential:info', 'credential:submit', 'credential:revoke'] as const;
  function allowed(event: IpcMainInvokeEvent) { return !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === expectedUrl; }
  let consumed = false;
  let finalResult: Result<CredentialEditorOutcome> | undefined;
  let finish!: (result: Result<CredentialEditorOutcome>) => void;
  const completed = new Promise<Result<CredentialEditorOutcome>>(resolve => { finish = resolve; });
  const done = (result: Result<CredentialEditorOutcome>) => {
    finalResult = result;
    if (window.isDestroyed()) finish(result);
    else setImmediate(() => { if (!window.isDestroyed()) window.close(); });
    return result;
  };
  for (const channel of channels) ipcMain.handle(channel, async (event, input: unknown) => {
    if (!allowed(event)) return fail('FORBIDDEN', '此窗口或 frame 无权提交凭据。');
    if (channel === 'credential:info') {
      if (input !== undefined) return fail('INVALID_INPUT', '凭据状态不接受参数。');
      const current = options.connection.credentialRef ? await options.vault.status(options.connection.credentialRef) : undefined;
      const info: CredentialEditorInfo = { protectionAvailable: options.vault.protectionAvailable(), current: current?.ok ? current.value : null };
      return ok(info);
    }
    if (consumed) return fail('CREDENTIAL_INPUT_CONSUMED', '本次入口已使用，请重新打开。');
    if (channel === 'credential:revoke') {
      if (input !== undefined || !options.connection.credentialRef) return fail('INVALID_INPUT', '没有可撤销的凭据。');
      consumed = true;
      try {
        const revoked = await options.vault.revoke(options.connection.credentialRef);
        if (!revoked.ok) return done(revoked);
        const synchronized = await options.synchronize(revoked.value);
        return done(synchronized.ok ? ok({ status: 'revoked', credentialRef: revoked.value.ref, state: 'revoked' }) : synchronized);
      } catch { return done(fail('CREDENTIAL_OPERATION_FAILED', '凭据撤销未能完成，请重新检查凭据状态。')); }
    }
    if (!isRecord(input) || Object.keys(input).length !== 2 || typeof input.secret !== 'string' || !['protected', 'session'].includes(input.mode as string)) return fail('INVALID_INPUT', '凭据提交格式无效。');
    consumed = true;
    let secret: string | undefined = input.secret;
    let savedRef: CredentialRef | undefined;
    delete input.secret;
    try {
      const saved = await options.vault.put(secret, { libraryId: options.connection.libraryId, connectionId: options.connection.id }, input.mode as 'protected' | 'session');
      if (!saved.ok) return done(saved);
      savedRef = saved.value;
      const status = await options.vault.status(saved.value); if (!status.ok) return done(status);
      const synchronized = await options.synchronize(status.value);
      if (!synchronized.ok) { await options.vault.revoke(saved.value); return done(synchronized); }
      return done(ok({ status: 'saved', credentialRef: saved.value, state: status.value.state }));
    } catch {
      if (savedRef) { try { await options.vault.revoke(savedRef); } catch { /* Preserve the failure; never report successful cancellation. */ } }
      return done(fail('CREDENTIAL_OPERATION_FAILED', '凭据保存未能完成，请重新检查凭据状态。'));
    } finally { secret = undefined; }
  });
  window.on('closed', () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
    isolated.webRequest.onBeforeRequest(null);
    void isolated.clearStorageData().catch(() => { /* Memory-only session is destroyed with the process. */ });
    // The visual surface may close, but a consumed mutation still owns its actual outcome.
    if (finalResult) finish(finalResult);
    else if (!consumed) finish(ok({ status: 'cancelled' }));
  });
  try { await window.loadURL(expectedUrl); if (!window.isDestroyed()) window.show(); }
  catch { if (!consumed) done(fail('CREDENTIAL_UI_UNAVAILABLE', '无法打开独立凭据入口。')); }
  return completed;
}
