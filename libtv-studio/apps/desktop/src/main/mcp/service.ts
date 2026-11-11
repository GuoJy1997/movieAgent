import {mkdir,readFile,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {McpConfigureInput,McpStatus,McpImportSourceDirectory} from '../../../../../packages/contracts/src/mcp.ts';
import {ok,fail,isRecord,type Result} from '../../../../../packages/contracts/src/result.ts';
import {writeAtomicFile,isLocalAbsolutePath} from '../project-directories.ts';
import {McpOperationStore} from './operation-store.ts';
import {McpAssetImporter} from './asset-import.ts';
import {McpApprovalService,type McpApprovalRequest} from './approval.ts';
import {McpToolRouter,type McpRouterOptions} from './router.ts';
import {listenMcpBridge} from './transport.ts';
interface Options extends Pick<McpRouterOptions,'access'|'fixedProjectId'|'listWorkspaces'|'openWorkspace'|'createProject'> {
 stateRoot:string;discoveryDir:string;name:string;workspacePath:string;execPath:string;stdioPath:string;
 confirm(request:McpApprovalRequest):Promise<boolean>;
}
interface Settings {version:1;enabled:boolean;sources:McpImportSourceDirectory[]}
export async function createMcpService(options:Options){
 await mkdir(options.stateRoot,{recursive:true,mode:0o700});const inbox=join(options.stateRoot,'inbox');await mkdir(inbox,{recursive:true});
 const configPath=join(options.stateRoot,'settings.json');
 let settings:Settings={version:1,enabled:false,sources:[]},error:string|null=null;
 try{
  const stat=await lstat(configPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('INVALID_MCP_SETTINGS');
  const raw:unknown=JSON.parse(await readFile(configPath,'utf8'));
  if(!isRecord(raw)||raw.version!==1||typeof raw.enabled!=='boolean'||!Array.isArray(raw.sources)||raw.sources.length>16||!raw.sources.every(s=>isRecord(s)&&typeof s.id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(s.id)&&s.id!=='inbox'&&typeof s.path==='string'&&isLocalAbsolutePath(s.path)&&typeof s.name==='string'&&s.name.length<=200))throw Error('INVALID_MCP_SETTINGS');
  settings=raw as unknown as Settings;
 }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')error='MCP_SETTINGS_INVALID';}
 const instanceId=randomUUID(),store=new McpOperationStore(join(options.stateRoot,'operations.sqlite'));
 const sources=()=>[{id:'inbox',name:'Agent收件目录',path:inbox},...settings.sources];
 const importer=new McpAssetImporter({store,access:options.access,sources,stagingRoot:join(options.stateRoot,'staging')});
 let bridge:Awaited<ReturnType<typeof listenMcpBridge>>|undefined,closed=false,control=Promise.resolve();
 const approval=new McpApprovalService({store,access:options.access,isAllowed:c=>!!bridge?.clients().some(x=>x.id===c.id)&&!closed,confirm:options.confirm});
 const router=new McpToolRouter({...options,instanceId,store,importer,sources,executeProduction:(args,client)=>approval.execute(args,client)});
 async function enable(){
  if(bridge||closed)return;const identity=options.access().identity();
  bridge=await listenMcpBridge({directory:options.discoveryDir,instanceId,libraryId:identity.libraryId,name:options.name,workspacePath:options.workspacePath,getEpoch:()=>options.access().identity().connectionEpoch,handle:(name,args,client)=>router.call(name,args,client)});
  importer.recover();
 }
 async function status():Promise<Result<McpStatus>>{
  let libraryId:string|null=null;try{libraryId=options.access().identity().libraryId;}catch{/* Disconnected state is explicit. */}
  return ok({enabled:!!bridge,instanceId,libraryId,sources:sources(),clients:bridge?.clients()??[],clientConfig:{command:options.execPath,args:[options.stdioPath,'--discovery='+options.discoveryDir],env:{ELECTRON_RUN_AS_NODE:'1'}},error});
 }
 async function save(){await writeAtomicFile(configPath,JSON.stringify(settings,null,2),true);}
 function serialize<T>(work:()=>Promise<Result<T>>):Promise<Result<T>>{const next=control.then(work,work);control=next.then(()=>{},()=>{});return next;}
 async function configure(input:McpConfigureInput):Promise<Result<McpStatus>>{return serialize(async()=>{
  if(closed)return fail('MCP_STOPPING','应用正在关闭。');
  try{
   if(input.action==='enable'){if(error==='MCP_SETTINGS_INVALID')return fail(error,'MCP设置损坏，请保留原文件后检查。');await enable();settings.enabled=true;await save();error=null;}
   else if(input.action==='disable'){await bridge?.close();bridge=undefined;settings.enabled=false;await save();}
   else if(input.action==='revokeClient')bridge?.revoke(input.id);
   else if(input.action==='removeSource'){if(input.id==='inbox')return fail('IMPORT_SOURCE_REQUIRED','默认收件目录不能移除。');settings.sources=settings.sources.filter(s=>s.id!==input.id);await save();}
   return status();
  }catch{error='MCP_CONFIGURATION_FAILED';return fail(error,'无法更新MCP连接，请检查应用数据目录。');}
 });}
 async function addSource(path:string):Promise<Result<McpStatus>>{return serialize(async()=>{
  try{
   if(!isLocalAbsolutePath(path)||settings.sources.length>=16)return fail('INVALID_IMPORT_DIRECTORY','请选择有效本机目录，额外目录最多16个。');
   const stat=await lstat(path),canonical=await realpath(path);
   if(!stat.isDirectory()||stat.isSymbolicLink()||resolve(path).toLowerCase()!==canonical.toLowerCase())return fail('INVALID_IMPORT_DIRECTORY','目录不能包含链接。');
   if(!sources().some(s=>s.path.toLowerCase()===canonical.toLowerCase()))settings.sources.push({id:randomUUID(),name:canonical.split(/[\\/]/).pop()??'图片目录',path:canonical});
   await save();return status();
  }catch{return fail('INVALID_IMPORT_DIRECTORY','无法读取此图片目录。');}
 });}
 if(settings.enabled&&!error)try{await enable();}catch{error='MCP_START_FAILED';}
 return {status,configure,addSource,async close(){if(closed)return;closed=true;await control;await bridge?.close();bridge=undefined;await importer.close();store.close();}};
}
