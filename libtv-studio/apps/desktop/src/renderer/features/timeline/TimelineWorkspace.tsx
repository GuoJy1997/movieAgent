import {MAX_TIMELINE_VIDEO_CLIPS,MAX_TIMELINE_AUDIO_CLIPS_PER_TRACK} from '../../../../../../packages/contracts/src/timeline-limits.ts';
import {batchPreviewReferences,resolvePreviewBatch,previewBatchLabels,type PreviewBatch} from './preview-batches.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_TIMELINE_SETTINGS, type PreparedAssembly, type TimelineRevision, type TimelineOp } from '../../../../../../packages/contracts/src/timeline.ts';
import type { MediaReference } from '../../../../../../packages/contracts/src/assets.ts';
import type { LocalJobRef, LocalMediaPlan, ResolvedMedia } from '../../../../../../packages/contracts/src/render.ts';
import { frameTicks, mediaStreamEndTicks, timelineEndTicks, timelineWarnings } from '../../../../../../packages/domain/src/timeline-time.ts';
import { applyTimelineOps } from '../../../../../../packages/domain/src/timeline-edit.ts';
import { Button, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { Dialog } from '../../../../../../packages/ui/src/overlays.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { useTimelineEditor } from './useTimelineEditor.ts';
import { TimelineTracks } from './TimelineTracks.tsx';
import { TimelinePreview, type PreviewMedia } from './TimelinePreview.tsx';
import { ClipInspector } from './ClipInspector.tsx';
import { SubtitleEditor } from './SubtitleEditor.tsx';
import { RenderBudgetField, ExportDialog, LocalJobControls, LocalPlanApproval } from './ExportDialog.tsx';
import { AudioWorkspace, type AudioDraftHandle } from '../audio/AudioWorkspace.tsx';
import { useOwnedDraft, timelineNavigate } from '../../state/DraftNavigationGuard.tsx';
export { timelineNavigate } from '../../state/DraftNavigationGuard.tsx';
/** App and local selectors share the same explicit save/discard navigation gate. */
export function TimelineWorkspace({ projectId, initialTimelineId = '', onTimelineChange, compactLayout=false }: {
    projectId: string; initialTimelineId?: string;compactLayout?:boolean; onTimelineChange?(id:string):void;
}) {
    const runtime = useRuntime(), list = useWorkspaceQuery('timeline.list', { projectId }), creation = useWorkspaceQuery('creation.read', { projectId });
    const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
    const [selected, setSelected] = useState(initialTimelineId), [created, setCreated] = useState<TimelineRevision | null>(null), [name, setName] = useState('新剪辑'), [script, setScript] = useState('');
    const subproject=useWorkspaceQuery('subproject.read',runtime.scope??{projectId,subprojectId:'none'},!!runtime.scope);
    const id = selected || subproject.data?.primaryTimelineId || list.data?.timelines[0]?.id || '', query = useWorkspaceQuery('timeline.read', { projectId, timelineId: id }, !!id);
    const source = created?.id === id ? created : query.data;
    async function create() { const chosen = creation.data?.scripts.find(s => s.id === (script || creation.data?.scripts[0]?.id)); if (!chosen)
        return; const result = await runtime.command('timeline.create', { projectId, id: crypto.randomUUID(), scriptRef: { id: chosen.id, revision: chosen.revision }, title: name, settings: DEFAULT_TIMELINE_SETTINGS }); if (result&&live.current) {
        setCreated(result);
        setSelected(result.id);onTimelineChange?.(result.id);
    } }
    return <section className="page timeline-page"><header className="page-head"><div><p className="eyebrow">EDIT & FINISH</p><h1>剪辑成片</h1><p>固定素材、两条附加音轨与字幕 · 本机处理</p></div><Field label="当前时间线"><select value={id} onChange={e => { const next = e.target.value; timelineNavigate(() => { setSelected(next);onTimelineChange?.(next); setCreated(null); }); }}>{(list.data?.timelines ?? []).map(t => <option key={t.id} value={t.id}>{t.title} · r{t.revision} · 剧本 {t.scriptRef.id} r{t.scriptRef.revision}</option>)}{created && !list.data?.timelines.some(t => t.id === created.id) && <option value={created.id}>{created.title} r{created.revision}</option>}</select></Field></header>
    <details open={!id} className="timeline-new"><summary>新建另一条命名时间线</summary><div className="toolbar"><Field label="新时间线名称"><input maxLength={200} value={name} onChange={e => setName(e.target.value)}/></Field><Field label="所属剧本"><select value={script || creation.data?.scripts[0]?.id || ''} onChange={e => setScript(e.target.value)}>{creation.data?.scripts.map(s => <option key={s.id} value={s.id}>{s.title} r{s.revision}</option>)}</select></Field><Button disabled={!name.trim() || !creation.data?.scripts.length || runtime.busy || !runtime.online || runtime.pending} onClick={() => timelineNavigate(() => void create())}>新建空时间线</Button></div></details>
    <QueryState loading={query.isPending && !!id} error={query.error}/>{!id && <p>先创建空时间线，再从当前镜头生成粗剪；同一剧本可以有多个剪辑版本。</p>}
    {source && source.id === id && <TimelineEditor key={`${projectId}/${id}`} source={source} compactLayout={compactLayout}/>}
  </section>;
}
function TimelineEditor({ source,compactLayout=false }: {
    source: TimelineRevision;compactLayout?:boolean;
}) {
    const editor = useTimelineEditor(source), runtime = useRuntime(), t = editor.draft;
    const history = useWorkspaceQuery('timeline.history', { projectId: t.projectId, timelineId: t.id }), creation = useWorkspaceQuery('creation.read', { projectId: t.projectId }), assets = useWorkspaceQuery('asset.search', { state: 'active', latestOnly: true }), jobs = useWorkspaceQuery('render.list', { projectId: t.projectId });
    const [panel,setPanel]=useState('preview');
    const [intermediateBudget,setIntermediateBudget]=useState(2*1024**3),[jobsOpen,setJobsOpen]=useState(false);
    const [previewFit, setPreviewFit] = useState<'timeline'|'contain'|'cover'>('timeline'), [selected, setSelected] = useState(''), [ticks, setTicks] = useState(0), [playing, setPlaying] = useState(false), [tab, setTab] = useState<'media' | 'audio' | 'subtitles'>('media'), [exporting, setExporting] = useState<TimelineRevision | null>(null), [plan, setPlan] = useState<LocalMediaPlan | null>(null), [assembly, setAssembly] = useState<PreparedAssembly | null>(null), [allowImages, setAllowImages] = useState(false), [rough, setRough] = useState(false), [analysis, setAnalysis] = useState<{
        media: ResolvedMedia;
        track: 'video' | 'voice' | 'music';
        replace: boolean;
    } | null>(null), [analyzing, setAnalyzing] = useState(false), [analysisError, setAnalysisError] = useState(''), [replacement, setReplacement] = useState(false), [ripple, setRipple] = useState<TimelineOp[] | null>(null), [entries, setEntries] = useState<Record<string, PreviewMedia[]>>({}), [audioDraft, setAudioDraft] = useState<AudioDraftHandle | null>(null), [subtitleDraft, setSubtitleDraft] = useState<AudioDraftHandle | null>(null);
    const previewEntries=useMemo(()=>Object.values(entries).flat(),[entries]);
    const [previewBatches,setPreviewBatches]=useState<PreviewBatch[]>([]),[previewBatch,setPreviewBatch]=useState(0);
    const previewScope=useRef(0);
    useEffect(()=>{previewScope.current++;setPreviewBatches([]);setPlan(p=>p?.kind==='derived'?null:p);},[t.libraryId,t.projectId,t.id,t.revision,previewFit,runtime.descriptor?.connectionEpoch]);
    const active = useRef(true), identity = useRef(`${t.libraryId}/${t.projectId}/${t.id}`);
    const identityKey = identity.current;
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    useOwnedDraft({ dirty: editor.dirty || editor.saving, save: editor.save, discard: editor.discard }, editor.draft);
    useOwnedDraft(audioDraft ?? { dirty: false, save: async () => true, discard() {} }, audioDraft);
    useOwnedDraft(subtitleDraft ?? { dirty: false, save: async () => true, discard() {} }, subtitleDraft);
    useEffect(() => { const close = (event: BeforeUnloadEvent) => { if (audioDraft?.dirty || subtitleDraft?.dirty) {
        event.preventDefault();
        event.returnValue = '';
    } }; window.addEventListener('beforeunload', close); return () => window.removeEventListener('beforeunload', close); }, [audioDraft, subtitleDraft]);
    const seek = useCallback((value: number) => setTicks(value), []), play = useCallback((value: boolean) => setPlaying(value), []);
    const clip = [...t.videoClips, ...t.audioClips].find(c => c.id === selected) ?? null;
    function edit(ops: TimelineOp[]) { return editor.edit(ops); }
    function split() { if (selected)
        edit([{ kind: 'split', clipId: selected, atTicks: Math.round(ticks / frameTicks(t.fps)) * frameTicks(t.fps), operationId: crypto.randomUUID() }]); }
    useEffect(() => { const shortcut = (event: KeyboardEvent) => { const target = event.target as HTMLElement; if (target.closest('input,textarea,select,[contenteditable="true"],dialog'))
        return; if (event.code === 'Space') {
        event.preventDefault();
        setPlaying(v => !v);
    }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        setPlaying(false);
        setTicks(v => Math.max(0, Math.min(timelineEndTicks(t), Math.floor(v / frameTicks(t.fps)) * frameTicks(t.fps) + (event.key === 'ArrowRight' ? 1 : -1) * frameTicks(t.fps))));
    }
    else if (event.key === 'Delete' && selected) {
        event.preventDefault();
        edit([{ kind: 'delete', clipId: selected }]);
    }
    else if (event.key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey)
        split();
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? editor.redo() : editor.undo();
    } }; window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut); });
    async function analyze(reference: MediaReference, track: 'video' | 'voice' | 'music', replace = false) { setAnalyzing(true); setAnalysisError(''); try {
        const media = await runtime.command('media.inspect', { projectId: t.projectId, reference });
        if (media && active.current && identity.current === identityKey)
            setAnalysis({ media, track, replace });
    }
    catch {
        setAnalysisError('媒体分析失败，请重试。');
    }
    finally {
        if (active.current)
            setAnalyzing(false);
    } }
    async function settings() { const config = await window.studio.readModelConfig(); if (config.ok)
        await window.studio.openModelConfigEditor({ expectedVersion: config.value.version }); }
    async function preparePreview(index?:number) {
      const batches=index===undefined?batchPreviewReferences(t,previewFit):previewBatches;
      const at=index??0,batch=batches[at];if(!batch)return;
      setPreviewBatches(batches);setPreviewBatch(at);
      const scope=previewScope.current;
      const p=await runtime.command('media.prepareDerived',{projectId:t.projectId,references:batch.references,fps:t.fps,canvas:t.canvas,videoFit:batch.videoFit,executionOwner:'desktop-user',runId:crypto.randomUUID()});
      if(active.current&&scope===previewScope.current){
        setPreviewBatches(all=>all.map((b,i)=>i===at?{...b,state:p?'prepared':'failed',...(p?{planId:p.planId,executionOwner:p.executionOwner}:{})}:b));
        if(p)setPlan(p);
      }
    }
    function bindPreviewAttempt(planId:string,job:LocalJobRef){
      if(!active.current||job.libraryId!==t.libraryId||job.projectId!==t.projectId)return;
      setPreviewBatches(all=>all.map(b=>b.planId===planId?{...b,job,state:'enqueued'}:b));
    }
    async function retryPreview(batch:PreviewBatch){
      if(!batch.job||!batch.executionOwner||!batch.planId)return;
      const scope=previewScope.current,job=await runtime.command('render.retry',{jobId:batch.job.jobId,executionOwner:batch.executionOwner,runId:crypto.randomUUID()});
      if(job&&scope===previewScope.current)bindPreviewAttempt(batch.planId,job);
    }
    const locked = !runtime.online || runtime.busy || runtime.pending;
    return <><div className="toolbar timeline-editor-head"><Field label="时间线名称"><input maxLength={200} value={t.title} onChange={e => edit([{ kind: 'setSettings', settings: { fps: t.fps, canvas: t.canvas }, title: e.target.value }])}/></Field><span role="status">{editor.saving ? '保存中' : editor.dirty ? '未保存' : '已保存'} · 基准r{editor.baseline.revision}</span><Button disabled={!editor.canUndo} onClick={editor.undo}>撤销</Button><Button disabled={!editor.canRedo} onClick={editor.redo}>重做</Button><Button disabled={locked || editor.saving || !editor.dirty} onClick={() => void editor.save()}>保存时间线</Button><Button disabled={editor.dirty || editor.saving} onClick={() => setExporting(editor.baseline)}>导出</Button></div>
    {(editor.error || analysisError) && <p role="alert" className="alert">{editor.error || analysisError}</p>}{runtime.error && <p role="alert">{runtime.error.code.includes('CONFLICT') ? '冲突 · ' : ''}{runtime.error.message}</p>}
    <p aria-label="时间线容量">画面 {t.videoClips.length} / {MAX_TIMELINE_VIDEO_CLIPS} · 配音 {t.audioClips.filter(c=>c.track==='voice').length} / {MAX_TIMELINE_AUDIO_CLIPS_PER_TRACK} · 音乐 {t.audioClips.filter(c=>c.track==='music').length} / {MAX_TIMELINE_AUDIO_CLIPS_PER_TRACK}</p>
    {timelineWarnings(t).map(w => <p className="warning-text" key={w.code}>BLACK_VIDEO_TAIL · {w.startTicks / 48000}秒后没有画面，将输出黑场至{w.endTicks / 48000}秒。</p>)}
    <Button onClick={() => setRough(true)}>从当前镜头生成粗剪</Button><details className="timeline-preview-options" open={!compactLayout}><summary>预览质量与处理预算</summary><div className="toolbar"><Button disabled={locked || editor.dirty || !t.videoClips.length && !t.audioClips.length} onClick={() => void preparePreview()}>准备编辑预览（{previewFit === 'timeline' ? '按片段适配' : previewFit === 'contain' ? '完整包含' : '裁切铺满'}）</Button><Field label="编辑代理画面适配"><select value={previewFit} onChange={e => setPreviewFit(e.target.value as 'timeline'|'contain'|'cover')}><option value="timeline">按片段适配</option><option value="contain">完整包含 · contain</option><option value="cover">裁切铺满 · cover</option></select></Field><Button disabled={locked || editor.dirty || !timelineEndTicks(t)} onClick={async () => { const p = await runtime.command('render.prepare', { timelineRef: { libraryId: t.libraryId, projectId: t.projectId, id: t.id, revision: editor.baseline.revision }, purpose: 'preview', intermediateBudgetBytes:intermediateBudget, executionOwner: 'desktop-user', runId: crypto.randomUUID() }); if (p)
        setPlan(p); }}>准备正式渲染校验预览</Button><Field label="帧率"><select disabled={!!(t.videoClips.length + t.audioClips.length + t.subtitleCues.length)} value={t.fps.num} onChange={e => edit([{ kind: 'setSettings', settings: { fps: { num: Number(e.target.value) as 24 | 25 | 30, den: 1 }, canvas: t.canvas } }])}>{[24, 25, 30].map(n => <option key={n}>{n}</option>)}</select></Field><Field label="画幅"><select value={`${t.canvas.width}x${t.canvas.height}`} onChange={e => { const [width, height] = e.target.value.split('x').map(Number); edit([{ kind: 'setSettings', settings: { fps: t.fps, canvas: { width: width as 1920 | 1080, height: height as 1080 | 1920 } } }]); }}><option value="1920x1080">16:9</option><option value="1080x1920">9:16</option><option value="1080x1080">1:1</option></select></Field></div>
    {previewBatches.length>0&&<div className="form-stack"><p role="status">编辑代理批次 {previewBatch+1} / {previewBatches.length}</p>{previewBatches.map((b,i)=>{const state=resolvePreviewBatch(b,jobs.data?.jobs??[]),job=b.job&&(jobs.data?.jobs??[]).find(j=>j.jobId===b.job!.jobId);const stopped=['failed','cancelled','interrupted'].includes(state);return <div key={b.id} role="group" aria-label={'编辑代理第 '+(i+1)+' 批'}>第 {i+1} 批 · {b.references.length} 素材 · {b.videoFit} · {previewBatchLabels[state]}<Button disabled={locked||!!plan||['enqueued','queued','running','succeeded'].includes(state)} onClick={()=>void(b.job?retryPreview(b):preparePreview(i))}>{stopped?'重试':'准备'}编辑代理第 {i+1} 批</Button>{b.job&&b.executionOwner&&job?.needsResume&&job.errorCode!=='LOCAL_JOB_RETRY_REQUIRED'&&<Button disabled={locked} onClick={()=>void runtime.command('render.resume',{jobId:b.job!.jobId,executionOwner:b.executionOwner!})}>继续编辑代理第 {i+1} 批</Button>}{b.job&&b.executionOwner&&['enqueued','queued','running'].includes(state)&&<Button disabled={locked||job?.cancelRequested} onClick={()=>void runtime.command('render.cancel',{jobId:b.job!.jobId,executionOwner:b.executionOwner!})}>{job?.cancelRequested?'正在取消':'取消'}编辑代理第 {i+1} 批</Button>}</div>;})}</div>}
    <RenderBudgetField value={intermediateBudget} onChange={setIntermediateBudget}/></details>
    <div className="narrow-panel-tabs"><Button onClick={()=>setPanel("sources")}>素材与声音</Button><Button onClick={()=>setPanel("preview")}>预览与属性</Button></div><div className="timeline-workbench" data-panel={panel}><aside className="timeline-sources"><div className="toolbar"><Button onClick={() => setTab('media')}>镜头与素材</Button><Button onClick={() => setTab('audio')}>声音与字幕</Button><Button onClick={() => setTab('subtitles')}>手动字幕</Button></div>
      {tab === 'media' && <><h3>{replacement ? '选择替换素材' : '固定素材'}</h3>{analyzing && <p role="status">媒体分析中 · 本机探测</p>}{(assets.data?.assets ?? []).filter(a => a.mime !== 'text/plain').map(a => <div className="timeline-source" key={`${a.ref.assetId}-${a.ref.version}`}><strong>{a.name}</strong><small>固定 v{a.ref.version} · {a.mime}</small><Button disabled={locked || analyzing} onClick={() => void analyze(a.ref, a.mime.startsWith('audio/') ? 'voice' : 'video', replacement)}>分析并选择{replacement ? '替换' : '插入'}</Button></div>)}</>}
      {<div hidden={tab !== 'audio'}><AudioWorkspace onDraft={setAudioDraft} projectId={t.projectId} timeline={t} onEdit={edit} onAnalyze={(ref, track) => void analyze(ref, track)} onSettings={() => void settings()}/></div>}
      {<div hidden={tab !== 'subtitles'}><SubtitleEditor onDraft={setSubtitleDraft} timeline={t} onEdit={edit}/></div>}
    </aside><TimelinePreview timeline={t} entries={previewEntries} ticks={ticks} playing={playing} onSeek={seek} onPlaying={play}/><ClipInspector clip={clip} onEdit={edit} onReplace={() => { setReplacement(true); setTab('media'); }}/></div>
    <div className="toolbar"><Button disabled={!selected} onClick={split}>分割（S）</Button><Button disabled={!selected} onClick={() => edit([{ kind: 'delete', clipId: selected }])}>删除（保留间隙）</Button><Button disabled={!clip || clip.kind === 'audio'} onClick={() => setRipple([{ kind: 'rippleDelete', clipId: selected, operationId: crypto.randomUUID() }])}>预览波纹删除</Button></div>
    <TimelineTracks entries={previewEntries} timeline={t} selected={selected} onSelect={setSelected} onEdit={edit} ticks={ticks} onSeek={value => { setPlaying(false); setTicks(value); }}/>
    <details onToggle={event=>setJobsOpen(event.currentTarget.open)}><summary>本机处理与导出状态</summary>{(jobs.data?.jobs ?? []).map(j => <div key={j.jobId}>{jobsOpen && <LocalJobControls job={j} onJobStarted={next=>bindPreviewAttempt(j.planId,next)}/>}{j.kind === 'derived' && j.state === 'SUCCEEDED' && <DerivedEntries projectId={t.projectId} planId={j.planId} onEntries={value => setEntries(all => JSON.stringify(all[j.planId]) === JSON.stringify(value) ? all : { ...all, [j.planId]: value })}/>}</div>)}</details>
    <details><summary>持久修订历史（显式恢复）</summary>{(history.data?.revisions ?? []).map(r => <p key={r.revision}>r{r.revision} · {r.title} · {(timelineEndTicks(r) / 48000).toFixed(2)}秒 <Button disabled={locked || editor.dirty || editor.saving || r.revision === editor.baseline.revision} onClick={() => void editor.restore(r.revision)}>恢复此修订 r{r.revision}</Button></p>)}</details>
    {analysis && <MediaAdoption media={analysis.media} track={analysis.track} timeline={t} replacing={analysis.replace ? clip : null} ticks={ticks} onClose={() => setAnalysis(null)} onAdopt={ops => { if (edit(ops)) {
        setAnalysis(null);
        setReplacement(false);
    } }}/>}
    {ripple && <Dialog title="确认波纹删除范围" onClose={() => setRipple(null)}><p>切除视频片段区间，并同步裁切、拆分或前移所有后续轨道：</p><RippleSummary timeline={t} operations={ripple}/><Button tone="danger" onClick={() => { edit(ripple); setRipple(null); }}>采用波纹删除</Button></Dialog>}
    {rough && <Dialog title="从当前镜头准备粗剪" onClose={() => setRough(false)} wide><p>固定剧本 {t.scriptRef.id} r{t.scriptRef.revision} · 将替换当前时间线内容，旧修订保留。</p>{creation.data?.shots.filter(s => s.scriptId === t.scriptRef.id).sort((a, b) => a.order - b.order).map(s => { const selection = creation.data?.selections.find(n => n.shotId === s.id && n.shotRevision === s.revision); return <p key={s.id}>{s.title} r{s.revision} · 选择r{selection?.selectionRevision ?? 0} · {selection?.video ? '视频' : selection?.image ? '图片（需允许）' : '缺少素材'}</p>; })}<label className="check"><input type="checkbox" checked={allowImages} onChange={e => setAllowImages(e.target.checked)}/>明确允许选用图片</label><Button disabled={locked || editor.dirty} onClick={async () => { const shots = (creation.data?.shots ?? []).filter(s => s.scriptId === t.scriptRef.id).sort((a, b) => a.order - b.order); const p = await runtime.command('timeline.prepareAssembly', { projectId: t.projectId, scriptRef: t.scriptRef, shots: shots.map(s => ({ id: s.id, revision: s.revision, selectionRevision: creation.data?.selections.find(n => n.shotId === s.id && n.shotRevision === s.revision)?.selectionRevision ?? 0 })), target: { id: t.id, expectedRevision: editor.baseline.revision }, allowImages, settings: { fps: t.fps, canvas: t.canvas }, executionOwner: 'desktop-user', runId: crypto.randomUUID() }); if (p && active.current) {
        setAssembly(p);
        setRough(false);
    } }}>分析固定来源与实际长度</Button></Dialog>}
    {assembly && <Dialog title="确认固定粗剪" onClose={() => setAssembly(null)} wide><p>固定版本 · 实际总长 {timelineEndTicks(assembly.draft) / 48000}秒</p>{assembly.draft.videoClips.map((c, i) => <p key={c.id}>{c.provenance?.shotId} r{c.provenance?.shotRevision} · {c.kind} · {JSON.stringify(c.media)} · 实际{c.durationTicks / 48000}秒 / 目标{(assembly.differences[i]?.intendedTicks ?? 0) / 48000}秒 · 差值{(assembly.differences[i]?.deltaTicks ?? 0) / 48000}秒</p>)}<Button disabled={locked || editor.dirty} onClick={async () => { const result = await runtime.command('timeline.applyAssembly', { planId: assembly.planId, planHash: assembly.planHash, executionOwner: assembly.executionOwner, runId: assembly.runId }); if (result && active.current) {
        editor.adopt(result);
        setAssembly(null);
    } }}>采用这一固定粗剪</Button></Dialog>}
    {plan && <LocalPlanApproval plan={plan} onEnqueued={job=>{if(plan.kind==='derived')bindPreviewAttempt(plan.planId,job);}} onClose={() => setPlan(null)}/>} {exporting && <ExportDialog timeline={exporting} onClose={() => setExporting(null)}/>}</>;
}
function DerivedEntries({ projectId, planId, onEntries }: {
    projectId: string; initialTimelineId?: string;compactLayout?:boolean; onTimelineChange?(id:string):void;
    planId: string;
    onEntries(entries: PreviewMedia[]): void;
}) { const query = useWorkspaceQuery('media.derived', { projectId, planId },true,undefined,'fixed'); useEffect(() => { onEntries(query.data ? query.data.entries.map(entry => ({...entry, recipe:query.data!.recipe})) : []); }, [query.data]); return null; }
function RippleSummary({ timeline, operations }: {
    timeline: TimelineRevision;
    operations: TimelineOp[];
}) { const result = applyTimelineOps(timeline, operations); if (!result.ok)
    return <p role="alert">{result.error.message}</p>; const after = [...result.value.videoClips, ...result.value.audioClips, ...result.value.subtitleCues]; return <div className="cue-list">{[...timeline.videoClips, ...timeline.audioClips, ...timeline.subtitleCues].map(c => { const next = after.find(n => n.id === c.id); return JSON.stringify(next) === JSON.stringify(c) ? null : <p key={c.id}>{c.id} · {c.startTicks / 48000}秒 → {next ? `${next.startTicks / 48000}秒（范围可能裁切）` : '删除'}</p>; })}{after.filter(c => ![...timeline.videoClips, ...timeline.audioClips, ...timeline.subtitleCues].some(n => n.id === c.id)).map(c => <p key={c.id}>拆分新段 {c.id} · {c.startTicks / 48000}秒</p>)}</div>; }
function MediaAdoption({ media, track, timeline, replacing, ticks, onClose, onAdopt }: {
    media: ResolvedMedia;
    track: 'video' | 'voice' | 'music';
    timeline: TimelineRevision;
    replacing: import('./useTimelineEditor.ts').TimelineClip | null;
    ticks: number;
    onClose(): void;
    onAdopt(ops: TimelineOp[]): void;
}) {
    const frame = frameTicks(timeline.fps), audio = media.mime.startsWith('audio/'), kind = audio ? 'audio' : media.mime.startsWith('image/') ? 'image' : 'video';
    const duration = kind === 'image' ? 5 * 48000 : media.probe ? mediaStreamEndTicks(media.probe, audio ? 'audio' : 'video') : 0;
    const [seconds, setSeconds] = useState(duration / 48000), [at, setAt] = useState(Math.round(ticks / frame) * frame / 48000);
    const mismatch = !!replacing && replacing.kind !== kind, chosen = audio ? Math.round(seconds * 48000) : Math.floor(seconds * 48000 / frame) * frame;
    return <Dialog title={replacing ? '确认替换固定素材' : '确认插入固定素材'} onClose={onClose}><div className="form-stack"><p>{JSON.stringify(media.ref)} · {media.mime} · SHA256 {media.hash}</p><p>已分析真实长度 {kind === 'image' ? '静态图片，手动展示时长' : `${duration / 48000}秒`} · 音量100% {kind === 'video' ? '· 旧素材视频原声默认静音' : ''}</p><Field label="插入位置（秒）"><input type="number" min="0" value={at} onChange={e => setAt(Number(e.target.value))}/></Field><Field label="采用时长（秒）"><input type="number" min="0" max={kind === 'image' ? 600 : duration / 48000} value={seconds} onChange={e => setSeconds(Number(e.target.value))}/></Field>{chosen > Math.max(0, timelineEndTicks(timeline) - Math.round(at * 48000)) && audio && <p className="warning-text">声音比当前剩余画面长 {(chosen - Math.max(0, timelineEndTicks(timeline) - Math.round(at * 48000))) / 48000}秒；请明确裁切或调整时间线，不会自动变速。</p>}{mismatch && <p role="alert">替换只允许相同媒体类型。跨类型请明确删除后插入。</p>}<Button disabled={mismatch || chosen <= 0 || kind !== 'image' && chosen > duration} onClick={() => { if (replacing) {
        onAdopt([{ kind: 'replaceMedia', clipId: replacing.id, media: media.ref, sourceHash: media.hash, sourceProbeId: media.probe?.probeId ?? null, sourceInTicks: 0, durationTicks: chosen }]);
        return;
    } const common = { id: crypto.randomUUID(), media: media.ref, sourceHash: media.hash, sourceInTicks: 0, startTicks: audio ? Math.round(at * 48000) : Math.round(at * 48000 / frame) * frame, durationTicks: chosen, gainMilli: 1000, mute: !audio }; onAdopt([{ kind: 'insert', clip: audio ? { ...common, kind: 'audio', track: track === 'music' ? 'music' : 'voice', sourceProbeId: media.probe!.probeId } : { ...common, kind: kind as 'video' | 'image', sourceProbeId: media.probe?.probeId ?? null, fit: 'contain' } }]); }}>采用固定素材</Button></div></Dialog>;
}
