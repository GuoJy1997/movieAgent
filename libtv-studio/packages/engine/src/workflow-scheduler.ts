import { fail, ok, type Result } from '../../contracts/src/result.ts';
/** Only admits ready durable steps. Existing generation scheduler owns all provider I/O. */
export function workflowCoordinator(tick: (stopping: () => boolean) => Promise<Result<void>>) {
    let pending: Promise<Result<void>> | undefined, timer: ReturnType<typeof setTimeout> | undefined, paused = false, closed = false, active = false;
    function wake(): Promise<Result<void>> { if (paused || closed)
        return Promise.resolve(ok(undefined)); if (pending)
        return pending; if (timer)
        clearTimeout(timer); pending = tick(() => paused || closed).finally(() => { pending = undefined; if (active && !paused && !closed) {
        timer = setTimeout(() => void wake(), 1000);
        timer.unref();
    } }); return pending; }
    return { wake, async start() { if (closed)
            return fail('WORKFLOW_CLOSED', '协调器已关闭。'); active = true; return wake(); }, async pause() { paused = true; if (timer)
            clearTimeout(timer); await pending; }, resume() { if (!closed) {
            paused = false;
            if (active)
                void wake();
        } }, async close() { closed = true; active = false; if (timer)
            clearTimeout(timer); await pending; } };
}
