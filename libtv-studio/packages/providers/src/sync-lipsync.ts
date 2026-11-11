import { createHash } from 'node:crypto';
import { isPreparedGeneration, type PreparedGeneration } from '../../contracts/src/generation.ts';
import { fail, isRecord, ok, type Result } from '../../contracts/src/result.ts';
import type { DispatchContext, ImageProviderAdapter, ProviderContext, ReconcileRequest, ReconcileOutcome, SubmissionOutcome } from './image-provider.ts';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const taskId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value);
/** Only the approved official contract is currently supported; adapter labels confer no contract. */
export function hasVerifiedSyncReplayContract(input:PreparedGeneration):boolean {
  try {const url=new URL(input.config.connection.baseUrl);return input.adapterId==='sync-lipsync-v2'&&input.config.connection.adapterType==='sync-lipsync-v2'&&url.origin==='https://api.sync.so'&&['','/','/v2'].includes(url.pathname)&&!url.search&&!url.hash&&!url.username&&!url.password&&input.config.connection.networkPolicy.privateEndpoint===null;}catch{return false;}
}
export function validateLipSyncInput(input: PreparedGeneration): Result<PreparedGeneration> {
  if (!isPreparedGeneration(input) || input.adapterId !== 'sync-lipsync-v2' || input.config.connection.adapterType !== 'sync-lipsync-v2' || input.config.model.capabilities.taskTypes[0] !== 'lip_sync') return fail('UNSUPPORTED_PROTOCOL', '需要 sync-lipsync-v2 协议。');
  const video = input.lipSyncVideo, audio = input.lipSyncAudio;
  if (!video || !audio || video.ref.libraryId !== input.libraryId || audio.ref.libraryId !== input.libraryId || video.byteLength > 64 * 1024 * 1024 || audio.byteLength > 4 * 1024 * 1024 || video.byteLength + audio.byteLength > 68 * 1024 * 1024) return fail('INVALID_REFERENCE', '口型输入视频或音频超出固定上限。');
  if (audio.durationTicks > video.durationTicks) return fail('AUDIO_TOO_LONG', '配音长于视频，请改台词、重配或选择更长视频。');
  return ok(input);
}
export function buildLipSyncMultipart(input: PreparedGeneration, bytes: { video: Uint8Array; audio: Uint8Array }, boundary: string): Result<Buffer> {
  const valid = validateLipSyncInput(input); if (!valid.ok) return valid;
  if (!(bytes.video instanceof Uint8Array) || !(bytes.audio instanceof Uint8Array) || hash(bytes.video) !== input.lipSyncVideo!.hash || hash(bytes.audio) !== input.lipSyncAudio!.hash) return fail('REFERENCE_INTEGRITY_FAILED', '口型输入字节已改变。');
  const chunks: Buffer[] = [];
  const field = (name: string, value: string) => chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  const file = (name: string, filename: string, mime: string, bytes: Uint8Array) => { chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`), Buffer.from(bytes), Buffer.from('\r\n')); };
  field('model', input.config.model.modelId);
  field('options', JSON.stringify({ sync_mode: 'cut_off' }));
  file('video', 'video.mp4', 'video/mp4', bytes.video);
  file('audio', 'audio.wav', 'audio/wav', bytes.audio);
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return ok(Buffer.concat(chunks));
}

export type LipSyncByteSource = Uint8Array | AsyncIterable<Uint8Array>;
export function streamLipSyncMultipart(input: PreparedGeneration, bytes: { video: LipSyncByteSource; audio: LipSyncByteSource }, boundary: string): Result<{ body: AsyncIterable<Uint8Array>; byteLength: number }> {
  const valid = validateLipSyncInput(input); if (!valid.ok) return valid;
  const beforeVideo = `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${input.config.model.modelId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify({ sync_mode: 'cut_off' })}\r\n--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="video.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
  const beforeAudio = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`;
  const ending = `\r\n--${boundary}--\r\n`;
  async function* body(): AsyncIterable<Uint8Array> {
    yield Buffer.from(beforeVideo);
    if (bytes.video instanceof Uint8Array) yield bytes.video;
    else for await (const chunk of bytes.video) yield chunk;
    yield Buffer.from(beforeAudio);
    if (bytes.audio instanceof Uint8Array) yield bytes.audio;
    else for await (const chunk of bytes.audio) yield chunk;
    yield Buffer.from(ending);
  }
  return ok({ body: body(), byteLength: Buffer.byteLength(beforeVideo) + input.lipSyncVideo!.byteLength + Buffer.byteLength(beforeAudio) + input.lipSyncAudio!.byteLength + Buffer.byteLength(ending) });
}

export class SyncLipSyncAdapter implements ImageProviderAdapter {
  readonly adapterId = 'sync-lipsync-v2';
  validate(input: PreparedGeneration): Result<PreparedGeneration> { return validateLipSyncInput(input); }
  async submit(input: PreparedGeneration, context: DispatchContext): Promise<SubmissionOutcome> {
    if (!this.validate(input).ok || !context.requestLipSync || context.retries !== 0) return { kind: 'unknown' };
    try {
      const response = await context.requestLipSync(input, { attemptId: context.attemptId, outputStagingId: context.outputStagingId, clientRequestId: context.clientRequestId, requestHash: context.requestHash, retries: 0 }, { video: new Uint8Array(), audio: new Uint8Array() });
      if ([409, 503].includes(response.status) && input.providerTaskId) return { kind: 'accepted', providerTaskId: input.providerTaskId };
      if (![200, 201].includes(response.status)) return { kind: 'unknown' };
      const data: unknown = JSON.parse(Buffer.from(response.bytes).toString('utf8'));
      return isRecord(data) && taskId(data.id) ? { kind: 'accepted', providerTaskId: data.id } : { kind: 'unknown' };
    } catch { return { kind: 'unknown' }; }
  }
  async reconcile(input: ReconcileRequest, context: ProviderContext): Promise<ReconcileOutcome> {
    if (input.providerTaskId === null && context.allowUnknownSubmission && isPreparedGeneration(input.request) && hasVerifiedSyncReplayContract(input.request)) {
      const outputStagingId = input.outputStagingId ?? `${input.request.preparedId}-output`;
      return this.submit(input.request, { ...context,requestLipSync:context.requestLipSyncReconcile??context.requestLipSync, attemptId: outputStagingId.slice(0, -7), outputStagingId, clientRequestId: input.clientRequestId, requestHash: createHash('sha256').update(JSON.stringify(input.request)).digest('hex'), retries: 0 });
    }
    if (!taskId(input.providerTaskId) || !isPreparedGeneration(input.request) || input.request.adapterId !== this.adapterId) return { kind: 'unsupported' };
    const accepted = { kind: 'accepted' as const, providerTaskId: input.providerTaskId };
    if (!context.queryLipSync) return accepted;
    try {
      const response = await context.queryLipSync(input.request, input.providerTaskId);
      if ([409, 503].includes(response.status)) return accepted;
      if (response.status !== 200) return accepted;
      const data: unknown = JSON.parse(Buffer.from(response.bytes).toString('utf8'));
      if (!isRecord(data) || data.id !== input.providerTaskId) return accepted;
      if (data.status === 'FAILED' || data.status === 'REJECTED') return { kind: 'failed', providerTaskId: input.providerTaskId };
      if (data.status !== 'COMPLETED') return accepted;
      if (isRecord(data.output) && typeof data.output.url === 'string' && data.output.url.length <= 8192) {
        try { const url = new URL(data.output.url); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return { kind: 'completed', providerTaskId: input.providerTaskId, output: { kind: 'url', url: data.output.url } }; } catch { /* Invalid output remains unavailable. */ }
      }
      return { kind: 'completed', providerTaskId: input.providerTaskId, output: { kind: 'unavailable', reason: 'INVALID_LIPSYNC_RESPONSE' } };
    } catch { return accepted; }
  }
}
