import { useState } from 'react';
import type { ApproveGenerationInput, PreparedGeneration } from '../../../../../../packages/contracts/src/generation.ts';
import { Button, Badge, Field } from '../../../../../../packages/ui/src/controls.tsx';
import { Dialog } from '../../../../../../packages/ui/src/overlays.tsx';
import { useRuntime } from '../../services/runtime.tsx';
import { RuntimeFeedback } from '../../services/RuntimeFeedback.tsx';
export function GenerationApproval({ prepared, onClose, onApprove, summary, confirmLabel }: { prepared: PreparedGeneration; onClose(): void; onApprove?(input: ApproveGenerationInput): Promise<unknown>; summary?: React.ReactNode; confirmLabel?:string }) {
  const runtime = useRuntime(),
    [allowance, setAllowance] = useState(''),
    [budget, setBudget] = useState(''),
    [currency, setCurrency] = useState(prepared.currency ?? 'USD'),
    [acknowledge, setAcknowledge] = useState(false);
  const text = prepared.config.model.capabilities.outputKinds[0] === 'text';
  const video = prepared.config.model.capabilities.outputKinds[0] === 'video';
  const audio = prepared.config.model.capabilities.outputKinds[0] === 'audio';
  const micros = (v: string) => (/^\d+(\.\d{1,6})?$/.test(v) ? Math.round(Number(v) * 1000000) : NaN);
  const valid = [micros(allowance), micros(budget)].every(
    (n) => Number.isSafeInteger(n) && n > 0 && n <= 1000000000000,
  );
  return (
    <Dialog title="确认这一次生成" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          const input: ApproveGenerationInput = {
            preparedId: prepared.preparedId,
            approvedPlanHash: prepared.planHash,
            currency,
            allowanceMicros: micros(allowance),
            budgetLimitMicros: micros(budget),
            acknowledgeUnknown: acknowledge,
            executionOwner: prepared.executionOwner,
            runId: prepared.runId,
          };
          const result = onApprove ? await onApprove(input) : await runtime.command('generation.approveAndEnqueue', input);
          if (result) onClose();
        }}
      >
        <div className="approval-summary">
          <Badge>{video ? `本次生成 · ${prepared.config.parameters.duration} 秒视频` : audio ? '本次生成 · 配音音频' : text ? '本次生成 · 有界纯文本' : '本次生成 · 1 张图片'}</Badge>
          <h3>{prepared.config.model.name}</h3>
          <p>
            {prepared.config.model.modelId} · 模型 v{prepared.config.model.revision} / 预设 v
            {prepared.config.profile.revision}
          </p>
          <p>接收方：{prepared.config.connection.baseUrl}</p>
        </div>
        <>{summary}{summary ? <details><summary>查看冻结请求全文</summary><div className="frozen-prompt">{prepared.prompt}</div></details> : <div className="frozen-prompt">{prepared.prompt}</div>}</>
        <p className="hint">
          参数：{JSON.stringify(prepared.config.parameters)} · 有效期至{' '}
          {new Date(prepared.expiresAt).toLocaleTimeString('zh-CN')}
        </p>
        {prepared.referenceImages?.map((r,i)=><p key={i}>参考 {i+1} · {r.role} · {r.mime} · {r.width}×{r.height} · {JSON.stringify(r.ref)} · SHA256 {r.hash}</p>)}
        <div className="cost-line">
          <span>预估费用 · 非实际账单</span>
          <strong>
            {prepared.estimateMicros === null
              ? '未知，不是零费用'
              : `${prepared.currency} ${prepared.estimateMicros / 1000000}`}
          </strong>
        </div>
        <div className="form-grid">
          <Field label="单次风险额度">
            <input
              type="text"
              inputMode="decimal"
              value={allowance}
              onChange={(e) => setAllowance(e.target.value)}
              placeholder="例如 1.00"
              required
            />
          </Field>
          <Field label="项目预算上限">
            <input
              type="text"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="例如 5.00"
              required
            />
          </Field>
        </div>
        <Field label="批准币种">
          <input
            value={currency}
            readOnly={prepared.currency !== null}
            pattern="[A-Z]{3}"
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </Field>
        <label className="check">
          <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
          我理解费用未知，额度不能限制供应商实际账单
        </label>
        <p className="warning-text">本地额度只控制提交。提交不明时请核实原任务；不要重新批准以代替重试。</p>
        <RuntimeFeedback />
        <div className="dialog-actions">
          <Button onClick={onClose}>暂不生成</Button>
          <Button
            type="submit"
            tone="primary"
            disabled={
              !valid ||
              (prepared.estimateMicros === null && !acknowledge) ||
              runtime.busy ||
              runtime.pending ||
              !runtime.online
            }
          >
            {confirmLabel ?? (video ? '批准并生成视频' : audio ? '批准并生成音频' : text ? '批准并生成文本' : '批准并生成一张')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
