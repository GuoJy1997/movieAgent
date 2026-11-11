import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import type {} from '../fixtures/p3-renderer/main.tsx';

let server: ViteDevServer;
let browser: Browser;
let address: string;
const base = { libraryId: 'library', projectId: 'project', revision: 1, createdAt: '2026-10-27T00:00:00.000Z' };
const entity = { ...base, id: 'entity-a', kind: 'character', name: '实体 A', description: '', constraints: '', references: [] };
const script = { ...base, id: 'script-a', title: '剧本 A', synopsis: '', body: '', scenes: [{ id: 'scene-a', title: '第一场', location: '', time: '', description: '' }] };
const otherScript = { ...script, id: 'script-b', title: '剧本 B', scenes: [{ ...script.scenes[0]!, id: 'scene-b' }] };
const shot = { ...base, id: 'shot-a', scriptId: 'script-a', sceneId: 'scene-a', order: 0, title: '镜头 A', durationSeconds: 5, shotSize: '中景', cameraMovement: '固定', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] };
const profile = { libraryId: 'library', id: 'profile', revision: 1, name: '本地测试预设', modelRef: { libraryId: 'library', id: 'model', revision: 1 } };
const model = { id: 'model', revision: 1, name: '本地测试模型', modelId: 'fixture', capabilities: { outputKinds: ['text'] } };
const template = { id: 'short-film', revision: 1, name: '短片', description: '', instructions: '', allowed: ['script', 'entity', 'shot'], suggestedShots: 1, suggestedOutputTokens: 4096 };
const prepared = { libraryId: 'library', sessionId: 'session-a', runId: 'run-a', projectId: 'project', executionOwner: 'desktop-user', mode: 'all', message: '原需求', template, targets: { script: null, shots: [], entities: [], assets: [] }, context: { projectId: 'project', sources: [], included: [], omitted: [], promptCharacters: 10, notice: 'fixture' }, sourceProfileRef: { libraryId: 'library', id: 'profile', revision: 1 }, createdAt: 1,
  generation: { preparedId: 'prepared', planHash: 'a'.repeat(64), executionOwner: 'desktop-user', runId: 'run-a', currency: null, estimateMicros: null, prompt: 'fixture', expiresAt: 9999999999999, config: { model, profile, connection: { baseUrl: 'http://127.0.0.1/unused' }, parameters: {} } } };
const session = { libraryId: 'library', projectId: 'project', sessionId: 'session-a', title: '会话 A', mode: 'all', executionOwner: 'desktop-user', createdAt: 1, runs: [], messages: [] };
const otherSession = { ...session, sessionId: 'session-b', title: '会话 B' };
function data() { return {
  'creation.read': { libraryId: 'library', projectId: 'project', scripts: [script, otherScript], shots: [shot], entities: [entity, { ...entity, id: 'entity-b', name: '实体 B' }], selections: [], snapshotSeq: 1 },
  'profile.list': { profiles: [profile] }, 'model.list': { models: [model] }, 'workflow.list': { workflows: [] }, 'asset.search': { assets: [] },
  'agent.list': { libraryId: 'library', projectId: 'project', sessions: [session, otherSession] }, 'agent.templates': { templates: [template] },
  'agent.read:session-a': session, 'agent.read:session-b': otherSession,
}; }

beforeAll(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: resolve('node_modules/.vite-p3-fixture'), server: { host: '127.0.0.1', port: 0, watch: null },
    optimizeDeps: { entries: ['tests/fixtures/p3-renderer/main.tsx'] },
    esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'p3-runtime-fixture', enforce: 'pre', resolveId(id) {
      if (id.endsWith('/runtime.tsx')) return resolve('tests/fixtures/p3-renderer/runtime.ts');
    }, configureServer(vite) { vite.middlewares.use('/p3-fixture', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/tests/fixtures/p3-renderer/main.tsx"></script>'); }); } }],
  });
  await server.listen();
  const info = server.httpServer!.address();
  address = `http://127.0.0.1:${typeof info === 'object' && info ? info.port : 0}/p3-fixture`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.MOVIEAGENT_TEST_CHROMIUM });
  const readiness=await browser.newPage();await readiness.goto(address);await readiness.waitForFunction(()=>!!window.p3Fixture);await readiness.close();
}, 30_000);
afterAll(async () => { await browser?.close(); await server?.close(); });

async function withPage(pageKind: 'entity' | 'creation' | 'agent', run: (page: Page) => Promise<void>, queries = data()) {
  const page = await browser.newPage();
  page.setDefaultTimeout(4_000);
  const errors: string[] = [];
  const posts: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  try {
    await page.goto(address);
    await page.waitForFunction(() => Boolean(window.p3Fixture));
    await page.evaluate(({ pageKind, queries }) => window.p3Fixture.mount(pageKind, queries), { pageKind, queries });
    if(pageKind==='agent')await page.getByText('会话与模式',{exact:true}).click();
    await run(page);
    expect(errors).toEqual([]);
    expect(posts).toEqual([]);
  } catch (error) {
    if (errors.length) throw new Error(`${String(error)}; renderer errors: ${errors.join('; ')}`);
    throw error;
  } finally { await page.close(); }
}
async function waitCalls(page: Page, count: number) { await page.waitForFunction(count => window.p3Fixture.calls.length === count, count); }
async function ackSaved(page: Page, index = 0) {
  await page.evaluate(index => {
    const payload = window.p3Fixture.calls[index]!.payload;
    const { expectedRevision, ...content } = payload;
    window.p3Fixture.resolve({ ...content, libraryId: 'library', revision: Number(expectedRevision) + 1, createdAt: '2026-10-27T00:00:00.000Z' });
  }, index);
}

for (const [kind, open, label, save, saved] of [
  ['entity', '编辑 实体 A', '实体名称', '保存实体', '实体已保存'],
  ['creation', '编辑剧本与场景', '剧本标题', '保存剧本', '剧本已保存'],
  ['creation', '编辑镜头 镜头 A', '镜头标题', '保存镜头', '镜头已保存'],
] as const) {
  it(`${save}: preserves edits made after submission and advances revision for the next actual save`, async () => {
    await withPage(kind, async page => {
      await page.getByRole('button', { name: open, exact: true }).click();
      await page.getByLabel(label, { exact: true }).fill('提交 A');
      await page.getByRole('button', { name: save, exact: true }).click();
      await waitCalls(page, 1);
      await page.getByLabel(label, { exact: true }).fill('后续 B');
      await ackSaved(page);
      await expect.poll(() => page.getByLabel(label, { exact: true }).inputValue()).toBe('后续 B');
      expect(await page.getByText(saved, { exact: true }).count()).toBe(0);
      expect(await page.getByText('有未保存的修改', { exact: true }).count()).toBe(1);
      await page.getByRole('button', { name: save, exact: true }).click();
      await waitCalls(page, 2);
      expect(await page.evaluate(() => window.p3Fixture.calls[1]!.payload)).toMatchObject({ expectedRevision: 2, [label === '实体名称' ? 'name' : 'title']: '后续 B' });
      await ackSaved(page, 1);
      await expect.poll(() => page.getByText(saved, { exact: true }).count()).toBe(1);
      expect(await page.getByText('有未保存的修改', { exact: true }).count()).toBe(0);
    });
  });
}

for (const target of ['entity', 'script', 'shot'] as const) {
  it(`${target}: ignores the old save callback after selecting another editor/script`, async () => {
    await withPage(target === 'entity' ? 'entity' : 'creation', async page => {
      await page.getByRole('button', { name: target === 'entity' ? '编辑 实体 A' : target === 'script' ? '编辑剧本与场景' : '编辑镜头 镜头 A', exact: true }).click();
      await page.getByRole('button', { name: target === 'entity' ? '保存实体' : target === 'script' ? '保存剧本' : '保存镜头', exact: true }).click();
      await waitCalls(page, 1);
      if (target === 'entity') {
        await page.getByRole('button', { name: '编辑 实体 B', exact: true }).click();
        await page.getByLabel('实体名称', { exact: true }).fill('B 草稿');
      } else {
        await page.getByLabel('当前剧本', { exact: true }).selectOption('script-b');
        await page.getByRole('button', { name: target === 'script' ? '编辑剧本与场景' : '新建镜头', exact: true }).click();
        await page.getByLabel(target === 'script' ? '剧本标题' : '镜头标题', { exact: true }).fill('B 草稿');
      }
      await ackSaved(page);
      // Flush the acknowledgement React update through a paint before inspecting selection.
      await page.evaluate(() => new Promise(requestAnimationFrame));
      if (target === 'entity') {
        const refreshed = data()['creation.read'];
        refreshed.entities[1] = { ...entity, id: 'entity-b', name: 'B 最新', revision: 3 };
        await page.evaluate(snapshot => window.p3Fixture.update({ 'creation.read': snapshot }), refreshed);
        await page.getByRole('button', { name: '放弃草稿并读取最新实体' }).click();
        expect(await page.getByLabel('实体名称', { exact: true }).inputValue()).toBe('B 最新');
        await page.getByLabel('实体名称', { exact: true }).fill('B 草稿');
      }
      if (target !== 'entity') expect(await page.getByLabel('当前剧本', { exact: true }).inputValue()).toBe('script-b');
      await page.getByRole('button', { name: target === 'entity' ? '保存实体' : target === 'script' ? '保存剧本' : '保存镜头', exact: true }).click();
      await waitCalls(page, 2);
      const payload = await page.evaluate(() => window.p3Fixture.calls[1]!.payload);
      expect(payload).toMatchObject(target === 'entity' ? { id: 'entity-b', name: 'B 草稿' } : target === 'script' ? { id: 'script-b', title: 'B 草稿' } : { scriptId: 'script-b', title: 'B 草稿' });
    });
  });
}

it('Agent preserves the next request typed while preparing, but clears an unchanged submitted request', async () => {
  await withPage('agent', async page => {
    const field = page.getByLabel('创作需求', { exact: true });
    await field.fill('请求 A');
    await page.getByRole('button', { name: '准备这一轮规划' }).click();
    await waitCalls(page, 1);
    await field.fill('请求 B');
    await page.evaluate(prepared => window.p3Fixture.resolve(prepared), prepared);
    await page.getByRole('button', { name: '暂不生成' }).waitFor();
    expect(await field.inputValue()).toBe('请求 B');
    await page.getByRole('button', { name: '暂不生成' }).click();
    await page.getByRole('button', { name: '准备这一轮规划' }).click();
    await waitCalls(page, 2);
    await page.evaluate(prepared => window.p3Fixture.resolve(prepared), prepared);
    await expect.poll(() => field.inputValue()).toBe('');
  });
});

it('Agent ignores preparation acknowledgement after switching sessions', async () => {
  await withPage('agent', async page => {
    await page.getByLabel('创作需求', { exact: true }).fill('请求 A');
    await page.getByRole('button', { name: '准备这一轮规划' }).click();
    await waitCalls(page, 1);
    await page.getByRole('button', { name: '会话 B · 全能创作' }).click();
    await page.getByLabel('创作需求', { exact: true }).fill('请求 B');
    await page.evaluate(prepared => window.p3Fixture.resolve(prepared), prepared);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await page.getByRole('dialog').count()).toBe(0);
    expect(await page.getByLabel('创作需求', { exact: true }).inputValue()).toBe('请求 B');
  });
});

it('Agent does not navigate away from a newer session when an old create-session acknowledgement arrives', async () => {
  await withPage('agent', async page => {
    await page.getByRole('button', { name: '创建创作会话' }).click();
    await waitCalls(page, 1);
    await page.getByRole('button', { name: '会话 B · 全能创作' }).click();
    await page.getByLabel('创作需求', { exact: true }).fill('B 的需求');
    await page.evaluate(result => window.p3Fixture.resolve(result), { ...session, sessionId: 'session-new', title: '迟到新会话' });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await page.getByLabel('创作需求', { exact: true }).inputValue()).toBe('B 的需求');
    expect(await page.getByRole('heading', { name: '会话 B 全能创作' }).count()).toBe(1);
  });
});

it('Agent request accepts the contract maximum and prevents an overlong form request', async () => {
  await withPage('agent', async page => {
    const field = page.getByLabel('创作需求', { exact: true });
    await field.fill('字'.repeat(4001));
    expect((await field.inputValue()).length).toBe(4000);
    await page.getByRole('button', { name: '准备这一轮规划' }).click();
    await waitCalls(page, 1);
    expect(await page.evaluate(() => String(window.p3Fixture.calls[0]!.payload.message).length)).toBe(4000);
  });
});

it('renders persisted normal, stopped-late and proposal replies once per matching run, including reopen with no command/POST', async () => {
  const runs = ['REPLIED', 'STOPPED', 'PROPOSED'].map((state, index) => ({ libraryId: 'library', sessionId: 'session-a', runId: `run-${index}`, projectId: 'project', state, stopped: state === 'STOPPED', prepared: { ...prepared, runId: `run-${index}`, message: `请求 ${index}` }, task: null, proposal: state === 'PROPOSED' ? { proposalHash: 'a'.repeat(64), expiresAt: 9999999999999, draft: { schemaVersion: 1, reply: '提案答复', script: null, entities: [], shots: [] } } : null, action: null, errorCode: null, harvested: true }));
  const messages = [{ runId: 'unrelated', role: 'assistant', text: '不属于任何轮次', createdAt: 1 }, ...['普通答复', '停止后的迟到答复', '提案答复'].map((text, index) => ({ runId: `run-${index}`, role: 'assistant', text, createdAt: index + 1 }))];
  const queries = { ...data(), 'agent.read:session-a': { ...session, runs, messages } };
  await withPage('agent', async page => {
    for (let reopen = 0; reopen < 2; reopen++) {
      if (reopen) await page.evaluate(queries => window.p3Fixture.mount('agent', queries), queries);
      for (const [index, answer] of ['普通答复', '停止后的迟到答复', '提案答复'].entries()) {
        const card = page.locator('.agent-run').nth(index);
        await expect.poll(() => card.getByText(answer, { exact: true }).count()).toBe(1);
      }
      expect(await page.locator('.agent-run').nth(1).getByText('已停止', { exact: true }).count()).toBe(1);
      expect(await page.getByText('不属于任何轮次', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => window.p3Fixture.calls)).toEqual([]);
    }
  }, queries as ReturnType<typeof data>);
});
