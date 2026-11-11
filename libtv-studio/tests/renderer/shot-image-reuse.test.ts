import {afterAll,beforeAll,it,expect} from 'vitest';
import {harness,mounted,queries} from './p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;beforeAll(async()=>{h=await harness();});afterAll(async()=>{await h?.browser.close();await h?.server.close();});
const ref={kind:'assetVersion',libraryId:'library',assetId:'external-image',version:2};
function data(image=true){return {...queries(),__creation:true,'workflow.list':{workflows:[]},'shots.history':{outputs:[],productions:[],collectionIssues:[]},
 'creation.read':{libraryId:'library',projectId:'project',scripts:[{id:'script',revision:1,title:'剧本',scenes:[{id:'scene',title:'场景',location:'',time:'',description:''}]}],shots:[{id:'shot',revision:1,scriptId:'script',sceneId:'scene',order:0,title:'开门',durationSeconds:4,shotSize:'wide',cameraMovement:'fixed',subject:'',action:'',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'',entityRefs:[]}],entities:[],selections:image?[{shotId:'shot',selectionRevision:2,image:ref,video:null}]:[]},
 'profile.list':{profiles:[{libraryId:'library',id:'video',revision:1,name:'视频模型',modelRef:{libraryId:'library',id:'video',revision:1},parameters:{}}]},
 'model.list':{models:[{id:'video',revision:1,capabilities:{outputKinds:['video']}}]}};}
it('submits the selected fixed external image from the UI with no image profile',async()=>{await mounted(h,async page=>{
 await page.getByLabel('生产选择 开门',{exact:true}).check();await page.getByLabel('视频制作预设',{exact:true}).selectOption('video:1');
 await page.getByLabel('复用已选分镜图，跳过这些镜头的生图步骤',{exact:true}).check();await page.getByLabel('已有图片用于',{exact:true}).selectOption('reference');
 await page.getByRole('button',{name:'预览选定镜头制作',exact:true}).click();
 const call=await page.evaluate(()=>window.p4Fixture.calls[0]);expect(call).toMatchObject({kind:'shots.prepareProduction',payload:{reusedImages:[{shotId:'shot',ref,role:'reference'}],videoProfileRef:{id:'video',revision:1}}});expect(call!.payload).not.toHaveProperty('imageProfileRef');
 },data());});
it('blocks missing selected image before any UI command when no image model is selected',async()=>{await mounted(h,async page=>{
 await page.getByLabel('生产选择 开门',{exact:true}).check();await page.getByLabel('视频制作预设',{exact:true}).selectOption('video:1');await page.getByLabel('复用已选分镜图，跳过这些镜头的生图步骤',{exact:true}).check();await page.getByRole('button',{name:'预览选定镜头制作',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'复用图片需要视频预设'}).waitFor();expect(await page.evaluate(()=>window.p4Fixture.calls)).toHaveLength(0);
 },data(false));});
