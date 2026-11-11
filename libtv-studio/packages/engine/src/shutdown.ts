import type { Result } from '../../contracts/src/result.ts';
export interface ShutdownReport {
  reason: string;
  stoppedClaiming: boolean;
  persisted: boolean;
  resourcesExited: boolean;
  cleanupPending: boolean;
  interrupted: boolean;
  errorCode?: string;
}
export const GRACEFUL_SHUTDOWN_MS = 20_000;
/** One absolute deadline bounds the caller; work retains ownership after timeout. */
export function shutdownFor(stopAdmission: () => void, drain: () => Promise<void>, release: () => Promise<Result<void>>) {
  let work: Promise<ShutdownReport> | undefined;
  return function quiesceEngine(reason: string, deadline: number): Promise<ShutdownReport> {
    if (work) return work;
    stopAdmission();
    const report: ShutdownReport = { reason, stoppedClaiming: true, persisted: false, resourcesExited: false, cleanupPending: true, interrupted: false };
    work = new Promise(resolve => {
      const timer = setTimeout(() => resolve({ ...report, interrupted: true }), Math.max(0, deadline - Date.now()));
      void (async () => {
        try {
          await drain(); report.persisted = true;
          const closed = await release(); report.resourcesExited = closed.ok; report.cleanupPending = !closed.ok;
          if (!closed.ok) report.errorCode = closed.error.code;
        } catch { report.cleanupPending = true; }
        clearTimeout(timer); resolve({ ...report });
      })();
    });
    return work;
  };
}
