import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';import {join} from 'node:path';
import {nativeFixture,value} from '../fixtures/native-generation.ts';
import {contentScopesFor} from '../../packages/engine/src/content-scope.ts';
const scoped=(e:any,scope:any)=>(kind:string,payload:unknown)=>e.commands.execute({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',commandId:crypto.randomUUID(),kind,payload,scope});
it('rejects cross-episode reference arrays and audio takes, and follows background transcription task ownership',async()=>{
 const f=await nativeFixture(),e=f.engine,p=f.prepareInput().projectId;
 const a=value(await scoped(e,undefined)('subproject.create',{projectId:p,title:'A'})),b=value(await scoped(e,undefined)('subproject.create',{projectId:p,title:'B'}));
 const sa={projectId:p,subprojectId:a.id},sb={projectId:p,subprojectId:b.id},runA=scoped(e,sa),runB=scoped(e,sb);
 value(await runB('audio.saveVoiceLine',{projectId:p,id:'b-line',expectedRevision:0,text:'B only'}));
 const prepared=value(await runB('generation.prepare',f.prepareInput())),task=value(await runB('generation.approveAndEnqueue',{preparedId:prepared.preparedId,approvedPlanHash:prepared.planHash,currency:'CNY',allowanceMicros:1000000,budgetLimitMicros:100000000,acknowledgeUnknown:true,executionOwner:prepared.executionOwner,runId:prepared.runId}));
 const db=new DatabaseSync(join(f.root,'library.sqlite'));try{
 const lib={db,libraryId:e.identity.libraryId,checkOwnership:()=>({ok:true,value:undefined})} as any,s=contentScopesFor(lib);
 expect(s.guard({kind:'finish.prepareTurn',scope:sa,payload:{voiceLineRefs:[{id:'b-line',revision:1}]}})).toMatchObject({ok:false,error:{code:'WRONG_SUBPROJECT'}});
 db.prepare('INSERT INTO audio_take VALUES(?,?,?)').run(task.taskId,p,JSON.stringify({id:'b-take',task:{taskId:task.taskId}}));
 expect(s.guard({kind:'audio.reviewVoiceover',scope:sa,payload:{takeId:'b-take'}})).toMatchObject({ok:false,error:{code:'WRONG_SUBPROJECT'}});
 db.prepare('INSERT INTO transcript_revision VALUES(?,?,?,?,?)').run(p,'from-task',1,task.taskId,JSON.stringify({id:'from-task'}));
 expect(s.inferred('transcript','from-task')).toEqual(sb);
 const lineA=value(await runA('audio.saveVoiceLine',{projectId:p,id:'a-line',expectedRevision:0,text:'A'}));expect(lineA.id).toBe('a-line');
 }finally{db.close();}
},30000);
it('completion takes the selected timeline script revision and excludes unused candidates',async()=>{
 const f=await nativeFixture(),e=f.engine,p=f.prepareInput().projectId;
 const a=value(await scoped(e,undefined)('subproject.create',{projectId:p,title:'A'})),sa={projectId:p,subprojectId:a.id},run=scoped(e,sa);
 const script={projectId:p,id:'script',expectedRevision:0,title:'S',synopsis:'',body:'ADOPTED R1',scenes:[]};
 value(await run('creation.saveScript',script));
 const t=value(await run('timeline.create',{projectId:p,id:'cut',title:'Cut',scriptRef:{id:'script',revision:1},settings:{fps:{num:30,den:1},canvas:{width:1920,height:1080}}}));
 value(await run('creation.saveScript',{...script,expectedRevision:1,body:'UNUSED R2'}));
 value(await run('creation.saveScript',{...script,id:'candidate',body:'UNUSED CANDIDATE'}));
 const c=value(await run('subproject.complete',{...sa,expectedRevision:2,timelineRef:{id:t.id,revision:t.revision}}));
 const db=new DatabaseSync(join(f.root,'library.sqlite'));try{const snapshot=JSON.parse(String(db.prepare('SELECT source_json FROM subproject_completion WHERE id=?').get(c.id)?.source_json));
 expect(snapshot.scripts).toMatchObject([{id:'script',revision:1,body:'ADOPTED R1'}]);expect(snapshot.scripts).toHaveLength(1);
 }finally{db.close();}
},30000);
it('allows explicit adoption of unclassified legacy imports in a multi-project library',async()=>{
 const f=await nativeFixture(),e=f.engine,p=f.prepareInput().projectId;
 const ref=await f.importFile(Buffer.from('legacy material'),'legacy.txt');
 value(await scoped(e,undefined)('project.create',{name:'Other parent'}));
 const a=value(await scoped(e,undefined)('subproject.create',{projectId:p,title:'A'})),sa={projectId:p,subprojectId:a.id},run=scoped(e,sa);
 const query=(view:string)=>e.commands.query({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind:'project.assets',payload:{...sa,view},scope:sa});
 expect(value(query('unclassified')).items).toEqual(expect.arrayContaining([expect.objectContaining({ref})]));
 value(await run('project.assetAssign',{...sa,ref}));
 expect(value(query('all')).items).toEqual(expect.arrayContaining([expect.objectContaining({ref})]));
 expect(value(query('unclassified')).items).toHaveLength(0);
},30000);
