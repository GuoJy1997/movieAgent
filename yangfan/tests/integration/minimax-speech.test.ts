import { expect, it } from 'vitest';
import { audioExecute, audioFixture, audioValue } from '../fixtures/audio-generation.ts';

it('executes native t2a_v2 hex audio through the production credential and HTTP capability', async () => {
  const s = await audioFixture('minimax-speech-v1');
  s.response({ base_resp: { status_code: 0 }, data: { audio: Buffer.from('RIFF0000WAVEfmt ').toString('hex') }, extra_info: { usage_characters: 22 } });
  const plan = await s.batch(['你好，这是短剧配音测试。']);
  expect(plan.items[0].prepared.audioBilling).toEqual({ rule: 'minimax-weighted-han', units: 22 });
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  const done = audioValue(await s.engine.scheduler.run(approved.tasks[0].attemptId));
  expect(done.state).toBe('SUCCEEDED');
  expect(audioValue(s.engine.audio.read({ projectId: s.projectId })).takes[0].providerUsage).toEqual({ usageCharacters: 22 });
  expect(s.requests[0]!.url).toBe('/v1/t2a_v2');
  expect(s.requests[0]!.headers.authorization).toBe('Bearer fixture-audio-key');
  expect(JSON.parse(s.requests[0]!.body.toString())).toEqual({ model: 'manual-audio', text: '你好，这是短剧配音测试。', stream: false, voice_setting: { voice_id: 'manual-voice' } });
});

it.each([
  { response: { base_resp: { status_code: 1000 }, data: { audio: 'aabb' } }, providerState: 'rejected', errorCode: 'PROVIDER_REJECTED' },
  { response: { base_resp: { status_code: 0 }, data: { audio: 'zz' } }, providerState: 'completed', errorCode: 'OUTPUT_UNAVAILABLE' },
  { response: { base_resp: { status_code: 0 }, data: { audio: 'abc' } }, providerState: 'completed', errorCode: 'OUTPUT_UNAVAILABLE' },
])('preserves understood native acknowledgement $providerState without publishing invalid audio', async ({ response, providerState, errorCode }) => {
  const s = await audioFixture('minimax-speech-v1'); s.response(response);
  const plan = await s.batch();
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  const task = approved.tasks[0]; audioValue(await s.engine.scheduler.run(task.attemptId));
  expect(audioValue(s.engine.generation.read(task.taskId))).toMatchObject({
    providerState, errorCode, artifactRef: null,
    reservationMicros: s.approval.allowanceMicros, settlementStatus: 'unknown',
  });
  await s.engine.close(); const reopened = await s.open(); await reopened.scheduler.recover();
  expect(s.requests).toHaveLength(1);
});

it.each([
  { label: 'absent base_resp', response: { data: { audio: 'aabb' } } },
  { label: 'null base_resp', response: { base_resp: null } },
  { label: 'array base_resp', response: { base_resp: [] } },
  { label: 'missing status', response: { base_resp: {} } },
  { label: 'string status', response: { base_resp: { status_code: '0' } } },
  { label: 'null status', response: { base_resp: { status_code: null } } },
  { label: 'fractional status', response: { base_resp: { status_code: 1.5 } } },
  { label: 'unparseable JSON', response: Buffer.from('{invalid') },
])('keeps native speech $label unknown with one POST and its reservation across recovery', async ({ response }) => {
  const s = await audioFixture('minimax-speech-v1');
  s.response(response);
  const plan = await s.batch();
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', {
    planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval,
  }));
  const task = approved.tasks[0];
  const retained = {
    providerState: 'unknown', artifactRef: null,
    reservationMicros: s.approval.allowanceMicros, settlementStatus: 'unknown',
  };
  expect(audioValue(await s.engine.scheduler.run(task.attemptId))).toMatchObject({ state: 'SUBMISSION_UNKNOWN', ...retained });
  await s.engine.close();
  const reopened = await s.open();
  audioValue(await reopened.scheduler.recover());
  expect(audioValue(reopened.generation.read(task.taskId))).toMatchObject({ state: 'RECONCILE_REQUIRED', ...retained });
  await reopened.scheduler.run(task.attemptId);
  expect(audioValue(reopened.generation.read(task.taskId))).toMatchObject(retained);
  expect(audioValue(reopened.audio.read({ projectId: s.projectId })).takes).toEqual([]);
  expect(s.requests).toHaveLength(1);
});
