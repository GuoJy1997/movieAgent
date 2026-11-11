import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted} from './p4-harness.ts';
import {shellData} from './yangfan-fixtures.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
it('keeps application model settings, MCP and project maintenance in distinct settings views',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('tab',{name:'MCP 接入',exact:true}).click();
  expect(await page.getByRole('region',{name:'MCP Agent 接入'}).count()).toBe(1);
  await page.getByRole('tab',{name:'本机维护',exact:true}).click();
  await page.getByRole('button',{name:'打开项目维护',exact:true}).click();
  expect(await page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='launcher').length)).toBe(1);
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
 },shellData());
});
it('keeps the committed settings pill when navigation is cancelled',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.evaluate(()=>window.addEventListener('studio:timeline-navigate',event=>event.preventDefault(),{once:true}));
  await page.getByRole('tab',{name:'MCP 接入',exact:true}).click();
  expect(await page.getByRole('tab',{name:'模型与预设',exact:true}).getAttribute('aria-selected')).toBe('true');
  expect(await page.getByRole('tab',{name:'MCP 接入',exact:true}).getAttribute('aria-selected')).toBe('false');
  await page.getByRole('tab',{name:'MCP 接入',exact:true}).click();
  expect(await page.getByRole('tab',{name:'MCP 接入',exact:true}).getAttribute('aria-selected')).toBe('true');
 },shellData());
});
it('snaps the pill under reduced motion and keeps it aligned in a narrow window',async()=>{
 await mounted(h,async page=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('tab',{name:'本机维护',exact:true}).click();
  for(const width of [1366,800]){
   await page.setViewportSize({width,height:780});
   const geometry=await page.getByRole('tablist',{name:'设置分类'}).evaluate(list=>{
    const pill=list.querySelector('.yangfan-pill-nav__glide')!.getBoundingClientRect();
    const item=list.querySelector('[aria-selected=true]')!.getBoundingClientRect();
    return {dx:Math.abs(pill.x-item.x),dw:Math.abs(pill.width-item.width),overflow:document.body.scrollWidth>innerWidth};
   });
   expect(geometry.dx).toBeLessThan(1);expect(geometry.dw).toBeLessThan(1);expect(geometry.overflow).toBe(false);
  }
 },shellData());
});
