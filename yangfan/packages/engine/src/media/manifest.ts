import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { FontManifest, MediaRuntime } from '../../../contracts/src/media-info.ts';
import { fail, isRecord, ok, type Result } from '../../../contracts/src/result.ts';
const PINNED_FILES: Record<string, string> = {
  'ffmpeg.exe': '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec',
  'ffprobe.exe': 'f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52',
  'NotoSansCJKsc-Regular.otf': '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b',
  'FFmpeg-LICENSE.txt': '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
  'FONT-OFL.txt': '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2',
};
/** Privileged caller supplies only the app's own resource directory. No PATH lookup. */
export async function loadMediaRuntime(directory: string): Promise<Result<MediaRuntime>> {
  try {
    if (!isAbsolute(directory) || (await realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw Error('path');
    const raw: unknown = JSON.parse(await readFile(join(directory, 'runtime-manifest.json'), 'utf8'));
    if (!isRecord(raw) || raw.version !== '9.0.2' || raw.platform !== 'win32-x64' || !isRecord(raw.files) || !isRecord(raw.fontManifest)) throw Error('manifest');
    const { runtimeHash, ...facts } = raw;
    if (typeof runtimeHash !== 'string' || runtimeHash !== createHash('sha256').update(JSON.stringify(facts)).digest('hex')) throw Error('manifest');
    for (const [name, expected] of Object.entries(PINNED_FILES)) {
      const path = join(directory, name), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || (await realpath(path)).toLowerCase() !== path.toLowerCase() || raw.files[name] !== expected || expected !== createHash('sha256').update(await readFile(path)).digest('hex')) throw Error('integrity');
    }
    const font = raw.fontManifest;
    if (font.file !== 'NotoSansCJKsc-Regular.otf' || font.family !== 'Noto Sans CJK SC' || font.version !== 'Sans2.004' || font.sha256 !== raw.files[font.file]) throw Error('font');
    return ok({ runtimeHash, ffmpegPath: join(directory, 'ffmpeg.exe'), ffprobePath: join(directory, 'ffprobe.exe'), fontManifest: font as unknown as FontManifest });
  } catch { return fail('MEDIA_RUNTIME_UNAVAILABLE', '固定媒体运行时或字体校验失败，请修复安装。'); }
}
