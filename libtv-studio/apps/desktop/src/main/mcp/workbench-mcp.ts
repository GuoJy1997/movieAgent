import {dialog,type BrowserWindow} from 'electron';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {EngineHost} from '../engine-host.ts';
import type {LocalConnection} from '../local-connection.ts';
import type {DirectoryProject} from '../../../../../packages/contracts/src/directory-projects.ts';
import {parseCommand} from '../../../../../packages/contracts/src/commands.ts';
import {parseQuery} from '../../../../../packages/contracts/src/queries.ts';
import {ok,fail,type Result} from '../../../../../packages/contracts/src/result.ts';
import {createMcpService} from './service.ts';
import type {McpEngineAccess} from './access.ts';
import {RecentProjects} from '../recent-projects.ts';
import {validateWorkspace} from '../workspace-bootstrap.ts';
import {spawnDesktop} from '../project-launcher.ts';
export async function startWorkbenchMcp(options:{stateRoot:string;launcherData:string;modelConfig:string;execPath:string;stdioPath:string;context():{host:EngineHost;connection:LocalConnection;window:BrowserWindow;project:DirectoryProject|null;root:string};ensureCurrent():Promise<Result<void>>}){
 const initial=options.context();let confirming=false;
 const access=():McpEngineAccess=>{
  const {host,connection}=options.context(),identity={libraryId:host.identity.libraryId,connectionEpoch:connection.connectionEpoch};
  return {
   identity:()=>identity,
   execute:async(kind,payload,commandId,scope)=>{
    const parsed=parseCommand({schemaVersion:1,...identity,kind,payload,commandId,scope:{projectId:scope.projectId,subprojectId:scope.subprojectId}});if(!parsed.ok)return parsed;
    if(['shots.prepareProduction','shots.applyProduction','workflow.prepare','workflow.approveAndEnqueue'].includes(kind)){
     const receipt=await connection.query({schemaVersion:1,...identity,queryId:randomUUID(),kind:'command.receipt',payload:{commandId}});if(!receipt.ok)return receipt;
     if(!receipt.value){const synced=await options.ensureCurrent();if(!synced.ok)return synced;}
    }
    return connection.execute(parsed.value);
   },
   query:async(kind,payload,scope)=>{const parsed=parseQuery({schemaVersion:1,...identity,queryId:randomUUID(),kind,payload,...(scope?{scope:{projectId:scope.projectId,subprojectId:scope.subprojectId}}:{})});return parsed.ok?connection.query(parsed.value):parsed;},
   registerGrant:grant=>host.registerFileGrant(grant),readMedia:input=>host.readMedia(input)
  };
 };
 return createMcpService({
  ...options,discoveryDir:join(options.launcherData,'mcp-instances'),access,
  fixedProjectId:initial.project?.manifest.binding?.projectId,
  workspacePath:initial.project?.root??initial.root,name:initial.project?.manifest.name??'MovieAgent工作区',
  async listWorkspaces(){const r=await RecentProjects.open(join(options.launcherData,'recent-projects.json'));return r.ok?r.value.list():r;},
  async openWorkspace(workspaceId){
   const registry=await RecentProjects.open(join(options.launcherData,'recent-projects.json'));if(!registry.ok)return registry;
   const found=await registry.value.find(workspaceId);if(!found.ok)return found;
   const checked=await validateWorkspace(found.value.root,options.launcherData);if(!checked.ok)return checked;
   const child=spawnDesktop(['--workspace-child','--project-root='+checked.value.root,'--launcher-data='+options.launcherData,'--model-config='+options.modelConfig]);
   return new Promise(resolve=>{child.once('spawn',()=>resolve(ok({opened:true,workspaceId,root:checked.value.root,next:'Open the workspace and enable MCP, then use system_instances.'})));child.once('error',()=>resolve(fail('WORKSPACE_START_FAILED','无法打开已登记工作目录。')));});
  },
  async createProject(name,commandId){
   const c=options.context();if(c.project)return fail('DIRECTORY_PROJECT_FIXED','请从启动器新建独立项目目录。');
   return c.connection.execute({schemaVersion:1,libraryId:c.host.identity.libraryId,connectionEpoch:c.connection.connectionEpoch,commandId,kind:'project.create',payload:{name}});
  },
  async confirm(request){
   if(confirming)throw Error('APPROVAL_BUSY');const {window}=options.context();if(window.isDestroyed())throw Error('APPROVAL_UNAVAILABLE');confirming=true;
   try{
    const amount=(v:number)=>v/1e6+' '+request.currency;
    const reply=await dialog.showMessageBox(window,{type:'question',title:'MCP 请求生成视频',message:request.clientName+' 请求执行 '+request.steps+' 个生成步骤',detail:[
     '模型：'+request.models.map(m=>m.replace(/[\r\n\t]/g,' ').slice(0,120)).join('、'),
     '预估费用：'+(request.estimateMicros===null?'未知':amount(request.estimateMicros)),
     '总授权上限：'+amount(request.budgetLimitMicros)+'；每步上限：'+amount(request.stepAllowanceMicros),
     '固定计划：'+request.planId,'校验：'+request.planHash,
     '批准后按此计划提交。已受理任务即使取消也可能计费。'
    ].join('\n'),buttons:['批准并执行','取消'],defaultId:1,cancelId:1,noLink:true});
    return reply.response===0;
   }finally{confirming=false;}
  }
 });
}
