import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted,queries} from './p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
it('filters real reference types while retaining editable shot fields and explicit production preparation',async()=>{
 const base={libraryId:'library',projectId:'project',revision:1,createdAt:'2026-11-07'};
 const script={...base,id:'script-a',title:'出发前夜',synopsis:'去海边',body:'正文',scenes:[{id:'scene-a',title:'海边',location:'公路',time:'日',description:''}]};
 const shot={...base,id:'shot-a',scriptId:'script-a',sceneId:'scene-a',order:0,title:'出发',durationSeconds:4,shotSize:'中景',cameraMovement:'跟随',subject:'林夏',action:'骑车',dialogue:'出发吧',sound:'风声',aspectRatio:'16:9',prompt:'海边骑车',entityRefs:[]};
 await mounted(h,async page=>{
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'制作',exact:true}).click();
  await page.getByRole('tab',{name:'镜头',exact:true}).click();
  const assets=page.getByRole('region',{name:'本集资产'});
  await assets.getByRole('button',{name:'角色',exact:true}).click();
  expect(await assets.getByText('林夏',{exact:true}).count()).toBe(1);
  expect(await assets.getByText('海滨公路',{exact:true}).count()).toBe(0);
  expect(await page.getByLabel('镜头标题',{exact:true}).count()).toBe(1);
  expect(await page.getByRole('button',{name:'预览选定镜头制作',exact:true}).isDisabled()).toBe(true);
 },{...queries(),__shell:true,'project.list':{projects:[{libraryId:'library',id:'project',name:'周末出逃',createdAt:'2026-11-07'}]},'subproject.list':{items:[{id:'ep03',projectId:'project',title:'EP03',primaryCanvasId:null,status:'producing'}]},'subproject.canvases':{items:[]},'project.tasks':{items:[]},'project.assets':{items:[]},'creation.read':{scripts:[script],shots:[shot],entities:[{...base,id:'e1',kind:'character',name:'林夏',description:'主角',constraints:'',references:[]},{...base,id:'e2',kind:'scene',name:'海滨公路',description:'外景',constraints:'',references:[]}],selections:[]},'shots.history':{outputs:[],productions:[],collectionIssues:[]},'workflow.list':{workflows:[]},'dialogue.read':{current:null,issues:[]},'voice.list':{voices:[],defaultBindings:[]}});
});
it('locates the requested shot in its parent script and opens dialogue from production history',async()=>{
 const base={libraryId:'library',projectId:'project',revision:1,createdAt:'2026-11-07'};
 const script={...base,id:'script-a',title:'第一份剧本',synopsis:'',body:'正文',scenes:[{id:'scene',title:'公路',location:'海边',time:'日',description:''}]};
 const shot={...base,id:'shot-a',scriptId:'script-a',sceneId:'scene',order:0,title:'第一镜',durationSeconds:4,shotSize:'中景',cameraMovement:'跟随',subject:'林夏',action:'骑车',dialogue:'',sound:'海风',aspectRatio:'16:9',prompt:'旅行电影',entityRefs:[]};
 await mounted(h,async page=>{
  expect(await page.getByLabel('当前制作剧本',{exact:true}).inputValue()).toBe('script-b');
  expect(await page.getByLabel('镜头标题',{exact:true}).inputValue()).toBe('目标镜头');
  await page.getByText('全部制作批次与输出历史',{exact:true}).click();
  await page.getByRole('button',{name:'打开对白/剪辑',exact:true}).click();
  expect(await page.getByRole('heading',{name:'结构化对白',exact:true}).count()).toBeGreaterThan(0);
 },{...queries(),__production:true,'creation.read':{...base,scripts:[script,{...script,id:'script-b',title:'第二份剧本'}],shots:[shot,{...shot,id:'shot-b',scriptId:'script-b',title:'目标镜头'}],entities:[],selections:[{shotId:'shot-b',selectionRevision:1,dialogue:{route:'native-reference',dialogueRef:{id:'dialogue',revision:1}}}]},'shots.history':{outputs:[],productions:[],collectionIssues:[]},'workflow.list':{workflows:[]},'dialogue.read':{current:null,issues:[]},'voice.list':{voices:[],defaultBindings:[]}});
});