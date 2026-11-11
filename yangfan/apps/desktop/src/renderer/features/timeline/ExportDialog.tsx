import { useEffect, useRef, useState } from 'react';
import type { TimelineRevision } from '../../../../../../packages/contracts/src/timeline.ts';
import type { ExportKind, ExportReceipt, ExportTimelineInput } from '../../../../../../packages/contracts/src/timeline-export.ts';
import type { LocalJobRef, LocalMediaPlan, RenderJobView, RenderPlan } from '../../../../../../packages/contracts/src/render.ts';
import { timelineEndTicks, timelineWarnings } from '../../../../../../packages/domain/src/timeline-time.ts';
import { Button, Field } from '../../../../../../packages/ui/src/controls.tsx';
import { Dialog } from '../../../../../../packages/ui/src/overlays.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { MediaPreview } from '../assets/MediaPreview.tsx';
const mib = (bytes: number) => (bytes / 1024 ** 2).toFixed(1) + ' MiB';
export function LocalJobControls({ job, onJobStarted }: {
    job: RenderJobView;
    onJobStarted?(job:LocalJobRef):void;
}) {
    const runtime = useRuntime(), plan = useWorkspaceQuery('render.plan', { projectId: job.projectId, planId: job.planId },true,undefined,'fixed');
    const owner = plan.data?.executionOwner, locked = !owner || !runtime.online || runtime.busy || runtime.pending;
    return <div className="local-job"><strong>本机处理 · {job.kind === 'derived' ? '编辑缓存' : '合成输出'} · {job.state}</strong><p>{job.phase} · 已处理 {(job.progressTicks / 48000).toFixed(2)}秒 · 第{job.attempt}次</p>{job.errorCode && <p role="alert">{job.errorCode}</p>}
    {job.needsResume && job.errorCode !== 'LOCAL_JOB_RETRY_REQUIRED' && <Button disabled={locked} onClick={() => void runtime.command('render.resume', { jobId: job.jobId, executionOwner: owner! })}>继续原作业</Button>}
    {['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.state) && <Button disabled={locked} onClick={async () => { const next=await runtime.command('render.retry', { jobId: job.jobId, executionOwner: owner!, runId: crypto.randomUUID() });if(next)onJobStarted?.(next); }}>{job.errorCode === 'LOCAL_JOB_RETRY_REQUIRED' ? '从头重试同一固定计划' : '新尝试（同一固定计划）'}</Button>}
    {['QUEUED', 'RUNNING', 'VERIFYING', 'PUBLISHING'].includes(job.state) && <Button disabled={locked || job.cancelRequested} onClick={() => void runtime.command('render.cancel', { jobId: job.jobId, executionOwner: owner! })}>{job.cancelRequested ? '正在取消' : '取消本机作业'}</Button>}
    {plan.data?.kind === 'render' && <small>固定 {plan.data.timelineRef.id} r{plan.data.timelineRef.revision} · {plan.data.purpose}</small>}
    {plan.data?.kind === 'render' && plan.data.purpose !== 'wav' && <small> · 字幕{plan.data.burnSubtitles === false ? '不烧录' : '烧录'}</small>}
    {plan.data?.kind === 'render' && plan.data.purpose === 'preview' && job.state === 'SUCCEEDED' && job.outputRef && <details><summary>播放正式渲染校验预览 r{plan.data.timelineRef.revision}</summary><MediaPreview media={job.outputRef} original/></details>}
  </div>;
}
export function LocalPlanApproval({ plan, onClose, onEnqueued }: {
    plan: LocalMediaPlan;
    onClose(): void;
    onEnqueued?(job:LocalJobRef):void;
}) {
    const runtime = useRuntime(), [confirm, setConfirm] = useState(false), active=useRef(true);
    useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
    return <Dialog title="确认本机处理" onClose={onClose}><div className="form-stack"><p>本机处理 · 不调用云端模型 · 同库同时一项重型作业</p><p>预计中间件与结果：{mib(plan.estimatedBytes)} · 所需可用空间：{mib(plan.requiredFreeBytes)}（含安全余量）</p>{plan.kind === 'render' && <p>固定时间线 {plan.timelineRef.id} r{plan.timelineRef.revision} · {(plan.durationTicks / 48000).toFixed(3)}秒 · {plan.purpose === 'preview' ? '正式渲染校验预览' : plan.purpose.toUpperCase()}</p>}
    {plan.kind === 'render' && plan.notices.map(n => <p className="warning-text" key={n}>{n === 'BLACK_VIDEO_TAIL' ? '音频或字幕长于画面，尾部将输出黑场。' : n}</p>)}
    <label className="check"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)}/>确认磁盘占用与固定版本</label><Button tone="primary" disabled={!confirm || runtime.busy || runtime.pending || !runtime.online} onClick={async () => { const result = await runtime.command(plan.kind === 'render' ? 'render.enqueue' : 'media.enqueueDerived', { planId: plan.planId, planHash: plan.planHash, executionOwner: plan.executionOwner, runId: plan.runId, diskBudgetBytes: plan.requiredFreeBytes }); if (result&&active.current){onEnqueued?.(result);onClose();} }}>批准本机处理</Button></div></Dialog>;
}
export function ExportDialog({ timeline, onClose }: {
    timeline: TimelineRevision;
    onClose(): void;
}) {
    const runtime = useRuntime(), jobs = useWorkspaceQuery('render.list', { projectId: timeline.projectId }), exports = useWorkspaceQuery('timeline.exports', { projectId: timeline.projectId, timelineId: timeline.id });
    const [intermediateBudget,setIntermediateBudget]=useState(2*1024**3), [kind, setKind] = useState<ExportKind>('mp4'), [plan, setPlan] = useState<RenderPlan | null>(null), [receipt, setReceipt] = useState<ExportReceipt | null>(null), [error, setError] = useState(''), [copying, setCopying] = useState(false), [burnSubtitles, setBurnSubtitles] = useState(true), [cancelling,setCancelling] = useState<string|null>(null);
    const cancelledRequests=useRef(new Set<string>());
    const request = useRef<ExportTimelineInput | null>(null), active = useRef(true);
    const locked = !runtime.online || runtime.busy || runtime.pending;
    async function copy(input: ExportTimelineInput) { if (copying)
        return; request.current = input; setCopying(true); setError(''); try {
        const result = await window.studio.exportTimeline(input);
        if (!active.current)
            return;
        if (result.ok) {
            setReceipt(result.value);
            if (result.value.state === 'failed')
                setError(result.value.errorCode ?? '复制未完成');
        }
        else
            setError((['ENGINE_REQUEST_TIMEOUT','ENGINE_DISCONNECTED','EXPORT_TIMEOUT'].includes(result.error.code) ? '结果待核对：' : '')+result.error.message);
    }
    catch {
        if (active.current)
            setError('复制回执尚未确认，请仅核实或重试同一复制请求。');
    }
    finally {
        if (active.current)
            setCopying(false);
    } }
    return <Dialog title="导出固定时间线" onClose={() => { active.current = false; onClose(); }} wide><div className="form-stack"><p>{timeline.title} r{timeline.revision} · {(timelineEndTicks(timeline) / 48000).toFixed(3)}秒 · {timeline.fps.num}fps · {timeline.canvas.width}×{timeline.canvas.height}</p>
    {timelineWarnings(timeline).map(w => <p role="status" className="warning-text" key={w.code}>黑场尾部：{w.startTicks / 48000}–{w.endTicks / 48000}秒</p>)}
    <Field label="导出格式"><select disabled={copying} value={kind} onChange={e => { setKind(e.target.value as ExportKind); request.current = null; setReceipt(null); setError(''); }}><option value="mp4">MP4 成片</option><option value="wav">WAV 混音</option><option value="srt">SRT 字幕</option><option value="csv">分镜对白与时间线字幕 CSV</option><option value="sources">固定原件 ZIP</option></select></Field>
    <RenderBudgetField value={intermediateBudget} onChange={setIntermediateBudget}/>
    {kind === 'mp4' && <label className="check"><input type="checkbox" checked={burnSubtitles} onChange={e => setBurnSubtitles(e.target.checked)}/>烧录此修订的字幕</label>}
    <p className="hint">字幕烧录选择在渲染准备时冻结；SRT 可独立导出。CSV 分别保留固定分镜对白和时间线字幕。</p>
    {['mp4', 'wav'].includes(kind) ? <><Button disabled={locked} onClick={async () => { const p = await runtime.command('render.prepare', { timelineRef: { libraryId: timeline.libraryId, projectId: timeline.projectId, id: timeline.id, revision: timeline.revision }, purpose: kind as 'mp4' | 'wav', intermediateBudgetBytes:intermediateBudget, ...(kind === 'mp4' ? { burnSubtitles } : {}), executionOwner: 'desktop-user', runId: crypto.randomUUID() }); if (p)
        setPlan(p); }}>准备 {kind.toUpperCase()} 本机渲染</Button>{(jobs.data?.jobs ?? []).filter(j => j.kind === 'render').map(j => <ExportableJob key={j.jobId} job={j} timeline={timeline} kind={kind} onCopy={copy}/>)}</> : <Button disabled={locked || copying} onClick={() => void copy({ requestId: crypto.randomUUID(), projectId: timeline.projectId, timelineId: timeline.id, revision: timeline.revision, kind })}>复制到短剧目录</Button>}
    {copying && <p role="status">正在复制到短剧目录 · 进度按实际字节更新</p>}{error && <div role="alert"><p>{error}</p><p>成片若已收存仍保留在资料库，复制失败可独立重试。</p><Button disabled={copying} onClick={() => request.current && void copy(request.current)}>仅重试复制</Button></div>}
    {receipt && <p role="status">{receipt.state === 'cancelled' ? '已取消，请新建导出' : receipt.state === 'completed' ? (cancelledRequests.current.has(receipt.requestId)?'文件已发布，取消未生效':'导出完成') : receipt.state === 'verified' ? '副本已校验，等待发布' : receipt.state} · {receipt.byteLength}字节 · {receipt.relativePath}</p>}
    {(exports.data?.exports ?? []).map(e => <div key={e.requestId}><p>{e.kind} r{e.revision} · {e.state} · {e.byteLength}字节 {e.errorCode}</p>{['prepared','copying','verified','cancelled'].includes(e.state)&&<Button disabled={locked||copying||cancelling===e.requestId} onClick={()=>{if(e.state==='cancelled')cancelledRequests.current.add(e.requestId);void copy({requestId:e.requestId,projectId:e.projectId,timelineId:e.timelineId,revision:e.revision,kind:e.kind,...(e.renderJobId?{renderJobId:e.renderJobId}:{})});}}>{e.state==='cancelled'?'核对已取消导出':'核对并继续原导出'}</Button>}{e.state === 'failed' && <Button onClick={() => void copy({ requestId: e.requestId, projectId: e.projectId, timelineId: e.timelineId, revision: e.revision, kind: e.kind, ...(e.renderJobId ? { renderJobId: e.renderJobId } : {}) })}>仅重试复制原导出</Button>}{['prepared', 'copying', 'verified'].includes(e.state) && <Button disabled={cancelling===e.requestId} onClick={async () => {cancelledRequests.current.add(e.requestId);setCancelling(e.requestId);try{const result=await window.studio.cancelTimelineExport({requestId:e.requestId});if(!result.ok)setError('取消结果待核对：'+result.error.message);await runtime.refresh();}catch{setError('取消结果待核对，请读取原导出记录。');}finally{if(active.current)setCancelling(null);}}}>{cancelling===e.requestId?'取消中…':'取消复制'}</Button>}</div>)}
    {plan && <LocalPlanApproval plan={plan} onClose={() => setPlan(null)}/>}</div></Dialog>;
}
function ExportableJob({ job, timeline, kind, onCopy }: {
    job: RenderJobView;
    timeline: TimelineRevision;
    kind: ExportKind;
    onCopy(input: ExportTimelineInput): Promise<void>;
}) {
    const runtime=useRuntime(),deliveries=useWorkspaceQuery('subproject.deliverables',runtime.scope??{projectId:timeline.projectId,subprojectId:'none'},!!runtime.scope);
    const plan = useWorkspaceQuery('render.plan', { projectId: timeline.projectId, planId: job.planId },true,undefined,'fixed');
    if (plan.data?.kind !== 'render' || plan.data.timelineRef.id !== timeline.id || plan.data.timelineRef.revision !== timeline.revision || plan.data.purpose !== kind)
        return null;
    return <div><LocalJobControls job={job}/>{job.state === 'SUCCEEDED' && job.outputRef && <><p>成片已保存于资料库</p>{kind==='mp4'&&runtime.scope&&<Button disabled={runtime.busy||deliveries.data?.items.some(d=>d.jobId===job.jobId)} onClick={()=>void runtime.command('subproject.deliver',{...runtime.scope!,title:timeline.title+' r'+timeline.revision,timelineId:timeline.id,timelineRevision:timeline.revision,jobId:job.jobId})}>{deliveries.data?.items.some(d=>d.jobId===job.jobId)?'已登记制品':'登记为本集制品'}</Button>}<Button onClick={() => void onCopy({ requestId: crypto.randomUUID(), projectId: timeline.projectId, timelineId: timeline.id, revision: timeline.revision, kind, renderJobId: job.jobId })}>复制已收存的 {kind.toUpperCase()}</Button><details><summary>播放已校验输出</summary><MediaPreview media={job.outputRef} original/></details></>}</div>;
}

export function RenderBudgetField({value,onChange}:{value:number;onChange(value:number):void}){
 return <Field label="分段临时文件预算"><select value={value} onChange={e=>onChange(Number(e.target.value))}>{[2,4,8].map(n=><option key={n} value={n*1024**3}>{n} GiB{n===2?'（默认）':''}</option>)}</select><small>大时间线本机处理使用；批准前显示总磁盘占用。</small></Field>;
}
