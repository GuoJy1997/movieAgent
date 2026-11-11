import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { prepareVoiceInput } from '../../packages/engine/src/media/voice-input.ts';
import { probeMediaFile } from '../../packages/engine/src/media/probe.ts';

it('prepares a 48kHz mono PCM-s16 WAV with a stable hash and rejects out-of-range cuts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-input-'));
  try {
    const runtimeResult = await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64'));
    expect(runtimeResult.ok).toBe(true); if (!runtimeResult.ok) return;
    const runtime = runtimeResult.value, input = join(root, 'source.wav'), output = join(root, 'prepared.wav');
    const encoded = spawnSync(runtime.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=3', '-ac', '2', '-c:a', 'pcm_s16le', input], { shell: false, windowsHide: true });
    expect(encoded.status).toBe(0);
    const prepared = await prepareVoiceInput({ runtime, input, output, stagingRoot: root, sourceInTicks: 48000, durationTicks: 96000 });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    expect(prepared.value).toMatchObject({ mime: 'audio/wav', durationTicks: 96000 });
    const probe = await probeMediaFile(runtime, output, root, prepared.value.hash);
    expect(probe).toMatchObject({ ok: true, value: { container: 'wav', hasAudio: true } });
    if (probe.ok) expect(probe.value.streams[0]).toMatchObject({ codec: 'pcm_s16le', sampleRate: 48000, channels: 1 });
    expect((await prepareVoiceInput({ runtime, input, output, stagingRoot: root, sourceInTicks: 0, durationTicks: 4 * 48000 })).ok).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
