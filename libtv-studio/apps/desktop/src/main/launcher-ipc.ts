import { ipcMain, type BrowserWindow } from 'electron';
import type { ProjectLauncherBridge } from '../../../../packages/contracts/src/launcher.ts';
import { fail } from '../../../../packages/contracts/src/result.ts';
import { isProjectName, isWorkspaceId } from '../../../../packages/contracts/src/directory-projects.ts';
export function installLauncherIpc(window: BrowserWindow, expectedUrl: string, actions: ProjectLauncherBridge) {
  const names = ['listRecent', 'createNew', 'fromFolder', 'openExisting', 'openRecent', 'configInfo', 'openConfig', 'openLegacy', 'maintenanceInfo', 'backupProject', 'restoreProject', 'migrateProject', 'activateRestoredProject', 'revealUpgradeInstaller'] as const;
  for (const name of names) ipcMain.handle(`launcher:${name}`, async (event, input: unknown) => {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== expectedUrl) return fail('FORBIDDEN', '此窗口无权访问项目启动器。');
    try {
      if (name === 'createNew' || name === 'fromFolder' || name === 'restoreProject' || name === 'migrateProject') return isProjectName(input) ? await actions[name](input) : fail('INVALID_PROJECT_NAME', '请填写有效的项目名称。');
      if (name === 'openRecent') return isWorkspaceId(input) ? await actions.openRecent(input) : fail('INVALID_INPUT', '项目身份无效。');
      if (input !== undefined) return fail('INVALID_INPUT', '此入口不接受参数。');
      return await actions[name]();
    } catch { return fail('LAUNCHER_ACTION_FAILED', '操作未完成，请检查目录或安装文件后重试。'); }
  });
  return () => { for (const name of names) ipcMain.removeHandler(`launcher:${name}`); };
}
