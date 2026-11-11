import {emitTimelineReadStats} from './read-diagnostics.ts';
import {createReadQueue} from './read-queue.ts';
import { useEffect, useState } from 'react';
import type { AudioClip } from '../../../../../../packages/contracts/src/timeline.ts';
import type { PreviewMedia } from './TimelinePreview.tsx';
const MAX_BYTES = 1024 * 1024;
const waveformReads=createReadQueue(4,stats=>emitTimelineReadStats({kind:'queue',...stats}));
export function waveformPeaks(value: unknown): number[] {
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'bucketRate,peaks,sampleRate') throw Error('WAVEFORM_SHAPE');
    const v = value as { bucketRate: unknown; sampleRate: unknown; peaks: unknown };
    if (v.bucketRate !== 60 || v.sampleRate !== 48000 || !Array.isArray(v.peaks) || v.peaks.length > 36000 || !v.peaks.every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1)) throw Error('WAVEFORM_SHAPE');
    return v.peaks as number[];
}
async function readWaveform(url: string, signal: AbortSignal): Promise<number[]> {
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) throw Error('WAVEFORM_READ');
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) { await response.body.cancel(); throw Error('WAVEFORM_LIMIT'); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            length += value.byteLength; if (length > MAX_BYTES) throw Error('WAVEFORM_LIMIT'); chunks.push(value);
        }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return waveformPeaks(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
/** Authorized JSON only; 800 source ticks per bucket, independent of timeline FPS. */
export function TimelineWaveform({ clip, entry, cache }: { clip: AudioClip; entry?: PreviewMedia;cache?:Map<string,number[]> }) {
    const [state, setState] = useState<{ peaks?: number[]; error?: boolean }>({});
    const identity = JSON.stringify(entry?.ref);
    useEffect(() => {
        const controller = new AbortController(); setState({});
        if (entry) void (async () => {
            try {
                const peaks=await waveformReads.run(controller.signal,async()=>{
                const issued = await window.studio.derivedMediaUrl(entry.ref);
                if (!issued.ok) throw Error('WAVEFORM_AUTH');
                try{
                if(controller.signal.aborted)throw controller.signal.reason;
                const peaks = cache?.get(identity) ?? await readWaveform(issued.value, controller.signal);
                if(cache&&!controller.signal.aborted){while(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(identity,peaks);emitTimelineReadStats({kind:'cache',size:cache.size});}
                return peaks;
                }finally{await window.studio.releaseMediaUrl(issued.value).catch(()=>{});}
                });
                if (!controller.signal.aborted) setState({ peaks });
            } catch { if (!controller.signal.aborted) setState({ error: true }); }
        })();
        return () => controller.abort();
    }, [identity]);
    if (!entry) return <small>缺少波形，请明确准备编辑预览</small>;
    if (state.error) return <small role="status">波形无效，请重新准备</small>;
    if (!state.peaks) return <small role="status">读取授权波形…</small>;
    const start = Math.floor(clip.sourceInTicks / 800), end = Math.ceil((clip.sourceInTicks + clip.durationTicks) / 800);
    if (end > state.peaks.length) return <small role="status">波形范围不足，请重新准备</small>;
    const stride = Math.max(1, Math.ceil((end - start) / 240)), bars = [];
    for (let i = start; i < end; i += stride) {
        const right = Math.min(end, i + stride), peak = Math.max(...state.peaks.slice(i, right));
        const x = Math.max(0, (i * 800 - clip.sourceInTicks) / clip.durationTicks * 1000);
        const edge = Math.min(1000, (right * 800 - clip.sourceInTicks) / clip.durationTicks * 1000);
        bars.push(<rect key={i} x={x} y={(100 - peak * 100) / 2} width={Math.max(.5, edge - x - 1)} height={peak * 100}/>);
    }
    return <svg className="timeline-waveform" role="img" aria-label={`音频波形 ${clip.id}`} viewBox="0 0 1000 100" preserveAspectRatio="none">{bars}</svg>;
}
