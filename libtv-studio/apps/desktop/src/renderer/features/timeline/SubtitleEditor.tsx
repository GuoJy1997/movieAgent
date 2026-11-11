import { useEffect, useState } from 'react';
import { isSubtitleCue, isTimelineRevision, type TimelineRevision, type TimelineOp, type SubtitleCue } from '../../../../../../packages/contracts/src/timeline.ts';
import type { TranscriptRevision } from '../../../../../../packages/contracts/src/audio.ts';
import { frameTicks } from '../../../../../../packages/domain/src/timeline-time.ts';
import { Button, Field } from '../../../../../../packages/ui/src/controls.tsx';
/** Source-relative ASR timings intersect the audible source interval, then map to timeline. */
export function transcriptCues(transcript: TranscriptRevision, timeline: TimelineRevision): SubtitleCue[] {
    if (transcript.timing !== 'segments' || !transcript.source)
        return [];
    const source = JSON.stringify(transcript.source), frame = frameTicks(timeline.fps);
    const clips = [...timeline.audioClips, ...timeline.videoClips].filter(c => JSON.stringify(c.media) === source);
    return clips.flatMap(clip => transcript.segments.flatMap((s, i) => {
        const a = Math.max(s.startTicks, clip.sourceInTicks), b = Math.min(s.endTicks, clip.sourceInTicks + clip.durationTicks);
        const startTicks = Math.round((clip.startTicks + a - clip.sourceInTicks) / frame) * frame, endTicks = Math.round((clip.startTicks + b - clip.sourceInTicks) / frame) * frame;
        return a < b && startTicks < endTicks ? [{ id: `cue_${clip.id}_${transcript.id}_${transcript.revision}_${i}`, startTicks, endTicks, text: s.text, transcript: { id: transcript.id, revision: transcript.revision, segmentId: String(i) } }] : [];
    }));
}
export function parseSrt(text: string, fps: TimelineRevision['fps']): SubtitleCue[] {
    const frame = frameTicks(fps), lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    // Frame by timestamp headers: a leading blank belongs to the cue's valid text.
    const timestamps = lines.flatMap((line, index) => /^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})$/.test(line) ? [index] : []);
    const numbered = /^\d+$/.test(lines[(timestamps[0] ?? 0) - 1] ?? '');
    const headers = timestamps.map((index, i) => ({ index, start: index > 0 && /^\d+$/.test(lines[index - 1]!) &&
        (i === 0 || !lines[index - 2]?.trim() || numbered && Number(lines[index - 1]) === i + 1) ? index - 1 : index }));
    if (!headers.length || lines.slice(0, headers[0]!.start).some(line => line.trim())) throw Error('SRT 需要编号、时码和文字。');
    if (headers.length > 1000)
        throw Error('字幕超过1000条。');
    const stamp = (a: string) => { const m = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(a); if (!m || Number(m[2]) > 59 || Number(m[3]) > 59)
        throw Error('SRT 时码无效。'); return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000) * 48000 / frame) * frame; };
    return headers.map((header, i) => { const parts = lines[header.index]!.split(/\s+-->\s+/);
        const body = lines.slice(header.index + 1, headers[i + 1]?.start ?? lines.length);
        const framing = i + 1 < headers.length ? 2 : 1;
        for (let n = 0; n < framing && body.at(-1) === ''; n++) body.pop();
        const cue = { id: `srt_${crypto.randomUUID()}`, startTicks: stamp(parts[0]!), endTicks: stamp(parts[1]!), text: body.join('\n') }; if (!isSubtitleCue(cue))
        throw Error(`第${i + 1}条字幕文字或范围无效。`); return cue; });
}
/** Whole-range validation, explicit <=100-cue adoption; rejected edits retain every candidate. */
export function CueAdoption({ cues, timeline, onEdit, onComplete, label = '采用为字幕', disabled = false }: {
    cues: SubtitleCue[];
    timeline: TimelineRevision;
    onEdit(ops: TimelineOp[]): unknown;
    onComplete?(): void;
    label?: string;
    disabled?: boolean;
}) {
    const remaining = cues.filter(c => !timeline.subtitleCues.some(existing => existing.id === c.id));
    const merged = [...timeline.subtitleCues, ...remaining].sort((a, b) => a.startTicks - b.startTicks);
    const valid = isTimelineRevision({ ...timeline, subtitleCues: merged });
    const count = Math.min(100, remaining.length);
    return <div><p>待采用 {remaining.length}条 · 本次明确采用 {count}条（每批最多100）。保存当前草稿后可继续下一批。</p>{!valid && remaining.length > 0 && <p role="alert">完整字幕范围有重叠、越界或超过1000条，请先调整。</p>}<Button disabled={disabled || !valid || !count} onClick={() => { if (onEdit(remaining.slice(0, count).map(cue => ({ kind: 'setCue', cue }))) && remaining.length <= 100)
        onComplete?.(); }}>{label}{remaining.length > 100 ? `（下${count}条）` : ''}</Button></div>;
}
export function SubtitleEditor({ timeline, onEdit, onDraft }: {
    timeline: TimelineRevision;
    onEdit(ops: TimelineOp[]): unknown;
    onDraft?(draft: import('../audio/AudioWorkspace.tsx').AudioDraftHandle): void;
}) {
    const [cue, setCue] = useState<SubtitleCue>({ id: crypto.randomUUID(), startTicks: 0, endTicks: 48000, text: '' }), [imported, setImported] = useState<SubtitleCue[]>([]), [error, setError] = useState('');
    useEffect(() => { onDraft?.({ dirty: !!cue.text || imported.length > 0, save: async () => { setError('请先明确采用当前字幕草稿，再保存时间线。'); return false; }, discard: () => { setImported([]); setCue(c => ({ ...c, text: '' })); } }); }, [cue, imported, onDraft]);
    async function importSrt() { setError(''); try {
        const result = await window.studio.selectSubtitleFile();
        if (!result.ok) {
            setError(result.error.message);
            return;
        }
        if (result.value)
            setImported(parseSrt(result.value.text, timeline.fps));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '字幕文件无法读取。');
    } }
    return <section className="form-stack"><h3>字幕编辑</h3><Button onClick={() => void importSrt()}>从系统选择 SRT</Button>{error && <p role="alert">{error}</p>}
    {imported.length > 0 && <div className="approval-summary"><p>导入预览 · {imported.length}条 · {(imported[0]!.startTicks / 48000).toFixed(2)}–{(imported.at(-1)!.endTicks / 48000).toFixed(2)}秒</p><div className="cue-list">{imported.map(c => <p key={c.id}>{c.text}</p>)}</div><CueAdoption cues={imported} timeline={timeline} onEdit={onEdit} onComplete={() => setImported([])} label="采用导入字幕"/></div>}
    <Field label="字幕文字"><textarea maxLength={200} value={cue.text} onChange={e => setCue({ ...cue, text: e.target.value })}/></Field><div className="form-grid"><Field label="字幕起点（秒）"><input type="number" min="0" step={1 / timeline.fps.num} value={cue.startTicks / 48000} onChange={e => setCue({ ...cue, startTicks: Math.round(Number(e.target.value) * timeline.fps.num) * frameTicks(timeline.fps) })}/></Field><Field label="字幕终点（秒）"><input type="number" min="0" step={1 / timeline.fps.num} value={cue.endTicks / 48000} onChange={e => setCue({ ...cue, endTicks: Math.round(Number(e.target.value) * timeline.fps.num) * frameTicks(timeline.fps) })}/></Field></div>
    <Button disabled={!isSubtitleCue(cue)} onClick={() => { if (onEdit([{ kind: 'setCue', cue }]))
        setCue({ ...cue, id: crypto.randomUUID(), text: '' }); }}>保存字幕到草稿</Button>
    <div className="cue-list">{timeline.subtitleCues.map(c => <div key={c.id}><button onClick={() => setCue(c)}>{(c.startTicks / 48000).toFixed(2)}–{(c.endTicks / 48000).toFixed(2)} · {c.text}</button><Button onClick={() => onEdit([{ kind: 'delete', clipId: c.id }])}>删除字幕</Button></div>)}</div>
    <Field label="字幕字号"><input type="number" min="12" max="120" value={timeline.subtitleStyle.fontSize} onChange={e => onEdit([{ kind: 'setSettings', settings: { fps: timeline.fps, canvas: timeline.canvas }, subtitleStyle: { ...timeline.subtitleStyle, fontSize: Number(e.target.value) } }])}/></Field>
    <Field label="字幕颜色"><input type="color" value={timeline.subtitleStyle.color} onChange={e => onEdit([{ kind: 'setSettings', settings: { fps: timeline.fps, canvas: timeline.canvas }, subtitleStyle: { ...timeline.subtitleStyle, color: e.target.value } }])}/></Field>
    <Field label="字幕底边距"><input type="number" min="0" max="400" value={timeline.subtitleStyle.bottomMargin} onChange={e => onEdit([{ kind: 'setSettings', settings: { fps: timeline.fps, canvas: timeline.canvas }, subtitleStyle: { ...timeline.subtitleStyle, bottomMargin: Number(e.target.value) } }])}/></Field>
    <Field label="字幕描边"><input type="number" min="0" max="10" value={timeline.subtitleStyle.outline} onChange={e => onEdit([{ kind: 'setSettings', settings: { fps: timeline.fps, canvas: timeline.canvas }, subtitleStyle: { ...timeline.subtitleStyle, outline: Number(e.target.value) } }])}/></Field>
    <p className="hint">使用固定 Noto Sans CJK SC 字体。导出预检会检查缺字；缺字时阻止烧录。</p>
  </section>;
}
