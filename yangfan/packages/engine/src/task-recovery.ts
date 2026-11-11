import { ok, type Result } from '../../contracts/src/result.ts';
import type { TaskView } from '../../contracts/src/generation.ts';
import type { generationFor } from './generation-service.ts';
/** Recovery uses the same tracked attempt runner as ordinary wakes, and never submits an existing intent. */
export async function recoverTasks(generation: ReturnType<typeof generationFor>, run: (attemptId: string) => Promise<Result<TaskView>>, closing: () => boolean): Promise<Result<void>> {
  // Collect already paid output first; unknown/accepted jobs use reconciliation,
  // never a replacement submit, regardless of lease expiry or process identity.
  for (const task of generation.list().tasks.sort((a, b) => Number(b.providerState === 'completed') - Number(a.providerState === 'completed'))) {
    if (closing()) break;
    if (task.providerState === 'completed' && task.collectionState !== 'durable' || ['submitting','accepted','unknown'].includes(task.providerState)) {
      const result = await run(task.attemptId); if (!result.ok) return result;
    }
  }
  return ok(undefined);
}
