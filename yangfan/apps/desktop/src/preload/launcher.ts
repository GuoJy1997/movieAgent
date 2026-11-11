import { contextBridge, ipcRenderer } from 'electron';
import type { ProjectLauncherBridge } from '../../../../packages/contracts/src/launcher.ts';
const bridge: ProjectLauncherBridge = Object.freeze({
  maintenanceInfo: () => ipcRenderer.invoke('launcher:maintenanceInfo'),
  backupProject: () => ipcRenderer.invoke('launcher:backupProject'),
  restoreProject: (name: string) => ipcRenderer.invoke('launcher:restoreProject', name),
  migrateProject: (name: string) => ipcRenderer.invoke('launcher:migrateProject', name),
  activateRestoredProject: () => ipcRenderer.invoke('launcher:activateRestoredProject'),
  revealUpgradeInstaller: () => ipcRenderer.invoke('launcher:revealUpgradeInstaller'),
  listRecent: () => ipcRenderer.invoke('launcher:listRecent'),
  createNew: (name: string) => ipcRenderer.invoke('launcher:createNew', name),
  fromFolder: (name: string) => ipcRenderer.invoke('launcher:fromFolder', name),
  openExisting: () => ipcRenderer.invoke('launcher:openExisting'),
  openRecent: (id: string) => ipcRenderer.invoke('launcher:openRecent', id),
  configInfo: () => ipcRenderer.invoke('launcher:configInfo'),
  openConfig: () => ipcRenderer.invoke('launcher:openConfig'),
  openLegacy: () => ipcRenderer.invoke('launcher:openLegacy'),
});
contextBridge.exposeInMainWorld('projectLauncher', bridge);
