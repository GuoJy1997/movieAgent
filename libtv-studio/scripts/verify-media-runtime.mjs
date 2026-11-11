import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function verifyMediaRuntime(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'runtime-manifest.json'), 'utf8'));
  const { runtimeHash, ...facts } = manifest;
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  if (manifest.version !== '9.0.2' || manifest.platform !== 'win32-x64' || runtimeHash !== hash(Buffer.from(JSON.stringify(facts)))) throw Error('RUNTIME_MANIFEST_INVALID');
  const pins = { 'ffmpeg.exe': '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec', 'ffprobe.exe': 'f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52', 'NotoSansCJKsc-Regular.otf': '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b', 'FFmpeg-LICENSE.txt': '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903', 'FONT-OFL.txt': '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2' };
  if (manifest.archiveSha256 !== '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba' || Object.entries(pins).some(([name, expected]) => manifest.files?.[name] !== expected)) throw Error('RUNTIME_MANIFEST_INVALID');
  for (const [file, expected] of Object.entries({ ...manifest.files, ...manifest.evidence })) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(file) || !/^[a-f0-9]{64}$/.test(expected)) throw Error('RUNTIME_MANIFEST_INVALID');
    const path = join(directory, file); const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || hash(await readFile(path)) !== expected) throw Error('RUNTIME_FILE_INTEGRITY_FAILED');
  }
  if (!manifest.files['ffmpeg.exe'] || !manifest.files['ffprobe.exe'] || manifest.files[manifest.fontManifest.file] !== manifest.fontManifest.sha256) throw Error('RUNTIME_MANIFEST_INVALID');
  return { verified: true, runtimeHash, version: manifest.version, publicDistributionReady: manifest.license.publicDistributionReady };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) verifyMediaRuntime(resolve(process.argv[2] ?? 'apps/desktop/resources/media-runtime/win32-x64')).then(value => console.log(JSON.stringify(value)), error => { console.error(error.message); process.exitCode = 1; });
