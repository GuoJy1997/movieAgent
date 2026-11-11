import type {McpImportInput,McpImportOperation,McpScope,McpImportSourceDirectory,McpAssetBinding} from '../../../../../packages/contracts/src/mcp.ts';
import type {AssetHistory,AssetMetadataView,AssetVersionRef,ImportRef} from '../../../../../packages/contracts/src/assets.ts';
import type {CreationSnapshot} from '../../../../../packages/contracts/src/creation.ts';
import type {CommandKind,CommandReceipt} from '../../../../../packages/contracts/src/commands.ts';
import {ok,fail,type Result,type AppError} from '../../../../../packages/contracts/src/result.ts';
import {issueFileGrant} from '../file-grants.ts';
import {importSchema} from './import-schema.ts';
import {McpOperationStore,stableHash,type ImportRecord} from './operation-store.ts';
import {receiveImage,type ReceivedImage} from './import-files.ts';
import type {McpEngineAccess} from './access.ts';
class ImportFailure extends Error {constructor(readonly detail:AppError){super(detail.code);}}
function take<T>(r:Result<unknown>):T{if(!r.ok)throw new ImportFailure(r.error);return r.value as T;}
export class McpAssetImporter {
 private jobs=new Map<string,Promise<void>>();private tail=Promise.resolve();private stopped=false;
 constructor(private options:{store:McpOperationStore;access():McpEngineAccess;sources():McpImportSourceDirectory[];stagingRoot:string}){}
 private get store(){return this.options.store;}
 async start(raw:unknown):Promise<Result<McpImportOperation>>{
  const parsed=importSchema.safeParse(raw);if(!parsed.success)return fail('INVALID_INPUT','图片导入字段无效。');
  const input: McpImportInput=parsed.data;
  try{
   const a=this.options.access();if(a.identity().libraryId!==input.scope.libraryId)return fail('WRONG_LIBRARY','当前连接不属于目标资料库。');
   const valid=await a.query('subproject.read',{projectId:input.scope.projectId,subprojectId:input.scope.subprojectId},input.scope);if(!valid.ok)return valid;
   const id=stableHash([input.scope,input.requestId]),hash=stableHash(input),old=this.store.get(id);
   if(old){if(old.hash!==hash)return fail('COMMAND_ID_REUSED','同一个请求ID已用于不同导入参数。');if(['received','collecting','asset_ready','binding'].includes(old.public.state))this.queue(id);return ok(old.public);}
   if(this.jobs.size>=32)return fail('IMPORT_BUSY','当前导入队列已满，请等待已有操作。');
   if(this.stopped)return fail('MCP_STOPPING','MCP正在关闭。');
   const now=new Date().toISOString();
   const r:ImportRecord={hash,input,results:{},payloads:{},public:{operationId:id,requestId:input.requestId,scope:input.scope,state:'received',asset:null,hash:null,completedSteps:[],error:null,createdAt:now,updatedAt:now}};
   this.store.save(r);this.queue(id);return ok(r.public);
  }catch{return fail('MCP_IMPORT_UNAVAILABLE','导入服务暂不可用。');}
 }
 get(id:string,scope?:McpScope):Result<McpImportOperation>{const r=this.store.get(id);return r&&(!scope||stableHash(r.public.scope)===stableHash(scope))?ok(r.public):fail('OPERATION_NOT_FOUND','此范围没有该导入操作。');}
 async resume(id:string,scope:McpScope):Promise<Result<McpImportOperation>>{
  const found=this.get(id,scope);if(!found.ok)return found;
  if(!['completed','cancelled'].includes(found.value.state)){if(this.stopped)return fail('MCP_STOPPING','MCP正在关闭。');this.queue(id);}return found;
 }
 cancel(id:string,scope:McpScope):Result<McpImportOperation>{
  const found=this.get(id,scope);if(!found.ok)return found;const r=this.store.get(id)!;
  if(!['completed','cancelled'].includes(r.public.state)){r.cancelRequested=true;r.public.state=this.jobs.has(id)?'cancelling':'cancelled';this.store.save(r);}return ok(r.public);
 }
 async wait(id:string,timeoutMs=30000):Promise<Result<McpImportOperation>>{
  let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([this.jobs.get(id)??Promise.resolve(),new Promise<void>(resolve=>{timer=setTimeout(resolve,Math.min(30000,Math.max(0,timeoutMs)));})]);}finally{if(timer)clearTimeout(timer);}return this.get(id);
 }
 recover(){for(const r of this.store.pending())this.queue(r.public.operationId);}
 async close(){this.stopped=true;await this.tail;}
 private queue(id:string){if(this.stopped||this.jobs.has(id))return;const job=this.tail.then(()=>this.stopped?undefined:this.run(id)).finally(()=>this.jobs.delete(id));this.jobs.set(id,job);this.tail=job.catch(()=>{});}
 private check(r:ImportRecord){if(this.store.get(r.public.operationId)?.cancelRequested)throw new ImportFailure({code:'IMPORT_CANCELLED',message:'导入已取消；已收存的资产保留。'});}
 private async step(r:ImportRecord,name:string,kind:CommandKind,payload:unknown):Promise<unknown>{
  this.check(r);if(name in r.results)return r.results[name];
  if(!(name in r.payloads)){r.payloads[name]=payload;this.store.save(r);}
  const commandId='mcp-'+r.public.operationId+'-'+name, a=this.options.access();
  const old=take<CommandReceipt|null>(await a.query('command.receipt',{commandId},r.input.scope));
  const receipt=old??take<CommandReceipt>(await a.execute(kind,r.payloads[name],commandId,r.input.scope));
  r.results[name]=receipt.result;r.public.completedSteps.push(name);this.store.save(r);return receipt.result;
 }
 private async run(id:string){
  const r=this.store.get(id);if(!r)return;
  try{
   this.check(r);const a=this.options.access();
   if(a.identity().libraryId!==r.input.scope.libraryId)throw new ImportFailure({code:'WRONG_LIBRARY',message:'连接资料库已更换。'});
   take(await a.query('subproject.read',{projectId:r.input.scope.projectId,subprojectId:r.input.scope.subprojectId},r.input.scope));
   r.public.error=null;
   if(!r.public.asset){
    r.public.state='collecting';this.store.save(r);
    const importCommandId='mcp-'+id+'-collect';
    const old=take<CommandReceipt<ImportRef>|null>(await a.query('command.receipt',{commandId:importCommandId},r.input.scope));
    let imported:ImportRef;
    if(old){imported=old.result;}else{
     if(!r.received){r.received=take<ReceivedImage>(await receiveImage(r.input.source,this.options.sources(),this.options.stagingRoot,id));r.public.hash=r.received.hash;if(r.input.source.kind==='bytes')r.input.source.base64='';this.store.save(r);}
     this.check(r);
     const granted=take<Awaited<ReturnType<typeof issueFileGrant>> extends Result<infer G>?G:never>(await issueFileGrant(r.input.scope.libraryId,[r.received.path]));
     granted.grantId='mcp-grant-'+id;granted.importId='mcp-import-'+id;
     const registered=await a.registerGrant(granted);if(!registered.ok&&registered.error.code!=='FILE_GRANT_EXISTS')throw new ImportFailure(registered.error);
     imported=await this.step(r,'collect','asset.importGrantedFiles',{grantId:granted.grantId,...r.input.targetAsset}) as ImportRef;
    }
    const ref:AssetVersionRef|undefined=imported.versions[0];if(!ref)throw new Error('invalid receipt');
    const history=take<AssetHistory>(await a.query('asset.history',{assetId:ref.assetId},r.input.scope));
    const asset=history.versions.find(v=>v.ref.version===ref.version);if(!asset)throw new Error('asset missing');
    r.public.asset=asset;r.public.hash??=r.received?.hash??null;r.public.state='asset_ready';
    this.store.rememberSource(ref,r.input.sourceInfo,r.public.hash??'');
    if(!r.public.completedSteps.includes('collect'))r.public.completedSteps.push('collect');this.store.save(r);
   }
   this.check(r);const ref=r.public.asset.ref;
   r.public.state='binding';this.store.save(r);
   const metadata=await this.step(r,'metadata','asset.updateMetadata',{assetId:ref.assetId,expectedRevision:r.public.asset.metadataRevision??1,name:r.input.name,tags:r.input.tags??[]}) as AssetMetadataView;
   r.public.asset={...r.public.asset,...{name:metadata.name,tags:metadata.tags,metadataRevision:metadata.metadataRevision}};this.store.save(r);
   if(r.input.shared!==undefined)await this.step(r,'shared','project.assetTag',{projectId:r.input.scope.projectId,subprojectId:r.input.scope.subprojectId,ref,common:r.input.shared});
   for(const [index,binding] of (r.input.bindings??[]).entries())await this.bind(r,'binding-'+index,binding);
   this.check(r);this.store.rememberSource(ref,r.input.sourceInfo,r.public.hash??'');r.public.state='completed';r.public.error=null;this.store.save(r);
  }catch(error){
   const detail=error instanceof ImportFailure?error.detail:{code:'IMPORT_INTERRUPTED',message:'导入中断，原件和已完成步骤保留，可核对后继续。'};
   r.public.error=detail;r.public.state=detail.code==='IMPORT_CANCELLED'?'cancelled':r.public.asset?'partial':'failed';this.store.save(r);
  }
 }
 private async bind(r:ImportRecord,name:string,binding:McpAssetBinding){
  if(name in r.results)return;this.check(r);const ref=r.public.asset!.ref,projectId=r.input.scope.projectId;
  if(name in r.payloads){const kind=binding.kind==='entity'?'creation.saveEntity':binding.kind==='shot'?'creation.selectOutput':'canvas.applyCommand';await this.step(r,name,kind,r.payloads[name]);return;}
  if(binding.kind==='entity'){
   const snapshot=take<CreationSnapshot>(await this.options.access().query('creation.read',{projectId},r.input.scope)),e=snapshot.entities.find(v=>v.id===binding.entityId);
   if(!e||e.revision!==binding.expectedRevision)throw new ImportFailure({code:'REVISION_CONFLICT',message:'角色或场景版本已改变，请读取新版本后重新绑定。'});
   const references=e.references.some(v=>stableHash(v)===stableHash(ref))?e.references:[...e.references,ref];
   await this.step(r,name,'creation.saveEntity',{projectId,id:e.id,expectedRevision:e.revision,kind:e.kind,name:e.name,description:e.description,constraints:e.constraints,references});
  }else if(binding.kind==='shot'){
   await this.step(r,name,'creation.selectOutput',{projectId,shotId:binding.shotId,expectedRevision:binding.expectedRevision,expectedSelectionRevision:binding.expectedSelectionRevision,role:'image',reference:ref});
  }else{
   await this.step(r,name,'canvas.applyCommand',{canvasId:binding.canvasId,baseRevision:binding.baseRevision,operations:[{kind:'create',nodeId:binding.nodeId??'mcp-node-'+stableHash([r.public.operationId,name]).slice(0,48),content:{type:'image',media:ref},layout:{x:binding.x,y:binding.y}}]});
  }
 }
}
