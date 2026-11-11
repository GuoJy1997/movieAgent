import { useState } from 'react';
import { Button, Badge, Empty, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useWorkspaceQuery } from '../../services/runtime.tsx';
import { WorkflowPanel } from '../canvas/WorkflowPanel.tsx';
import { TaskDetail } from './TaskDetail.tsx';
import { taskLabel } from './task-labels.ts';
const money = (value: number | null, currency: string) =>
  value === null
    ? '未知'
    : `${currency} ${(value / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
export function TaskPanel() {
  const tasks = useWorkspaceQuery('task.list', {}),
    [selected, setSelected] = useState<string | null>(null);
  return (
    <section className="page tasks-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">ACTIVITY</p>
          <h1>任务</h1>
          <p>退出会停止本机编排和收存。云端任务可能继续；取消须在任务详情中单独请求。</p>
        </div>
        <Badge>当前资料库</Badge>
      </header>
      <QueryState loading={tasks.isPending} error={tasks.error} />
      {tasks.isSuccess && tasks.data.tasks.length === 0 && (
        <Empty title="还没有生成任务">在画布准备输入，查看快照，再明确批准一次生成。</Empty>
      )}
      <WorkflowPanel />
      <div className="task-list">
        {tasks.data?.tasks.map((task, index) => (
          <article className="task-row" key={task.taskId}>
            <span className={`task-icon ${task.state === 'SUCCEEDED' ? 'done' : ''}`}>
              {task.state === 'SUCCEEDED' ? '✓' : '◇'}
            </span>
            <div className="grow">
              <h3>
                媒体生成 <span className="muted">#{String(index + 1).padStart(2, '0')}</span>
              </h3>
              <p>{taskLabel[task.state]}{task.concurrencyReleasedAt ? task.providerState === 'unknown' ? ' · 已解除并发占用，账单待核实' : ['accepted','submitting'].includes(task.providerState) ? ' · 原请求已获进展，重新计入并发' : ' · 曾手动解除占用' : ''}</p>
              {task.errorCode && <small className="warning-text">{task.errorCode}</small>}
            </div>
            <div className="task-cost">
              <span>待核实占用</span>
              <strong>{money(task.reservationMicros, task.currency)}</strong>
            </div>
            <Button onClick={() => setSelected(task.taskId)}>查看任务</Button>
          </article>
        ))}
      </div>
      {selected && <TaskDetail taskId={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
