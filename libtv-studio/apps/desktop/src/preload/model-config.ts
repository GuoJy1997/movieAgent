import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('modelConfigEntry', Object.freeze({
  info: () => ipcRenderer.invoke('model-config:info'),
  listModels: (input: unknown) => ipcRenderer.invoke('model-config:list-models', input),
  test: (input: unknown) => ipcRenderer.invoke('model-config:test', input),
  prepareAudioTest: (input: unknown) => ipcRenderer.invoke('model-config:audio-prepare', input),
  runAudioTest: (input: unknown) => ipcRenderer.invoke('model-config:audio-run', input),
  submit: (input: unknown) => ipcRenderer.invoke('model-config:submit', input),
}));
