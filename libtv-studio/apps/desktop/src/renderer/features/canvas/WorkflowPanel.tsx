import { useState } from 'react';
import type { WorkflowState, WorkflowStepState } from '../../../../../../packages/contracts/src/workflows.ts';
import { Badge, Button, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime,useWorkspaceQuery } from '../../services/runtime.tsx';
import { TaskDetail } from '../tasks/TaskDetail.tsx';
const states:Record<WorkflowState,string>={prepared:'等待批准',running:'计划运行中',stopping:'正在停止 · 核实已提交任务',succeeded:'计划已完成',failed:'计划失败',stopped:'计划已停止',needs_attention:'计划需要核实'};
const steps:Record<WorkflowStepState,string>={waiting:'等待依赖',queued:'等待调度',running:'正在运行',succeeded:'已完成',blocked:'依赖阻断',failed:'失败',stopped:'已停止',needs_attention:'提交不明 · 核实原任务'};
export function WorkflowPanel({canvasId}:{canvasId?:string}) {
 const query=useWorkspaceQuery('workflow.list',{}),tasks=useWorkspaceQuery('task.list',{}),runtime=useRuntime(),[task,setTask]=useState<string|null>(null);
 const workflows=query.data?.workflows.filter(w=>(!canvasId||w.canvasId===canvasId)&&w.state!=='prepared')??[];
 return <section className="workflow-panel" aria-label="执行计划"><QueryState loading={query.isLoading} error={query.error}/>{workflows.map(w=><details key={w.workflowId} open><summary><strong>{states[w.state]}</strong> · {w.steps.length} 步 <Badge>{w.plan.currency??tasks.data?.tasks.find(t=>w.steps.some(s=>s.task?.taskId===t.taskId))?.currency??'批准额度'} 预留 {w.reservationMicros/1e6}</Badge></summary><p className="hint">冻结画布修订 {w.plan.observedRevision}</p><details><summary>计划身份与输入追溯</summary><pre>{JSON.stringify(w.plan,null,2)}</pre></details>{w.steps.map((s,i)=><div className="workflow-step-status" key={s.stepId}><span>{i+1}. {w.plan.steps.find(p=>p.stepId===s.stepId)?.template.config.model.name} · {steps[s.state]}</span>{s.errorCode&&<small>{s.errorCode}</small>}{s.task&&<Button onClick={()=>setTask(s.task!.taskId)}>查看步骤任务 {i+1}</Button>}</div>)}{['running','stopping','needs_attention'].includes(w.state)&&<><Button disabled={!runtime.online||runtime.busy||runtime.pending||w.state==='stopping'} onClick={()=>void runtime.command('workflow.stop',{workflowId:w.workflowId})}>停止后续步骤</Button><p className="hint">停止后不再创建任务。已接单或提交不明任务仍核实原 ID，不能撤回云端生成。</p></>}</details>)}{task&&<TaskDetail taskId={task} onClose={()=>setTask(null)}/>}</section>;
}
