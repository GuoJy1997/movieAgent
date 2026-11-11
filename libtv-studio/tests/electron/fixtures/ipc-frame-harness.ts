import { CURRENT_SCHEMA_VERSION } from '../../../packages/contracts/src/schema.ts';
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installWorkspaceIpc } from '../../../apps/desktop/src/main/ipc-policy.ts';
import { LocalConnection } from '../../../apps/desktop/src/main/local-connection.ts';
import { CommandOutbox } from '../../../apps/desktop/src/main/command-outbox.ts';
const root = process.argv.find(value => value.startsWith('--fixture-root='))!.slice('--fixture-root='.length);
app.setPath('userData', join(root, 'profile'));
void app.whenReady().then(async () => {
  const outbox = new CommandOutbox(join(root, 'client/outbox.sqlite'));
  // Only transport identity is needed to test frame authorization; no business calls.
  const unused = async (): Promise<never> => { throw new Error('Unexpected business call in IPC policy fixture'); };
  const connection = new LocalConnection({ identity: { instanceId: 'fixture-epoch', libraryId: 'fixture-library', schemaVersion: CURRENT_SCHEMA_VERSION, nodeVersion: process.versions.node, sqliteVersion: 'fixture' }, execute: unused, query: unused, readEvents: unused }, outbox);
  const window = new BrowserWindow({ show: false, webPreferences: { preload: join(root, 'probe.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, nodeIntegrationInSubFrames: true } });
  const url = pathToFileURL(join(root, 'index.html')).href;
  const remove = installWorkspaceIpc(window, url, connection);
  window.on('closed', () => { remove(); connection.disconnect(); outbox.close(); });
  await window.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
