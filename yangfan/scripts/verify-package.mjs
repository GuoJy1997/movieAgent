import { createRequire } from 'node:module';
import { resolve, join, dirname, normalize } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { verifyMediaRuntime } from './verify-media-runtime.mjs';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
function reject(code) { throw new Error(code); }
async function inspect(directory, executable) {
  const archive = join(directory, 'resources/app.asar');
  const required = ['package.json', 'out/main/index.js', 'out/main/engine-process.js', 'out/main/mcp-stdio.js', 'out/preload/index.js', 'out/preload/credentials.js', 'out/preload/launcher.js', 'out/preload/model-config.js', 'out/renderer/model-config/index.html', 'out/renderer/launcher/index.html', 'out/renderer/renderer/index.html', 'out/renderer/credentials/index.html'];
  const read = name => { try { const bytes = asar.extractFile(archive, normalize(name)); if (!bytes.length) reject('empty'); return bytes.toString(); } catch { reject(`PACKAGE_RESOURCE_MISSING:${name}`); } };
  for (const name of required) read(name);
  const metadata = JSON.parse(read('package.json'));
  if (metadata.main !== 'out/main/index.js') reject('PACKAGE_ENTRY_INVALID');
  // First reject development Node or a wrong Electron/architecture/ABI, independently
  // of installed host dependencies. Native probes below use only packaged modules.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
  const runtime = spawnSync(executable, ['-e', 'console.log(JSON.stringify({electron:process.versions.electron,modules:process.versions.modules,node:process.versions.node,arch:process.arch,platform:process.platform}))'], { cwd: directory, env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  let versions;
  try { versions = JSON.parse(runtime.stdout.trim()); } catch { reject('PACKAGE_RUNTIME_MISMATCH'); }
  if (runtime.status !== 0 || versions.electron !== '45.0.0' || versions.arch !== 'x64' || versions.platform !== 'win32' || versions.modules !== '150') reject('PACKAGE_RUNTIME_MISMATCH');
  for (const name of ['node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node', 'node_modules/@img/sharp-win32-x64/lib/libvips-42.dll', 'node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.18.7.dll']) {
    if (!existsSync(join(directory, 'resources/app.asar.unpacked', name))) reject(`PACKAGE_NATIVE_MISSING:${name}`);
  }
  const nativeCode = `
    const {createRequire}=require('node:module');
    const req=createRequire(${JSON.stringify(join(archive, 'package.json'))});
    const resolved=req.resolve('sharp');
    if(!resolved.startsWith(${JSON.stringify(archive)}+require('node:path').sep))throw Error('outside archive');
    const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');
    db.exec('CREATE TABLE check_native(value INTEGER); INSERT INTO check_native VALUES(42)');
    const sqlite=db.prepare('SELECT sqlite_version() version,value FROM check_native').get();db.close();
    req('sharp')({create:{width:2,height:3,channels:3,background:'#336699'}}).png().toBuffer({resolveWithObject:true}).then(({data,info})=>console.log(JSON.stringify({sqlite,sharp:{format:info.format,width:info.width,height:info.height,bytes:data.length,hash:require('node:crypto').createHash('sha256').update(data).digest('hex')}}))).catch(()=>process.exit(1));`;
  const native = spawnSync(executable, ['-e', nativeCode], { cwd: directory, env, encoding: 'utf8', timeout: 20000, windowsHide: true });
  let decoded;
  try { decoded = JSON.parse(native.stdout.trim()); } catch { reject('PACKAGE_NATIVE_ABI_FAILED'); }
  if (native.status !== 0 || decoded.sqlite.value !== 42 || decoded.sharp.width !== 2 || decoded.sharp.height !== 3 || decoded.sharp.format !== 'png') reject('PACKAGE_NATIVE_ABI_FAILED');
  for (const [file, global, expected] of [
    ['out/preload/index.js', 'studio', ['mcpStatus','mcpConfigure','mcpSelectImportDirectory','exportVoice','selectSubtitleFile','setTimelineDraftState','exportTimeline','cancelTimelineExport','exportCreation', 'workspaceInfo','openProjectFolder','openProjectLauncher','reloadModelConfig','readModelConfig','openModelConfigEditor','removeModelConfigProvider','selectImportFiles','mediaUrl','derivedMediaUrl','releaseMediaUrl','openCredentialEditor','describe','listProjects','createProject','execute','query','readEvents']],
    ['out/preload/launcher.js', 'projectLauncher', ['listRecent','createNew','fromFolder','openExisting','openRecent','configInfo','openConfig','openLegacy','maintenanceInfo','backupProject','restoreProject','migrateProject','activateRestoredProject','revealUpgradeInstaller']],
    ['out/preload/credentials.js', 'credentials', ['info','submit','revoke']],
    ['out/preload/model-config.js', 'modelConfigEntry', ['info','submit','listModels','test','prepareAudioTest','runAudioTest']],
  ]) {
    const exports = new Map();
    runInNewContext(read(file), { require: name => { if (name !== 'electron') reject('PACKAGE_PRELOAD_BOUNDARY'); return { contextBridge: { exposeInMainWorld: (name, bridge) => exports.set(name, Object.keys(bridge).sort()) }, ipcRenderer: { invoke() { reject('PACKAGE_PRELOAD_SIDE_EFFECT'); } } }; } }, { timeout: 1000 });
    if (exports.size !== 1 || JSON.stringify(exports.get(global)) !== JSON.stringify(expected.sort())) reject('PACKAGE_PRELOAD_BOUNDARY');
  }
  for (const html of ['out/renderer/model-config/index.html', 'out/renderer/launcher/index.html', 'out/renderer/renderer/index.html', 'out/renderer/credentials/index.html']) {
    const text = read(html);
    if (!text.includes('Content-Security-Policy') || !text.includes("object-src 'none'")) reject('PACKAGE_HTML_POLICY');
    const sources = [...text.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
    if (!sources.some(source => source.endsWith('.js'))) reject('PACKAGE_HTML_ENTRY');
    for (const source of sources) {
      const path = source.startsWith('/') ? `out/renderer${source}` : join(dirname(html), source).replaceAll('\\', '/');
      if (!path.startsWith('out/renderer/')) reject('PACKAGE_RENDERER_BOUNDARY');
      const content = read(path);
      if (/(?:require\s*\(\s*['"](?:electron|node:)|from\s*['"](?:electron|node:)|@libtv\/(?:storage|engine|providers))/.test(content)) reject('PACKAGE_RENDERER_BOUNDARY');
    }
  }
  const mediaRuntime = await verifyMediaRuntime(join(directory, 'resources/media-runtime/win32-x64'));
  return { verified: true, directory, executable, runtime: versions, mediaRuntime, native: decoded, entries: required, boundaries: 'four isolated preloads and CSP HTML entries; runtime IPC covered by test:electron' };
}
try {
  const args = process.argv.slice(2); let directory = resolve('apps/desktop/release/win-unpacked'), executable;
  while (args.length) { const flag = args.shift(); const value = args.shift(); if (!value || !['--dir','--executable'].includes(flag)) reject('PACKAGE_ARGUMENT_INVALID'); if (flag === '--dir') directory = resolve(value); else executable = resolve(value); }
  console.log(JSON.stringify(await inspect(directory, executable ?? join(directory, 'MovieAgent.exe')), null, 2));
} catch (error) { console.error(error instanceof Error && /^PACKAGE_[A-Z_]+(?::[a-zA-Z0-9_./@-]+)?$/.test(error.message) ? error.message : 'PACKAGE_VERIFICATION_FAILED'); process.exitCode = 1; }
