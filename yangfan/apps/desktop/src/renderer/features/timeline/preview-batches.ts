import type {TimelineRevision} from '../../../../../../packages/contracts/src/timeline.ts';
import type {MediaReference} from '../../../../../../packages/contracts/src/assets.ts';
import {MAX_DERIVED_MEDIA_REFERENCES} from '../../../../../../packages/contracts/src/timeline-limits.ts';
import type {LocalJobRef,RenderJobView} from '../../../../../../packages/contracts/src/render.ts';
export type PreviewBatchState='waiting'|'prepared'|'enqueued'|'queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';
export interface PreviewBatch {id:string;references:MediaReference[];videoFit:'contain'|'cover';state:PreviewBatchState;planId?:string;executionOwner?:string;job?:LocalJobRef}
export const previewBatchLabels:Record<PreviewBatchState,string>={waiting:'待准备',prepared:'待确认',enqueued:'已入队',queued:'排队中',running:'执行中',succeeded:'成功',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
export function resolvePreviewBatch(batch:PreviewBatch,jobs:readonly RenderJobView[]):PreviewBatchState{
 const ref=batch.job;
 const job=ref&&jobs.find(j=>j.kind==='derived'&&j.jobId===ref.jobId&&j.libraryId===ref.libraryId&&j.projectId===ref.projectId&&j.planId===batch.planId);
 if(!job)return batch.state;
 const states:Record<RenderJobView['state'],PreviewBatchState>={PREPARED:'prepared',QUEUED:'queued',RUNNING:'running',VERIFYING:'running',PUBLISHING:'running',SUCCEEDED:'succeeded',FAILED:'failed',CANCELLED:'cancelled',INTERRUPTED:'interrupted'};
 return states[job.state];
}
export function batchPreviewReferences(t:TimelineRevision,defaultFit:'timeline'|'contain'|'cover'):PreviewBatch[]{
 const groups=new Map<'contain'|'cover',Map<string,MediaReference>>();
 for(const c of [...t.videoClips,...t.audioClips]){const fit=defaultFit==='timeline'?(c.kind==='audio'?'contain':c.fit):defaultFit;let group=groups.get(fit);if(!group){group=new Map();groups.set(fit,group);}group.set(JSON.stringify(c.media),c.media);}
 const result:PreviewBatch[]=[];for(const[fit,group]of groups){const refs=[...group.values()];for(let i=0;i<refs.length;i+=MAX_DERIVED_MEDIA_REFERENCES)result.push({id:fit+'-'+i,references:refs.slice(i,i+MAX_DERIVED_MEDIA_REFERENCES),videoFit:fit,state:'waiting'});}return result;
}
