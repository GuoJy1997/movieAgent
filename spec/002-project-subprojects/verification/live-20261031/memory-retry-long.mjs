import {pathToFileURL} from'node:url';
export async function run(c){
 const {data:d,query,execute,wait,save,log,fs,path}=c,r=d.liveLong;
 if(!r.firstMemoryResult)r.firstMemoryResult=r.completion;
 if(!r.budgetConfigUpdated){
  const{modelConfigStore}=await import(pathToFileURL(c.repo+'/apps/desktop/src/main/model-config-store.ts'));
  const store=modelConfigStore(c.repo+'/config/models.json'),current=c.take(await store.readPrivate());
  const configured=current.config.providers.find(x=>x.id==='03c7684d-58c6-419b-953f-ee5f0b0de7b7');if(!configured)throw Error('KIMI_CONFIG_NOT_FOUND');
  const fields=['id','name','kind','baseURL','apiKey','modelId','allowPrivateEndpoint','adapterType','parameters','pricing'];
  const provider=Object.fromEntries(fields.map(k=>[k,configured[k]]));provider.apiKey='';provider.clearKey=false;provider.parameters={...configured.parameters,max_completion_tokens:8192};
  c.take(await store.save({expectedVersion:current.version,provider}));r.budgetConfigUpdated=true;r.applicationOutputTokens=8192;await save();
 }
 c.take(await c.page.evaluate(()=>window.studio.reloadModelConfig()));
 const profiles=await wait('OUTPUT_BUDGET_IMPORT',()=>query('profile.list'),x=>x.profiles.filter(y=>y.id===r.originalProfile.id).sort((a,b)=>b.revision-a.revision)[0]?.parameters.max_completion_tokens===8192,30000);
 const profile=profiles.profiles.filter(x=>x.id===r.originalProfile.id).sort((a,b)=>b.revision-a.revision)[0];
 const model=(await query('model.list')).models.find(x=>x.id===profile.modelRef.id&&x.revision===profile.modelRef.revision);
 const connection=(await query('provider.list')).connections.find(x=>x.id===model.connectionRef.id&&x.revision===model.connectionRef.revision);
 const strip=x=>{const{libraryId,revision,createdAt,...data}=x;return{...data,expectedRevision:revision}};
 if(!r.retryProfileRef){
  const connectionRef=await execute('provider.saveConnection',{...strip(connection),concurrency:2});
  const modelRef=await execute('model.saveDefinition',{...strip(model),connectionRef});
  r.retryProfileRef=await execute('profile.save',{...strip(profile),modelRef});r.testProfileRef=r.retryProfileRef;await save();
 }
 if(!r.explicitRetryStarted){
  const oldTask=await query('task.read',{taskId:r.firstMemoryResult.taskId});if(oldTask.state!=='SUCCEEDED'||oldTask.providerState!=='completed')throw Error('RETRY_REQUIRES_COMPLETED_ORIGINAL');
  await execute('project.memoryConfigure',{projectId:d.projectId,profileRef:r.retryProfileRef});
  r.explicitRetryStarted=true;r.retryStartedAt=new Date().toISOString();await save();
  await execute('subproject.memoryRetry',c.scopeOf(d.a),c.scopeOf(d.a));
 }
 const started=Date.now();const memory=await wait('REAL_MEMORY_RETRY',()=>query('project.memory',{projectId:d.projectId}),x=>{const y=x.completions.find(y=>y.id===d.completion.id);return y.taskId!==r.firstMemoryResult.taskId&&['ready','failed','unknown'].includes(y.state)},360000);
 r.completion=memory.completions.find(x=>x.id===d.completion.id);r.retryElapsedSeconds=Math.round((Date.now()-started)/1000);
 await fs.writeFile(path.join(c.evidence,'long-request/memory-retry-result.json'),JSON.stringify(memory,null,2));await save();
 log('REAL_MEMORY_RETRY_RETURNED',{state:r.completion.state,errorCode:r.completion.errorCode,taskId:r.completion.taskId,elapsedSeconds:r.retryElapsedSeconds,summary:memory.entries.filter(x=>x.kind==='summary').map(x=>x.body)});
 if(r.completion.state!=='ready')throw Error('REAL_MEMORY_RETRY_'+r.completion.state.toUpperCase()+'_'+(r.completion.errorCode??'NO_CODE'));
}
