export async function run(c){
 const{data:d,query,execute,scopeOf,refs,wait,save,log}=c,r=d.slotRecovery,scope=scopeOf(d.a);
 if(!r?.released?.concurrencyReleasedAt)throw Error('RELEASE_FIRST');
 if(!r.prepared){r.prepared=await execute('generation.prepare',{projectId:d.projectId,profileRef:refs(d.textProfile),prompt:'请只回复一句中文：新的文本任务已正常执行。',inputVersion:'manual-slot-recovery-check',executionOwner:'live-user',runId:'slot-check-'+c.randomUUID()},scope);await save();}
 if(r.prepared.config.connection.concurrency!==1||r.prepared.config.connection.id!==d.textModel.connectionRef.id)throw Error('PROBE_MUST_USE_SAME_CONNECTION_AT_ONE');
 if(!r.task){r.task=await execute('generation.approveAndEnqueue',{preparedId:r.prepared.preparedId,approvedPlanHash:r.prepared.planHash,currency:'CNY',allowanceMicros:1000000,budgetLimitMicros:100000000,acknowledgeUnknown:true,executionOwner:'live-user',runId:r.prepared.runId},scope,'real-slot-probe-'+r.prepared.runId);r.submittedAt=new Date().toISOString();await save();}
 const start=Date.now();r.newTask=await wait('REAL_NEW_TEXT_AT_CONCURRENCY_ONE',()=>query('task.read',{taskId:r.task.taskId}),x=>['SUCCEEDED','FAILED','CANCELLED'].includes(x.state)||x.providerState==='unknown',360000);r.elapsedSeconds=Math.round((Date.now()-start)/1000);await save();
 log('REAL_NEW_TEXT_RETURNED',{state:r.newTask.state,providerState:r.newTask.providerState,errorCode:r.newTask.errorCode,elapsedSeconds:r.elapsedSeconds,artifactRef:r.newTask.artifactRef,concurrency:r.prepared.config.connection.concurrency});
 if(r.newTask.state!=='SUCCEEDED')throw Error('REAL_NEW_TEXT_'+r.newTask.state+'_'+(r.newTask.errorCode??'NO_RESULT'));
}
