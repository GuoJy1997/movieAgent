import {afterEach,expect,it} from 'vitest';
import {cleanup,setup,image,shot,command,unwrap,settings} from './timeline-fixtures.ts';
afterEach(cleanup);
it('assigns a directly assembled new timeline to the episode that prepared the rough cut',async()=>{
 const {e,root,projectId}=await setup(),child=(unwrap(await e.commands.execute(command(e,'subproject.create',{projectId,title:'A'}))).result as any),scope={projectId,subprojectId:child.id};
 const exec=async(kind:string,payload:unknown)=>(unwrap(await e.commands.execute({...command(e,kind,payload),scope}))).result as any;
 const ref=await image(e,root);
 await exec('creation.saveScript',{projectId,id:'script-a',expectedRevision:0,title:'A',synopsis:'',body:'',scenes:[{id:'scene',title:'S',location:'',time:'',description:''}]});
 await exec('creation.saveShot',{...shot(projectId),scriptId:'script-a'});
 await exec('creation.selectOutput',{projectId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'image',reference:ref});
 const plan=await exec('timeline.prepareAssembly',{projectId,scriptRef:{id:'script-a',revision:1},shots:[{id:'shot',revision:1,selectionRevision:1}],target:{id:'direct-cut',expectedRevision:0},allowImages:true,settings,executionOwner:'editor',runId:'run'});
 await exec('timeline.applyAssembly',{planId:plan.planId,planHash:plan.planHash,executionOwner:'editor',runId:'run'});
 const q=e.commands.query({...command(e,'timeline.list',{projectId}),queryId:'cut',scope});
 expect(q).toMatchObject({ok:true,value:{timelines:[{id:'direct-cut'}]}});
});
