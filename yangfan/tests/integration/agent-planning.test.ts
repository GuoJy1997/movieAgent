import { expect, it } from 'vitest';
import { nativeFixture, value, execute } from '../fixtures/native-generation';
import { proposal, prepared, approve, acceptance, completed, shot } from '../fixtures/agent';
it('prepares frozen bounded context and explicit token budget without POST or content writes; adoption applies selected dependencies once', async () => {
    const s = await nativeFixture('openai-chat-v1', 'max_completion_tokens');
    const ref = await s.importFile(Buffer.from('Selected source: green boat'), 'source.md');
    const { turn, projectId } = await prepared(s, {
        outputTokens: 4096, selectedAssetRefs: [ref]
    });
    expect(s.requests).toHaveLength(0);
    expect(turn.generation.prompt).toContain('Selected source: green boat');
    expect(turn.generation.prompt.length).toBeLessThanOrEqual(16000);
    expect(turn.generation.config.parameters).toEqual({
        max_completion_tokens: 4096
    });
    expect(value(s.engine.creation.read({
        projectId
    })).scripts).toEqual([]);
    expect(s.engine.modelConfig.listProfiles().profiles.find(x => x.id === 'native')!.parameters).toEqual({
        max_completion_tokens: 1024
    });
    s.response({
        choices: [{
                message: {
                    content: JSON.stringify(proposal)
                }, finish_reason: 'stop'
            }]
    });
    const planning = value(await execute(s.engine, 'agent.approveTurn', approve(turn)));
    expect(planning.state).toBe('PLANNING');
    expect(value(await execute(s.engine, 'agent.approveTurn', approve(turn))).task).toEqual(planning.task);
    value(await s.engine.scheduler.run(planning.task.attemptId));
    value(await s.engine.agents.wake());
    const run = value(s.engine.agents.run(turn.runId));
    expect(run.state).toBe('PROPOSED');
    expect(s.requests).toHaveLength(1);
    expect(JSON.parse(s.requests[0]!.body.toString()).max_completion_tokens).toBe(4096);
    expect(value(s.engine.creation.read({
        projectId
    })).scripts).toEqual([]);
    const action = value(await execute(s.engine, 'agent.acceptProposal', acceptance(run)));
    expect(action.acceptedShotKeys).toEqual(['first']);
    expect(action.skippedShotKeys).toEqual(['second']);
    expect(action.result.entities.map((x: any) => x.name)).toEqual(['Hero']);
    expect(action.result.shots).toHaveLength(1);
    expect(value(await execute(s.engine, 'agent.acceptProposal', acceptance(run)))).toEqual(action);
    expect(await execute(s.engine, 'agent.acceptProposal', {
        ...acceptance(run), selectedShotKeys: ['second']
    })).toMatchObject({
        ok: false, error: {
            code: 'APPROVAL_REUSED'
        }
    });
    expect(value(s.engine.creation.read({
        projectId
    })).shots).toHaveLength(1);
});
it.each(['anthropic-messages-v1', 'openai-chat-v1'])('harvests %s reply with no proposal and no hidden reasoning', async (adapter) => {
    const s = await nativeFixture(adapter);
    const { turn } = await prepared(s);
    const text = JSON.stringify({
        schemaVersion: 1, reply: 'Hello'
    });
    s.response(adapter === 'anthropic-messages-v1' ? {
        type: 'message', role: 'assistant', content: [{
                type: 'thinking', thinking: 'secret reasoning', signature: 'signature'
            }, {
                type: 'text', text
            }], stop_reason: 'end_turn'
    } : {
        choices: [{
                message: {
                    content: text
                }, finish_reason: 'stop'
            }]
    });
    const run = value(await execute(s.engine, 'agent.approveTurn', approve(turn)));
    value(await s.engine.scheduler.run(run.task.attemptId));
    value(await s.engine.agents.wake());
    expect(value(s.engine.agents.run(turn.runId))).toMatchObject({
        state: 'REPLIED', proposal: null
    });
    expect(JSON.stringify(value(s.engine.agents.read(turn.sessionId)))).not.toContain('secret reasoning');
    expect(s.requests).toHaveLength(1);
});
it.each(['prose', 'multiple', 'truncated', 'commands', 'revision', 'project', 'bounds', 'unknownKey'])('rejects %s model output without modifying content', async (mode) => {
    const s = await nativeFixture();
    const { turn, projectId } = await prepared(s);
    const bad: any = structuredClone(proposal);
    if (mode === 'commands')
        bad.command = 'shell';
    if (mode === 'revision')
        bad.shots[0].expectedRevision = 1;
    if (mode === 'project')
        bad.projectId = 'other';
    if (mode === 'bounds')
        bad.shots[0].durationSeconds = 121;
    if (mode === 'unknownKey')
        bad.shots[0].entityKeys = ['missing'];
    let text = JSON.stringify(bad);
    if (mode === 'prose')
        text = 'Here is JSON: ' + text;
    if (mode === 'multiple')
        text += ' {}';
    if (mode === 'truncated')
        text = text.slice(0, -5);
    s.response({
        choices: [{
                message: {
                    content: text
                }, finish_reason: 'stop'
            }]
    });
    const run = value(await execute(s.engine, 'agent.approveTurn', approve(turn)));
    value(await s.engine.scheduler.run(run.task.attemptId));
    value(await s.engine.agents.wake());
    expect(value(s.engine.agents.run(turn.runId)).state).toBe('INVALID');
    expect(value(s.engine.creation.read({
        projectId
    })).scripts).toEqual([]);
});
it('rejects tampered scope and parent script edits while preserving draft', async () => {
    const s = await nativeFixture();
    const projectId = s.prepareInput().projectId;
    const script = {
        projectId, id: 'script', expectedRevision: 0, title: 'Original', synopsis: '', body: 'Original prose', scenes: [{
                id: 'scene', title: 'Day', location: '', time: '', description: ''
            }]
    };
    value(await execute(s.engine, 'creation.saveScript', script));
    const output = {
        ...proposal, script: null, shots: [{
                ...shot('first', ['hero']), sceneKey: 'scene-0'
            }]
    };
    const { run } = await completed(s, {
        targets: {
            scriptId: 'script', shotIds: [], entityIds: []
        }
    }, output);
    expect(await execute(s.engine, 'agent.acceptProposal', {
        ...acceptance(run), proposalHash: '0'.repeat(64)
    })).toMatchObject({
        ok: false, error: {
            code: 'APPROVAL_MISMATCH'
        }
    });
    value(await execute(s.engine, 'creation.saveScript', {
        ...script, expectedRevision: 1, body: 'Manual change'
    }));
    expect(await execute(s.engine, 'agent.acceptProposal', acceptance(run))).toMatchObject({
        ok: false, error: {
            code: 'REVISION_CONFLICT'
        }
    });
    expect(value(s.engine.agents.run(run.runId)).state).toBe('PROPOSED');
    expect(value(s.engine.creation.read({
        projectId
    })).shots).toEqual([]);
});
it('adopts needed scene changes without adopting unrelated script prose or unrelated entity edits', async () => {
    const s = await nativeFixture();
    const projectId = s.prepareInput().projectId;
    const script = {
        projectId, id: 'parent', expectedRevision: 0, title: 'Manual title', synopsis: 'Manual summary', body: 'Manual prose', scenes: [{
                id: 'scene', title: 'Original', location: 'Home', time: 'Day', description: ''
            }]
    };
    value(await execute(s.engine, 'creation.saveScript', script));
    const entity = {
        projectId, id: 'unrelated', expectedRevision: 0, kind: 'prop', name: 'Unrelated', description: '', constraints: '', references: []
    };
    value(await execute(s.engine, 'creation.saveEntity', entity));
    const p = {
        ...proposal, script: {
            ...proposal.script, title: 'Model replacement', body: 'Model prose', scenes: [{
                    key: 'scene-0', title: 'Updated scene', location: 'Lake', time: 'Night', description: ''
                }]
        }, shots: [{
                ...shot('first', ['hero']), sceneKey: 'scene-0'
            }]
    };
    const { run } = await completed(s, {
        targets: {
            scriptId: 'parent', shotIds: [], entityIds: ['unrelated']
        }
    }, p);
    value(await execute(s.engine, 'creation.saveEntity', {
        ...entity, expectedRevision: 1, name: 'Manual entity'
    }));
    const action = value(await execute(s.engine, 'agent.acceptProposal', acceptance(run)));
    expect(action.result.scripts[0]).toMatchObject({
        title: 'Manual title', body: 'Manual prose', scenes: [{
                id: 'scene', title: 'Updated scene'
            }]
    });
    expect(action.result.entities.map((e: any) => e.name)).toEqual(['Hero']);
});
it('exposes accepted shot and parent script revisions for production binding', async () => {
    const s = await nativeFixture();
    const { run } = await completed(s);
    const action = value(await execute(s.engine, 'agent.acceptProposal', acceptance(run)));
    expect(action.acceptedReferences).toEqual([{
            shotId: action.result.shots[0].id, shotRevision: 1, scriptId: action.result.scripts[0].id, scriptRevision: 1, sceneId: action.result.shots[0].sceneId
        }]);
});
