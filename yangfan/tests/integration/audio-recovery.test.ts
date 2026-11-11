import { expect, it } from 'vitest';
import { parsePrepareSpeech, parseSaveTranscript } from '../../packages/contracts/src/audio.ts';
import { audioFixture, audioExecute, audioValue } from '../fixtures/audio-generation.ts';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

it('bounds speech batches before preparing paid tasks', () => {
  const line = { lineId: 'line', revision: 1, profileRef: { libraryId: 'l', id: 'p', revision: 1 } };
  expect(parsePrepareSpeech({ projectId: 'p', executionOwner: 'o', runId: 'r', lines: Array.from({ length: 17 }, () => line) }).ok).toBe(false);
});

it('requires untimed transcripts to contain no cue segments', () => {
  expect(parseSaveTranscript({ projectId: 'p', id: 't', expectedRevision: 0, text: 'hello', timing: 'none', segments: [{ startTicks: 0, endTicks: 48000, text: 'hello' }] }).ok).toBe(false);
});

it('approves a whole batch atomically, preserves task identity and publishes each take only once', async () => {
  const s = await audioFixture(), plan = await s.batch(['hello', 'world']);
  const payload = { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval };
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', payload));
  expect(approved.tasks).toHaveLength(2);
  expect(audioValue(await audioExecute(s.engine, 'audio.approveSpeech', payload)).tasks).toEqual(approved.tasks);
  for (const task of approved.tasks) expect(audioValue(await s.engine.scheduler.run(task.attemptId)).state).toBe('SUCCEEDED');
  expect(s.requests).toHaveLength(2);
  const snapshot = audioValue((s.engine as any).audio.read({ projectId: s.projectId }));
  expect(snapshot.takes).toHaveLength(2);
  await s.engine.close();
  const reopened = await s.open(); audioValue(await reopened.scheduler.recover());
  expect(audioValue((reopened as any).audio.read({ projectId: s.projectId })).takes).toHaveLength(2);
  expect(s.requests).toHaveLength(2);
});

it('rolls back every child on aggregate budget conflict and stops before the first POST', async () => {
  const s = await audioFixture(), plan = await s.batch(['one', 'two']);
  const payload = { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: { ...s.approval, budgetLimitMicros: 1 } };
  expect((await audioExecute(s.engine, 'audio.approveSpeech', payload)).ok).toBe(false);
  expect(s.engine.generation.list().tasks).toHaveLength(0);
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { ...payload, approval: s.approval }));
  audioValue(await audioExecute(s.engine, 'audio.stopBatch', { projectId: s.projectId, planId: plan.planId, executionOwner: 'human' }));
  for (const task of approved.tasks) await s.engine.scheduler.run(task.attemptId);
  expect(s.requests).toHaveLength(0);
});

it('never reposts a non-idempotent speech submission after connection loss and reopening', async () => {
  const s = await audioFixture(), plan = await s.batch(); s.cut();
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  const task = approved.tasks[0];
  expect(audioValue(await s.engine.scheduler.run(task.attemptId)).state).toBe('SUBMISSION_UNKNOWN');
  await s.engine.close(); const reopened = await s.open(); audioValue(await reopened.scheduler.recover());
  expect(audioValue(reopened.generation.read(task.taskId)).state).toBe('RECONCILE_REQUIRED');
  await reopened.scheduler.run(task.attemptId);
  expect(s.requests).toHaveLength(1);
});

it('isolates per-item collection failure and retries only collection with no new POST', async () => {
  let fail = true;
  const s = await audioFixture('openai-speech-v1', { onPhase: phase => { if (phase === 'staging' && fail) { fail = false; throw Error('fixture disk interruption'); } } });
  const plan = await s.batch(['one', 'two']);
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  expect(audioValue(await s.engine.scheduler.run(approved.tasks[0].attemptId)).collectionState).toBe('retryable_failure');
  expect(audioValue(await s.engine.scheduler.run(approved.tasks[1].attemptId)).state).toBe('SUCCEEDED');
  audioValue(await audioExecute(s.engine, 'task.retryCollection', { taskId: approved.tasks[0].taskId }));
  expect(audioValue(s.engine.audio.read({ projectId: s.projectId })).takes).toHaveLength(2);
  expect(s.requests).toHaveLength(2);
});

it('rejects stale whole-batch line revisions and bypass of the batch authorization', async () => {
  const s = await audioFixture(), plan = await s.batch(['original', 'other']);
  const child = plan.items[0].prepared;
  expect((await audioExecute(s.engine, 'generation.approveAndEnqueue', { preparedId: child.preparedId, approvedPlanHash: child.planHash, executionOwner: 'human', runId: 'run', ...s.approval })).ok).toBe(false);
  audioValue(await audioExecute(s.engine, 'audio.saveVoiceLine', { projectId: s.projectId, id: 'line0', expectedRevision: 1, text: 'edited' }));
  expect((await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval })).ok).toBe(false);
  expect(s.engine.generation.list().tasks).toHaveLength(0);
  expect(audioValue(s.engine.audio.read({ projectId: s.projectId })).voiceLines.map((line: any) => line.text)).toEqual(['original', 'other', 'edited']);
  expect(s.requests).toHaveLength(0);
});

it('rechecks stop while a paid response is pending and never starts the remaining item', async () => {
  const s = await audioFixture(), plan = await s.batch(['one', 'two']);
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  const release = s.holdResponse(), pending = s.engine.scheduler.run(approved.tasks[0].attemptId);
  await expect.poll(() => s.requests.length).toBe(1);
  audioValue(await audioExecute(s.engine, 'audio.stopBatch', { projectId: s.projectId, planId: plan.planId, executionOwner: 'human' }));
  release(); expect(audioValue(await pending).collectionState).toBe('durable');
  expect(audioValue(await s.engine.scheduler.run(approved.tasks[1].attemptId)).state).toBe('CANCELLED');
  expect(s.requests).toHaveLength(1);
});

it('keeps a timed-out speech POST unknown and does not retry it during recovery', async () => {
  const s = await audioFixture(), plan = await s.batch();
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  const release = s.holdResponse();
  expect(audioValue(await s.engine.scheduler.run(approved.tasks[0].attemptId)).state).toBe('SUBMISSION_UNKNOWN');
  release(); audioValue(await s.engine.scheduler.recover());
  expect(s.requests).toHaveLength(1);
});

it('protects frozen batch plans, consumed approval receipts and immutable voice revisions in SQLite', async () => {
  const s = await audioFixture(), plan = await s.batch();
  audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  const db = new DatabaseSync(join(s.root, 'library.sqlite'));
  try {
    expect(() => db.prepare('UPDATE voice_line_revision SET data_json=?').run('{}')).toThrow();
    expect(() => db.prepare('UPDATE audio_batch SET plan_json=? WHERE plan_id=?').run('{}', plan.planId)).toThrow();
    expect(() => db.prepare('UPDATE audio_batch SET approval_json=? WHERE plan_id=?').run('{}', plan.planId)).toThrow();
    expect(() => db.prepare('UPDATE audio_batch_item SET line_revision=2 WHERE plan_id=?').run(plan.planId)).toThrow();
  } finally { db.close(); }
});
