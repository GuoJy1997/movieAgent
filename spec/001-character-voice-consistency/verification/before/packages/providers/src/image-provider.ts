import { isAbsolute } from 'node:path';
import { isRecord } from '../../contracts/src/result.ts';
import type { Result } from '../../contracts/src/result.ts';
import type { PreparedGeneration } from '../../contracts/src/generation.ts';
import type { FileSourceRef } from '../../storage/src/collection-journal.ts';
export type FrozenImageRequest = PreparedGeneration;
export type ValidatedImageRequest = PreparedGeneration;
/** Granted by the engine/host. Task6 extends this with a restricted credential/transport capability. */
export interface ImageDispatchIdentity { attemptId: string; outputStagingId: string; clientRequestId: string; requestHash: string; retries: 0 }
export interface ProviderContext { readonly signal?: AbortSignal; readonly evidence?: 'fixture' | 'real'; readonly allowUnknownSubmission?: boolean; readonly requestImage?: (input: FrozenImageRequest, dispatch: ImageDispatchIdentity) => Promise<import('./http-transport.ts').HttpResponse>; readonly requestText?: (input: PreparedGeneration, dispatch: ImageDispatchIdentity) => Promise<import('./http-transport.ts').HttpResponse>; readonly requestImageEdit?: (input: PreparedGeneration, dispatch: ImageDispatchIdentity, bytes?: Uint8Array[]) => Promise<import('./http-transport.ts').HttpResponse>; readonly requestVideo?: (input: PreparedGeneration, dispatch: ImageDispatchIdentity, bytes?: Uint8Array[], audioBytes?: Uint8Array[]) => Promise<import('./http-transport.ts').HttpResponse>; readonly queryVideo?: (input: PreparedGeneration, providerTaskId: string) => Promise<import('./http-transport.ts').HttpResponse>; readonly requestLipSync?: (input: PreparedGeneration, dispatch: ImageDispatchIdentity, bytes: { video: Uint8Array | AsyncIterable<Uint8Array>; audio: Uint8Array | AsyncIterable<Uint8Array> }) => Promise<import('./http-transport.ts').HttpResponse>; readonly queryLipSync?: (input: PreparedGeneration, providerTaskId: string) => Promise<import('./http-transport.ts').HttpResponse> }
export interface AudioProviderContext { readonly requestAudio?: (input: PreparedGeneration, dispatch: ImageDispatchIdentity, bytes?: Uint8Array) => Promise<import('./http-transport.ts').HttpResponse> }
export interface ProviderContext extends AudioProviderContext {}
/** Privileged explicit recovery capability; never inferred by normal submission. */
export interface ProviderContext {readonly requestLipSyncReconcile?:ProviderContext['requestLipSync']}
export interface DispatchContext extends ProviderContext { readonly attemptId: string; readonly outputStagingId: string; readonly clientRequestId: string; readonly requestHash: string; readonly retries: 0 }
export type ImageOutput = { kind: 'url'; url: string } | { kind: 'unavailable'; reason: string };
export type SubmissionOutcome = ({ kind: 'completed'; providerTaskId: string } & ({ sourceRef: FileSourceRef; output?: never } | { output: ImageOutput; sourceRef?: never })) | { kind: 'accepted' | 'failed' | 'cancelled'; providerTaskId: string } | { kind: 'rejected' } | { kind: 'unknown' };
export interface ReconcileRequest { clientRequestId: string; providerTaskId: string | null; request: FrozenImageRequest; outputStagingId?: string }
export type ReconcileOutcome = SubmissionOutcome | { kind: 'unsupported' };
export interface ImageProviderAdapter {
  readonly adapterId: string;
  validate(input: FrozenImageRequest): Result<ValidatedImageRequest>;
  probe?(input: FrozenImageRequest, context: ProviderContext): Promise<import('./probe.ts').ProbeResult>;
  submit(input: ValidatedImageRequest, context: DispatchContext): Promise<SubmissionOutcome>;
  reconcile(input: ReconcileRequest, context: ProviderContext): Promise<ReconcileOutcome>;
}

/** Adapters normalize protocol data, and the engine still validates the resulting external fact. */
export function isSubmissionOutcome(v: unknown): v is SubmissionOutcome {
  if (!isRecord(v) || typeof v.kind !== 'string') return false;
  if (v.kind === 'unknown' || v.kind === 'rejected') return Object.keys(v).length === 1;
  if (!['accepted','completed','failed','cancelled'].includes(v.kind) || typeof v.providerTaskId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,256}$/.test(v.providerTaskId)) return false;
  if (v.kind !== 'completed') return Object.keys(v).length === 2;
  if (Object.keys(v).length !== 3) return false;
  const source = v.sourceRef;
  if (isRecord(source)) return ['path','realPath','allowedRoot'].every(k => typeof source[k] === 'string' && isAbsolute(source[k] as string)) && typeof source.name === 'string' && ['size','mtimeMs','dev','ino'].every(k => typeof source[k] === 'number' && Number.isFinite(source[k]) && (source[k] as number) >= 0);
  if (!isRecord(v.output)) return false;
  if (v.output.kind === 'unavailable') return Object.keys(v.output).length === 2 && typeof v.output.reason === 'string' && v.output.reason.length <= 200;
  if (v.output.kind !== 'url' || Object.keys(v.output).length !== 2 || typeof v.output.url !== 'string' || v.output.url.length > 8192) return false;
  try { const url = new URL(v.output.url); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
