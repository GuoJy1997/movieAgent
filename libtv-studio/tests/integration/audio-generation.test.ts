import { expect, it } from 'vitest';
import { encodeSpeechRequest, encodeTranscriptionRequest } from '../../packages/providers/src/audio-protocol.ts';
import { audioExecute, audioFixture, audioValue, fixtureWav } from '../fixtures/audio-generation.ts';
import { fileModelDefaults } from '../../packages/domain/src/model-config.ts';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

it('refuses 4001 characters before constructing a speech POST', () => {
  expect(encodeSpeechRequest('openai-speech-v1', 'manual-model', 'x'.repeat(4001), { voice: 'alloy' }).ok).toBe(false);
});

it('refuses 24000001 upload bytes before constructing multipart', () => {
  expect(encodeTranscriptionRequest('openai-transcription-v1', 'manual-model', { hash: 'a'.repeat(64), mime: 'audio/wav', byteLength: 24000001, durationTicks: 48000 }, {}, Buffer.alloc(0)).ok).toBe(false);
});

it('uses actual fixed bytes and safe filename/MIME, omitting optional capabilities', () => {
  const bytes = Buffer.from('RIFF-local-fixture');
  const result = encodeTranscriptionRequest('openai-transcription-v1', 'manual-model', { hash: '', mime: 'audio/wav', byteLength: bytes.length, durationTicks: 48000 }, {}, bytes);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(result.value.body.includes(bytes)).toBe(true);
  expect(result.value.body.toString()).toContain('filename="source.wav"\r\nContent-Type: audio/wav');
  expect(result.value.body.toString()).not.toMatch(/name="(?:language|languages|response_format|timestamp_granularities\[\])"/);
});

it('collects generated PCM WAV using the same pinned native decoder as imported audio', async () => {
  const s = await audioFixture('openai-speech-v1', { native: true });
  const bytes = fixtureWav(); s.response(bytes);
  const plan = await s.batch();
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  const done = audioValue(await s.engine.scheduler.run(approved.tasks[0].attemptId));
  expect(done.state).toBe('SUCCEEDED');
  expect(audioValue(s.engine.assets.metadata(done.artifactRef))).toMatchObject({ mime: 'audio/wav', width: 0, height: 0, byteLength: bytes.length });
  expect(s.requests[0]!.url).toBe('/v1/audio/speech');
  expect(JSON.parse(s.requests[0]!.body.toString())).toEqual({ model: 'manual-audio', input: 'hello', voice: 'manual-voice' });
}, 30000);

it('freezes configured weighted-character pricing and reserves the total finite batch amount', async () => {
  const s = await audioFixture('minimax-speech-v1');
  const modelRef = audioValue(await audioExecute(s.engine, 'model.saveDefinition', { id: 'priced', expectedRevision: 0, name: 'Priced speech', modelId: 'manual-priced', connectionRef: s.connectionRef, ...fileModelDefaults('minimax-speech-v1', { voice: 'manual-voice' }), pricing: { status: 'configured', currency: 'CNY', perThousandCharacters: 1, version: 'fixture-user-price' } }));
  const profileRef = audioValue(await audioExecute(s.engine, 'profile.save', { id: 'priced', expectedRevision: 0, name: 'Priced speech', modelRef, parameters: {} }));
  audioValue(await audioExecute(s.engine, 'audio.saveVoiceLine', { projectId: s.projectId, id: 'priced', expectedRevision: 0, text: '中A，' }));
  const plan = audioValue(await audioExecute(s.engine, 'audio.prepareSpeech', { projectId: s.projectId, lines: [{ lineId: 'priced', revision: 1, profileRef }], executionOwner: 'human', runId: 'priced' }));
  expect(plan.items[0].prepared.audioBilling).toEqual({ rule: 'minimax-weighted-han', units: 4 });
  expect(plan.estimateMicros).toBe(4000);
  const request = { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'priced', approval: { currency: 'CNY', allowanceMicros: 3999, budgetLimitMicros: 100000, acknowledgeUnknown: false } };
  expect((await audioExecute(s.engine, 'audio.approveSpeech', request)).ok).toBe(false);
  audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { ...request, approval: { ...request.approval, allowanceMicros: 5000 } }));
  expect(s.engine.generation.list().tasks[0]!.reservationMicros).toBe(5000);
  expect(s.requests).toHaveLength(0);
});

it.each([
  ['mp3', 'libmp3lame', 'audio/mpeg'],
  ['m4a', 'aac', 'audio/mp4'],
  ['wav', 'pcm_s24le', 'audio/wav'],
] as const)('collects generated %s/%s audio with verified native decoding', async (extension, codec, mime) => {
  const s = await audioFixture('openai-speech-v1', { native: true });
  const source = join(s.root, 'native-source.wav'), output = join(s.root, 'native-output.' + extension);
  await writeFile(source, fixtureWav());
  const encoded = spawnSync(s.runtime!.ffmpegPath, ['-hide_banner', '-nostdin', '-i', source, '-c:a', codec, '-threads', '4', output], { shell: false, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  expect(encoded.status, String(encoded.stderr)).toBe(0);
  s.response(await readFile(output));
  const plan = await s.batch();
  const approved = audioValue(await audioExecute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'run', approval: s.approval }));
  const done = audioValue(await s.engine.scheduler.run(approved.tasks[0].attemptId));
  expect(done.state).toBe('SUCCEEDED');
  expect(audioValue(s.engine.assets.metadata(done.artifactRef)).mime).toBe(mime);
  expect(s.requests).toHaveLength(1);
}, 30000);
