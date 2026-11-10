export async function run(c){
 const {data:d,execute,query,wait,log,fs,path,save}=c,r=d.liveLong;
 if(!r)throw Error('INSPECT_FIRST');
 const strip=x=>{const{libraryId,revision,createdAt,...rest}=x;return{...rest,expectedRevision:revision}};
 if(!r.testProfileRef){
  const connectionRef=await execute('provider.saveConnection',{...strip(r.originalConnection),concurrency:2});
  const modelRef=await execute('model.saveDefinition',{...strip(r.originalModel),connectionRef});
  r.testProfileRef=await execute('profile.save',{...strip(r.originalProfile),modelRef,parameters:{...r.originalProfile.parameters,max_completion_tokens:4096}});
  r.testConnectionRef=connectionRef;r.testModelRef=modelRef;await save();
 }
 if(!r.configured){r.configured=true;await save();await execute('project.memoryConfigure',{projectId:d.projectId,profileRef:r.testProfileRef});r.submittedAt=new Date().toISOString();await save();}
 const started=Date.now();
 const memory=await wait('REAL_MEMORY_REQUEST',()=>query('project.memory',{projectId:d.projectId}),x=>['ready','failed','unknown'].includes(x.completions.find(y=>y.id===d.completion.id)?.state),360000);
 r.completion=memory.completions.find(y=>y.id===d.completion.id);r.elapsedSeconds=Math.round((Date.now()-started)/1000);
 await fs.writeFile(path.join(c.evidence,'long-request/memory-result.json'),JSON.stringify(memory,null,2));await save();
 log('REAL_MEMORY_RETURNED',{state:r.completion.state,errorCode:r.completion.errorCode,taskId:r.completion.taskId,elapsedSeconds:r.elapsedSeconds,summary:memory.entries.filter(x=>x.kind==='summary').map(x=>x.body)});
 if(r.completion.state!=='ready')throw Error('REAL_MEMORY_'+r.completion.state.toUpperCase()+'_'+(r.completion.errorCode??'NO_CODE'));
}
