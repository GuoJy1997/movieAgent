import { afterEach, expect, it } from 'vitest';
import { cleanup, command, image, unwrap, create } from './timeline-fixtures.ts';
import { setupRender } from './render-fixtures.ts';
import { queryOutputValidators, type QueryMap } from '../../packages/contracts/src/queries.ts';
afterEach(cleanup);
it('round-trips persisted derived plans through the render.plan query union and rejects malformed discriminants', async () => {
    const { e, root, projectId } = await setupRender();
    const ref = await image(e, root);
    const plan = unwrap(await e.renders.prepareDerived({
        projectId, references: [ref], fps: { num: 30, den: 1 },
        canvas: { width: 1080, height: 1080 }, executionOwner: 'user', runId: 'derived-query'
    }));
    const response = e.commands.query({
        schemaVersion: 1, libraryId: e.identity.libraryId, connectionEpoch: 'fixture',
        queryId: 'derived-plan', kind: 'render.plan', payload: { projectId, planId: plan.planId }
    });
    if (!response.ok) throw Error(response.error.code);
    const declared: QueryMap['render.plan']['output'] = plan;
    const transported = JSON.parse(JSON.stringify(response.value));
    expect(queryOutputValidators['render.plan'](transported)).toBe(true);
    expect(transported).toEqual(declared);
    expect(queryOutputValidators['render.plan']({ ...transported, kind: 'render' })).toBe(false);
    expect(queryOutputValidators['render.plan']({ ...transported, kind: 'voice' })).toBe(false);
    expect(queryOutputValidators['render.plan']({ ...transported, path: root })).toBe(false);
});
it('prepares without execution, approves once, and freezes the exact timeline revision', async () => {
    const { e, root, projectId } = await setupRender();
    const ref = await image(e, root);
    const metadata = unwrap(e.assets.metadata(ref));
    unwrap(await e.commands.execute(command(e, 'timeline.create', create(projectId))));
    unwrap(await e.commands.execute(command(e, 'timeline.applyOps', {
        projectId, timelineId: 'cut', expectedRevision: 1, operations: [{
                kind: 'insert', clip: {
                    id: 'image', kind: 'image', media: ref, sourceHash: metadata.hash, sourceProbeId: null, sourceInTicks: 0, startTicks: 0, durationTicks: 48000, fit: 'contain', gainMilli: 1000, mute: true
                }
            }]
    })));
    expect(e.renders).toBeDefined();
    const plan = unwrap(await e.renders.prepare({
        timelineRef: {
            libraryId: e.identity.libraryId, projectId, id: 'cut', revision: 2
        }, purpose: 'mp4', executionOwner: 'user', runId: 'run'
    }));
    expect(unwrap(e.renders.list({
        projectId
    })).jobs).toHaveLength(0);
    const approval = {
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    };
    const first = unwrap(e.renders.enqueue(approval));
    expect(unwrap(e.renders.enqueue(approval))).toEqual(first);
    expect(unwrap(e.renders.read({
        projectId, jobId: first.jobId
    }))).toMatchObject({
        state: 'QUEUED', attempt: 1, history: [{
                attempt: 1
            }]
    });
    expect(e.renders.enqueue({
        ...approval, executionOwner: 'other'
    })).toMatchObject({
        ok: false
    });
    unwrap(await e.commands.execute(command(e, 'timeline.applyOps', {
        projectId, timelineId: 'cut', expectedRevision: 2, operations: [{
                kind: 'move', clipId: 'image', startTicks: 48000
            }]
    })));
    expect(unwrap(e.renders.plan({
        projectId, planId: plan.planId
    })).kind).toBe('render');
    expect(unwrap(e.renders.plan({
        projectId, planId: plan.planId
    }))).toMatchObject({
        timeline: {
            revision: 2, videoClips: [{
                    startTicks: 0
                }]
        }
    });
    unwrap(e.renders.cancel({
        jobId: first.jobId, executionOwner: 'user'
    }));
    expect(unwrap(e.renders.read({
        projectId, jobId: first.jobId
    }))).toMatchObject({
        state: 'CANCELLED', cancelRequested: true
    });
    const retried = unwrap(e.renders.retry({
        jobId: first.jobId, executionOwner: 'user', runId: 'retry'
    }));
    expect(retried.jobId).not.toBe(first.jobId);
    expect(unwrap(e.renders.read({
        projectId, jobId: retried.jobId
    }))).toMatchObject({
        attempt: 2, planId: plan.planId, state: 'QUEUED'
    });
});
