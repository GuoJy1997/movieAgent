import { packageExecutable, isolatedModelConfig } from './support/product-launch.ts';
import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';

const apps: ElectronApplication[] = [],
  roots: string[] = [],
  servers: Server[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('real workbench configures, approves once, stores original, saves fixed asset and restores canvas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-ui-workflow-'));
  roots.push(root);
  const png = await sharp({ create: { width: 120, height: 90, channels: 3, background: '#718477' } })
    .png()
    .toBuffer();
  let posts = 0;
  const server = createServer((req, res) => {
    posts++;
    expect(req.headers.authorization).toBe('Bearer dummy-ui-key');
    req.resume();
    req.on('end', () => res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })));
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  async function launch() {
    const app = await _electron.launch({
      executablePath: packageExecutable,
      args: [
        await isolatedModelConfig(root),
        '--provider-evidence=fixture',
        `--library-root=${join(root, 'library')}`,
        `--user-data-dir=${join(root, 'profile')}`,
      ],
    });
    apps.push(app);
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    return { app, page };
  }
  const { app, page } = await launch();
  const output = resolve('test-results/image-workflow');
  await mkdir(output, { recursive: true });
  const shot = async (name: string) => {
    await page.screenshot({ path: join(output, `${name}-1440.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.screenshot({ path: join(output, `${name}-1100.png`), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, input: { kind: string }) => Promise<unknown>> })._invokeHandlers;
    const original = handlers.get('studio:query')!;
    let released = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    (globalThis as unknown as { releaseAssetRead: () => void }).releaseAssetRead = () => { released = true; release(); };
    ipcMain.removeHandler('studio:query');
    ipcMain.handle('studio:query', async (event, input) => {
      if (input.kind === 'asset.search' && !released) await gate;
      return original(event, input);
    });
  });
  await page.getByRole('button', { name: '资产', exact: true }).click();
  await page.getByText('正在读取资料库…', { exact: true }).waitFor();
  await shot('assets-loading');
  await app.evaluate(() => (globalThis as unknown as { releaseAssetRead: () => void }).releaseAssetRead());
  await page.getByText('为你的项目收集素材', { exact: true }).waitFor();
  await shot('assets-empty');
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByRole('button', { name: '新建连接', exact: true }).click();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.getByRole('dialog').count()).toBe(0);
  expect(
    await page
      .getByRole('button', { name: '新建连接', exact: true })
      .evaluate((el) => el === document.activeElement),
  ).toBe(true);
  await page.getByRole('button', { name: '新建连接', exact: true }).click();
  await page.getByLabel('连接名称').fill('本机图像服务');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  expect(await page.getByLabel('连接名称').inputValue()).toBe('本机图像服务');
  await page.getByLabel('Base URL').fill(`http://127.0.0.1:${port}/v1`);
  await page.getByLabel('允许此主机与端口访问私有网络').check();
  await shot('connection-dialog');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  const editorReady = app.waitForEvent('window');
  await page.getByRole('button', { name: '管理凭据', exact: true }).click();
  const editor = await editorReady;
  await editor.getByLabel('API Key').waitFor();
  await editor.screenshot({ path: join(output, 'credential-entry.png') });
  await editor.getByLabel('API Key').fill('dummy-ui-key');
  await editor.getByRole('button', { name: '安全保存' }).click();
  await page.getByText('凭据已保护', { exact: true }).waitFor();
  await page.getByRole('button', { name: '新建模型', exact: true }).click();
  await page.getByLabel('模型名称').fill('图像模型');
  await page.getByLabel('模型 ID').fill('configured-image-model');
  await shot('model-dialog');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await page.getByRole('button', { name: '新建预设', exact: true }).click();
  await page.getByLabel('预设名称').fill('单图默认');
  await shot('preset-dialog');
  await page.getByRole('button', { name: '保存预设', exact: true }).click();
  await shot('models');
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await shot('home-empty');
  await page.getByLabel('项目名称').fill('午后光影');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('button', { name: '打开 午后光影' }).click();
  await page.waitForTimeout(1800);
  await shot('canvas-before-add');
  await page.getByRole('button', { name: '添加生成节点' }).click();
  await shot('canvas-empty-generation');
  await page.getByLabel('提示词').fill('A quiet room with afternoon light');
  await page.waitForTimeout(1800);
  expect(await page.getByLabel('提示词').inputValue()).toBe('A quiet room with afternoon light');
  await page.getByRole('button', { name: '保存内容', exact: true }).click();
  await page.getByText('所有修改已保存', { exact: false }).waitFor();
  await page.getByRole('button', { name: '准备生成', exact: true }).click();
  await page.getByLabel('单次风险额度').fill('1');
  await page.getByLabel('项目预算上限').fill('5');
  await page.getByLabel('我理解费用未知，额度不能限制供应商实际账单').check();
  await shot('approval');
  // Drop the ACK after the real main handler has committed. No renderer bridge or provider is mocked.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, input: { kind: string }) => Promise<unknown>>;
      }
    )._invokeHandlers;
    const original = handlers.get('studio:execute')!;
    ipcMain.removeHandler('studio:execute');
    let dropped = false;
    ipcMain.handle('studio:execute', async (event, input) => {
      const result = await original(event, input);
      if (!dropped && input.kind === 'generation.approveAndEnqueue') {
        dropped = true;
        throw new Error('fixture ACK lost after commit');
      }
      return result;
    });
  });
  expect(posts).toBe(0);
  await page.getByRole('button', { name: '批准并生成一张', exact: true }).click();
  const approval = page.getByRole('dialog');
  await approval.getByRole('button', { name: '核实原回执', exact: true }).waitFor();
  expect(await approval.getByRole('button', { name: '批准并生成一张', exact: true }).isDisabled()).toBe(true);
  await approval.getByRole('button', { name: '核实原回执', exact: true }).click();
  await expect.poll(() => approval.getByRole('button', { name: '核实原回执', exact: true }).count()).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByText('原件已保存', { exact: true }).first().waitFor({ timeout: 20000 });
  expect(posts).toBe(1);
  await shot('tasks');
  await page.getByRole('button', { name: '查看任务' }).first().click();
  await shot('task-detail');
  await page.getByRole('button', { name: '加入资产库', exact: true }).click();
  await page.getByLabel('资产名称').fill('午后原件');
  await page.getByRole('button', { name: '保存资产', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '资产', exact: true }).click();
  await page.getByText('午后原件', { exact: true }).waitFor();
  await shot('assets');
  await page.getByRole('button', { name: '预览 午后原件' }).click();
  await shot('asset-preview');
  await page.getByRole('button', { name: '放入当前画布', exact: true }).click();
  await page.getByRole('button', { name: '画布', exact: true }).click();
  await shot('canvas');
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByText('仅 fixture 已验证', { exact: true }).waitFor();
  await shot('models-fixture');
  await page.getByRole('button', { name: '画布', exact: true }).click();
  await page.setViewportSize({ width: 1100, height: 720 });
  expect(await page.locator('.nav-indicator').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0.18s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.nav-indicator').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.screenshot({ path: join(output, 'canvas-1100-reduced.png') });
  const displayEvidence = await page.evaluate(() => ({
      deviceScaleFactor: devicePixelRatio,
      width: innerWidth,
      height: innerHeight,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
  const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map(d => ({ scaleFactor: d.scaleFactor, bounds: d.bounds, size: d.size })));
  await writeFile(join(output, 'display-evidence.json'), JSON.stringify({ renderer: displayEvidence, displays, platform: process.platform, otherDpiSettings: 'unverified' }, null, 2));
  await app.close();
  apps.splice(apps.indexOf(app), 1);
  const reopened = await launch();
  await reopened.page.getByRole('button', { name: '打开 午后光影' }).click();
  await reopened.page.getByText('媒体 · 固定版本', { exact: true }).waitFor();
  await reopened.page.getByRole('button', { name: '任务', exact: true }).click();
  await reopened.page.getByRole('button', { name: '查看任务' }).first().click();
  await reopened.page.getByText('已加入资产库 · 午后原件', { exact: true }).waitFor();
  expect(posts).toBe(1);
  await reopened.app.close();
  apps.splice(apps.indexOf(reopened.app), 1);
  const db = new DatabaseSync(join(root, 'library', 'library.sqlite'), { readOnly: true });
  expect(db.prepare('SELECT * FROM asset').all()).toHaveLength(1);
  expect(db.prepare('SELECT * FROM artifact').all()).toHaveLength(1);
  const blob = db.prepare('SELECT storage_key FROM blob_object').get() as { storage_key: string };
  db.close();
  expect(await readFile(join(root, 'library', blob.storage_key))).toEqual(png);
}, 90000);

it('keeps canvas drafts across refresh, exposes real conflicts, supports layout undo and imports unrelated media', async () => {
  await mkdir(resolve('test-results/image-workflow'), { recursive: true });
  const root = await mkdtemp(join(tmpdir(), 'libtv-ui-editor-'));
  roots.push(root);
  const app = await _electron.launch({
    executablePath: packageExecutable,
    args: [await isolatedModelConfig(root), `--library-root=${join(root, 'library')}`, `--user-data-dir=${join(root, 'profile')}`],
  });
  apps.push(app);
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 720 });
  const longName = '长名称项目：雨后车站与一场迟来的告别'.repeat(6);
  await page.getByLabel('项目名称').fill(longName);
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('button', { name: `打开 ${longName}` }).click();
  await page.getByRole('button', { name: '添加文本', exact: true }).click();
  await page.getByLabel('文本内容').fill('未保存的文字，等待其他字段更新。');
  const d = await page.evaluate(() => window.studio.describe());
  if (!d.ok) throw Error('descriptor');
  const queryCanvas = async () => {
    const projects = await page.evaluate(
      (d) =>
        window.studio.query({
          schemaVersion: 1,
          libraryId: d.libraryId,
          connectionEpoch: d.connectionEpoch,
          queryId: crypto.randomUUID(),
          kind: 'project.list',
          payload: {},
        }),
      d.value,
    );
    if (!projects.ok) throw Error('projects');
    const result = await page.evaluate(
      ({ d, canvasId }) =>
        window.studio.query({
          schemaVersion: 1,
          libraryId: d.libraryId,
          connectionEpoch: d.connectionEpoch,
          queryId: crypto.randomUUID(),
          kind: 'canvas.read',
          payload: { canvasId },
        }),
      { d: d.value, canvasId: projects.value.projects[0]!.id },
    );
    if (!result.ok) throw Error('canvas');
    return result.value;
  };
  let snapshot = await queryCanvas(),
    node = snapshot.nodes[0]!;
  await page.evaluate(
    ({ d, s, n }) =>
      window.studio.execute({
        schemaVersion: 1,
        libraryId: d.libraryId,
        connectionEpoch: d.connectionEpoch,
        commandId: crypto.randomUUID(),
        kind: 'canvas.applyCommand',
        payload: {
          canvasId: s.canvasId,
          baseRevision: s.revision,
          operations: [
            {
              kind: 'setLayout',
              nodeId: n.nodeId,
              incarnation: n.incarnation,
              expectedRevision: n.layoutRevision,
              layout: { x: 140, y: 100 },
            },
          ],
        },
      }),
    { d: d.value, s: snapshot, n: node },
  );
  await page.waitForTimeout(1800);
  expect(await page.getByLabel('文本内容').inputValue()).toBe('未保存的文字，等待其他字段更新。');
  await page.getByRole('button', { name: '保存内容', exact: true }).click();
  await expect
    .poll(async () => (await queryCanvas()).nodes[0]!.content)
    .toEqual({ type: 'text', text: '未保存的文字，等待其他字段更新。' });
  await page.getByLabel('文本内容').fill('我的冲突草稿');
  snapshot = await queryCanvas();
  node = snapshot.nodes[0]!;
  await page.evaluate(
    ({ d, s, n }) =>
      window.studio.execute({
        schemaVersion: 1,
        libraryId: d.libraryId,
        connectionEpoch: d.connectionEpoch,
        commandId: crypto.randomUUID(),
        kind: 'canvas.applyCommand',
        payload: {
          canvasId: s.canvasId,
          baseRevision: s.revision,
          operations: [
            {
              kind: 'setContent',
              nodeId: n.nodeId,
              incarnation: n.incarnation,
              expectedRevision: n.semanticRevision,
              content: { type: 'text', text: '其他窗口保存的内容' },
            },
          ],
        },
      }),
    { d: d.value, s: snapshot, n: node },
  );
  await page.getByRole('button', { name: '保存内容', exact: true }).click();
  await page.getByRole('button', { name: '以最新版本重试我的草稿' }).waitFor();
  expect(await page.getByLabel('文本内容').inputValue()).toBe('我的冲突草稿');
  await page.screenshot({ path: resolve('test-results/image-workflow/canvas-conflict-1100.png') });
  await page.getByRole('button', { name: '刷新当前版本', exact: true }).click();
  await page.getByRole('button', { name: '以最新版本重试我的草稿' }).click();
  await expect
    .poll(async () => (await queryCanvas()).nodes[0]!.content)
    .toEqual({ type: 'text', text: '我的冲突草稿' });
  const header = page.locator('.canvas-card header').first(),
    box = await header.boundingBox();
  if (!box) throw Error('node');
  await page.mouse.move(box.x + 60, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 45, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect.poll(async () => (await queryCanvas()).nodes[0]!.layout.x).toBeGreaterThan(140);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await queryCanvas()).nodes[0]!.layout.x).toBe(140);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(async () => (await queryCanvas()).nodes[0]!.layout.x).toBeGreaterThan(140);
  const noise = Buffer.from(Array.from({ length: 80 * 60 * 3 }, (_, i) => (i * 73 + 41) % 256));
  const file = join(root, '随机纹理.png');
  await writeFile(
    file,
    await sharp(noise, { raw: { width: 80, height: 60, channels: 3 } })
      .png()
      .toBuffer(),
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [file],
    })) as typeof dialog.showOpenDialog;
  }, file);
  await page.getByRole('button', { name: '资产', exact: true }).click();
  await page.getByRole('button', { name: '导入素材', exact: true }).click();
  await page.getByRole('button', { name: /预览 随机纹理/ }).waitFor();
  await page.getByLabel('搜索资产').fill('没有这个素材');
  await page.getByText('没有匹配的资产', { exact: true }).waitFor();
  await page.getByLabel('搜索资产').fill('');
  await page.screenshot({ path: resolve('test-results/image-workflow/assets-random-1100.png') });
  const assets = await page.evaluate(
    (d) =>
      window.studio.query({
        schemaVersion: 1,
        libraryId: d.libraryId,
        connectionEpoch: d.connectionEpoch,
        queryId: crypto.randomUUID(),
        kind: 'asset.search',
        payload: {},
      }),
    d.value,
  );
  expect(assets).toMatchObject({ ok: true, value: { assets: [{ sourceArtifactRef: null }] } });
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.clock.install();
  await page.getByRole('button', { name: '资产', exact: true }).click();
  const image = page.locator('.asset-card img').first();
  await image.waitFor();
  const previousUrl = await image.getAttribute('src');
  await page.clock.fastForward(90001);
  await expect.poll(() => image.getAttribute('src')).not.toBe(previousUrl);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('studio:query');
    ipcMain.handle('studio:query', () => ({ ok: false, error: { code: 'ENGINE_DISCONNECTED', message: '连接测试：引擎已断开' } }));
  });
  await page.clock.runFor(2000);
  await page.getByText('引擎连接已中断', { exact: true }).waitFor();
  await page.getByRole('button', { name: '画布', exact: true }).click();
  await page.getByLabel('文本内容').fill('断线时仍保留的本地草稿');
  expect(await page.getByRole('button', { name: '保存内容', exact: true }).isDisabled()).toBe(true);
  await page.screenshot({ path: resolve('test-results/image-workflow/canvas-offline-1100.png') });
}, 60000);
