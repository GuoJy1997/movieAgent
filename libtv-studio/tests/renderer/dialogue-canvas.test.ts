import { afterAll, beforeAll, expect, it } from 'vitest';
import { harness, mounted } from './p4-harness.ts';
import { dialogueData, media } from './voice-fixtures.ts';
let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.browser.close(); await h?.server.close(); });
it('opens the bound dialogue from the actual canvas card without starting graph execution', async () => {
  const data = dialogueData(); data.__creation = false; data.__canvas = true;
  (data['creation.read'] as any).selections = [{ shotId: 'shot', selectionRevision: 3, video: media, dialogue: { route: 'dubbed-lipsync' } }];
  data['canvas.read'] = { canvasId: 'project', revision: 1, outputs: [], edges: [], nodes: [{ nodeId: 'node', incarnation: 'one', semanticRevision: 1, layoutRevision: 1, selectionRevision: 1, content: { type: 'generation', prompt: 'Fixed shot', profileRef: { libraryId: 'library', id: 'video', revision: 1 } }, layout: { x: 100, y: 100 }, selectedOutput: media, freshness: 'current', activeTask: null, shotBinding: { projectId: 'project', scriptId: 'script', scriptRevision: 1, sceneId: 'scene', shotId: 'shot', shotRevision: 1, productionId: 'production', role: 'video' } }] };
  await mounted(h, async page => {
    await page.getByText('声音来源：独立配音＋修正画面', { exact: true }).waitFor();
    await page.getByRole('button', { name: '打开对白/剪辑', exact: true }).click();
    await page.getByRole('region', { name: '结构化对白', exact: true }).waitFor();
    expect(await page.getByLabel('台词 1', { exact: true }).inputValue()).toBe('已保存台词');
    expect(await page.evaluate(() => window.p4Fixture.calls)).toEqual([]);
  }, data);
});
