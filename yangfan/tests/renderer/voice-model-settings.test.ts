import { afterAll, beforeAll, expect, it } from 'vitest';
import { harness, mounted, queries } from './p4-harness.ts';
let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.browser.close(); await h?.server.close(); });
it('provides H3, Sync and speech protocols as business fields without raw JSON', async () => {
  await mounted(h, async page => {
    await page.getByLabel('连接名称').fill('Local Sync');
    await page.getByLabel('适配协议').selectOption('sync-lipsync-v2');
    await page.getByLabel('Base URL').fill('https://api.sync.so');
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'provider.saveConnection', payload: { adapterType: 'sync-lipsync-v2', name: 'Local Sync' } });
    expect(await page.locator('textarea').count()).toBe(0);
  }, { ...queries(), __configDialog: { editing: { kind: 'connection' }, connections: [], models: [] } });
});
it('keeps Sync model capabilities fixed with unknown pricing and no image-size control', async () => {
  await mounted(h, async page => {
    await page.getByLabel('模型名称').fill('Sync'); await page.getByLabel('模型 ID').fill('lipsync-2');
    expect(await page.getByLabel('支持尺寸（逗号分隔，可留空）').count()).toBe(0);
    await page.getByRole('button', { name: '保存模型', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'model.saveDefinition', payload: { capabilities: { taskTypes: ['lip_sync'], inputKinds: ['video', 'audio'] }, parameters: {}, pricing: { status: 'unknown' } } });
  }, { ...queries(), __configDialog: { editing: { kind: 'model' }, connections: [{ libraryId: 'library', id: 'sync', revision: 1, adapterType: 'sync-lipsync-v2' }], models: [] } });
});
