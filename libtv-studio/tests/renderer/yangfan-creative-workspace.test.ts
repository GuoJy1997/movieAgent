import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted} from './p4-harness.ts';
import {agentData} from './yangfan-fixtures.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
it('keeps one conversation draft across canvas and conversation and protects leaving it',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'创作',exact:true}).click();
  await page.getByLabel('创作需求',{exact:true}).fill('保留我的开场');
  await page.getByRole('tab',{name:'画布',exact:true}).click();
  expect(await page.getByLabel('创作需求',{exact:true}).inputValue()).toBe('保留我的开场');
  expect(await page.getByRole('dialog').count()).toBe(0);
  await page.getByRole('tab',{name:'对话',exact:true}).click();
  expect(await page.getByLabel('创作需求',{exact:true}).inputValue()).toBe('保留我的开场');
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await page.getByRole('button',{name:'保留草稿并离开',exact:true}).click();
  await page.getByRole('button',{name:'返回工作区',exact:true}).click();
  expect(await page.getByLabel('创作需求',{exact:true}).inputValue()).toBe('保留我的开场');
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
 },{...agentData(),__agent:false,__shell:true,'project.list':{projects:[{libraryId:'library',id:'project',name:'周末出逃',createdAt:'2026-11-07'}]},'subproject.list':{items:[{id:'ep03',projectId:'project',title:'EP03 出发前夜',primaryCanvasId:null,status:'producing'}]},'subproject.canvases':{items:[]},'project.tasks':{items:[]},'project.assets':{items:[]}});
});