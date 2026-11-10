export async function run(c){
 const {data:d,execute,query,scopeOf,wait,save,log}=c,scope=scopeOf(d.a);if(!d.videoRef)throw Error('VIDEO_NOT_DURABLE');
 const creation=await query('creation.read',{projectId:d.projectId},scope),sel=creation.selections.find(x=>x.shotId===d.shotA.id);
 if(!d.timeline){
  const plan=await execute('timeline.prepareAssembly',{projectId:d.projectId,scriptRef:{id:d.scriptA.id,revision:d.scriptA.revision},shots:[{id:d.shotA.id,revision:d.shotA.revision,selectionRevision:sel.selectionRevision}],target:{id:'episode1-cut',expectedRevision:0},allowImages:false,settings:{fps:{num:30,den:1},canvas:{width:1080,height:1920}},executionOwner:'live-user',runId:d.runId+'-cut'},scope);
  d.timeline=await execute('timeline.applyAssembly',{planId:plan.planId,planHash:plan.planHash,executionOwner:'live-user',runId:d.runId+'-cut'},scope);await save();log('TIMELINE_ASSEMBLED',{id:d.timeline.id,revision:d.timeline.revision,clips:d.timeline.videoClips.length,durationSeconds:d.timeline.videoClips.reduce((n,x)=>Math.max(n,x.startTicks+x.durationTicks),0)/48000});
 }
 if(!d.renderPlan){d.renderPlan=await execute('render.prepare',{timelineRef:{libraryId:d.libraryId,projectId:d.projectId,id:d.timeline.id,revision:d.timeline.revision},purpose:'mp4',burnSubtitles:false,executionOwner:'live-user',runId:d.runId+'-render'},scope);await save()}
 if(!d.renderJob){d.renderJob=await execute('render.enqueue',{planId:d.renderPlan.planId,planHash:d.renderPlan.planHash,executionOwner:'live-user',runId:d.runId+'-render',diskBudgetBytes:d.renderPlan.requiredFreeBytes},scope);await save()}
 const job=await wait('LOCAL_RENDER',()=>query('render.read',{projectId:d.projectId,jobId:d.renderJob.jobId},scope),x=>['SUCCEEDED','FAILED','CANCELLED'].includes(x.state),120000);if(job.state!=='SUCCEEDED')throw Error('RENDER_'+job.state+'_'+(job.errorCode??'FAILED'));
 d.deliverable=await execute('subproject.deliver',{...scope,title:'第一集 · 邸报 · 最短视频验收',timelineId:d.timeline.id,timelineRevision:d.timeline.revision,jobId:d.renderJob.jobId},scope);await save();
 if(!d.exportReceipt){const r=await c.page.evaluate(async input=>window.studio.exportTimeline(input),{requestId:c.randomUUID(),projectId:d.projectId,timelineId:d.timeline.id,revision:d.timeline.revision,kind:'mp4',renderJobId:d.renderJob.jobId});d.exportReceipt=c.take(r);await save();if(d.exportReceipt.state!=='completed')throw Error('EXPORT_'+d.exportReceipt.state);}
 d.steps.push({step:'timeline-render-export-deliver',passed:true,timelineId:d.timeline.id,jobId:job.jobId});await save();log('DELIVERED',{timeline:d.timeline.id,export:d.exportReceipt.relativePath,sourceHash:d.deliverable.sourceHash});
}
