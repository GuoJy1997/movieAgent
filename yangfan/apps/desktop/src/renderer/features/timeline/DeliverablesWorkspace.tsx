import type {WorkScope} from '../../../../../../packages/contracts/src/subprojects.ts';
import {Button,Empty,QueryState} from '../../../../../../packages/ui/src/controls.tsx';
import {useWorkspaceQuery} from '../../services/runtime.tsx';
import {MediaPreview} from '../assets/MediaPreview.tsx';
export function DeliverablesWorkspace({scope,onTimeline}:{scope:WorkScope;onTimeline(id?:string):void}){
 const q=useWorkspaceQuery('subproject.deliverables',scope);
 return <section className="page deliverables-page"><header className="page-head"><div><p className="eyebrow">DELIVERABLES</p><h1>已登记制品</h1><p>每一份成片都保留来源时间线与固定修订。</p></div><Button onClick={()=>onTimeline()}>打开剪辑</Button></header><QueryState loading={q.isLoading} error={q.error}/>
 {q.data?.items.length?<div className="deliverables-grid">{q.data.items.map(d=><article key={d.id}><div className="deliverable-preview"><MediaPreview media={d.media} original/></div><h2>{d.title}</h2><p>时间线 r{d.timelineRevision} · {new Date(d.createdAt).toLocaleDateString('zh-CN')}</p><Button tone="quiet" onClick={()=>onTimeline(d.timelineId)}>打开来源时间线</Button><details><summary>制品来源</summary><p>登记时固定的时间线修订：r{d.timelineRevision}。打开来源将进入该时间线的当前修订。</p><p>任务 {d.jobId}</p><p className="source-hash">媒体指纹 {d.sourceHash}</p></details></article>)}</div>:q.data&&<Empty title="暂无已登记制品">在剪辑页完成正式 MP4 渲染，再从导出窗口登记制品。<Button onClick={()=>onTimeline()}>开始剪辑</Button></Empty>}
 </section>;
}