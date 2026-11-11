import { expect, it } from 'vitest';
import { graphFixture, addWorkflowModel, prepareWorkflow as prepare, approveWorkflow as approve } from '../fixtures/workflow';
import { value, execute } from '../fixtures/native-generation';
it('freezes a typed scope, refuses missing external outputs, and charges waiting allowance against ordinary admission',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));
 expect(await prepare(s,'current')).toMatchObject({ok:false,error:{code:'WORKFLOW_INPUT_UNAVAILABLE'}});
 expect(await prepare(s,'selection')).toMatchObject({ok:false});
 const p=value(await prepare(s));expect(p.steps.map((x:any)=>x.nodeId)).toEqual(['a','b']);
 expect(p.steps[1].inputs[0]).toMatchObject({kind:'stepOutput',stepId:p.steps[0].stepId,targetPort:'prompt'});
 const approved=value(await approve(s,p,20));expect(approved.state).toBe('running');
 const ordinary=value(await execute(s.engine,'generation.prepare',s.prepareInput()));
 expect(await execute(s.engine,'generation.approveAndEnqueue',{preparedId:ordinary.preparedId,approvedPlanHash:ordinary.planHash,currency:'CNY',allowanceMicros:1,budgetLimitMicros:20,acknowledgeUnknown:true,executionOwner:ordinary.executionOwner,runId:ordinary.runId})).toMatchObject({ok:false,error:{code:'BUDGET_EXCEEDED'}});
});
it('uses one approval for durable dependency dispatch and normal binding, with replay-safe budget transfer',async()=>{
 const s=await graphFixture(); value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));
 const p=value(await prepare(s));value(await approve(s,p));
 value(await s.engine.workflows.wake());let w=value(s.engine.workflows.read(p.planId));expect(w.steps.map((x:any)=>x.state)).toEqual(['queued','waiting']);
 value(await s.engine.scheduler.run(w.steps[0].task.attemptId)); value(await s.engine.workflows.wake()); w=value(s.engine.workflows.read(p.planId));expect(w.steps[1].state).toBe('queued');
 value(await s.engine.scheduler.run(w.steps[1].task.attemptId)); value(await s.engine.workflows.wake());w=value(s.engine.workflows.read(p.planId));expect(w.state).toBe('succeeded');
 expect(s.requests).toHaveLength(2);expect(JSON.parse(s.requests[1]!.body.toString()).messages[0].content).toContain('Hello 世界'); expect(s.read().nodes.filter((x:any)=>['a','b'].includes(x.nodeId)).every((x:any)=>x.freshness==='current')).toBe(true);
 value(await s.engine.workflows.wake());expect(s.engine.generation.list().tasks).toHaveLength(2);expect(w.reservationMicros).toBe(20);
});
it('stops waiting and queued unsubmitted work without POST and releases only unsubmitted allowance',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepare(s));value(await approve(s,p));value(await s.engine.workflows.wake());const w=value(await execute(s.engine,'workflow.stop',{workflowId:p.planId}));expect(w.state).toBe('stopped');value(await s.engine.workflows.wake());
 for(const task of s.engine.generation.list().tasks) value(await s.engine.scheduler.run(task.attemptId));expect(s.requests).toHaveLength(0);expect(value(s.engine.workflows.read(p.planId)).reservationMicros).toBe(0);
});

it('marks previously completed downstream output stale after an automatic standalone upstream rerun',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepare(s));value(await approve(s,p));
 for(let i=0;i<2;i++){value(await s.engine.workflows.wake());const w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[i].task.attemptId));}value(await s.engine.workflows.wake());expect(s.node('b').freshness).toBe('current');
 const single=value(await execute(s.engine,'generation.prepare',{projectId:s.canvasId,canvasNode:{canvasId:s.canvasId,nodeId:'a'},executionOwner:'human',runId:'rerun'}));
 const task=value(await execute(s.engine,'generation.approveAndEnqueue',{preparedId:single.preparedId,approvedPlanHash:single.planHash,currency:'CNY',allowanceMicros:1,budgetLimitMicros:100,acknowledgeUnknown:true,executionOwner:'human',runId:'rerun'}));
 value(await s.engine.scheduler.run(task.attemptId));expect(s.node('b').freshness).toBe('stale');
});
it('executes the native text to image to reference-video chain, then recovers the accepted video by ID',async()=>{
 const s=await graphFixture(), image=await addWorkflowModel(s,'image','openai-image-v1'),video=await addWorkflowModel(s,'video','minimax-video-v2');
 for(const [id,profileRef] of [['b',image],['c',video]] as const){const n=s.node(id);value(await s.apply([{kind:'setContent',nodeId:id,incarnation:n.incarnation,expectedRevision:n.semanticRevision,content:{...n.content,profileRef}}]));}
 value(await s.apply([{kind:'addEdge',edge:s.edge('ab')},{kind:'addEdge',edge:s.edge('bc','b','c','first_frame')}]));
 const p=value(await prepare(s,'upstream',['c']));value(await approve(s,p));value(await s.engine.workflows.wake());let w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[0].task.attemptId));
 const sharp=(await import('sharp')).default,png=await sharp({create:{width:256,height:256,channels:3,background:'#123456'}}).png().toBuffer();s.response({data:[{b64_json:png.toString('base64')}]});
 value(await s.engine.workflows.wake());w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[1].task.attemptId));
 s.response({task_id:'workflow-video'});value(await s.engine.workflows.wake());w=value(s.engine.workflows.read(p.planId));const videoTask=w.steps[2].task;expect(value(await s.engine.scheduler.run(videoTask.attemptId)).providerTaskId).toBe('workflow-video');
 expect(JSON.parse(s.requests[1]!.body.toString()).prompt).toContain('Hello 世界');expect(JSON.parse(s.requests[2]!.body.toString()).content[1]).toEqual({type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')},role:'first_frame'});
 const {readFile}=await import('node:fs/promises'),{ArtifactSource}=await import('../../packages/providers/src/artifact-source');
 value(await new ArtifactSource(s.root,undefined,'video').stage(`${videoTask.attemptId}-output`,await readFile(new URL('../fixtures/video-sample.mp4',import.meta.url))));
 await s.engine.close();s.response({task:{id:'workflow-video',status:'succeeded',content:{url:'https://cdn.example/fixture.mp4'}}});const e=await s.open();value(await e.scheduler.recover());value(await e.workflows.wake());expect(value(e.workflows.read(p.planId)).state).toBe('succeeded');expect(value(e.canvas.read(s.canvasId)).nodes.every((n:any)=>n.freshness==='current')).toBe(true);
 expect(s.requests.map(r=>r.url)).toEqual(['/v1/chat/completions','/v1/images/generations','/v2/video_generation','/v2/query/video_generation/workflow-video']);
});
it('keeps frozen input and configuration after approval while manual upstream edits send dependent results to history',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepare(s));value(await approve(s,p));value(await s.engine.workflows.wake());let w=value(s.engine.workflows.read(p.planId));
 const n=s.node('a');value(await s.apply([{kind:'setContent',nodeId:'a',incarnation:n.incarnation,expectedRevision:n.semanticRevision,content:{...n.content,prompt:'MANUAL NEW'}}]));
 const original=s.engine.modelConfig.listProfiles().profiles[0]!,{libraryId:_l,revision:_r,createdAt:_c,...profile}=original;value(await execute(s.engine,'profile.save',{...profile,expectedRevision:original.revision,parameters:{max_tokens:20}}));
 value(await s.engine.scheduler.run(w.steps[0].task.attemptId));value(await s.engine.workflows.wake());w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[1].task.attemptId));value(await s.engine.workflows.wake());
 expect(JSON.parse(s.requests[0]!.body.toString()).messages[0].content).toBe('A quiet lake');expect(JSON.parse(s.requests[1]!.body.toString()).max_tokens).toBe(1024);expect(s.read().outputs.map((o:any)=>o.selection)).toEqual(['history','history']);expect(value(s.engine.workflows.read(p.planId)).state).toBe('succeeded');
});
it('fails an oversized dependency before network, blocks its dependent, and continues an independent branch',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepare(s,'selection',['a','b','c']));value(await approve(s,p));s.response({choices:[{message:{content:'x'.repeat(16001)},finish_reason:'stop'}]});value(await s.engine.workflows.wake());let w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[0].task.attemptId));value(await s.engine.workflows.wake());w=value(s.engine.workflows.read(p.planId));expect(w.steps.find((x:any)=>x.nodeId==='b')).toMatchObject({state:'failed',errorCode:'WORKFLOW_INPUT_LIMIT',reservationMicros:0});
 const c=w.steps.find((x:any)=>x.nodeId==='c');s.response({choices:[{message:{content:'independent'},finish_reason:'stop'}]});value(await s.engine.scheduler.run(c.task.attemptId));value(await s.engine.workflows.wake());expect(value(s.engine.workflows.read(p.planId)).state).toBe('failed');expect(s.requests).toHaveLength(2);
});
it('cannot approve a prepared plan after it has been stopped',async()=>{
 const s=await graphFixture(),p=value(await prepare(s,'current',['a']));value(await execute(s.engine,'workflow.stop',{workflowId:p.planId}));expect(await approve(s,p)).toMatchObject({ok:false,error:{code:'WORKFLOW_STOPPED'}});expect(s.engine.generation.list().tasks).toHaveLength(0);
});
it('rejects newly trashed fixed text at approval, while an already approved plan retains the frozen text',async()=>{
 const s=await graphFixture(),ref=await s.importFile(Buffer.from('fixed input'),'fixed.txt');value(await s.apply([{kind:'create',nodeId:'fixed',content:{type:'media',media:ref},layout:{x:0,y:0}}]));value(await s.apply([{kind:'addEdge',edge:s.edge('fb','fixed','b')}]));const p=value(await prepare(s,'current',['b']));
 value(await execute(s.engine,'asset.trash',{assetId:ref.assetId,expectedRevision:1}));expect(await approve(s,p)).toMatchObject({ok:false,error:{code:'ASSET_TRASHED'}});
 value(await execute(s.engine,'asset.restore',{assetId:ref.assetId,expectedRevision:2}));const accepted=value(await prepare(s,'current',['b']));value(await approve(s,accepted));value(await execute(s.engine,'asset.trash',{assetId:ref.assetId,expectedRevision:3}));value(await s.engine.workflows.wake());const w=value(s.engine.workflows.read(accepted.planId));value(await s.engine.scheduler.run(w.steps[0].task.attemptId));expect(JSON.parse(s.requests[0]!.body.toString()).messages[0].content).toContain('fixed input');
});
it('allows layout-only edits between preview and approval but rejects semantic edits and altered approval scope',async()=>{
 const s=await graphFixture(),p=value(await prepare(s,'current',['a'])),a=s.node('a');value(await s.apply([{kind:'setLayout',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.layoutRevision,layout:{x:7,y:5}}]));value(await approve(s,p));
 const second=value(await prepare(s,'current',['b'])),b=s.node('b');value(await s.apply([{kind:'setContent',nodeId:'b',incarnation:b.incarnation,expectedRevision:b.semanticRevision,content:{...b.content,prompt:'changed'}}]));expect(await approve(s,second)).toMatchObject({ok:false,error:{code:'INPUT_CHANGED'}});expect(await approve(s,{...p,planHash:'0'.repeat(64)})).toMatchObject({ok:false,error:{code:'APPROVAL_REUSED'}});
});
it('rejects mixed configured currencies and caps upstream generation scope at 32',async()=>{
 const s=await graphFixture(),usd=await addWorkflowModel(s,'usd','openai-image-v1',{status:'configured',currency:'USD',perImage:1,version:'p1'}),cny=await addWorkflowModel(s,'cny','openai-image-v1',{status:'configured',currency:'CNY',perImage:1,version:'p1'});
 for(const[id,profileRef]of[['a',usd],['b',cny]]as const){const n=s.node(id);value(await s.apply([{kind:'setContent',nodeId:id,incarnation:n.incarnation,expectedRevision:n.semanticRevision,content:{...n.content,profileRef}}]));}
 expect(await prepare(s,'selection',['a','b'])).toMatchObject({ok:false,error:{code:'WORKFLOW_MIXED_CURRENCY'}});
 const content=s.node('c').content;value(await s.apply(Array.from({length:33},(_,i)=>({kind:'create',nodeId:'chain'+i,content,layout:{x:i,y:0}}))));value(await s.apply(Array.from({length:32},(_,i)=>({kind:'addEdge',edge:s.edge('chain-edge'+i,'chain'+i,'chain'+(i+1))}))));expect(await prepare(s,'upstream',['chain32'])).toMatchObject({ok:false,error:{code:'GRAPH_LIMIT'}});
});
it('freezes an explicitly selected external asset with unknown provenance and never expands current scope',async()=>{
 const s=await graphFixture(),ref=await s.importFile(Buffer.from('chosen external text'),'chosen.txt');const a=s.node('a');value(await s.apply([{kind:'selectOutput',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.selectionRevision,output:ref}]));value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));expect(s.node('a').freshness).toBe('unknown');
 const p=value(await prepare(s,'current',['b']));expect(p.steps.map((x:any)=>x.nodeId)).toEqual(['b']);expect(p.externalInputs).toEqual([expect.objectContaining({nodeId:'a',provenance:'unknown',ref,metadata:expect.objectContaining({mime:'text/plain'})})]);value(await approve(s,p));value(await s.engine.workflows.wake());const w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[0].task.attemptId));expect(JSON.parse(s.requests[0]!.body.toString()).messages[0].content).toContain('chosen external text');expect(s.requests).toHaveLength(1);
});
it('attributes the downstream result to approved upstream B when a separate automatic rerun selects C before child admission',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepare(s));value(await approve(s,p));value(await s.engine.workflows.wake());let w=value(s.engine.workflows.read(p.planId));s.response({choices:[{message:{content:'APPROVED B'},finish_reason:'stop'}]});value(await s.engine.scheduler.run(w.steps[0].task.attemptId));
 const single=value(await execute(s.engine,'generation.prepare',{projectId:s.canvasId,canvasNode:{canvasId:s.canvasId,nodeId:'a'},executionOwner:'human',runId:'rerun-c'}));const task=value(await execute(s.engine,'generation.approveAndEnqueue',{preparedId:single.preparedId,approvedPlanHash:single.planHash,currency:'CNY',allowanceMicros:1,budgetLimitMicros:100,acknowledgeUnknown:true,executionOwner:'human',runId:'rerun-c'}));s.response({choices:[{message:{content:'NEW C'},finish_reason:'stop'}]});value(await s.engine.scheduler.run(task.attemptId));
 value(await s.engine.workflows.wake());w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[1].task.attemptId));expect(JSON.parse(s.requests[2]!.body.toString()).messages[0].content).toContain('APPROVED B');expect(s.read().outputs.find((o:any)=>o.nodeId==='b').selection).toBe('history');expect(s.node('b').selectedOutput).toBeNull();
});
it('keeps credential revocation effective at dispatch for an already approved frozen workflow',async()=>{
 const s=await graphFixture(),e=s.engine,credentialRef={libraryId:e.identity.libraryId,connectionId:'native',id:'workflow-credential',version:1};value(e.modelConfig.updateCredentialStatus({ref:credentialRef,state:'session'}));
 const connection=e.modelConfig.listConnections().connections[0]!,{libraryId:_l,revision:_r,createdAt:_t,...c}=connection;const connectionRef=value(await execute(e,'provider.saveConnection',{...c,expectedRevision:connection.revision,credentialRef}));
 const model=e.modelConfig.listModels().models[0]!,{libraryId:_ml,revision:_mr,createdAt:_mt,...m}=model;const modelRef=value(await execute(e,'model.saveDefinition',{...m,expectedRevision:model.revision,connectionRef}));
 const profile=e.modelConfig.listProfiles().profiles[0]!,{libraryId:_pl,revision:_pr,createdAt:_pt,...pr}=profile;const profileRef=value(await execute(e,'profile.save',{...pr,expectedRevision:profile.revision,modelRef}));const a=s.node('a');value(await s.apply([{kind:'setContent',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.semanticRevision,content:{...a.content,profileRef}}]));
 const p=value(await prepare(s,'current',['a']));value(await approve(s,p));value(await e.workflows.wake());value(e.modelConfig.updateCredentialStatus({ref:credentialRef,state:'revoked'}));const w=value(e.workflows.read(p.planId));expect(await e.scheduler.run(w.steps[0].task.attemptId)).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNAVAILABLE'}});expect(s.requests).toHaveLength(0);
});
it('transfers previously reserved allowance even when a later ordinary approval raises the project budget cap',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepare(s));value(await approve(s,p,20));
 const ordinary=value(await execute(s.engine,'generation.prepare',s.prepareInput()));value(await execute(s.engine,'generation.approveAndEnqueue',{preparedId:ordinary.preparedId,approvedPlanHash:ordinary.planHash,currency:'CNY',allowanceMicros:1,budgetLimitMicros:21,acknowledgeUnknown:true,executionOwner:ordinary.executionOwner,runId:ordinary.runId}));value(await s.engine.workflows.wake());const w=value(s.engine.workflows.read(p.planId));expect(w.steps[0].state).toBe('queued');expect(w.reservationMicros).toBe(20);expect(s.engine.generation.list().tasks.reduce((n,t)=>n+t.reservationMicros,0)).toBe(11);
});
it('rejects a statically impossible last-frame-only plan before approving or running its image ancestor',async()=>{
 const s=await graphFixture(),image=await addWorkflowModel(s,'image','openai-image-v1'),video=await addWorkflowModel(s,'video','minimax-video-v2');
 for(const[id,profileRef]of[['a',image],['b',video]]as const){const n=s.node(id);value(await s.apply([{kind:'setContent',nodeId:id,incarnation:n.incarnation,expectedRevision:n.semanticRevision,content:{...n.content,profileRef}}]));}
 value(await s.apply([{kind:'addEdge',edge:s.edge('ab','a','b','last_frame')}]));expect(await prepare(s)).toMatchObject({ok:false,error:{code:'INVALID_REFERENCE_ROLE'}});expect(s.requests).toHaveLength(0);expect(s.engine.generation.list().tasks).toHaveLength(0);
});
it('accepts fixed nodes in a selected subgraph while creating steps only for its generation nodes',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'create',nodeId:'fixed',content:{type:'text',text:'selected fixed input'},layout:{x:0,y:0}}]));value(await s.apply([{kind:'addEdge',edge:s.edge('fb','fixed','b')}]));const p=value(await prepare(s,'selection',['fixed','b']));expect(p.steps.map((x:any)=>x.nodeId)).toEqual(['b']);expect(p.steps[0].inputs).toContainEqual({kind:'text',targetPort:'prompt',text:'selected fixed input'});expect(await prepare(s,'selection',['fixed'])).toMatchObject({ok:false});
});
it('rejects a known stale external selected generation output without silently running its upstream',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepare(s,'current',['a']));value(await approve(s,p));value(await s.engine.workflows.wake());const w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[0].task.attemptId));const a=s.node('a');value(await s.apply([{kind:'setContent',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.semanticRevision,content:{...a.content,prompt:'changed'}}]));expect(s.node('a').freshness).toBe('stale');expect(await prepare(s,'current',['b'])).toMatchObject({ok:false,error:{code:'WORKFLOW_INPUT_UNAVAILABLE'}});expect(s.requests).toHaveLength(1);
});
it.each(['unchanged','automatic-change','manual-change','independent-failure'])('keeps a frozen external B boundary independent of selected ancestor A: %s',async scenario=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')},{kind:'addEdge',edge:s.edge('bc','b','c')}]));
 const fixedB=await s.importFile(Buffer.from('FROZEN EXTERNAL B'),'boundary-b.txt'),b=s.node('b');value(await s.apply([{kind:'selectOutput',nodeId:'b',incarnation:b.incarnation,expectedRevision:b.selectionRevision,output:fixedB}]));
 const p=value(await prepare(s,'selection',['a','c'])),cPlan=p.steps.find((step:any)=>step.nodeId==='c');expect(cPlan.inputs.some((input:any)=>input.kind==='stepOutput')).toBe(false);expect(cPlan.graphInputs.nodes.map((node:any)=>node.nodeId)).toEqual(['a','b']);value(await approve(s,p));value(await s.engine.workflows.wake());
 let w=value(s.engine.workflows.read(p.planId));expect(w.steps.map((step:any)=>step.state)).toEqual(['queued','queued']);expect(s.engine.generation.list().tasks).toHaveLength(2);const aTask=w.steps.find((step:any)=>step.nodeId==='a').task,cTask=w.steps.find((step:any)=>step.nodeId==='c').task;
 expect(value(s.engine.generation.read(aTask.taskId)).artifactRef).toBeNull();
 if(scenario==='automatic-change'){s.response({choices:[{message:{content:'NEW ANCESTOR A'},finish_reason:'stop'}]});value(await s.engine.scheduler.run(aTask.attemptId));}
 if(scenario==='manual-change'){const a=s.node('a');value(await s.apply([{kind:'setContent',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.semanticRevision,content:{...a.content,prompt:'MANUAL ANCESTOR A'}}]));}
 if(scenario==='independent-failure'){value(s.engine.generation.recordSchedulerFailure(aTask.attemptId,'FIXTURE_INDEPENDENT_FAILURE'));value(await s.engine.workflows.wake());expect(value(s.engine.workflows.read(p.planId)).steps.find((step:any)=>step.nodeId==='c').state).toBe('queued');}
 s.response({choices:[{message:{content:'CONSUMER RESULT'},finish_reason:'stop'}]});value(await s.engine.scheduler.run(cTask.attemptId));value(await s.engine.workflows.wake());w=value(s.engine.workflows.read(p.planId));expect(w.steps.find((step:any)=>step.nodeId==='c').state).toBe('succeeded');
 expect(JSON.parse(s.requests.at(-1)!.body.toString()).messages[0].content).toBe('A quiet lake\n\nFROZEN EXTERNAL B');expect(s.read().outputs.find((output:any)=>output.nodeId==='c').selection).toBe(['automatic-change','manual-change'].includes(scenario)?'history':'selected');expect(s.engine.generation.list().tasks).toHaveLength(2);
 if(scenario==='independent-failure'){expect(w.state).toBe('failed');expect(s.requests).toHaveLength(1);}
});
it('preserves frozen ancestry when the same producer is also an actual StepOutput on another input path',async()=>{
 const s=await graphFixture(),image=await addWorkflowModel(s,'image','openai-image-v1'),edit=await addWorkflowModel(s,'edit','openai-image-edit-v1');
 for(const[id,profileRef]of[['a',image],['b',edit],['c',edit]]as const){const node=s.node(id);value(await s.apply([{kind:'setContent',nodeId:id,incarnation:node.incarnation,expectedRevision:node.semanticRevision,content:{...node.content,profileRef}}]));}
 value(await s.apply([{kind:'addEdge',edge:s.edge('ab','a','b','reference')},{kind:'addEdge',edge:s.edge('bc','b','c','reference')},{kind:'addEdge',edge:s.edge('ac','a','c','reference')}]));
 const sharp=(await import('sharp')).default,fixedBytes=await sharp({create:{width:256,height:256,channels:3,background:'#234567'}}).png().toBuffer(),newBytes=await sharp({create:{width:256,height:256,channels:3,background:'#987654'}}).png().toBuffer();
 const fixed=await s.importFile(fixedBytes,'fixed-boundary.png'),b=s.node('b');value(await s.apply([{kind:'selectOutput',nodeId:'b',incarnation:b.incarnation,expectedRevision:b.selectionRevision,output:fixed}]));
 const p=value(await prepare(s,'selection',['a','c']));value(await approve(s,p));value(await s.engine.workflows.wake());let w=value(s.engine.workflows.read(p.planId));expect(w.steps.map((step:any)=>step.state)).toEqual(['queued','waiting']);
 s.response({data:[{b64_json:newBytes.toString('base64')}]});value(await s.engine.scheduler.run(w.steps[0].task.attemptId));value(await s.engine.workflows.wake());w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[1].task.attemptId));expect(s.requests[1]!.body.includes(fixedBytes)).toBe(true);expect(s.requests[1]!.body.includes(newBytes)).toBe(true);expect(s.read().outputs.find((output:any)=>output.nodeId==='c').selection).toBe('history');
});
