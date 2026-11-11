import { useEffect, useRef, useState } from 'react';
import type { MediaReference } from '../../../../../../packages/contracts/src/assets.ts';
import type { AudioBatchPlan, TranscriptRevision } from '../../../../../../packages/contracts/src/audio.ts';
import type { TimelineRevision, TimelineOp } from '../../../../../../packages/contracts/src/timeline.ts';
import { Button, Field } from '../../../../../../packages/ui/src/controls.tsx';
import { Dialog } from '../../../../../../packages/ui/src/overlays.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { GenerationApproval } from '../canvas/GenerationApproval.tsx';
import { MediaPreview } from '../assets/MediaPreview.tsx';
import { transcriptCues, CueAdoption } from '../timeline/SubtitleEditor.tsx';
import { useRevisionDraft } from '../creation/useRevisionDraft.ts';
import { VoiceoverReviewPanel } from './VoiceoverPanel.tsx';
export interface AudioDraftHandle {
    dirty: boolean;
    save(): Promise<boolean>;
    discard(): void;
}
export function AudioWorkspace({ projectId, timeline, onEdit, onAnalyze, onSettings, onDraft }: {
    projectId: string;
    timeline: TimelineRevision;
    onEdit(ops: TimelineOp[]): unknown;
    onAnalyze(ref: MediaReference, track: 'voice' | 'music'): void;
    onSettings(): void;
    onDraft?(draft: AudioDraftHandle): void;
}) {
    const runtime = useRuntime(), audio = useWorkspaceQuery('audio.read', { projectId }), profiles = useWorkspaceQuery('profile.list', {}), models = useWorkspaceQuery('model.list', {}), tasks = useWorkspaceQuery('task.list', {}), assets = useWorkspaceQuery('asset.search', { mediaType: 'audio', state: 'active', latestOnly: true });
    const [text, setText] = useState(''), [profile, setProfile] = useState(''), [checked, setChecked] = useState<string[]>([]), [plan, setPlan] = useState<AudioBatchPlan | null>(null), [batchId, setBatchId] = useState(''), [transcript, setTranscript] = useState<TranscriptRevision | null>(null), [asrProfile, setAsrProfile] = useState(''), [asr, setAsr] = useState<import('../../../../../../packages/contracts/src/generation.ts').PreparedGeneration | null>(null);
    const batch = useWorkspaceQuery('audio.batch', { projectId, planId: batchId }, !!batchId), scope = useRef(projectId);
    scope.current = projectId;
    const speechProfiles = (profiles.data?.profiles ?? []).filter(p => models.data?.models.some(m => m.id === p.modelRef.id && m.revision === p.modelRef.revision && m.capabilities.taskTypes.some(t => t === 'text_to_speech'))), asrProfiles = (profiles.data?.profiles ?? []).filter(p => models.data?.models.some(m => m.id === p.modelRef.id && m.revision === p.modelRef.revision && m.capabilities.taskTypes.some(t => t === 'speech_to_text')));
    const locked = !runtime.online || runtime.busy || runtime.pending;
    const [transcriptDirty, setTranscriptDirty] = useState(false);
    const textNow = useRef(text), alive = useRef(true), savingLine = useRef(false);
    textNow.current = text;
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function saveLine() { if (!textNow.current.trim())
        return true; if (savingLine.current)
        return false; const submitted = textNow.current; savingLine.current = true; try {
        const line = await runtime.command('audio.saveVoiceLine', { projectId, id: crypto.randomUUID(), expectedRevision: 0, text: submitted });
        if (line && alive.current) {
            setChecked(ids => [...ids, line.id]);
            if (textNow.current === submitted) {
                textNow.current = '';
                setText('');
                return true;
            }
        }
        return false;
    }
    finally {
        savingLine.current = false;
    } }
    useEffect(() => { onDraft?.({ dirty: !!text.trim() || transcriptDirty, save: async () => transcriptDirty ? false : saveLine(), discard: () => {setText('');setTranscript(null);setTranscriptDirty(false);} }); }, [text, transcriptDirty, onDraft]);
    return <div className="audio-workspace form-stack"><header className="toolbar"><h3>声音与字幕</h3><Button onClick={onSettings}>配置音频模型（受保护窗口）</Button></header><p className="hint">云端生成 · 明确批准后提交</p>
    <Field label="配音文案"><textarea maxLength={4000} value={text} onChange={e => setText(e.target.value)}/></Field><Button disabled={locked || !text.trim()} onClick={() => void saveLine()}>保存配音文案</Button>
    <Button disabled={locked} onClick={async () => { const result = await window.studio.selectImportFiles(); if (result.ok && result.value)
        await runtime.command('asset.importGrantedFiles', { grantId: result.value.grantId }); }}>从系统导入声音素材</Button>
    <Field label="配音 voice 预设"><select value={profile} onChange={e => setProfile(e.target.value)}><option value="">选择已验证的配音预设</option>{speechProfiles.map(p => <option key={p.id} value={p.id}>{p.name} r{p.revision} · voice {String(p.parameters.voice ?? '预设默认')}</option>)}</select></Field>
    {(audio.data?.voiceLines ?? []).map(line => <label className="check" key={line.id}><input type="checkbox" checked={checked.includes(line.id)} onChange={e => setChecked(ids => e.target.checked ? [...ids, line.id] : ids.filter(id => id !== line.id))}/><span>{line.text} <small>r{line.revision}</small></span></label>)}
    <Button disabled={locked || !profile || checked.length === 0 || checked.length > 16} onClick={async () => { const p = speechProfiles.find(p => p.id === profile); if (!p)
        return; const result = await runtime.command('audio.prepareSpeech', { projectId, lines: (audio.data?.voiceLines ?? []).filter(l => checked.includes(l.id)).map(l => ({ lineId: l.id, revision: l.revision, profileRef: { libraryId: p.libraryId, id: p.id, revision: p.revision } })), executionOwner: 'desktop-user', runId: crypto.randomUUID() }); if (result)
        setPlan(result); }}>准备所选配音批次</Button>
    <p className="hint">每批最多16条 / 16000字符。准备页显示全文、模型、voice与价格；结果不会自动插入时间线。</p>
    {plan && <GenerationApproval confirmLabel="批准整批配音" prepared={{ ...plan.items[0]!.prepared, estimateMicros: plan.estimateMicros, currency: plan.currency }} onClose={() => setPlan(null)} summary={<div><p>整批 {plan.items.length}条 · 一次批准</p>{plan.items.map(item => <div key={item.lineId}><p>{item.prepared.prompt}</p><small>{item.prepared.config.model.name} · voice {String(item.prepared.config.parameters.voice ?? '默认')} · 文案r{item.revision}</small></div>)}</div>} onApprove={async (input) => { const result = await runtime.command('audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: plan.executionOwner, runId: plan.runId, approval: { currency: input.currency, allowanceMicros: input.allowanceMicros, budgetLimitMicros: input.budgetLimitMicros, acknowledgeUnknown: input.acknowledgeUnknown } }); if (result)
        setBatchId(plan.planId); return result; }}/>}
    {batch.data && <section><p>批次 {batch.data.state}</p>{batch.data.tasks.map(item => { const task = tasks.data?.tasks.find(t => t.taskId === item.task?.taskId); return <p key={item.lineId}>{item.lineId} r{item.revision} · {task?.state ?? '准备中'} {item.diagnostic ?? task?.errorCode}{task?.collectionState === 'retryable_failure' && <Button onClick={() => void runtime.command('task.retryCollection', { taskId: task.taskId })}>重试收存原结果</Button>}</p>; })}<Button disabled={locked || batch.data.state === 'stopped'} onClick={() => void runtime.command('audio.stopBatch', { projectId, planId: batch.data!.plan.planId, executionOwner: batch.data!.plan.executionOwner })}>停止该配音批次</Button></section>}
    <h4>配音结果（固定原件）</h4>{(audio.data?.takes ?? []).map(take => <div key={take.id}><p>文案 {take.lineId} r{take.lineRevision} · 原任务 {take.task.taskId}</p>{audio.data?.voiceLines.some(line=>line.id===take.lineId&&line.revision===take.lineRevision&&line.dialogueSource) ? <VoiceoverReviewPanel projectId={projectId} takeId={take.id} onAdopt={()=>onAnalyze(take.output,'voice')}/> : <><MediaPreview media={take.output} original/><Button onClick={() => onAnalyze(take.output, 'voice')}>分析并选择插入配音轨</Button></>}</div>)}
    <h4>本地声音素材</h4>{(assets.data?.assets ?? []).map(asset => <div key={asset.ref.assetId}><p>{asset.name} v{asset.ref.version}</p><Button onClick={() => onAnalyze(asset.ref, 'voice')}>分析并插入配音轨</Button><Button onClick={() => onAnalyze(asset.ref, 'music')}>分析并插入音乐轨</Button></div>)}
    <Field label="语音识别预设"><select value={asrProfile} onChange={e => setAsrProfile(e.target.value)}><option value="">选择已验证预设</option>{asrProfiles.map(p => <option key={p.id} value={p.id}>{p.name} r{p.revision}</option>)}</select></Field>
    {(assets.data?.assets ?? []).map(asset => <Button disabled={locked || !asrProfile} key={asset.ref.assetId} onClick={async () => { const p = asrProfiles.find(p => p.id === asrProfile); if (!p)
        return; const result = await runtime.command('audio.prepareTranscription', { projectId, source: asset.ref, profileRef: { libraryId: p.libraryId, id: p.id, revision: p.revision }, executionOwner: 'desktop-user', runId: crypto.randomUUID() }); if (result)
        setAsr(result); }}>准备识别 {asset.name} v{asset.ref.version}</Button>)}
    {asr && <GenerationApproval prepared={asr} onClose={() => setAsr(null)} summary={<p>识别所选固定音频 · {(asr.audioSource?.durationTicks ?? 0) / 48000}秒 · {asr.audioSource?.byteLength}字节 · 不自动拆分上传</p>}/>}
    {(audio.data?.diagnostics ?? []).map(d => <p role="alert" key={d.task.taskId}>{d.task.taskId} · {d.code} · 原返回保留供诊断</p>)}
    {(audio.data?.transcripts ?? []).map(t => <Button key={`${t.id}-${t.revision}`} onClick={() => setTranscript(t)}>编辑转写 {t.id} r{t.revision}</Button>)}
    {transcript && <TranscriptEditor key={`${transcript.id}-${transcript.revision}`} transcript={transcript} timeline={timeline} onEdit={onEdit} onDirty={setTranscriptDirty} onClose={() => {setTranscript(null);setTranscriptDirty(false);}}/>}
  </div>;
}
function TranscriptEditor({ transcript, timeline, onEdit, onClose, onDirty }: {
    transcript: TranscriptRevision;
    timeline: TimelineRevision;
    onEdit(ops: TimelineOp[]): unknown;
    onClose(): void;
    onDirty(value:boolean):void;
}) {
    const runtime = useRuntime(), draft = useRevisionDraft(() => ({ expectedRevision: transcript.revision, text: transcript.text, segments: transcript.segments, timing: transcript.timing })), [saved, setSaved] = useState(transcript);
    const value = { ...transcript, ...draft.draft, revision: saved.revision }, cues = transcriptCues(value, timeline);
    useEffect(()=>{onDirty(draft.dirty);return()=>onDirty(false);},[draft.dirty,onDirty]);
    return <Dialog title="转写与人工校时" onClose={onClose} dirty={draft.dirty} wide><div className="form-stack">{draft.draft.timing === 'none' && <p role="status">待校时：没有可靠时间戳</p>}<Field label="转写全文"><textarea value={draft.draft.text} onChange={e => draft.change({ text: e.target.value })}/></Field>
    <Button disabled={!transcript.source} onClick={() => draft.change({ timing: 'segments', segments: [...draft.draft.segments, { startTicks: 0, endTicks: 48000, text: draft.draft.text.slice(0, 200) }] })}>新增人工校时句段</Button>
    {draft.draft.segments.map((s, i) => <div className="form-grid" key={i}><Field label={`句段${i + 1}起点（秒）`}><input type="number" min="0" value={s.startTicks / 48000} onChange={e => draft.change({ segments: draft.draft.segments.map((n, j) => j === i ? { ...n, startTicks: Math.round(Number(e.target.value) * 48000) } : n) })}/></Field><Field label={`句段${i + 1}终点（秒）`}><input type="number" min="0" value={s.endTicks / 48000} onChange={e => draft.change({ segments: draft.draft.segments.map((n, j) => j === i ? { ...n, endTicks: Math.round(Number(e.target.value) * 48000) } : n) })}/></Field><Field label={`句段${i + 1}文字`}><textarea maxLength={200} value={s.text} onChange={e => draft.change({ segments: draft.draft.segments.map((n, j) => j === i ? { ...n, text: e.target.value } : n) })}/></Field></div>)}
    <Button disabled={draft.saving || runtime.busy || runtime.pending || !runtime.online} onClick={() => void draft.save(v => runtime.command('audio.saveTranscript', { projectId: timeline.projectId, id: transcript.id, ...v }), r => ({ expectedRevision: r.revision, text: r.text, segments: r.segments, timing: r.timing }), r => setSaved(r))}>保存校时修订</Button>
    <p>字幕映射按原音频入点与时间线偏移，裁去片段外的句段。当前可映射 {cues.length}条。</p><CueAdoption cues={cues} timeline={timeline} onEdit={onEdit} onComplete={onClose} disabled={draft.dirty || draft.draft.timing !== 'segments'}/></div></Dialog>;
}
