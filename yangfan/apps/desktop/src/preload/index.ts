import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../../../../packages/contracts/src/desktop.ts';

const bridge: DesktopBridge = Object.freeze({
  mcpStatus: () => ipcRenderer.invoke('studio:mcp:status'),
  mcpConfigure: (input:unknown) => ipcRenderer.invoke('studio:mcp:configure', input),
  mcpSelectImportDirectory: () => ipcRenderer.invoke('studio:mcp:select-directory'),
  selectSubtitleFile: () => ipcRenderer.invoke('studio:subtitle:select'),
  setTimelineDraftState: (input: unknown) => ipcRenderer.invoke('studio:timeline:draft', input),
  exportCreation: (input: unknown) => ipcRenderer.invoke('studio:creation:export', input),
  exportTimeline: (input: unknown) => ipcRenderer.invoke('studio:timeline:export', input),
  exportVoice: (input: unknown) => ipcRenderer.invoke('studio:voice:export', input),
  cancelTimelineExport: (input: unknown) => ipcRenderer.invoke('studio:timeline:cancel-export', input),
  workspaceInfo: () => ipcRenderer.invoke('studio:workspace:info'),
  openProjectFolder: () => ipcRenderer.invoke('studio:workspace:folder'),
  openProjectLauncher: () => ipcRenderer.invoke('studio:workspace:launcher'),
  reloadModelConfig: () => ipcRenderer.invoke('studio:workspace:reload'),
  readModelConfig: () => ipcRenderer.invoke('studio:model-config:read'),
  openModelConfigEditor: (input: unknown) => ipcRenderer.invoke('studio:model-config:edit', input),
  removeModelConfigProvider: (input: unknown) => ipcRenderer.invoke('studio:model-config:remove', input),
  selectImportFiles: () => ipcRenderer.invoke('studio:files:select'),
  mediaUrl: (input: unknown) => ipcRenderer.invoke('studio:media:url', input),
  derivedMediaUrl: (ref: unknown) => ipcRenderer.invoke('studio:media:derived-url', ref),
  releaseMediaUrl: (url: unknown) => ipcRenderer.invoke('studio:media:release', url),
  openCredentialEditor: (connectionRef: unknown) => ipcRenderer.invoke('studio:credential:open', connectionRef),
  describe: () => ipcRenderer.invoke('studio:describe'),
  listProjects: () => ipcRenderer.invoke('studio:project:list'),
  createProject: (input: unknown) => ipcRenderer.invoke('studio:project:create', input),
  execute: (input: unknown) => ipcRenderer.invoke('studio:execute', input),
  query: (input: unknown) => ipcRenderer.invoke('studio:query', input),
  readEvents: (input: unknown) => ipcRenderer.invoke('studio:events', input),
});
contextBridge.exposeInMainWorld('studio', bridge);
