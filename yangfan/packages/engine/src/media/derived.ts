import { open, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaRuntime } from '../../../contracts/src/media-info.ts';
import type { ResolvedMedia, DerivedMediaPlan } from '../../../contracts/src/render.ts';
import { DEFAULT_SUBTITLE_STYLE, type TimelineRevision } from '../../../contracts/src/timeline.ts';
import { compileRenderPlan } from '../../../domain/src/render-plan.ts';
import { mediaStreamEndTicks } from '../../../domain/src/timeline-time.ts';
import { compileMediaProcess, runMediaProcess } from './process.ts';
import { renderMedia } from './compile.ts';
import { verifyRenderOutput } from './verify.ts';
import { audioFilters } from './normalize.ts';
export async function buildDerived(value: DerivedMediaPlan, media: ResolvedMedia, runtime: MediaRuntime, directory: string, input: string, signal: AbortSignal, onProgress: (ticks: number) => void): Promise<{
    path: string;
    mime: string;
    kind: string;
    extra?: unknown;
}[]> {
    if (media.mime.startsWith('image/')) {
        const { default: sharp } = await import('sharp');
        const path = join(directory, 'thumbnail.png');
        await sharp(input, {
            limitInputPixels: 40000000, failOn: 'warning'
        }).rotate().resize(320, 320, {
            fit: 'inside', withoutEnlargement: true
        }).png().toFile(path);
        if (signal.aborted)
            throw Error('MEDIA_CANCELLED');
        return [{
                path, mime: 'image/png', kind: 'thumbnail'
            }];
    }
    if (!media.probe)
        throw Error('MEDIA_ANALYSIS_REQUIRED');
    const frame = 48000 / value.fps.num;
    const durationTicks = Math.floor(mediaStreamEndTicks(media.probe, media.probe.width ? 'video' : 'audio') / frame) * frame;
    const clip = {
        id: 'source', media: media.ref, sourceHash: media.hash, sourceProbeId: media.probe.probeId, sourceInTicks: 0, startTicks: 0, durationTicks, gainMilli: 1000, mute: false
    };
    const timeline: TimelineRevision = {
        libraryId: value.libraryId, projectId: value.projectId, id: 'derived', revision: 1, scriptRef: {
            id: 'derived', revision: 1
        }, title: 'Preview', fps: value.fps, canvas: value.canvas, timebase: 48000, videoClips: media.probe.width ? [{
                ...clip, kind: 'video', fit: value.videoFit ?? 'contain'
            }] : [], audioClips: media.probe.width ? [] : [{
                ...clip, kind: 'audio', track: 'voice'
            }], subtitleCues: [], subtitleStyle: DEFAULT_SUBTITLE_STYLE, createdAt: new Date().toISOString()
    };
    const plan = compileRenderPlan(timeline, {
        ...value.manifest, entries: [media]
    }, {
        purpose: media.probe.width ? 'preview' : 'wav', executionOwner: value.executionOwner, runId: value.runId
    });
    if (!plan.ok)
        throw Error(plan.error.code);
    const path = join(directory, 'proxy.part');
    const encoded = await renderMedia(plan.value, runtime, directory, [input], path, signal, onProgress);
    if (!encoded.ok)
        throw Error(encoded.error.code);
    const verified = await verifyRenderOutput(plan.value, runtime, directory, path, signal);
    if (!verified.ok)
        throw Error(verified.error.code);
    const results: {
        path: string;
        mime: string;
        kind: string;
        extra?: unknown;
    }[] = [{
            path, mime: verified.value.mime, kind: 'proxy'
        }];
    if (media.probe.hasAudio) {
        const pcm = join(directory, 'waveform.pcm');
        const waveformTicks = media.probe.durationTicks;
        const waveformFilter = audioFilters(media.probe.originSeconds, 0, waveformTicks, 0, 1000)
            + ',apad,atrim=end_sample=' + waveformTicks;
        const decoded = await runMediaProcess(compileMediaProcess({
            tool: 'ffmpeg', runtime, stagingRoot: directory, timeoutMs: 1800000, maxStdoutBytes: 4096, args: [
                '-v', 'error', '-nostdin', '-y', '-xerror', '-copyts', '-threads', '4',
                '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'wav,mp3,mov',
                '-max_streams', '4', '-i', input, '-map', '0:a:0', '-vn',
                '-af', waveformFilter, '-ac', '1', '-ar', '48000',
                '-t', String(waveformTicks / 48000), '-fs', String(waveformTicks * 2 + 1),
                '-f', 's16le', pcm
            ]
        }), signal);
        if (!decoded.ok)
            throw Error(decoded.error.code);
        const file = await open(pcm, 'r');
        const peaks: number[] = [], buffer = Buffer.allocUnsafe(800 * 2);
        try {
            for (;;) {
                if (signal.aborted)
                    throw Error('MEDIA_CANCELLED');
                const { bytesRead } = await file.read(buffer);
                if (!bytesRead)
                    break;
                let peak = 0;
                for (let index = 0; index + 1 < bytesRead; index += 2)
                    peak = Math.max(peak, Math.abs(buffer.readInt16LE(index)));
                peaks.push(peak / 32768);
                if (peaks.length > 36000)
                    throw Error('WAVEFORM_LIMIT');
            }
        }
        finally {
            await file.close();
            await unlink(pcm).catch(() => undefined);
        }
        const waveform = join(directory, 'waveform.json'), extra = {
            bucketRate: 60, sampleRate: 48000, peaks
        };
        await writeFile(waveform, JSON.stringify(extra), {
            mode: 0o600
        });
        results.push({
            path: waveform, mime: 'application/json', kind: 'waveform', extra: {
                bucketRate: 60, buckets: peaks.length
            }
        });
    }
    return results;
}
