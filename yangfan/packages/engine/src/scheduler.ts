import type { LibraryHandle } from '../../storage/src/database.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { TaskView } from '../../contracts/src/generation.ts';
import { terminal } from '../../domain/src/task-state.ts';
import type { generationFor } from './generation-service.ts';
import { recoverTasks } from './task-recovery.ts';
export function schedulerFor(library: LibraryHandle, generation: ReturnType<typeof generationFor>) {
  const running = new Map<string, Promise<Result<TaskView>>>();
  let recovering: Promise<Result<void>> | undefined, waking: Promise<Result<void>> | undefined, closeWork: Promise<void> | undefined;
  let active = false, closing = false, paused = false, resumeActive = false, timer: ReturnType<typeof setTimeout> | undefined;
  async function dispatch(attemptId: string): Promise<Result<TaskView>> {
    const own = library.checkOwnership(); if (!own.ok) return own;
    const row = generation.attempt(attemptId); if (!row) return fail('TASK_NOT_FOUND', '任务不存在。');
    const task = generation.read(row.task_id as string); if (!task.ok) return task;
    if (task.value.providerState === 'completed') return generation.collect(task.value.taskId);
    if (terminal(task.value)) return task;
    if (row.intent_json) return generation.reconcile(task.value.taskId);
    if (closing || paused) return fail('SCHEDULER_CLOSED', '调度器已停止领取任务。');
    if (!generation.options) return fail('PROVIDER_UNAVAILABLE', '未配置图像适配器。');
    const lease = generation.claim(attemptId); if (!lease.ok) return lease;
    const stopRenewing = generation.keepLeaseAlive(attemptId, lease.value.leaseToken);
    try {
      // Known local file failures must precede durable dispatch intent and any network request.
      const prepared = generation.preparedFor(attemptId); if (!prepared.ok) return prepared;
      const local = await generation.verifyLocalInputs(prepared.value);
      if (!local.ok) return generation.recordSchedulerFailure(attemptId, local.error.code);
      const permit = await generation.acquireDispatch(attemptId, lease.value.leaseToken); if (!permit.ok) return permit;
      if (closing || paused) return fail('SCHEDULER_CLOSED', '调度器已停止领取，未发送供应商请求。');
      const latest = generation.read(task.value.taskId);
      if (!latest.ok) return latest;
      if (latest.value.cancelRequested) return latest;
      const current = generation.checkCurrent(permit.value.prepared); if (!current.ok) return current;
      const adapter = generation.adapterFor(permit.value.prepared.adapterId);
      if (!adapter) return fail('PROVIDER_UNAVAILABLE', '固定适配器不可用。');
      const valid = adapter.validate(permit.value.prepared); if (!valid.ok) return valid;
      let outcome;
      try { outcome = await adapter.submit(valid.value, { ...generation.options.context, attemptId, outputStagingId: permit.value.outputStagingId, clientRequestId: permit.value.clientRequestId, requestHash: permit.value.requestHash, retries: 0 }); }
      catch { outcome = { kind: 'unknown' as const }; }
      const result = generation.recordOutcome(attemptId, lease.value.leaseToken, outcome, adapter.adapterId);
      return result.ok && result.value.providerState === 'completed' ? generation.collect(task.value.taskId) : result;
    } finally { stopRenewing(); generation.release(attemptId, lease.value.leaseToken); }
  }
  function run(attemptId: string): Promise<Result<TaskView>> {
    const existing = running.get(attemptId); if (existing) return existing;
    if (closing || paused) return Promise.resolve(fail('SCHEDULER_CLOSED', '调度器已停止领取。'));
    const work = dispatch(attemptId).finally(() => { running.delete(attemptId); }); running.set(attemptId, work); return work;
  }
  async function automaticRun(attemptId: string): Promise<Result<TaskView>> {
    const result = await run(attemptId);
    if (result.ok || closing || paused) return result;
    const retryable = ['DISK_CAPACITY', 'CONCURRENCY_LIMIT', 'LEASE_BUSY'].includes(result.error.code);
    return generation.recordSchedulerFailure(attemptId, result.error.code, retryable);
  }
  async function processWake(): Promise<Result<void>> {
    if (!active || closing) return ok(undefined);
    if (timer) clearTimeout(timer);
    const own = library.checkOwnership(); if (!own.ok) return own;
    // Paid outputs get collection priority before any new provider POST.
    const tasks = generation.list().tasks.sort((a, b) => Number(b.providerState === 'completed') - Number(a.providerState === 'completed'));
    for (const task of tasks) {
      if (closing || paused) break;
      if (terminal(task)) continue;
      const job = library.db.prepare('SELECT * FROM scheduler_job WHERE attempt_id=?').get(task.attemptId)!;
      if (task.providerState !== 'completed' && (job.deadline as number) <= generation.now()) {
        const expired = generation.recordSchedulerFailure(task.attemptId, 'SCHEDULER_DEADLINE_EXCEEDED'); if (!expired.ok) return expired;
        continue;
      }
      if (task.reconcileStatus === 'unsupported' || (job.next_run_at as number) > generation.now()) continue;
      const result = await automaticRun(task.attemptId);
      if (closing || paused) break;
      if (!result.ok) return result;
      if (terminal(result.value)) continue;
      const polls = Number(job.polls) + 1, delay = Math.min(60000, 1000 * 2 ** Math.min(polls, 6));
      library.db.prepare('UPDATE scheduler_job SET polls=?,next_run_at=? WHERE attempt_id=?').run(polls, generation.now() + delay + Math.floor(Math.random() * delay / 10), task.attemptId);
    }
    if (active && !closing) { timer = setTimeout(() => { void wake(); }, 1000); timer.unref(); }
    return ok(undefined);
  }
  function wake(): Promise<Result<void>> {
    if (waking) return waking;
    const work = processWake().finally(() => { waking = undefined; }); waking = work; return work;
  }
  function recover(): Promise<Result<void>> {
    if (closing || paused) return Promise.resolve(fail('SCHEDULER_CLOSED', '调度器已停止领取。'));
    if (recovering) return recovering;
    const work = recoverTasks(generation, automaticRun, () => closing || paused).finally(() => { recovering = undefined; }); recovering = work; return work;
  }
  return {
    claim: generation.claim, run, recover, wake,
    async pause(): Promise<void> { if (!paused) resumeActive = active; paused = true; active = false; if (timer) clearTimeout(timer); await Promise.allSettled([...running.values(), recovering, waking]); await generation.drain(); },
    resume(): void { if (!closing) { paused = false; active = resumeActive; if (active) void wake(); } },
    async start(): Promise<Result<void>> { if (closing || paused) return fail('SCHEDULER_CLOSED', '调度器已停止领取。'); active = true; const result = await recover(); return result.ok ? wake() : result; },
    close(): Promise<void> {
      if (closeWork) return closeWork;
      closing = true; active = false; if (timer) clearTimeout(timer);
      closeWork = Promise.allSettled([...running.values(), recovering, waking]).then(async () => { await generation.drain(); });
      return closeWork;
    },
  };
}
