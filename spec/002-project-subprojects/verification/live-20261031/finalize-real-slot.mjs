export async function run(c){
 const{data:d,query,save,log,fs,path}=c,r=d.slotRecovery;
 if(!r?.newTask)throw Error('REAL_PROBE_FIRST');const tasks=(await query('task.list')).tasks,added=tasks.filter(x=>!r.priorTasks.some(y=>y.taskId===x.taskId));
 const old=tasks.find(x=>x.taskId===r.original.taskId),probe=tasks.find(x=>x.taskId===r.task.taskId),connection=(await query('provider.list')).connections.filter(x=>x.id===d.textModel.connectionRef.id).sort((a,b)=>b.revision-a.revision)[0];
 if(added.length!==1||probe?.state!=='SUCCEEDED'||!old.concurrencyReleasedAt||old.providerState!=='unknown'||old.reservationMicros!==r.original.reservationMicros||connection.concurrency!==1)throw Error('REAL_RELEASE_PROOF_INCOMPLETE');
 const target=path.join(c.evidence,'../unknown-slot/live-result.json');let previous;try{previous=JSON.parse(await fs.readFile(target,'utf8'))}catch{}
 const result={status:'real-unknown-slot-recovery-passed',at:new Date().toISOString(),projectRoot:d.projectRoot,libraryId:d.libraryId,concurrency:connection.concurrency,oldTask:{taskId:old.taskId,attemptId:old.attemptId,state:old.state,providerState:old.providerState,concurrencyReleasedAt:old.concurrencyReleasedAt,reservationMicros:old.reservationMicros,settlementStatus:old.settlementStatus},newTask:probe,elapsedSeconds:r.elapsedSeconds,additionalTextRequests:1,additionalVideoRequests:0,actualBilling:'unknown',reopenVerified:!!previous};
 if(previous&&previous.newTask.taskId!==probe.taskId)throw Error('REOPEN_CHANGED_TASK');await fs.writeFile(target,JSON.stringify(result,null,2));r.result=result;await save();
 log('REAL_RECOVERY_FINAL',{status:result.status,concurrency:1,oldState:old.state,newState:probe.state,additionalTextRequests:1,videoRequests:0,reopenVerified:result.reopenVerified});
}
