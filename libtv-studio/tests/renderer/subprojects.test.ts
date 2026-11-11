import {afterAll,beforeAll,expect,it} from 'vitest';
import {harness,mounted,calls,queries} from './p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
it('creates a named episode in the parent project instead of opening another project directory',async()=>{
 await mounted(h,async page=>{
  await page.getByLabel('子项目名称').fill('第二期 · 火器');
  await page.getByRole('button',{name:'新建子项目',exact:true}).click();await calls(page,1);
  const call=await page.evaluate(()=>window.p4Fixture.calls[0]);expect(call).toMatchObject({kind:'subproject.create',payload:{projectId:'project',title:'第二期 · 火器'}});
 },{...queries(),__subprojects:true,'subproject.list':{libraryId:'library',projectId:'project',items:[]},'project.memory':{libraryId:'library',projectId:'project',entries:[],completions:[],profileRef:null},'subproject.canvases':{items:[]},'subproject.deliverables':{items:[]}});
});

it('shows tasks from sibling episodes in the project view and opens their saved source',async()=>{
 await mounted(h,async page=>{
  await page.getByLabel('任务范围').selectOption('all');
  await expect.poll(()=>page.getByRole('heading',{name:'第一集',exact:true}).count()).toBe(1);
  await page.getByRole('button',{name:'打开来源子项目',exact:true}).click();await calls(page,1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'ui.openTaskSource',payload:{subprojectId:'a',canvasId:'canvas-a'}});
 },{...queries(),__taskCenter:true,'subproject.list':{items:[{id:'a',title:'第一集'},{id:'b',title:'第二集'}]},'project.tasks':{libraryId:'library',projectId:'project',items:[{task:{taskId:'a-task',state:'RUNNING'},subprojectId:'a',canvasId:'canvas-a'}]}});
});
