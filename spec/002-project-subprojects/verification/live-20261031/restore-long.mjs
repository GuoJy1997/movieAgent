export async function run(c){
 const{data:d,query,execute,save,log}=c,r=d.liveLong;if(!r?.testProfileRef)return;
 const latest=(all,id)=>all.filter(x=>x.id===id).sort((a,b)=>b.revision-a.revision)[0];
 const strip=(x,revision)=>{const{libraryId,revision:_r,createdAt,...rest}=x;return{...rest,expectedRevision:revision}};
 if(!r.restored){
  const cs=(await query('provider.list')).connections;
  const connectionRef=await execute('provider.saveConnection',strip(r.originalConnection,latest(cs,r.originalConnection.id).revision));
  const ms=(await query('model.list')).models;
  const modelRef=await execute('model.saveDefinition',{...strip(r.originalModel,latest(ms,r.originalModel.id).revision),connectionRef});
  const ps=(await query('profile.list')).profiles;
  r.restoredProfileRef=await execute('profile.save',{...strip(r.originalProfile,latest(ps,r.originalProfile.id).revision),modelRef,parameters:r.applicationOutputTokens?{...r.originalProfile.parameters,max_completion_tokens:r.applicationOutputTokens}:r.originalProfile.parameters});
  await execute('project.memoryConfigure',{projectId:d.projectId,profileRef:r.restoredProfileRef});r.restored=true;await save();
 }
 const tasks=(await query('task.list')).tasks;
 log('SETTINGS_RESTORED',{concurrency:r.originalConnection.concurrency,timeoutMs:r.originalConnection.timeoutMs,oldUnknown:tasks.find(x=>x.taskId==='ddf98a18-42ef-4a42-9fd6-8cbd04b9ad6f')?.state,newTasks:tasks.filter(x=>!r.priorTasks.some(y=>y.taskId===x.taskId)).map(x=>({taskId:x.taskId,state:x.state,providerState:x.providerState,errorCode:x.errorCode}))});
}
