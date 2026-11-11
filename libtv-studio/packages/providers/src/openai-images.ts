import { isPreparedGeneration, type PreparedGeneration } from '../../contracts/src/generation.ts';
import { fail, isRecord, ok, type Result } from '../../contracts/src/result.ts';
import type { DispatchContext, ImageProviderAdapter, ProviderContext, ReconcileRequest, SubmissionOutcome } from './image-provider.ts';
import type { ArtifactSource } from './artifact-source.ts';
import type { ProviderEvidence, ProbeResult } from './probe.ts';
import { validateReferenceImages } from '../../domain/src/reference-inputs.ts';
import { MAX_IMAGE_BYTES } from './http-transport.ts';
/** Versioned synchronous GPT Image-compatible subset, not a generic HTTP template. */
export function imageRequestBody(input: PreparedGeneration): Result<Buffer> {
  if (!isPreparedGeneration(input) || input.adapterId !== 'openai-image-v1' || input.config.connection.adapterType !== 'openai-image-v1')
    return fail('UNSUPPORTED_PROTOCOL', '需要 openai-image-v1 图像生成协议。');
  const references = validateReferenceImages(input); if (!references.ok) return references;
  const c = input.config, p = c.parameters;
  if (input.libraryId !== c.connection.libraryId || c.model.connectionRef.id !== c.connection.id || c.model.connectionRef.revision !== c.connection.revision || c.model.connectionRef.libraryId !== input.libraryId)
    return fail('INVALID_PROVIDER_OWNER', '连接归属无效。');
  if (Object.keys(p).some(k => !['size', 'quality'].includes(k)) || p.size !== undefined && !['1024x1024', '1024x1536', '1536x1024'].includes(p.size as string) || p.quality !== undefined && !['auto', 'low', 'medium', 'high'].includes(p.quality as string))
    return fail('UNSUPPORTED_PARAMETERS', '此协议只支持指定尺寸与 auto/low/medium/high 质量；不支持 seed、style 或批量。');
  return ok(Buffer.from(JSON.stringify({ model: c.model.modelId, prompt: input.prompt, n: 1, output_format: 'png', ...p })));
}
export class OpenAIImagesAdapter implements ImageProviderAdapter {
  readonly adapterId: string = 'openai-image-v1';
  private readonly spool: ArtifactSource;
  private readonly evidence: ProviderEvidence;
  constructor(spool: ArtifactSource, evidence: ProviderEvidence) { this.spool = spool; this.evidence = evidence; }
  validate(input: PreparedGeneration): Result<PreparedGeneration> { const result = imageRequestBody(input); return result.ok ? ok(input) : result; }
  async probe(input: PreparedGeneration, _context: ProviderContext): Promise<ProbeResult> { return this.evidence.record(input, { configuration: this.validate(input).ok ? 'valid' : 'invalid' }); }
  protected transport(input: PreparedGeneration, context: DispatchContext) {
    if (!context.requestImage) throw Error('PROVIDER_UNAVAILABLE');
    return context.requestImage(input, { attemptId: context.attemptId, outputStagingId: context.outputStagingId, clientRequestId: context.clientRequestId, requestHash: context.requestHash, retries: 0 });
  }
  async submit(input: PreparedGeneration, context: DispatchContext): Promise<SubmissionOutcome> {
    if (!this.validate(input).ok)
      return { kind: 'rejected' };
    try {
      this.evidence.record(input, { configuration: 'valid' });
    }
    catch { /* Evidence failure cannot authorize a new submission or erase its outcome. */ }
    if (context.retries !== 0)
      return { kind: 'unknown' };
    let response;
    try {
      response = await this.transport(input, context);
    }
    catch {
      return { kind: 'unknown' };
    }
    const fixture = context.evidence !== 'real';
    // Evidence cannot alter the authoritative paid response if persistence fails.
    const record = (change: Parameters<ProviderEvidence['record']>[1]) => {
      try { this.evidence.record(input, change); }
      catch { /* Completion still must reach the task fact journal. */ }
    };
    if ([400, 401, 403, 404, 413, 415, 422, 429].includes(response.status)) {
      if (!fixture && [401, 403].includes(response.status))
        record({ authentication: 'rejected' });
      return { kind: 'rejected' };
    }
    if (response.status !== 200)
      return { kind: 'unknown' };
    const completed = { kind: 'completed' as const, providerTaskId: context.clientRequestId };
    try {
      const parsed: unknown = JSON.parse(Buffer.from(response.bytes).toString('utf8'));
      if (!isRecord(parsed) || !Array.isArray(parsed.data) || parsed.data.length !== 1 || !isRecord(parsed.data[0]))
        return { ...completed, output: { kind: 'unavailable', reason: 'INVALID_IMAGE_RESPONSE' } };
      const item = parsed.data[0];
      if (typeof item.b64_json === 'string' && item.url === undefined) {
        const encoded = item.b64_json;
        const invalidEncoding = !encoded.length || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
          encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded);
        if (invalidEncoding)
          return { ...completed, output: { kind: 'unavailable', reason: 'INVALID_IMAGE_BASE64' } };
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.toString('base64') !== encoded)
          return { ...completed, output: { kind: 'unavailable', reason: 'INVALID_IMAGE_BASE64' } };
        const staged = await this.spool.stage(context.outputStagingId, bytes);
        if (!staged.ok)
          return { ...completed, output: { kind: 'unavailable', reason: staged.error.code } };
        record(fixture ? { fixtureGeneration: true } : { authentication: 'accepted' });
        return { ...completed, sourceRef: staged.value };
      }
      if (typeof item.url === 'string' && item.b64_json === undefined && item.url.length <= 8192) {
        const url = new URL(item.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
          throw Error();
        // A URL descriptor proves completion, not that a decodable image has been collected.
        return { ...completed, output: { kind: 'url', url: item.url } };
      }
      return { ...completed, output: { kind: 'unavailable', reason: 'INVALID_IMAGE_RESPONSE' } };
    }
    catch {
      return { ...completed, output: { kind: 'unavailable', reason: 'INVALID_IMAGE_RESPONSE' } };
    }
  }
  async reconcile(input: ReconcileRequest, _context: ProviderContext): Promise<SubmissionOutcome | {
    kind: 'unsupported';
  }> {
    // This is local durable-output recovery, never a fabricated remote status lookup.
    if (input.outputStagingId) {
      const recovered = await this.spool.recover(input.outputStagingId);
      if (recovered.ok)
        return { kind: 'completed', providerTaskId: input.clientRequestId, sourceRef: recovered.value };
    }
    return { kind: 'unsupported' };
  }
}
