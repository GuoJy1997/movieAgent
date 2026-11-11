import { afterAll, beforeAll, expect, it } from 'vitest';
import { harness, mounted } from './p4-harness.ts';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.browser.close(); await h?.server.close(); });

const run = {
  libraryId: 'library', sessionId: 'session', runId: 'run', projectId: 'project', state: 'PROPOSED', stopped: false, harvested: true,
  task: null, action: null, errorCode: null,
  prepared: {
    message: '修订配音文案', createdAt: 1, executionOwner: 'human',
    template: { name: '配音文案修订', kind: 'voice-lines' },
    generation: { config: { model: { name: 'Fixture text' } } },
    targets: {
      kind: 'voice-lines',
      script: { id: 'script', revision: 1 },
      shots: [{ key: 'shot-0', value: { id: 'shot', revision: 2, title: '开门' } }],
      voiceLines: [{ key: 'line-0', value: { id: 'line', revision: 3, text: '旧台词', shotRef: { id: 'shot', revision: 2 } } }],
    },
    context: { sources: [], included: [], omitted: [], notice: 'Only local content', promptCharacters: 100 },
  },
  proposal: {
    proposalHash: 'a'.repeat(64), expiresAt: Date.now() + 600000,
    draft: { version: 1, kind: 'voice-lines', reply: '已修订', lines: [{ key: 'line-0', text: '新台词', shotKey: 'shot-0' }, { key: 'new-line', text: '新增一句', shotKey: 'shot-0' }] },
  },
  messages: [{ runId: 'run', role: 'assistant', text: '已修订', createdAt: 2 }],
};

it('shows real before/after diffs, captured versions, dependencies and the exact adoption subset', async () => {
  await mounted(h, async page => {
    await page.getByText('旧台词', { exact: true }).waitFor();
    await page.getByText('新台词', { exact: true }).waitFor();
    await page.getByText('捕获版本 v3', { exact: false }).waitFor();
    await page.getByText('开门 · 镜头 r2', { exact: true }).first().waitFor();
    expect(await page.evaluate(() => window.p4Fixture.calls)).toEqual([]);
    await page.getByLabel('采用文案 new-line', { exact: true }).uncheck();
    await page.getByText('本次不采用：new-line', { exact: false }).waitFor();
    await page.getByRole('button', { name: '采用所选成片提案', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({
      kind: 'finish.acceptProposal',
      payload: { projectId: 'project', runId: 'run', proposalHash: 'a'.repeat(64), selectedKeys: ['line-0'], executionOwner: 'human' },
    });
  }, { __finishRun: run });
});

it('keeps an accepted receipt visible without offering another adoption', async () => {
  const accepted = {
    ...run, state: 'ACCEPTED',
    action: { selectedKeys: ['line-0'], skippedKeys: ['new-line'], result: { kind: 'voice-lines', voiceLines: [{ id: 'line', revision: 4, text: '新台词' }] } },
  };
  await mounted(h, async page => {
    await page.getByText('采用已确认', { exact: true }).waitFor();
    await page.getByText('文案 line · 新修订 r4', { exact: true }).waitFor();
    await page.getByText('未采用：new-line', { exact: false }).waitFor();
    expect(await page.getByRole('button', { name: '采用所选成片提案', exact: true }).count()).toBe(0);
  }, { __finishRun: accepted });
});
