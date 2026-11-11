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

async function budgetValue(page:Page) {await page.getByRole('button',{name:'偏好',exact:true}).click();const value=await page.getByLabel('输出 token 预算（留空沿用预设）').inputValue();await page.keyboard.press('Escape');return value;}
async function setBudget(page:Page,value:string) {await page.getByRole('button',{name:'偏好',exact:true}).click();await page.getByLabel('输出 token 预算（留空沿用预设）').fill(value);await page.keyboard.press('Escape');}
for(const budget of [8192,2048])it('inherits preset '+budget+' with no explicit override',async()=>{
 const queries=data();Object.assign(queries['profile.list'].profiles[0]!,{parameters:{max_completion_tokens:budget}});
 await withPage('agent',async page=>{
  await page.getByRole('button',{name:'偏好',exact:true}).click();
  expect(await page.getByLabel('输出 token 预算（留空沿用预设）').inputValue()).toBe('');
  expect(await page.getByText('沿用模型预设：'+budget+' token',{exact:true}).count()).toBe(1);
  await page.keyboard.press('Escape');
  await page.getByLabel('创作需求',{exact:true}).fill('写一个开场');
  await page.getByRole('button',{name:'准备这一轮规划',exact:true}).click();await waitCalls(page,1);
  expect(await page.evaluate(()=>window.p3Fixture.calls[0]!.payload)).not.toHaveProperty('outputTokens');
 },queries);
});
it('retains manual edits on redraw, resets on session/preset/revision, and sends only explicit valid override',async()=>{
 const queries=data();queries['profile.list'].profiles.push({...profile,id:'other',name:'备用预设'});
 await withPage('agent',async page=>{
  await setBudget(page,'512');await page.getByLabel('创作需求',{exact:true}).fill('测试');
  expect(await budgetValue(page)).toBe('512');
  await page.getByRole('button',{name:'准备这一轮规划',exact:true}).click();await waitCalls(page,1);
  expect(await page.evaluate(()=>window.p3Fixture.calls[0]!.payload.outputTokens)).toBe(512);
  await page.evaluate(()=>window.p3Fixture.resolve(undefined));
  await page.getByRole('button',{name:'模型',exact:true}).click();
  await page.getByLabel('规划文本预设').selectOption({label:'备用预设 · v1'});await page.keyboard.press('Escape');
  expect(await budgetValue(page)).toBe('');
  await setBudget(page,'1024');await page.getByRole('button',{name:'会话 B · 全能创作',exact:true}).click();
  expect(await budgetValue(page)).toBe('');
  await setBudget(page,'700');await page.getByRole('button',{name:'偏好',exact:true}).click();
  await page.getByRole('button',{name:'恢复沿用预设',exact:true}).click();await page.keyboard.press('Escape');
  expect(await budgetValue(page)).toBe('');
  await setBudget(page,'600');await page.evaluate(()=>window.p3Fixture.update({'profile.list':{profiles:[{libraryId:'library',id:'other',revision:2,name:'备用预设',modelRef:{libraryId:'library',id:'model',revision:1},parameters:{}}]}}));
  expect(await budgetValue(page)).toBe('');
  await setBudget(page,'8193');expect(await page.getByRole('button',{name:'准备这一轮规划',exact:true}).isDisabled()).toBe(true);
  expect(await page.evaluate(()=>window.p3Fixture.calls.length)).toBe(1);
 },queries);
});