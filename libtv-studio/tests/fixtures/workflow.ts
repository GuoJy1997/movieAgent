import { nativeFixture, value, execute } from './native-generation';
export async function graphFixture() {
 const s = await nativeFixture(); const e = s.engine, canvasId = s.prepareInput().projectId;
 const read = () => value(e.canvas.read(canvasId));
 const apply = (operations: unknown[], baseRevision = read().revision) => execute(e, 'canvas.applyCommand', {canvasId,baseRevision,operations});
 const node = (id: string) => read().nodes.find((n: any) => n.nodeId === id);
 const content = {type:'generation',prompt:'A quiet lake',profileRef:s.prepareInput().profileRef,inputs:[]};
 value(await apply(['a','b','c'].map(nodeId => ({kind:'create',nodeId,content,layout:{x:0,y:0}}))));
 const edge = (id: string, source='a', target='b', targetPort='prompt') => ({id,sourceNodeId:source,sourceIncarnation:node(source).incarnation,targetNodeId:target,targetIncarnation:node(target).incarnation,sourcePort:'output',targetPort});
 return {...s,canvasId,read,apply,node,edge};
}

export const prepareWorkflow = (s:any, mode='upstream',nodeIds=['b']) => execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode,nodeIds,executionOwner:'human',runId:'workflow-run'});
export const approveWorkflow = (s:any,p:any,budget=30) => execute(s.engine,'workflow.approveAndEnqueue',{planId:p.planId,approvedPlanHash:p.planHash,currency:'CNY',budgetLimitMicros:budget,stepAllowances:Object.fromEntries(p.steps.map((x:any)=>[x.stepId,10])),acknowledgeUnknown:true,executionOwner:p.executionOwner,runId:p.runId});
export async function addWorkflowModel(s:any,id:string,adapterType:string,pricing:any={status:'unknown'}) {
 const e=s.engine, original=e.modelConfig.listConnections().connections[0];
 const {libraryId:_l,revision:_r,createdAt:_c,...base}=original;
 const connectionRef=value(await execute(e,'provider.saveConnection',{...base,id,adapterType,expectedRevision:0}));
 const video=adapterType==='minimax-video-v2',text=adapterType==='openai-chat-v1',edit=adapterType==='openai-image-edit-v1';
 const modelRef=value(await execute(e,'model.saveDefinition',{id,expectedRevision:0,name:id,modelId:video?'MiniMax-H3-Highspeed':'fixture',connectionRef,capabilities:video?{taskTypes:['text_to_video','image_to_video'],inputKinds:['text','image'],outputKinds:['video'],maxBatch:1}:text?{taskTypes:['text_to_text'],inputKinds:['text'],outputKinds:['text'],maxBatch:1}:edit?{taskTypes:['image_to_image'],inputKinds:['text','image'],outputKinds:['image'],maxBatch:1}:{taskTypes:['text_to_image'],inputKinds:['text'],outputKinds:['image'],maxBatch:1},parameters:video?{duration:{type:'integer',min:4,max:15,default:4},resolution:{type:'enum',values:['768P'],default:'768P'},ratio:{type:'enum',values:['adaptive'],default:'adaptive'}}:text?{max_tokens:{type:'integer',min:1,max:8192,default:1024}}:{},pricing}));
 return value(await execute(e,'profile.save',{id,expectedRevision:0,name:id,modelRef,parameters:{}}));
}
