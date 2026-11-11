import {afterEach,expect,it} from 'vitest';
import {cleanup,command,image,unwrap,create} from './timeline-fixtures.ts';
import {setupRender} from './render-fixtures.ts';
afterEach(cleanup);
it('registers a durable MP4 revision once, preserves two deliverables, and reuses it from a sibling episode',async()=>{
 const {e,root,projectId}=await setupRender();
 const a=(unwrap(await e.commands.execute(command(e,'subproject.create',{projectId,title:'A'}))).result as any);
 const b=(unwrap(await e.commands.execute(command(e,'subproject.create',{projectId,title:'B'}))).result as any);
 const sa={projectId,subprojectId:a.id},sb={projectId,subprojectId:b.id};
 const exec=async(kind:string,payload:unknown,scope=sa)=>(unwrap(await e.commands.execute({...command(e,kind,payload),scope}))).result as any;
 await exec('creation.saveScript',{projectId,id:'script-a',expectedRevision:0,title:'A',synopsis:'',body:'',scenes:[]});
 const ref=await image(e,root),metadata=unwrap(e.assets.metadata(ref));
 for(const id of ['main','trailer']){
  await exec('timeline.create',{...create(projectId,id),scriptRef:{id:'script-a',revision:1}});
  await exec('timeline.applyOps',{projectId,timelineId:id,expectedRevision:1,operations:[{kind:'insert',clip:{id:'clip',kind:'image',media:ref,sourceHash:metadata.hash,sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:4800,fit:'contain',gainMilli:1000,mute:true}}]});
  const plan=await exec('render.prepare',{timelineRef:{libraryId:e.identity.libraryId,projectId,id,revision:2},purpose:'mp4',executionOwner:'user',runId:crypto.randomUUID()});
  const job=await exec('render.enqueue',{planId:plan.planId,planHash:plan.planHash,executionOwner:'user',runId:plan.runId,diskBudgetBytes:plan.requiredFreeBytes});
  e.renderScheduler.start();e.renderScheduler.resume();e.renderScheduler.wake();await e.renderScheduler.drain();await e.renderScheduler.pause();
  expect(unwrap(e.renders.read({projectId,jobId:job.jobId}))).toMatchObject({state:'SUCCEEDED'});
  const input={...sa,title:id,timelineId:id,timelineRevision:2,jobId:job.jobId};
  const first=await exec('subproject.deliver',input);expect(await exec('subproject.deliver',input)).toEqual(first);
  expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/);
 }
 const list=unwrap(e.commands.query({...command(e,'subproject.deliverables',sa),queryId:'deliver-list',scope:sa} as any)) as any;
 expect(list.items).toHaveLength(2);
 const catalog=unwrap(e.commands.query({...command(e,'project.assets',{...sb,view:'all'}),queryId:'assets-list',scope:sb} as any)) as any;
 expect(catalog.items.some((x:any)=>x.sourceSubprojectId===a.id&&x.ref.assetId===list.items[0].media.assetId)).toBe(true);
},30000);
