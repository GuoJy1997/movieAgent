import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MediaRuntime } from '../../../contracts/src/media-info.ts';
import { fail, ok, type Result } from '../../../contracts/src/result.ts';
/** Read the pinned OpenType cmap; missing glyphs are explicit, never system-font fallbacks. */
export async function checkFontCoverage(runtime: MediaRuntime, text: string): Promise<Result<{ family: string; missing: string[] }>> {
  try {
    if (runtime.fontManifest.file !== 'NotoSansCJKsc-Regular.otf' || text.length > 200000) throw Error('font');
    const bytes = await readFile(join(dirname(runtime.ffmpegPath), runtime.fontManifest.file));
    if (createHash('sha256').update(bytes).digest('hex') !== runtime.fontManifest.sha256) throw Error('hash');
    let cmap = 0;
    for (let n = 0; n < bytes.readUInt16BE(4); n++) { const offset = 12 + n * 16; if (bytes.toString('ascii', offset, offset + 4) === 'cmap') cmap = bytes.readUInt32BE(offset + 8); }
    if (!cmap) throw Error('cmap');
    const subtables: number[] = []; for (let n = 0; n < bytes.readUInt16BE(cmap + 2); n++) { const sub = cmap + bytes.readUInt32BE(cmap + 4 + n * 8 + 4); if ([4, 12].includes(bytes.readUInt16BE(sub))) subtables.push(sub); }
    const supported = (code: number) => subtables.some(sub => {
      if (bytes.readUInt16BE(sub) === 12) {
        const count = bytes.readUInt32BE(sub + 12); for (let n = 0; n < count; n++) { const offset = sub + 16 + n * 12, start = bytes.readUInt32BE(offset), end = bytes.readUInt32BE(offset + 4); if (code >= start && code <= end) return bytes.readUInt32BE(offset + 8) + code - start !== 0; } return false;
      }
      if (code > 65535) return false;
      const count = bytes.readUInt16BE(sub + 6) / 2, ends = sub + 14, starts = ends + count * 2 + 2, deltas = starts + count * 2, ranges = deltas + count * 2;
      for (let n = 0; n < count; n++) if (code <= bytes.readUInt16BE(ends + n * 2)) {
        if (code < bytes.readUInt16BE(starts + n * 2)) return false;
        const delta = bytes.readInt16BE(deltas + n * 2), range = bytes.readUInt16BE(ranges + n * 2);
        if (!range) return ((code + delta) & 65535) !== 0;
        const glyph = bytes.readUInt16BE(ranges + n * 2 + range + (code - bytes.readUInt16BE(starts + n * 2)) * 2); return glyph !== 0 && ((glyph + delta) & 65535) !== 0;
      } return false;
    });
    const missing = [...new Set([...text].filter(c => !/\s/u.test(c) && !supported(c.codePointAt(0)!)))];
    return ok({ family: runtime.fontManifest.family, missing });
  } catch { return fail('MEDIA_FONT_INVALID', '固定字体校验失败。'); }
}
