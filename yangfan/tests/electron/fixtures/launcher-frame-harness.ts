import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installLauncherIpc } from '../../../apps/desktop/src/main/launcher-ipc.ts';
import { ok } from '../../../packages/contracts/src/result.ts';
const root = process.argv.find(v => v.startsWith('--fixture-root='))!.slice('--fixture-root='.length);
app.setPath('userData', join(root, 'profile'));
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { preload: join(root, 'probe.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, nodeIntegrationInSubFrames: true } });
  const url = pathToFileURL(join(root, 'index.html')).href;
  const unused = async (): Promise<never> => { throw Error('Unexpected privileged action'); };
  const remove = installLauncherIpc(window, url, { listRecent: async () => ok([]), createNew: unused, fromFolder: unused, openExisting: unused, openRecent: unused, configInfo: unused, openConfig: unused, openLegacy: unused, maintenanceInfo: unused, backupProject: unused, restoreProject: unused, migrateProject: unused, activateRestoredProject: unused, revealUpgradeInstaller: unused });
  window.on('closed', remove); await window.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
