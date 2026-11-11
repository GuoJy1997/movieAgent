import { expect, it } from 'vitest';
import { nativeFixture, value, execute } from '../fixtures/native-generation.ts';
import { finishPrepared, finishApprove, finishAcceptance } from '../fixtures/finish-agent.ts';
import { fixtureWav } from '../fixtures/audio-generation.ts';

async function voiceSetup(s: Awaited<ReturnType<typeof nativeFixture>>, withShot = false) {
  const projectId = s.prepareInput().projectId;
  value(await execute(s.engine, 'creation.saveScript', { projectId, id: 'script', expectedRevision: 0, title: 'Story', synopsis: '', body: '', scenes: withShot ? [{ id: 'scene', title: 'Scene', location: '', time: '', description: '' }] : [] }));
  if (withShot) {
    value(await execute(s.engine, 'creation.saveShot', { projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0, title: 'Shot', durationSeconds: 4, shotSize: '', cameraMovement: '', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
    value(await execute(s.engine, 'creation.saveEntity', { projectId, id: 'a', expectedRevision: 0, kind: 'character', name: 'A', description: '', constraints: '', references: [] }));
    const audioRef = await s.importFile(fixtureWav(2), 'voice.wav'), metadata = value(s.engine.assets.metadata(audioRef));
    value(await execute(s.engine, 'voice.save', { projectId, id: 'voice-a', expectedRevision: 0, draft: { entityRef: { id: 'a', revision: 1 }, name: 'A voice', dialect: '', performanceNotes: '', reference: { ref: audioRef, hash: metadata.hash, probeId: 'voice-probe', sourceInTicks: 0, durationTicks: 96000 } } }));
  }
  const targets = { kind: 'voice-lines', scriptRef: { id: 'script', revision: 1 }, shotRefs: withShot ? [{ id: 'shot', revision: 1 }] : [], voiceLineRefs: [] };
  return { projectId, targets };
}
const body = { version: 1, kind: 'voice-lines', reply: 'Ready', lines: [{ key: 'new-line', text: 'New line', shotKey: 'shot-0', role: 'a', emotion: 'calm', route: 'native-reference' }] };

it('stops before approval, blocks generic admission and never posts on reopen', async () => {
  const s = await nativeFixture();
  const { targets } = await voiceSetup(s);
  const { turn } = await finishPrepared(s, 'finish-voice-lines', targets);
  value(await execute(s.engine, 'finish.stop', { runId: turn.runId, executionOwner: 'human' }));
  expect(await execute(s.engine, 'finish.approveTurn', finishApprove(turn))).toMatchObject({ ok: false, error: { code: 'FINISH_STOPPED' } });
  expect(await execute(s.engine, 'generation.approveAndEnqueue', finishApprove(turn).approval)).toMatchObject({ ok: false, error: { code: 'AGENT_AUTHORIZATION' } });
  value(await s.engine.close());
  const reopened = await s.open();
  value(await reopened.finish.start());
  expect(value(reopened.finish.run(turn.runId)).state).toBe('STOPPED');
  expect(s.requests).toHaveLength(0);
});

it('retains UNKNOWN without resubmission across restart', async () => {
  const s = await nativeFixture();
  const { targets } = await voiceSetup(s);
  const { turn } = await finishPrepared(s, 'finish-voice-lines', targets);
  s.cut();
  const approved = value(await execute(s.engine, 'finish.approveTurn', finishApprove(turn)));
  value(await s.engine.scheduler.run(approved.task.attemptId));
  value(await s.engine.finish.wake());
  expect(value(s.engine.finish.run(turn.runId)).state).toBe('UNKNOWN');
  value(await s.engine.close());
  const reopened = await s.open();
  value(await reopened.finish.start());
  value(await reopened.scheduler.recover());
  value(await reopened.finish.wake());
  expect(value(reopened.finish.run(turn.runId)).state).toBe('UNKNOWN');
  expect(s.requests).toHaveLength(1);
});

it('keeps a stopped late proposal read-only and replays one receipt after reopen', async () => {
  const s = await nativeFixture('openai-chat-v1', 'max_tokens', undefined, true);
  const { targets, projectId } = await voiceSetup(s, true);
  const { turn } = await finishPrepared(s, 'finish-voice-lines', targets);
  s.response({ choices: [{ message: { content: JSON.stringify(body) }, finish_reason: 'stop' }] });
  const approved = value(await execute(s.engine, 'finish.approveTurn', finishApprove(turn)));
  value(await s.engine.scheduler.run(approved.task.attemptId));
  value(await execute(s.engine, 'finish.stop', { runId: turn.runId, executionOwner: 'human' }));
  value(await s.engine.finish.wake());
  const stopped = value(s.engine.finish.run(turn.runId));
  expect(stopped).toMatchObject({ state: 'STOPPED', harvested: true });
  expect(stopped.proposal).not.toBeNull();
  expect(await execute(s.engine, 'finish.acceptProposal', finishAcceptance(stopped, ['new-line']))).toMatchObject({ ok: false, error: { code: 'FINISH_STOPPED' } });
  expect(value(s.engine.audio.read({ projectId })).voiceLines).toEqual([]);
  value(await s.engine.close());
  const reopened = await s.open();
  value(await reopened.finish.start());
  expect(value(reopened.finish.run(turn.runId)).messages).toHaveLength(2);
  expect(s.requests).toHaveLength(1);
});

it('persists a plain reply, rejects changed models and isolates invalid aliases', async () => {
  const s = await nativeFixture();
  const { targets, projectId } = await voiceSetup(s);
  const first = await finishPrepared(s, 'finish-voice-lines', targets);
  s.response({ choices: [{ message: { content: JSON.stringify({ ...body, lines: [] }) }, finish_reason: 'stop' }] });
  const approved = value(await execute(s.engine, 'finish.approveTurn', finishApprove(first.turn)));
  value(await s.engine.scheduler.run(approved.task.attemptId));
  value(await s.engine.finish.wake());
  expect(value(s.engine.finish.run(first.turn.runId))).toMatchObject({ state: 'REPLIED', proposal: null });

  const second = await finishPrepared(s, 'finish-voice-lines', targets);
  value(await execute(s.engine, 'profile.save', { id: 'native', expectedRevision: 1, name: 'Changed', modelRef: second.turn.generation.config.profile.modelRef, parameters: { max_tokens: 512 } }));
  expect(await execute(s.engine, 'finish.approveTurn', finishApprove(second.turn))).toMatchObject({ ok: false, error: { code: 'CONFIG_CHANGED' } });
  expect(s.engine.generation.list().tasks).toHaveLength(1);

  const third = await finishPrepared(s, 'finish-voice-lines', targets, { profileRef: { libraryId: s.engine.identity.libraryId, id: 'native', revision: 2 } });
  s.response({ choices: [{ message: { content: JSON.stringify({ ...body, lines: [{ key: 'new-line', text: 'x', shotKey: 'missing' }] }) }, finish_reason: 'stop' }] });
  const thirdRun = value(await execute(s.engine, 'finish.approveTurn', finishApprove(third.turn)));
  value(await s.engine.scheduler.run(thirdRun.task.attemptId));
  value(await s.engine.finish.wake());
  expect(value(s.engine.finish.run(third.turn.runId)).state).toBe('INVALID');
  expect(value(s.engine.audio.read({ projectId })).voiceLines).toEqual([]);
  expect(s.requests).toHaveLength(2);
});
