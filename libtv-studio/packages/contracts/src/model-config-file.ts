import { isRevisionRef, type AdapterType, type ParameterValue, type Pricing } from './models.ts';
import { isRecord, type Result } from './result.ts';

export interface RedactedProvider {
  id: string; name: string; kind: 'text' | 'image' | 'video' | 'speech' | 'transcription'; baseURL: string; modelId: string;
  allowPrivateEndpoint: boolean; adapterType: AdapterType; parameters: Record<string, ParameterValue>; pricing: Pricing;
  hasKey: boolean; state: 'ready' | 'unconfigured';
}
export interface PublicModelConfig { source: string; version: string; providers: RedactedProvider[] }
export interface ModelConfigEditorInput { providerId?: string; expectedVersion: string }
export interface ModelList { models: string[]; truncated: boolean }
export interface RemoveModelConfigProviderInput { providerId: string; expectedVersion: string }
export type ModelConfigEditOutcome = { status: 'cancelled' } | { status: 'saved'; synchronization: 'imported' | 'importPending'; version: string };
export interface ModelConfigActions {
  read(): Promise<Result<PublicModelConfig>>;
  edit(input: ModelConfigEditorInput): Promise<Result<ModelConfigEditOutcome>>;
  remove(input: RemoveModelConfigProviderInput): Promise<Result<ModelConfigEditOutcome>>;
  /** Main-only admission barrier; never exposed as a renderer method. */
  ensureCurrent(): Promise<Result<void>>;
}
export function isModelConfigEditorInput(v: unknown, removal = false): v is ModelConfigEditorInput {
  return isRecord(v) && Object.keys(v).every(k => ['providerId','expectedVersion'].includes(k)) && typeof v.expectedVersion === 'string' && /^[a-f0-9]{64}$/.test(v.expectedVersion) && (v.providerId === undefined ? !removal : typeof v.providerId === 'string' && /^[a-zA-Z0-9_-]{1,112}$/.test(v.providerId));
}
/** Stable, secret-free canonical input for the existing file-init SHA-256 receipt ID. */
export function fileImportIdentity(libraryId: string, kind: string, id: string): string {
  return JSON.stringify({ id, kind, libraryId });
}
export function isFileImportReceipt(receipt: unknown, libraryId: string, id: string): boolean {
  return isRecord(receipt) && receipt.libraryId === libraryId && isRevisionRef(receipt.result) && receipt.result.libraryId === libraryId && receipt.result.id === id && receipt.result.revision === 1;
}
