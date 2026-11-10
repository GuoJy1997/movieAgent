import { isPreparedShotProduction } from '../../packages/contracts/src/shot-production';
import { CURRENT_SCHEMA_VERSION } from '../../packages/contracts/src/schema.ts';
import { removeLocalMediaSchema } from './local-media-migration-fixture.ts';
import { expect, it } from 'vitest';
import { graphFixture, addWorkflowModel } from '../fixtures/workflow';
import { execute, nativeFixture, value } from '../fixtures/native-generation';
import { acceptance, completed } from '../fixtures/agent';
import sharp from 'sharp';
import { readFile, readdir } from 'node:fs/promises';
import { ArtifactSource } from '../../packages/providers/src/artifact-source';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

async function setup() {
  const fixture = await graphFixture();
  const imageProfileRef = await addWorkflowModel(fixture, 'shot-image', 'openai-image-v1');
  const videoProfileRef = await addWorkflowModel(fixture, 'shot-video', 'minimax-video-v2');
  const projectId = fixture.canvasId;
  value(await execute(fixture.engine, 'creation.saveScript', {
    projectId, id: 'script', expectedRevision: 0, title: 'Film', synopsis: 'A dock', body: 'The hero arrives.',
    scenes: [{ id: 'scene', title: 'Arrival', location: 'Dock', time: 'Night', description: 'Rain' }],
  }));
  value(await execute(fixture.engine, 'creation.saveShot', {
    projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0,
    title: 'Arrival', durationSeconds: 5, shotSize: 'wide', cameraMovement: 'pan', subject: 'Hero',
    action: 'arrives', dialogue: '', sound: '', aspectRatio: '16:9', prompt: 'hero arrives at a dock', entityRefs: [],
  }));
  const prepareInput = { projectId, scriptId: 'script', canvasId: fixture.canvasId,
    shots: [{ shotId: 'shot', revision: 1 }], imageProfileRef, videoProfileRef,
    executionOwner: 'human', runId: 'production-run' };
  return { ...fixture, prepareInput };
}

it('freezes shot and parent scene revisions in a two-step plan and applies one bound graph', async () => {
  const s = await setup();
  const prepared = value(await execute(s.engine, 'shots.prepareProduction', s.prepareInput));
  expect(prepared.snapshots).toMatchObject([{ shotId: 'shot', shotRevision: 1, scriptRevision: 1, scene: { id: 'scene', description: 'Rain' } }]);
  expect(prepared.steps.map((step: any) => step.role)).toEqual(['image', 'video']);
  expect(prepared.steps[1].aspectNotice).toContain('adaptive');
  expect(prepared.steps[1].aspectNotice).toContain('16:9');
  expect(prepared.operations).toHaveLength(3);
  const applied = value(await execute(s.engine, 'shots.applyProduction', {
    productionId: prepared.productionId, approvedHash: prepared.planHash,
    expectedCanvasRevision: prepared.canvasRevision, executionOwner: 'human', runId: 'production-run',
  }));
  expect(applied.state).toBe('applied');
  expect(s.read().edges.some((edge: any) => edge.targetPort === 'first_frame' && edge.sourceNodeId === prepared.steps[0].nodeId && edge.targetNodeId === prepared.steps[1].nodeId)).toBe(true);
  expect(s.read().nodes.filter((node: any) => prepared.steps.some((step: any) => step.nodeId === node.nodeId)).map((node: any) => node.shotBinding?.shotRevision)).toEqual([1, 1]);
});

it('rejects changed parent scenes, stale shots, and unsupported durations before canvas writes', async () => {
  const s = await setup();
  const prepared = value(await execute(s.engine, 'shots.prepareProduction', s.prepareInput));
  value(await execute(s.engine, 'creation.saveScript', { projectId:s.canvasId,id:'script',expectedRevision:1,title:'Film',synopsis:'A dock',body:'The hero arrives.',scenes:[{id:'scene',title:'Arrival',location:'Dock',time:'Day',description:'Sun'}] }));
  expect(await execute(s.engine,'shots.applyProduction',{productionId:prepared.productionId,approvedHash:prepared.planHash,expectedCanvasRevision:prepared.canvasRevision,executionOwner:'human',runId:'production-run'})).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});
  expect(s.read().nodes.some((node:any)=>prepared.steps.some((step:any)=>step.nodeId===node.nodeId))).toBe(false);
  expect(await execute(s.engine,'shots.prepareProduction',s.prepareInput)).toMatchObject({ok:true,value:{result:{snapshots:[{scriptRevision:2,scene:{description:'Sun'}}]}}});
  value(await execute(s.engine,'creation.saveShot',{projectId:s.canvasId,id:'shot',expectedRevision:1,scriptId:'script',sceneId:'scene',order:0,title:'Arrival',durationSeconds:20,shotSize:'wide',cameraMovement:'pan',subject:'Hero',action:'arrives',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'dock',entityRefs:[]}));
  expect(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,shots:[{shotId:'shot',revision:2}]})).toMatchObject({ok:false,error:{code:'UNSUPPORTED_DURATION'}});
});

it('requires exact production workflow association and closes bound-node admission on stop', async () => {
  const s=await setup();
  const prepared=value(await execute(s.engine,'shots.prepareProduction',s.prepareInput));
  value(await execute(s.engine,'shots.applyProduction',{productionId:prepared.productionId,approvedHash:prepared.planHash,expectedCanvasRevision:prepared.canvasRevision,executionOwner:'human',runId:'production-run'}));
  expect(await execute(s.engine,'generation.prepare',{projectId:s.canvasId,canvasNode:{canvasId:s.canvasId,nodeId:prepared.steps[0].nodeId},executionOwner:'human',runId:'direct'})).toMatchObject({ok:false,error:{code:'SHOT_BOUND'}});
  expect(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:[prepared.steps[0].nodeId],executionOwner:'human',runId:'production-run'})).toMatchObject({ok:false,error:{code:'WORKFLOW_MISMATCH'}});
  const workflow=value(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:prepared.steps.map((x:any)=>x.nodeId),executionOwner:'human',runId:'production-run'}));
  const approval={planId:workflow.planId,approvedPlanHash:workflow.planHash,currency:'CNY',budgetLimitMicros:1000000,stepAllowances:Object.fromEntries(workflow.steps.map((x:any)=>[x.stepId,10000])),acknowledgeUnknown:true,executionOwner:'human',runId:'production-run'};
  expect(await execute(s.engine,'workflow.approveAndEnqueue',approval)).toMatchObject({ok:false,error:{code:'SHOT_BOUND'}});
  value(await execute(s.engine,'shots.attachWorkflow',{productionId:prepared.productionId,workflowId:workflow.planId,executionOwner:'human'}));
  value(await execute(s.engine,'shots.stopProduction',{productionId:prepared.productionId,executionOwner:'human'}));
  expect(await execute(s.engine,'workflow.approveAndEnqueue',approval)).toMatchObject({ok:false});
  expect(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:prepared.steps.map((x:any)=>x.nodeId),executionOwner:'human',runId:'production-run'})).toMatchObject({ok:false,error:{code:'PRODUCTION_STOPPED'}});
  expect(s.requests).toHaveLength(0);
});

it('collects image then video once, selects both with one advancing selection revision, and recovers without repost', async () => {
  const s=await setup();
  const plan=value(await execute(s.engine,'shots.prepareProduction',s.prepareInput));
  value(await execute(s.engine,'shots.applyProduction',{productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'production-run'}));
  const workflow=value(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:plan.steps.map((x:any)=>x.nodeId),executionOwner:'human',runId:'production-run'}));
  value(await execute(s.engine,'shots.attachWorkflow',{productionId:plan.productionId,workflowId:workflow.planId,executionOwner:'human'}));
  value(await execute(s.engine,'workflow.approveAndEnqueue',{planId:workflow.planId,approvedPlanHash:workflow.planHash,currency:'CNY',budgetLimitMicros:1000000,stepAllowances:Object.fromEntries(workflow.steps.map((x:any)=>[x.stepId,10000])),acknowledgeUnknown:true,executionOwner:'human',runId:'production-run'}));
  value(await s.engine.workflows.wake());
  let running=value(s.engine.workflows.read(workflow.planId));
  expect(running.steps.map((x:any)=>[x.state,x.errorCode])).toEqual([['queued',null],['waiting',null]]);
  const png=await sharp({create:{width:256,height:256,channels:3,background:'#123456'}}).png().toBuffer();
  s.response({data:[{b64_json:png.toString('base64')}]});
  value(await s.engine.scheduler.run(running.steps[0].task.attemptId));
  value(await s.engine.workflows.wake());
  value(s.engine.shots.harvest());
  expect(value(s.engine.shots.history(s.canvasId,'shot')).outputs).toMatchObject([{role:'image',selected:true}]);
  running=value(s.engine.workflows.read(workflow.planId));
  s.response({task_id:'production-video'});
  const videoTask=running.steps[1].task;
  value(await s.engine.scheduler.run(videoTask.attemptId));
  value(await new ArtifactSource(s.root,undefined,'video').stage(`${videoTask.attemptId}-output`,await readFile(new URL('../fixtures/video-sample.mp4',import.meta.url))));
  await s.engine.close();
  s.response({task:{id:'production-video',status:'succeeded',content:{url:'https://cdn.example/fixture.mp4'}}});
  const reopened=await s.open();
  value(await reopened.scheduler.recover());
  value(await reopened.workflows.wake());
  value(reopened.shots.harvest());
  const history=value(reopened.shots.history(s.canvasId,'shot'));
  expect(history.outputs.map((x:any)=>[x.role,x.selected])).toEqual([['image',true],['video',true]]);
  expect(value(reopened.creation.read({projectId:s.canvasId})).selections).toMatchObject([{selectionRevision:2,image:history.outputs[0].reference,video:history.outputs[1].reference}]);
  value(reopened.shots.harvest());
  expect(value(reopened.shots.history(s.canvasId,'shot')).outputs).toHaveLength(2);
  expect(s.requests.map(r=>r.url)).toEqual(['/v1/images/generations','/v2/video_generation','/v2/query/video_generation/production-video']);
});

it('takes an accepted Agent text proposal through replay-safe apply, image, video and fixed shot history', async () => {
  const s=await nativeFixture();
  const imageProfileRef=await addWorkflowModel(s,'joined-image','openai-image-v1');
  const videoProfileRef=await addWorkflowModel(s,'joined-video','minimax-video-v2');
  const planned=await completed(s);
  expect(planned.run.state).toBe('PROPOSED');
  const action=value(await execute(s.engine,'agent.acceptProposal',acceptance(planned.run)));
  expect(action.acceptedReferences).toHaveLength(1);
  const accepted=action.acceptedReferences[0];
  expect(action.result.shots).toMatchObject([{id:accepted.shotId,revision:accepted.shotRevision}]);
  const canvasId=planned.projectId;
  const plan=value(await execute(s.engine,'shots.prepareProduction',{
    projectId:planned.projectId,scriptId:accepted.scriptId,canvasId,
    shots:[{shotId:accepted.shotId,revision:accepted.shotRevision}],
    imageProfileRef,videoProfileRef,executionOwner:'human',runId:'joined-production',
  }));
  expect(plan.snapshots).toMatchObject([{shotId:accepted.shotId,shotRevision:accepted.shotRevision,scriptRevision:accepted.scriptRevision,scene:{id:accepted.sceneId}}]);
  const applyInput={productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'joined-production'};
  const applied=value(await execute(s.engine,'shots.applyProduction',applyInput));
  const firstGraph=value(s.engine.canvas.read(canvasId));
  const firstDerived=s.engine.modelConfig.listProfiles().profiles.filter(p=>p.id.startsWith('shot-profile-'));
  const replay=value(await execute(s.engine,'shots.applyProduction',applyInput)); // fresh commandId
  const replayGraph=value(s.engine.canvas.read(canvasId));
  expect(replay.productionId).toBe(applied.productionId);
  expect(replayGraph.revision).toBe(firstGraph.revision);
  expect(replayGraph.edges).toEqual(firstGraph.edges);
  expect(replayGraph.nodes.map((node:any)=>[node.nodeId,node.shotBinding])).toEqual(firstGraph.nodes.map((node:any)=>[node.nodeId,node.shotBinding]));
  expect(s.engine.modelConfig.listProfiles().profiles.filter(p=>p.id.startsWith('shot-profile-'))).toEqual(firstDerived);
  expect(value(s.engine.shots.history(canvasId,accepted.shotId)).productions).toHaveLength(1);

  const workflow=value(await execute(s.engine,'workflow.prepare',{canvasId,mode:'selection',nodeIds:plan.steps.map((step:any)=>step.nodeId),executionOwner:'human',runId:'joined-production'}));
  value(await execute(s.engine,'shots.attachWorkflow',{productionId:plan.productionId,workflowId:workflow.planId,executionOwner:'human'}));
  value(await execute(s.engine,'workflow.approveAndEnqueue',{planId:workflow.planId,approvedPlanHash:workflow.planHash,currency:'CNY',budgetLimitMicros:100000000,stepAllowances:Object.fromEntries(workflow.steps.map((step:any)=>[step.stepId,10000])),acknowledgeUnknown:true,executionOwner:'human',runId:'joined-production'}));
  value(await s.engine.workflows.wake());
  let running=value(s.engine.workflows.read(workflow.planId));
  const png=await sharp({create:{width:256,height:256,channels:3,background:'#123456'}}).png().toBuffer();
  s.response({data:[{b64_json:png.toString('base64')}]});
  value(await s.engine.scheduler.run(running.steps[0].task.attemptId));
  value(await s.engine.workflows.wake());
  value(s.engine.shots.harvest());
  running=value(s.engine.workflows.read(workflow.planId));
  s.response({task_id:'joined-video-task'});
  const videoTask=running.steps[1].task;
  value(await s.engine.scheduler.run(videoTask.attemptId));
  value(await new ArtifactSource(s.root,undefined,'video').stage(`${videoTask.attemptId}-output`,await readFile(new URL('../fixtures/video-sample.mp4',import.meta.url))));
  await s.engine.close();
  s.response({task:{id:'joined-video-task',status:'succeeded',content:{url:'https://cdn.example/joined.mp4'}}});
  const reopened=await s.open();
  value(await reopened.scheduler.recover());
  value(await reopened.workflows.wake());
  value(reopened.shots.harvest());
  const history=value(reopened.shots.history(canvasId,accepted.shotId));
  expect(history.productions).toMatchObject([{productionId:plan.productionId,shotRevision:accepted.shotRevision,scriptRevision:accepted.scriptRevision,workflowId:workflow.planId}]);
  expect(history.outputs.map((output:any)=>[output.role,output.selected])).toEqual([['image',true],['video',true]]);
  expect(value(reopened.creation.read({projectId:planned.projectId})).selections).toMatchObject([{shotId:accepted.shotId,selectionRevision:2,image:history.outputs[0].reference,video:history.outputs[1].reference}]);
  value(reopened.shots.harvest());
  expect(value(reopened.shots.history(canvasId,accepted.shotId)).outputs).toHaveLength(2);
  expect(s.requests.map(request=>request.url)).toEqual(['/v1/chat/completions','/v1/images/generations','/v2/video_generation','/v2/query/video_generation/joined-video-task']);
});

it('keeps a late image in production history after an intervening human selection', async () => {
  const s=await setup();
  const input={...s.prepareInput,videoProfileRef:undefined};
  const plan=value(await execute(s.engine,'shots.prepareProduction',input));
  value(await execute(s.engine,'shots.applyProduction',{productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'production-run'}));
  const workflow=value(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:[plan.steps[0].nodeId],executionOwner:'human',runId:'production-run'}));
  value(await execute(s.engine,'shots.attachWorkflow',{productionId:plan.productionId,workflowId:workflow.planId,executionOwner:'human'}));
  value(await execute(s.engine,'workflow.approveAndEnqueue',{planId:workflow.planId,approvedPlanHash:workflow.planHash,currency:'CNY',budgetLimitMicros:1000000,stepAllowances:{[workflow.steps[0].stepId]:10000},acknowledgeUnknown:true,executionOwner:'human',runId:'production-run'}));
  value(await s.engine.workflows.wake());
  const task=value(s.engine.workflows.read(workflow.planId)).steps[0].task;
  const manualPng=await sharp({create:{width:256,height:256,channels:3,background:'#abcdef'}}).png().toBuffer();
  const manual=await s.importFile(manualPng,'manual-shot.png');
  value(await execute(s.engine,'shots.selectOutput',{projectId:s.canvasId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'image',reference:manual}));
  const generatedPng=await sharp({create:{width:256,height:256,channels:3,background:'#123456'}}).png().toBuffer();
  s.response({data:[{b64_json:generatedPng.toString('base64')}]});
  value(await s.engine.scheduler.run(task.attemptId));
  value(await s.engine.workflows.wake());value(s.engine.shots.harvest());
  expect(value(s.engine.shots.history(s.canvasId,'shot')).outputs).toMatchObject([{selected:false,errorCode:'SELECTION_CONFLICT'}]);
  expect(value(s.engine.creation.read({projectId:s.canvasId})).selections).toMatchObject([{selectionRevision:1,image:manual}]);
});

it('prepares video-only reference generation with fixed entity image and an adaptive derived profile', async () => {
  const s=await setup();
  const png=await sharp({create:{width:256,height:256,channels:3,background:'#345678'}}).png().toBuffer();
  const ref=await s.importFile(png,'entity-reference.png');
  value(await execute(s.engine,'creation.saveEntity',{projectId:s.canvasId,id:'hero',expectedRevision:0,kind:'character',name:'Hero',description:'Blue coat',constraints:'',references:[ref]}));
  value(await execute(s.engine,'creation.saveShot',{projectId:s.canvasId,id:'shot',expectedRevision:1,scriptId:'script',sceneId:'scene',order:0,title:'Arrival',durationSeconds:5,shotSize:'wide',cameraMovement:'pan',subject:'Hero',action:'arrives',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'dock',entityRefs:[{libraryId:s.engine.identity.libraryId,projectId:s.canvasId,entityId:'hero',revision:1}]}));
  const plan=value(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,shots:[{shotId:'shot',revision:2}],imageProfileRef:undefined}));
  expect(plan.steps).toMatchObject([{role:'video',overrides:{duration:5,ratio:'adaptive'},referenceImages:[{role:'reference',ref}]}]);
  expect(plan.snapshots[0].entities).toMatchObject([{id:'hero',revision:1,references:[ref]}]);
  value(await execute(s.engine,'shots.applyProduction',{productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'production-run'}));
  expect(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:[plan.steps[0].nodeId],executionOwner:'human',runId:'production-run'})).toMatchObject({ok:true});
});

it('preserves prior bound nodes when regenerating only one changed shot', async () => {
  const s=await setup();
  const first=value(await execute(s.engine,'shots.prepareProduction',s.prepareInput));
  value(await execute(s.engine,'shots.applyProduction',{productionId:first.productionId,approvedHash:first.planHash,expectedCanvasRevision:first.canvasRevision,executionOwner:'human',runId:'production-run'}));
  value(await execute(s.engine,'creation.saveShot',{projectId:s.canvasId,id:'shot',expectedRevision:1,scriptId:'script',sceneId:'scene',order:0,title:'New framing',durationSeconds:5,shotSize:'close',cameraMovement:'still',subject:'Hero',action:'arrives',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'close portrait',entityRefs:[]}));
  const next=value(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,shots:[{shotId:'shot',revision:2}],runId:'production-rerun'}));
  value(await execute(s.engine,'shots.applyProduction',{productionId:next.productionId,approvedHash:next.planHash,expectedCanvasRevision:next.canvasRevision,executionOwner:'human',runId:'production-rerun'}));
  const nodes=s.read().nodes.filter((node:any)=>node.shotBinding);
  expect(nodes.map((node:any)=>[node.shotBinding.shotRevision,node.content.prompt])).toEqual([[1,'hero arrives at a dock'],[1,'hero arrives at a dock'],[2,'close portrait'],[2,'close portrait']]);
  expect(value(s.engine.shots.history(s.canvasId,'shot')).productions).toMatchObject([
    {productionId:first.productionId,shotRevision:1,nodeIds:first.steps.map((x:any)=>x.nodeId)},
    {productionId:next.productionId,shotRevision:2,nodeIds:next.steps.map((x:any)=>x.nodeId)},
  ]);
  const old=nodes[0];
  expect(await s.apply([{kind:'setContent',nodeId:old.nodeId,incarnation:old.incarnation,expectedRevision:old.semanticRevision,content:{...old.content,prompt:'overwrite'}}])).toMatchObject({ok:false,error:{code:'SHOT_BOUND'}});
  expect(await s.apply([{kind:'delete',nodeId:old.nodeId,incarnation:old.incarnation,expectedSemanticRevision:old.semanticRevision,expectedLayoutRevision:old.layoutRevision,expectedSelectionRevision:old.selectionRevision,expectedRunBindingId:old.activeRunBindingId}])).toMatchObject({ok:false,error:{code:'SHOT_BOUND'}});
  expect(await s.apply([{kind:'addEdge',edge:s.edge('bound-input','a',old.nodeId,'prompt')}])).toMatchObject({ok:false,error:{code:'SHOT_BOUND'}});
});

it('rejects stale selection, changed source profile, unsupported output kind and unsupported entity references', async () => {
  const s=await setup();
  const plan=value(await execute(s.engine,'shots.prepareProduction',s.prepareInput));
  const png=await sharp({create:{width:256,height:256,channels:3,background:'#465789'}}).png().toBuffer();
  const manual=await s.importFile(png,'selected-before-apply.png');
  value(await execute(s.engine,'shots.selectOutput',{projectId:s.canvasId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'image',reference:manual}));
  expect(await execute(s.engine,'shots.applyProduction',{productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'production-run'})).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});
  expect(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,imageProfileRef:s.prepareInput.videoProfileRef,videoProfileRef:undefined})).toMatchObject({ok:false,error:{code:'UNSUPPORTED_CAPABILITY'}});
  const fresh=value(await execute(s.engine,'shots.prepareProduction',s.prepareInput));
  const source=s.engine.modelConfig.listProfiles().profiles.find((p:any)=>p.id===s.prepareInput.videoProfileRef.id)!;
  value(await execute(s.engine,'profile.save',{id:source.id,expectedRevision:1,name:source.name,modelRef:source.modelRef,parameters:{...source.parameters,duration:6}}));
  expect(await execute(s.engine,'shots.applyProduction',{productionId:fresh.productionId,approvedHash:fresh.planHash,expectedCanvasRevision:fresh.canvasRevision,executionOwner:'human',runId:'production-run'})).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});
  value(await execute(s.engine,'creation.saveEntity',{projectId:s.canvasId,id:'hero',expectedRevision:0,kind:'character',name:'Hero',description:'',constraints:'',references:[manual]}));
  value(await execute(s.engine,'creation.saveShot',{projectId:s.canvasId,id:'shot',expectedRevision:1,scriptId:'script',sceneId:'scene',order:0,title:'Arrival',durationSeconds:5,shotSize:'wide',cameraMovement:'pan',subject:'Hero',action:'arrives',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'dock',entityRefs:[{libraryId:s.engine.identity.libraryId,projectId:s.canvasId,entityId:'hero',revision:1}]}));
  expect(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,shots:[{shotId:'shot',revision:2}],videoProfileRef:undefined})).toMatchObject({ok:false,error:{code:'UNSUPPORTED_REFERENCE'}});
});

it('caps the selected scope at sixteen shots and produces exactly thirty-two steps with bounded operations', async () => {
  const s=await setup();
  for(let i=1;i<16;i++)value(await execute(s.engine,'creation.saveShot',{projectId:s.canvasId,id:`shot-${i}`,expectedRevision:0,scriptId:'script',sceneId:'scene',order:i,title:`Shot ${i}`,durationSeconds:5,shotSize:'wide',cameraMovement:'pan',subject:'Hero',action:'walks',dialogue:'',sound:'',aspectRatio:'16:9',prompt:`Shot ${i}`,entityRefs:[]}));
  const shots=[{shotId:'shot',revision:1},...Array.from({length:15},(_,i)=>({shotId:`shot-${i+1}`,revision:1}))];
  const plan=value(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,shots}));
  expect(plan.steps).toHaveLength(32);
  expect(plan.operations).toHaveLength(48);
  expect(plan.operations.length).toBeLessThanOrEqual(100);
  expect(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,shots:[...shots,{shotId:'shot-16',revision:1}]})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
});

it('collects an independent successful shot even when another production step fails', async () => {
  const s=await setup();
  value(await execute(s.engine,'creation.saveShot',{projectId:s.canvasId,id:'second',expectedRevision:0,scriptId:'script',sceneId:'scene',order:1,title:'Second',durationSeconds:5,shotSize:'wide',cameraMovement:'pan',subject:'Hero',action:'walks',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'second image',entityRefs:[]}));
  const plan=value(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,shots:[{shotId:'shot',revision:1},{shotId:'second',revision:1}],videoProfileRef:undefined}));
  value(await execute(s.engine,'shots.applyProduction',{productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'production-run'}));
  const workflow=value(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:plan.steps.map((x:any)=>x.nodeId),executionOwner:'human',runId:'production-run'}));
  value(await execute(s.engine,'shots.attachWorkflow',{productionId:plan.productionId,workflowId:workflow.planId,executionOwner:'human'}));
  value(await execute(s.engine,'workflow.approveAndEnqueue',{planId:workflow.planId,approvedPlanHash:workflow.planHash,currency:'CNY',budgetLimitMicros:1000000,stepAllowances:Object.fromEntries(workflow.steps.map((x:any)=>[x.stepId,10000])),acknowledgeUnknown:true,executionOwner:'human',runId:'production-run'}));
  value(await s.engine.workflows.wake());
  const running=value(s.engine.workflows.read(workflow.planId));
  const failedStep=running.steps.find((step:any)=>step.nodeId===plan.steps.find((x:any)=>x.shotId==='shot').nodeId);
  const successfulStep=running.steps.find((step:any)=>step.nodeId===plan.steps.find((x:any)=>x.shotId==='second').nodeId);
  value(s.engine.generation.recordSchedulerFailure(failedStep.task.attemptId,'FIXTURE_FAILED'));
  value(await s.engine.workflows.wake());
  const png=await sharp({create:{width:256,height:256,channels:3,background:'#232323'}}).png().toBuffer();
  s.response({data:[{b64_json:png.toString('base64')}]});
  value(await s.engine.scheduler.run(successfulStep.task.attemptId));
  value(await s.engine.workflows.wake());value(s.engine.shots.harvest());
  expect(value(s.engine.shots.history(s.canvasId,'shot')).outputs).toHaveLength(0);
  expect(value(s.engine.shots.history(s.canvasId,'second')).outputs).toMatchObject([{selected:true,role:'image'}]);
  expect(s.requests).toHaveLength(1);
});

it('reports one durable collection failure, collects another item, and retries without duplicate history', async () => {
  const s=await setup();
  value(await execute(s.engine,'creation.saveShot',{projectId:s.canvasId,id:'second',expectedRevision:0,scriptId:'script',sceneId:'scene',order:1,title:'Second',durationSeconds:5,shotSize:'wide',cameraMovement:'pan',subject:'Hero',action:'walks',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'second image',entityRefs:[]}));
  const plan=value(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,shots:[{shotId:'shot',revision:1},{shotId:'second',revision:1}],videoProfileRef:undefined}));
  value(await execute(s.engine,'shots.applyProduction',{productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'production-run'}));
  const workflow=value(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:plan.steps.map((x:any)=>x.nodeId),executionOwner:'human',runId:'production-run'}));
  value(await execute(s.engine,'shots.attachWorkflow',{productionId:plan.productionId,workflowId:workflow.planId,executionOwner:'human'}));
  value(await execute(s.engine,'workflow.approveAndEnqueue',{planId:workflow.planId,approvedPlanHash:workflow.planHash,currency:'CNY',budgetLimitMicros:1000000,stepAllowances:Object.fromEntries(workflow.steps.map((x:any)=>[x.stepId,10000])),acknowledgeUnknown:true,executionOwner:'human',runId:'production-run'}));
  value(await s.engine.workflows.wake());
  const running=value(s.engine.workflows.read(workflow.planId));
  const png=await sharp({create:{width:256,height:256,channels:3,background:'#abcdef'}}).png().toBuffer();
  s.response({data:[{b64_json:png.toString('base64')}]});
  for(const step of running.steps)value(await s.engine.scheduler.run(step.task.attemptId));
  value(await s.engine.workflows.wake());
  const badNode=plan.steps.find((step:any)=>step.shotId==='shot').nodeId;
  const fixtureDb=new DatabaseSync(join(s.root,'library.sqlite'));
  fixtureDb.exec(`CREATE TRIGGER fixture_collection_failure BEFORE INSERT ON shot_production_output WHEN NEW.node_id='${badNode}' BEGIN SELECT RAISE(ABORT,'fixture collection failure'); END`);
  try {
    const report=value(s.engine.shots.harvest());
    expect(report.failures).toMatchObject([{productionId:plan.productionId,nodeId:badNode,errorCode:'COLLECTION_WRITE_FAILED',persisted:true}]);
    expect(report.collected).toBe(1);
    const repeatedFailure=value(s.engine.shots.harvest());
    expect(repeatedFailure.failures).toMatchObject([{issueId:report.failures[0].issueId,createdAt:report.failures[0].createdAt,persisted:true}]);
    expect(repeatedFailure.collected).toBe(0);
    const publicRead=s.engine.commands.query({schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'test',queryId:'issue-read',kind:'shots.production',payload:{productionId:plan.productionId}});
    expect(publicRead).toMatchObject({ok:true,value:{collectionIssues:[{nodeId:badNode,errorCode:'COLLECTION_WRITE_FAILED'}],outputs:[{shotId:'second',selected:true}]}});
    expect(value(s.engine.shots.history(s.canvasId,'shot')).outputs).toHaveLength(0);
    expect(value(s.engine.creation.read({projectId:s.canvasId})).selections).toMatchObject([{shotId:'second',selectionRevision:1}]);
    await s.engine.close();
    const reopened=await s.open();
    expect(value(reopened.shots.read(plan.productionId)).collectionIssues).toMatchObject([{nodeId:badNode,errorCode:'COLLECTION_WRITE_FAILED'}]);
    fixtureDb.exec('DROP TRIGGER fixture_collection_failure');
    const retried=value(reopened.shots.harvest());
    expect(retried).toMatchObject({collected:1,failures:[]});
    expect(value(reopened.shots.read(plan.productionId)).collectionIssues).toEqual([]);
    expect(value(reopened.shots.history(s.canvasId,'shot')).outputs).toMatchObject([{selected:true}]);
    expect(value(reopened.shots.history(s.canvasId,'second')).outputs).toHaveLength(1);
    expect(value(reopened.creation.read({projectId:s.canvasId})).selections).toMatchObject([{shotId:'shot',selectionRevision:1},{shotId:'second',selectionRevision:1}]);
    expect(value(reopened.shots.harvest())).toMatchObject({collected:0,failures:[]});
    expect(s.requests).toHaveLength(2);
  } finally { fixtureDb.close(); }
});

it.each(['production','workflow'] as const)('exposes malformed saved %s data as a stable public collection issue', async corrupted => {
  const s=await setup();
  const plan=value(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,videoProfileRef:undefined}));
  value(await execute(s.engine,'shots.applyProduction',{productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'production-run'}));
  const workflow=value(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:[plan.steps[0].nodeId],executionOwner:'human',runId:'production-run'}));
  value(await execute(s.engine,'shots.attachWorkflow',{productionId:plan.productionId,workflowId:workflow.planId,executionOwner:'human'}));
  const fixtureDb=new DatabaseSync(join(s.root,'library.sqlite'));
  try {
    const table=corrupted==='production'?'shot_production':'workflow';
    const key=corrupted==='production'?'production_id':'plan_id';
    const recordId=corrupted==='production'?plan.productionId:workflow.planId;
    const savedPlan=fixtureDb.prepare(`SELECT plan_json FROM ${table} WHERE ${key}=?`).get(recordId)!.plan_json as string;
    if(corrupted==='production'){
      fixtureDb.exec('DROP TRIGGER immutable_shot_production_plan');
      fixtureDb.prepare('UPDATE shot_production SET plan_json=? WHERE production_id=?').run('{',plan.productionId);
    }
    else {
      fixtureDb.exec('DROP TRIGGER immutable_workflow_plan');
      fixtureDb.prepare('UPDATE workflow SET plan_json=? WHERE plan_id=?').run('{',workflow.planId);
    }
    const report=value(s.engine.shots.harvest());
    expect(report.failures).toMatchObject([{productionId:plan.productionId,errorCode:corrupted==='production'?'PRODUCTION_READ_FAILED':'WORKFLOW_READ_FAILED',persisted:true}]);
    const queried=s.engine.commands.query({schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'test',queryId:'issues',kind:'shots.collectionIssues',payload:{productionId:plan.productionId}});
    expect(queried).toMatchObject({ok:true,value:{productionId:plan.productionId,issues:[{errorCode:corrupted==='production'?'PRODUCTION_READ_FAILED':'WORKFLOW_READ_FAILED'}]}});
    fixtureDb.prepare('INSERT INTO shot_production_collection_issue(issue_id,production_id,node_id,task_id,error_code,created_at) VALUES(?,?,?,?,?,?)')
      .run('fixture-active-item',plan.productionId,plan.steps[0].nodeId,'fixture-task','COLLECTION_WRITE_FAILED',Date.now());
    fixtureDb.prepare(`UPDATE ${table} SET plan_json=? WHERE ${key}=?`).run(savedPlan,recordId);
    expect(value(s.engine.shots.harvest())).toMatchObject({collected:0,failures:[]});
    expect(value(s.engine.shots.collectionIssues(plan.productionId)).issues).toMatchObject([{issueId:'fixture-active-item',errorCode:'COLLECTION_WRITE_FAILED'}]);
  } finally { fixtureDb.close(); }
});

it('upgrades a populated original schema 13 library before production diagnostics reads', async () => {
  const s=await setup();
  const plan=value(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,videoProfileRef:undefined}));
  value(await execute(s.engine,'shots.applyProduction',{productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'production-run'}));
  const workflow=value(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:[plan.steps[0].nodeId],executionOwner:'human',runId:'production-run'}));
  value(await execute(s.engine,'shots.attachWorkflow',{productionId:plan.productionId,workflowId:workflow.planId,executionOwner:'human'}));
  await s.engine.close();
  const fixtureDb=new DatabaseSync(join(s.root,'library.sqlite'));
  try {
    removeLocalMediaSchema(fixtureDb);
    for (const table of ['dialogue_selection', 'dialogue_review', 'voice_audition', 'dialogue_production_item', 'dialogue_take', 'dialogue_production_plan', 'character_voice_media', 'shot_dialogue_current', 'shot_dialogue_revision', 'character_voice_current', 'character_voice_revision', 'finish_action', 'finish_message', 'finish_run', 'audio_publication', 'transcript_revision', 'audio_take', 'audio_batch_item', 'audio_batch', 'voice_line_revision', 'timeline_source_reference', 'timeline_assembly_receipt', 'timeline_assembly_plan', 'timeline_revision', 'timeline']) fixtureDb.exec('DROP TABLE IF EXISTS ' + table);
    fixtureDb.exec('DROP TABLE media_probe; DROP TABLE media_cache; DROP TABLE media_verification; DROP TABLE shot_production_collection_issue; UPDATE library SET schema_version=13; PRAGMA user_version=13');
    fixtureDb.prepare('DELETE FROM migration_log WHERE version>=14').run();
    expect(fixtureDb.prepare('PRAGMA user_version').get()).toMatchObject({user_version:13});
    expect(fixtureDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shot_production_collection_issue'").get()).toBeUndefined();
  } finally { fixtureDb.close(); }
  const reopened=await s.open();
  expect(reopened.identity.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(value(reopened.shots.read(plan.productionId))).toMatchObject({workflowId:workflow.planId,collectionIssues:[]});
  expect(value(reopened.shots.history(s.canvasId,'shot'))).toMatchObject({productions:[{productionId:plan.productionId}],collectionIssues:[]});
  expect(value(reopened.shots.collectionIssues(plan.productionId)).issues).toEqual([]);
  const backups=await readdir(join(s.root,'backups'));
  expect(backups.some(name=>name.startsWith('schema-13-')&&name.endsWith('.sqlite'))).toBe(true);
});

it('keeps an accepted late result in history when the production was stopped before collection', async () => {
  const s=await setup();
  const plan=value(await execute(s.engine,'shots.prepareProduction',{...s.prepareInput,videoProfileRef:undefined}));
  value(await execute(s.engine,'shots.applyProduction',{productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision,executionOwner:'human',runId:'production-run'}));
  const workflow=value(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'selection',nodeIds:[plan.steps[0].nodeId],executionOwner:'human',runId:'production-run'}));
  value(await execute(s.engine,'shots.attachWorkflow',{productionId:plan.productionId,workflowId:workflow.planId,executionOwner:'human'}));
  value(await execute(s.engine,'workflow.approveAndEnqueue',{planId:workflow.planId,approvedPlanHash:workflow.planHash,currency:'CNY',budgetLimitMicros:1000000,stepAllowances:{[workflow.steps[0].stepId]:10000},acknowledgeUnknown:true,executionOwner:'human',runId:'production-run'}));
  value(await s.engine.workflows.wake());
  const task=value(s.engine.workflows.read(workflow.planId)).steps[0].task;
  const png=await sharp({create:{width:256,height:256,channels:3,background:'#908070'}}).png().toBuffer();
  s.response({data:[{b64_json:png.toString('base64')}]});
  value(await s.engine.scheduler.run(task.attemptId));
  value(await execute(s.engine,'shots.stopProduction',{productionId:plan.productionId,executionOwner:'human'}));
  value(s.engine.shots.harvest());
  expect(value(s.engine.shots.history(s.canvasId,'shot')).outputs).toMatchObject([{selected:false,errorCode:'PRODUCTION_STOPPED'}]);
  expect(value(s.engine.creation.read({projectId:s.canvasId})).selections).toHaveLength(0);
  expect(s.requests).toHaveLength(1);
});

it('rejects malformed production scenes, operations and mismatched frozen ownership at the DTO boundary', async()=>{
 const s=await setup(),p=value(await execute(s.engine,'shots.prepareProduction',s.prepareInput));
 expect(isPreparedShotProduction(p)).toBe(true);
 for(const mutate of [
 (v:any)=>{v.snapshots[0].scene={};},
 (v:any)=>{v.snapshots[0].scene.title=12;},
 (v:any)=>{v.snapshots[0].scene.id='other';},
 (v:any)=>{v.snapshots[0].shot.scriptId='other';},
 (v:any)=>{v.snapshots[0].shot.projectId='foreign';},
 (v:any)=>{v.snapshots[0].selectionRevision=-1;},
 (v:any)=>{v.operations=[{kind:'shell',path:'outside'}];},
 (v:any)=>{v.operations[0].stepIndex=999;},
 (v:any)=>{v.operations[0].nodeId='unknown';},
 (v:any)=>{v.operations[2].sourceNodeId='unknown';},
 (v:any)=>{v.steps[0].shotId='unknown';},
 ]){const bad=structuredClone(p);mutate(bad);expect(isPreparedShotProduction(bad)).toBe(false);}
});
