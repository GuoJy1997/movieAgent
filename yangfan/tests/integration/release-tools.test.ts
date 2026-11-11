import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar') as { createPackage(source: string, target: string): Promise<void> };
const roots: string[] = [];
it('promotes only an explicitly selected successful measurement matching both current package hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-performance-')); roots.push(root);
  const executable = join(root, 'fixture.exe'), archive = join(root, 'fixture.asar'), source = join(root, 'measurement.json'), target = join(root, 'frozen.json');
  await writeFile(executable, 'exe'); await writeFile(archive, 'asar'); await writeFile(target, 'frozen');
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const packageIdentity = [executable, archive].map((path, index) => ({ path, sha256: createHash('sha256').update(index === 0 ? 'exe' : 'asar').digest('hex') }));
  const args = ['--source', source, '--target', target];
  await writeFile(source, JSON.stringify({ status: 'running', packageIdentity }));
  expect(cli('promote-performance.mjs', args).status).toBe(1);
  expect(await readFile(target, 'utf8')).toBe('frozen');
  await writeFile(source, JSON.stringify({ status: 'passed', packageIdentity }));
  expect(cli('promote-performance.mjs', args).status).toBe(0);
  const frozen = await readFile(target, 'utf8');
  expect(JSON.parse(frozen)).toMatchObject({ status: 'passed', packageIdentity });
  await writeFile(archive, 'changed');
  expect(cli('promote-performance.mjs', args).status).toBe(1);
  expect(await readFile(target, 'utf8')).toBe(frozen);
});
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function cli(script: string, args: string[]) { return spawnSync(process.execPath, [resolve('scripts', script), ...args], { encoding: 'utf8', timeout: 10000 }); }
async function fixture(omit?: string) {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-release-')); roots.push(root);
  const source = join(root, 'source');
  for (const file of ['out/main/index.js', 'out/main/engine-process.js', 'out/main/mcp-stdio.js', 'out/preload/index.js', 'out/preload/credentials.js', 'out/preload/launcher.js', 'out/preload/model-config.js', 'out/renderer/model-config/index.html', 'out/renderer/launcher/index.html', 'out/renderer/renderer/index.html', 'out/renderer/credentials/index.html', 'package.json']) {
    if (file === omit) continue;
    await mkdir(join(source, file, '..'), { recursive: true });
    await writeFile(join(source, file), file === 'package.json' ? JSON.stringify({ main: 'out/main/index.js' }) : 'fixture');
  }
  await mkdir(join(root, 'resources'), { recursive: true });
  await asar.createPackage(source, join(root, 'resources/app.asar'));
  return root;
}
it('rejects a packaged archive missing its utility engine before attempting execution', async () => {
  const result = cli('verify-package.mjs', ['--dir', await fixture('out/main/engine-process.js')]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('PACKAGE_RESOURCE_MISSING:out/main/engine-process.js');
});
it('rejects missing credential preload rather than accepting a one-window package', async () => {
  const result = cli('verify-package.mjs', ['--dir', await fixture('out/preload/credentials.js')]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('PACKAGE_RESOURCE_MISSING:out/preload/credentials.js');
});
it('rejects a package missing the dedicated model configuration preload', async () => {
  const result = cli('verify-package.mjs', ['--dir', await fixture('out/preload/model-config.js')]);
  expect(result.status).toBe(1); expect(result.stderr).toContain('PACKAGE_RESOURCE_MISSING:out/preload/model-config.js');
});
it('rejects a non-Electron executable instead of accepting the development Node ABI', async () => {
  const root = await fixture();
  const result = cli('verify-package.mjs', ['--dir', root, '--executable', process.execPath]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('PACKAGE_RUNTIME_MISMATCH');
});
const config = { schemaVersion: 1, executable: resolve('apps/desktop/release/win-unpacked/MovieAgent.exe'), libraryRoot: 'C:/fixture library 中文', userData: 'C:/fixture profile 中文', libraryId: 'library-fixture', projectId: 'project-fixture', connectionRef: { libraryId: 'library-fixture', id: 'connection-fixture', revision: 2 }, profileRef: { libraryId: 'library-fixture', id: 'profile-fixture', revision: 3 }, prompt: 'One tree', count: 1, currency: 'USD', allowanceMicros: 100000, budgetLimitMicros: 100000, acknowledgeUnknown: true, evidenceFile: 'C:/fixture evidence/result.json' };
async function configFile(value: unknown) { const root = await mkdtemp(join(tmpdir(), 'movieagent-live-config-')); roots.push(root); const path = join(root, 'check.json'); await writeFile(path, JSON.stringify(value)); return path; }
it('refuses paid execution by default without reading configuration or environment keys', () => {
  const result = cli('run-live-image-check.mjs', ['--config', 'does-not-exist.json']);
  expect(result.status).toBe(1); expect(result.stderr).toContain('LIVE_OPT_IN_REQUIRED');
});
it('validates a reference-only fixture without launching any application or reading credentials', async () => {
  const result = cli('run-live-image-check.mjs', ['--validate-only', '--config', await configFile(config)]);
  expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ validated: true, executed: false, count: 1 });
});
it.each([{ ...config, count: 2 }, { ...config, budgetLimitMicros: 0 }, { ...config, allowanceMicros: 1e30 }, { ...config, apiKey: 'dummy-secret' }, { ...config, connectionRef: { ...config.connectionRef, libraryId: 'other' } }])('rejects unsafe live-check configuration %#', async value => {
  const result = cli('run-live-image-check.mjs', ['--validate-only', '--config', await configFile(value)]);
  expect(result.status).toBe(1); expect(result.stderr).toContain('LIVE_CONFIG_INVALID'); expect(result.stderr).not.toContain('dummy-secret');
});
it('rejects plaintext key CLI arguments even in validation mode', async () => {
  const result = cli('run-live-image-check.mjs', ['--validate-only', '--api-key=dummy-secret', '--config', await configFile(config)]);
  expect(result.status).toBe(1); expect(result.stderr).toContain('LIVE_ARGUMENT_INVALID'); expect(result.stderr).not.toContain('dummy-secret');
});

it('rejects a packaged archive missing its MCP stdio entry', async () => {
 const result = cli('verify-package.mjs', ['--dir', await fixture('out/main/mcp-stdio.js')]);
 expect(result.status).toBe(1); expect(result.stderr).toContain('PACKAGE_RESOURCE_MISSING:out/main/mcp-stdio.js');
});
