import { fail, ok, type Result } from '../../contracts/src/result.ts';
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Explicit text only. Unknown binary files never fall back to this decoder. */
export function inspectText(bytes: Uint8Array): Result<{ mime: 'text/plain'; width: 0; height: 0 }> {
  if (!bytes.byteLength || bytes.byteLength > MAX_TEXT_BYTES) return fail('TEXT_LIMIT', '文本原件必须为 1 字节至 1 MiB。');
  try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) throw Error(); }
  catch { return fail('INVALID_TEXT', '文本必须是无 NUL 的有效 UTF-8。'); }
  return ok({ mime: 'text/plain', width: 0, height: 0 });
}
