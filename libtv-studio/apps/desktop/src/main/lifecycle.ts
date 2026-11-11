import { app, dialog, Menu, Tray, type BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/** Window dismissal controls local orchestration; provider cancellation is a task command. */
export function installWindowLifecycle(window: BrowserWindow, options: { quitting(): boolean; activeTasks(): Promise<boolean>; quit(): void }) {
  let prompting = false, tray: Tray | undefined, disposed = false;
  const preference = join(app.getPath('userData'), 'window-close.json');
  const show = () => { if (!window.isDestroyed()) { window.show(); window.focus(); } };
  async function hideToTray() {
    if (!tray) {
      const icon = await app.getFileIcon(process.execPath, { size: 'small' });
      if (disposed || options.quitting() || window.isDestroyed()) return;
      tray = new Tray(icon);
      tray.setToolTip('羊番TV · 本机编排继续运行；云端任务取消需单独请求');
      tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 羊番TV', click: show }, { label: '完全退出（云端任务可能继续）', click: options.quit }]));
      tray.on('double-click', show);
    }
    if (!window.isDestroyed()) window.hide();
  }
  window.on('close', event => {
    if (options.quitting()) return;
    event.preventDefault();
    if (prompting) return;
    prompting = true;
    void (async () => {
      if (!await options.activeTasks()) { options.quit(); return; }
      let saved: unknown;
      try { saved = JSON.parse(await readFile(preference, 'utf8')); } catch { /* Prompt when no validated preference exists. */ }
      let choice = saved === 'tray' ? 0 : saved === 'quit' ? 1 : -1;
      if (choice < 0) {
        const result = await dialog.showMessageBox(window, { type: 'question', title: '关闭工作台', message: '本机仍有活动任务', detail: '留在托盘可继续本机编排和收存。完全退出将停止本机编排；云端已接任务可能继续并产生费用。关闭窗口不会请求取消，取消须在任务详情中单独操作。', buttons: ['留在托盘继续', '完全退出', '返回工作台'], defaultId: 0, cancelId: 2, checkboxLabel: '记住此选择', checkboxChecked: false });
        choice = result.response;
        if (result.checkboxChecked && choice < 2) await writeFile(preference, JSON.stringify(choice === 0 ? 'tray' : 'quit'), { mode: 0o600 });
      }
      if (options.quitting() || disposed) return;
      if (choice === 0) await hideToTray(); else if (choice === 1) options.quit();
    })().catch(() => { show(); }).finally(() => { prompting = false; });
  });
  return () => { disposed = true; tray?.destroy(); };
}
