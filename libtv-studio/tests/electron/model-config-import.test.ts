import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { build } from 'vite';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const apps: ElectronApplication[] = [], roots: string[] = [], servers: Server[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); } for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });

it('imports through actual Electron safeStorage and utility host, recovers after reopen, and makes zero HTTP requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'model-import-electron-')); roots.push(root);
  let requests = 0;
  const server = createServer((_q, response) => { requests++; response.end('{}'); }); servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture listener');
  await build({ configFile: false, logLevel: 'error', build: { ssr: true, outDir: join(root, 'harness'), rollupOptions: { input: { main: resolve('tests/electron/fixtures/model-config-import-harness.ts'), 'engine-process': resolve('apps/desktop/src/main/engine-process.ts') }, external: ['electron', /^node:/], output: { format: 'cjs', entryFileNames: '[name].js' } } } });
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron') as string, args: [join(root, 'harness/main.js'), `--fixture-root=${root}`] }); apps.push(app);
  await app.firstWindow();
  await expect.poll(() => app.evaluate(() => Boolean((globalThis as any).modelConfigFixture))).toBe(true);
  const result = await app.evaluate(async (_electron, port) => (globalThis as any).modelConfigFixture.run(port), address.port);
  expect(result).toEqual({ protection: true, first: true, same: true, interrupted: false, recovered: true, credentialCount: 2, connectionRevisions: [1, 2, 3], modelRevisions: [1, 2], profileRevisions: [1, 2], oldUsable: true, newUsable: true, wireLeak: false, databaseLeak: false, vaultLeak: false, pendingTasks: 0 });
  expect(requests).toBe(0);
});
