import { isPreparedGeneration, type PreparedGeneration } from '../../contracts/src/generation.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { validateReferenceImages } from '../../domain/src/reference-inputs.ts';
import { encodeTextRequest, extractTextResponse, isTextProtocol } from './text-protocol.ts';
import { OpenAIImagesAdapter } from './openai-images.ts';
import type { ArtifactSource } from './artifact-source.ts';
import type { ProviderEvidence } from './probe.ts';
import type { DispatchContext, SubmissionOutcome } from './image-provider.ts';
export function textRequestBody(input: PreparedGeneration): Result<Buffer> {
  if (!isPreparedGeneration(input) || !isTextProtocol(input.adapterId) || input.config.connection.adapterType !== input.adapterId || input.config.model.capabilities.taskTypes[0] !== 'text_to_text') return fail('UNSUPPORTED_PROTOCOL', '需要 openai-chat-v1 协议。');
  const c = input.config, p = c.parameters;
  if (input.libraryId !== c.connection.libraryId || c.model.connectionRef.id !== c.connection.id || c.model.connectionRef.revision !== c.connection.revision || c.model.connectionRef.libraryId !== input.libraryId) return fail('INVALID_PROVIDER_OWNER', '连接归属无效。');
  const refs = validateReferenceImages(input); if (!refs.ok) return refs;
  return encodeTextRequest(c.connection.adapterType,c.model.modelId,input.prompt,p);
}
export class OpenAIChatAdapter extends OpenAIImagesAdapter {
  override readonly adapterId: string = 'openai-chat-v1';
  private readonly textSpool: ArtifactSource;
  constructor(textSpool: ArtifactSource, evidence: ProviderEvidence) { super(textSpool, evidence); this.textSpool = textSpool; }
  override validate(input: PreparedGeneration) { const valid = textRequestBody(input); return valid.ok ? ok(input) : valid; }
  override async submit(input: PreparedGeneration, context: DispatchContext): Promise<SubmissionOutcome> {
    if (!this.validate(input).ok) return { kind: 'rejected' };
    if (!context.requestText || context.retries !== 0) return { kind: 'unknown' };
    let response;
    try { response = await context.requestText(input, { attemptId: context.attemptId, outputStagingId: context.outputStagingId, clientRequestId: context.clientRequestId, requestHash: context.requestHash, retries: 0 }); }
    catch { return { kind: 'unknown' }; }
    if ([400,401,403,404,413,415,422,429].includes(response.status)) return { kind: 'rejected' };
    if (response.status !== 200) return { kind: 'unknown' };
    const completed = { kind: 'completed' as const, providerTaskId: context.clientRequestId };
    const invalid = { ...completed, output: { kind: 'unavailable' as const, reason: 'INVALID_TEXT_RESPONSE' } };
    try {
      const extracted=extractTextResponse(input.config.connection.adapterType as 'openai-chat-v1'|'anthropic-messages-v1',response.bytes);if(!extracted.ok)return invalid;
      const bytes=extracted.value;
      const staged = await this.textSpool.stage(context.outputStagingId, bytes);
      return staged.ok ? { ...completed, sourceRef: staged.value } : { ...completed, output: { kind: 'unavailable', reason: staged.error.code } };
    } catch { return invalid; }
  }
}

export class AnthropicMessagesAdapter extends OpenAIChatAdapter { override readonly adapterId = 'anthropic-messages-v1'; }
