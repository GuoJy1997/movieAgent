export async function run(c){
 const {data:d,execute,query,scopeOf,refs,wait,save,log,fs,path}=c,scope=scopeOf(d.a);
 const message='制作一条最短4秒的无对白竖屏古装短片《邸报》。只生成1个场景、1个镜头，总时长恰好4秒。角色朱清：19岁清瘦少年，灰青交领右衽长袍、素色冠巾，右手一直捏着半张皱邸报。午后梧桐树下，他抬眼看向旧朱红宫墙上的殿檐，原地不走动，电影自然光。结尾邸报仍在右手，作为下一集连续状态。无字幕、无配乐、无旁白、无对话。剧本正文不超过120字；镜头prompt不超过300字，明确人物服装、动作、道具、机位与声音。只要1个镜头，请按系统JSON结构输出完整可采用提案。';
 if(!d.sessionA){d.sessionA=await execute('agent.createSession',{projectId:d.projectId,title:'第一集真实文本创作',mode:'all',executionOwner:'live-user'},scope);await save()}
 if(!d.agentTurn){d.agentTurn=await execute('agent.prepareTurn',{sessionId:d.sessionA.sessionId,message,profileRef:refs(d.textProfile),templateId:'short-film',targets:{shotIds:[],entityIds:[]},outputTokens:4096},scope);await save();log('TEXT_PREPARED',{runId:d.agentTurn.runId})}
 let r=await query('agent.run',{runId:d.agentTurn.runId},scope);
 if(r.state==='PREPARED'){await execute('agent.approveTurn',{runId:d.agentTurn.runId,approval:{preparedId:d.agentTurn.generation.preparedId,approvedPlanHash:d.agentTurn.generation.planHash,currency:'CNY',allowanceMicros:1000000,budgetLimitMicros:5000000,acknowledgeUnknown:true,executionOwner:'live-user',runId:d.agentTurn.runId}},scope);d.textRequestSubmitted=true;await save()}
 r=await wait('TEXT_GENERATING',()=>query('agent.run',{runId:d.agentTurn.runId},scope),x=>!['PREPARED','PLANNING'].includes(x.state),180000);
 if(!['PROPOSED','ACCEPTED'].includes(r.state))throw Error('TEXT_'+r.state+'_'+(r.errorCode??'NO_PROPOSAL'));
 if(r.state==='PROPOSED'){
  const draft=r.proposal.draft;if(!draft.script||draft.shots.length!==1||draft.shots[0].durationSeconds!==4)throw Error('TEXT_UNEXPECTED_SHOT_COUNT_OR_DURATION');
  await fs.writeFile(path.join(c.evidence,'episode1-proposal.json'),JSON.stringify(draft,null,2));
  d.actionA=await execute('agent.acceptProposal',{runId:r.runId,projectId:d.projectId,executionOwner:'live-user',proposalHash:r.proposal.proposalHash,selectedShotKeys:draft.shots.map(x=>x.key),selectedEntityKeys:draft.entities.map(x=>x.key),includeScript:true},scope);await save();
 }
 const creation=await query('creation.read',{projectId:d.projectId},scope);d.scriptA=creation.scripts[0];d.shotA=creation.shots[0];d.entities=creation.entities;
 d.steps.push({step:'real-text-agent',passed:true,runId:d.agentTurn.runId,shots:creation.shots.length});await save();
 log('TEXT_ACCEPTED',{script:d.scriptA.title,shots:creation.shots.length,durationSeconds:d.shotA.durationSeconds,entities:creation.entities.map(x=>x.name)});
}
