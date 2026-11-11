import { expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, copyFile, readFile, writeFile, readdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

// Execute the real provisioning control flow with temporary cached artifacts. Native
// spawning is replaced so an untrusted fixture can never actually execute.
it.each(['ffmpeg.exe', 'ffprobe.exe'])('rejects a modified cached %s before any native probe spawn', async changed => {
  const root = await mkdtemp(join(tmpdir(), 'p4-runtime-cache-'));
  try {
    const cache = join(root, '.cache/media-runtime'), extracted = join(cache, 'ffmpeg-9.0.2/build'), destination = join(root, 'apps/desktop/resources/media-runtime/win32-x64');
    await mkdir(join(extracted, 'bin'), { recursive: true }); await mkdir(destination, { recursive: true });
    await copyFile(resolve('.cache/media-runtime/ffmpeg-9.0.2-essentials_build.zip'), join(cache, 'ffmpeg-9.0.2-essentials_build.zip'));
    const real = resolve('apps/desktop/resources/media-runtime/win32-x64');
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) { if (name === changed) await writeFile(join(extracted, 'bin', name), 'untrusted cached fixture, never executed'); else await copyFile(join(real, name), join(extracted, 'bin', name)); }
    await copyFile(join(real, 'FFmpeg-LICENSE.txt'), join(extracted, 'LICENSE')); await copyFile(join(real, 'FFmpeg-README.txt'), join(extracted, 'README.txt'));
    for (const name of ['NotoSansCJKsc-Regular.otf', 'FONT-OFL.txt']) await copyFile(join(real, name), join(destination, name));
    const source = (await readFile(resolve('scripts/prepare-media-runtime.mjs'), 'utf8')).replace(/^import .*;\r?$/gm, '').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(join(root, 'scripts/prepare-media-runtime.mjs')).href));
    let spawns = 0, message = ''; let complete!: () => void; const done = new Promise<void>(resolve => { complete = resolve; });
    const processFixture = { argv: ['node', join(root, 'scripts/prepare-media-runtime.mjs')], set exitCode(_value: number) { complete(); } };
    runInNewContext(source, { createHash, mkdir, readFile, writeFile, copyFile, readdir, rename, unlink, existsSync, join, resolve, fileURLToPath, URL, Buffer, process: processFixture,
      spawnSync: () => { spawns++; return { status: 0, stdout: '', stderr: '' }; },
      verifyMediaRuntime: async () => { throw Error('RUNTIME_FILE_INTEGRITY_FAILED'); },
      console: { error: (error: string) => { message = error; }, log: () => complete() },
    });
    await done; expect(message).toBe('RUNTIME_EXECUTABLE_HASH_MISMATCH'); expect(spawns).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
