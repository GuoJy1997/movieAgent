import { app, BrowserWindow, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createDirectoryProject, inspectDirectoryProject, isLocalAbsolutePath, writeAtomicFile } from './project-directories.ts';
import { RecentProjects } from './recent-projects.ts';
import { installLauncherIpc } from './launcher-ipc.ts';
import { loadModelConfig } from './model-config-file.ts';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import type { ModelConfigStatus } from '../../../../packages/contracts/src/desktop.ts';
import type { DirectoryProject } from '../../../../packages/contracts/src/directory-projects.ts';
import type { TransferReceipt } from '../../../../packages/contracts/src/project-maintenance.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../../packages/contracts/src/schema.ts';
import { createProjectBackup, restoreProjectBackup } from '../../../../packages/storage/src/project-backup.ts';
import { activateRestoredProject, migrateDirectoryProject } from '../../../../packages/storage/src/project-transfer.ts';
import { readProjectPolicy } from '../../../../packages/storage/src/project-policy.ts';

export const blankModels = `${JSON.stringify({ schemaVersion: 1, providers: [{ id: 'image-default', name: '默认图像服务', kind: 'image', baseURL: '', apiKey: '', modelId: '', allowPrivateEndpoint: false }] }, null, 2)}\n`;
export function spawnDesktop(args: string[]) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, [...(!app.isPackaged ? [join(__dirname, 'index.js')] : []), ...args], { detached: true, stdio: 'ignore', env, windowsHide: false });
  child.unref(); return child;
}
export async function configPathFor(launcherData: string, explicit?: string): Promise<string> {
  await mkdir(launcherData, { recursive: true });
  const settings = join(launcherData, 'launcher-settings.json');
  if (explicit !== undefined) {
    if (!isLocalAbsolutePath(explicit)) throw Error('INVALID_MODEL_CONFIG_PATH');
    await writeAtomicFile(settings, JSON.stringify({ modelConfig: explicit }), true); return explicit;
  }
  try { const saved = JSON.parse(await readFile(settings, 'utf8')); if (isLocalAbsolutePath(saved.modelConfig)) return saved.modelConfig; } catch { /* Fresh local settings. */ }
  const path = join(launcherData, 'models.json');
  await writeFile(path, blankModels, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return path;
}
export async function readConfigStatus(source: string): Promise<ModelConfigStatus> {
  const loaded = await loadModelConfig(source);
  return loaded.ok ? { source, providerIds: loaded.value.providers.map(p => p.id), state: loaded.value.providers.some(p => p.state === 'ready') ? 'ready' : 'unconfigured', errorCode: null } : { source, providerIds: [], state: 'error', errorCode: loaded.error.code };
}
export async function runProjectLauncher(options: { data: string; modelConfig: string; initialRoot?: string }) {
  const appVersion: string = app.isPackaged ? app.getVersion() : JSON.parse(await readFile(join(__dirname, '../../package.json'), 'utf8')).version;
  let window: BrowserWindow | undefined;
  const openProject = async (project: DirectoryProject): Promise<Result<DirectoryProject>> => {
    const registry = await RecentProjects.open(join(options.data, 'recent-projects.json')); if (!registry.ok) return registry;
    const remembered = await registry.value.remember(project); if (!remembered.ok) return remembered;
    const token = randomUUID(), statusPath = join(options.data, `startup-${token}.json`);
    const child = spawnDesktop([`--project-root=${project.root}`, '--workspace-child', `--launcher-data=${options.data}`, `--model-config=${options.modelConfig}`, `--startup-token=${token}`]);
    let failed = false; child.once('error', () => { failed = true; });
    const deadline = Date.now() + 20_000;
    while (!failed && Date.now() < deadline) {
      try {
        const status = JSON.parse(await readFile(statusPath, 'utf8')); await unlink(statusPath);
        return status.ready === true ? ok(project) : fail('WORKSPACE_START_FAILED', '项目工作台启动失败，请检查项目目录与应用安装。');
      } catch { /* Child is opening its owned engine. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return fail('WORKSPACE_START_FAILED', '项目工作台尚未确认启动，请检查窗口或项目目录后重试。');
  };
  const pending = new Map<string, Promise<Result<DirectoryProject>>>();
  const launch = (project: DirectoryProject) => {
    const id = project.manifest.workspaceId, previous = pending.get(id); if (previous) return previous;
    const next = openProject(project).finally(() => pending.delete(id)); pending.set(id, next); return next;
  };
  const openRoot = async (root: string) => { const inspected = await inspectDirectoryProject(root); if (!inspected.ok) return inspected; try { if ((await readProjectPolicy(inspected.value.libraryRoot))?.state === 'retired') return fail('PROJECT_RETIRED', '此目录已完成迁移并停用，请打开新位置的项目。'); } catch { return fail('INVALID_PROJECT_POLICY', '项目维护标记不可读，请保留原目录后检查。'); } return launch(inspected.value); };
  const argument = (argv: string[], name: string) => argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
  app.on('second-instance', (_event, argv) => {
    window?.show(); window?.focus();
    void (async () => {
      const explicit = argument(argv, 'model-config');
      if (explicit) options.modelConfig = await configPathFor(options.data, explicit);
      const root = argument(argv, 'project-root');
      if (root) { const result = await openRoot(root); if (!result.ok) dialog.showErrorBox('无法打开项目', result.error.message); }
    })().catch(() => dialog.showErrorBox('无法打开项目', '配置路径或项目目录不可用。'));
  });
  app.on('window-all-closed', () => app.quit());
  await app.whenReady();
  window = new BrowserWindow({ title: '羊番TV · 项目启动器', width: 1060, height: 760, minWidth: 800, minHeight: 560, backgroundColor: '#0b0e14', webPreferences: { preload: join(__dirname, '../preload/launcher.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const url = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? new URL('launcher/index.html', process.env.ELECTRON_RENDERER_URL).href : pathToFileURL(join(__dirname, '../renderer/launcher/index.html')).href;
  async function select() { const result = await dialog.showOpenDialog(window!, { title: '选择短剧项目文件夹', defaultPath: 'D:/movieAgent/projects', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0] ?? null; }
  async function create(name: string, mode: 'new' | 'existing') { const directory = await select(); if (!directory) return ok(null); const result = await createDirectoryProject({ mode, name, directory }); return result.ok ? launch(result.value) : result; }
  async function pick(title: string) { const result = await dialog.showOpenDialog(window!, { title, properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0] ?? null; }
  let maintaining = false;
  async function exclusive<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> { if (maintaining) return fail('MAINTENANCE_BUSY', '项目维护正在进行。'); maintaining = true; try { return await operation(); } finally { maintaining = false; } }
  async function rememberTransfer(result: Result<TransferReceipt | null>): Promise<Result<TransferReceipt | null>> {
    if (!result.ok || !result.value) return result;
    const project = await inspectDirectoryProject(result.value.root); if (!project.ok) return project;
    const registry = await RecentProjects.open(join(options.data, 'recent-projects.json')); if (!registry.ok) return registry;
    const remembered = await registry.value.remember(project.value); return remembered.ok ? result : remembered;
  }
  const remove = installLauncherIpc(window, url, {
    async maintenanceInfo() { return ok({ appVersion, databaseSchema: CURRENT_SCHEMA_VERSION, backupFormat: 1 as const }); },
    backupProject: () => exclusive(async () => {
      const projectRoot = await pick('选择已关闭的短剧项目'); if (!projectRoot) return ok(null);
      const directory = await pick('选择备份存放的父目录'); if (!directory) return ok(null);
      return createProjectBackup({ projectRoot, destination: join(directory, `MovieAgent-备份-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`), appVersion });
    }),
    restoreProject: name => exclusive(async () => {
      const backupRoot = await pick('选择包含 backup.json 的完整备份目录'); if (!backupRoot) return ok(null);
      const directory = await pick('选择恢复项目的父目录'); if (!directory) return ok(null);
      return rememberTransfer(await restoreProjectBackup({ backupRoot, destination: join(directory, name), name }));
    }),
    migrateProject: name => exclusive(async () => {
      const projectRoot = await pick('选择已关闭的迁移源项目'); if (!projectRoot) return ok(null);
      const directory = await pick('选择新位置的父目录'); if (!directory) return ok(null);
      const confirmed = await dialog.showMessageBox(window!, { type: 'question', title: '迁移短剧项目', message: '确认将项目迁移到新位置？', detail: `目标：${join(directory, name)}\n校验成功后停用原目录，保留原文件和一份完整迁移备份。请确认原项目在其他应用或电脑上也已停止执行。`, buttons: ['取消', '确认迁移'], defaultId: 0, cancelId: 0 });
      if (confirmed.response !== 1) return ok(null);
      return rememberTransfer(await migrateDirectoryProject({ projectRoot, destination: join(directory, name), appVersion }));
    }),
    activateRestoredProject: () => exclusive(async () => {
      const root = await pick('选择已关闭、待启用的恢复项目'); if (!root) return ok(null);
      const confirmed = await dialog.showMessageBox(window!, { type: 'warning', title: '启用恢复项目的任务执行', message: '确认原项目已停止执行？', detail: '启用后，下次打开将恢复任务对账与调度，可能继续调用模型。请先停止原项目在其他电脑或应用中的执行；本机检查无法证明另一台电脑已停止。', buttons: ['保持暂停', '原项目已停止，启用执行'], defaultId: 0, cancelId: 0 });
      return confirmed.response === 1 ? rememberTransfer(await activateRestoredProject(root)) : ok(null);
    }),
    revealUpgradeInstaller: () => exclusive(async () => {
      const selected = await dialog.showOpenDialog(window!, { title: '定位已下载的 羊番TV 安装包', properties: ['openFile'], filters: [{ name: 'Windows 安装包', extensions: ['exe'] }] });
      if (!selected.canceled && selected.filePaths[0]) shell.showItemInFolder(selected.filePaths[0]);
      return ok(undefined);
    }),
    async listRecent() { const registry = await RecentProjects.open(join(options.data, 'recent-projects.json')); return registry.ok ? registry.value.list() : registry; },
    createNew: name => create(name, 'new'), fromFolder: name => create(name, 'existing'),
    async openExisting() { const root = await select(); return root ? openRoot(root) : ok(null); },
    async openRecent(id) { const registry = await RecentProjects.open(join(options.data, 'recent-projects.json')); if (!registry.ok) return registry; const entry = await registry.value.find(id); return entry.ok ? openRoot(entry.value.root) : entry; },
    async configInfo() { return ok(await readConfigStatus(options.modelConfig)); },
    async openConfig() { const error = await shell.openPath(options.modelConfig); return error ? fail('CONFIG_OPEN_FAILED', '无法打开配置文件，请检查文件是否存在。') : ok(undefined); },
    async openLegacy() { const child = spawnDesktop(['--legacy-workspace', `--model-config=${options.modelConfig}`, `--launcher-data=${options.data}`]); return new Promise(resolve => { child.once('spawn', () => resolve(ok(undefined))); child.once('error', () => resolve(fail('WORKSPACE_START_FAILED', '旧版资料库启动失败。'))); }); },
  });
  window.on('closed', remove); await window.loadURL(url);
  if (options.initialRoot) { const result = await openRoot(options.initialRoot); if (!result.ok) dialog.showErrorBox('无法打开项目', result.error.message); }
}
