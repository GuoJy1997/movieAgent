import { afterAll, beforeAll, expect, it } from 'vitest';
import { harness, mounted } from './p4-harness.ts';
let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.browser.close(); await h?.server.close(); });

for (const action of ['save', 'discard', 'owner-unmount', 'unmount'] as const) it(`clears the actual main dirty token after final-owner ${action}`, async () => {
  await mounted(h, async page => {
    await page.getByLabel('草稿 a').fill('A');
    expect(await page.evaluate(() => window.p4Fixture.mayQuit())).toBe(false);
    if (action === 'unmount') await page.evaluate(() => window.p4Fixture.unmount());
    else if (action === 'owner-unmount') await page.getByRole('button',{name:'卸载 A'}).click();
    else {
      await page.getByRole('button', { name: '离开探针' }).click();
      await page.getByRole('button', { name: action === 'save' ? '保存并离开' : '放弃草稿并离开' }).click();
      if (action === 'save') await page.evaluate(() => window.p4Fixture.resolve({ revision: 1, text: 'A' }));
    }
    await expect.poll(() => page.evaluate(() => window.p4Fixture.mayQuit())).toBe(true);
    const states = await page.evaluate(() => window.p4Fixture.bridgeCalls.filter(call => call.kind === 'setTimelineDraftState').map(call => call.payload as { dirty:boolean;token:string }));
    expect(states.at(-1)?.token).toBe(states.filter(state => state.dirty).at(-1)?.token);
  }, { __draftOwners: true });
});

it('rejects an older clean token after a later dirty generation', async () => {
  await mounted(h, async page => {
    await page.getByLabel('草稿 a').fill('A');
    const old = await page.evaluate(() => window.p4Fixture.bridgeCalls.filter(call => call.kind === 'setTimelineDraftState').at(-1)!.payload as {dirty:boolean;token:string});
    await page.getByLabel('草稿 a').fill('B');
    await page.evaluate(old => window.p4Fixture.updateMainDraft({ ...old, dirty:false }), old);
    expect(await page.evaluate(() => window.p4Fixture.mayQuit())).toBe(false);
  }, { __draftOwners: true });
});

for (const cancel of ['header', 'escape', 'replacement'] as const) it(`keeps ${cancel} navigation cancellation after a delayed save`, async () => {
  await mounted(h, async page => {
    await page.getByLabel('草稿 a').fill('A');
    await page.getByRole('button', { name: '离开探针' }).click();
    await page.getByRole('button', { name: '保存并离开' }).click();
    if (cancel === 'header') await page.getByRole('button', { name: '关闭对话框' }).click();
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'replacement') await page.evaluate(() => window.p4Fixture.navigate());
    await page.evaluate(() => window.p4Fixture.resolve({ revision:1, text:'A' }));
    await expect.poll(() => page.getByRole('button', { name: '保存并离开' }).isDisabled().catch(() => false)).toBe(false);
    expect(await page.getByText('已离开探针', {exact:true}).count()).toBe(0);
    if (cancel === 'replacement') await page.getByRole('button', { name:'继续编辑' }).click();
    expect(await page.getByLabel('草稿 a').inputValue()).toBe('A');
  }, { __draftOwners:true });
});

it('keeps the second dirty owner guarded after the first unmounts and a save is refused', async () => {
  await mounted(h, async page => {
    await page.getByLabel('草稿 a').fill('A'); await page.getByLabel('草稿 b').fill('B');
    await page.getByRole('button', { name: '卸载 A' }).click();
    await page.getByRole('button', { name: '离开探针' }).click();
    await page.getByRole('button', { name: '保存并离开' }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'audio.saveVoiceLine', payload: { id: 'b', text: 'B' } });
    await page.evaluate(() => window.p4Fixture.resolve(undefined));
    await page.getByRole('button', { name: '继续编辑' }).click();
    expect(await page.getByLabel('草稿 b').inputValue()).toBe('B');
    expect(await page.getByText('已离开探针', { exact: true }).count()).toBe(0);
    const states = await page.evaluate(() => window.p4Fixture.bridgeCalls.filter(call => call.kind === 'setTimelineDraftState'));
    expect(states.at(-1)?.payload).toMatchObject({ dirty: true });
  }, { __draftOwners: true });
});

it('does not navigate after save A when a later edit B appears during that save', async () => {
  await mounted(h, async page => {
    await page.getByLabel('草稿 a').fill('A');
    await page.getByRole('button', { name: '离开探针' }).click();
    await page.getByRole('button', { name: '保存并离开' }).click();
    await page.evaluate(() => window.p4Fixture.ownerEdits.a!('B'));
    await page.evaluate(() => window.p4Fixture.resolve({ revision: 1, text: 'A' }));
    await page.getByRole('button', { name: '继续编辑' }).click();
    expect(await page.getByLabel('草稿 a').inputValue()).toBe('B');
    expect(await page.getByText('已离开探针', { exact: true }).count()).toBe(0);
  }, { __draftOwners: true });
});
