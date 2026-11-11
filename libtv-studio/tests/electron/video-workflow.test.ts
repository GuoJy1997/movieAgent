import { packageExecutable, isolatedModelConfig } from './support/product-launch.ts';
import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ArtifactSource } from '../../packages/providers/src/artifact-source';

let app: ElectronApplication | undefined, server: Server | undefined, root: string;
afterEach(async () => {
  await app?.close(); app = undefined;
  if (server) { server.closeAllConnections(); await new Promise<void>(r => server!.close(() => r())); }
  if (root) await rm(root, { recursive: true, force: true });
});

// Catches image-only model configuration, wrong frozen video parameters, duplicate POST,
// non-playable app-media rendering, token refresh resetting playback, and lost saved output.
it('approves one native video from the UI, plays durable output, saves it and restores canvas after reopen', async () => {
  root = await mkdtemp(join(tmpdir(), 'movieagent-video-ui-'));
  const library = join(root, 'library'), sample = await readFile(resolve('tests/fixtures/video-portrait.mp4'));
  let posts = 0, queries = 0, complete = false, body: unknown;
  server = createServer((req, res) => {
    let input = ''; req.on('data', c => { input += c; }); req.on('end', () => {
      if (req.method === 'POST' && req.url === '/v2/video_generation') {
        posts++; body = JSON.parse(input); res.end(JSON.stringify({ task_id: 'ui-video-1' }));
      } else if (req.method === 'GET' && req.url === '/v2/query/video_generation/ui-video-1') {
        queries++; res.end(JSON.stringify({ task: { id: 'ui-video-1', status: complete ? 'succeeded' : 'running', content: complete ? { url: 'https://cdn.example/fixture.mp4' } : {} } }));
      } else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const launch = async () => {
    app = await _electron.launch({ executablePath: packageExecutable, args: [await isolatedModelConfig(root), '--provider-evidence=fixture', `--library-root=${library}`, `--user-data-dir=${join(root, 'profile')}`] });
    const page = await app.firstWindow(); await page.setViewportSize({ width: 1440, height: 900 }); return page;
  };
  let page = await launch();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByRole('button', { name: '新建连接', exact: true }).click();
  await page.getByLabel('连接名称').fill('视频 fixture');
  await page.getByLabel('适配协议').selectOption('minimax-video-v2');
  await page.getByLabel('Base URL').fill(`http://127.0.0.1:${port}/v1`);
  await page.getByLabel('允许此主机与端口访问私有网络').check();
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await page.getByRole('button', { name: '新建模型', exact: true }).click();
  await page.getByLabel('模型名称').fill('MiniMax 视频');
  await page.getByLabel('模型 ID').fill('MiniMax-H3-Highspeed');
  await page.getByLabel('每秒价格（留空为未知）').fill('0.4');
  await page.getByLabel('计价币种').fill('CNY');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await page.getByRole('button', { name: '新建预设', exact: true }).click();
  await page.getByLabel('预设名称').fill('4秒竖屏视频');
  expect(await page.getByLabel('时长（秒）').inputValue()).toBe('4');
  expect(await page.getByLabel('分辨率').inputValue()).toBe('768P');
  expect(await page.getByLabel('画面比例').inputValue()).toBe('9:16');
  await page.getByRole('button', { name: '保存预设', exact: true }).click();
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByLabel('项目名称').fill('视频闭环');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('button', { name: '打开 视频闭环', exact: true }).click();
  await page.getByRole('button', { name: '添加生成节点', exact: true }).click();
  await page.getByLabel('生成预设').selectOption({ label: '4秒竖屏视频 · v1' });
  await page.getByLabel('提示词').fill('Moving clouds above a quiet lake');
  await page.getByRole('button', { name: '保存内容', exact: true }).click();
  await page.getByRole('button', { name: '准备生成', exact: true }).click();
  expect(await page.getByRole('dialog').textContent()).toContain('CNY 1.6');
  await page.getByLabel('单次风险额度').fill('1.6');
  await page.getByLabel('项目预算上限').fill('1.6');
  await page.getByRole('button', { name: '批准并生成视频', exact: true }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByText('供应方已接单', { exact: true }).first().waitFor();
  expect(posts).toBe(1);
  expect(body).toEqual({ model: 'MiniMax-H3-Highspeed', content: [{ type: 'text', text: 'Moving clouds above a quiet lake' }], duration: 4, resolution: '768P', ratio: '9:16' });
  const db = new DatabaseSync(join(library, 'library.sqlite'), { readOnly: true });
  const attempt = db.prepare('SELECT attempt_id AS id FROM task_attempt').get() as { id: string }; db.close();
  // Pre-stage immutable MP4: real provider/main/utility pathway still collects and publishes it.
  // This fixture does not weaken production public-CDN download/private-network controls.
  expect((await new ArtifactSource(library, undefined, 'video').stage(`${attempt.id}-output`, sample)).ok).toBe(true);
  complete = true;
  await page.getByText('原件已保存', { exact: true }).first().waitFor({ timeout: 30000 });
  await page.clock.install();
  await page.getByRole('button', { name: '查看任务', exact: true }).click();
  await page.getByRole('dialog').getByText('结果已确认', { exact: true }).waitFor();
  const video = page.locator('dialog video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((v: HTMLVideoElement) => ({ width: v.videoWidth, height: v.videoHeight, controls: v.controls }))).toEqual({ width: 768, height: 1344, controls: true });
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  const source = await video.getAttribute('src');
  // Observe the real completed HEAD without relying on custom-protocol network events.
  await page.evaluate(previousSource => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (args[1]?.method === 'HEAD' && response.url.startsWith('app-media://') && response.url !== previousSource) {
        const bytes = await response.clone().arrayBuffer();
        window.fetch = originalFetch;
        document.body.dataset.completedVideoRefresh = JSON.stringify({ status: response.status, mime: response.headers.get('content-type'), bytes: bytes.byteLength });
      }
      return response;
    };
  }, source);
  await page.clock.fastForward(90001);
  await page.clock.resume();
  await page.waitForFunction(() => Boolean(document.body.dataset.completedVideoRefresh));
  expect(await page.evaluate(() => JSON.parse(document.body.dataset.completedVideoRefresh!))).toEqual({ status: 200, mime: 'video/mp4', bytes: 0 });
  // The completed fetch resolves the query; two frames also let its React effects commit.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await video.getAttribute('src')).toBe(source);
  await video.evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 0.25; v.dispatchEvent(new Event('error')); });
  await expect.poll(() => video.getAttribute('src')).not.toBe(source);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(0.25, 1);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.4);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await page.waitForTimeout(250);
  await mkdir(resolve('test-results/video-workflow'), { recursive: true });
  await page.screenshot({ path: resolve('test-results/video-workflow/task-player.png') });
  await page.getByRole('button', { name: '加入资产库', exact: true }).click();
  await page.getByLabel('资产名称').fill('视频原件');
  await page.getByRole('button', { name: '保存资产', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '资产', exact: true }).click();
  await page.getByRole('button', { name: '预览 视频原件', exact: true }).click();
  await expect.poll(() => page.locator('dialog video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: '放入当前画布', exact: true }).click();
  await page.getByRole('button', { name: '画布', exact: true }).click();
  await expect.poll(() => page.locator('.canvas-card video').count()).toBe(2);
  await page.locator('.canvas-card').filter({ hasText: '固定版本' }).click();
  const inspectorVideo = page.locator('.inspector-media video');
  await expect.poll(() => inspectorVideo.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const inspectorLayout = await inspectorVideo.evaluate((v: HTMLVideoElement) => {
    const video = v.getBoundingClientRect(), wrapper = v.parentElement!.getBoundingClientRect();
    const sidebar = v.closest('.inspector-scroll')!;
    return {
      contained: video.left >= wrapper.left - 1 && video.right <= wrapper.right + 1,
      aspectRatio: video.width / video.height,
      horizontalOverflow: sidebar.scrollWidth > sidebar.clientWidth,
      controls: v.controls,
    };
  });
  await page.locator('.canvas-card').filter({ hasText: '媒体生成' }).click();
  await page.getByRole('button', { name: '输出历史', exact: true }).click();
  const historyVideo = page.locator('.history-media video');
  await expect.poll(() => historyVideo.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const historyLayout = await historyVideo.evaluate((v: HTMLVideoElement) => {
    const video = v.getBoundingClientRect(), wrapper = v.parentElement!.getBoundingClientRect();
    const item = v.closest('.history-item')!, text = item.querySelector('p')!.getBoundingClientRect();
    const action = item.querySelector('button')!.getBoundingClientRect();
    return {
      contained: video.left >= wrapper.left - 1 && video.right <= wrapper.right + 1 && video.top >= wrapper.top - 1 && video.bottom <= wrapper.bottom + 1,
      wrapperHeight: wrapper.height,
      textAndActionBelowPlayer: text.top >= video.bottom && action.top >= video.bottom,
      objectFit: getComputedStyle(v).objectFit,
      controls: v.controls,
    };
  });
  console.info('Portrait sidebar layout:', JSON.stringify({ inspectorLayout, historyLayout }));
  expect(inspectorLayout).toMatchObject({ contained: true, horizontalOverflow: false, controls: true });
  expect(inspectorLayout.aspectRatio).toBeCloseTo(768 / 1344, 3);
  expect(historyLayout).toEqual({ contained: true, wrapperHeight: 140, textAndActionBelowPlayer: true, objectFit: 'contain', controls: true });
  await page.getByRole('button', { name: '选择此输出', exact: true }).click({ trial: true });
  await page.screenshot({ path: resolve('test-results/video-workflow/portrait-history.png') });
  await app!.close(); app = undefined; page = await launch();
  await page.getByRole('button', { name: '打开 视频闭环', exact: true }).click();
  await expect.poll(() => page.locator('.canvas-card video').count()).toBe(2);
  await page.getByRole('button', { name: '资产', exact: true }).click();
  await page.getByRole('button', { name: '预览 视频原件', exact: true }).click();
  await expect.poll(() => page.locator('dialog video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  expect(posts).toBe(1); expect(queries).toBeGreaterThan(0);
}, 90000);
