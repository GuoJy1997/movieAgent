import { validateReferenceImages, verifyReferenceBytes } from '../../domain/src/reference-inputs.ts';
import { isPreparedGeneration, type PreparedGeneration } from '../../contracts/src/generation.ts';
import { fail, isRecord, ok, type Result } from '../../contracts/src/result.ts';
import { LocalInputUnavailable, type DispatchContext, type ImageProviderAdapter, type ProviderContext, type ReconcileRequest, type ReconcileOutcome, type SubmissionOutcome } from './image-provider.ts';
import type { ProviderEvidence } from './probe.ts';

export const isVideoTaskId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(v);
/** Query only the accepted identity; evolving submission limits cannot invalidate its frozen inputs. */
export function validateVideoQuery(input: PreparedGeneration): Result<PreparedGeneration> {
  if (!isPreparedGeneration(input) || input.adapterId !== 'minimax-video-v2' || input.config.connection.adapterType !== 'minimax-video-v2' || input.config.model.capabilities.taskTypes[0] !== 'text_to_video') return fail('UNSUPPORTED_PROTOCOL', '需要 minimax-video-v2 视频协议。');
  const c = input.config;
  if (input.libraryId !== c.connection.libraryId || input.libraryId !== c.model.libraryId || c.model.connectionRef.libraryId !== input.libraryId || c.model.connectionRef.id !== c.connection.id || c.model.connectionRef.revision !== c.connection.revision) return fail('INVALID_PROVIDER_OWNER', '连接归属无效。');
  return ok(input);
}
export function validateVideoRequest(input: PreparedGeneration): Result<PreparedGeneration> {
  const valid = validateVideoQuery(input); if (!valid.ok) return valid;
  if (input.prompt.length > 7000) return fail('PROMPT_LIMIT', 'MiniMax 视频提示词最多7000字符。');
  const p = input.config.parameters;
  if (Object.keys(p).length !== 3 || !['duration','resolution','ratio'].every(k => Object.hasOwn(p, k)) || typeof p.duration !== 'number' || !Number.isInteger(p.duration) || p.duration < 4 || p.duration > 15 || p.resolution !== '768P' || !['adaptive','21:9','16:9','4:3','1:1','3:4','9:16'].includes(p.ratio as string)) return fail('UNSUPPORTED_PARAMETERS', '视频需使用 4–15 秒、768P 与受支持画幅。');
  const refs = validateReferenceImages(input); return refs.ok ? ok(input) : refs;
}
export function videoRequestBody(input: PreparedGeneration, bytes: Uint8Array[] = []): Result<Buffer> {
  const valid = validateVideoRequest(input); if (!valid.ok) return valid;
  const checked = verifyReferenceBytes(input, bytes); if (!checked.ok) return checked;
  const content: unknown[] = [{ type: 'text', text: input.prompt }];
  (input.referenceImages ?? []).forEach((ref, index) => content.push({ type: 'image_url', image_url: { url: `data:${ref.mime};base64,${Buffer.from(checked.value[index]!).toString('base64')}` }, role: ref.role === 'reference' ? 'reference_image' : ref.role }));
  const p = input.config.parameters;
  return ok(Buffer.from(JSON.stringify({ model: input.config.model.modelId, content, duration: p.duration, resolution: p.resolution, ratio: p.ratio })));
}
/** Native asynchronous protocol. An ambiguous POST is never repeated. */
export class MiniMaxVideoAdapter implements ImageProviderAdapter {
  readonly adapterId = 'minimax-video-v2';
  private readonly evidence: ProviderEvidence;
  constructor(evidence: ProviderEvidence) { this.evidence = evidence; }
  validate(input: PreparedGeneration): Result<PreparedGeneration> { const result = validateVideoRequest(input); return result.ok ? ok(input) : result; }
  async probe(input: PreparedGeneration, _context: ProviderContext) { return this.evidence.record(input, { configuration: this.validate(input).ok ? 'valid' : 'invalid' }); }
  private record(input: PreparedGeneration, change: Parameters<ProviderEvidence['record']>[1]) { try { this.evidence.record(input, change); } catch { /* Evidence cannot erase the authoritative provider outcome. */ } }
  async submit(input: PreparedGeneration, context: DispatchContext): Promise<SubmissionOutcome> {
    if (!this.validate(input).ok) return { kind: 'rejected' };
    if (!context.requestVideo || context.retries !== 0) return { kind: 'unknown' };
    this.record(input, { configuration: 'valid' });
    try {
      const response = await context.requestVideo(input, { attemptId: context.attemptId, outputStagingId: context.outputStagingId, clientRequestId: context.clientRequestId, requestHash: context.requestHash, retries: 0 });
      if ([400,401,403,404,413,415,422,429].includes(response.status)) {
        if (context.evidence === 'real' && [401,403].includes(response.status)) this.record(input, { authentication: 'rejected' });
        return { kind: 'rejected' };
      }
      if (response.status !== 200 && response.status !== 201 && response.status !== 202) return { kind: 'unknown' };
      const data: unknown = JSON.parse(Buffer.from(response.bytes).toString('utf8'));
      if (!isRecord(data) || !isVideoTaskId(data.task_id)) return { kind: 'unknown' };
      if (context.evidence === 'real') this.record(input, { authentication: 'accepted' });
      return { kind: 'accepted', providerTaskId: data.task_id };
    } catch (error) { return { kind: error instanceof LocalInputUnavailable ? 'rejected' : 'unknown' }; }
  }
  async reconcile(input: ReconcileRequest, context: ProviderContext): Promise<ReconcileOutcome> {
    if (!isVideoTaskId(input.providerTaskId) || !validateVideoQuery(input.request).ok) return { kind: 'unsupported' };
    const providerTaskId = input.providerTaskId, accepted = { kind: 'accepted' as const, providerTaskId };
    if (!context.queryVideo) return accepted;
    try {
      const response = await context.queryVideo(input.request, providerTaskId);
      if (response.status !== 200) return accepted;
      const data: unknown = JSON.parse(Buffer.from(response.bytes).toString('utf8'));
      if (!isRecord(data) || !isRecord(data.task) || data.task.id !== undefined && data.task.id !== providerTaskId) return accepted;
      const task = data.task;
      if (task.status === 'failed' || task.status === 'cancelled') return { kind: task.status, providerTaskId };
      if (task.status !== 'succeeded') return accepted;
      if (isRecord(task.content) && typeof task.content.url === 'string' && task.content.url.length <= 8192) {
        try {
          const url = new URL(task.content.url);
          if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return { kind: 'completed', providerTaskId, output: { kind: 'url', url: task.content.url } };
        } catch { /* A malformed output does not undo the known terminal provider state. */ }
      }
      return { kind: 'completed', providerTaskId, output: { kind: 'unavailable', reason: 'INVALID_VIDEO_RESPONSE' } };
    } catch { return accepted; }
  }
}
