import {emitTimelineReadStats} from './read-diagnostics.ts';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { TimelineRevision, TimelineOp } from '../../../../../../packages/contracts/src/timeline.ts';
import { frameTicks, timelineEndTicks } from '../../../../../../packages/domain/src/timeline-time.ts';
import { Field } from '../../../../../../packages/ui/src/controls.tsx';
import type { PreviewMedia } from './TimelinePreview.tsx';
import { TimelineWaveform } from './TimelineWaveform.tsx';
export function TimelineTracks({ timeline, entries, selected, onSelect, onEdit, ticks, onSeek }: {
    timeline: TimelineRevision;
    entries: PreviewMedia[];
    selected: string;
    onSelect(id: string): void;
    onEdit(ops: TimelineOp[]): unknown;
    ticks: number;
    onSeek(ticks: number): void;
}) {
    const waveforms=useMemo(()=>{const byHash=new Map<string,PreviewMedia>();for(const entry of entries)if(entry.kind==='waveform'&&!byHash.has(entry.ref.sourceHash))byHash.set(entry.ref.sourceHash,entry);return byHash;},[entries]);
    const waveformCache=useRef(new Map<string,number[]>());
    useEffect(()=>{const cache=waveformCache.current;return()=>{cache.clear();emitTimelineReadStats({kind:'cache',size:0});};},[]);
    const [zoom, setZoom] = useState(1), [snap, setSnap] = useState(true), [drag, setDrag] = useState<{
        id: string;
        start: number;
    } | null>(null);
    const gesture = useRef<{
        id: string;
        x: number;
        start: number;
        audio: boolean;
    } | null>(null);
    const scale = 24 * zoom / 48000, end = Math.max(10 * 48000, timelineEndTicks(timeline) + 5 * 48000), frame = frameTicks(timeline.fps);
    const tracks = [['视频轨', timeline.videoClips], ['配音轨', timeline.audioClips.filter(c => c.track === 'voice')], ['音乐轨', timeline.audioClips.filter(c => c.track === 'music')], ['字幕轨', timeline.subtitleCues]] as const;
    return <section className="timeline-tracks" aria-label="四轨时间线">
    <div className="toolbar"><Field label="时间线缩放"><input type="range" min="0.5" max="4" step="0.25" value={zoom} onChange={e => setZoom(Number(e.target.value))}/></Field><label className="check"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)}/>吸附</label><span>视频空隙为黑场 · 音频空隙为静音</span></div>
    <div className="track-scroll"><div style={{ width: Math.max(650, end * scale + 96) }}>
      <div className="track-ruler"><span>时间尺</span><input aria-label="轨道播放头" type="range" min="0" max={end} step={frame} value={ticks} onChange={e => onSeek(Number(e.target.value))}/></div>
      {tracks.map(([name, items]) => <div className="timeline-track" key={name}><strong>{name}</strong><div className="track-lane" style={{ width: end * scale }}>
        <i className="track-playhead" style={{ left: ticks * scale }}/>
        {items.map(c => <button key={c.id} type="button" aria-label={`选择片段 ${c.id}`} aria-pressed={selected === c.id} className={`timeline-clip ${name === '字幕轨' ? 'caption-clip' : ''}`} style={{ left: (drag?.id === c.id ? drag.start : c.startTicks) * scale, width: Math.max(30, ('durationTicks' in c ? c.durationTicks : c.endTicks - c.startTicks) * scale) }} onClick={() => onSelect(c.id)} onPointerDown={e => { if (e.button !== 0)
                return; e.currentTarget.setPointerCapture(e.pointerId); gesture.current = { id: c.id, x: e.clientX, start: c.startTicks, audio: 'kind' in c && c.kind === 'audio' }; onSelect(c.id); }} onPointerMove={e => { const g = gesture.current; if (!g || g.id !== c.id)
                return; let start = Math.max(0, g.start + (e.clientX - g.x) / scale); const unit = g.audio ? 1 : frame; start = Math.round(start / unit) * unit; if (snap) {
                const points = [0, ...timeline.videoClips.filter(n => n.id !== g.id).flatMap(n => [n.startTicks, n.startTicks + n.durationTicks])];
                const near = points.find(p => Math.abs(p - start) * scale < 8);
                if (near !== undefined)
                    start = near;
            } setDrag({ id: g.id, start }); }} onPointerUp={e => { const g = gesture.current; if (!g)
                return; gesture.current = null; e.currentTarget.releasePointerCapture(e.pointerId); if (drag?.id === g.id && drag.start !== g.start)
                onEdit([{ kind: 'move', clipId: g.id, startTicks: drag.start }]); setDrag(null); }} onPointerCancel={() => { gesture.current = null; setDrag(null); }}>
          <span>{'text' in c ? c.text : c.id}</span><small>{(c.startTicks / 48000).toFixed(2)}s · {'kind' in c ? (c.kind === 'audio' ? c.mute ? '静音' : '附加音频' : c.mute ? '原声静音' : `原声 ${c.gainMilli / 10}%`) : '字幕'}</small>
          {'kind' in c && c.kind === 'audio' && <VisibleWaveform clip={c} entry={waveforms.get(c.sourceHash)} cache={waveformCache.current}/>}
        </button>)}
      </div></div>)}
    </div></div>
  </section>;
}

const VisibleWaveform=memo(function VisibleWaveform({clip,entry,cache}:{clip:import('../../../../../../packages/contracts/src/timeline.ts').AudioClip;entry?:PreviewMedia;cache:Map<string,number[]>}){
 const element=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const node=element.current;if(!node)return;const root=node.closest('.track-scroll');const observer=new IntersectionObserver(items=>setVisible(items.some(item=>item.isIntersecting)),{root,rootMargin:'256px'});observer.observe(node);return()=>observer.disconnect();},[]);
 return <span ref={element}>{visible&&<TimelineWaveform clip={clip} entry={entry} cache={cache}/>}</span>;
});
