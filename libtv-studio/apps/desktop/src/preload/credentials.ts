import { contextBridge, ipcRenderer } from 'electron';
import type { CredentialEntryBridge } from '../../../../packages/contracts/src/desktop.ts';
const bridge: CredentialEntryBridge = Object.freeze({
  info: () => ipcRenderer.invoke('credential:info'),
  submit: (input: unknown) => ipcRenderer.invoke('credential:submit', input),
  revoke: () => ipcRenderer.invoke('credential:revoke'),
});
contextBridge.exposeInMainWorld('credentials', bridge);
