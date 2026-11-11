import { ok } from '../../contracts/src/result.ts';
import type { rendersFor } from './render-service.ts';
/** One owned controller and one heavy media job per library. No PID recovery. */
export function renderSchedulerFor(renders: ReturnType<typeof rendersFor>) {
    let enabled = false, paused = false, closed = false, ready = false;
    let active: Promise<void> | undefined;
    let controller: AbortController | undefined;
    function wake(): void {
        if (!ready || !enabled || paused || closed || active)
            return;
        const jobId = renders.claim();
        if (!jobId)
            return;
        controller = new AbortController();
        active = renders.execute(jobId, controller).finally(() => { active = undefined; controller = undefined; queueMicrotask(wake); });
    }
    renders.setWake(wake);
    renders.recover();
    const startup = renders.cleanupTerminalStaging().finally(() => { ready = true; wake(); });
    return {
        start() { if (!closed) {
            enabled = true;
            wake();
        } return ok(undefined); },
        wake,
        async pause() { paused = true; await startup; await active; await renders.drainStagingCleanup(); },
        resume() { if (!closed) {
            paused = false;
            wake();
        } },
        async close() { closed = true; paused = true; controller?.abort(); await startup; await active; await renders.drainStagingCleanup(); },
        async drain() { await startup; while (active)
            await active; await renders.drainStagingCleanup(); },
    };
}
