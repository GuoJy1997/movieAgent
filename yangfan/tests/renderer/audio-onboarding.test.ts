import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
let server: ViteDevServer, browser: Browser, address = '';
beforeAll(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: 'node_modules/.vite-settings-fixture', optimizeDeps: { entries: ['apps/desktop/src/model-config/index.html'] }, server: { host: '127.0.0.1', port: 0, watch: null } });
  await server.listen();
  const info = server.httpServer!.address();
  address = `http://127.0.0.1:${typeof info === 'object' && info ? info.port : 0}/apps/desktop/src/model-config/index.html`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.MOVIEAGENT_TEST_CHROMIUM });
  const readiness=await browser.newPage();await readiness.addInitScript(()=>{(window as any).modelConfigEntry={info:async()=>({ok:true,value:{config:{source:'fixture',version:'a'.repeat(64),providers:[]},providerId:null}})};});await readiness.goto(address);await readiness.waitForFunction(()=>!!document.getElementById('category'));await readiness.close();
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
it('uses the actual protected settings form for speech, finite test approval and receipt invalidation', async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      (window as any).modelConfigEntry = {
        info: async () => ({ ok: true, value: { config: { source: 'fixture', version: 'a'.repeat(64), providers: [] }, providerId: null } }),
        prepareAudioTest: async (input: unknown) => { (window as any).preparedAudio = input; return { ok: true, value: { testId: 'test', planHash: 'b'.repeat(64), summary: '你好，配音测试。', expiresAt: Date.now() + 60000 } }; },
        runAudioTest: async (input: unknown) => { (window as any).approvedAudio = input; return { ok: true, value: { receipt: 'verified' } }; },
        submit: async (input: unknown) => { (window as any).savedAudio = input; return { ok: true, value: { status: 'saved' } }; },
      };
    });
    await page.goto(address);
    await page.selectOption('#category', 'speech');
    await page.fill('#baseURL', 'https://audio.example/v1');
    await page.fill('#key', 'fixture-key');
    await page.fill('#modelId', 'manual-model');
    await page.fill('#parameter-voice', 'manual-voice');
    expect(await page.locator('#save').isDisabled()).toBe(true);
    await page.click('#test-model');
    expect(await page.locator('#audio-test-approval').isVisible()).toBe(true);
    await page.fill('#audio-allowance', '0.01');
    await page.check('#audio-risk');
    await page.click('#audio-run');
    await page.waitForFunction(() => (document.getElementById('save') as HTMLButtonElement).disabled === false);
    const approved = await page.evaluate(() => (window as any).approvedAudio);
    expect(approved.approval).toEqual({ currency: 'CNY', allowanceMicros: 10000, budgetLimitMicros: 10000, acknowledgeUnknown: true });
    await page.fill('#parameter-voice', 'changed-voice');
    expect(await page.locator('#save').isDisabled()).toBe(true);
  } catch (error) { throw Error(String(error) + '\n' + errors.join('\n') + '\n' + await page.locator('body').innerText()); }
  finally { await page.close(); }
});
