import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { nativeFixture, value, execute } from '../fixtures/native-generation';
import { proposal, prepared, approve, acceptance, completed } from '../fixtures/agent';
import { parseAgentProposal } from '../../packages/domain/src/agent-proposals';
it('recovers an unharvested materialized proposal then repeats adoption across restart without another POST or write', async () => {
    const s = await nativeFixture();
    const { turn, projectId } = await prepared(s);
    s.response({
        choices: [{
                message: {
                    content: '```json\n' + JSON.stringify(proposal) + '\n```'
                }, finish_reason: 'stop'
            }]
    });
    const planning = value(await execute(s.engine, 'agent.approveTurn', approve(turn)));
    value(await s.engine.scheduler.run(planning.task.attemptId));
    value(await s.engine.close());
    const e = await s.open();
    value(await e.agents.start());
    const run = value(e.agents.run(turn.runId));
    expect(run.state).toBe('PROPOSED');
    expect(s.requests).toHaveLength(1);
    expect(value(e.agents.read(turn.sessionId)).messages).toHaveLength(2);
    const receipt = value(await execute(e, 'agent.acceptProposal', acceptance(run)));
    value(await e.agents.wake());
    value(await e.close());
    const again = await s.open();
    value(await again.agents.start());
    expect(value(await execute(again, 'agent.acceptProposal', acceptance(run)))).toEqual(receipt);
    expect(value(again.creation.read({
        projectId
    })).shots).toHaveLength(1);
    expect(value(again.agents.read(turn.sessionId)).messages).toHaveLength(2);
    expect(s.requests).toHaveLength(1);
});
it('stop before approval closes both Agent and generic generation admission', async () => {
    const s = await nativeFixture();
    const { turn } = await prepared(s);
    value(await execute(s.engine, 'agent.stop', {
        runId: turn.runId, executionOwner: 'human'
    }));
    expect(await execute(s.engine, 'agent.approveTurn', approve(turn))).toMatchObject({
        ok: false, error: {
            code: 'AGENT_STOPPED'
        }
    });
    expect(await execute(s.engine, 'generation.approveAndEnqueue', approve(turn).approval)).toMatchObject({
        ok: false, error: {
            code: 'AGENT_AUTHORIZATION'
        }
    });
    expect(s.engine.generation.list().tasks).toHaveLength(0);
    value(await s.engine.close());
    const e = await s.open();
    value(await e.agents.start());
    expect(s.requests).toHaveLength(0);
    expect(value(e.agents.run(turn.runId)).state).toBe('STOPPED');
});
it('retains late collected output as stopped history and never adopts it', async () => {
    const s = await nativeFixture();
    const { turn, projectId } = await prepared(s);
    s.response({
        choices: [{
                message: {
                    content: JSON.stringify(proposal)
                }, finish_reason: 'stop'
            }]
    });
    const planning = value(await execute(s.engine, 'agent.approveTurn', approve(turn)));
    value(await s.engine.scheduler.run(planning.task.attemptId));
    value(await execute(s.engine, 'agent.stop', {
        runId: turn.runId, executionOwner: 'human'
    }));
    value(await s.engine.agents.wake());
    const stopped = value(s.engine.agents.run(turn.runId));
    expect(stopped).toMatchObject({
        state: 'STOPPED', harvested: true, task: planning.task
    });
    expect(stopped.proposal).not.toBeNull();
    expect(await execute(s.engine, 'agent.acceptProposal', acceptance(stopped))).toMatchObject({
        ok: false, error: {
            code: 'AGENT_STOPPED'
        }
    });
    expect(value(s.engine.creation.read({
        projectId
    })).shots).toHaveLength(0);
});
it('records unknown submission without automatic retry or POST on reopening', async () => {
    const s = await nativeFixture();
    s.cut();
    const { turn } = await prepared(s);
    const planning = value(await execute(s.engine, 'agent.approveTurn', approve(turn)));
    value(await s.engine.scheduler.run(planning.task.attemptId));
    value(await s.engine.agents.wake());
    expect(value(s.engine.agents.run(turn.runId))).toMatchObject({
        state: 'UNKNOWN', task: planning.task
    });
    value(await s.engine.close());
    const e = await s.open();
    value(await e.agents.start());
    value(await e.scheduler.recover());
    value(await e.agents.wake());
    expect(s.requests).toHaveLength(1);
    expect(value(e.agents.run(turn.runId)).state).toBe('UNKNOWN');
});
it('expires adoption at ten minutes while keeping proposal visible', async () => {
    const s = await nativeFixture();
    const { run } = await completed(s);
    const spy = vi.spyOn(Date, 'now').mockReturnValue(run.proposal.expiresAt);
    try {
        expect(await execute(s.engine, 'agent.acceptProposal', acceptance(run))).toMatchObject({
            ok: false, error: {
                code: 'APPROVAL_EXPIRED'
            }
        });
    }
    finally {
        spy.mockRestore();
    }
    expect(value(s.engine.agents.run(run.runId)).proposal).toEqual(run.proposal);
});
it('keeps derived profiles immutable and rejects an outdated selected profile before deriving', async () => {
    const s = await nativeFixture();
    const { turn } = await prepared(s, {
        outputTokens: 4096
    });
    const profile = turn.generation.config.profile;
    expect(await execute(s.engine, 'profile.save', {
        id: profile.id, expectedRevision: 1, name: 'change', modelRef: profile.modelRef, parameters: {
            max_tokens: 8192
        }
    })).toMatchObject({
        ok: false, error: {
            code: 'IMMUTABLE_PROFILE'
        }
    });
    value(await execute(s.engine, 'profile.save', {
        id: 'native', expectedRevision: 1, name: 'new', modelRef: profile.modelRef, parameters: {
            max_tokens: 512
        }
    }));
    const session = value(await execute(s.engine, 'agent.createSession', {
        projectId: s.prepareInput().projectId, title: 'Stale', mode: 'director', executionOwner: 'human'
    }));
    expect(await execute(s.engine, 'agent.prepareTurn', {
        sessionId: session.sessionId, message: 'Plan', profileRef: s.prepareInput().profileRef, templateId: 'short-film', targets: {
            shotIds: [], entityIds: []
        }, outputTokens: 4096
    })).toMatchObject({
        ok: false, error: {
            code: 'CONFIG_CHANGED'
        }
    });
});
it('bounds selected text excerpts without truncating schema or JSON and rejects extra proposal authority', async () => {
    const s = await nativeFixture();
    const ref = await s.importFile(Buffer.from('X'.repeat(100000)), 'long.txt');
    const { turn } = await prepared(s, {
        selectedAssetRefs: [ref], message: 'My request'
    });
    expect(turn.generation.prompt.length).toBeLessThanOrEqual(16000);
    expect(turn.generation.prompt).toContain('schemaVersion:1');
    expect(turn.generation.prompt).toContain('My request');
    expect(turn.context.omitted).toContain('asset-0 text after 3000 characters');
    for (const invalid of [{
            ...proposal, credentials: {}
        }, {
            ...proposal, entities: [{
                    ...proposal.entities[0], assetKeys: ['unselected']
                }]
        }, {
            ...proposal, shots: Array(33).fill(proposal.shots[0])
        }]) {
        const parsed = parseAgentProposal(JSON.stringify(invalid));
        if ('credentials' in invalid || invalid.shots.length === 33)
            expect(parsed.ok).toBe(false);
    }
    expect(parseAgentProposal(JSON.stringify({
        ...proposal, reply: 'x'.repeat(8001)
    })).ok).toBe(false);
    expect(parseAgentProposal(JSON.stringify({
        ...proposal, script: {
            ...proposal.script, body: 'x'.repeat(64001)
        }
    })).ok).toBe(false);
});
it('rejects changed source Profile before admitting a previously derived plan', async () => {
    const s = await nativeFixture();
    const { turn } = await prepared(s, {
        outputTokens: 4096
    });
    value(await execute(s.engine, 'profile.save', {
        id: 'native', expectedRevision: 1, name: 'new', modelRef: turn.generation.config.profile.modelRef, parameters: {
            max_tokens: 512
        }
    }));
    expect(await execute(s.engine, 'agent.approveTurn', approve(turn))).toMatchObject({
        ok: false, error: {
            code: 'CONFIG_CHANGED'
        }
    });
    expect(s.engine.generation.list().tasks).toHaveLength(0);
});
it('refuses an empty adoption scope', async () => {
    const s = await nativeFixture();
    const { run } = await completed(s);
    expect(await execute(s.engine, 'agent.acceptProposal', {
        ...acceptance(run), selectedShotKeys: []
    })).toMatchObject({
        ok: false, error: {
            code: 'INVALID_INPUT'
        }
    });
});
it('persists stop during an in-flight HTTP request and harvests its late response without new admission', async () => {
    const s = await nativeFixture();
    const release = s.holdResponse();
    const { turn, projectId } = await prepared(s);
    s.response({
        choices: [{
                message: {
                    content: JSON.stringify(proposal)
                }, finish_reason: 'stop'
            }]
    });
    const planning = value(await execute(s.engine, 'agent.approveTurn', approve(turn)));
    const pending = s.engine.scheduler.run(planning.task.attemptId);
    await vi.waitFor(() => expect(s.requests).toHaveLength(1), {
        timeout: 500, interval: 5
    });
    value(await execute(s.engine, 'agent.stop', {
        runId: turn.runId, executionOwner: 'human'
    }));
    release();
    value(await pending);
    value(await s.engine.agents.wake());
    const stopped = value(s.engine.agents.run(turn.runId));
    expect(stopped).toMatchObject({
        state: 'STOPPED', harvested: true, task: planning.task
    });
    expect(stopped.proposal).not.toBeNull();
    expect(value(s.engine.creation.read({
        projectId
    })).shots).toHaveLength(0);
    expect(s.requests).toHaveLength(1);
});
it('rejects null draft arrays instead of silently treating malformed output as a reply', () => {
    expect(parseAgentProposal('{"schemaVersion":1,"reply":"Hello","entities":null}').ok).toBe(false);
    expect(parseAgentProposal('{"schemaVersion":1,"reply":"Hello","shots":null}').ok).toBe(false);
});

it.each([false, true])('isolates an unreadable first artifact from healthy harvest and scheduler startup (stopped=%s)', async stopped => {
    const s = await nativeFixture();
    const first = await prepared(s);
    s.response({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, reply: 'First reply' }) }, finish_reason: 'stop' }] });
    const firstRun = value(await execute(s.engine, 'agent.approveTurn', approve(first.turn)));
    const firstTask = value(await s.engine.scheduler.run(firstRun.task.attemptId));
    const original = value(await s.engine.assets.readFixedOriginal(firstTask.artifactRef));
    const originalPath = join(s.root, 'objects', original.hash.slice(0, 2), original.hash);
    await writeFile(originalPath, 'corrupted fixture original');
    if (stopped) value(await execute(s.engine, 'agent.stop', { runId: firstRun.runId, executionOwner: 'human' }));

    const second = await prepared(s);
    s.response({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, reply: 'Second reply' }) }, finish_reason: 'stop' }] });
    const secondRun = value(await execute(s.engine, 'agent.approveTurn', approve(second.turn)));
    value(await s.engine.scheduler.run(secondRun.task.attemptId));
    const independent = await s.enqueue();
    expect(s.requests).toHaveLength(2);
    value(await s.engine.close());

    const e = await s.open();
    const subscription = { libraryId: e.identity.libraryId, connectionEpoch: 'test' };
    const cursor = value(e.events.read(subscription)).cursor;
    value(await e.scheduler.start());
    expect(value(e.agents.run(firstRun.runId))).toMatchObject({
        state: stopped ? 'STOPPED' : 'FAILED', errorCode: 'OBJECT_INTEGRITY_FAILED', harvested: false, task: firstRun.task, proposal: null
    });
    expect(value(e.agents.run(secondRun.runId))).toMatchObject({ state: 'REPLIED', errorCode: null, harvested: true, task: secondRun.task });
    expect(value(e.generation.read(independent.task.taskId)).state).toBe('SUCCEEDED');
    expect(s.requests).toHaveLength(3);
    expect(s.requests.filter(request => JSON.parse(request.body.toString()).messages[0].content !== 'A quiet lake')).toHaveLength(2);
    value(await e.agents.wake());
    const changes = value(e.events.read({ ...subscription, cursor })).events;
    const failureEvents = changes.filter((event: any) => event.kind === 'agent.changed' && event.payload.runId === firstRun.runId);
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0].payload.errorCode).toBe('OBJECT_INTEGRITY_FAILED');

    await writeFile(originalPath, original.bytes);
    value(await e.agents.wake());
    expect(value(e.agents.run(firstRun.runId))).toMatchObject({
        state: stopped ? 'STOPPED' : 'REPLIED', errorCode: null, harvested: true, task: firstRun.task
    });
    expect(value(e.agents.read(first.turn.sessionId)).messages).toHaveLength(2);
    expect(s.requests).toHaveLength(3);
    expect(e.generation.list().tasks).toHaveLength(3);
});

it('rejects unselected asset aliases through real harvesting with no creation writes',async()=>{
 const s=await nativeFixture(),{turn,projectId}=await prepared(s);
 s.response({choices:[{message:{content:JSON.stringify({...proposal,entities:[{...proposal.entities[0],assetKeys:['unselected']}]})},finish_reason:'stop'}]});
 const planning=value(await execute(s.engine,'agent.approveTurn',approve(turn)));
 value(await s.engine.scheduler.run(planning.task.attemptId));value(await s.engine.agents.wake());
 expect(value(s.engine.agents.run(turn.runId))).toMatchObject({state:'INVALID',proposal:null});
 expect(value(s.engine.creation.read({projectId}))).toMatchObject({entities:[],scripts:[],shots:[]});
 expect(s.requests).toHaveLength(1);
});
