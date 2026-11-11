import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted,queries,calls} from './p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
const version=(v:number)=>({ref:{kind:'assetVersion',libraryId:'library',assetId:'road',version:v},name:'海滨公路',mime:'image/png',width:1920,height:1080,byteLength:1000,sourceArtifactRef:null,createdAt:'2026-11-07',metadataRevision:1,tags:[]});
function data(available=true){return {...queries(),__projectAssets:true,...(available?{__mediaUrl:'/packages/ui/src/assets/yangfan-mascot.png'}:{}),'project.assets':{items:[{...version(1),sourceSubprojectId:'ep03',common:false}]},'asset.history':{versions:[version(1),version(2),version(3)]},'canvas.read':{canvasId:'canvas-a',revision:1,projectId:'project',nodes:[]},'subproject.list':{items:[{id:'ep03',title:'出发前夜'}]},'creation.read':{shots:[],entities:[],scripts:[],selections:[]},'agent.list':{sessions:[]}};}
it('previews fixed versions without changing references and uses only the explicitly chosen version',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'查看 海滨公路',exact:true}).click();
  await page.getByRole('button',{name:'预览版本 v2',exact:true}).click();
  await page.getByRole('button',{name:'预览版本 v3',exact:true}).click();
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
  await expect.poll(()=>page.getByRole('button',{name:'放入当前画布',exact:true}).isDisabled()).toBe(false);
  await page.getByRole('button',{name:'放入当前画布',exact:true}).click();await calls(page,1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'canvas.applyCommand',payload:{operations:[{content:{media:{assetId:'road',version:3}}}]}});
 },data());
});
it('keeps missing media unavailable for adoption',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'查看 海滨公路',exact:true}).click();
  expect(await page.getByRole('button',{name:'放入当前画布',exact:true}).isDisabled()).toBe(true);
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
 },data(false));
});