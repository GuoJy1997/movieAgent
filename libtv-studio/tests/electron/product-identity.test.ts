import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const apps: ElectronApplication[] = [], roots: string[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it('keeps the previous package default profile and honors an explicit chosen profile after renaming', async () => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-identity-')); roots.push(root);
  const appData = join(root, '应用数据 with spaces'); await mkdir(appData);
  const legacy = join(appData, '@libtv', 'desktop');
  async function launch(explicit?: string) {
    const app = await _electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('tests/electron/fixtures/product-identity-harness.cjs'), '--legacy-workspace', `--test-app-data=${appData}`, ...(explicit ? [`--user-data-dir=${explicit}`] : [])] }); apps.push(app);
    const page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.studio));
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(explicit ?? legacy);
    expect(await app.evaluate(({ app }) => app.getName())).toBe('MovieAgent');
    return { app, page };
  }
  const first = await launch();
  const oldIdentity = await first.page.evaluate(() => window.studio.describe());
  expect(await first.page.evaluate(() => window.studio.createProject({ name: '保留默认资料库' }))).toMatchObject({ ok: true });
  await first.app.close(); apps.splice(apps.indexOf(first.app), 1);
  const second = await launch(legacy);
  expect(await second.page.evaluate(() => window.studio.listProjects())).toMatchObject({ ok: true, value: [{ name: '保留默认资料库' }] });
  const identity = await second.page.evaluate(() => window.studio.describe());
  if (!oldIdentity.ok || !identity.ok) throw Error('identity');
  expect(identity.value.libraryId).toBe(oldIdentity.value.libraryId);
  await second.app.close(); apps.splice(apps.indexOf(second.app), 1);
  const chosen = await launch(join(root, '用户选择 profile 中文'));
  expect(await chosen.page.evaluate(() => window.studio.listProjects())).toEqual({ ok: true, value: [] });
});
