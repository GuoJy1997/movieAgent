import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted,calls} from './p4-harness.ts';
import {shellData} from './yangfan-fixtures.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
it('keeps homepage input separate and asks for a new session before planning',async()=>{
 await mounted(h,async page=>{
  await page.getByLabel('创作需求',{exact:true}).fill('从海边出发');
  await page.getByLabel('创作需求',{exact:true}).press('Control+Enter');
  expect(await page.getByRole('dialog',{name:'开始创作对话'}).count()).toBe(1);
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
  await page.getByRole('button',{name:'创建会话并继续'}).click();await calls(page,1);
  expect((await page.evaluate(()=>window.p4Fixture.calls[0]))?.kind).toBe('agent.createSession');
  await page.evaluate(()=>window.p4Fixture.resolve({sessionId:'new-home-session'}));await page.clock.runFor(100);
  expect(await page.getByRole('tab',{name:'对话',exact:true}).getAttribute('aria-selected')).toBe('true');
  expect(await page.getByLabel('创作需求',{exact:true}).inputValue()).toBe('从海边出发');
 },shellData());
});