import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-local-config-')); roots.push(root);
  const repo = join(root, 'studio'), script = join(repo, 'scripts/start-local.cjs');
  const executable = join(repo, 'apps/desktop/release/win-unpacked/MovieAgent.exe');
  await mkdir(join(repo, 'scripts'), { recursive: true });
  await mkdir(join(executable, '..'), { recursive: true });
  await writeFile(executable, 'fixture only');
  await copyFile(resolve('scripts/start-local.cjs'), script);
  const config = join(repo, 'config/models.json'), legacy = join(root, 'config/models.json');
  const command = join(root, '启动MovieAgent.cmd');
  function prepare() {
    const result = spawnSync(process.execPath, [script, '--prepare-only'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('dummy-private-key');
    return JSON.parse(result.stdout);
  }
  return { root, repo, executable, config, legacy, command, prepare };
}
it('creates model configuration inside the software repository and points the launcher at it', async () => {
  const f = await fixture();
  expect(f.prepare().configPath).toBe(f.config);
  expect(JSON.parse(await readFile(f.config, 'utf8')).providers[0].apiKey).toBe('');
  expect(await readFile(f.command, 'utf8')).toContain(`--model-config=${f.config}`);
  expect(f.prepare().config).toBe('preserved');
});
it('preserves existing credential bytes during migration and updates only the previously generated launcher', async () => {
  const f = await fixture();
  await mkdir(join(f.legacy, '..'), { recursive: true });
  const bytes = Buffer.from('\uFEFF{"apiKey":"dummy-private-key"}\r\n');
  await writeFile(f.legacy, bytes);
  await writeFile(f.command, `@echo off\r\nchcp 65001 >nul\r\nstart "MovieAgent" "${f.executable}" --project-launcher "--model-config=${f.legacy}"\r\n`);
  const result = f.prepare();
  expect(result.configPath).toBe(f.config);
  expect(await readFile(f.config)).toEqual(bytes);
  expect(await readFile(f.legacy)).toEqual(bytes);
  expect(await readFile(f.command, 'utf8')).toContain(`--model-config=${f.config}`);
});
it('never overwrites a repository configuration or a customized launch script', async () => {
  const f = await fixture();
  await mkdir(join(f.config, '..'), { recursive: true });
  await mkdir(join(f.legacy, '..'), { recursive: true });
  await writeFile(f.config, 'repository dummy-private-key');
  await writeFile(f.legacy, 'older configuration');
  await writeFile(f.command, '@echo custom launch\r\n');
  expect(f.prepare().config).toBe('preserved');
  expect(await readFile(f.config, 'utf8')).toBe('repository dummy-private-key');
  expect(await readFile(f.command, 'utf8')).toBe('@echo custom launch\r\n');
});
