import {expect,it,afterEach} from 'vitest';
import {join} from 'node:path';
import sharp from 'sharp';
import {nativeFixture,execute,value} from '../fixtures/native-generation';
import {McpOperationStore} from '../../apps/desktop/src/main/mcp/operation-store';
import {McpApprovalService} from '../../apps/desktop/src/main/mcp/approval';
import type {McpEngineAccess} from '../../apps/desktop/src/main/mcp/access';
const stores:McpOperationStore[]=[];afterEach(()=>stores.splice(0).forEach(s=>s.close()));
async function setup(){
 const f=await nativeFixture('minimax-video-v2'),libraryId=f.engine.identity.libraryId,projectId=f.prepareInput().projectId;
 const sub=value(f.engine.commands.query({schemaVersion:1,libraryId,connectionEpoch:'test',queryId:'sub',kind:'subproject.list',payload:{projectId}})).items[0],scope={libraryId,projectId,subprojectId:sub.id};
 const access:McpEngineAccess={identity:()=>({libraryId,connectionEpoch:'test'}),execute:async(kind,payload,commandId,sc)=>f.engine.commands.execute({schemaVersion:1,libraryId,connectionEpoch:'test',commandId,kind,payload,scope:{projectId:sc.projectId,subprojectId:sc.subprojectId}}),query:async(kind,payload,sc)=>f.engine.commands.query({schemaVersion:1,libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind,payload,...(sc?{scope:{projectId:sc.projectId,subprojectId:sc.subprojectId}}:{})}),registerGrant:async grant=>f.engine.assets.registerGrant(grant),readMedia:i=>f.engine.assets.read(i)};
 value(await execute(f.engine,'creation.saveScript',{projectId,id:'script',expectedRevision:0,title:'test',synopsis:'',body:'',scenes:[{id:'scene',title:'lake',location:'',time:'',description:''}]}));
 value(await execute(f.engine,'creation.saveShot',{projectId,id:'shot',expectedRevision:0,scriptId:'script',sceneId:'scene',order:0,title:'shot',durationSeconds:4,shotSize:'wide',cameraMovement:'',subject:'lake',action:'',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'lake',entityRefs:[]}));
 const ref=await f.importFile(await sharp({create:{width:512,height:288,channels:3,background:'#789abc'}}).png().toBuffer());
 const p=value(await execute(f.engine,'shots.prepareProduction',{projectId,scriptId:'script',canvasId:projectId,shots:[{shotId:'shot',revision:1}],videoProfileRef:f.prepareInput().profileRef,reusedImages:[{shotId:'shot',ref,role:'first_frame'}],executionOwner:'movieagent-mcp',runId:'run'}));
 value(await execute(f.engine,'shots.applyProduction',{productionId:p.productionId,approvedHash:p.planHash,expectedCanvasRevision:p.canvasRevision,executionOwner:p.executionOwner,runId:p.runId}));
 const w=value(await execute(f.engine,'workflow.prepare',{canvasId:projectId,mode:'selection',nodeIds:p.steps.map((x:any)=>x.nodeId),executionOwner:p.executionOwner,runId:p.runId}));
 value(await execute(f.engine,'shots.attachWorkflow',{productionId:p.productionId,workflowId:w.planId,executionOwner:p.executionOwner}));
 const store=new McpOperationStore(join(f.root,'approval.sqlite'));stores.push(store);
 return {...f,access,scope,store,p,w,args:{instanceId:'instance',scope,requestId:'execute-once',productionId:p.productionId,budgetLimitMicros:1000000,stepAllowanceMicros:10000},client:{id:'client',name:'test',connectedAt:new Date().toISOString()}};
}
it('requires real approval and does not let concurrent retries enqueue twice',async()=>{
 const f=await setup();let confirmations=0;
 const service=new McpApprovalService({store:f.store,access:()=>f.access,isAllowed:()=>true,confirm:async()=>{confirmations++;return true;}});
 const results=await Promise.all([service.execute(f.args,f.client),service.execute(f.args,f.client)]);
 expect(results.every(r=>r.ok)).toBe(true);expect(confirmations).toBe(1);
 await service.execute(f.args,f.client);expect(confirmations).toBe(1);
 expect(value(f.engine.workflows.read(f.w.planId)).state).toBe('running');
 expect(await service.execute({...f.args,budgetLimitMicros:2000000},f.client)).toMatchObject({ok:false,error:{code:'COMMAND_ID_REUSED'}});
});
it('persists a declined confirmation and revocation prevents a late approval',async()=>{
 const f=await setup();let allowed=true;
 const service=new McpApprovalService({store:f.store,access:()=>f.access,isAllowed:()=>allowed,confirm:async()=>{allowed=false;return true;}});
 expect(await service.execute(f.args,f.client)).toMatchObject({ok:false,error:{code:'MCP_AUTHORIZATION_REVOKED'}});
 expect(value(f.engine.workflows.read(f.w.planId)).state).toBe('prepared');
 let confirmations=0;
 const decline=new McpApprovalService({store:f.store,access:()=>f.access,isAllowed:()=>true,confirm:async()=>{confirmations++;return false;}});
 const args={...f.args,requestId:'decline'};expect(await decline.execute(args,f.client)).toMatchObject({ok:true,value:{submitted:false}});
 await decline.execute(args,f.client);expect(confirmations).toBe(1);expect(f.requests).toHaveLength(0);
});
it('recovers a lost acknowledgement using the actual command receipt without a second approval',async()=>{
 const f=await setup();let confirmations=0,lose=true;
 const access={...f.access,execute:async(...args:Parameters<McpEngineAccess['execute']>)=>{const result=await f.access.execute(...args);if(args[0]==='workflow.approveAndEnqueue'&&lose){lose=false;return {ok:false as const,error:{code:'ENGINE_DISCONNECTED',message:'lost fixture reply'}};}return result;}};
 const service=new McpApprovalService({store:f.store,access:()=>access,isAllowed:()=>true,confirm:async()=>{confirmations++;return true;}});
 expect(await service.execute(f.args,f.client)).toMatchObject({ok:false});
 const replay=new McpApprovalService({store:f.store,access:()=>f.access,isAllowed:()=>true,confirm:async()=>{throw Error('must not reconfirm');}});
 expect(await replay.execute({...f.args,instanceId:'reopened-instance'},f.client)).toMatchObject({ok:true,value:{submitted:true}});
 expect(confirmations).toBe(1);expect(value(f.engine.workflows.read(f.w.planId)).state).toBe('running');
});
