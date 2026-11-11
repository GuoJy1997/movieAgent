import { afterEach, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { MediaRuntime } from '../../packages/contracts/src/media-info.ts';
import { DEFAULT_SUBTITLE_STYLE, type TimelineRevision } from '../../packages/contracts/src/timeline.ts';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { compileRenderPlan } from '../../packages/domain/src/render-plan.ts';
import { renderMedia } from '../../packages/engine/src/media/compile.ts';
import { verifyRenderOutput } from '../../packages/engine/src/media/verify.ts';
import { probeMediaFile } from '../../packages/engine/src/media/probe.ts';
let runtime: MediaRuntime;
const roots: string[] = [];
const unwrap = <T>(r: import('../../packages/contracts/src/result.ts').Result<T>): T => { if (!r.ok)
    throw Error(JSON.stringify(r.error)); return r.value; };
beforeAll(async () => { runtime = unwrap(await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64'))); });
afterEach(async () => { for (const root of roots.splice(0))
    await rm(root, {
        recursive: true, force: true
    }); });
it.each([24, 25, 30] as const)('verifies every decoded cut/subtitle boundary at %i fps with the actual pinned CJK font', async (fps) => {
    const root = await mkdtemp(join(tmpdir(), 'render-caption-'));
    roots.push(root);
    const path = join(root, 'image.png'), output = join(root, 'movie.mp4');
    const bytes = await sharp({
        create: {
            width: 32, height: 32, channels: 3, background: 'red'
        }
    }).png().toBuffer();
    await writeFile(path, bytes);
    const hash = createHash('sha256').update(bytes).digest('hex'), frame = 48000 / fps;
    const ref = {
        kind: 'assetVersion' as const, libraryId: 'library', assetId: 'image', version: 1
    };
    const timeline: TimelineRevision = {
        libraryId: 'library', projectId: 'project', id: 'cut', revision: 1, scriptRef: {
            id: 'script', revision: 1
        }, title: 'Caption', fps: {
            num: fps, den: 1
        }, canvas: {
            width: 1080, height: 1080
        }, timebase: 48000, videoClips: [{
                id: 'image', kind: 'image', media: ref, sourceHash: hash, sourceProbeId: null, sourceInTicks: 0, startTicks: 0, durationTicks: frame * 5, fit: 'contain', gainMilli: 1000, mute: true
            }], audioClips: [], subtitleCues: [{
                id: 'cue', startTicks: frame, endTicks: frame * 3, text: '字幕测试'
            }], subtitleStyle: {
            ...DEFAULT_SUBTITLE_STYLE, fontSize: 80
        }, createdAt: '2026-01-01'
    };
    timeline.videoClips[0]!.durationTicks = frame * 2;
    timeline.videoClips.push({
        ...timeline.videoClips[0]!, id: 'image2', startTicks: frame * 4, durationTicks: frame
    });
    const plan = unwrap(compileRenderPlan(timeline, {
        runtimeHash: runtime.runtimeHash, fontHash: runtime.fontManifest.sha256, entries: [{
                ref, hash, mime: 'image/png', byteLength: bytes.length, width: 32, height: 32, probe: null
            }]
    }, {
        purpose: 'mp4', executionOwner: 'user', runId: 'run'
    }));
    const encoded = unwrap(await renderMedia(plan, runtime, root, [path], output, new AbortController().signal));
    expect(encoded.stderr).toMatch(/fontselect:.*NotoSansCJKsc-Regular/);
    const facts = unwrap(await probeMediaFile(runtime, output, root, createHash('sha256').update(await readFile(output)).digest('hex')));
    expect(facts.streams[0]).toMatchObject({
        codec: 'h264', width: 1080, height: 1080, averageFrameRate: fps + '/1', sampleAspectRatio: '1:1', colorSpace: 'bt709', colorTransfer: 'bt709', colorPrimaries: 'bt709'
    });
    const verified = unwrap(await verifyRenderOutput(plan, runtime, root, output, new AbortController().signal));
    expect(verified.hash).toBe(createHash('sha256').update(await readFile(output)).digest('hex'));
    const decoded = spawnSync(runtime.ffmpegPath, [
        '-v', 'error', '-i', output, '-vf', 'scale=108:108,format=gray', '-f', 'rawvideo', '-'
    ], {
        shell: false, windowsHide: true, maxBuffer: 1024 * 1024
    });
    expect(decoded.status, String(decoded.stderr)).toBe(0);
    const frameBytes = 108 * 108;
    expect(decoded.stdout.length).toBe(frameBytes * 5);
    const active = Array.from({
        length: 5
    }, (_, index) => Math.max(...decoded.stdout.subarray(index * frameBytes, (index + 1) * frameBytes)) > 150);
    expect(active).toEqual([false, true, true, false, false]);
    const picture = Array.from({
        length: 5
    }, (_, index) => decoded.stdout[index * frameBytes + 54 * 108 + 54]! > 40);
    expect(picture).toEqual([true, true, false, false, true]);
});
