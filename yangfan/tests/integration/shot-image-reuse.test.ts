import {expect,it} from 'vitest';
import {unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {nativeFixture,execute,value} from '../fixtures/native-generation';
import {addWorkflowModel} from '../fixtures/workflow';
import {parsePrepareShotProduction,isPreparedShotProduction} from '../../packages/contracts/src/shot-production';
async function setup(){
 const s=await nativeFixture('minimax-video-v2'), projectId=s.prepareInput().projectId;
 value(await execute(s.engine,'creation.saveScript',{projectId,id:'script',expectedRevision:0,title:'Film',synopsis:'',body:'A lake',scenes:[{id:'scene',title:'Lake',location:'Lake',time:'Day',description:''}]}));
 const shot={projectId,id:'shot',expectedRevision:0,scriptId:'script',sceneId:'scene',order:0,title:'Lake',durationSeconds:4,shotSize:'wide',cameraMovement:'fixed',subject:'Lake',action:'wind',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'Wind over the lake',entityRefs:[]};
 value(await execute(s.engine,'creation.saveShot',shot));
 const bytes=await sharp({create:{width:512,height:288,channels:3,background:'#13579b'}}).png().toBuffer(),ref=await s.importFile(bytes);
 value(await execute(s.engine,'creation.selectOutput',{projectId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'image',reference:ref}));
 const input={projectId,scriptId:'script',canvasId:projectId,shots:[{shotId:'shot',revision:1}],videoProfileRef:s.prepareInput().profileRef,executionOwner:'human',runId:'reuse-run',reusedImages:[{shotId:'shot',ref,role:'first_frame' as const}]};
 return {...s,projectId,ref,input,shot,bytes};
}
it('uses an imported fixed first frame with only a video model and sends zero image tasks',async()=>{
 const s=await setup(),p=value(await execute(s.engine,'shots.prepareProduction',s.input));
 expect(isPreparedShotProduction(p)).toBe(true);expect(p.steps.map((x:any)=>x.role)).toEqual(['video']);
 expect(p.steps[0].referenceImages).toEqual([{role:'first_frame',ref:s.ref}]);
 value(await execute(s.engine,'shots.applyProduction',{productionId:p.productionId,approvedHash:p.planHash,expectedCanvasRevision:p.canvasRevision,executionOwner:'human',runId:'reuse-run'}));
 const w=value(await execute(s.engine,'workflow.prepare',{canvasId:s.projectId,mode:'selection',nodeIds:p.steps.map((x:any)=>x.nodeId),executionOwner:'human',runId:'reuse-run'}));
 value(await execute(s.engine,'shots.attachWorkflow',{productionId:p.productionId,workflowId:w.planId,executionOwner:'human'}));
 value(await execute(s.engine,'workflow.approveAndEnqueue',{planId:w.planId,approvedPlanHash:w.planHash,currency:'CNY',budgetLimitMicros:1000000,stepAllowances:Object.fromEntries(w.steps.map((x:any)=>[x.stepId,10000])),acknowledgeUnknown:true,executionOwner:'human',runId:'reuse-run'}));
 value(await s.engine.workflows.wake());const running=value(s.engine.workflows.read(w.planId));expect(running.steps).toHaveLength(1);
 s.response({task_id:'reuse-video'});value(await s.engine.scheduler.run(running.steps[0].task.attemptId));
 expect(s.requests).toHaveLength(1);expect(s.requests[0]!.body.toString()).toContain(s.bytes.toString('base64'));
 expect(s.engine.modelConfig.listModels().models.every(m=>!m.capabilities.outputKinds.some(kind=>kind==='image'))).toBe(true);
},30000);
it('skips the image profile only for reused shots',async()=>{
 const s=await setup(),imageProfileRef=await addWorkflowModel(s,'images','openai-image-v1');
 value(await execute(s.engine,'creation.saveShot',{...s.shot,id:'shot2',order:1}));
 const p=value(await execute(s.engine,'shots.prepareProduction',{...s.input,imageProfileRef,shots:[...s.input.shots,{shotId:'shot2',revision:1}]}));
 expect(p.steps.map((x:any)=>[x.shotId,x.role])).toEqual([['shot','video'],['shot2','image'],['shot2','video']]);
 expect(p.operations.filter((x:any)=>x.kind==='first_frame')).toHaveLength(1);
});
it('rejects changed selections when applying the frozen plan',async()=>{
 const s=await setup(),p=value(await execute(s.engine,'shots.prepareProduction',s.input));
 value(await execute(s.engine,'creation.selectOutput',{projectId:s.projectId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:1,role:'image',reference:null}));
 expect(await execute(s.engine,'shots.applyProduction',{productionId:p.productionId,approvedHash:p.planHash,expectedCanvasRevision:p.canvasRevision,executionOwner:'human',runId:'reuse-run'})).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});
 expect(s.requests).toHaveLength(0);
});
it('rejects duplicate/unselected reuse rows or no video profile',async()=>{
 const s=await setup();
 expect(parsePrepareShotProduction({...s.input,reusedImages:[...s.input.reusedImages,...s.input.reusedImages]}).ok).toBe(false);
 expect(parsePrepareShotProduction({...s.input,reusedImages:[{...s.input.reusedImages[0],shotId:'missing'}]}).ok).toBe(false);
 const {videoProfileRef:_,...rest}=s.input;expect(parsePrepareShotProduction({...rest,imageProfileRef:s.prepareInput().profileRef}).ok).toBe(false);
});
it('rejects non-images and foreign media before submission',async()=>{
 const s=await setup(),ref=await s.importFile(Buffer.from('not image'),'note.txt');
 for(const media of [ref,{...s.ref,libraryId:'foreign'}])expect(await execute(s.engine,'shots.prepareProduction',{...s.input,reusedImages:[{shotId:'shot',ref:media,role:'first_frame'}]})).toMatchObject({ok:false});
 expect(s.requests).toHaveLength(0);
});
it('does not silently drop unsupported reference roles',async()=>{
 const s=await setup(), {libraryId:_,revision:__,createdAt:___,...model}=s.engine.modelConfig.listModels().models[0]!;
 const modelRef=value(await execute(s.engine,'model.saveDefinition',{...model,expectedRevision:1,capabilities:{taskTypes:['text_to_video'],inputKinds:['text'],outputKinds:['video'],maxBatch:1}}));
 const videoProfileRef=value(await execute(s.engine,'profile.save',{id:'native',expectedRevision:1,name:'Video without image',modelRef,parameters:{}}));
 expect(await execute(s.engine,'shots.prepareProduction',{...s.input,videoProfileRef})).toMatchObject({ok:false,error:{code:'UNSUPPORTED_REFERENCE'}});
 expect(s.requests).toHaveLength(0);
});

for(const unavailable of [false,true])it('reuses only the finished shot image despite unused entity references (unavailable='+unavailable+')',async()=>{
 const s=await setup(),refs=[];
 for(let n=0;n<6;n++)refs.push(await s.importFile(await sharp({create:{width:512,height:288,channels:3,background:{r:n*30,g:20,b:40}}}).png().toBuffer(),'entity-'+n+'.png'));
 const entityRefs=[];
 for(let n=0;n<2;n++){value(await execute(s.engine,'creation.saveEntity',{projectId:s.projectId,id:'hero'+n,expectedRevision:0,kind:'character',name:'Hero'+n,description:'',constraints:'',references:refs.slice(n*3,n*3+3)}));entityRefs.push({libraryId:s.engine.identity.libraryId,projectId:s.projectId,entityId:'hero'+n,revision:1});}
 value(await execute(s.engine,'creation.saveShot',{...s.shot,expectedRevision:1,entityRefs}));
 if(unavailable)value(await execute(s.engine,'asset.trash',{assetId:refs[0].assetId,expectedRevision:1}));
 const input={...s.input,shots:[{shotId:'shot',revision:2}]};
 const p=value(await execute(s.engine,'shots.prepareProduction',input));
 expect(p.steps).toHaveLength(1);expect(p.steps[0].referenceImages).toEqual([{role:'first_frame',ref:s.ref}]);expect(p.snapshots[0].entities).toHaveLength(2);
 const {reusedImages:_,...normal}=input;
 expect(await execute(s.engine,'shots.prepareProduction',normal)).toMatchObject({ok:false,error:{code:'INVALID_REFERENCE'}});
});
for(const damage of ['missing','corrupt'])it('rejects a '+damage+' collected first frame before preparing any task',async()=>{
 const s=await setup(),meta=value(s.engine.assets.metadata(s.ref)),object=join(s.root,'objects',meta.hash.slice(0,2),meta.hash);
 if(damage==='missing')await unlink(object);else await writeFile(object,Buffer.alloc(s.bytes.length,7));
 expect(await execute(s.engine,'shots.prepareProduction',s.input)).toMatchObject({ok:false,error:{code:'OBJECT_INTEGRITY_FAILED'}});
 expect(s.engine.generation.list().tasks).toHaveLength(0);expect(s.requests).toHaveLength(0);
});
it('records a definite local image failure after approval without an unknown remote submission',async()=>{
 const s=await setup(),p=value(await execute(s.engine,'shots.prepareProduction',s.input));
 value(await execute(s.engine,'shots.applyProduction',{productionId:p.productionId,approvedHash:p.planHash,expectedCanvasRevision:p.canvasRevision,executionOwner:'human',runId:'reuse-run'}));
 const w=value(await execute(s.engine,'workflow.prepare',{canvasId:s.projectId,mode:'selection',nodeIds:p.steps.map((x:any)=>x.nodeId),executionOwner:'human',runId:'reuse-run'}));
 value(await execute(s.engine,'shots.attachWorkflow',{productionId:p.productionId,workflowId:w.planId,executionOwner:'human'}));
 value(await execute(s.engine,'workflow.approveAndEnqueue',{planId:w.planId,approvedPlanHash:w.planHash,currency:'CNY',budgetLimitMicros:1000000,stepAllowances:Object.fromEntries(w.steps.map((x:any)=>[x.stepId,10000])),acknowledgeUnknown:true,executionOwner:'human',runId:'reuse-run'}));
 value(await s.engine.workflows.wake());const task=value(s.engine.workflows.read(w.planId)).steps[0].task;
 const meta=value(s.engine.assets.metadata(s.ref));await unlink(join(s.root,'objects',meta.hash.slice(0,2),meta.hash));
 const result=value(await s.engine.scheduler.run(task.attemptId));expect(result.state).toBe('FAILED');expect(result.reservationMicros).toBe(0);expect(s.requests).toHaveLength(0);
});
