import { afterEach, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { MediaRuntime } from '../../packages/contracts/src/media-info.ts';
import { DEFAULT_SUBTITLE_STYLE, type TimelineRevision } from '../../packages/contracts/src/timeline.ts';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { probeMediaFile } from '../../packages/engine/src/media/probe.ts';
import { compileRenderPlan } from '../../packages/domain/src/render-plan.ts';
import { renderMedia } from '../../packages/engine/src/media/compile.ts';
import { verifyRenderOutput } from '../../packages/engine/src/media/verify.ts';
import { mediaStreamEndTicks } from '../../packages/domain/src/timeline-time.ts';
import { renderDigest } from '../../packages/domain/src/render-plan.ts';
import { buildDerived } from '../../packages/engine/src/media/derived.ts';
let runtime: MediaRuntime;
const roots: string[] = [];
const unwrap = <T>(r: import('../../packages/contracts/src/result.ts').Result<T>): T => { if (!r.ok)
    throw Error(JSON.stringify(r.error)); return r.value; };
beforeAll(async () => { runtime = unwrap(await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64'))); });
afterEach(async () => { for (const root of roots.splice(0))
    await rm(root, {
        recursive: true, force: true
    }); });
function native(args: string[], binary = runtime.ffmpegPath) { const r = spawnSync(binary, args, {
    shell: false, windowsHide: true, maxBuffer: 1024 * 1024 * 8
}); expect(r.status, String(r.stderr)).toBe(0); return r.stdout; }
it('preserves a shared nonzero origin, delayed original sound, VFR PTS and explicit display rotation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'render-normalize-'));
    roots.push(root);
    const source = join(root, 'source.mp4'), rotated = join(root, 'rotated.mp4');
    native([
        '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=red:size=64x32:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=1', '-filter_complex', "[0:v]drawbox=x=32:y=0:w=32:h=32:color=blue:t=fill,select='not(eq(mod(n,3),1))',setpts=PTS+2/TB[v];[1:a]asetpts=PTS+2.2/TB[a]", '-map', '[v]', '-map', '[a]', '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-copyts', source
    ]);
    native([
        '-v', 'error', '-nostdin', '-copyts', '-display_rotation:v:0', '90', '-i', source, '-c', 'copy', rotated
    ]);
    const bytes = await readFile(rotated), hash = createHash('sha256').update(bytes).digest('hex'), probe = unwrap(await probeMediaFile(runtime, rotated, root, hash));
    expect(probe.streams.find(s => s.kind === 'video')).toMatchObject({
        rotation: 90, variableFrameRate: true
    });
    expect(probe.originSeconds).toBeGreaterThan(1.9);
    const durationTicks = Math.floor(mediaStreamEndTicks(probe, 'video') / 1600) * 1600;
    const ref = {
        kind: 'assetVersion' as const, libraryId: 'library', assetId: 'source', version: 1
    };
    const timeline: TimelineRevision = {
        libraryId: 'library', projectId: 'project', id: 'cut', revision: 1, scriptRef: {
            id: 'script', revision: 1
        }, title: 'Normalize', fps: {
            num: 30, den: 1
        }, canvas: {
            width: 1080, height: 1080
        }, timebase: 48000, videoClips: [{
                id: 'source', kind: 'video', media: ref, sourceHash: hash, sourceProbeId: probe.probeId, sourceInTicks: 0, startTicks: 0, durationTicks, fit: 'contain', gainMilli: 1000, mute: false
            }], audioClips: [], subtitleCues: [], subtitleStyle: DEFAULT_SUBTITLE_STYLE, createdAt: '2026-01-01'
    };
    const manifest = {
        runtimeHash: runtime.runtimeHash, fontHash: runtime.fontManifest.sha256, entries: [{
                ref, hash, mime: 'video/mp4', byteLength: bytes.length, width: 64, height: 32, probe
            }]
    };
    const mp4 = unwrap(compileRenderPlan(timeline, manifest, {
        purpose: 'mp4', executionOwner: 'user', runId: 'mp4'
    })), wav = unwrap(compileRenderPlan(timeline, manifest, {
        purpose: 'wav', executionOwner: 'user', runId: 'wav'
    }));
    expect(mp4.compositionHash).toBe(wav.compositionHash);
    expect(mp4.planHash).not.toBe(wav.planHash);
    const output = join(root, 'output.mp4'), audio = join(root, 'output.wav');
    unwrap(await renderMedia(mp4, runtime, root, [rotated], output, new AbortController().signal));
    unwrap(await verifyRenderOutput(mp4, runtime, root, output, new AbortController().signal));
    unwrap(await renderMedia(wav, runtime, root, [rotated], audio, new AbortController().signal));
    unwrap(await verifyRenderOutput(wav, runtime, root, audio, new AbortController().signal));
    const frame = native([
        '-v', 'error', '-i', output, '-frames:v', '1', '-vf', 'scale=108:108,format=rgb24', '-f', 'rawvideo', '-'
    ]);
    const pixel = (x: number, y: number) => [...frame.subarray((y * 108 + x) * 3, (y * 108 + x) * 3 + 3)];
    const top = pixel(54, 27), bottom = pixel(54, 81);
    expect(top[2]!).toBeGreaterThan(top[0]! + 100);
    expect(bottom[0]!).toBeGreaterThan(bottom[2]! + 100);
    const pcm = native([
        '-v', 'error', '-i', audio, '-ac', '1', '-f', 's16le', '-'
    ]);
    const peak = (from: number, to: number) => { let peak = 0; for (let i = Math.floor(from * 48000) * 2; i < Math.min(pcm.length, to * 48000 * 2); i += 2)
        peak = Math.max(peak, Math.abs(pcm.readInt16LE(i))); return peak; };
    expect(peak(0, 0.1)).toBeLessThan(10);
    expect(peak(0.4, 0.6)).toBeGreaterThan(2000);
    const derived = await buildDerived({
        ...mp4, kind: 'derived', fps: timeline.fps, canvas: timeline.canvas,
        recipeHash: renderDigest({ source: hash, runtime: runtime.runtimeHash })
    }, manifest.entries[0]!, runtime, root, rotated, new AbortController().signal, () => undefined);
    const waveform = derived.find(value => value.kind === 'waveform');
    expect(waveform).toBeDefined();
    const peaks: number[] = JSON.parse(await readFile(waveform!.path, 'utf8')).peaks;
    expect(peaks.length).toBe(Math.ceil(probe.durationTicks / 800));
    expect(Math.max(...peaks.slice(0, 6))).toBeLessThan(0.001);
    expect(Math.max(...peaks.slice(24, 36))).toBeGreaterThan(0.04);
});
it('has no accumulated drift in one genuine 600-second CFR movie and fully decodes its streams', async () => {
    const root = await mkdtemp(join(tmpdir(), 'render-long-'));
    roots.push(root);
    const source = join(root, 'source.mp4'), output = join(root, 'movie.mp4');
    native([
        '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=black:size=32x32:rate=24:duration=600', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=600', '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='gte(t,599)'", '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', source
    ]);
    const bytes = await readFile(source), hash = createHash('sha256').update(bytes).digest('hex'), probe = unwrap(await probeMediaFile(runtime, source, root, hash));
    const ref = {
        kind: 'assetVersion' as const, libraryId: 'library', assetId: 'long', version: 1
    };
    const timeline: TimelineRevision = {
        libraryId: 'library', projectId: 'project', id: 'long', revision: 1, scriptRef: {
            id: 'script', revision: 1
        }, title: '600 seconds', fps: {
            num: 24, den: 1
        }, canvas: {
            width: 1080, height: 1080
        }, timebase: 48000, videoClips: [{
                id: 'long', kind: 'video', media: ref, sourceHash: hash, sourceProbeId: probe.probeId, sourceInTicks: 0, startTicks: 0, durationTicks: 600 * 48000, fit: 'contain', gainMilli: 1000, mute: false
            }], audioClips: [], subtitleCues: [], subtitleStyle: DEFAULT_SUBTITLE_STYLE, createdAt: '2026-01-01'
    };
    const plan = unwrap(compileRenderPlan(timeline, {
        runtimeHash: runtime.runtimeHash, fontHash: runtime.fontManifest.sha256, entries: [{
                ref, hash, mime: 'video/mp4', byteLength: bytes.length, width: 32, height: 32, probe
            }]
    }, {
        purpose: 'mp4', executionOwner: 'user', runId: 'long'
    }));
    unwrap(await renderMedia(plan, runtime, root, [source], output, new AbortController().signal));
    const verified = unwrap(await verifyRenderOutput(plan, runtime, root, output, new AbortController().signal));
    expect(verified.probe.durationTicks).toBe(28800000);
    expect(verified.probe.streams.map(stream => Math.abs(stream.durationTicks - 28800000))).toEqual([0, 0]);
    const counts = JSON.parse(native([
        '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'json', output
    ], runtime.ffprobePath).toString());
    expect(Number(counts.streams[0].nb_read_frames)).toBe(14400);
    const tail = native([
        '-v', 'error', '-ss', '599', '-i', output, '-frames:v', '1', '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', '-'
    ]);
    expect(Math.min(...tail)).toBeGreaterThan(200);
    const evidenceRoot = resolve('.superpowers/sdd/2026-10-27-p4-audio-timeline/scratch');
    await mkdir(evidenceRoot, {
        recursive: true
    });
    await writeFile(join(evidenceRoot, 'task-4-600-second-media.json'), JSON.stringify({
        runtimeHash: runtime.runtimeHash, compositionHash: plan.compositionHash, planHash: plan.planHash, outputHash: verified.hash, byteLength: verified.byteLength, probe: verified.probe, decodedFrames: Number(counts.streams[0].nb_read_frames), evidenceHash: renderDigest(verified)
    }, null, 2));
}, 600000);
