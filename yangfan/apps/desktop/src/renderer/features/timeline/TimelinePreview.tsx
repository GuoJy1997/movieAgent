import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TimelineRevision, AudioClip, VideoClip } from '../../../../../../packages/contracts/src/timeline.ts';
import type { DerivedMediaRef, DerivedMediaRecipe } from '../../../../../../packages/contracts/src/render.ts';
import { frameTicks, timelineEndTicks } from '../../../../../../packages/domain/src/timeline-time.ts';
import { Button } from '../../../../../../packages/ui/src/controls.tsx';
type Clip = AudioClip | VideoClip;
export interface PreviewMedia {
    ref: DerivedMediaRef;
    kind: 'proxy' | 'thumbnail' | 'waveform';
    mime: string;
    recipe: DerivedMediaRecipe;
}
export function compatibleProxy(entries:PreviewMedia[],clip:Clip,timeline:TimelineRevision) {
    return entries.find(e=>e.kind==='proxy'&&e.ref.sourceHash===clip.sourceHash&&e.recipe?.fps.num===timeline.fps.num&&e.recipe.fps.den===timeline.fps.den&&e.recipe.canvas.width===timeline.canvas.width&&e.recipe.canvas.height===timeline.canvas.height&&(clip.kind==='audio'||e.recipe.videoFit===clip.fit));
}
/** One timeline clock drives every player. Players cannot advance the shared head. */
export function TimelinePreview({ timeline, entries, ticks, playing, onSeek, onPlaying }: {
    timeline: TimelineRevision;
    entries: PreviewMedia[];
    ticks: number;
    playing: boolean;
    onSeek(ticks: number): void;
    onPlaying(value: boolean): void;
}) {
    const head = useRef(ticks), last = useRef(0), end = timelineEndTicks(timeline), frame = frameTicks(timeline.fps);
    head.current = ticks;
    useEffect(() => {
        if (!playing) return;
        let request = 0;
        last.current = performance.now();
        const originTicks = head.current;
        const next = (now: number) => {
            head.current = Math.min(end, originTicks + Math.round((now - last.current) * 48));
            onSeek(head.current);
            if (head.current >= end) onPlaying(false);
            else request = requestAnimationFrame(next);
        };
        request = requestAnimationFrame(next);
        return () => cancelAnimationFrame(request);
    }, [playing, end, onSeek, onPlaying]);
    const video = timeline.videoClips.find(c => c.startTicks <= ticks && ticks < c.startTicks + c.durationTicks);
    const audios = timeline.audioClips.filter(c => c.startTicks <= ticks && ticks < c.startTicks + c.durationTicks);
    const caption = timeline.subtitleCues.find(c => c.startTicks <= ticks && ticks < c.endTicks);
    const proxy = (clip: Clip) => compatibleProxy(entries,clip,timeline);
    return <section className="timeline-preview" aria-label="画面与音频预览"><p className="eyebrow">编辑预览 · 非正式校验</p>
    <div className="timeline-screen" style={{ aspectRatio: `${timeline.canvas.width}/${timeline.canvas.height}` }}>
      {!video ? <span>黑场 · 视频轨空隙</span> : video.kind === 'image' ? <PreviewPlayer key={video.id} clip={video} ticks={ticks} playing={playing}/> : proxy(video) ? <PreviewPlayer key={video.id} clip={video} entry={proxy(video)} ticks={ticks} playing={playing}/> : <span role="status">准备编辑预览：缺少兼容代理（帧率、画幅、适配）</span>}
      {caption && <p className="timeline-caption" style={{ color: timeline.subtitleStyle.color, fontSize: `${timeline.subtitleStyle.fontSize / 1920 * 100}cqw`, bottom: `${timeline.subtitleStyle.bottomMargin / 1080 * 100}%`, textShadow: `0 1px ${timeline.subtitleStyle.outline}px black` }}>{caption.text}</p>}
    </div>
    <div className="preview-audio-status">{audios.map(c => <span key={c.id}>{c.track === 'voice' ? '配音' : '音乐'} · {c.mute ? '静音' : `${c.gainMilli / 10}%`}{proxy(c) ? <PreviewPlayer clip={c} entry={proxy(c)} ticks={ticks} playing={playing}/> : <small> · 缺少编辑代理</small>}</span>)}</div>
    <div className="toolbar"><Button aria-label="前一帧" onClick={() => { onPlaying(false); onSeek(Math.max(0, Math.floor(ticks / frame) * frame - frame)); }}>−1帧</Button><Button onClick={() => onPlaying(!playing)} disabled={!end}>{playing ? '暂停' : '播放'}</Button><Button aria-label="后一帧" onClick={() => { onPlaying(false); onSeek(Math.min(end, Math.floor(ticks / frame) * frame + frame)); }}>+1帧</Button><output aria-label="当前时码">{(ticks / 48000).toFixed(3)} / {(end / 48000).toFixed(3)} 秒</output></div>
    <input aria-label="预览播放头" type="range" min="0" max={end || 1} step={frame} value={ticks} onChange={e => { onPlaying(false); onSeek(Number(e.target.value)); }}/>
  </section>;
}
function PreviewPlayer({ clip, entry, ticks, playing }: {
    clip: Clip;
    entry?: PreviewMedia;
    ticks: number;
    playing: boolean;
}) {
    const [url, setUrl] = useState(''), [error, setError] = useState('');
    const player = useRef<HTMLMediaElement | null>(null), identity = JSON.stringify([clip.media, entry?.ref]), authorization = useRef(0), generation = useRef(0);
    const audioGraph = useRef<{ context: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode } | null>(null);
    const current = useRef({ ticks, playing });
    current.current = { ticks, playing };
    useLayoutEffect(() => {
        const token = ++authorization.current;
        let stopped = false, heldUrl='';
        const release=(url:string)=>{if(url)void window.studio.releaseMediaUrl(url).catch(()=>{});};
        setUrl('');
        setError('');
        async function issue() { try {
            const result = entry ? await window.studio.derivedMediaUrl(entry.ref) : await window.studio.mediaUrl({ libraryId: clip.media.libraryId, ref: clip.media, variant: 'original' });
            if (stopped || token !== authorization.current){if(result.ok)release(result.value);return;}
            if (result.ok) {
                const previous=heldUrl;heldUrl=result.value;release(previous);
                setUrl(result.value);
                setError('');
            }
            else {
                player.current?.pause();
                setUrl('');
                setError(result.error.message);
            }
        }
        catch {
            if (!stopped) {
                player.current?.pause();
                setUrl('');
                setError('媒体授权已失效，请重新准备。');
            }
        } }
        void issue();
        const renew = setInterval(() => void issue(), 90000);
        return () => { stopped = true; authorization.current++; generation.current++; clearInterval(renew); const media = player.current; if (media) {
            media.pause();
            media.removeAttribute('src');
            media.load();
        }
            release(heldUrl);heldUrl='';
            const graph = audioGraph.current;
            audioGraph.current = null;
            if (graph) {
                graph.source.disconnect();
                graph.gain.disconnect();
                void graph.context.close().catch(() => {});
            }
        };
    }, [identity]);
    const target = (clip.sourceInTicks + ticks - clip.startTicks) / 48000;
    useLayoutEffect(() => {
        const media = player.current;
        if (!media)
            return;
        const token = ++generation.current;
        media.pause();
        if (clip.gainMilli > 1000 && !audioGraph.current) {
            let context: AudioContext | undefined;
            try {
                context = new AudioContext();
                const source = context.createMediaElementSource(media);
                const gain = context.createGain();
                source.connect(gain);
                gain.connect(context.destination);
                audioGraph.current = { context, source, gain };
            } catch {
                void context?.close().catch(() => {});
                setError('编辑预览音量处理不可用，请使用正式渲染校验。');
                return;
            }
        }
        if (audioGraph.current) {
            media.volume = 1;
            audioGraph.current.gain.gain.setValueAtTime(clip.gainMilli / 1000, audioGraph.current.context.currentTime);
            if (playing) void audioGraph.current.context.resume().catch(() => {});
        } else media.volume = clip.gainMilli / 1000;
        media.muted = clip.mute;
        if (Math.abs(media.currentTime - target) > 0.07)
            media.currentTime = Math.max(0, target);
        if (playing && !clip.mute)
            void media.play().then(() => { if (token !== generation.current || !current.current.playing)
                media.pause(); }).catch(() => { });
        else if (playing && clip.kind !== 'audio')
            void media.play().catch(() => { });
        return () => { media.pause(); };
    }, [url, playing, clip.id, clip.mute, clip.gainMilli]);
    useEffect(() => { const media = player.current; if (media && Math.abs(media.currentTime - target) > 0.12) {
        media.pause();
        media.currentTime = Math.max(0, target);
        if (playing)
            void media.play().catch(() => { });
    } }, [target]);
    if (error)
        return <span role="alert">{error}</span>;
    if (!url)
        return <span role="status">读取媒体授权…</span>;
    if (clip.kind === 'image')
        return <img src={url} alt={`固定画面 ${clip.id}`} style={{ objectFit: clip.fit }} onError={() => { setUrl(''); setError('图片不可读，请重新分析素材。'); }}/>;
    const props = { src: url, ref: (node: HTMLMediaElement | null) => { player.current = node; }, onLoadedMetadata: () => { if (player.current)
            player.current.currentTime = Math.max(0, target); }, onError: () => { player.current?.pause(); setError('代理不可读，请重新准备编辑预览。'); setUrl(''); } };
    // Video proxies already contain the chosen fit in this exact canvas recipe.
    return clip.kind === 'audio' ? <audio crossOrigin="anonymous" {...props} preload="metadata"/> : <video crossOrigin="anonymous" {...props} playsInline preload="metadata" style={{ objectFit: 'fill' }}/>;
}
