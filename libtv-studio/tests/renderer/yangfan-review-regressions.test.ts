import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted,timeline,calls} from './p4-harness.ts';
import {shellData} from './yangfan-fixtures.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
it('restores a specifically selected timeline after visiting global tasks',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'成片',exact:true}).click();
  await page.getByLabel('当前时间线',{exact:true}).selectOption('timeline-b');
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await page.getByRole('button',{name:'返回工作区'}).click();
  expect(await page.getByLabel('当前时间线',{exact:true}).inputValue()).toBe('timeline-b');
 },shellData());
});
it('opens session creation when changing an immutable conversation mode',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'创作',exact:true}).click();
  await page.getByRole('button',{name:'全能创作',exact:true}).click();
  await page.getByRole('button',{name:'创建另一种模式的会话'}).click();
  expect(await page.getByLabel('新会话名称',{exact:true}).isVisible()).toBe(true);
 },shellData());
});
it('binds a legacy project before entering its work scope',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'继续制作',exact:true}).click();
  expect(await page.getByRole('tab',{name:'分集与分期',exact:true}).getAttribute('aria-selected')).toBe('true');
  expect(await page.getByText('先选择一集',{exact:true}).count()).toBe(0);
 },{...shellData(),__legacy:true});
});
it('keeps Agent drafts separated when switching episodes through the real shell',async()=>{
 const data=shellData();data['subproject.list'].items.push({...data['subproject.list'].items[0]!,id:'ep04',title:'EP04 海边公路'});
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'创作',exact:true}).click();
  await page.getByLabel('创作需求',{exact:true}).fill('第三集的独立草稿');
  await page.getByLabel('当前子项目',{exact:true}).selectOption('ep04');
  await page.getByRole('button',{name:'保留草稿并离开'}).click();
  expect(await page.getByLabel('创作需求',{exact:true}).inputValue()).toBe('');
  await page.getByLabel('创作需求',{exact:true}).fill('第四集的独立草稿');
  await page.getByLabel('当前子项目',{exact:true}).selectOption('ep03');
  await page.getByRole('button',{name:'保留草稿并离开'}).click();
  expect(await page.getByLabel('创作需求',{exact:true}).inputValue()).toBe('第三集的独立草稿');
 },data);
});
it('ignores a timeline creation callback after leaving its episode',async()=>{
 const data=shellData();data['creation.read'].scripts=[{id:'script',revision:1,title:'剧本'}] as never;
 data['subproject.list'].items.push({...data['subproject.list'].items[0]!,id:'ep04',title:'EP04 海边公路'});
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'成片',exact:true}).click();
  await page.getByText('新建另一条命名时间线',{exact:true}).click();
  await page.getByRole('button',{name:'新建空时间线',exact:true}).click();await calls(page,1);
  await page.getByLabel('当前子项目',{exact:true}).selectOption('ep04');
  await page.evaluate(t=>window.p4Fixture.resolve({...t,id:'late-ep03'}),timeline);
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await page.getByRole('button',{name:'返回工作区'}).click();
  expect(await page.getByLabel('当前时间线',{exact:true}).inputValue()).not.toBe('late-ep03');
  expect((await page.evaluate(()=>window.p4Fixture.queryReads.filter(r=>r.kind==='timeline.read').at(-1)))?.payload).not.toMatchObject({timelineId:'late-ep03'});
 },data);
});
it('does not navigate a new episode when an old home session creation completes',async()=>{
 const data=shellData();data['subproject.list'].items.push({...data['subproject.list'].items[0]!,id:'ep04',title:'EP04 海边公路'});
 await mounted(h,async page=>{
  await page.getByLabel('创作需求',{exact:true}).fill('第三集草稿');
  await page.getByLabel('创作需求',{exact:true}).press('Control+Enter');
  await page.getByRole('button',{name:'创建会话并继续'}).click();await calls(page,1);
  await page.getByRole('dialog',{name:'开始创作对话'}).press('Escape');
  await page.getByRole('button').filter({hasText:'EP04 海边公路'}).click();
  await page.getByRole('button',{name:'保留草稿并离开'}).click();
  await page.evaluate(()=>window.p4Fixture.resolve({sessionId:'late-ep03-session'}));
  await page.waitForTimeout(50);
  expect(await page.getByRole('heading',{name:'继续你的故事'}).isVisible()).toBe(true);
  expect(await page.getByLabel('创作需求',{exact:true}).inputValue()).toBe('');
 },data);
});