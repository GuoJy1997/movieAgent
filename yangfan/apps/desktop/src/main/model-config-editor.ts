import { createTextOnboarding } from './text-onboarding.ts';
import { createAudioOnboarding } from './audio-onboarding.ts';
import { inspectOnboardingAudio, readOnboardingAudio } from './audio-onboarding-media.ts';
import { isAudioProtocol } from '../../../../packages/providers/src/audio-protocol.ts';
import { BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import type { ModelConfigEditOutcome, ModelConfigEditorInput } from '../../../../packages/contracts/src/model-config-file.ts';
import type { modelConfigStore } from './model-config-store.ts';

/** Raw keys exist only in this memory-isolated local surface and the main store. */
export async function openModelConfigWindow(options: {
  parent: BrowserWindow; input: ModelConfigEditorInput; store: ReturnType<typeof modelConfigStore>;
  synchronize(version: string): Promise<Result<ModelConfigEditOutcome>>;
}): Promise<Result<ModelConfigEditOutcome>> {
  const initial = await options.store.readPublic(); if (!initial.ok) return initial;
  if (initial.value.version !== options.input.expectedVersion) return fail('MODEL_CONFIG_CONFLICT', '配置文件已修改，请重新载入后打开编辑器。');
  if (options.input.providerId && !initial.value.providers.some(p => p.id === options.input.providerId)) return fail('MODEL_CONFIG_NOT_FOUND', '配置已不存在，请重新载入。');
  const documentPath = join(__dirname, '../renderer/model-config/index.html'), expectedUrl = pathToFileURL(documentPath).href;
  const html = await readFile(documentPath, 'utf8'), resources = new Set([expectedUrl]);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(match[1]!, expectedUrl); if (url.protocol !== 'file:') return fail('MODEL_CONFIG_UI_UNAVAILABLE', '配置入口必须使用本机文件。'); resources.add(url.href);
  }
  const isolated = session.fromPartition(`model-config-${randomUUID()}`, { cache: false });
  isolated.setPermissionRequestHandler((_c, _p, callback) => callback(false)); isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', event => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !resources.has(details.url) }));
  const window = new BrowserWindow({ parent: options.parent, modal: true, show: false, width: 660, height: 850, title: '软件模型配置',
    webPreferences: { session: isolated, preload: join(__dirname, '../preload/model-config.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, devTools: false, spellcheck: false, webgl: false, navigateOnDragDrop: false, v8CacheOptions: 'none' } });
  window.setMenuBarVisibility(false); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('will-attach-webview', event => event.preventDefault());
  const onboarding=createTextOnboarding(options.store);
  const audio = createAudioOnboarding(options.store, {
    pickSource: async () => {
      const selected = await dialog.showOpenDialog(window, { title: '选择自有或许可的最长5秒音频', properties: ['openFile'], filters: [{ name: '音频', extensions: ['wav', 'mp3', 'm4a'] }] });
      return selected.canceled || selected.filePaths.length !== 1 ? fail('MODEL_TEST_CANCELLED', '已取消选择音频。') : readOnboardingAudio(selected.filePaths[0]!);
    },
    validateSpeech: async bytes => { const inspected = await inspectOnboardingAudio(bytes); return inspected.ok ? ok(undefined) : inspected; },
  });
  const channels = ['model-config:info','model-config:submit','model-config:list-models','model-config:test','model-config:audio-prepare','model-config:audio-run'] as const;
  const allowed = (event: IpcMainInvokeEvent) => !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === expectedUrl;
  let running = false, completed = false, finalResult: Result<ModelConfigEditOutcome> | undefined;
  let finish!: (r: Result<ModelConfigEditOutcome>) => void;
  const result = new Promise<Result<ModelConfigEditOutcome>>(resolve => { finish = resolve; });
  for (const channel of channels) ipcMain.handle(channel, async (event, input: unknown) => {
    if (!allowed(event)) return fail('FORBIDDEN', '此窗口或 frame 无权编辑模型配置。');
    if (channel === 'model-config:info') {
      if (input !== undefined) return fail('INVALID_INPUT','配置读取不接受参数。');
      const config = await options.store.readPublic();
      return config.ok ? ok({ config: config.value, providerId: options.input.providerId ?? null }) : config;
    }
    if (running || completed) return fail('MODEL_CONFIG_BUSY','正在保存，请稍候。');
    if (channel === 'model-config:audio-prepare' || channel === 'model-config:audio-run') {
      try { return await (channel === 'model-config:audio-prepare' ? audio.prepareTest(input) : audio.runTest(input)); }
      finally { if (isRecord(input) && isRecord(input.provider)) delete input.provider.apiKey; }
    }
    if(channel==='model-config:list-models'||channel==='model-config:test'){
      try{return await (isRecord(input) && isRecord(input.provider) && isAudioProtocol(input.provider.adapterType) ? audio.listModels(input) : channel==='model-config:test'?onboarding.test(input):onboarding.listModels(input));}
      finally{if(isRecord(input)&&isRecord(input.provider))delete input.provider.apiKey;}
    }
    if (!isRecord(input) || ![2,3].includes(Object.keys(input).length) || typeof input.expectedVersion !== 'string' || !isRecord(input.provider)) return fail('INVALID_INPUT','配置输入无效。');
    const submittedId = input.provider.id;
    running = true;
    let outcome: Result<ModelConfigEditOutcome>;
    try {
      const current = await options.store.readPublic();
      const collision = options.input.providerId ? submittedId !== options.input.providerId : current.ok && current.value.providers.some(p => p.id === submittedId);
      const audioConfig = isAudioProtocol(input.provider.adapterType);
      const authorized = audioConfig ? ok(undefined) : await onboarding.authorize(input);
      const saved = !authorized.ok ? authorized : !current.ok ? current : collision ? fail('MODEL_CONFIG_ID_CONFLICT','ID 已存在或不能更改，请使用其他 ID。') : audioConfig ? await audio.saveVerified(input) : await options.store.save({ expectedVersion: input.expectedVersion, provider: input.provider });
      if (!saved.ok) outcome = saved;
      else {
        completed = true;
        try { outcome = await options.synchronize(saved.value.version); }
        catch { outcome = ok({ status:'saved', synchronization:'importPending', version:saved.value.version }); }
      }
    } catch { outcome = fail('MODEL_CONFIG_WRITE_FAILED','保存未完成，草稿已保留。'); }
    finally { delete input.provider.apiKey; running = false; }
    if (completed || window.isDestroyed()) { finalResult = outcome; if (window.isDestroyed()) finish(outcome); else setImmediate(()=>{if(!window.isDestroyed())window.close();}); }
    return outcome;
  });
  window.on('closed', () => {
    onboarding.cancel();
    audio.cancel();
    for (const channel of channels) ipcMain.removeHandler(channel);
    isolated.webRequest.onBeforeRequest(null); void isolated.clearStorageData().catch(()=>{});
    if (finalResult) finish(finalResult); else if (!running) finish(ok({status:'cancelled'}));
  });
  try { await window.loadURL(expectedUrl); if (!window.isDestroyed()) window.show(); }
  catch { finalResult = fail('MODEL_CONFIG_UI_UNAVAILABLE','无法打开配置编辑器，请检查安装文件。'); if (!window.isDestroyed()) window.close(); else finish(finalResult); }
  return result;
}
