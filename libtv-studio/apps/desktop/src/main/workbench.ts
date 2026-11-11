import {startWorkbenchMcp} from './mcp/workbench-mcp.ts';
import { exportCreation } from './creation-export.ts';
import { timelineExporter } from './timeline-export.ts';
import { voiceExporter } from './voice-export.ts';
import { readSubtitleFile } from './subtitle-file.ts';
import { timelineDraftClose } from './timeline-draft-close.ts';
import { app, BrowserWindow, dialog, safeStorage, powerMonitor, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startEngineHost, type EngineHost } from './engine-host';
import { CommandOutbox } from './command-outbox.ts';
import { LocalConnection } from './local-connection.ts';
import { installWorkspaceIpc } from './ipc-policy.ts';
import { CredentialVault } from './credential-vault.ts';
import { openCredentialWindow } from './credential-window.ts';
import { fail } from '../../../../packages/contracts/src/result.ts';
import type { ConnectionRevisionRef, ProviderSnapshot } from '../../../../packages/contracts/src/models.ts';
import type { Result } from '../../../../packages/contracts/src/result.ts';
import type { CredentialEditorOutcome } from '../../../../packages/contracts/src/desktop.ts';
import { issueFileGrant } from './file-grants.ts';
import { installMediaProtocol } from './media-protocol.ts';
import { ok } from '../../../../packages/contracts/src/result.ts';
import { installWindowLifecycle } from './lifecycle.ts';
import { GRACEFUL_SHUTDOWN_MS } from '../../../../packages/engine/src/shutdown.ts';
import { isTaskSnapshot } from '../../../../packages/contracts/src/generation.ts';
import { isResult } from '../../../../packages/contracts/src/desktop.ts';


import type { DirectoryProject } from '../../../../packages/contracts/src/directory-projects.ts';
import type { ModelConfigStatus } from '../../../../packages/contracts/src/desktop.ts';
import { validateWorkspace, bootstrapWorkspace } from './workspace-bootstrap.ts';
import { createModelConfigSynchronizer } from './model-config-import.ts';
import { modelConfigStore } from './model-config-store.ts';
import { openModelConfigWindow } from './model-config-editor.ts';
import type { ModelConfigEditOutcome } from '../../../../packages/contracts/src/model-config-file.ts';
import { spawnDesktop } from './project-launcher.ts';
export function runWorkbench(options: { project: DirectoryProject | null; launcherData: string; modelConfig: string; report(ready: boolean): Promise<void> }) {
const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
let directoryProject = options.project;
let modelStatus: ModelConfigStatus = { source: options.modelConfig, providerIds: [], state: 'unconfigured', errorCode: null };
let engine: EngineHost | undefined;
let mcp: Awaited<ReturnType<typeof startWorkbenchMcp>> | undefined;
let window: BrowserWindow | undefined;
let quitting = false;
let connection: LocalConnection | undefined;
let timelinePublisher: ReturnType<typeof timelineExporter> | undefined;
let outbox: CommandOutbox | undefined;
let vault: CredentialVault | undefined;
let credentialEditorOpen = false;
let modelConfigEditorOpen = false;
const modelStore = modelConfigStore(options.modelConfig);
let modelSynchronizer: ReturnType<typeof createModelConfigSynchronizer> | undefined;
let engineOpening: Promise<Result<EngineHost>> | undefined;
let reconnecting: Promise<void> | undefined;
let provisionalConnection: LocalConnection | undefined;
let lifecycleGeneration = 0;
let suspended = false;
let restartRequested = false;
let invalidateMedia = () => {};
let quitChecking=false;
const draftClose=timelineDraftClose(async()=>{
  if(!window||window.isDestroyed())return 'cancel';
  const answer=await dialog.showMessageBox(window,{type:'warning',title:'剪辑尚未保存',message:'当前时间线有未保存内容。',detail:'返回编辑器保存，或明确放弃当前草稿后退出。',buttons:['返回保存','放弃并退出','取消'],defaultId:0,cancelId:2,noLink:true});
  return answer.response===0?'save':answer.response===1?'discard':'cancel';
},()=>{window?.show();window?.focus();});
const libraryRoot = () => directoryProject?.libraryRoot ?? argument('library-root') ?? join(app.getPath('userData'), 'library');
async function activateHost(host: EngineHost) {
  if (directoryProject) { const bound = await bootstrapWorkspace(directoryProject, host); if (!bound.ok) throw Error(bound.error.code); directoryProject = bound.value; }
  const saved = await host.credentialStatuses(); if (!saved.ok) throw Error('Credential metadata unavailable');
  vault ??= await CredentialVault.open(join(app.getPath('userData'), 'credential-vault'), safeStorage, saved.value.map(status => status.ref));
  for (const item of saved.value) {
    if (item.state === 'revoked') continue;
    const status = await vault.status(item.ref);
    const synced = await host.updateCredentialStatus(status.ok ? status.value : { ref: item.ref, state: 'unavailable' });
    if (!synced.ok) throw Error('Credential synchronization failed');
  }
  modelSynchronizer = createModelConfigSynchronizer({ host, vault, store: modelStore });
  await reloadModelConfig();
  if (!(await host.startProvider(vault)).ok) throw Error('Provider activation failed');
}
async function synchronizeModelConfig(force = false): Promise<Result<ModelConfigStatus>> {
  try {
    const imported = modelSynchronizer ? await modelSynchronizer.synchronize(force) : fail('MODEL_CONFIG_IMPORT_FAILED', '受保护凭据暂不可用。');
    modelStatus = imported.ok ? imported.value : { ...modelStatus, source: options.modelConfig, providerIds: [], state: 'error', errorCode: imported.error.code };
    return imported;
  } catch { modelStatus = { ...modelStatus, source: options.modelConfig, providerIds: [], state: 'error', errorCode: 'MODEL_CONFIG_IMPORT_FAILED' }; return fail('MODEL_CONFIG_IMPORT_FAILED','模型配置尚未同步，请重新载入后再生成。'); }
}
async function reloadModelConfig() {
  await synchronizeModelConfig(true);
  return ok(modelStatus);
}
async function synchronizeModelFile(version: string): Promise<Result<ModelConfigEditOutcome>> {
  await reloadModelConfig();
  return ok({ status: 'saved', synchronization: modelStatus.state === 'error' ? 'importPending' : 'imported', version });
}
function openHost() { engineOpening = (async () => {
  if (directoryProject) {
    const checked = await validateWorkspace(directoryProject.root, options.launcherData); if (!checked.ok) return checked;
    directoryProject = checked.value;
  }
  return startEngineHost(libraryRoot(), { identityGuardRoot: join(options.launcherData, 'library-owners'), ...(argument('provider-evidence') === 'fixture' ? { evidence: 'fixture' as const } : {}), onExit: () => { void (async () => { await reconnecting; if (!quitting) await reconnect(true); })(); } }); })(); return engineOpening; }
function invalidateConnection() {
  lifecycleGeneration++;
  connection?.disconnect(); provisionalConnection?.disconnect(); invalidateMedia();
}
function reconnect(restart = false): Promise<void> {
  if (quitting || !outbox) return Promise.resolve();
  restartRequested ||= restart;
  invalidateConnection();
  if (reconnecting) return reconnecting;
  reconnecting = (async () => {
    while (!quitting && !suspended && outbox) {
      const generation = lifecycleGeneration;
      try {
        if (restartRequested) {
          restartRequested = false;
          await timelinePublisher?.close(); timelinePublisher = undefined;
          const started = await openHost(); if (!started.ok) return;
          engine = started.value; if (quitting) { await engine.close(); return; }
          await activateHost(engine);
        } else if (engine) await engine.reconcile();
        if (generation !== lifecycleGeneration) continue;
        if (!engine || quitting || suspended) return;
        const next = new LocalConnection(engine, outbox);
        provisionalConnection = next;
        try { await next.recover(); }
        finally { if (provisionalConnection === next) provisionalConnection = undefined; }
        if (generation === lifecycleGeneration && !quitting && !suspended) { connection = next; return; }
        next.disconnect();
        // A later wake invalidated this replay. Its ACK still settles the original
        // outbox, but a fresh reconciliation must precede publishing another epoch.
      } catch (error) {
        provisionalConnection?.disconnect(); provisionalConnection = undefined;
        if (generation === lifecycleGeneration) throw error;
      }
    }
  })().catch(() => { /* Existing query health surfaces offline and preserves drafts. */ }).finally(() => { reconnecting = undefined; });
  return reconnecting;
}

if (!app.requestSingleInstanceLock()) void options.report(true).finally(() => app.exit(0));
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    if(quitChecking)return;
    quitChecking=true;
    void (async () => {
      try {if(!await draftClose.mayQuit())return;
      quitting = true;
      await mcp?.close();
      invalidateConnection();
      const deadline = Date.now() + GRACEFUL_SHUTDOWN_MS;
      await timelinePublisher?.close();
      const opening = await engineOpening;
      const owned = opening?.ok ? opening.value : engine;
      if (owned) {
        const report = await owned.quiesceEngine('quit', deadline);
        await writeFile(join(app.getPath('userData'), 'shutdown-report.json'), JSON.stringify(report), { mode: 0o600 }).catch(() => {});
        if (!report.resourcesExited) { quitting = false; dialog.showErrorBox('本地引擎仍在清理', '未确认本地引擎退出。请稍后再次退出；不要同时打开此资料库。'); return; }
      }
      vault?.close();
      outbox?.close();
      app.exit(0);
      }finally{quitChecking=false;}
    })();
  });
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(async () => {
    // A trusted test launcher can only downgrade evidence; this is never a renderer command.
    const started = await openHost();
    if (!started.ok) {
      await options.report(false);
      dialog.showErrorBox('无法打开资料库', started.error.message);
      app.quit();
      return;
    }
    engine = started.value;
    if (quitting) { await engine.close(); return; }
    outbox = new CommandOutbox(join(app.getPath('userData'), 'client-state', 'command-outbox.sqlite'));
    const liveLibrary = argument('live-image-check-library');
    if (liveLibrary !== undefined) {
      // This fence runs after the engine owns the library, before credentials
      // activate the scheduler or durable client commands can be replayed.
      const snapshot = await engine.query({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'live-check-admission', queryId: 'live-check-admission', kind: 'task.list', payload: {} });
      const admitted = liveLibrary === engine.identity.libraryId && isResult(snapshot, isTaskSnapshot) && snapshot.ok && snapshot.value.tasks.every(task => ['SUCCEEDED','FAILED','CANCELLED'].includes(task.state) && !['submitting','accepted','unknown'].includes(task.providerState) && !(task.providerState === 'completed' && task.collectionState !== 'durable')) && !outbox.hasPending();
      await writeFile(join(app.getPath('userData'), 'live-check-admission.json'), JSON.stringify(admitted ? { admitted: true } : { admitted: false, reason: 'LIVE_LIBRARY_NOT_IDLE' }));
      if (!admitted) { app.quit(); return; }
    }
    await activateHost(engine);
    if (quitting) return;
    connection = new LocalConnection(engine, outbox);
    const recovery = await connection.recover();
    if (!recovery.ok) dialog.showErrorBox('待确认操作尚未恢复', recovery.error.message);
    window = new BrowserWindow({
      title: '羊番TV', width: 1180, height: 780, minWidth: 800, minHeight: 560,
      backgroundColor: '#0b0e14',
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, partition: `studio-workspace-${connection.connectionEpoch}` },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    const expectedUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? new URL('renderer/index.html', process.env.ELECTRON_RENDERER_URL).href : undefined;
    const localPath = join(__dirname, '../renderer/renderer/index.html');
    const localUrl = pathToFileURL(localPath).href;
    // Handlers are installed only after the utility engine's identity handshake.
    async function editCredential(ref: ConnectionRevisionRef): Promise<Result<CredentialEditorOutcome>> {
      if (credentialEditorOpen || modelConfigEditorOpen) return fail('CREDENTIAL_EDITOR_BUSY', '请先完成当前独立配置窗口。');
      if (!engine || !connection || !vault || !window || quitting) return fail('CREDENTIAL_UI_UNAVAILABLE', '凭据入口不可用。');
      credentialEditorOpen = true;
      try {
        const snapshot = await connection.query({ schemaVersion: 1, libraryId: ref.libraryId, connectionEpoch: connection.connectionEpoch, queryId: 'credential-owner-check', kind: 'provider.list', payload: {} });
        if (!snapshot.ok) return snapshot;
        const selected = (snapshot.value as ProviderSnapshot).connections.find(item => item.id === ref.id && item.revision === ref.revision && item.libraryId === ref.libraryId);
        if (!selected) return fail('REVISION_NOT_FOUND', '请先保存连接，再录入凭据。');
        return await openCredentialWindow({ parent: window, connection: selected, vault, synchronize: status => engine!.updateCredentialStatus(status) });
      } catch { return fail('CREDENTIAL_UI_UNAVAILABLE', '凭据入口无法打开，请检查安装文件。'); }
      finally { credentialEditorOpen = false; }
    }
    const media = installMediaProtocol(window.webContents.session, engine.identity.libraryId, input => engine!.readMedia(input), { openDerivedMediaRead: (ref, hash) => engine!.openDerivedMediaRead(ref, hash), readDerivedMediaRange: input => engine!.readDerivedMediaRange(input), closeDerivedMediaRead: id => engine!.closeDerivedMediaRead(id), openMediaRead: (ref, hash) => engine!.openMediaRead(ref, hash), readMediaRange: input => engine!.readMediaRange(input), closeMediaRead: id => engine!.closeMediaRead(id) });
    invalidateMedia = () => media.invalidate();
    try { mcp=await startWorkbenchMcp({
      stateRoot:join(app.getPath('userData'),'mcp'),launcherData:options.launcherData,modelConfig:options.modelConfig,
      execPath:process.execPath,stdioPath:join(__dirname,'mcp-stdio.js'),
      context:()=>{if(!engine||!connection||!window||quitting||suspended||reconnecting)throw Error('ENGINE_DISCONNECTED');return {host:engine,connection,window,project:directoryProject,root:libraryRoot()};},
      ensureCurrent:async()=>{const r=await synchronizeModelConfig();return r.ok?ok(undefined):r;}
    }); } catch { /* MCP failure must not prevent ordinary editing. Status reports unavailable. */ }
    const removeIpc = installWorkspaceIpc(window, expectedUrl ?? localUrl, () => connection!, editCredential, {
      async selectSubtitle(){const selected=await dialog.showOpenDialog(window!,{properties:['openFile'],filters:[{name:'UTF-8 字幕',extensions:['srt']}]});if(selected.canceled)return ok(null);return selected.filePaths.length===1?readSubtitleFile(selected.filePaths[0]!):fail('INVALID_INPUT','每次选择一个 SRT 文件。');},
      async setDraft(value){draftClose.update(value);return ok(undefined);},
      async select() {
        const selected = await dialog.showOpenDialog(window!, { properties: ['openFile', 'multiSelections'], filters: [{ name: '图片、视频、音频与文本', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'wav', 'mp3', 'm4a', 'txt', 'md'] }] });
        if (selected.canceled) return ok(null);
        const grant = await issueFileGrant(engine!.identity.libraryId, selected.filePaths); if (!grant.ok) return grant;
        const registered = await engine!.registerFileGrant(grant.value); if (!registered.ok) return registered;
        const { files: selectedFiles, ...ref } = grant.value; return ok({ ...ref, fileCount: selectedFiles.length });
      },
      mediaUrl: input => media.issue(input),
      derivedMediaUrl: input => media.issueDerived(input),
      releaseMediaUrl: input => Promise.resolve(media.release(input)),
    }, {
      info: async () => ok({ project: directoryProject, modelConfig: modelStatus }),
      async exportCreation(input) {
        if (!directoryProject) return fail('NO_DIRECTORY_PROJECT','旧版资料库没有短剧目录，请从启动器打开目录项目后导出。');
        const checked = await validateWorkspace(directoryProject.root, options.launcherData); if (!checked.ok) return checked;
        const binding = checked.value.manifest.binding;
        if (!binding || binding.libraryId !== engine!.identity.libraryId) return fail('WRONG_LIBRARY','项目绑定已变化。');
        const live = connection!;
        const base = {schemaVersion:1 as const,libraryId:binding.libraryId,connectionEpoch:live.connectionEpoch};
        return exportCreation({root:checked.value.root,libraryId:binding.libraryId,projectId:binding.projectId}, input,
          () => live.query({...base,queryId:crypto.randomUUID(),kind:'creation.read',payload:{projectId:binding.projectId,scriptId:input.scriptId}}),
          id => live.query({...base,queryId:crypto.randomUUID(),kind:'creation.history',payload:{projectId:binding.projectId,kind:'entity',id}}));
      },
      async exportVoice(input) {
        if (!directoryProject) return fail('NO_DIRECTORY_PROJECT','请先打开目录项目。');
        const checked = await validateWorkspace(directoryProject.root, options.launcherData); if (!checked.ok) return checked;
        const binding = checked.value.manifest.binding;
        if (!binding || binding.libraryId !== engine!.identity.libraryId) return fail('WRONG_LIBRARY','项目绑定已变化。');
        const live = connection!, base = {schemaVersion:1 as const,libraryId:binding.libraryId,connectionEpoch:live.connectionEpoch};
        return voiceExporter({root:checked.value.root,libraryId:binding.libraryId,projectId:binding.projectId}, {openMediaRead:(ref,hash)=>engine!.openMediaRead(ref,hash),readMediaRange:value=>engine!.readMediaRange(value),closeMediaRead:async id=>{await engine!.closeMediaRead(id);}})(input, () => live.query({...base,queryId:crypto.randomUUID(),kind:'voice.read',payload:{projectId:binding.projectId,voiceRef:input.voiceRef}}));
      },
      async exportTimeline(input) {
        if (!directoryProject) return fail('NO_DIRECTORY_PROJECT','请先打开目录项目。');
        const checked = await validateWorkspace(directoryProject.root, options.launcherData); if (!checked.ok) return checked;
        const binding = checked.value.manifest.binding, host = engine;
        if (!binding || !host || quitting || binding.libraryId !== host.identity.libraryId) return fail('WRONG_LIBRARY','项目绑定已变化。');
        timelinePublisher ??= timelineExporter({
          prepareExport: (value,context) => engine ? engine.prepareExport(value as import('../../../../packages/contracts/src/timeline-export.ts').ExportTimelineInput,context) : Promise.resolve(fail('ENGINE_DISCONNECTED','引擎已断开。')),
          recordExportOutcome: (value,context) => engine ? engine.recordExportOutcome(value,context) : Promise.resolve(fail('ENGINE_DISCONNECTED','引擎已断开。')),
          cancelExport: (value,context) => engine ? engine.cancelExport(value as {requestId:string},context) : Promise.resolve(fail('ENGINE_DISCONNECTED','引擎已断开。')),
        }, {
          openMediaRead: (ref, hash, context) => engine ? engine.openMediaRead(ref,hash,context) : Promise.resolve(fail('ENGINE_DISCONNECTED','引擎已断开。')),
          readMediaRange: (value, context) => engine ? engine.readMediaRange(value,context) : Promise.resolve(fail('ENGINE_DISCONNECTED','引擎已断开。')),
          closeMediaRead: async (id, context) => { if(engine) await engine.closeMediaRead(id,context); },
        });
        return timelinePublisher.exportTimeline({root:checked.value.root,logRoot:checked.value.libraryRoot,libraryId:binding.libraryId,projectId:binding.projectId},input);
      },
      async cancelTimelineExport(input) { return timelinePublisher ? timelinePublisher.cancelTimelineExport(input) : engine ? engine.cancelExport(input) : fail('ENGINE_DISCONNECTED','引擎已断开。'); },
      async openFolder() { if (!directoryProject) return fail('NO_DIRECTORY_PROJECT', '旧版资料库没有短剧根目录。'); const checked = await validateWorkspace(directoryProject.root, options.launcherData); if (!checked.ok) return checked; const error = await shell.openPath(checked.value.root); return error ? fail('FOLDER_OPEN_FAILED', '无法打开项目文件夹。') : ok(undefined); },
      async openLauncher() { const child = spawnDesktop(['--project-launcher', `--user-data-dir=${options.launcherData}`, `--model-config=${options.modelConfig}`]); return new Promise(resolve => { child.once('spawn', () => resolve(ok(undefined))); child.once('error', () => resolve(fail('LAUNCHER_START_FAILED', '无法打开项目启动器。'))); }); },
      reloadModelConfig: () => reloadModelConfig(),
    }, {
      read: () => modelStore.readPublic(),
      async ensureCurrent() { const synced = await synchronizeModelConfig(); return synced.ok ? ok(undefined) : synced; },
      async edit(input) {
        if (credentialEditorOpen || modelConfigEditorOpen) return fail('MODEL_CONFIG_BUSY','请先完成当前独立配置窗口。');
        if (!window || !engine || quitting) return fail('MODEL_CONFIG_UI_UNAVAILABLE','配置编辑器暂不可用。');
        modelConfigEditorOpen = true;
        try { return await openModelConfigWindow({ parent: window, input, store: modelStore, synchronize: synchronizeModelFile }); }
        catch { return fail('MODEL_CONFIG_UI_UNAVAILABLE','无法打开配置编辑器，请检查安装文件。'); }
        finally { modelConfigEditorOpen = false; }
      },
      async remove(input) {
        if (modelConfigEditorOpen) return fail('MODEL_CONFIG_BUSY','请先完成当前配置编辑。');
        const saved = await modelStore.remove(input);
        return saved.ok ? synchronizeModelFile(saved.value.version) : saved;
      },
    }, {
      status:()=>mcp?mcp.status():Promise.resolve(fail('MCP_UNAVAILABLE','MCP暂不可用，请检查应用安装或数据目录。')),
      configure:input=>mcp?mcp.configure(input):Promise.resolve(fail('MCP_UNAVAILABLE','MCP暂不可用。')),
      async selectDirectory(){if(!mcp||!window)return fail('MCP_UNAVAILABLE','MCP暂不可用。');const selected=await dialog.showOpenDialog(window,{properties:['openDirectory'],title:'允许Agent导入图片的目录'});return selected.canceled?mcp.status():selected.filePaths.length===1?mcp.addSource(selected.filePaths[0]!):fail('INVALID_INPUT','每次选择一个目录。');}
    });
    const removeLifecycle = installWindowLifecycle(window, { quitting: () => quitting, quit: () => app.quit(), async activeTasks() {
      if (!connection) return true;
      const result = await connection.query({ schemaVersion: 1, libraryId: engine!.identity.libraryId, connectionEpoch: connection.connectionEpoch, queryId: 'close-active-tasks', kind: 'task.list', payload: {} });
      return !result.ok || result.value.tasks.some(task => !['SUCCEEDED','FAILED','CANCELLED'].includes(task.state));
    } });
    let firstNavigation = true, replacedInitialLoad = false;
    window.webContents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
      if (!mainFrame || inPlace) return;
      if (firstNavigation) { firstNavigation = false; return; }
      if (url === (expectedUrl ?? localUrl)) replacedInitialLoad = true;
      void reconnect();
    });
    powerMonitor.on('suspend', () => { suspended = true; invalidateConnection(); });
    powerMonitor.on('resume', () => { suspended = false; void reconnect(); });
    window.on('closed', () => { removeLifecycle(); removeIpc(); media.close(); });
    window.setMenuBarVisibility(false);
    try { await window.loadURL(expectedUrl ?? localUrl); await options.report(true); }
    catch (error) {
      if (quitting || window.isDestroyed()) return;
      // Only a known replacement navigation to this same trusted document may
      // abort its first load. Genuine load failures still reach startup diagnostics.
      if (replacedInitialLoad && error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED') return;
      throw error;
    }
  }).catch(async () => {
    if (quitting) return;
    connection?.disconnect();
    await engine?.close();
    await options.report(false);
    dialog.showErrorBox('启动失败', '桌面程序启动失败。请检查资料库目录与应用安装。');
    app.quit();
  });
}

}
