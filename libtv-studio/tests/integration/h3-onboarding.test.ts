import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelConfigStore } from '../../apps/desktop/src/main/model-config-store.ts';
import { createAudioOnboarding } from '../../apps/desktop/src/main/audio-onboarding.ts';
import { fixtureWav } from '../fixtures/audio-generation.ts';

it('binds the protected H3 capability receipt to the exact config and fixed audio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h3-onboarding-'));
  const requests: Buffer[] = [];
  const server = createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { requests.push(Buffer.concat(chunks)); res.end(JSON.stringify({ task_id: 'h3-onboarding-task' })); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('address');
    const path = join(root, 'models.json'); await writeFile(path, JSON.stringify({ schemaVersion: 2, providers: [] }));
    const store = modelConfigStore(path), initial = await store.readPrivate(); expect(initial.ok).toBe(true); if (!initial.ok) return;
    const provider = { id: 'h3', name: 'H3', kind: 'video', baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture-key', modelId: 'MiniMax-H3', allowPrivateEndpoint: true, adapterType: 'minimax-h3-v2', parameters: {}, pricing: { status: 'unknown' }, clearKey: false };
    const onboarding = createAudioOnboarding(store, { pickSource: async () => ({ ok: true, value: { bytes: fixtureWav(2), mime: 'audio/wav', durationTicks: 96000 } }) });
    const prepared = await onboarding.prepareTest({ expectedVersion: initial.value.version, provider, licensed: true });
    expect(prepared).toMatchObject({ ok: true }); if (!prepared.ok) return;
    const run = await onboarding.runTest({ expectedVersion: initial.value.version, provider, testId: prepared.value.testId, planHash: prepared.value.planHash, approval: { currency: 'CNY', allowanceMicros: 1000000, budgetLimitMicros: 1000000, acknowledgeUnknown: true } });
    expect(run).toMatchObject({ ok: true }); if (!run.ok) return;
    const saved = await onboarding.saveVerified({ expectedVersion: initial.value.version, provider, testReceipt: run.value.receipt });
    expect(saved).toMatchObject({ ok: true });
    expect(requests).toHaveLength(1);
    const body = JSON.parse(requests[0]!.toString());
    expect(body.content.some((item: any) => item.type === 'audio_url' && item.role === 'reference_audio')).toBe(true);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
