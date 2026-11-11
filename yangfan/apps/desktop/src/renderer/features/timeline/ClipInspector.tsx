import { useEffect, useState } from 'react';
import type { TimelineOp } from '../../../../../../packages/contracts/src/timeline.ts';
import type { TimelineClip } from './useTimelineEditor.ts';
import { Button, Field } from '../../../../../../packages/ui/src/controls.tsx';
export function ClipInspector({ clip, onEdit, onReplace }: {
    clip: TimelineClip | null;
    onEdit(ops: TimelineOp[]): unknown;
    onReplace(): void;
}) {
    const [start, setStart] = useState(''), [source, setSource] = useState(''), [duration, setDuration] = useState('');
    useEffect(() => { setStart(String((clip?.startTicks ?? 0) / 48000)); setSource(String((clip?.sourceInTicks ?? 0) / 48000)); setDuration(String((clip?.durationTicks ?? 0) / 48000)); }, [clip]);
    if (!clip)
        return <aside className="timeline-inspector"><h3>片段属性</h3><p>选择片段以修改入出点、适配与音量。</p></aside>;
    const ticks = (v: string) => Math.round(Number(v) * 48000);
    return <aside className="timeline-inspector form-stack"><h3>片段属性</h3><p>{clip.id} · 固定素材 {clip.media.kind === 'artifact' ? clip.media.artifactId : `${clip.media.assetId} v${clip.media.version}`}</p>
    <Field label="片段起点（秒）"><input type="number" min="0" step="any" value={start} onChange={e => setStart(e.target.value)}/></Field>
    <Field label="源入点（秒）"><input type="number" min="0" step="any" disabled={clip.kind === 'image'} value={source} onChange={e => setSource(e.target.value)}/></Field>
    <Field label="片段时长（秒）"><input type="number" min="0" step="any" value={duration} onChange={e => setDuration(e.target.value)}/></Field>
    <Button onClick={() => onEdit([{ kind: 'move', clipId: clip.id, startTicks: ticks(start) }, { kind: 'trim', clipId: clip.id, sourceInTicks: clip.kind === 'image' ? 0 : ticks(source), durationTicks: ticks(duration) }])}>采用入出点</Button>
    <Field label="音量（%）"><input type="range" min="0" max="200" step="1" value={clip.gainMilli / 10} onChange={e => onEdit([{ kind: 'setGain', clipId: clip.id, gainMilli: Number(e.target.value) * 10, mute: clip.mute }])}/></Field><span>{clip.gainMilli / 10}% · 最终混音限制峰值</span>
    <label className="check"><input type="checkbox" checked={clip.mute} onChange={e => onEdit([{ kind: 'setGain', clipId: clip.id, gainMilli: clip.gainMilli, mute: e.target.checked }])}/>{clip.kind === 'audio' ? '静音' : '静音视频原声'}</label>
    {clip.kind !== 'audio' && <Field label="画面适配"><select value={clip.fit} onChange={e => onEdit([{ kind: 'setFit', clipId: clip.id, fit: e.target.value as 'contain' | 'cover' }])}><option value="contain">完整显示</option><option value="cover">填满裁切</option></select></Field>}
    {clip.dialogueGroupId && <><p>对白关联组 {clip.dialogueGroupId} · {clip.kind === 'audio' ? '独立配音' : clip.mute ? '修正画面（原声已静音）' : '原生视频声音'}。移动、裁切、分割和删除保持同步。</p><Button tone="quiet" onClick={() => onEdit([{ kind: 'unlinkDialogueGroup', clipId: clip.id }])}>取消对白关联（可能失步）</Button></>}
    <Button onClick={onReplace}>选择替换素材</Button>
  </aside>;
}
