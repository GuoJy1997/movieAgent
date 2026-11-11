import { randomUUID } from 'node:crypto';
import { isPreparedGeneration, type PreparedGeneration } from '../../contracts/src/generation.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { validateReferenceImages, verifyReferenceBytes } from '../../domain/src/reference-inputs.ts';
import { OpenAIImagesAdapter } from './openai-images.ts';
import type { DispatchContext } from './image-provider.ts';
export function validateImageEdit(input: PreparedGeneration): Result<PreparedGeneration> {
  if (!isPreparedGeneration(input) || input.adapterId !== 'openai-image-edit-v1' || input.config.connection.adapterType !== 'openai-image-edit-v1' || input.config.model.capabilities.taskTypes[0] !== 'image_to_image') return fail('UNSUPPORTED_PROTOCOL', '需要 openai-image-edit-v1 协议。');
  const c = input.config, p = c.parameters;
  if (input.libraryId !== c.connection.libraryId || c.model.connectionRef.id !== c.connection.id || c.model.connectionRef.revision !== c.connection.revision || c.model.connectionRef.libraryId !== input.libraryId) return fail('INVALID_PROVIDER_OWNER', '连接归属无效。');
  if (Object.keys(p).some(k => !['size','quality'].includes(k)) || p.size !== undefined && !['1024x1024','1024x1536','1536x1024'].includes(p.size as string) || p.quality !== undefined && !['auto','low','medium','high'].includes(p.quality as string)) return fail('UNSUPPORTED_PARAMETERS', '图像编辑只支持指定 size/quality。');
  const refs = validateReferenceImages(input); return refs.ok ? ok(input) : refs;
}
export function imageEditRequestBody(input: PreparedGeneration, bytes: Uint8Array[]): Result<{ body: Buffer; contentType: string }> {
  const valid = validateImageEdit(input); if (!valid.ok) return valid;
  const checked = verifyReferenceBytes(input, bytes); if (!checked.ok) return checked;
  const boundary = 'movieagent-' + randomUUID(), chunks: Buffer[] = [];
  const add = (text: string) => chunks.push(Buffer.from(text));
  for (const [name, value] of Object.entries({ model: input.config.model.modelId, prompt: input.prompt, n: 1, output_format: 'png', ...input.config.parameters })) add(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  checked.value.forEach((data, index) => { const mime = input.referenceImages![index]!.mime; add(`--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference-${index}.${mime === 'image/jpeg' ? 'jpg' : mime.slice(6)}"\r\nContent-Type: ${mime}\r\n\r\n`); chunks.push(Buffer.from(data)); add('\r\n'); });
  add(`--${boundary}--\r\n`);
  const body = Buffer.concat(chunks); return body.length <= 48 * 1024 * 1024 ? ok({ body, contentType: `multipart/form-data; boundary=${boundary}` }) : fail('REFERENCE_LIMIT', '参考请求超过48 MiB。');
}
/** Shares the established durable image response parser and spool reconciliation. */
export class OpenAIImageEditAdapter extends OpenAIImagesAdapter {
  override readonly adapterId = 'openai-image-edit-v1';
  override validate(input: PreparedGeneration) { return validateImageEdit(input); }
  protected override transport(input: PreparedGeneration, context: DispatchContext) {
    if (!context.requestImageEdit) throw Error('PROVIDER_UNAVAILABLE');
    return context.requestImageEdit(input, { attemptId: context.attemptId, outputStagingId: context.outputStagingId, clientRequestId: context.clientRequestId, requestHash: context.requestHash, retries: 0 });
  }
}
