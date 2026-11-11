import type { ExportCreationInput, ExportCreationResult } from './creation-export.ts';
import type { ExportTimelineInput, ExportReceipt } from './timeline-export.ts';
import type { VoiceExportInput, VoiceExportReceipt } from './character-voice.ts';
import { CURRENT_SCHEMA_VERSION } from './schema.ts';
import { isRecord, type Result } from './result.ts';
import { isProject, type ProjectRef } from './projects.ts';
import type { InstanceDescriptor } from './workspace-connection.ts';
import type { CommandEnvelope, CommandMap, CommandReceipt } from './commands.ts';
import type { QueryEnvelope, QueryMap } from './queries.ts';
import type { EventSubscription, EventBatch } from './events.ts';
import type { CredentialRef, CredentialState, CredentialStatus, ConnectionRevisionRef } from './models.ts';
import type { FileGrantRef, MediaReadInput } from './assets.ts';
import type { WorkspaceInfo } from './launcher.ts';
import type { MediaChunk, ReadLease, MediaRuntime, MediaRangeRequest } from './media-info.ts';
import type { DerivedMediaRef } from './render.ts';
import type { PublicModelConfig, ModelConfigEditorInput, RemoveModelConfigProviderInput, ModelConfigEditOutcome } from './model-config-file.ts';
export type CredentialEditorOutcome = { status: 'cancelled' } | { status: 'saved' | 'revoked'; credentialRef: CredentialRef; state: CredentialState };
export interface CredentialEditorInfo { protectionAvailable: boolean; current: CredentialStatus | null }
/** Safe to expose to renderer; raw config and credentials remain main-only. */
export interface ModelConfigStatus {
  source: string;
  providerIds: string[];
  state: 'ready' | 'unconfigured' | 'error';
  errorCode: string | null;
  /** IDs with verified import receipts, including retained historical entries. */
  managedIds?: { connections: string[]; models: string[]; profiles: string[] };
}
export interface CredentialEntryBridge {
  info(): Promise<Result<CredentialEditorInfo>>;
  submit(input: unknown): Promise<Result<CredentialEditorOutcome>>;
  revoke(): Promise<Result<CredentialEditorOutcome>>;
}

export interface EngineIdentity {
  schedulingPaused?: boolean;
  instanceId: string;
  libraryId: string;
  schemaVersion: number;
  nodeVersion: string;
  sqliteVersion: string;
}
export type DesktopDescriptor = InstanceDescriptor;
export interface SubtitleFile { name:string; text:string }
export interface TimelineDraftState { dirty:boolean; token:string }
export function isTimelineDraftState(value:unknown):value is TimelineDraftState { return isRecord(value)&&Object.keys(value).length===2&&typeof value.dirty==='boolean'&&typeof value.token==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value.token); }
export interface DesktopBridge {
  mcpStatus?():Promise<Result<import('./mcp.ts').McpStatus>>;
  mcpConfigure?(input:import('./mcp.ts').McpConfigureInput):Promise<Result<import('./mcp.ts').McpStatus>>;
  mcpSelectImportDirectory?():Promise<Result<import('./mcp.ts').McpStatus>>;
  selectSubtitleFile():Promise<Result<SubtitleFile|null>>;
  setTimelineDraftState(input:TimelineDraftState):Promise<Result<void>>;
  exportCreation(input: ExportCreationInput): Promise<Result<ExportCreationResult>>;
  exportTimeline(input: ExportTimelineInput): Promise<Result<ExportReceipt>>;
  exportVoice(input: VoiceExportInput): Promise<Result<VoiceExportReceipt>>;
  cancelTimelineExport(input: {requestId:string}): Promise<Result<void>>;
  workspaceInfo(): Promise<Result<WorkspaceInfo>>;
  openProjectFolder(): Promise<Result<void>>;
  openProjectLauncher(): Promise<Result<void>>;
  reloadModelConfig(): Promise<Result<ModelConfigStatus>>;
  readModelConfig(): Promise<Result<PublicModelConfig>>;
  openModelConfigEditor(input: ModelConfigEditorInput): Promise<Result<ModelConfigEditOutcome>>;
  removeModelConfigProvider(input: RemoveModelConfigProviderInput): Promise<Result<ModelConfigEditOutcome>>;
  selectImportFiles(): Promise<Result<FileGrantRef | null>>;
  mediaUrl(input: MediaReadInput): Promise<Result<string>>;
  derivedMediaUrl(ref: DerivedMediaRef): Promise<Result<string>>;
  releaseMediaUrl(url: string): Promise<Result<void>>;
  openCredentialEditor(connectionRef: ConnectionRevisionRef): Promise<Result<CredentialEditorOutcome>>;
  describe(): Promise<Result<DesktopDescriptor>>;
  listProjects(): Promise<Result<ProjectRef[]>>;
  createProject(input: unknown): Promise<Result<ProjectRef>>;
  query<K extends keyof QueryMap>(request: QueryEnvelope<K>): Promise<Result<QueryMap[K]['output']>>;
  execute<K extends keyof CommandMap>(command: CommandEnvelope<K>): Promise<Result<CommandReceipt<CommandMap[K]['output']>>>;
  readEvents(request: EventSubscription): Promise<Result<EventBatch>>;
}
export function isIdentity(value: unknown): value is EngineIdentity {
  return isRecord(value) && typeof value.instanceId === 'string' && typeof value.libraryId === 'string' && value.schemaVersion === CURRENT_SCHEMA_VERSION && typeof value.nodeVersion === 'string' && typeof value.sqliteVersion === 'string';
}
export function isDescriptor(value: unknown): value is InstanceDescriptor {
  return isIdentity(value) && isRecord(value) && value.transport === 'utility-process' && value.protocolVersion === 1 && typeof value.connectionEpoch === 'string' && value.connectionEpoch.length > 0 && isRecord(value.capabilities) && ['commands', 'queries', 'events'].every(key => Array.isArray(value.capabilities && (value.capabilities as Record<string, unknown>)[key]) && ((value.capabilities as Record<string, unknown>)[key] as unknown[]).every(item => typeof item === 'string'));
}
export function isResult<T>(value: unknown, validate: (data: unknown) => data is T): value is Result<T> {
  return isRecord(value) && ((value.ok === true && validate(value.value)) || (value.ok === false && isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'));
}
export const isProjectList = (value: unknown): value is ProjectRef[] => Array.isArray(value) && value.every(isProject);
export const isVoid = (value: unknown): value is undefined => value === undefined;
// Internal main/engine message validators. These are deliberately absent from DesktopBridge.
const mediaHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const leaseId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function isMediaRangeRequest(v: unknown): v is MediaRangeRequest { return isRecord(v) && Object.keys(v).length === 3 && leaseId(v.leaseId) && Number.isSafeInteger(v.offset) && (v.offset as number) >= 0 && Number.isSafeInteger(v.length) && (v.length as number) > 0 && (v.length as number) <= 1048576; }
export function isReadLease(v: unknown): v is ReadLease { return isRecord(v) && Object.keys(v).length === 5 && leaseId(v.leaseId) && mediaHash(v.hash) && Number.isSafeInteger(v.byteLength) && (v.byteLength as number) > 0 && (v.byteLength as number) <= 2 * 1024 ** 3 && typeof v.mime === 'string' && v.mime.length <= 64 && Number.isSafeInteger(v.expiresAt); }
export function isMediaChunk(v: unknown): v is MediaChunk { return isRecord(v) && Object.keys(v).length === 4 && leaseId(v.leaseId) && Number.isSafeInteger(v.offset) && (v.offset as number) >= 0 && v.bytes instanceof Uint8Array && v.bytes.byteLength > 0 && v.bytes.byteLength <= 1048576 && typeof v.eof === 'boolean'; }
export function isMediaRuntime(v: unknown): v is MediaRuntime { return isRecord(v) && Object.keys(v).length === 4 && mediaHash(v.runtimeHash) && typeof v.ffmpegPath === 'string' && typeof v.ffprobePath === 'string' && isRecord(v.fontManifest) && v.fontManifest.file === 'NotoSansCJKsc-Regular.otf' && v.fontManifest.family === 'Noto Sans CJK SC' && v.fontManifest.version === 'Sans2.004' && mediaHash(v.fontManifest.sha256); }
