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
