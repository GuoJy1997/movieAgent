import { useState } from 'react';
import { Button, Badge, Empty, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { Dialog } from '../../../../../../packages/ui/src/overlays.tsx';
import { useRuntime,useWorkspaceQuery } from '../../services/runtime.tsx';
import { MediaPreview } from '../assets/MediaPreview.tsx';
import { RuntimeFeedback } from '../../services/RuntimeFeedback.tsx';
import { taskLabel } from './task-labels.ts';
const money=(value:number|null,currency:string)=>value===null?'未知':`${currency} ${(value/1e6).toFixed(6).replace(/0+$/,'').replace(/\.$/,'')}`;
export function TaskDetail({ taskId, onClose }: { taskId: string; onClose(): void }) {
  const query = useWorkspaceQuery('task.read', { taskId }),
    workflows=useWorkspaceQuery('workflow.list',{}),
    assets = useWorkspaceQuery('asset.search', {}),
    runtime = useRuntime();
  const [saving, setSaving] = useState(false),
    [name, setName] = useState('生成原件'),
    [versionTarget, setVersionTarget] = useState(''),
    [savedNow, setSaved] = useState(false);
  const latestAssets = (assets.data?.assets ?? []).filter((a, _, all) => !all.some(other => other.ref.assetId === a.ref.assetId && other.ref.version > a.ref.version));
  const task = query.data;
  const savedAssets =
    assets.data?.assets.filter(
      (a) =>
        a.sourceArtifactRef?.artifactId === task?.artifactRef?.artifactId &&
        a.sourceArtifactRef?.libraryId === task?.libraryId,
    ) ?? [];
  const saved = savedNow || savedAssets.length > 0;
  const locked = !runtime.online || runtime.busy || runtime.pending;
  return (
    <Dialog title="任务详情" onClose={onClose} wide>
      <QueryState loading={query.isLoading} error={query.error} />
      {task && (
        <>
          <div className="task-detail-grid">
            <div className="large-preview">
              {task.artifactRef ? (
                <MediaPreview media={task.artifactRef} original />
              ) : (
                <Empty title={taskLabel[task.state]}>供应方没有提供可用进度百分比；已接单任务会继续核实原任务。</Empty>
              )}
            </div>
            <div className="task-facts">
              <Badge>{taskLabel[task.state]}</Badge>
              <dl>
                <dt>云端撤回</dt><dd>当前适配器不支持撤回已接单任务，云端可能继续执行。</dd>
                <dt>供应方状态</dt>
                <dd>
                  {
                    {
                      unsubmitted: '尚未提交',
                      submitting: '正在提交',
                      accepted: '已接单',
                      unknown: '未知，不能重复提交',
                      completed: '已完成',
                      rejected: '已拒绝',
                    }[task.providerState]
                  }
                </dd>
                <dt>原件收存</dt>
                <dd>
                  {
                    {
                      pending: '等待输出',
                      collecting: '收存中',
                      durable: '原件已保存',
                      retryable_failure: '收存失败，可重试收存',
                      unrecoverable: '原件不可恢复',
                    }[task.collectionState]
                  }
                </dd>
                <dt>预估费用</dt>
                <dd>{money(task.estimateMicros, task.currency)}</dd>
                <dt>实际账单</dt>
                <dd>{money(task.reportedActualMicros, task.currency)}</dd>
                <dt>本地预留额度</dt>
                <dd>
                  {money(task.reservationMicros, task.currency)} ·{' '}
                  {task.settlementStatus === 'unspent' ? '已确认未提交' : '待核实，不代表实际扣费'}
                </dd>
                <dt>取消请求</dt>
                <dd>
                  {task.cancelStatus === 'unsupported'
                    ? '供应方不支持撤回，费用仍需核实'
                    : task.cancelRequested
                      ? '已请求'
                      : '未请求'}
                </dd>
                <dt>核实能力</dt>
                <dd>
                  {task.providerState === 'completed'
                    ? '结果已确认'
                    : task.reconcileStatus === 'unsupported'
                    ? '当前协议不支持远端核实'
                    : task.reconcileStatus === 'pending'
                      ? '等待核实'
                      : '尚未请求'}
                </dd>
              </dl>
            </div>
          </div>
          <details className="task-input-trace"><summary>输入版本追溯</summary><p>任务 {task.taskId}</p><pre>{JSON.stringify(workflows.data?.workflows.flatMap(w=>w.steps.filter(s=>s.task?.taskId===taskId).map(s=>({planId:w.workflowId,step:w.plan.steps.find(p=>p.stepId===s.stepId),observations:w.plan.observations,externalInputs:w.plan.externalInputs})))??[],null,2)}</pre></details>
          {task.errorCode && (
            <p className="alert" role="alert">
              {task.errorCode}。请检查连接和任务状态；收存重试不会重新请求生成。
            </p>
          )}
          {saved && (
            <p role="status" className="success-note">
              已加入资产库 · {savedAssets.map((a) => a.name).join('、') || name}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              disabled={
                locked || task.state === 'SUCCEEDED' || task.state === 'CANCELLED' || task.state === 'FAILED'
              }
              onClick={() => void runtime.command('task.requestCancel', { taskId })}
            >
              请求取消
            </Button>
            <Button
              disabled={locked || !['unknown', 'accepted', 'submitting'].includes(task.providerState)}
              onClick={() => void runtime.command('task.reconcile', { taskId })}
            >
              核实原任务
            </Button>
            <Button
              disabled={locked || task.collectionState !== 'retryable_failure'}
              onClick={() => void runtime.command('task.retryCollection', { taskId })}
            >
              重试收存
            </Button>
            <Button
              tone="primary"
              disabled={locked || !task.artifactRef || saved}
              onClick={() => setSaving(true)}
            >
              加入资产库
            </Button>
          </div>
          {saving && (
            <form
              className="save-asset-form"
              onSubmit={async (e) => {
                e.preventDefault();
                // Keep the explicitly chosen precondition even if a refresh discovers a newer version.
                const [targetId, targetVersion] = versionTarget.split(':');
                const target = versionTarget ? { assetId: targetId!, expectedVersion: Number(targetVersion) } : null;
                if (
                  task.artifactRef &&
                  (await runtime.command('asset.saveArtifact', { artifactRef: task.artifactRef, name, ...(target ?? {}) }))
                ) {
                  setSaved(true);
                  setSaving(false);
                }
              }}
            >
              <Field label="保存位置">
                <select aria-label="保存位置" value={versionTarget} onChange={event => setVersionTarget(event.target.value)}>
                  <option value="">新建资产</option>
                  {versionTarget && !latestAssets.some(a => `${a.ref.assetId}:${a.ref.version}` === versionTarget) && <option value={versionTarget}>此前选择的版本已变化，请重新选择</option>}
                  {latestAssets.map(a => <option key={a.ref.assetId} value={`${a.ref.assetId}:${a.ref.version}`}>{a.name} · 新版本（基于 v{a.ref.version}）</option>)}
                </select>
              </Field>
              <Field label="资产名称" hint={versionTarget ? '新增版本保留目标资产名称；可在资产库修改名称。' : undefined}>
                <input
                  autoFocus
                  disabled={Boolean(versionTarget)}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  required
                />
              </Field>
              <Button type="submit" tone="primary" disabled={locked}>
                保存资产
              </Button>
            </form>
          )}
          <RuntimeFeedback />
        </>
      )}
    </Dialog>
  );
}
