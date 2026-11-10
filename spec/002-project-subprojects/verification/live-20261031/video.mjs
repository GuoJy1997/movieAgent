export async function run(c){
 const {data:d,execute,query,scopeOf,refs,wait,save,log,fs,path}=c,scope=scopeOf(d.a);
 if(!d.shotA)throw Error('TEXT_NOT_ACCEPTED');
 const canvases=await query('subproject.canvases',scope,scope);d.canvasA=d.a.primaryCanvasId??canvases.items[0]?.id;if(!d.canvasA)throw Error('CANVAS_MISSING');
 let canvas=await query('canvas.read',{canvasId:d.canvasA},scope);
 if(!canvas.nodes.some(n=>n.nodeId==='video-once')){
  await execute('canvas.applyCommand',{canvasId:d.canvasA,baseRevision:canvas.revision,operations:[
   {kind:'create',nodeId:'script-input',content:{type:'text',text:'【第一集已采用剧本】\n'+d.scriptA.body+'\n【镜头提示】\n'+d.shotA.prompt},layout:{x:40,y:80}},
   {kind:'create',nodeId:'character-lock',content:{type:'text',text:'【人物与连续性锁定】\n朱清，19岁清瘦少年，灰青交领右衽长袍，素色冠巾。右手一直捏半张皱邸报，站在梧桐下不走位。结尾邸报仍在右手。'+d.entities.map(x=>x.name+'：'+x.description+'；'+x.constraints).join('\n')},layout:{x:40,y:400}},
   {kind:'create',nodeId:'video-once',content:{type:'generation',profileRef:refs(d.videoProfile),prompt:'真实古装电影实拍感，9:16，4秒单镜头。午后梧桐树下，19岁清瘦少年朱清穿灰青交领右衽长袍、素色冠巾，右手捏半张皱邸报。他原地轻轻抬眼望向旧朱红宫墙上方殿檐，极缓推近，只有微风吹动衣袖。面容服装和邸报全程一致，结尾邸报仍在右手。自然斜阳，低饱和，真实布料质感。只有蝉鸣和树叶声，无对白、无配乐、无字幕、无文字、无水印。',inputs:[]},layout:{x:520,y:180}}
  ]},scope);
  canvas=await query('canvas.read',{canvasId:d.canvasA},scope);const get=id=>canvas.nodes.find(n=>n.nodeId===id);
  await execute('canvas.applyCommand',{canvasId:d.canvasA,baseRevision:canvas.revision,operations:['script-input','character-lock'].map((id,i)=>({kind:'addEdge',edge:{id:'prompt-edge-'+i,sourceNodeId:id,sourceIncarnation:get(id).incarnation,targetNodeId:'video-once',targetIncarnation:get('video-once').incarnation,sourcePort:'output',targetPort:'prompt'}}))},scope);
 }
 if(!d.videoPrepared){d.videoPrepared=await execute('generation.prepare',{projectId:d.projectId,canvasNode:{canvasId:d.canvasA,nodeId:'video-once'},executionOwner:'live-user',runId:d.runId+'-video'},scope);if(d.videoPrepared.config.parameters.duration!==4)throw Error('VIDEO_DURATION_NOT_MINIMUM');await save();log('VIDEO_PREPARED',{seconds:4,estimateMicros:d.videoPrepared.estimateMicros,currency:d.videoPrepared.currency})}
 if(!d.videoTask){
  if(d.videoSubmissionStarted)throw Error('VIDEO_SUBMISSION_ALREADY_STARTED_RECONCILE_RECEIPT');
  await fs.writeFile(path.join(c.evidence,'video-once-marker.json'),JSON.stringify({preparedId:d.videoPrepared.preparedId,commandId:d.runId+'-video-approve',seconds:4,requestedCount:1}),{flag:'wx'});d.videoSubmissionStarted=true;await save();
  d.videoTask=await execute('generation.approveAndEnqueue',{preparedId:d.videoPrepared.preparedId,approvedPlanHash:d.videoPrepared.planHash,currency:'CNY',allowanceMicros:1600000,budgetLimitMicros:5000000,acknowledgeUnknown:false,executionOwner:'live-user',runId:d.runId+'-video'},scope,d.runId+'-video-approve');await save();
 }
 const t=await wait('VIDEO_GENERATING',()=>query('task.read',{taskId:d.videoTask.taskId},scope),x=>['SUCCEEDED','FAILED','CANCELLED','SUBMISSION_UNKNOWN','RECONCILE_REQUIRED'].includes(x.state)||x.collectionState==='retryable_failure',600000);
 d.videoOutcome={taskId:t.taskId,state:t.state,providerState:t.providerState,collectionState:t.collectionState,errorCode:t.errorCode,artifactRef:t.artifactRef,reportedActualMicros:t.reportedActualMicros,currency:t.currency,settlementStatus:t.settlementStatus};await save();if(t.state!=='SUCCEEDED'||!t.artifactRef)throw Error('VIDEO_'+t.state+'_'+(t.errorCode??'NOT_DURABLE'));
 d.videoRef=t.artifactRef;
 const creation=await query('creation.read',{projectId:d.projectId},scope);const selection=creation.selections.find(x=>x.shotId===d.shotA.id);
 if(!selection?.video)await execute('creation.selectOutput',{projectId:d.projectId,shotId:d.shotA.id,expectedRevision:d.shotA.revision,expectedSelectionRevision:selection?.selectionRevision??0,role:'video',reference:d.videoRef},scope);
 d.steps.push({step:'real-video-once',passed:true,taskId:t.taskId,requestedSeconds:4});await save();log('VIDEO_DURABLE',{taskId:t.taskId,artifactRef:t.artifactRef});
}
