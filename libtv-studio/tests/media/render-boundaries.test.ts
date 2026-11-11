import { expect, it } from 'vitest';
import { compileRenderPlan } from '../../packages/domain/src/render-plan.ts';
import { assTime, subtitleDocument } from '../../packages/domain/src/subtitle-format.ts';
import { renderInputArguments, renderCommandLength } from '../../packages/engine/src/media/compile.ts';
import { DEFAULT_SUBTITLE_STYLE, type TimelineRevision } from '../../packages/contracts/src/timeline.ts';
export function timeline(fps: 24 | 25 | 30 = 30): TimelineRevision {
    return {
        libraryId: 'library', projectId: 'project', id: 'cut', revision: 1, scriptRef: {
            id: 'script', revision: 1
        }, title: 'Cut', fps: {
            num: fps, den: 1
        }, canvas: {
            width: 1080, height: 1080
        }, timebase: 48000, videoClips: [{
                id: 'image', kind: 'image', media: {
                    kind: 'assetVersion', libraryId: 'library', assetId: 'image', version: 1
                }, sourceHash: 'a'.repeat(64), sourceProbeId: null, sourceInTicks: 0, startTicks: 0, durationTicks: 48000, fit: 'contain', gainMilli: 1000, mute: true
            }], audioClips: [], subtitleCues: [], subtitleStyle: DEFAULT_SUBTITLE_STYLE, createdAt: '2026-01-01'
    };
}
export const manifest = {
    entries: [{
            ref: {
                kind: 'assetVersion' as const, libraryId: 'library', assetId: 'image', version: 1
            }, hash: 'a'.repeat(64), mime: 'image/png', byteLength: 100, width: 16, height: 16, probe: null
        }], runtimeHash: 'b'.repeat(64), fontHash: 'c'.repeat(64)
};
it('bounds all 320 distinct source arguments below the Windows limit with explicit local demuxers', () => {
    const args = Array.from({
        length: 320
    }, (_, index) => renderInputArguments(index < 64 ? 'video/mp4' : 'audio/wav', 's' + index)).flat();
    const worstQuoted = args.map(arg => '"' + arg + '"').join(' ').length;
    expect(worstQuoted).toBe(28433);
    const outputOptions = [
        '-hide_banner', '-nostdin', '-y', '-v', 'info', '-xerror', '-max_alloc', '67108864', '-filter_complex_threads', '4', '-copyts', '-/filter_complex', 'filters.txt', '-map', '[composite63]', '-map', '[aout]', '-c:v', 'libx264', '-threads', '4', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709', '-t', '600', '-fs', '1073741825', '-progress', 'pipe:1', '-nostats', 'D:/' + 'x'.repeat(255)
    ];
    expect(renderCommandLength('C:/' + 'x'.repeat(255), [...args, ...outputOptions])).toBeLessThan(30000);
    expect(() => renderInputArguments('video/mp4', '../external')).toThrow();
    expect(() => renderInputArguments('application/vnd.apple.mpegurl', 's0')).toThrow();
});
it('freezes composition separately from purpose and rejects forged media facts', () => {
    const t = timeline();
    const mp4 = compileRenderPlan(t, manifest, {
        purpose: 'mp4', executionOwner: 'user', runId: 'run'
    });
    expect(mp4.ok).toBe(true);
    if (!mp4.ok)
        throw Error('plan');
    t.videoClips[0]!.durationTicks = 96000;
    expect(mp4.value.timeline.videoClips[0]!.durationTicks).toBe(48000);
    const preview = compileRenderPlan(timeline(), manifest, {
        purpose: 'preview', executionOwner: 'user', runId: 'run'
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok)
        throw Error('preview');
    expect(preview.value.compositionHash).toBe(mp4.value.compositionHash);
    expect(preview.value.planHash).not.toBe(mp4.value.planHash);
    expect(mp4.value.requiredFreeBytes).toBeGreaterThanOrEqual(mp4.value.estimatedBytes + 1024 ** 3);
    expect(compileRenderPlan(timeline(), {
        ...manifest, entries: [{
                ...manifest.entries[0]!, hash: 'd'.repeat(64)
            }]
    }, {
        purpose: 'mp4', executionOwner: 'user', runId: 'run'
    })).toMatchObject({
        ok: false
    });
});
it.each([24, 25, 30] as const)('keeps half-open subtitle frame boundaries at %i fps', fps => {
    for (let f = 0; f < fps * 600; f++) {
        const cs = assTime(f, fps);
        expect(cs).toBe(Math.floor(100 * f / fps));
        if (f)
            expect(cs / 100).toBeGreaterThan((f - 1) / fps);
        expect(cs / 100).toBeLessThanOrEqual(f / fps);
    }
    const t = timeline(fps);
    t.subtitleCues = [{
            id: 'caption', startTicks: 48000 / fps, endTicks: 2 * 48000 / fps, text: '字幕 \test'
        }];
    expect(subtitleDocument(t)).toContain('字幕');
    expect(subtitleDocument(t)).not.toContain('\\test');
});
