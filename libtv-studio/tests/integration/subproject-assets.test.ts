import {expect,it} from 'vitest';
import {nativeFixture,value,execute} from '../fixtures/native-generation.ts';
it('shows registered parent assets to sibling episodes without a sharing gate and rejects another parent',async()=>{
 const s=await nativeFixture(),e=s.engine,p=s.prepareInput().projectId,ref=await s.importFile(Buffer.from('Research source'),'source.txt');
 const a=value(await execute(e,'subproject.create',{projectId:p,title:'A'})),b=value(await execute(e,'subproject.create',{projectId:p,title:'B'}));
 const query=(projectId:string,subprojectId:string)=>e.commands.query({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind:'project.assets',payload:{projectId,subprojectId,view:'all'}});
 const result=query(p,b.id);expect(result).toMatchObject({ok:true});if(!result.ok)return;
 expect((result.value as any).items).toEqual(expect.arrayContaining([expect.objectContaining({ref})]));
 const q=value(await execute(e,'project.create',{name:'Other'})),qsub=value(e.commands.query({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind:'subproject.list',payload:{projectId:q.id}})).items[0];
 const rejected=await e.commands.execute({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',commandId:crypto.randomUUID(),kind:'creation.saveEntity',payload:{projectId:q.id,id:'foreign',expectedRevision:0,kind:'prop',name:'Foreign',description:'',constraints:'',references:[ref]},scope:{projectId:q.id,subprojectId:qsub.id}});
 expect(rejected).toMatchObject({ok:false,error:{code:'ASSET_NOT_IN_PROJECT'}});
 const use=await e.commands.execute({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',commandId:crypto.randomUUID(),kind:'creation.saveEntity',payload:{projectId:p,id:'shared',expectedRevision:0,kind:'prop',name:'Shared',description:'',constraints:'',references:[ref]},scope:{projectId:p,subprojectId:a.id}});
 expect(use).toMatchObject({ok:true});
 expect((query(p,b.id) as any).value.items[0].ref).toEqual(ref);
},30000);

it('does not classify a known foreign generated asset version as an unowned historical import',async()=>{
 const f=await nativeFixture(),e=f.engine,p=f.prepareInput().projectId;
 const q=value(await execute(e,'project.create',{name:'Other'})),prepared=value(await execute(e,'generation.prepare',{...f.prepareInput(),projectId:q.id}));
 const task=value(await execute(e,'generation.approveAndEnqueue',{preparedId:prepared.preparedId,approvedPlanHash:prepared.planHash,currency:'CNY',allowanceMicros:1000000,budgetLimitMicros:100000000,acknowledgeUnknown:true,executionOwner:prepared.executionOwner,runId:prepared.runId}));
 value(await e.scheduler.run(task.attemptId));
 const result=value(e.generation.read(task.taskId)),ref=value(await execute(e,'asset.saveArtifact',{artifactRef:result.artifactRef,name:'Foreign generation'}));
 const a=value(await execute(e,'subproject.create',{projectId:p,title:'A'})),scope={projectId:p,subprojectId:a.id};
 const catalog=value(e.commands.query({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind:'project.assets',payload:{...scope,view:'unclassified'},scope}));
 expect(catalog.items.some((x:any)=>x.ref.assetId===ref.assetId)).toBe(false);
 expect(await e.commands.execute({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'test',commandId:crypto.randomUUID(),kind:'project.assetAssign',payload:{...scope,ref},scope})).toMatchObject({ok:false,error:{code:'ASSET_ALREADY_ASSIGNED'}});
},30000);
