import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { alignDialogueMedia } from '../../packages/engine/src/media/dialogue-align.ts';

it('pads short dialogue at the explicit start without trimming, looping or changing speed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dialogue-align-'));
  try {
    const loaded = await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64'));
    expect(loaded.ok).toBe(true); if (!loaded.ok) return;
    const runtime = loaded.value, video = join(root, 'video.mp4'), audio = join(root, 'voice.wav'), output = join(root, 'aligned.wav');
    expect(spawnSync(runtime.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=32x32:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { shell: false, windowsHide: true }).status).toBe(0);
    expect(spawnSync(runtime.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', audio], { shell: false, windowsHide: true }).status).toBe(0);
    const aligned = await alignDialogueMedia({ runtime, video, audio, output, stagingRoot: root, startTicks: 24000, durationTicks: 3 * 48000 });
    expect(aligned, JSON.stringify(aligned)).toMatchObject({ ok: true });
    if (!aligned.ok) return;
    const decoded = spawnSync(runtime.ffmpegPath, ['-v', 'error', '-i', output, '-f', 's16le', '-'], { shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    expect(decoded.status).toBe(0);
    const bytes = decoded.stdout, samples = bytes.byteLength / 2;
    expect(samples).toBeGreaterThanOrEqual(168000);
    expect(samples).toBeLessThan(168000 + 1600);
    expect(bytes.readInt16LE(44)).toBe(0);
    expect(bytes.readInt16LE(44 + 24000 * 2)).not.toBe(0);
    const cancelled=new AbortController();cancelled.abort();
    expect(await alignDialogueMedia({runtime,video,audio,output:join(root,'cancelled.wav'),stagingRoot:root,startTicks:0,durationTicks:48000,signal:cancelled.signal})).toMatchObject({ok:false});
  } finally { await rm(root, { recursive: true, force: true }); }
});
