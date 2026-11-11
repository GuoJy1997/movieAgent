import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, readdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyMediaRuntime } from './verify-media-runtime.mjs';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const destination = join(root, 'apps/desktop/resources/media-runtime/win32-x64');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const archiveHash = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba';
const sources = {
  archive: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
  font: 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
  fontLicense: 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE',
};
async function download(url, path, expected) {
  if (!existsSync(path)) {
    // Provisioning only: Windows curl uses the host's configured TLS/proxy trust.
    const partial = path + '.part';
    const result = spawnSync('curl.exe', ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '15', '--max-time', '300', '--output', partial, url], { shell: false, windowsHide: true, timeout: 310000, encoding: 'utf8' });
    if (result.status !== 0) { await unlink(partial).catch(() => undefined); throw Error('DOWNLOAD_FAILED'); }
    if (expected && sha(await readFile(partial)) !== expected) { await unlink(partial); throw Error('RUNTIME_ARCHIVE_HASH_MISMATCH'); }
    await rename(partial, path);
  }
  const actual = sha(await readFile(path)); if (expected && actual !== expected) throw Error('RUNTIME_ARCHIVE_HASH_MISMATCH'); return actual;
}
async function prepare() {
  if (process.argv.includes('--verify')) { console.log(JSON.stringify(await verifyMediaRuntime(destination), null, 2)); return; }
  if (process.argv.slice(2).length) throw Error('INVALID_ARGUMENT');
  const cache = join(root, '.cache/media-runtime'); await mkdir(cache, { recursive: true }); await mkdir(destination, { recursive: true });
  const archive = join(cache, 'ffmpeg-9.0.2-essentials_build.zip'); await download(sources.archive, archive, archiveHash);
  const extracted = join(cache, 'ffmpeg-9.0.2');
  if (!existsSync(extracted)) {
    const escaped = p => p.replaceAll("'", "''");
    const result = spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${escaped(archive)}' -DestinationPath '${escaped(extracted)}'`], { windowsHide: true, shell: false, timeout: 120000 });
    if (result.status !== 0) throw Error('RUNTIME_EXTRACTION_FAILED');
  }
  const folder = (await readdir(extracted))[0]; if (!folder) throw Error('RUNTIME_EXTRACTION_FAILED');
  const build = join(extracted, folder);
  await copyFile(join(build, 'bin/ffmpeg.exe'), join(destination, 'ffmpeg.exe')); await copyFile(join(build, 'bin/ffprobe.exe'), join(destination, 'ffprobe.exe'));
  // A reused extraction cache is not authenticated by hashing the archive beside it.
  // Authenticate both copied executables before any native probe or other spawn.
  const executablePins = { 'ffmpeg.exe': '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec', 'ffprobe.exe': 'f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52' };
  for (const [name, expected] of Object.entries(executablePins)) if (sha(await readFile(join(destination, name))) !== expected) throw Error('RUNTIME_EXECUTABLE_HASH_MISMATCH');
  await copyFile(join(build, 'LICENSE'), join(destination, 'FFmpeg-LICENSE.txt'));
  await copyFile(join(build, 'README.txt'), join(destination, 'FFmpeg-README.txt'));
  const fontHash = await download(sources.font, join(destination, 'NotoSansCJKsc-Regular.otf'), '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b');
  await download(sources.fontLicense, join(destination, 'FONT-OFL.txt'), '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2');
  const files = {}; for (const name of ['ffmpeg.exe', 'ffprobe.exe', 'NotoSansCJKsc-Regular.otf', 'FFmpeg-LICENSE.txt', 'FONT-OFL.txt', 'FFmpeg-README.txt']) files[name] = sha(await readFile(join(destination, name)));
  const evidence = {};
  for (const flag of ['-version', '-buildconf', '-L', '-encoders', '-muxers', '-filters']) {
    const result = spawnSync(join(destination, 'ffmpeg.exe'), [flag], { shell: false, windowsHide: true, timeout: 30000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) throw Error('RUNTIME_PROBE_FAILED'); const name = `ffmpeg${flag}.txt`; await writeFile(join(destination, name), result.stdout + result.stderr); evidence[name] = sha(Buffer.from(result.stdout + result.stderr));
  }
  const manifest = { schemaVersion: 1, version: '9.0.2', platform: 'win32-x64', sources, archiveSha256: archiveHash, files, evidence, fontManifest: { file: 'NotoSansCJKsc-Regular.otf', family: 'Noto Sans CJK SC', version: 'Sans2.004', sha256: fontHash }, license: { binary: 'GPL-3.0-or-later', font: 'OFL-1.1', publicDistributionReady: false, sourceMaterials: 'https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2', limitations: 'Full corresponding FFmpeg and all statically linked dependencies source/build materials have not been assembled. Public distribution requires a separate license/source-material review; no exemption is inferred from subprocess use.' } };
  manifest.runtimeHash = sha(Buffer.from(JSON.stringify(manifest)));
  await writeFile(join(destination, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(destination, 'NOTICE.txt'), `Pinned Gyan FFmpeg 9.0.2 essentials x64 static GPL build.\nArchive: ${sources.archive}\nSHA256: ${archiveHash}\nFont: ${sources.font}\n${manifest.license.limitations}\n`);
  console.log(JSON.stringify(await verifyMediaRuntime(destination), null, 2));
}
prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
