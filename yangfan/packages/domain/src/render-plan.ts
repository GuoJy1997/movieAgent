import { createHash, randomUUID } from 'node:crypto';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { isTimelineRevision, type TimelineRevision } from '../../contracts/src/timeline.ts';
import type { RenderOptions, RenderPlan, ResolvedMediaManifest } from '../../contracts/src/render.ts';
import { timelineEndTicks, timelineWarnings, validateRenderContent, mediaStreamEndTicks } from './timeline-time.ts';
export const renderDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function compileRenderPlan(timeline: TimelineRevision, manifest: ResolvedMediaManifest, options: RenderOptions): Result<RenderPlan> {
    if (options.intermediateBudgetBytes!==undefined&&![2*1024**3,4*1024**3,8*1024**3].includes(options.intermediateBudgetBytes)|| !isTimelineRevision(timeline) || !['preview', 'mp4', 'wav'].includes(options.purpose) || options.burnSubtitles!==undefined&&(typeof options.burnSubtitles!=='boolean'||options.purpose==='wav'))
        return fail('INVALID_TIMELINE', '时间线或输出用途无效。');
    for (const clip of [...timeline.videoClips, ...timeline.audioClips]) {
        const media = manifest.entries.find(entry => JSON.stringify(entry.ref) === JSON.stringify(clip.media));
        if (!media || media.hash !== clip.sourceHash || media.ref.libraryId !== timeline.libraryId)
            return fail('REFERENCE_CHANGED', '固定素材不符。');
        if (media.probe && (media.probe.runtimeHash !== manifest.runtimeHash || media.probe.streams.some(stream => ['smpte2084', 'arib-std-b67'].includes(stream.colorTransfer ?? '') || stream.colorPrimaries === 'bt2020' || ['bt2020nc', 'bt2020c'].includes(stream.colorSpace ?? ''))))
            return fail('HDR_UNSUPPORTED', '媒体运行时或 SDR 色彩事实不符合计划。');
        if (clip.kind === 'image') {
            if (!media.mime.startsWith('image/') || media.probe !== null)
                return fail('INVALID_MEDIA_TYPE', '图片原件无效。');
        }
        else if (!media.probe || media.probe.probeId !== clip.sourceProbeId || media.probe.objectHash !== clip.sourceHash || clip.sourceInTicks + clip.durationTicks > mediaStreamEndTicks(media.probe, clip.kind === 'video' ? 'video' : 'audio')) {
            return fail('SOURCE_RANGE', '固定媒体探测或范围无效。');
        }
    }
    const content = validateRenderContent(timeline, options.purpose === 'wav' ? 'wav' : 'mp4', clip => Boolean(manifest.entries.find(media => media.hash === clip.sourceHash)?.probe?.hasAudio));
    if (!content)
        return fail('EMPTY_RENDER', '此用途缺少可渲染内容。');
    const frozen = structuredClone(timeline);
    const facts = structuredClone(manifest);
    const durationTicks = timelineEndTicks(timeline);
    const compositionHash = renderDigest({
        timeline: frozen, manifest: facts, normalization: 'pts-origin-v1', mix: 'normalize0-limiter095-level0', subtitle: 'ass-floor-v1'
    });
    const maxOutputBytes = options.purpose === 'wav' ? 128 * 1024 ** 2 : options.purpose === 'preview' ? 256 * 1024 ** 2 : 1024 ** 3;
    const estimatedBytes = manifest.entries.reduce((sum, media) => sum + media.byteLength, 0) + (manifest.entries.length>32?(options.intermediateBudgetBytes??2*1024**3):0) + maxOutputBytes;
    const policy = {
        video: 'libx264' as const, audio: options.purpose === 'wav' ? 'pcm_s16le' as const : 'aac' as const, sampleRate: 48000 as const, threads: 4 as const, limiterMilli: 950 as const
    };
    const subtitlePolicy={...(options.burnSubtitles===undefined?{}:{burnSubtitles:options.burnSubtitles}),...(options.intermediateBudgetBytes!==undefined||manifest.entries.length>32?{intermediateBudgetBytes:options.intermediateBudgetBytes??2*1024**3}:{})};
    return ok({
        kind: 'render', libraryId: timeline.libraryId, projectId: timeline.projectId, planId: randomUUID(), planHash: renderDigest({
            compositionHash, purpose: options.purpose, maxOutputBytes, policy, ...subtitlePolicy
        }), compositionHash, expiresAt: Date.now() + 600000, timelineRef: {
            libraryId: timeline.libraryId, projectId: timeline.projectId, id: timeline.id, revision: timeline.revision
        }, timeline: frozen, purpose: options.purpose, ...subtitlePolicy, manifest: facts, executionOwner: options.executionOwner, runId: options.runId, durationTicks, maxOutputBytes, estimatedBytes, requiredFreeBytes: estimatedBytes + 1024 ** 3, notices: timelineWarnings(timeline).map(warning => warning.code), policy
    });
}
