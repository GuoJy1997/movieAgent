import { createHash } from 'node:crypto';
import { isFrozenReferenceAudio, isPreparedGeneration, type PreparedGeneration } from '../../contracts/src/generation.ts';
import { fail, isRecord, ok, type Result } from '../../contracts/src/result.ts';
import type { DispatchContext, ImageProviderAdapter, ProviderContext, ReconcileRequest, ReconcileOutcome, SubmissionOutcome } from './image-provider.ts';
import type { ProviderEvidence } from './probe.ts';
import { isVideoTaskId } from './minimax-video.ts';

export interface VerifiedReferenceBytes { images: Uint8Array[]; audio: Uint8Array[] }
export interface H3RequestBody { model: string; content: ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string }; role: 'reference_image' } | { type: 'audio_url'; audio_url: { url: string }; role: 'reference_audio' })[]; duration: number; resolution: '768P'; ratio: string }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function validateH3Request(input: PreparedGeneration): Result<PreparedGeneration> {
  if (!isPreparedGeneration(input) || input.adapterId !== 'minimax-h3-v2' || input.config.connection.adapterType !== 'minimax-h3-v2' || input.config.model.capabilities.taskTypes[0] !== 'text_to_video') return fail('UNSUPPORTED_PROTOCOL', '需要 minimax-h3-v2 协议。');
  if (input.libraryId !== input.config.connection.libraryId || input.libraryId !== input.config.model.libraryId || input.config.model.connectionRef.libraryId !== input.libraryId || input.config.model.connectionRef.id !== input.config.connection.id || input.config.model.connectionRef.revision !== input.config.connection.revision) return fail('INVALID_PROVIDER_OWNER', '连接归属无效。');
  if (input.prompt.length > 7000) return fail('PROMPT_LIMIT', 'H3 提示词最多7000字符。');
  const p = input.config.parameters;
  if (Object.keys(p).length !== 3 || !Number.isInteger(p.duration) || (p.duration as number) < 4 || (p.duration as number) > 15 || p.resolution !== '768P' || !['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(p.ratio as string)) return fail('UNSUPPORTED_PARAMETERS', 'H3 参考模式需4–15秒、768P和明确画幅。');
  const images = input.referenceImages ?? [], audio = input.referenceAudio ?? [];
  if (!audio.length || audio.length > 3 || images.length > 4 || images.some(ref => ref.role !== 'reference')) return fail('INVALID_REFERENCE', 'H3 需要1–3段参考声音、最多4张 reference 图片；首尾帧请明确改为参考图。');
  if (audio.some(ref => !isFrozenReferenceAudio(ref) || ref.ref.libraryId !== input.libraryId) || audio.reduce((sum, ref) => sum + ref.durationTicks, 0) > 15 * 48000) return fail('INVALID_REFERENCE', '每段声音2–15秒，合计不超过15秒。');
  const bindings = audio.map(ref => ({ characterRef: ref.characterRef, voiceRef: ref.voiceRef }));
  if (input.voiceBindings !== undefined && JSON.stringify(input.voiceBindings) !== JSON.stringify(bindings)) return fail('INVALID_REFERENCE', '角色与声音绑定不一致。');
  const bytes = [...images, ...audio].reduce((sum, ref) => sum + ref.byteLength, 0);
  if (bytes > 32 * 1024 * 1024) return fail('INVALID_REFERENCE', '图片与声音原始输入合计最多32 MiB。');
  return ok(input);
}

export function buildH3Request(input: PreparedGeneration, media: VerifiedReferenceBytes): Result<H3RequestBody> {
  const valid = validateH3Request(input); if (!valid.ok) return valid;
  const images = input.referenceImages ?? [], audio = input.referenceAudio!;
  if (!Array.isArray(media.images) || !Array.isArray(media.audio) || media.images.length !== images.length || media.audio.length !== audio.length) return fail('REFERENCE_INTEGRITY_FAILED', '参考媒体数量不符。');
  if (media.images.some((bytes, i) => !(bytes instanceof Uint8Array) || bytes.byteLength !== images[i]!.byteLength || hash(bytes) !== images[i]!.hash) || media.audio.some((bytes, i) => !(bytes instanceof Uint8Array) || bytes.byteLength !== audio[i]!.byteLength || hash(bytes) !== audio[i]!.hash)) return fail('REFERENCE_INTEGRITY_FAILED', '参考媒体字节或 hash 已改变。');
  const content: H3RequestBody['content'] = [{ type: 'text', text: input.prompt }];
  images.forEach((ref, i) => content.push({ type: 'image_url', image_url: { url: `data:${ref.mime};base64,${Buffer.from(media.images[i]!).toString('base64')}` }, role: 'reference_image' }));
  audio.forEach((_, i) => content.push({ type: 'audio_url', audio_url: { url: `data:audio/wav;base64,${Buffer.from(media.audio[i]!).toString('base64')}` }, role: 'reference_audio' }));
  const p = input.config.parameters;
  return ok({ model: input.config.model.modelId, content, duration: p.duration as number, resolution: '768P', ratio: p.ratio as string });
}
export function h3RequestBytes(input: PreparedGeneration, media: VerifiedReferenceBytes): Result<Buffer> {
  const body = buildH3Request(input, media); if (!body.ok) return body;
  const bytes = Buffer.from(JSON.stringify(body.value));
  return bytes.length <= 48000000 ? ok(bytes) : fail('REFERENCE_REQUEST_LIMIT', 'H3 编码后的请求不能超过48,000,000字节。');
}

export class MiniMaxH3Adapter implements ImageProviderAdapter {
  readonly adapterId = 'minimax-h3-v2';
  private readonly evidence: ProviderEvidence;
  constructor(evidence: ProviderEvidence) { this.evidence = evidence; }
  validate(input: PreparedGeneration): Result<PreparedGeneration> { return validateH3Request(input); }
  async probe(input: PreparedGeneration) { return this.evidence.record(input, { configuration: this.validate(input).ok ? 'valid' : 'invalid' }); }
  async submit(input: PreparedGeneration, context: DispatchContext): Promise<SubmissionOutcome> {
    if (!this.validate(input).ok || !context.requestVideo || context.retries !== 0) return { kind: 'unknown' };
    try {
      const response = await context.requestVideo(input, { attemptId: context.attemptId, outputStagingId: context.outputStagingId, clientRequestId: context.clientRequestId, requestHash: context.requestHash, retries: 0 });
      if ([400, 401, 403, 404, 413, 415, 422, 429].includes(response.status)) return { kind: 'rejected' };
      if (![200, 201, 202].includes(response.status)) return { kind: 'unknown' };
      const data: unknown = JSON.parse(Buffer.from(response.bytes).toString('utf8'));
      return isRecord(data) && isVideoTaskId(data.task_id) ? { kind: 'accepted', providerTaskId: data.task_id } : { kind: 'unknown' };
    } catch { return { kind: 'unknown' }; }
  }
  async reconcile(input: ReconcileRequest, context: ProviderContext): Promise<ReconcileOutcome> {
    if (!isVideoTaskId(input.providerTaskId) || !isPreparedGeneration(input.request) || input.request.adapterId !== this.adapterId) return { kind: 'unsupported' };
    const accepted = { kind: 'accepted' as const, providerTaskId: input.providerTaskId };
    if (!context.queryVideo) return accepted;
    try {
      const response = await context.queryVideo(input.request, input.providerTaskId);
      if (response.status !== 200) return accepted;
      const data: unknown = JSON.parse(Buffer.from(response.bytes).toString('utf8'));
      if (!isRecord(data) || !isRecord(data.task)) return accepted;
      const task = data.task;
      if (task.status === 'failed' || task.status === 'cancelled') return { kind: task.status, providerTaskId: input.providerTaskId };
      if (['pending','queued','processing','running'].includes(task.status as string)) return accepted;
      if (task.status !== 'succeeded') return {kind:'unsupported'};
      if (isRecord(task.content) && typeof task.content.url === 'string' && task.content.url.length <= 8192) {
        try { const url = new URL(task.content.url); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return { kind: 'completed', providerTaskId: input.providerTaskId, output: { kind: 'url', url: task.content.url } }; } catch { /* Invalid output remains unavailable. */ }
      }
      return { kind: 'completed', providerTaskId: input.providerTaskId, output: { kind: 'unavailable', reason: 'INVALID_VIDEO_RESPONSE' } };
    } catch { return accepted; }
  }
}
