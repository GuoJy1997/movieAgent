import { nativeFixture, value, execute } from './native-generation';
export const shot = (key: string, entityKeys: string[] = []) => ({
    key, sceneKey: 'opening', order: 0, title: key, durationSeconds: 5, shotSize: 'wide', cameraMovement: 'static', subject: 'hero', action: 'walk', dialogue: '', sound: 'wind', aspectRatio: '16:9', prompt: 'quiet lake', entityKeys
});
export const proposal = {
    schemaVersion: 1, reply: 'Draft ready', script: {
        title: 'Lake', synopsis: 'A visit', body: 'A quiet visit.', scenes: [{
                key: 'opening', title: 'Opening', location: 'Lake', time: 'Day', description: ''
            }]
    }, entities: [{
            key: 'hero', kind: 'character', name: 'Hero', description: 'Visitor', constraints: '', assetKeys: []
        }, {
            key: 'unused', kind: 'prop', name: 'Boat', description: '', constraints: '', assetKeys: []
        }], shots: [shot('first', ['hero']), shot('second', ['unused'])]
};
export async function prepared(s: Awaited<ReturnType<typeof nativeFixture>>, extra: Record<string, unknown> = {}) {
    const projectId = s.prepareInput().projectId;
    const session = value(await execute(s.engine, 'agent.createSession', {
        projectId, title: 'Story', mode: 'all', executionOwner: 'human'
    }));
    const turn = value(await execute(s.engine, 'agent.prepareTurn', {
        sessionId: session.sessionId, message: 'Write a short scene', profileRef: s.prepareInput().profileRef, templateId: 'short-film', targets: {
            shotIds: [], entityIds: []
        }, ...extra
    }));
    return {
        session, turn, projectId
    };
}
export const approve = (turn: any) => ({
    runId: turn.runId, approval: {
        preparedId: turn.generation.preparedId, approvedPlanHash: turn.generation.planHash, currency: 'CNY', allowanceMicros: 1000000, budgetLimitMicros: 100000000, acknowledgeUnknown: true, executionOwner: 'human', runId: turn.runId
    }
});
export const acceptance = (run: any) => ({
    runId: run.runId, projectId: run.projectId, executionOwner: 'human', proposalHash: run.proposal.proposalHash, selectedShotKeys: ['first'], selectedEntityKeys: [], includeScript: false
});
export async function completed(s: Awaited<ReturnType<typeof nativeFixture>>, extra: Record<string, unknown> = {}, body: unknown = proposal) {
    s.response({
        choices: [{
                message: {
                    role: 'assistant', content: JSON.stringify(body)
                }, finish_reason: 'stop'
            }]
    });
    const p = await prepared(s, extra);
    const run = value(await execute(s.engine, 'agent.approveTurn', approve(p.turn)));
    value(await s.engine.scheduler.run(run.task.attemptId));
    value(await s.engine.agents.wake());
    return {
        ...p, run: value(s.engine.agents.run(run.runId))
    };
}
