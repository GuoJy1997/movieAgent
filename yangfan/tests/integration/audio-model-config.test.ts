import { expect, it } from 'vitest';
import { adapterDefaults } from '../../packages/domain/src/model-config.ts';
import { parseSaveConnection, parseSaveModel } from '../../packages/contracts/src/models.ts';
import { audioBillingUnits, normalizeTranscript } from '../../packages/providers/src/audio-protocol.ts';
import { afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudioOnboarding } from '../../apps/desktop/src/main/audio-onboarding.ts';
import { modelConfigStore } from '../../apps/desktop/src/main/model-config-store.ts';
import { parseModelConfigFile } from '../../apps/desktop/src/main/model-config-file.ts';

it.each(['openai-speech-v1', 'minimax-speech-v1', 'openai-transcription-v1', 'minimax-transcription-v1'] as const)('accepts %s as an explicit audio capability', adapter => {
  const connection = parseSaveConnection({ id: 'c', expectedRevision: 0, name: 'Audio', adapterType: adapter, baseUrl: 'https://example.com/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 30000, concurrency: 1 });
  expect(connection.ok).toBe(true);
  const defaults = adapterDefaults(adapter);
  const model = parseSaveModel({ id: 'm', expectedRevision: 0, name: 'Audio', modelId: 'manual-audio-id', connectionRef: { libraryId: 'l', id: 'c', revision: 1 }, ...defaults });
  expect(model.ok).toBe(true);
  expect(defaults.capabilities.taskTypes[0]).toBe(adapter.includes('transcription') ? 'speech_to_text' : 'text_to_speech');
});

it('counts native MiniMax Han billing units separately from codepoints', () => {
  expect(audioBillingUnits('minimax-speech-v1', '你好，这是短剧配音测试。')).toBe(22);
  expect(audioBillingUnits('minimax-speech-v1', '中A， 🙂\n')).toBe(7);
  expect(audioBillingUnits('openai-speech-v1', '中A， 🙂\n')).toBe(6);
});

it('never invents timed cues for plain transcription text', () => {
  expect(normalizeTranscript({ text: 'hello' }, 48000)).toEqual({ ok: true, value: { text: 'hello', timing: 'none', segments: [] } });
});

it.each([NaN, -1, 2])('rejects invalid or out-of-source segment endpoints (%s)', end => {
  expect(normalizeTranscript({ text: 'hello', segments: [{ start: 0, end, text: 'hello' }] }, 48000).ok).toBe(false);
});

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
it('requires a fingerprint-bound finite test approval and invalidates changed audio settings before save', async () => {
  const requests: { method: string; body: Buffer; authorization?: string }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { requests.push({ method: req.method!, body: Buffer.concat(chunks), authorization: req.headers.authorization }); res.end(req.method === 'GET' ? JSON.stringify({ data: [] }) : Buffer.from('RIFF0000WAVEfmt ')); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('port');
  const root = await mkdtemp(join(tmpdir(), 'audio-onboarding-')), path = join(root, 'models.json');
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const provider = { id: 'speech', name: 'Fixture speech', kind: 'speech', baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture-secret-audio', modelId: 'manual-not-listed', allowPrivateEndpoint: true, adapterType: 'openai-speech-v1', parameters: { voice: 'manual-voice' }, pricing: { status: 'unknown' } };
  await writeFile(path, JSON.stringify({ schemaVersion: 2, providers: [provider] }));
  const store = modelConfigStore(path), current = await store.readPublic(); if (!current.ok) throw Error(current.error.code);
  const input = { expectedVersion: current.value.version, provider: { ...provider, apiKey: '', clearKey: false } };
  let time = 100;
  const service = createAudioOnboarding(store, { now: () => time });
  expect(await service.listModels(input)).toMatchObject({ ok: true, value: { models: [] } });
  const prepared = await service.prepareTest(input); if (!prepared.ok) throw Error(prepared.error.code);
  expect(requests).toHaveLength(1);
  expect(Array.from(prepared.value.summary).length).toBeLessThanOrEqual(20);
  expect((await service.runTest({ ...input, ...prepared.value, approval: { currency: 'CNY', allowanceMicros: Infinity, budgetLimitMicros: 1, acknowledgeUnknown: true } })).ok).toBe(false);
  expect(requests).toHaveLength(1);
  const next = await service.prepareTest(input); if (!next.ok) throw Error(next.error.code);
  const tested = await service.runTest({ ...input, testId: next.value.testId, planHash: next.value.planHash, approval: { currency: 'CNY', allowanceMicros: 10000, budgetLimitMicros: 10000, acknowledgeUnknown: true } });
  if (!tested.ok) throw Error(tested.error.code);
  expect(requests).toHaveLength(2);
  expect(requests[1]!.authorization).toBe('Bearer fixture-secret-audio');
  expect(Object.keys(tested.value)).toEqual(['receipt']);
  for (const change of [{ baseURL: provider.baseURL + '/changed' }, { apiKey: 'changed-secret' }, { modelId: 'changed-model' }, { parameters: { voice: 'changed-voice' } }, { parameters: { voice: 'manual-voice', speedMilli: 1200 } }]) {
    expect((await service.authorize({ ...input, provider: { ...input.provider, ...change }, testReceipt: tested.value.receipt })).ok).toBe(false);
  }
  time += 600000;
  expect((await service.saveVerified({ ...input, testReceipt: tested.value.receipt })).ok).toBe(false);
  const finalPlan = await service.prepareTest(input); if (!finalPlan.ok) throw Error(finalPlan.error.code);
  const finalTest = await service.runTest({ ...input, testId: finalPlan.value.testId, planHash: finalPlan.value.planHash, approval: { currency: 'CNY', allowanceMicros: 10000, budgetLimitMicros: 10000, acknowledgeUnknown: true } });
  if (!finalTest.ok) throw Error(finalTest.error.code);
  expect((await service.saveVerified({ ...input, testReceipt: finalTest.value.receipt })).ok).toBe(true);
});

it('preserves V1 model files and distinguishes ASR from ordinary text in V2 files', () => {
  expect(parseModelConfigFile({ schemaVersion: 1, providers: [{ id: 'old', name: 'Old', kind: 'text', baseURL: '', apiKey: '', modelId: '', allowPrivateEndpoint: false }] }, 'fixture').ok).toBe(true);
  const entry = { id: 'asr', name: 'ASR', kind: 'transcription', baseURL: '', apiKey: '', modelId: '', allowPrivateEndpoint: false, adapterType: 'minimax-transcription-v1', parameters: { response_format: 'verbose_json', timestamps: 'segments' }, pricing: { status: 'configured', currency: 'CNY', perAudioSecond: 0.001, version: 'fixture' } };
  expect(parseModelConfigFile({ schemaVersion: 2, providers: [entry] }, 'fixture').ok).toBe(true);
  expect(parseModelConfigFile({ schemaVersion: 2, providers: [{ ...entry, kind: 'text' }] }, 'fixture').ok).toBe(false);
});

it('requires licensed onboarding audio no longer than five seconds before any ASR POST', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audio-asr-onboarding-')), path = join(root, 'models.json');
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const provider = { id: 'asr', name: 'ASR', kind: 'transcription', baseURL: 'https://fixture.invalid/v1', apiKey: 'fixture-audio-secret', modelId: 'manual-asr', allowPrivateEndpoint: false, adapterType: 'openai-transcription-v1', parameters: {}, pricing: { status: 'unknown' } };
  await writeFile(path, JSON.stringify({ schemaVersion: 2, providers: [provider] }));
  const store = modelConfigStore(path), current = await store.readPublic(); if (!current.ok) throw Error(current.error.code);
  const input = { expectedVersion: current.value.version, provider: { ...provider, apiKey: '', clearKey: false } };
  let picks = 0;
  const service = createAudioOnboarding(store, { pickSource: async () => { picks++; return { ok: true, value: { bytes: Buffer.from('fixture'), mime: 'audio/wav', durationTicks: 6 * 48000 } }; } });
  expect(await service.prepareTest(input)).toMatchObject({ ok: false, error: { code: 'AUDIO_TEST_LICENSE' } });
  expect(picks).toBe(0);
  expect(await service.prepareTest({ ...input, licensed: true })).toMatchObject({ ok: false, error: { code: 'AUDIO_TEST_LIMIT' } });
  expect(picks).toBe(1);
});
