import {toolDefinitions,validateTool} from './tools.ts';
import {stableHash,type McpOperationStore} from './operation-store.ts';
import type {McpAssetImporter} from './asset-import.ts';
import type {McpEngineAccess} from './access.ts';
import type {McpScope,McpClientView,McpImportSourceDirectory} from '../../../../../packages/contracts/src/mcp.ts';
import type {CommandKind} from '../../../../../packages/contracts/src/commands.ts';
import type {QueryMap,ProjectSnapshot} from '../../../../../packages/contracts/src/queries.ts';
import type {AssetHistory,MediaReference,AssetView} from '../../../../../packages/contracts/src/assets.ts';
import type {ProjectAssetCatalog} from '../../../../../packages/contracts/src/project-assets.ts';
import type {ModelSnapshot,ProfileSnapshot,ProviderSnapshot} from '../../../../../packages/contracts/src/models.ts';
import type {ShotProductionView,PreparedShotProduction} from '../../../../../packages/contracts/src/shot-production.ts';
import type {PreparedWorkflow,WorkflowView} from '../../../../../packages/contracts/src/workflows.ts';
import type {TaskView} from '../../../../../packages/contracts/src/generation.ts';
import {fail,ok,type Result,type AppError} from '../../../../../packages/contracts/src/result.ts';
class ToolFailure extends Error {constructor(readonly detail:AppError){super(detail.code);}}
const take=<T>(result:Result<unknown>):T=>{if(!result.ok)throw new ToolFailure(result.error);return result.value as T;};
const pick=(args:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.filter(k=>args[k]!==undefined).map(k=>[k,args[k]]));
export const mcpCommandId=(name:string,scope:unknown,requestId:unknown)=>'mcp-call-'+stableHash([name,scope,requestId]);
export function publicWorkflow(w:WorkflowView){
 return {workflowId:w.workflowId,state:w.state,canvasId:w.canvasId,planId:w.plan.planId,planHash:w.plan.planHash,expiresAt:w.plan.expiresAt,estimateMicros:w.plan.estimateMicros,currency:w.plan.currency,steps:w.steps,reservationMicros:w.reservationMicros,models:w.plan.steps.map(s=>({stepId:s.stepId,modelId:s.template.config.model.modelId,outputKinds:s.template.config.model.capabilities.outputKinds})),externalInputs:w.plan.externalInputs};
}
export interface McpRouterOptions {
 instanceId:string;access():McpEngineAccess;store:McpOperationStore;importer:McpAssetImporter;sources():McpImportSourceDirectory[];
 fixedProjectId?:string;
 listWorkspaces?():Promise<Result<unknown>>;
 openWorkspace?(workspaceId:string,requestId:string):Promise<Result<unknown>>;
 createProject?(name:string,commandId:string):Promise<Result<unknown>>;
 executeProduction?(args:Record<string,unknown>,client:McpClientView):Promise<Result<unknown>>;
}
export class McpToolRouter {
 constructor(private options:McpRouterOptions){}
 async call(name:string,raw:unknown,client:McpClientView):Promise<Result<unknown>>{
  const args=validateTool(name,raw);if(!args)return fail('INVALID_INPUT','工具不存在或字段不符合其schema。');
  if(args.instanceId!==this.options.instanceId)return fail('WRONG_INSTANCE','请选择当前工作区实例。');
  try{
   const access=this.options.access(),identity=access.identity(),scope=args.scope as McpScope|undefined;
   if(scope){if(scope.libraryId!==identity.libraryId)return fail('WRONG_LIBRARY','工具范围不属于当前资料库。');if(this.options.fixedProjectId&&scope.projectId!==this.options.fixedProjectId)return fail('WRONG_PROJECT','此目录属于另一父项目。');take(await access.query('subproject.read',{projectId:scope.projectId,subprojectId:scope.subprojectId},scope));}
   if(args.projectId&&this.options.fixedProjectId&&args.projectId!==this.options.fixedProjectId)return fail('WRONG_PROJECT','请选择此工作目录的父项目。');
   const q=<T>(kind:keyof QueryMap,payload:unknown)=>access.query(kind,payload,scope).then(take<T>);
   const cmd=async<T>(kind:CommandKind,payload:unknown,step=name):Promise<T>=>take<T>({ok:true,value:take<{result:T}>(await access.execute(kind,payload,mcpCommandId(step,scope,args.requestId),scope!)).result});
   if(['workspace_open','imports_resume','imports_cancel'].includes(name)){
    const key=mcpCommandId(name,scope??identity.libraryId,args.requestId),{instanceId:_route,...intent}=args,hash=stableHash(intent);
    const prior=this.options.store.action<{hash:string}>(key);
    if(prior&&prior.hash!==hash)return fail('COMMAND_ID_REUSED','同一请求ID已用于不同的控制操作。');
    if(!prior)this.options.store.saveAction(key,{hash,kind:'control'});
   }
   const project=scope?.projectId;
   switch(name){
    case 'system_doctor':return ok({ready:true,instanceId:this.options.instanceId,...identity,stage:'M1'});
    case 'system_capabilities':return ok({stage:'M1',tools:Object.keys(toolDefinitions),maxImageBytes:33554432,maxImagePixels:40000000,maxInlineBytes:8388608,sourceKinds:['localFile','bytes'],paidExecution:'desktop-confirmation',deferred:['timeline','export','remote-engine']});
    case 'workspace_list':return this.options.listWorkspaces?this.options.listWorkspaces():ok([]);
    case 'workspace_open':return this.options.openWorkspace?this.options.openWorkspace(String(args.workspaceId),String(args.requestId)):fail('WORKSPACE_UNAVAILABLE','请从项目启动器打开已登记目录。');
    case 'project_list':{const s=await q<ProjectSnapshot>('project.list',{});return ok({...s,projects:this.options.fixedProjectId?s.projects.filter(p=>p.id===this.options.fixedProjectId):s.projects});}
    case 'project_create':return this.options.fixedProjectId?fail('DIRECTORY_PROJECT_FIXED','此目录已绑定父项目，请通过启动器新建工作目录。'):this.options.createProject?this.options.createProject(String(args.name),mcpCommandId(name,identity.libraryId,args.requestId)):fail('PROJECT_CREATION_UNAVAILABLE','请从启动器创建项目。');
    case 'subproject_list':return ok(await q('subproject.list',{projectId:args.projectId}));
    case 'subproject_create':return ok(await cmd('subproject.create',{projectId:project,...pick(args,['title','number'])}));
    case 'import_sources':return ok(this.options.sources());
    case 'assets_list':{const s=await q<ProjectAssetCatalog>('project.assets',{projectId:project,subprojectId:scope!.subprojectId,view:args.view});return ok({...s,total:s.items.length,items:s.items.slice(Number(args.offset),Number(args.offset)+Number(args.limit))});}
    case 'assets_get':return ok(await this.asset(access,scope!,args.ref as MediaReference));
    case 'assets_preview':{
     const ref=args.ref as MediaReference,asset=await this.asset(access,scope!,ref);
     if(!asset.asset.mime.startsWith('image/'))return fail('UNSUPPORTED_MEDIA','M1预览仅支持图片。');
     const image=take<{bytes:Uint8Array;mime:string;hash:string}>(await access.readMedia({libraryId:scope!.libraryId,ref,variant:'thumbnail'}));
     return ok({...asset,image:{mimeType:image.mime,data:Buffer.from(image.bytes).toString('base64')}});
    }
    case 'assets_import':{const {instanceId:_,...input}=args;return this.options.importer.start(input);}
    case 'assets_update':return ok(await cmd('asset.updateMetadata',pick(args,['assetId','expectedRevision','name','tags'])));
    case 'assets_share':return ok(await cmd('project.assetTag',{projectId:project,subprojectId:scope!.subprojectId,ref:args.ref,common:args.shared}));
    case 'imports_get':return this.options.importer.get(String(args.operationId),scope!);
    case 'imports_wait':{const found=this.options.importer.get(String(args.operationId),scope!);return found.ok?this.options.importer.wait(String(args.operationId),Number(args.timeoutMs)):found;}
    case 'imports_resume':return this.options.importer.resume(String(args.operationId),scope!);
    case 'imports_cancel':return this.options.importer.cancel(String(args.operationId),scope!);
    case 'creation_get':return ok(await q('creation.read',{projectId:project,...pick(args,['scriptId'])}));
    case 'entity_save':return ok(await cmd('creation.saveEntity',{projectId:project,...pick(args,['id','expectedRevision','kind','name','description','constraints','references'])}));
    case 'shot_select_image':{
     await this.image(access,scope!,args.ref as MediaReference);
     return ok(await cmd('creation.selectOutput',{projectId:project,...pick(args,['shotId','expectedRevision','expectedSelectionRevision']),role:'image',reference:args.ref}));
    }
    case 'canvas_list':return ok(await q('subproject.canvases',{projectId:project,subprojectId:scope!.subprojectId}));
    case 'canvas_create':return ok(await cmd('subproject.createCanvas',{projectId:project,subprojectId:scope!.subprojectId,title:args.title}));
    case 'canvas_get':return ok(await q('canvas.read',{canvasId:args.canvasId}));
    case 'canvas_add_image':{
     await this.image(access,scope!,args.ref as MediaReference);
     return ok(await cmd('canvas.applyCommand',{canvasId:args.canvasId,baseRevision:args.baseRevision,operations:[{kind:'create',nodeId:args.nodeId,content:{type:'image',media:args.ref},layout:{x:args.x,y:args.y}}]}));
    }
    case 'canvas_connect':return ok(await cmd('canvas.applyCommand',{canvasId:args.canvasId,baseRevision:args.baseRevision,operations:[{kind:'addEdge',edge:{id:args.edgeId,...pick(args,['sourceNodeId','sourceIncarnation','targetNodeId','targetIncarnation','targetPort']),sourcePort:'output'}}]}));
    case 'models_list':{
     const models=await q<ModelSnapshot>('model.list',{}),profiles=await q<ProfileSnapshot>('profile.list',{}),providers=await q<ProviderSnapshot>('provider.list',{});
     return ok({models:models.models.map(m=>({id:m.id,revision:m.revision,libraryId:m.libraryId,name:m.name,modelId:m.modelId,capabilities:m.capabilities,parameters:m.parameters,pricing:m.pricing,mcpImageReuse:m.capabilities.outputKinds.some(k=>k==='video')?{supported:m.capabilities.inputKinds.some(k=>k==='image')&&providers.connections.some(c=>c.id===m.connectionRef.id&&c.revision===m.connectionRef.revision&&c.adapterType==='minimax-video-v2'),roles:providers.connections.some(c=>c.id===m.connectionRef.id&&c.revision===m.connectionRef.revision&&c.adapterType==='minimax-video-v2')?['first_frame','reference']:[],note:'M1 uses the existing image/video route; H3 voice-reference requires the audio workflow.'}:null})),profiles:profiles.profiles.map(p=>({id:p.id,revision:p.revision,libraryId:p.libraryId,name:p.name,modelRef:p.modelRef,parameters:p.parameters})),providers:providers.connections.map(p=>({id:p.id,revision:p.revision,name:p.name,adapterType:p.adapterType,credentialState:p.credentialRef?providers.credentialStatuses.find(s=>s.ref.id===p.credentialRef?.id)?.state??'unavailable':'not-configured'}))});
    }
    case 'production_prepare':return ok(await cmd<PreparedShotProduction>('shots.prepareProduction',{projectId:project,...pick(args,['scriptId','canvasId','shots','imageProfileRef','videoProfileRef','reusedImages']),executionOwner:'movieagent-mcp',runId:mcpCommandId('run',scope,args.requestId)}));
    case 'production_apply':{
     const p=await q<ShotProductionView>('shots.production',{productionId:args.productionId});
     return ok(await cmd('shots.applyProduction',{...pick(args,['productionId','approvedHash','expectedCanvasRevision']),executionOwner:p.plan.executionOwner,runId:p.plan.runId}));
    }
    case 'production_prepare_execution':{
     const p=await q<ShotProductionView>('shots.production',{productionId:args.productionId});
     if(p.workflowId)return ok(publicWorkflow(await q<WorkflowView>('workflow.read',{workflowId:p.workflowId})));
     if(p.state!=='applied')return fail('PRODUCTION_NOT_APPLIED','请先把生产计划布置到画布。');
     const w=await cmd<PreparedWorkflow>('workflow.prepare',{canvasId:p.plan.canvasId,mode:'selection',nodeIds:p.plan.steps.map(s=>s.nodeId),executionOwner:p.plan.executionOwner,runId:p.plan.runId},name+'-prepare');
     await cmd('shots.attachWorkflow',{productionId:p.productionId,workflowId:w.planId,executionOwner:p.plan.executionOwner},name+'-attach');
     return ok(publicWorkflow(await q<WorkflowView>('workflow.read',{workflowId:w.planId})));
    }
    case 'production_execute':return this.options.executeProduction?this.options.executeProduction(args,client):fail('CONFIRMATION_UNAVAILABLE','当前桌面暂无法确认付费任务。');
    case 'production_get':{
     const p=await q<ShotProductionView>('shots.production',{productionId:args.productionId});
     return ok({production:p,workflow:p.workflowId?publicWorkflow(await q<WorkflowView>('workflow.read',{workflowId:p.workflowId})):null});
    }
    case 'production_cancel':{const p=await q<ShotProductionView>('shots.production',{productionId:args.productionId});return ok(await cmd('shots.stopProduction',{productionId:p.productionId,executionOwner:p.plan.executionOwner}));}
    case 'tasks_get':return ok(await q('task.read',{taskId:args.taskId}));
    case 'tasks_wait':{
     const until=Date.now()+Number(args.timeoutMs);let task=await q<TaskView>('task.read',{taskId:args.taskId});
     while(Date.now()<until&&!['SUCCEEDED','FAILED','CANCELLED','SUBMISSION_UNKNOWN','RECONCILE_REQUIRED'].includes(task.state)){await new Promise(r=>setTimeout(r,Math.min(250,until-Date.now())));task=await q<TaskView>('task.read',{taskId:args.taskId});}
     return ok(task);
    }
    case 'tasks_cancel':return ok(await cmd('task.requestCancel',{taskId:args.taskId}));
    case 'tasks_reconcile':return ok(await cmd('task.reconcile',{taskId:args.taskId}));
    default:return fail('TOOL_UNAVAILABLE','该工具不在M1交付范围。');
   }
  }catch(error){return error instanceof ToolFailure?{ok:false,error:error.detail}:fail('MCP_OPERATION_FAILED','操作未确认，请核对原请求ID及当前连接。');}
 }
 private async asset(access:McpEngineAccess,scope:McpScope,ref:MediaReference){
  if(ref.libraryId!==scope.libraryId)throw new ToolFailure({code:'WRONG_LIBRARY',message:'资产属于其他资料库。'});
  const c=take<ProjectAssetCatalog>(await access.query('project.assets',{projectId:scope.projectId,subprojectId:scope.subprojectId,view:'all'},scope));
  const owned=c.items.find(a=>a.ref.kind===ref.kind&&(a.ref.kind==='assetVersion'&&ref.kind==='assetVersion'?a.ref.assetId===ref.assetId:a.ref.kind==='artifact'&&ref.kind==='artifact'&&a.ref.artifactId===ref.artifactId));
  if(!owned)throw new ToolFailure({code:'ASSET_NOT_IN_PROJECT',message:'资产不属于该父项目。'});
  if(ref.kind==='artifact')return {asset:owned,sourceInfo:null};
  const h=take<AssetHistory>(await access.query('asset.history',{assetId:ref.assetId},scope));
  const asset=h.versions.find(a=>a.ref.version===ref.version);if(!asset)throw new ToolFailure({code:'ASSET_NOT_FOUND',message:'固定资产版本不存在。'});
  return {asset:asset as AssetView,sourceInfo:this.options.store.provenance(ref)};
 }
 private async image(a:McpEngineAccess,s:McpScope,ref:MediaReference){const v=await this.asset(a,s,ref);if(!v.asset.mime.startsWith('image/'))throw new ToolFailure({code:'INVALID_REFERENCE',message:'此操作需要图片资产。'});return v;}
}
