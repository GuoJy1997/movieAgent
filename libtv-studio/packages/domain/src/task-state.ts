import type { TaskView } from '../../contracts/src/generation.ts';
/** A cancellation is an intent. Only unsubmitted queued work is known to be unspent. */
export function requestCancellation(task: TaskView): TaskView {
  if (task.providerState === 'unsubmitted') return { ...task, state: 'CANCELLED', cancelRequested: true, cancelStatus: 'queued', reservationMicros: 0, settlementStatus: 'unspent' };
  return { ...task, cancelRequested: true, cancelStatus: 'unsupported' };
}
export const terminal = (task: TaskView) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.state);
/** An automatic dispatch failure has different budget semantics before and after durable intent. */
export function schedulerFailure(task: TaskView, hasIntent: boolean, errorCode: string, retryable: boolean): TaskView {
  if (terminal(task)) return task;
  if (retryable) return { ...task, errorCode };
  if (!hasIntent && task.providerState === 'unsubmitted') return { ...task, state: 'FAILED', errorCode, reservationMicros: 0, settlementStatus: 'unspent' };
  if (task.providerState === 'completed') return { ...task, state: 'COLLECTING', collectionState: 'retryable_failure', errorCode };
  return { ...task, state: 'RECONCILE_REQUIRED', errorCode, reconcileStatus: task.reconcileStatus === 'unsupported' ? 'unsupported' : 'pending' };
}
