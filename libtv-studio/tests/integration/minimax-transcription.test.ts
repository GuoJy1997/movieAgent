import { expect, it } from 'vitest';
import { audioExecute, audioFixture, audioValue, fixtureWav } from '../fixtures/audio-generation.ts';
import { encodeTranscriptionRequest } from '../../packages/providers/src/audio-protocol.ts';

it('enforces native MiniMax 500 seconds before POST while generic ASR permits 600', () => {
  const bytes = Buffer.from('fixture');
  const source = { mime: 'audio/wav', hash: '', byteLength: bytes.length, durationTicks: 501 * 48000 };
  expect(encodeTranscriptionRequest('minimax-transcription-v1', 'manual', source, {}, bytes).ok).toBe(false);
  expect(encodeTranscriptionRequest('openai-transcription-v1', 'manual', source, {}, bytes).ok).toBe(true);
});

it.each(['minimax-transcription-v1', 'openai-transcription-v1'] as const)('executes %s fixed audio multipart and publishes immutable timed transcript once', async adapter => {
  const s = await audioFixture(adapter, { native: true, parameters: { response_format: 'verbose_json', timestamps: 'segments' } });
  s.response({ text: 'hello', segments: [{ start: 0.1, end: 0.8, text: 'hello' }], ...(adapter.startsWith('minimax') ? { base_resp: { status_code: 0 } } : {}) });
  const bytes = fixtureWav(), source = await s.importAudio(bytes);
  const prepared = audioValue(await audioExecute(s.engine, 'audio.prepareTranscription', { projectId: s.projectId, source, profileRef: s.profileRef, executionOwner: 'human', runId: 'asr' }));
  const task = audioValue(await audioExecute(s.engine, 'generation.approveAndEnqueue', { preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, executionOwner: 'human', runId: 'asr', ...s.approval }));
  const done = audioValue(await s.engine.scheduler.run(task.attemptId)); expect(done.state).toBe('SUCCEEDED');
  expect(s.requests[0]!.url).toBe(adapter.startsWith('minimax') ? '/v1/speech_to_text' : '/v1/audio/transcriptions');
  expect(s.requests[0]!.headers.authorization).toBe('Bearer fixture-audio-key');
  expect(s.requests[0]!.body.includes(bytes)).toBe(true);
  expect(s.requests[0]!.body.toString()).toContain('filename="source.wav"\r\nContent-Type: audio/wav');
  expect(s.requests[0]!.body.toString()).toContain('name="response_format"\r\n\r\nverbose_json');
  expect(audioValue(s.engine.audio.read({ projectId: s.projectId })).transcripts).toMatchObject([{ timing: 'segments', source, sourceHash: prepared.audioSource.hash, segments: [{ startTicks: 4800, endTicks: 38400, text: 'hello' }] }]);
  await s.engine.close(); const reopened = await s.open(); audioValue(await reopened.scheduler.recover());
  expect(audioValue(reopened.audio.read({ projectId: s.projectId })).transcripts).toHaveLength(1);
  expect(s.requests).toHaveLength(1);
}, 30000);

it('keeps invalid timestamp response as a diagnostic artifact without publishing subtitle segments', async () => {
  const s = await audioFixture('minimax-transcription-v1', { native: true });
  s.response({ base_resp: { status_code: 0 }, text: 'hello', segments: [{ start: 0, end: 3, text: 'hello' }] });
  const source = await s.importAudio(fixtureWav());
  const prepared = audioValue(await audioExecute(s.engine, 'audio.prepareTranscription', { projectId: s.projectId, source, profileRef: s.profileRef, executionOwner: 'human', runId: 'bad-timing' }));
  const task = audioValue(await audioExecute(s.engine, 'generation.approveAndEnqueue', { preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, executionOwner: 'human', runId: 'bad-timing', ...s.approval }));
  const done = audioValue(await s.engine.scheduler.run(task.attemptId));
  const snapshot = audioValue(s.engine.audio.read({ projectId: s.projectId }));
  expect(snapshot.transcripts).toEqual([]);
  expect(snapshot.diagnostics).toMatchObject([{ task, code: 'INVALID_TRANSCRIPT_TIMING', rawOutput: done.artifactRef }]);
  audioValue(await audioExecute(s.engine, 'task.retryCollection', { taskId: task.taskId }));
  expect(s.requests).toHaveLength(1);
}, 30000);

it('publishes plain text ASR with timing none and allows immutable manual text edits', async () => {
  const s = await audioFixture('openai-transcription-v1', { native: true });
  s.response({ text: 'hello' });
  const source = await s.importAudio(fixtureWav());
  const prepared = audioValue(await audioExecute(s.engine, 'audio.prepareTranscription', { projectId: s.projectId, source, profileRef: s.profileRef, executionOwner: 'human', runId: 'plain' }));
  const task = audioValue(await audioExecute(s.engine, 'generation.approveAndEnqueue', { preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, executionOwner: 'human', runId: 'plain', ...s.approval }));
  audioValue(await s.engine.scheduler.run(task.attemptId));
  const original = audioValue(s.engine.audio.read({ projectId: s.projectId })).transcripts[0];
  expect(original).toMatchObject({ timing: 'none', segments: [], source });
  audioValue(await audioExecute(s.engine, 'audio.saveTranscript', { projectId: s.projectId, id: original.id, expectedRevision: 1, text: 'edited', segments: [], timing: 'none' }));
  expect(audioValue(s.engine.audio.read({ projectId: s.projectId })).transcripts.map((item: any) => item.text)).toEqual(['hello', 'edited']);
  expect(s.requests[0]!.body.toString()).not.toMatch(/name="(?:response_format|language|languages|timestamp_granularities\[\])"/);
}, 30000);

it.each([
  { label: 'null base_resp', response: { base_resp: null, text: 'hello' } },
  { label: 'array base_resp', response: { base_resp: [], text: 'hello' } },
  { label: 'missing status', response: { base_resp: {}, text: 'hello' } },
  { label: 'string status', response: { base_resp: { status_code: '0' }, text: 'hello' } },
  { label: 'null status', response: { base_resp: { status_code: null }, text: 'hello' } },
  { label: 'fractional status', response: { base_resp: { status_code: 1.5 }, text: 'hello' } },
  { label: 'unparseable JSON', response: Buffer.from('{invalid') },
])('keeps native ASR $label unknown with one POST and its reservation across recovery', async ({ response }) => {
  const s = await audioFixture('minimax-transcription-v1', { native: true });
  s.response(response);
  const source = await s.importAudio(fixtureWav());
  const prepared = audioValue(await audioExecute(s.engine, 'audio.prepareTranscription', {
    projectId: s.projectId, source, profileRef: s.profileRef, executionOwner: 'human', runId: 'asr',
  }));
  const task = audioValue(await audioExecute(s.engine, 'generation.approveAndEnqueue', {
    preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, executionOwner: 'human', runId: 'asr', ...s.approval,
  }));
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
  expect(audioValue(reopened.audio.read({ projectId: s.projectId })).transcripts).toEqual([]);
  expect(s.requests).toHaveLength(1);
}, 30000);

it.each([
  { label: 'no base_resp success', response: { text: 'hello' }, providerState: 'completed', state: 'SUCCEEDED' },
  { label: 'explicit native rejection', response: { base_resp: { status_code: 1000 }, text: 'hello' }, providerState: 'rejected', state: 'FAILED' },
])('preserves native ASR $label', async ({ response, providerState, state }) => {
  const s = await audioFixture('minimax-transcription-v1', { native: true });
  s.response(response);
  const source = await s.importAudio(fixtureWav());
  const prepared = audioValue(await audioExecute(s.engine, 'audio.prepareTranscription', {
    projectId: s.projectId, source, profileRef: s.profileRef, executionOwner: 'human', runId: 'asr',
  }));
  const task = audioValue(await audioExecute(s.engine, 'generation.approveAndEnqueue', {
    preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, executionOwner: 'human', runId: 'asr', ...s.approval,
  }));
  const retained = { providerState, state, reservationMicros: s.approval.allowanceMicros, settlementStatus: 'unknown' };
  expect(audioValue(await s.engine.scheduler.run(task.attemptId))).toMatchObject(retained);
  const transcripts = audioValue(s.engine.audio.read({ projectId: s.projectId })).transcripts;
  if (state === 'SUCCEEDED') expect(transcripts).toMatchObject([{ text: 'hello', timing: 'none', segments: [], source }]);
  else expect(transcripts).toEqual([]);
  await s.engine.close();
  const reopened = await s.open();
  audioValue(await reopened.scheduler.recover());
  expect(audioValue(reopened.generation.read(task.taskId))).toMatchObject(retained);
  expect(audioValue(reopened.audio.read({ projectId: s.projectId })).transcripts).toHaveLength(transcripts.length);
  expect(s.requests).toHaveLength(1);
}, 30000);
