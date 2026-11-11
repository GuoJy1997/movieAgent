import { isPreparedGeneration, type PreparedGeneration } from '../../contracts/src/generation.ts';
import { fail, isRecord } from '../../contracts/src/result.ts';
import { ArtifactSource } from './artifact-source.ts';
import { normalizeTranscript, isSpeechProtocol, validateAudioRequest } from './audio-protocol.ts';
import type { DispatchContext, ImageProviderAdapter, ProviderContext, ReconcileRequest, SubmissionOutcome } from './image-provider.ts';

/** Audio POSTs are never retried. Only the local immutable spool can reconcile them. */
export class AudioAdapter implements ImageProviderAdapter {
  readonly adapterId: string;
  private readonly spool: ArtifactSource;
  private readonly metadataSpool?: ArtifactSource;

  constructor(adapterId: string, spool: ArtifactSource, metadataSpool?: ArtifactSource) {
    this.adapterId = adapterId;
    this.spool = spool;
    this.metadataSpool = metadataSpool;
  }
  validate(input: PreparedGeneration) {
    return isPreparedGeneration(input) ? validateAudioRequest(input, this.adapterId) : fail('INVALID_AUDIO_CONFIG', '固定音频计划无效。');
  }
  async submit(input: PreparedGeneration, context: DispatchContext): Promise<SubmissionOutcome> {
    if (!this.validate(input).ok) return { kind: 'rejected' };
    if (!context.requestAudio || context.retries !== 0) return { kind: 'unknown' };
    let response;
    try { response = await context.requestAudio(input, { attemptId: context.attemptId, outputStagingId: context.outputStagingId, clientRequestId: context.clientRequestId, requestHash: context.requestHash, retries: 0 }); }
    catch { return { kind: 'unknown' }; }
    if ([400, 401, 403, 404, 413, 415, 422, 429].includes(response.status)) return { kind: 'rejected' };
    if (response.status !== 200) return { kind: 'unknown' };
    let nativeBody: Record<string, unknown> | undefined;
    if (this.adapterId === 'minimax-speech-v1' || this.adapterId === 'minimax-transcription-v1') {
      // An unreadable acknowledgement cannot establish a terminal paid-POST fact.
      try {
        const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
        if (!isRecord(body)) return { kind: 'unknown' };
        nativeBody = body;
        // Native ASR also permits successful text JSON without a base_resp field.
        if (this.adapterId === 'minimax-speech-v1' || 'base_resp' in body) {
          if (!isRecord(body.base_resp) || !Number.isSafeInteger(body.base_resp.status_code)) return { kind: 'unknown' };
          if (body.base_resp.status_code !== 0) return { kind: 'rejected' };
        }
      } catch {
        return { kind: 'unknown' };
      }
    }
    const completed = { kind: 'completed' as const, providerTaskId: context.clientRequestId };
    try {
      let bytes = Buffer.from(response.bytes);
      if (this.adapterId === 'minimax-speech-v1') {
        const body = nativeBody!;
        const hex = isRecord(body.data) ? body.data.audio : undefined;
        if (typeof hex !== 'string' || !hex.length || hex.length % 2 || !/^[a-fA-F0-9]+$/.test(hex)) throw Error('INVALID_AUDIO_HEX');
        bytes = Buffer.from(hex, 'hex');
        if (this.metadataSpool && isRecord(body.extra_info) && Number.isSafeInteger(body.extra_info.usage_characters) && (body.extra_info.usage_characters as number) >= 0) {
          await this.metadataSpool.stage(context.outputStagingId + '-usage', Buffer.from(JSON.stringify({ usageCharacters: body.extra_info.usage_characters })));
        }
      }
      if (!isSpeechProtocol(this.adapterId)) {
        const body: unknown = nativeBody ?? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        const transcript = normalizeTranscript(isRecord(body) && isRecord(body.data) ? body.data : body, input.audioSource!.durationTicks);
        // Preserve raw valid UTF-8 response for diagnostics even when timestamps are invalid.
        if (!transcript.ok) {
          const staged = await this.spool.stage(context.outputStagingId, bytes);
          return staged.ok ? { ...completed, sourceRef: staged.value } : { ...completed, output: { kind: 'unavailable', reason: staged.error.code } };
        }
      }
      const staged = await this.spool.stage(context.outputStagingId, bytes);
      return staged.ok ? { ...completed, sourceRef: staged.value } : { ...completed, output: { kind: 'unavailable', reason: staged.error.code } };
    } catch { return { ...completed, output: { kind: 'unavailable', reason: 'INVALID_AUDIO_RESPONSE' } }; }
  }
  async reconcile(input: ReconcileRequest, _context: ProviderContext): Promise<SubmissionOutcome | { kind: 'unsupported' }> {
    if (input.outputStagingId) {
      const source = await this.spool.recover(input.outputStagingId);
      if (source.ok) return { kind: 'completed', providerTaskId: input.clientRequestId, sourceRef: source.value };
    }
    return { kind: 'unsupported' };
  }
}
