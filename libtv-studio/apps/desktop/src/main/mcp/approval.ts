import {stableHash,type McpOperationStore} from './operation-store.ts';
import {mcpCommandId,publicWorkflow} from './router.ts';
import {validateTool} from './tools.ts';
import type {McpEngineAccess} from './access.ts';
import type {McpClientView,McpScope} from '../../../../../packages/contracts/src/mcp.ts';
import type {WorkflowApproveInput,WorkflowView} from '../../../../../packages/contracts/src/workflows.ts';
import type {ShotProductionView} from '../../../../../packages/contracts/src/shot-production.ts';
import type {CommandReceipt} from '../../../../../packages/contracts/src/commands.ts';
import {ok,fail,type Result,type AppError} from '../../../../../packages/contracts/src/result.ts';
export interface McpApprovalRequest {clientName:string;productionId:string;planId:string;planHash:string;models:string[];steps:number;currency:string;estimateMicros:number|null;budgetLimitMicros:number;stepAllowanceMicros:number;expiresAt:number}
interface Action {hash:string;state:'awaiting'|'approved'|'declined'|'completed';payload:WorkflowApproveInput;summary:McpApprovalRequest;result?:unknown}
class ApprovalFailure extends Error{constructor(readonly detail:AppError){super(detail.code);}}
function take<T>(r:Result<unknown>):T{if(!r.ok)throw new ApprovalFailure(r.error);return r.value as T;}
export class McpApprovalService {
 private flights=new Map<string,{hash:string;promise:Promise<Result<unknown>>}>();
 constructor(private options:{store:McpOperationStore;access():McpEngineAccess;isAllowed(client:McpClientView):boolean;confirm(request:McpApprovalRequest):Promise<boolean>}){}
 execute(raw:Record<string,unknown>,client:McpClientView):Promise<Result<unknown>>{
  const args=validateTool('production_execute',raw);if(!args)return Promise.resolve(fail('INVALID_INPUT','执行参数无效。'));
  const {instanceId:_route,...intent}=args;
  const id=mcpCommandId('production_execute',args.scope,args.requestId),hash=stableHash(intent),running=this.flights.get(id);
  if(running)return running.hash===hash?running.promise:Promise.resolve(fail('COMMAND_ID_REUSED','此请求ID已用于不同执行参数。'));
  const promise=this.run(id,hash,args,client).finally(()=>this.flights.delete(id));this.flights.set(id,{hash,promise});return promise;
 }
 private async run(id:string,hash:string,args:Record<string,unknown>,client:McpClientView):Promise<Result<unknown>>{
  try{
   const scope=args.scope as McpScope,access=this.options.access();
   if(access.identity().libraryId!==scope.libraryId)return fail('WRONG_LIBRARY','当前连接不属于此资料库。');
   take(await access.query('subproject.read',{projectId:scope.projectId,subprojectId:scope.subprojectId},scope));
   let record=this.options.store.action<Action>(id);
   if(record&&record.hash!==hash)return fail('COMMAND_ID_REUSED','同一个请求ID已用于不同的执行参数。');
   if(record&&['declined','completed'].includes(record.state))return ok(record.result);
   const existing=take<CommandReceipt<WorkflowView>|null>(await access.query('command.receipt',{commandId:id},scope));
   if(existing){const result={submitted:true,workflow:publicWorkflow(existing.result)};if(record){record.state='completed';record.result=result;this.options.store.saveAction(id,record);}return ok(result);}
   if(!this.options.isAllowed(client))return fail('MCP_AUTHORIZATION_REVOKED','此MCP连接已断开或停用。');
   if(!record){
    const production=take<ShotProductionView>(await access.query('shots.production',{productionId:args.productionId},scope));
    if(!production.workflowId)return fail('WORKFLOW_NOT_PREPARED','请先准备并关联执行计划。');
    const w=take<WorkflowView>(await access.query('workflow.read',{workflowId:production.workflowId},scope));
    if(w.state!=='prepared')return ok({submitted:true,workflow:publicWorkflow(w)});
    const currency=w.plan.currency??'CNY',budgetLimitMicros=Number(args.budgetLimitMicros),stepAllowanceMicros=Number(args.stepAllowanceMicros);
    if(w.plan.steps.length*stepAllowanceMicros>budgetLimitMicros)return fail('BUDGET_TOO_SMALL','总上限不能低于每步授权额之和。');
    const summary:McpApprovalRequest={clientName:client.name,productionId:production.productionId,planId:w.plan.planId,planHash:w.plan.planHash,models:w.plan.steps.map(s=>s.template.config.model.modelId),steps:w.plan.steps.length,currency,estimateMicros:w.plan.estimateMicros,budgetLimitMicros,stepAllowanceMicros,expiresAt:w.plan.expiresAt};
    record={hash,state:'awaiting',summary,payload:{planId:w.plan.planId,approvedPlanHash:w.plan.planHash,currency,budgetLimitMicros,stepAllowances:Object.fromEntries(w.plan.steps.map(s=>[s.stepId,stepAllowanceMicros])),acknowledgeUnknown:true,executionOwner:w.plan.executionOwner,runId:w.plan.runId}};
    this.options.store.saveAction(id,record);
   }
   if(record.summary.expiresAt<=Date.now())return fail('PLAN_EXPIRED','固定计划已过期，请重新准备。');
   if(record.state!=='approved'){
    const approved=await this.options.confirm(record.summary);
    if(!this.options.isAllowed(client))return fail('MCP_AUTHORIZATION_REVOKED','确认期间连接已停用，本次未提交。');
    if(!approved){record.state='declined';record.result={submitted:false,state:'declined',planId:record.summary.planId};this.options.store.saveAction(id,record);return ok(record.result);}
    record.state='approved';this.options.store.saveAction(id,record);
   }
   if(!this.options.isAllowed(client))return fail('MCP_AUTHORIZATION_REVOKED','连接已停用，本次未提交。');
   const receipt=take<CommandReceipt<WorkflowView>>(await access.execute('workflow.approveAndEnqueue',record.payload,id,scope));
   record.result={submitted:true,workflow:publicWorkflow(receipt.result)};record.state='completed';this.options.store.saveAction(id,record);return ok(record.result);
  }catch(e){return e instanceof ApprovalFailure?{ok:false,error:e.detail}:fail('MCP_CONFIRMATION_UNAVAILABLE','桌面确认暂不可用，原请求保留，可核对后继续。');}
 }
}
