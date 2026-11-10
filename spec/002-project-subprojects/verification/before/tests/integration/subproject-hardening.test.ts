import {expect,it} from 'vitest';
import {nativeFixture,value} from '../fixtures/native-generation.ts';
import {contentScopesFor} from '../../packages/engine/src/content-scope.ts';
it('binds workflow-generated preparation to its actual canvas and rejects foreign scoped metadata and direct completion',async()=>{
 const f=await nativeFixture(),e=f.engine,p=f.prepareInput().projectId;
 const exec=async(kind:string,payload:unknown,scope?:any)=>e.commands.execute({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',commandId:crypto.randomUUID(),kind,payload,...(scope?{scope}:{})});
 const a=value(await exec('subproject.create',{projectId:p,title:'A'})),b=value(await exec('subproject.create',{projectId:p,title:'B'})),sa={projectId:p,subprojectId:a.id},sb={projectId:p,subprojectId:b.id};
 const prepared=value(e.generation.prepare(f.prepareInput()));
 // A durable workflow plan is the authority for later asynchronous tasks.
 e.library.db.prepare('INSERT INTO workflow VALUES(?,?,?,?,NULL,?)').run('wf-owned',a.primaryCanvasId,p,JSON.stringify({canvasId:a.primaryCanvasId}),'running');
 e.library.db.prepare('INSERT INTO workflow_step(workflow_id,step_id,command_id,prepared_id,state) VALUES(?,?,?,?,?)').run('wf-owned','step','step-command',prepared.preparedId,'prepared');
 const owner=contentScopesFor(e.library).inferred('prepared',prepared.preparedId);
 expect(owner).toEqual(sa);
 expect(await exec('generation.approveAndEnqueue',{preparedId:prepared.preparedId,approvedPlanHash:prepared.planHash,currency:'CNY',allowanceMicros:1000000,budgetLimitMicros:100000000,acknowledgeUnknown:true,executionOwner:prepared.executionOwner,runId:prepared.runId},sb)).toMatchObject({ok:false,error:{code:'WRONG_SUBPROJECT'}});
 expect(await exec('subproject.update',{projectId:p,id:a.id,expectedRevision:1,title:'Wrong'},sb)).toMatchObject({ok:false,error:{code:'WRONG_SUBPROJECT'}});
 expect(await exec('subproject.update',{projectId:p,id:a.id,expectedRevision:1,status:'completed'},sa)).toMatchObject({ok:false,error:{code:'COMPLETION_REQUIRED'}});
},30000);
