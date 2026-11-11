import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {graphFixture,prepareWorkflow,approveWorkflow} from '../fixtures/workflow';
import {value,execute} from '../fixtures/native-generation';
it('retains the entire waiting reservation after a transaction fault between child receipt and linking, then retries once',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepareWorkflow(s));value(await approveWorkflow(s,p));
 const db=new DatabaseSync(join(s.root,'library.sqlite'));
 try{db.exec("CREATE TRIGGER fail_workflow_link BEFORE UPDATE OF task_id ON workflow_step WHEN NEW.task_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'fixture'); END");
 expect(await s.engine.workflows.wake()).toMatchObject({ok:false,error:{code:'WORKFLOW_COMMIT_FAILED'}});expect(s.engine.generation.list().tasks).toHaveLength(0);expect(value(s.engine.workflows.read(p.planId))).toMatchObject({reservationMicros:20,steps:[{state:'waiting',reservationMicros:10},{state:'waiting',reservationMicros:10}]});
 db.exec('DROP TRIGGER fail_workflow_link');}finally{db.close();}
 value(await s.engine.workflows.wake());expect(s.engine.generation.list().tasks).toHaveLength(1);expect(value(s.engine.workflows.read(p.planId)).reservationMicros).toBe(20);
});
it.each(['before','between','after'])('recovers a real process crash %s durable child linking without a duplicate task or reservation',async point=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepareWorkflow(s));value(await approveWorkflow(s,p));await s.engine.close();
 const worker=await promisify(execFile)(process.execPath,['--experimental-strip-types',new URL('../fixtures/workflow-crash-worker.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),s.root,point]).catch(e=>e);expect(worker.code).toBe(83);
 const e=await s.open();value(await e.workflows.wake());const w=value(e.workflows.read(p.planId));expect(w.reservationMicros).toBe(20);expect(e.generation.list().tasks).toHaveLength(1);value(await e.scheduler.run(w.steps[0].task.attemptId));value(await e.workflows.wake());expect(e.generation.list().tasks).toHaveLength(2);expect(value(e.workflows.read(p.planId)).reservationMicros).toBe(20);expect(s.requests).toHaveLength(1);
});
it('replays a lost approval ACK and preserves unknown submit risk through stop and reopen',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepareWorkflow(s));
 const command={schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'first',commandId:'lost-ack',kind:'workflow.approveAndEnqueue',payload:{planId:p.planId,approvedPlanHash:p.planHash,currency:'CNY',budgetLimitMicros:20,stepAllowances:{a:10,b:10},acknowledgeUnknown:true,executionOwner:p.executionOwner,runId:p.runId}};
 const receipt=value(await s.engine.commands.execute(command));value(await s.engine.workflows.wake());s.cut();let w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[0].task.attemptId));value(await s.engine.workflows.wake());w=value(s.engine.workflows.read(p.planId));expect(w).toMatchObject({state:'needs_attention',reservationMicros:10,steps:[{state:'needs_attention'},{state:'blocked'}]});
 value(await execute(s.engine,'workflow.stop',{workflowId:p.planId}));await s.engine.close();const e=await s.open();expect(value(await e.commands.execute({...command,connectionEpoch:'restarted'}))).toEqual(receipt);value(await e.scheduler.recover());value(await e.workflows.wake());expect(s.requests).toHaveLength(1);expect(value(e.workflows.read(p.planId))).toMatchObject({state:'stopping',reservationMicros:10});
});
it('pauses and drains coordinator transitions during maintenance and never admits stopped work after reopen',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepareWorkflow(s));value(await approveWorkflow(s,p));await s.engine.workflows.pause();value(await s.engine.workflows.wake());expect(s.engine.generation.list().tasks).toHaveLength(0);value(await execute(s.engine,'workflow.stop',{workflowId:p.planId}));s.engine.workflows.resume();value(await s.engine.workflows.wake());await s.engine.close();const e=await s.open();value(await e.workflows.wake());expect(e.generation.list().tasks).toHaveLength(0);expect(value(e.workflows.read(p.planId)).state).toBe('stopped');
});
it('serializes stop against ready-step asynchronous input reads and drains that transition before maintenance snapshot',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepareWorkflow(s));value(await approveWorkflow(s,p));value(await s.engine.workflows.wake());const w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[0].task.attemptId));
 const original=s.engine.assets.readFixedOriginal;let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 s.engine.assets.readFixedOriginal=async(...args)=>{entered();await gate;return original(...args);};
 const creating=s.engine.workflows.wake();await started;const stopping=execute(s.engine,'workflow.stop',{workflowId:p.planId});value(await stopping);
 let settled=false;const snapshot=s.engine.maintenance.snapshot().then(r=>{settled=true;return r;});await new Promise(r=>setTimeout(r,20));expect(settled).toBe(false);release();value(await creating);value(await snapshot);expect(s.engine.generation.list().tasks).toHaveLength(1);expect(value(s.engine.workflows.read(p.planId))).toMatchObject({state:'stopped',reservationMicros:10});
});
it('settles definitive workflow and graph rejection in the real outbox while preserving transaction failures for replay',async()=>{
 const s=await graphFixture();const {CommandOutbox}=await import('../../apps/desktop/src/main/command-outbox'),{LocalConnection}=await import('../../apps/desktop/src/main/local-connection');const outbox=new CommandOutbox(join(s.root,'client/workflow.sqlite'));
 const connection=new LocalConnection({identity:s.engine.identity,execute:async c=>s.engine.commands.execute(c),query:async q=>s.engine.commands.query(q),readEvents:async q=>s.engine.events.read(q)},outbox);
 const command=(kind:any,payload:any,id=crypto.randomUUID())=>({schemaVersion:1 as const,libraryId:s.engine.identity.libraryId,connectionEpoch:connection.connectionEpoch,commandId:id,kind,payload});
 const db=new DatabaseSync(join(s.root,'library.sqlite'));
 try{
 value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));expect(await connection.execute(command('workflow.prepare',{canvasId:s.canvasId,mode:'current',nodeIds:['b'],executionOwner:'human',runId:'outbox'}))).toMatchObject({ok:false,error:{code:'WORKFLOW_INPUT_UNAVAILABLE'}});expect(outbox.pending(s.engine.identity.libraryId)).toHaveLength(0);
 expect(await connection.execute(command('canvas.applyCommand',{canvasId:s.canvasId,baseRevision:s.read().revision,operations:[{kind:'addEdge',edge:s.edge('ba','b','a')}]}))).toMatchObject({ok:false,error:{code:'GRAPH_CYCLE'}});expect(outbox.pending(s.engine.identity.libraryId)).toHaveLength(0);
 db.exec("CREATE TRIGGER fail_plan BEFORE INSERT ON workflow BEGIN SELECT RAISE(ABORT,'fixture'); END");const pending=command('workflow.prepare',{canvasId:s.canvasId,mode:'upstream',nodeIds:['b'],executionOwner:'human',runId:'outbox'});expect(await connection.execute(pending)).toMatchObject({ok:false,error:{code:'COMMAND_COMMIT_FAILED'}});expect(outbox.pending(s.engine.identity.libraryId)).toHaveLength(1);db.exec('DROP TRIGGER fail_plan');value(await connection.recover());expect(outbox.pending(s.engine.identity.libraryId)).toHaveLength(0);
 const listed=value(await connection.query({...command('workflow.list',{}),queryId:'query'}));expect(listed.workflows).toHaveLength(1);expect(listed.workflows[0].plan.steps).toHaveLength(2);
 }finally{db.close();outbox.close();}
});
it.each(['maintenance','shutdown'])('closes generation admission immediately while %s waits for coordinator input reads to drain',async mode=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepareWorkflow(s));value(await approveWorkflow(s,p));value(await s.engine.workflows.wake());const w=value(s.engine.workflows.read(p.planId));value(await s.engine.scheduler.run(w.steps[0].task.attemptId));
 const ordinary=await s.enqueue(),original=s.engine.assets.readFixedOriginal;let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);s.engine.assets.readFixedOriginal=async(...args)=>{entered();await gate;return original(...args);};
 const creating=s.engine.workflows.wake();await started;const drain=mode==='maintenance'?s.engine.maintenance.snapshot():s.engine.quiesceEngine('test',Date.now()+10000);
 try{expect(await s.engine.scheduler.run(ordinary.task.attemptId)).toMatchObject({ok:false,error:{code:'SCHEDULER_CLOSED'}});}finally{release();await creating;await drain;}
 expect(s.requests).toHaveLength(1);
});
it('does not append unchanged workflow snapshots on coordinator polling',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));const p=value(await prepareWorkflow(s));value(await approveWorkflow(s,p));value(await s.engine.workflows.wake());const seq=s.engine.workflows.list().snapshotSeq;value(await s.engine.workflows.wake());expect(s.engine.workflows.list().snapshotSeq).toBe(seq);
});
