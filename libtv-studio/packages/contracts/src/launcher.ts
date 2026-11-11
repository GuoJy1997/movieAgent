import type { ExportCreationInput, ExportCreationResult } from './creation-export.ts';
import type { ExportTimelineInput, ExportReceipt } from './timeline-export.ts';
import type { VoiceExportInput, VoiceExportReceipt } from './character-voice.ts';
import type { Result } from './result.ts';
import type { DirectoryProject, RecentProjectStatus } from './directory-projects.ts';
import type { ModelConfigStatus } from './desktop.ts';
import type { BackupReceipt, TransferReceipt, MaintenanceInfo } from './project-maintenance.ts';
export interface WorkspaceInfo { project: DirectoryProject | null; modelConfig: ModelConfigStatus }
export interface ProjectLauncherBridge {
  maintenanceInfo(): Promise<Result<MaintenanceInfo>>;
  backupProject(): Promise<Result<BackupReceipt | null>>;
  restoreProject(name: string): Promise<Result<TransferReceipt | null>>;
  migrateProject(name: string): Promise<Result<TransferReceipt | null>>;
  activateRestoredProject(): Promise<Result<TransferReceipt | null>>;
  revealUpgradeInstaller(): Promise<Result<void>>;
  listRecent(): Promise<Result<RecentProjectStatus[]>>;
  createNew(name: string): Promise<Result<DirectoryProject | null>>;
  fromFolder(name: string): Promise<Result<DirectoryProject | null>>;
  openExisting(): Promise<Result<DirectoryProject | null>>;
  openRecent(workspaceId: string): Promise<Result<DirectoryProject | null>>;
  configInfo(): Promise<Result<ModelConfigStatus>>;
  openConfig(): Promise<Result<void>>;
  openLegacy(): Promise<Result<void>>;
}
export interface WorkspaceActions {
  exportCreation?(input: ExportCreationInput): Promise<Result<ExportCreationResult>>;
  exportTimeline?(input: ExportTimelineInput): Promise<Result<ExportReceipt>>;
  exportVoice?(input: VoiceExportInput): Promise<Result<VoiceExportReceipt>>;
  cancelTimelineExport?(input: {requestId:string}): Promise<Result<void>>;
  info(): Promise<Result<WorkspaceInfo>>;
  openFolder(): Promise<Result<void>>;
  openLauncher(): Promise<Result<void>>;
  reloadModelConfig(): Promise<Result<ModelConfigStatus>>;
}
declare global { interface Window { projectLauncher: ProjectLauncherBridge } }
