import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted} from './p4-harness.ts';
import {shellData} from './yangfan-fixtures.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
it('separates registered deliverables from episode management and keeps the finish assistant reachable',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'成片',exact:true}).click();
  await page.getByRole('tab',{name:'制品',exact:true}).click();
  expect(await page.getByRole('heading',{name:'已登记制品',exact:true}).count()).toBe(1);
  expect(await page.getByText('暂无已登记制品',{exact:true}).count()).toBe(1);
  await page.getByRole('tab',{name:'成片助手',exact:true}).click();
  expect(await page.getByRole('heading',{name:'成片助手',exact:true,level:1}).count()).toBe(1);
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
 },shellData());
});