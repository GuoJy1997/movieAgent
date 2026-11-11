import { useState } from 'react';
import { Button, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';

/** Summaries are scoped by project/shot; opening details never executes their plan. */
export function DialogueBatchHistory({ projectId, shotId }: { projectId: string; shotId: string }) {
  const runtime = useRuntime(), [before, setBefore] = useState<string | undefined>(), [selected, setSelected] = useState('');
  const query = useWorkspaceQuery('dialogue.productions', { projectId, shotId, ...(before ? { beforePlanId: before } : {}), limit: 10 });
  const detail = useWorkspaceQuery('dialogue.production', { projectId, planId: selected }, !!selected), tasks = useWorkspaceQuery('task.list', {});
  const locked = runtime.busy || runtime.pending || !runtime.online;
  return <details><summary>原批次历史与恢复</summary><QueryState loading={query.isLoading} error={query.error} />
    {query.data?.productions.map(batch => <article className="creation-reference dialogue-summary-item" key={batch.planId}><p>{batch.planId} · {batch.purpose === 'audition' ? '试镜' : '正式制作'} · {batch.state} · 预设 {batch.profileRef.id} v{batch.profileRef.revision}</p><Button onClick={() => setSelected(batch.planId)}>查看批次 {batch.planId}</Button>
      {batch.tasks.map(item => { const task = tasks.data?.tasks.find(task => task.taskId === item.task?.taskId); return <div key={item.dialogueId}><p>对白 {item.dialogueId} · 原任务 {item.task?.taskId ?? '未提交'} · {task?.state ?? item.diagnostic ?? '未入队'}{task?.cancelStatus === 'unsupported' ? ' · 云端不支持取消，可能继续计费' : ''}</p>
        {['SUBMISSION_UNKNOWN', 'RECONCILE_REQUIRED'].includes(task?.state ?? '') && <p role="alert">提交结果未知。禁止重新生成或换键重发；仅支持已验证协议在7天内核对原提交。</p>}
        {detail.data?.plan.planId === batch.planId && detail.data.plan.items.some(value => value.prepared.adapterId === 'sync-lipsync-v2') && task && ['SUBMISSION_UNKNOWN', 'RECONCILE_REQUIRED'].includes(task.state) && <Button disabled={locked} onClick={() => void runtime.command('dialogue.reconcileSubmission', { projectId, taskId: task.taskId, executionOwner: batch.executionOwner })}>核对原提交 {task.taskId}</Button>}
      </div>; })}
      {batch.state !== 'stopped' && <Button tone="danger" disabled={locked} onClick={() => void runtime.command('dialogue.stopProduction', { projectId, planId: batch.planId, executionOwner: batch.executionOwner })}>停止原批次 {batch.planId}</Button>}
    </article>)}
    {query.data?.nextBeforePlanId && <Button onClick={() => { setBefore(query.data!.nextBeforePlanId!); setSelected(''); }}>较早批次</Button>}{before && <Button onClick={() => { setBefore(undefined); setSelected(''); }}>最新批次</Button>}
    <QueryState loading={detail.isLoading} error={detail.error} />{detail.data && <section className="creation-card form-stack"><h4>原批次固定输入 {detail.data.plan.planId}</h4>{detail.data.plan.items.map(item => <div key={item.dialogue.id}><p>镜头 {item.dialogue.shotRef.id} v{item.dialogue.shotRef.revision} · 对白 {item.dialogue.id} v{item.dialogue.revision}</p>{item.dialogue.turns.map(turn => <p key={turn.turnId}>声音 {turn.voiceRef.id} v{turn.voiceRef.revision} · {turn.emotion} · {turn.mode} · {turn.text}</p>)}</div>)}<p className="hint">历史状态与协议成功均不代表人工质量通过；结果仍需逐镜头审核和明确采用。</p></section>}
  </details>;
}
