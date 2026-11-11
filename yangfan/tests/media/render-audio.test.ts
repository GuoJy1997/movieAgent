import { afterEach, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { MediaRuntime } from '../../packages/contracts/src/media-info.ts';
import { DEFAULT_SUBTITLE_STYLE, type TimelineRevision } from '../../packages/contracts/src/timeline.ts';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { probeMediaFile } from '../../packages/engine/src/media/probe.ts';
import { compileRenderPlan } from '../../packages/domain/src/render-plan.ts';
import { renderMedia } from '../../packages/engine/src/media/compile.ts';
import { verifyRenderOutput } from '../../packages/engine/src/media/verify.ts';
import { createHash } from 'node:crypto';
let runtime: MediaRuntime;
const roots: string[] = [];
beforeAll(async () => { const r = await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64')); if (!r.ok)
    throw Error(r.error.code); runtime = r.value; });
afterEach(async () => { for (const root of roots.splice(0))
    await rm(root, {
        recursive: true, force: true
    }); });
const unwrap = <T>(r: import('../../packages/contracts/src/result.ts').Result<T>): T => { if (!r.ok)
    throw Error(r.error.code); return r.value; };
it('renders exact 48k WAV, keeps mix levels constant when a track ends, verifies bytes and rejects corruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'render-audio-'));
    roots.push(root);
    const source = join(root, 'source.wav'), output = join(root, 'output.wav');
    const generated = spawnSync(runtime.ffmpegPath, [
        '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=1', '-c:a', 'pcm_s16le', source
    ], {
        shell: false, windowsHide: true, encoding: 'utf8'
    });
    expect(generated.status, generated.stderr).toBe(0);
    const bytes = await readFile(source), hash = createHash('sha256').update(bytes).digest('hex');
    const probe = unwrap(await probeMediaFile(runtime, source, root, hash));
    const ref = {
        kind: 'assetVersion' as const, libraryId: 'library', assetId: 'tone', version: 1
    };
    const timeline: TimelineRevision = {
        libraryId: 'library', projectId: 'project', id: 'cut', revision: 1, scriptRef: {
            id: 'script', revision: 1
        }, title: 'Tone', fps: {
            num: 30, den: 1
        }, canvas: {
            width: 1080, height: 1080
        }, timebase: 48000, videoClips: [], audioClips: [{
                id: 'tone', kind: 'audio', track: 'voice', media: ref, sourceHash: hash, sourceProbeId: probe.probeId, sourceInTicks: 0, startTicks: 0, durationTicks: 48000, gainMilli: 1000, mute: false
            }], subtitleCues: [], subtitleStyle: DEFAULT_SUBTITLE_STYLE, createdAt: '2026-01-01'
    };
    const plan = unwrap(compileRenderPlan(timeline, {
        runtimeHash: runtime.runtimeHash, fontHash: runtime.fontManifest.sha256, entries: [{
                ref, hash, mime: 'audio/wav', byteLength: bytes.length, width: 0, height: 0, probe
            }]
    }, {
        purpose: 'wav', executionOwner: 'user', runId: 'run'
    }));
    expect(await renderMedia(plan, runtime, root, [source], output, new AbortController().signal)).toMatchObject({
        ok: true
    });
    const verified = unwrap(await verifyRenderOutput(plan, runtime, root, output, new AbortController().signal));
    expect(verified).toMatchObject({
        mime: 'audio/wav', width: 0, height: 0, probe: {
            durationTicks: 48000, streams: [{
                    sampleRate: 48000, codec: 'pcm_s16le'
                }]
        }
    });
    expect(verified.hash).toBe(createHash('sha256').update(await readFile(output)).digest('hex'));
    expect(await verifyRenderOutput({
        ...plan, maxOutputBytes: 16
    }, runtime, root, output, new AbortController().signal)).toMatchObject({
        ok: false, error: {
            code: 'OUTPUT_TOO_LARGE'
        }
    });
    const pcm = spawnSync(runtime.ffmpegPath, [
        '-v', 'error', '-i', output, '-f', 's16le', '-ac', '1', '-'
    ], {
        shell: false, windowsHide: true, maxBuffer: 1024 * 1024
    });
    expect(pcm.status).toBe(0);
    expect(pcm.stdout.length).toBe(96000);
    const samples = new Int16Array(pcm.stdout.buffer, pcm.stdout.byteOffset, pcm.stdout.length / 2);
    expect(Math.max(...samples.slice(2000, 4000))).toBeGreaterThan(2800);
    expect(Math.max(...samples.slice(2000, 4000))).toBeLessThan(3000);
    timeline.audioClips.push({
        ...timeline.audioClips[0]!, id: 'music', track: 'music', durationTicks: 24000
    });
    const mixed = unwrap(compileRenderPlan(timeline, plan.manifest, {
        purpose: 'wav', executionOwner: 'user', runId: 'mixed'
    }));
    const mixedOutput = join(root, 'mixed.wav');
    unwrap(await renderMedia(mixed, runtime, root, [source], mixedOutput, new AbortController().signal));
    unwrap(await verifyRenderOutput(mixed, runtime, root, mixedOutput, new AbortController().signal));
    const mixedPcm = spawnSync(runtime.ffmpegPath, [
        '-v', 'error', '-i', mixedOutput, '-f', 's16le', '-ac', '1', '-'
    ], {
        shell: false, windowsHide: true, maxBuffer: 1024 * 1024
    });
    expect(mixedPcm.status).toBe(0);
    const peak = (start: number, end: number) => { let maximum = 0; for (let index = start * 2; index < end * 2; index += 2)
        maximum = Math.max(maximum, Math.abs(mixedPcm.stdout.readInt16LE(index))); return maximum; };
    expect(peak(6000, 10000)).toBeGreaterThan(5600);
    expect(peak(6000, 10000)).toBeLessThan(6000);
    expect(peak(30000, 34000)).toBeGreaterThan(2800);
    expect(peak(30000, 34000)).toBeLessThan(3000);
    await writeFile(output, 'corrupt');
    expect(await verifyRenderOutput(plan, runtime, root, output, new AbortController().signal)).toMatchObject({
        ok: false
    });
});
