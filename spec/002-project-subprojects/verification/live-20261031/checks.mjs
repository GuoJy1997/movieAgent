export async function run(c){
 const {data:d,execute,query,scopeOf,save,log}=c,sa=scopeOf(d.a),sb=scopeOf(d.b);
 const catalog=await query('project.assets',{...sb,view:'all'},sb),found=catalog.items.find(x=>x.ref.kind==='artifact'&&x.ref.artifactId===d.videoRef.artifactId);
 if(!found||found.sourceSubprojectId!==d.a.id)throw Error('SIBLING_VIDEO_NOT_FOUND_WITH_SOURCE');
 const canvases=await query('subproject.canvases',sb,sb);d.canvasB=d.b.primaryCanvasId??canvases.items[0].id;const graph=await query('canvas.read',{canvasId:d.canvasB},sb);
 if(!graph.nodes.some(x=>x.nodeId==='episode1-shared-video'))await execute('canvas.applyCommand',{canvasId:d.canvasB,baseRevision:graph.revision,operations:[{kind:'create',nodeId:'episode1-shared-video',content:{type:'media',media:d.videoRef},layout:{x:420,y:150}},{kind:'create',nodeId:'continuity-note',content:{type:'text',text:'第一集结束时朱清右手仍持皱邸报。此视频直接引用第一集的固定原件，未复制或重新生成。自动剧情摘要待文本链路恢复后验证。'},layout:{x:40,y:150}}]},sb);
 d.sharedAssetProof={sameArtifactId:d.videoRef.artifactId,sourceSubprojectId:found.sourceSubprojectId,targetSubprojectId:d.b.id,duplicatedOriginal:false};
 if(!d.completion){const a=await query('subproject.read',sa,sa);d.completion=await execute('subproject.complete',{...sa,expectedRevision:a.revision,note:'验收成片已登记。朱清站在午后梧桐下，穿灰青长袍，右手仍持半张皱邸报。Kimi 创作请求未知，文本服务恢复后再整理自动摘要。'},sa)}
 const memory=await query('project.memory',{projectId:d.projectId});d.memoryProof={profileConfigured:!!memory.profileRef,completionState:d.completion.state,submittedMemoryTaskId:memory.completions.find(x=>x.id===d.completion.id)?.taskId??null};
 if(d.memoryProof.submittedMemoryTaskId)throw Error('UNEXPECTED_ADDITIONAL_TEXT_REQUEST');
 await c.page.getByLabel('当前子项目').selectOption(d.a.id);await c.page.getByRole('button',{name:'画布',exact:true}).click();await c.sleep(1200);await c.page.screenshot({path:c.path.join(c.evidence,'real-canvas-a.png'),fullPage:true});
 await c.page.getByLabel('当前子项目').selectOption(d.b.id);await c.sleep(1000);await c.page.screenshot({path:c.path.join(c.evidence,'real-shared-canvas-b.png'),fullPage:true});
 d.steps.push({step:'real-sibling-asset-reuse',passed:true,...d.sharedAssetProof});await save();log('CROSS_EPISODE_REUSE_VERIFIED',{source:d.a.title,target:d.b.title,memory:d.memoryProof});
}
