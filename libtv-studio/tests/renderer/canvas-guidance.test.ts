import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted,calls,queries} from './p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
const image={kind:'assetVersion',libraryId:'library',assetId:'portrait',version:2};
const empty={libraryId:'library',canvasId:'project',projectId:'project',revision:0,nodes:[],edges:[],outputs:[],snapshotSeq:0,streamId:'fixture'};
const data=()=>({...queries(),__canvas:true,'canvas.read':empty,'creation.read':{scripts:[],entities:[],shots:[],selections:[]},'voice.list':{voices:[]},'workflow.list':{workflows:[]},'asset.search':{assets:[{ref:image,name:'角色原图',mime:'image/png',width:100,height:100,byteLength:100,tags:[]}]},'profile.list':{profiles:[{libraryId:'library',id:'text-profile',revision:1,modelRef:{id:'text-model',revision:1},parameters:{}},{libraryId:'library',id:'image-profile',revision:3,name:'图像预设',modelRef:{id:'image-model',revision:1},parameters:{}}]},'model.list':{models:[{id:'text-model',revision:1,capabilities:{outputKinds:['text'],inputKinds:['text'],taskTypes:['text_to_text'],parameters:[]}},{id:'image-model',revision:1,name:'图片模型',capabilities:{outputKinds:['image'],inputKinds:['text','image'],taskTypes:['image_to_image'],parameters:[]}}]}});
it('starts with actionable character and scene guidance and saves an entity without generating',async()=>{
 await mounted(h,async page=>{
  expect(await page.getByRole('heading',{name:'从角色与场景开始'}).count()).toBe(1);
  await page.getByRole('button',{name:'创建角色',exact:true}).click();
  await page.getByRole('dialog',{name:'创建角色',exact:true}).getByLabel('实体名称').fill('林夏');
  await page.getByRole('button',{name:'保存实体',exact:true}).click();await calls(page,1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'creation.saveEntity',payload:{projectId:'project',kind:'character',name:'林夏',expectedRevision:0}});
  await page.evaluate(()=>{window.p4Fixture.resolve({id:'char',kind:'character',name:'林夏',revision:1,description:'',constraints:'',references:[]});window.p4Fixture.update({'creation.read':{scripts:[],shots:[],selections:[],entities:[{id:'char',kind:'character',name:'林夏',revision:1}]}});});
  await page.getByRole('dialog',{name:'创建角色',exact:true}).waitFor({state:'hidden'});
  expect(await page.getByText('已建立 1 位角色',{exact:true}).count()).toBe(1);
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(1);
 },data());
});
it('uses an image preset and fixed reference for a portrait tool, without submitting generation',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'快捷工具',exact:true}).click();
  await page.getByRole('button',{name:'角色特写',exact:true}).click();
  await page.getByLabel('参考图片').selectOption(JSON.stringify(image));
  await page.getByRole('button',{name:'创建生成节点',exact:true}).click();await calls(page,1);
  const call=await page.evaluate(()=>window.p4Fixture.calls[0]!);
  expect(call.kind).toBe('canvas.applyCommand');
  expect(call.payload).toMatchObject({canvasId:'project',operations:[{kind:'create',content:{type:'generation',profileRef:{id:'image-profile',revision:3},referenceImages:[{role:'reference',ref:image}]}}]});
  expect(JSON.stringify(call.payload)).toContain('特写');
 },data());
});
it('explains missing references and missing compatible image models',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'快捷工具',exact:true}).click();await page.getByRole('button',{name:'角色特写',exact:true}).click();
  expect(await page.getByRole('button',{name:'创建生成节点',exact:true}).isEnabled()).toBe(false);
  expect(await page.getByText('先选择一张参考图片。',{exact:true}).count()).toBe(1);
  await page.getByLabel('参考图片').selectOption(JSON.stringify(image));
  await page.evaluate(()=>window.p4Fixture.update({'profile.list':{profiles:[]}}));
  expect(await page.getByRole('button',{name:'创建生成节点',exact:true}).isEnabled()).toBe(false);
  expect(await page.getByText('需要支持参考图片的图像生成预设。',{exact:true}).count()).toBe(1);
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
 },data());
});
it('does not present an unreadable canvas as a new empty canvas',async()=>{
 await mounted(h,async page=>{
  expect(await page.getByRole('heading',{name:'从角色与场景开始'}).count()).toBe(0);
  expect(await page.getByRole('alert').filter({hasText:'画布读取失败'}).count()).toBeGreaterThan(0);
 },{...data(),__queryErrors:{'canvas.read':'画布读取失败'}});
});

it('protects a tool draft on Escape and back, and restores retained text',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'快捷工具',exact:true}).click();await page.getByRole('button',{name:'角色特写',exact:true}).click();
  await page.getByLabel('生成要求').fill('保留这段尚未创建的角色要求');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog',{name:'保留创作草稿',exact:true}).waitFor();
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  expect(await page.getByLabel('生成要求').inputValue()).toBe('保留这段尚未创建的角色要求');
  await page.getByRole('button',{name:'返回工具列表',exact:true}).click();
  await page.getByRole('button',{name:'保留草稿并离开',exact:true}).click();
  await page.getByRole('button',{name:'角色特写',exact:true}).click();
  expect(await page.getByLabel('生成要求').inputValue()).toBe('保留这段尚未创建的角色要求');
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
 },data());
});
it('blocks a stale optional reference until the user explicitly clears it',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'快捷工具',exact:true}).click();await page.getByRole('button',{name:'角色设定板',exact:true}).click();
  await page.getByLabel('参考图片').selectOption(JSON.stringify(image));
  await page.evaluate(()=>window.p4Fixture.update({'asset.search':{assets:[]}}));
  expect(await page.getByRole('button',{name:'创建生成节点',exact:true}).isEnabled()).toBe(false);
  expect(await page.getByText('所选参考图片已不可用，请重新选择或清除参考。',{exact:true}).count()).toBe(1);
  expect(await page.getByLabel('参考图片').inputValue()).toBe(JSON.stringify(image));
  await page.getByLabel('参考图片').selectOption('');
  expect(await page.getByRole('button',{name:'创建生成节点',exact:true}).isEnabled()).toBe(true);
 },{...data(),'model.list':{models:[{id:'image-model',revision:1,capabilities:{outputKinds:['image'],inputKinds:['text','image'],taskTypes:['image_to_image','text_to_image'],parameters:[]}}]}});
});
it('distinguishes dependency read failures from missing setup and preserves tool text',async()=>{
 await mounted(h,async page=>{
  await page.evaluate(()=>window.p4Fixture.update({__queryErrors:{'creation.read':'实体服务失败'}}));
  expect(await page.getByText('角色与场景读取失败，请恢复连接后重试。',{exact:true}).count()).toBe(1);
  expect(await page.getByRole('button',{name:'创建角色',exact:true}).isEnabled()).toBe(false);
  await page.getByRole('button',{name:'快捷工具',exact:true}).click();await page.getByRole('button',{name:'角色特写',exact:true}).click();
  await page.getByLabel('生成要求').fill('恢复连接后继续编辑');
  for(const [kind,label] of [['profile.list','模型预设'],['model.list','模型能力'],['asset.search','素材']]){
   await page.evaluate(({kind})=>window.p4Fixture.update({__queryErrors:{[kind!]:kind+' failed'}}),{kind});
   expect(await page.getByRole('button',{name:'创建生成节点',exact:true}).isEnabled()).toBe(false);
   expect(await page.getByText(label+'读取失败，请恢复连接后重试。',{exact:true}).count()).toBe(1);
   expect(await page.getByLabel('生成要求').inputValue()).toBe('恢复连接后继续编辑');
  }
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
 },data());
});

it('creates a scene through the scene entry and keeps failed tool input editable',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'创建场景',exact:true}).click();
  await page.getByRole('dialog',{name:'创建场景',exact:true}).getByLabel('实体名称').fill('雨夜车站');
  await page.getByRole('button',{name:'保存实体',exact:true}).click();await calls(page,1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'creation.saveEntity',payload:{kind:'scene',name:'雨夜车站'}});
  await page.evaluate(()=>window.p4Fixture.resolve({id:'scene',kind:'scene',name:'雨夜车站',revision:1,description:'',constraints:'',references:[]}));
  await page.getByRole('dialog',{name:'创建场景',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'快捷工具',exact:true}).click();await page.getByRole('button',{name:'昼夜天气变体',exact:true}).click();
  await page.getByLabel('参考图片').selectOption(JSON.stringify(image));await page.getByLabel('生成要求').fill('保留雨夜车站的结构');
  await page.getByRole('button',{name:'创建生成节点',exact:true}).click();await calls(page,2);
  await page.evaluate(()=>window.p4Fixture.resolve(undefined));
  await page.getByRole('alert').filter({hasText:'节点未创建'}).waitFor();
  expect(await page.getByLabel('生成要求').inputValue()).toBe('保留雨夜车站的结构');
  expect(await page.getByLabel('参考图片').inputValue()).toBe(JSON.stringify(image));
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'保留草稿并离开',exact:true}).click();
  await page.getByRole('button',{name:'快捷工具',exact:true}).click();await page.getByRole('button',{name:'昼夜天气变体',exact:true}).click();
  expect(await page.getByLabel('生成要求').inputValue()).toBe('保留雨夜车站的结构');
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(2);
 },data());
});
