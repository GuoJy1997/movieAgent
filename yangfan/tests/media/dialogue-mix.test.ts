import { expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { probeMediaFile } from '../../packages/engine/src/media/probe.ts';
import { compileRenderPlan } from '../../packages/domain/src/render-plan.ts';
import { renderMedia } from '../../packages/engine/src/media/compile.ts';
import { assembleDialogueClips, type DialogueAssemblyInput } from '../../packages/domain/src/dialogue-assembly.ts';
import { DEFAULT_SUBTITLE_STYLE, type TimelineRevision } from '../../packages/contracts/src/timeline.ts';

const unwrap = <T>(result: import('../../packages/contracts/src/result.ts').Result<T>): T => { if (!result.ok) throw Error(JSON.stringify(result.error)); return result.value; };
const ref = (assetId: string) => ({ kind: 'assetVersion', libraryId: 'library', assetId, version: 1 }) as const;
const selection = (route: 'native-reference' | 'dubbed-lipsync', voiceHash: string) => ({ libraryId: 'library', projectId: 'project', shotId: 'shot', shotRevision: 1, dialogueRef: { id: 'dialogue', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, takeId: 'take', selectionRevision: 1, route, video: ref('video'), audio: route === 'native-reference' ? null : ref('voice'), sourceVideoHash: 'a'.repeat(64), audioHash: route === 'native-reference' ? null : voiceHash, reviewRevision: 1, selectedAt: new Date().toISOString() });

function power(samples: Int16Array, frequency: number) {
  let re = 0, im = 0;
  for (let i = 0; i < samples.length; i++) { const angle = 2 * Math.PI * frequency * i / 48000; re += samples[i]! * Math.cos(angle); im -= samples[i]! * Math.sin(angle); }
  return (re * re + im * im) / (samples.length * samples.length);
}
function frequencies(runtime: import('../../packages/contracts/src/media-info.ts').MediaRuntime, path: string) {
  const decoded = spawnSync(runtime.ffmpegPath, ['-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-'], { shell: false, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  expect(decoded.status, String(decoded.stderr)).toBe(0);
  const samples = new Int16Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.byteLength / 2).subarray(4800, 14400);
  return { 220: power(samples, 220), 440: power(samples, 440), 880: power(samples, 880) };
}

it.each([24, 25, 30])('keeps native and dubbed sources mutually exclusive at %i fps', async fps => {
  const root = await mkdtemp(join(tmpdir(), 'dialogue-mix-'));
  try {
    const runtime = unwrap(await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64'))), videoPath = join(root, 'video.mp4'), voicePath = join(root, 'voice.wav');
    for (const [args, path] of [
      [['-f', 'lavfi', '-i', 'color=red:s=32x32:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'], videoPath],
      [['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le'], voicePath],
    ] as const) expect(spawnSync(runtime.ffmpegPath, ['-v', 'error', '-y', ...args, path], { shell: false, windowsHide: true }).status).toBe(0);
    const videoBytes = await readFile(videoPath), voiceBytes = await readFile(voicePath), videoHash = createHash('sha256').update(videoBytes).digest('hex'), voiceHash = createHash('sha256').update(voiceBytes).digest('hex');
    const videoProbe = unwrap(await probeMediaFile(runtime, videoPath, root, videoHash)), voiceProbe = unwrap(await probeMediaFile(runtime, voicePath, root, voiceHash));
    for (const route of ['native-reference', 'dubbed-lipsync'] as const) {
      const input: DialogueAssemblyInput = { selection: selection(route, voiceHash), video: { hash: videoHash, probeId: videoProbe.probeId, durationTicks: 48000 }, ...(route === 'dubbed-lipsync' ? { audio: { hash: voiceHash, probeId: voiceProbe.probeId } } : {}), startTicks: 0, durationTicks: 48000, dialogueGroupId: `group-${route}` };
      const assembled = unwrap(assembleDialogueClips(input));
      const timeline: TimelineRevision = { libraryId: 'library', projectId: 'project', id: `timeline-${route}`, revision: 1, scriptRef: { id: 'script', revision: 1 }, title: route, fps: { num: fps as 24 | 25 | 30, den: 1 }, canvas: { width: 1080, height: 1080 }, timebase: 48000, videoClips: [assembled.videoClip], audioClips: assembled.audioClip ? [assembled.audioClip] : [], subtitleCues: [], subtitleStyle: DEFAULT_SUBTITLE_STYLE, createdAt: new Date().toISOString() };
      const entries = [
        { ref: ref('video'), hash: videoHash, mime: 'video/mp4', byteLength: videoBytes.length, width: 32, height: 32, probe: videoProbe },
        ...(route === 'dubbed-lipsync' ? [{ ref: ref('voice'), hash: voiceHash, mime: 'audio/wav', byteLength: voiceBytes.length, width: 0, height: 0, probe: voiceProbe }] : []),
      ];
      const plan = unwrap(compileRenderPlan(timeline, { runtimeHash: runtime.runtimeHash, fontHash: runtime.fontManifest.sha256, entries }, { purpose: 'wav', executionOwner: 'user', runId: route }));
      const output = join(root, `${route}.wav`); unwrap(await renderMedia(plan, runtime, root, route === 'native-reference' ? [videoPath] : [videoPath, voicePath], output, new AbortController().signal));
      const tones = frequencies(runtime, output);
      if (route === 'native-reference') expect(tones[440]).toBeGreaterThan(tones[880] * 20);
      else expect(tones[880]).toBeGreaterThan(tones[440] * 20);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
