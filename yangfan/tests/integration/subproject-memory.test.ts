import {expect,it} from 'vitest';
import {nativeFixture,value,execute} from '../fixtures/native-generation.ts';
it('completes without a model as pending, is idempotent, then automatically shares fixed summary with the next episode',async()=>{
 const s=await nativeFixture(),e=s.engine,p=s.prepareInput().projectId;
 const a=value(await execute(e,'subproject.create',{projectId:p,title:'第一集'}));
 const input={projectId:p,subprojectId:a.id,expectedRevision:a.revision,note:'朱清受伤，邸报仍在手中。'};
 const completed=await execute(e,'subproject.complete',input);expect(completed).toMatchObject({ok:true});if(!completed.ok)return;
 const first=value(completed);expect(first.state).toBe('pending');
 expect(value(await execute(e,'subproject.complete',input)).id).toBe(first.id);
 s.response({choices:[{message:{role:'assistant',content:JSON.stringify({summary:'朱清受伤，邸报仍在手中；下集应保持这一状态。'})},finish_reason:'stop'}]});
 value(await execute(e,'project.memoryConfigure',{projectId:p,profileRef:{libraryId:e.identity.libraryId,id:'native',revision:1}}));
 await (e as any).projectMemory.tick();
 const memory=value(e.commands.query({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind:'project.memory',payload:{projectId:p}}));
 expect(memory.completions[0].taskId).toBeTruthy();
 const task=e.generation.read(memory.completions[0].taskId);expect(task).toMatchObject({ok:true});
 if(task.ok)value(await e.scheduler.run(task.value.attemptId));
 await (e as any).projectMemory.tick();
 const updated=value(e.commands.query({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind:'project.memory',payload:{projectId:p}}));
 expect(updated.entries).toEqual(expect.arrayContaining([expect.objectContaining({body:expect.stringContaining('朱清受伤')})]));
 const b=value(await execute(e,'subproject.create',{projectId:p,title:'第二集'}));
 const context=(e as any).projectMemory.context({projectId:p,subprojectId:b.id});expect(value(context).entries[0].body).toContain('邸报');
 
 const scopedExec=(kind:string,payload:unknown)=>e.commands.execute({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',commandId:crypto.randomUUID(),kind,payload,scope:{projectId:p,subprojectId:b.id}});
 const session=value(await scopedExec('agent.createSession',{projectId:p,title:'Continue',mode:'all',executionOwner:'human'}));
 const turn=value(await scopedExec('agent.prepareTurn',{sessionId:session.sessionId,message:'续写第二集',profileRef:s.prepareInput().profileRef,templateId:'short-film',targets:{shotIds:[],entityIds:[]}}));
 expect(turn.context.sources).toEqual(expect.arrayContaining([expect.objectContaining({kind:'memory',revision:1})]));
 expect(turn.generation.prompt).toContain('朱清受伤');
const prior=s.requests.length;await (e as any).projectMemory.tick();expect(s.requests).toHaveLength(prior);
},30000);

it('keeps prior memory when reopening, records explicit rules and pins a previous summary revision',async()=>{
 const f=await nativeFixture(),e=f.engine,p=f.prepareInput().projectId;
 const a=value(await execute(e,'subproject.create',{projectId:p,title:'A'}));
 const run=async(note:string,expectedRevision:number,summary:string)=>{f.response({choices:[{message:{role:'assistant',content:JSON.stringify({summary,conflicts:['和项目设定待核对']})},finish_reason:'stop'}]});const c=value(await execute(e,'subproject.complete',{projectId:p,subprojectId:a.id,expectedRevision,note}));await e.projectMemory.tick();const m=value(e.projectMemory.read(p));const job=m.completions.find((x:any)=>x.id===c.id);const t=value(e.generation.read(job.taskId));value(await e.scheduler.run(t.attemptId));await e.projectMemory.tick();return c;};
 value(await execute(e,'project.memoryConfigure',{projectId:p,profileRef:{libraryId:e.identity.libraryId,id:'native',revision:1}}));
 value(await execute(e,'project.memorySave',{projectId:p,id:'rule',expectedRevision:0,kind:'rule',body:'朱清始终健康',status:'active'}));
 await run('first',1,'朱清受伤');
 const b=value(await execute(e,'subproject.create',{projectId:p,title:'B'})),scope={projectId:p,subprojectId:b.id};
 value(await execute(e,'subproject.continuity',{...scope,sourceSubprojectIds:[a.id],pins:{[a.id]:1}}));
 value(await execute(e,'subproject.update',{projectId:p,id:a.id,expectedRevision:2,status:'producing'}));
 expect(value(e.projectMemory.context(scope)).entries.some((x:any)=>x.body==='朱清受伤')).toBe(true);
 await run('second',3,'朱清康复');
 const context=value(e.projectMemory.context(scope));expect(context.entries[0].kind).toBe('rule');expect(context.entries.some((x:any)=>x.body==='朱清受伤')).toBe(true);expect(context.entries.some((x:any)=>x.body==='朱清康复')).toBe(false);
 expect(context.entries.find((x:any)=>x.kind==='summary').sources).toEqual(expect.arrayContaining([expect.objectContaining({factStatus:'model_summary_unverified',conflicts:['和项目设定待核对']})]));
 const current=value(e.projectMemory.read(p)).entries.find((x:any)=>x.kind==='summary');value(await execute(e,'project.memorySave',{projectId:p,id:current.id,expectedRevision:current.revision,kind:'summary',body:current.body,status:'withdrawn'}));expect(value(e.projectMemory.context(scope)).entries.some((x:any)=>x.kind==='summary')).toBe(false);
},30000);

it('preserves newer completion authority when an older task returns, and exposes unknown submissions without resubmitting',async()=>{
 const f=await nativeFixture(),e=f.engine,p=f.prepareInput().projectId;
 value(await execute(e,'project.memoryConfigure',{projectId:p,profileRef:f.prepareInput().profileRef}));
 const a=value(await execute(e,'subproject.create',{projectId:p,title:'A'})),scope={projectId:p,subprojectId:a.id};
 const first=value(await execute(e,'subproject.complete',{...scope,expectedRevision:1,note:'Old ending'}));await e.projectMemory.tick();
 value(await execute(e,'subproject.update',{projectId:p,id:a.id,expectedRevision:2,status:'producing'}));
 const latest=value(await execute(e,'subproject.complete',{...scope,expectedRevision:3,note:'New ending'}));await e.projectMemory.tick();
 let m=value(e.projectMemory.read(p)),task=value(e.generation.read(m.completions.find((x:any)=>x.id===first.id).taskId));
 f.response({choices:[{message:{role:'assistant',content:'{"summary":"old"}'},finish_reason:'stop'}]});value(await e.scheduler.run(task.attemptId));await e.projectMemory.tick();
 m=value(e.projectMemory.read(p));expect(m.completions.find((x:any)=>x.id===first.id).state).toBe('superseded');expect(m.entries).toHaveLength(0);
 f.cut();task=value(e.generation.read(m.completions.find((x:any)=>x.id===latest.id).taskId));value(await e.scheduler.run(task.attemptId));await e.projectMemory.tick();
 m=value(e.projectMemory.read(p));expect(m.completions.find((x:any)=>x.id===latest.id).state).toBe('unknown');
 expect(await execute(e,'subproject.memoryRetry',scope)).toMatchObject({ok:false,error:{code:'SUBMISSION_UNKNOWN'}});
 const count=f.requests.length;await e.projectMemory.tick();value(await e.close());const reopened=await f.open();await reopened.projectMemory.tick();expect(f.requests).toHaveLength(count);
},30000);

it('re-adopts a previously completed snapshot and its summary without another provider request',async()=>{
 const f=await nativeFixture(),e=f.engine,p=f.prepareInput().projectId;
 value(await execute(e,'project.memoryConfigure',{projectId:p,profileRef:f.prepareInput().profileRef}));
 const a=value(await execute(e,'subproject.create',{projectId:p,title:'A'})),scope={projectId:p,subprojectId:a.id};
 async function finish(note:string,expectedRevision:number){
  f.response({choices:[{message:{role:'assistant',content:JSON.stringify({summary:note})},finish_reason:'stop'}]});
  const c=value(await execute(e,'subproject.complete',{...scope,expectedRevision,note}));await e.projectMemory.tick();
  const m=value(e.projectMemory.read(p)),t=value(e.generation.read(m.completions.find((x:any)=>x.id===c.id).taskId));
  value(await e.scheduler.run(t.attemptId));await e.projectMemory.tick();return c;
 }
 const first=await finish('first',1);
 value(await execute(e,'subproject.update',{projectId:p,id:a.id,expectedRevision:2,status:'producing'}));
 await finish('second',3);
 value(await execute(e,'subproject.update',{projectId:p,id:a.id,expectedRevision:4,status:'producing'}));
 const count=f.requests.length,again=value(await execute(e,'subproject.complete',{...scope,expectedRevision:5,note:'first'}));
 expect(again.id).toBe(first.id);await e.projectMemory.tick();expect(f.requests).toHaveLength(count);
 expect(value(e.projectMemory.context(scope)).entries.find((x:any)=>x.kind==='summary').body).toBe('first');
 expect(value(e.projectMemory.read(p)).currentCompletions).toMatchObject([{subprojectId:a.id,id:first.id}]);
},30000);

it('offers an explicit completion-note input for large adopted works without silently truncating their frozen scripts',async()=>{
 const f=await nativeFixture(),e=f.engine,p=f.prepareInput().projectId;
 value(await execute(e,'project.memoryConfigure',{projectId:p,profileRef:f.prepareInput().profileRef}));
 const a=value(await execute(e,'subproject.create',{projectId:p,title:'Long'})),scope={projectId:p,subprojectId:a.id};
 value(await e.commands.execute({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',commandId:crypto.randomUUID(),kind:'creation.saveScript',payload:{projectId:p,id:'long-script',expectedRevision:0,title:'Long',synopsis:'',body:'长篇已采用内容'.repeat(3000),scenes:[]},scope}));
 value(await execute(e,'subproject.complete',{...scope,expectedRevision:1,note:'朱清保留邸报'}));await e.projectMemory.tick();
 expect(value(e.projectMemory.read(p)).completions[0]).toMatchObject({state:'failed',errorCode:'MEMORY_CONTEXT_LIMIT',taskId:null});
 const c=value(await execute(e,'subproject.complete',{...scope,expectedRevision:2,note:'朱清保留邸报',memoryInput:'completion-note'}));await e.projectMemory.tick();
 const t=value(e.generation.read(value(e.projectMemory.read(p)).completions.find((v:any)=>v.id===c.id).taskId));
 f.response({choices:[{message:{role:'assistant',content:'{"summary":"朱清保留邸报"}'},finish_reason:'stop'}]});value(await e.scheduler.run(t.attemptId));await e.projectMemory.tick();
 const request=JSON.parse(f.requests[0]!.body.toString());expect(JSON.stringify(request)).toContain('朱清保留邸报');expect(JSON.stringify(request)).not.toContain('长篇已采用内容'.repeat(20));
 expect(value(e.projectMemory.read(p)).completions.find((v:any)=>v.id===c.id).state).toBe('ready');
},30000);
