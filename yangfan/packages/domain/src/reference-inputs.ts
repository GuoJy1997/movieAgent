import { createHash } from 'node:crypto';
import { isFrozenReferenceImage, type FrozenReferenceImage, type PreparedGeneration } from '../../contracts/src/generation.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
/** Validate frozen metadata without reading bytes; used before approval and again in main. */
export function validateReferenceImages(input: PreparedGeneration): Result<void> {
  const refs=input.referenceImages??[];
  return validateReferenceShape(input,refs.map(r=>r.role),refs);
}
/** Static plan validation also works before pending StepOutput images have dimensions. */
export function validateReferenceShape(input: Pick<PreparedGeneration,'libraryId'|'adapterId'|'config'>, roles: FrozenReferenceImage['role'][], known: FrozenReferenceImage[] = []): Result<void> {
  if (roles.length > 4 || known.some(r => !isFrozenReferenceImage(r) || r.ref.libraryId !== input.libraryId) || known.reduce((sum,r) => sum + r.byteLength, 0) > 32 * 1024 * 1024) return fail('INVALID_REFERENCE', '参考图最多4张，每张10 MiB、合计32 MiB，且必须属于当前资料库。');
  if (input.adapterId === 'openai-image-edit-v1') return roles.length && roles.every(role => role === 'reference') ? ok(undefined) : fail('INVALID_REFERENCE_ROLE', '参考图生成需要1–4张 reference 图片。');
  if (input.adapterId !== 'minimax-video-v2') return roles.length ? fail('UNSUPPORTED_REFERENCE', '此适配器不支持参考图。') : ok(undefined);
  if (roles.length && !input.config.model.capabilities.inputKinds.some(k => k === 'image')) return fail('UNSUPPORTED_REFERENCE', '模型未声明图像输入能力。');
  if (known.some(r => r.width < 256 || r.width > 5760 || r.height < 256 || r.height > 5760 || r.width / r.height < 0.4 || r.width / r.height > 2.5)) return fail('REFERENCE_DIMENSIONS', '视频参考图尺寸需256–5760，宽高比0.4–2.5。');
  const first = roles.filter(role => role === 'first_frame'), last = roles.filter(role => role === 'last_frame');
  if (first.length > 1 || last.length > 1 || last.length && !first.length || (first.length || last.length) && roles.includes('reference')) return fail('INVALID_REFERENCE_ROLE', '首尾各最多一张，尾帧需首帧；首尾模式不可与参考模式混用。');
  if (first.length && input.config.parameters.ratio !== 'adaptive' || !roles.length && input.config.parameters.ratio === 'adaptive') return fail('INVALID_REFERENCE_RATIO', '首帧模式需 adaptive，文生视频需明确画幅。');
  return ok(undefined);
}
/** Called in main before opening any credential scope. No paths/URLs accepted. */
export function verifyReferenceBytes(input: PreparedGeneration, bytes: Uint8Array[] = []): Result<Uint8Array[]> {
  const valid = validateReferenceImages(input); if (!valid.ok) return valid;
  const refs: FrozenReferenceImage[] = input.referenceImages ?? [];
  if (!Array.isArray(bytes) || bytes.length !== refs.length || bytes.some((b,i) => !(b instanceof Uint8Array) || b.byteLength !== refs[i]!.byteLength || createHash('sha256').update(b).digest('hex') !== refs[i]!.hash)) return fail('REFERENCE_INTEGRITY_FAILED', '参考图原件完整性校验失败。');
  // Copy before async vault work, so the verified payload cannot be replaced by a caller.
  return ok(bytes.map(b => Uint8Array.from(b)));
}
