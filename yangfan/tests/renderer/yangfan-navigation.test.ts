import {beforeAll,afterAll,it,expect} from 'vitest';
import type {Page} from '@playwright/test';
import {harness,mounted,queries} from './p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
const data=()=>({...queries(),__shell:true,'project.list':{projects:[{libraryId:'library',id:'project',name:'周末出逃',createdAt:'2026-11-07'}]},'subproject.list':{items:[{id:'ep03',projectId:'project',title:'EP03 出发前夜',primaryCanvasId:null,status:'producing'}]},'subproject.canvases':{items:[]},'project.tasks':{items:[]},'project.assets':{items:[]},'project.memory':{entries:[],completions:[],profileRef:null},'subproject.deliverables':{items:[]},'creation.read':{scripts:[],shots:[],entities:[],selections:[]},'agent.list':{sessions:[]},'provider.list':{connections:[]}});
it('groups the ten workspaces into five main destinations without losing episode and entity management',async()=>{
 await mounted(h,async page=>{
  await expect.poll(()=>page.getByRole('navigation',{name:'工作区导航'}).getByRole('button').count()).toBe(5);
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'项目',exact:true}).click();
  await page.getByRole('button',{name:'管理分集与分期',exact:true}).click();
  await expect.poll(()=>page.getByRole('tab',{name:'分集与分期'}).getAttribute('aria-selected')).toBe('true');
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'资产',exact:true}).click();
  await expect.poll(()=>page.getByRole('tab',{name:'角色与场景'}).count()).toBe(1);
 },data());
});
it('returns from global settings to the previous workspace',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'项目',exact:true}).click();
  
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'返回工作区',exact:true}).click();
  expect(await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'项目',exact:true}).getAttribute('aria-current')).toBe('page');
 },data());
});
it('moves pill-tab focus without committing navigation until activation',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'制作',exact:true}).click();
  const script=page.getByRole('tab',{name:'剧本',exact:true}),shots=page.getByRole('tab',{name:'镜头',exact:true});
  await script.press('ArrowRight');
  expect(await shots.evaluate(element=>document.activeElement===element)).toBe(true);
  expect(await script.getAttribute('aria-selected')).toBe('true');
  await shots.press('Enter');
  await expect.poll(()=>shots.getAttribute('aria-selected')).toBe('true');
  expect(await shots.getAttribute('tabindex')).toBe('0');
  await shots.press('End');
  expect(await page.getByRole('tab',{name:'对白',exact:true}).evaluate(element=>document.activeElement===element)).toBe(true);
  await page.getByRole('tab',{name:'对白',exact:true}).press('Home');
  expect(await script.evaluate(element=>document.activeElement===element)).toBe(true);
  expect(await shots.getAttribute('aria-selected')).toBe('true');
 },data());
});
const navigationGeometry=(page:Page)=>page.locator('.app-sidebar').evaluate(sidebar=>{
 const nav=sidebar.querySelector('nav button')!,icon=nav.querySelector('svg')!,brand=sidebar.querySelector('.yangfan-brand img')!;
 const box=(element:Element)=>{const {x,y,width,height}=element.getBoundingClientRect();return {x,y,width,height};};
 return {sidebar:box(sidebar),button:box(nav),icon:box(icon),brand:box(brand),fontSize:getComputedStyle(nav).fontSize,contentX:document.querySelector('.main-area')!.getBoundingClientRect().x};
});
it.each([
 {width:1366,preference:null},
 {width:1366,preference:'expanded'},
 {width:1366,preference:'compact'},
 {width:1180,preference:null},
 {width:800,preference:null},
])('keeps navigation geometry stable across tabs at $width with $preference preference',async({width,preference})=>{
 await mounted(h,async page=>{
  await page.setViewportSize({width,height:780});
  if(preference)await page.evaluate(value=>localStorage.setItem('yangfan.ui.v1.sidebar',value),preference);
  await page.evaluate(data=>window.p4Fixture.mount(data),data());
  await page.getByRole('button',{name:'管理分集与分期',exact:true}).waitFor();
  const geometry=await navigationGeometry(page);
  await page.getByRole('button',{name:'管理分集与分期',exact:true}).click();
  expect(await navigationGeometry(page)).toEqual(geometry);
  await page.getByRole('tab',{name:'项目记忆',exact:true}).click();
  expect(await navigationGeometry(page)).toEqual(geometry);
  for(const [destination,tabs] of [
   ['创作',['画布','对话']],['制作',['镜头','对白','剧本']],['资产',['角色与场景','声音','媒体']],['成片',['制品','成片助手','剪辑']],
  ] as const){
   await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:destination,exact:true}).click();
   expect(await navigationGeometry(page)).toEqual(geometry);
   for(const tab of tabs){await page.getByRole('tab',{name:tab,exact:true}).click();expect(await navigationGeometry(page)).toEqual(geometry);}
  }
  for(const destination of ['任务','设置']){
   await page.getByRole('button',{name:destination,exact:true}).click();
   expect(await navigationGeometry(page)).toEqual(geometry);
  }
  await page.getByRole('button',{name:'返回工作区',exact:true}).click();
  expect(await navigationGeometry(page)).toEqual(geometry);
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'项目',exact:true}).click();
  expect(await navigationGeometry(page)).toEqual(geometry);
 },data());
},20000);
it('adapts the default navigation to window size and preserves a manual choice on resize and remount',async()=>{
 await mounted(h,async page=>{
  const sidebar=page.locator('.app-sidebar');
  const width=()=>sidebar.evaluate(element=>element.getBoundingClientRect().width);
  await page.setViewportSize({width:1366,height:780});
  await expect.poll(width).toBe(226);
  await page.setViewportSize({width:1180,height:780});
  await expect.poll(width).toBe(64);
  await page.getByRole('button',{name:'展开导航',exact:true}).click();
  await expect.poll(width).toBe(176);
  await page.setViewportSize({width:1366,height:780});
  await expect.poll(width).toBe(226);
  await page.getByRole('button',{name:'收起导航',exact:true}).click();
  await expect.poll(width).toBe(64);
  await page.evaluate(data=>window.p4Fixture.mount(data),data());
  await expect.poll(width).toBe(64);
  await page.setViewportSize({width:1180,height:780});
  await expect.poll(width).toBe(64);
 },data());
});
