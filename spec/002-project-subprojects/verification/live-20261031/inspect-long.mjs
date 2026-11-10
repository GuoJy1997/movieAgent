export async function run(c){
 const {data:d,query,log}=c;
 const providers=await query('provider.list'),tasks=await query('task.list');
 const connection=providers.connections.filter(x=>x.id===d.textModel.connectionRef.id).sort((a,b)=>b.revision-a.revision)[0];
 if(connection.timeoutMs!==300000)throw Error('NEW_PACKAGE_TIMEOUT_NOT_IMPORTED');
 d.liveLong??={startedAt:new Date().toISOString(),authorizedNewRequest:'User explicitly requested real validation; new completed-work summary, not replay of unknown Agent turn',priorTasks:tasks.tasks.map(x=>({taskId:x.taskId,attemptId:x.attemptId,state:x.state,providerState:x.providerState})),originalConnection:connection,originalModel:d.textModel,originalProfile:d.textProfile};
 await c.fs.mkdir(c.path.join(c.evidence,'long-request'),{recursive:true});
 log('NEW_PACKAGE_INSPECTED',{timeoutMs:connection.timeoutMs,connectionRevision:connection.revision,textModelRevision:d.textModel.revision,priorTasks:d.liveLong.priorTasks});
}
