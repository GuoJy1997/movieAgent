import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { writeFile, readFile, stat, mkdir } from 'node:fs/promises';
import { startEngine } from '../../packages/engine/src/bootstrap.ts';
import { setupRender } from './render-fixtures.ts';
import { cleanup, command, image, unwrap, create, engines } from './timeline-fixtures.ts';
import { installMediaProtocol } from '../../apps/desktop/src/main/media-protocol.ts';
afterEach(cleanup);
async function planImage(context: Awaited<ReturnType<typeof setupRender>>) {
    const { e, root, projectId } = context;
    const ref = await image(e, root), metadata = unwrap(e.assets.metadata(ref));
    unwrap(await e.commands.execute(command(e, 'timeline.create', create(projectId))));
    unwrap(await e.commands.execute(command(e, 'timeline.applyOps', {
        projectId, timelineId: 'cut', expectedRevision: 1, operations: [{
                kind: 'insert', clip: {
                    id: 'image', kind: 'image', media: ref, sourceHash: metadata.hash, sourceProbeId: null, sourceInTicks: 0, startTicks: 0, durationTicks: 4800, fit: 'contain', gainMilli: 1000, mute: true
                }
            }]
    })));
    const request = command(e, 'render.prepare', {
        timelineRef: {
            libraryId: e.identity.libraryId, projectId, id: 'cut', revision: 2
        }, purpose: 'mp4', executionOwner: 'user', runId: 'run'
    });
    const receipt = unwrap(await e.commands.execute(request));
    expect(unwrap(await e.commands.execute(request))).toEqual(receipt);
    return receipt.result as import('../../packages/contracts/src/render.ts').RenderPlan;
}
it('publishes a verified local asset with real provenance and round-trips its bounded lease and media URL', async () => {
    const context = await setupRender(), { e, projectId } = context, plan = await planImage(context);
    const job = unwrap(e.renders.enqueue({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    }));
    e.renderScheduler.start();
    await e.renderScheduler.drain();
    const result = unwrap(e.renders.read({
        projectId, jobId: job.jobId
    }));
    expect(result).toMatchObject({
        state: 'SUCCEEDED', outputRef: {
            kind: 'assetVersion'
        }, progressTicks: 4800
    });
    const ref = result.outputRef!;
    await expect(stat(join(context.root, 'temp', 'media-job-' + job.jobId))).rejects.toMatchObject({ code: 'ENOENT' });
    const lease = unwrap(await e.assets.openMediaRead(ref));
    const chunk = unwrap(await e.assets.readMediaRange({
        leaseId: lease.leaseId, offset: 0, length: 128
    }));
    expect(Buffer.from(chunk.bytes).toString('ascii', 4, 8)).toBe('ftyp');
    await e.assets.closeMediaRead(lease.leaseId);
    let handler!: (request: Request) => Promise<Response>;
    const session = {
        protocol: {
            handle: (_scheme: string, fn: typeof handler) => { handler = fn; }, unhandle: () => { }
        }
    };
    const protocol = installMediaProtocol(session as never, e.identity.libraryId, input => e.assets.read(input), e.assets);
    const url = unwrap(await protocol.issue({
        libraryId: e.identity.libraryId, ref, variant: 'original'
    }));
    const response = await handler(new Request(url, {
        headers: {
            range: 'bytes=0-15'
        }
    }));
    expect(response.status).toBe(206);
    expect((await response.arrayBuffer()).byteLength).toBe(16);
    protocol.close();
    const db = new DatabaseSync(join(context.root, 'library.sqlite'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM local_media_output WHERE job_id=?').get(job.jobId)!.n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM generation_task').get()!.n).toBe(0);
    expect(db.prepare('SELECT artifact_id FROM asset_version WHERE asset_id=?').get(ref.assetId)!.artifact_id).toBeNull();
    db.close();
    await e.close();
    const leftover = join(context.root, 'temp', 'media-job-' + job.jobId);
    await mkdir(leftover, { recursive: true });
    await writeFile(join(leftover, 's0'), 'stale source');
    await writeFile(join(leftover, 'output.part'), 'stale duplicate');
    const unknown = join(context.root, 'temp', 'media-job-unknown');
    await mkdir(unknown, { recursive: true });
    await writeFile(join(unknown, 'keep'), 'not an owned job');
    const reopened = unwrap(await startEngine({ root: context.root, runtime: context.runtime }));
    engines.push(reopened);
    await reopened.renderScheduler.drain();
    await expect(stat(leftover)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(unknown, 'keep'), 'utf8')).toBe('not an owned job');
    const durable = unwrap(await reopened.assets.openMediaRead(ref));
    await reopened.assets.closeMediaRead(durable.leaseId);
});
it.each(['missing', 'incomplete'])('requires a new retry attempt for an interrupted encode with %s output', async (output) => {
    const context = await setupRender(), { e, projectId, root, runtime } = context, plan = await planImage(context);
    const job = unwrap(e.renders.enqueue({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    }));
    await e.close();
    const staging = join(root, 'temp', 'media-job-' + job.jobId);
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, 's0'), 'recoverable source');
    if (output === 'incomplete') await writeFile(join(staging, 'output.part'), 'partial encode');
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.prepare("UPDATE local_media_job SET state='RUNNING',lease_owner='dead-instance' WHERE job_id=?").run(job.jobId);
    db.prepare("UPDATE local_media_attempt SET state='RUNNING' WHERE job_id=?").run(job.jobId);
    db.close();
    let reopened = unwrap(await startEngine({
        root, runtime
    }));
    engines.push(reopened);
    expect(unwrap(reopened.renders.read({
        projectId, jobId: job.jobId
    }))).toMatchObject({
        state: 'INTERRUPTED', needsResume: true
    });
    reopened.renderScheduler.start();
    await reopened.renderScheduler.drain();
    expect(unwrap(reopened.renders.read({
        projectId, jobId: job.jobId
    })).state).toBe('INTERRUPTED');
    unwrap(await reopened.commands.execute(command(reopened, 'render.resume', {
        jobId: job.jobId, executionOwner: 'user'
    })));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await reopened.renderScheduler.drain();
    expect(await readFile(join(staging, 's0'), 'utf8')).toBe('recoverable source');
    expect(unwrap(reopened.renders.read({ projectId, jobId: job.jobId }))).toMatchObject({
        state: 'INTERRUPTED', needsResume: true, attempt: 1, errorCode: 'LOCAL_JOB_RETRY_REQUIRED'
    });
    await reopened.renderScheduler.pause();
    unwrap(reopened.renders.resume({ jobId: job.jobId, executionOwner: 'user' }));
    expect(unwrap(reopened.renders.read({ projectId, jobId: job.jobId }))).toMatchObject({
        state: 'QUEUED', phase: 'recover-output', attempt: 1
    });
    await reopened.close();
    reopened = unwrap(await startEngine({ root, runtime }));
    engines.push(reopened);
    expect(unwrap(reopened.renders.read({ projectId, jobId: job.jobId }))).toMatchObject({
        state: 'QUEUED', phase: 'recover-output', needsResume: true, attempt: 1
    });
    unwrap(reopened.renders.resume({ jobId: job.jobId, executionOwner: 'user' }));
    reopened.renderScheduler.start();
    await reopened.renderScheduler.drain();
    expect(unwrap(reopened.renders.read({ projectId, jobId: job.jobId }))).toMatchObject({
        state: 'INTERRUPTED', phase: 'retry-required', errorCode: 'LOCAL_JOB_RETRY_REQUIRED', attempt: 1
    });
    expect(await readFile(join(staging, 's0'), 'utf8')).toBe('recoverable source');
    const retried = unwrap(reopened.renders.retry({ jobId: job.jobId, executionOwner: 'user', runId: 'new-attempt' }));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await reopened.renderScheduler.drain();
    expect(unwrap(reopened.renders.read({
        projectId, jobId: retried.jobId
    }))).toMatchObject({
        state: 'SUCCEEDED', attempt: 2, history: [{ attempt: 1, state: 'INTERRUPTED' }, { attempt: 2, state: 'SUCCEEDED' }]
    });
});
it('leaves a reopened QUEUED approval pending until the user explicitly resumes it', async () => {
    const context = await setupRender(), { e, root, runtime, projectId } = context, plan = await planImage(context);
    const job = unwrap(e.renders.enqueue({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    }));
    await e.close();
    const reopened = unwrap(await startEngine({
        root, runtime
    }));
    engines.push(reopened);
    reopened.renderScheduler.start();
    await reopened.renderScheduler.drain();
    expect(unwrap(reopened.renders.read({
        projectId, jobId: job.jobId
    }))).toMatchObject({
        state: 'QUEUED', needsResume: true, attempt: 1
    });
    unwrap(reopened.renders.resume({
        jobId: job.jobId, executionOwner: 'user'
    }));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await reopened.renderScheduler.drain();
    expect(unwrap(reopened.renders.read({
        projectId, jobId: job.jobId
    }))).toMatchObject({
        state: 'SUCCEEDED', needsResume: false, attempt: 1
    });
});
it('late verified output cannot override a durable cancel request', async () => {
    let cancel = () => { };
    const context = await setupRender({
        onPhase: phase => { if (phase === 'verified')
            cancel(); }
    }), { e, projectId } = context, plan = await planImage(context);
    const job = unwrap(e.renders.enqueue({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    }));
    cancel = () => { unwrap(e.renders.cancel({
        jobId: job.jobId, executionOwner: 'user'
    })); };
    e.renderScheduler.start();
    await e.renderScheduler.drain();
    expect(unwrap(e.renders.read({
        projectId, jobId: job.jobId
    }))).toMatchObject({
        state: 'CANCELLED', outputRef: null, cancelRequested: true
    });
    await expect(stat(join(context.root, 'temp', 'media-job-' + job.jobId))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each(['missing', 'complete'])('recovers derived work only from %s existing cache outputs without rebuilding', async (cache) => {
    const { e, root, runtime, projectId } = await setupRender();
    const ref = await image(e, root);
    const plan = unwrap(await e.renders.prepareDerived({
        projectId, references: [ref], fps: { num: 30, den: 1 }, canvas: { width: 1080, height: 1080 },
        executionOwner: 'user', runId: 'derived-recovery'
    }));
    const job = unwrap(e.renders.enqueueDerived({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'derived-recovery', diskBudgetBytes: plan.requiredFreeBytes
    }));
    if (cache === 'complete') {
        e.renderScheduler.start();
        await e.renderScheduler.drain();
        expect(unwrap(e.renders.read({ projectId, jobId: job.jobId })).state).toBe('SUCCEEDED');
    }
    await e.close();
    const staging = join(root, 'temp', 'media-job-' + job.jobId);
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, 's0'), 'keep interrupted input');
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.prepare("UPDATE local_media_job SET state='RUNNING',lease_owner='dead-instance' WHERE job_id=?").run(job.jobId);
    db.prepare("UPDATE local_media_attempt SET state='RUNNING' WHERE job_id=?").run(job.jobId);
    db.prepare('DELETE FROM local_media_derived_output WHERE job_id=?').run(job.jobId);
    db.close();
    const reopened = unwrap(await startEngine({ root, runtime }));
    engines.push(reopened);
    unwrap(reopened.renders.resume({ jobId: job.jobId, executionOwner: 'user' }));
    reopened.renderScheduler.start();
    await reopened.renderScheduler.drain();
    const result = unwrap(reopened.renders.read({ projectId, jobId: job.jobId }));
    if (cache === 'complete') {
        expect(result).toMatchObject({ state: 'SUCCEEDED', attempt: 1 });
        expect(result.derived).toHaveLength(1);
        await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
        expect(result).toMatchObject({ state: 'INTERRUPTED', errorCode: 'LOCAL_JOB_RETRY_REQUIRED', attempt: 1 });
        expect(result.derived).toEqual([]);
        expect(await readFile(join(staging, 's0'), 'utf8')).toBe('keep interrupted input');
    }
});
it('explicit derived work deduplicates sources, returns a separate cache identity and never pretends to be an original', async () => {
    const { e, root, projectId } = await setupRender(), ref = await image(e, root);
    const plan = unwrap(await e.renders.prepareDerived({
        projectId, references: [ref, ref], fps: {
            num: 30, den: 1
        }, canvas: {
            width: 1080, height: 1080
        }, executionOwner: 'user', runId: 'derived'
    }));
    expect(plan.manifest.entries).toHaveLength(1);
    expect(unwrap(e.renders.derived({
        projectId, planId: plan.planId
    })).outputs).toEqual([]);
    const job = unwrap(e.renders.enqueueDerived({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'derived', diskBudgetBytes: plan.requiredFreeBytes
    }));
    e.renderScheduler.start();
    await e.renderScheduler.drain();
    const view = unwrap(e.renders.read({
        projectId, jobId: job.jobId
    }));
    expect(view).toMatchObject({
        state: 'SUCCEEDED', outputRef: null
    });
    expect(view.derived).toHaveLength(1);
    await expect(stat(join(root, 'temp', 'media-job-' + job.jobId))).rejects.toMatchObject({ code: 'ENOENT' });
    const reusedPlan = unwrap(await e.renders.prepareDerived({
        projectId, references: [ref], fps: { num: 30, den: 1 }, canvas: { width: 1080, height: 1080 },
        executionOwner: 'user', runId: 'cache-hit'
    }));
    const reusedJob = unwrap(e.renders.enqueueDerived({
        planId: reusedPlan.planId, planHash: reusedPlan.planHash, executionOwner: 'user',
        runId: 'cache-hit', diskBudgetBytes: reusedPlan.requiredFreeBytes
    }));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await e.renderScheduler.drain();
    expect(unwrap(e.renders.read({ projectId, jobId: reusedJob.jobId }))).toMatchObject({
        state: 'SUCCEEDED', derived: view.derived
    });
    await expect(stat(join(root, 'temp', 'media-job-' + reusedJob.jobId))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(e.assets.metadata(view.derived[0] as never)).toMatchObject({
        ok: false
    });
    const cacheLease = unwrap(await e.renders.openDerivedMediaRead(view.derived[0]!));
    expect(cacheLease.mime).toBe('image/png');
    await e.renders.closeDerivedMediaRead(cacheLease.leaseId);
    let handler!: (request: Request) => Promise<Response>;
    const protocol = installMediaProtocol({
        protocol: {
            handle: (_scheme: string, fn: typeof handler) => { handler = fn; }, unhandle: () => { }
        }
    } as never, e.identity.libraryId, input => e.assets.read(input), {
        ...e.assets, openDerivedMediaRead: e.renders.openDerivedMediaRead, readDerivedMediaRange: e.renders.readDerivedMediaRange, closeDerivedMediaRead: e.renders.closeDerivedMediaRead
    });
    const url = unwrap(await protocol.issueDerived(view.derived[0]));
    expect(url).toMatch(/\/derived$/);
    const response = await handler(new Request(url));
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(await protocol.issueDerived({
        ...view.derived[0], sourceHash: '0'.repeat(64)
    })).toMatchObject({
        ok: false
    });
    protocol.close();
    await writeFile(join(root, 'cache', 'media', view.derived[0]!.cacheId + '.media'), 'corrupted');
    expect(await e.renders.openDerivedMediaRead(view.derived[0]!)).toMatchObject({
        ok: false, error: {
            code: 'CACHE_CORRUPT'
        }
    });
    expect(unwrap(e.renders.derived({
        projectId, planId: plan.planId
    })).outputs).toHaveLength(1);
    const pinned = unwrap(await e.renders.prepareDerived({projectId,references:[ref],fps:{num:30,den:1},canvas:{width:1080,height:1080},executionOwner:'user',runId:'pin'}));
    expect(unwrap(await e.renders.reclaimCache(0)).removedBytes).toBe(0);
    const pending = unwrap(e.renders.enqueueDerived({planId:pinned.planId,planHash:pinned.planHash,executionOwner:'user',runId:'pin',diskBudgetBytes:pinned.requiredFreeBytes}));
    unwrap(e.renders.cancel({jobId:pending.jobId,executionOwner:'user'}));
    expect(unwrap(await e.renders.reclaimCache(0)).removedBytes).toBeGreaterThan(0);
    expect(await e.renders.openDerivedMediaRead(view.derived[0]!)).toMatchObject({ok:false});
    const original = unwrap(await e.assets.openMediaRead(ref));
    await e.assets.closeMediaRead(original.leaseId);
});
it.each([
    'rendered', 'verified', 'journaled', 'renamed', 'beforePublish', 'published'
] as const)('recovers a crash at %s without changing output identity or creating provider tasks', async (boundary) => {
    const context = await setupRender({
        onPhase: phase => { if (phase === boundary) {
            void interrupt();
            throw Error('SIMULATED_CRASH');
        } }
    }), { e, root, projectId, runtime } = context, plan = await planImage(context);
    const interrupt = () => e.renderScheduler.close();
    const job = unwrap(e.renders.enqueue({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    }));
    e.renderScheduler.start();
    await e.renderScheduler.drain();
    if (boundary === 'journaled' || boundary === 'renamed') {
        const snapshot = unwrap(await e.maintenance.snapshot());
        const manifest = JSON.parse(await readFile(join(root,'backups',snapshot.snapshotId+'.json'),'utf8'));
        expect(manifest.localMediaJournal).toHaveLength(1);
        expect(manifest.localMedia).toHaveLength(boundary === 'renamed' ? 1 : 0);
    }
    await e.close();
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    if (boundary !== 'published') {
        db.prepare("UPDATE local_media_job SET state='PUBLISHING',lease_owner='crashed' WHERE job_id=?").run(job.jobId);
        db.prepare("UPDATE local_media_attempt SET state='PUBLISHING' WHERE job_id=?").run(job.jobId);
    }
    db.close();
    let stopRecovery = async () => { };
    const completeBefore = boundary === 'verified' ? await readFile(join(root, 'temp', 'media-job-' + job.jobId, 'output.part')) : null;
    let reopened = unwrap(await startEngine({
        root, runtime, localMedia: { onPhase: phase => {
            if (boundary === 'verified' && phase === 'verified') {
                void stopRecovery();
                throw Error('SIMULATED_CRASH');
            }
        } }
    }));
    stopRecovery = () => reopened.renderScheduler.close();
    engines.push(reopened);
    if (boundary !== 'published')
        unwrap(reopened.renders.resume({
            jobId: job.jobId, executionOwner: 'user'
        }));
    reopened.renderScheduler.start();
    await reopened.renderScheduler.drain();
    if (boundary === 'verified') {
        expect(unwrap(reopened.renders.read({ projectId, jobId: job.jobId }))).toMatchObject({
            state: 'INTERRUPTED', phase: 'stopped', attempt: 1
        });
        expect(await readFile(join(root, 'temp', 'media-job-' + job.jobId, 'output.part'))).toEqual(completeBefore);
        await reopened.close();
        reopened = unwrap(await startEngine({ root, runtime }));
        engines.push(reopened);
        unwrap(reopened.renders.resume({ jobId: job.jobId, executionOwner: 'user' }));
        reopened.renderScheduler.start();
        await reopened.renderScheduler.drain();
    }
    const result = unwrap(reopened.renders.read({
        projectId, jobId: job.jobId
    }));
    expect(result).toMatchObject({
        state: 'SUCCEEDED', attempt: 1, outputRef: {
            assetId: 'local-' + job.jobId, version: 1
        }
    });
    const inspect = new DatabaseSync(join(root, 'library.sqlite'));
    expect(inspect.prepare('SELECT COUNT(*) AS n FROM local_media_output WHERE job_id=?').get(job.jobId)!.n).toBe(1);
    expect(inspect.prepare('SELECT COUNT(*) AS n FROM generation_task').get()!.n).toBe(0);
    inspect.close();
});
