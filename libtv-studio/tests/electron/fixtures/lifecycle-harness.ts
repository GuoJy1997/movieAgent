import { app, BrowserWindow, utilityProcess, dialog } from 'electron';
import { startEngineHost, type EngineHost } from '../../../apps/desktop/src/main/engine-host.ts';
import { installWindowLifecycle } from '../../../apps/desktop/src/main/lifecycle.ts';
import { join } from 'node:path';
const root = process.argv.find(v => v.startsWith('--fixture-root='))!.slice('--fixture-root='.length);
app.setPath('userData', join(root, 'profile'));
const fork = utilityProcess.fork.bind(utilityProcess);
let child: ReturnType<typeof utilityProcess.fork> | undefined, host: EngineHost | undefined, exited = false, unexpected = 0;
let choiceWindow: BrowserWindow | undefined, removeChoice: (() => void) | undefined, quitRequests = 0, detail = '';
utilityProcess.fork = (...args: Parameters<typeof utilityProcess.fork>) => { child = fork(...args); exited = false; child.on('exit', () => { exited = true; }); return child; };
(globalThis as any).lifecycleFixture = {
  choose(response: number) {
    removeChoice?.(); choiceWindow?.destroy(); quitRequests = 0; detail = '';
    dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => { detail = options.detail ?? ''; return { response, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
    choiceWindow = new BrowserWindow({ show: true });
    removeChoice = installWindowLifecycle(choiceWindow, { quitting: () => false, activeTasks: async () => true, quit: () => { quitRequests++; } });
    choiceWindow.close();
  },
  choiceState() { return { visible: choiceWindow?.isVisible(), destroyed: choiceWindow?.isDestroyed(), quitRequests, detail }; },
  async start(mode: string) { const result = await startEngineHost(join(root, mode), { onExit: () => { unexpected++; } }); if (result.ok) host = result.value; return result.ok ? { ok: true, identity: result.value.identity } : result; },
  close(ms = 20_000) { return host!.quiesceEngine('fixture-quit', Date.now() + ms); },
  state() { return { exited, unexpected, pid: child?.pid }; },
  crash() { child!.kill(); },
  async duplicate(mode: string) { const owner = child, ownerExited = exited; const result = await startEngineHost(join(root, mode)); if (result.ok) await result.value.close(); child = owner; exited = ownerExited; return result.ok ? { ok: true } : result; },
};
void app.whenReady().then(async () => { const w = new BrowserWindow({ show: false }); await w.loadURL('about:blank'); });
app.on('before-quit', () => { removeChoice?.(); choiceWindow?.destroy(); child?.kill(); });
