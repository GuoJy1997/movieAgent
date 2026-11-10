export async function run(c){
 const{data:d,execute,query,scopeOf,save,log,fs,path}=c,r=d.liveLong,scope=scopeOf(d.b);
 const memory=await query('project.memory',{projectId:d.projectId}),summary=memory.entries.find(x=>x.kind==='summary'&&x.subprojectId===d.a.id&&x.status==='active');
 if(!summary||memory.completions.find(x=>x.id===d.completion.id)?.state!=='ready')throw Error('NO_REAL_ACTIVE_SUMMARY');
 if(!['朱清','邸报'].every(x=>summary.body.includes(x)))throw Error('SUMMARY_LOST_CHARACTER_OR_PROP');
 await execute('subproject.continuity',{...scope,sourceSubprojectIds:[d.a.id]},scope);
 r.continuitySession??=await execute('agent.createSession',{projectId:d.projectId,title:'第二集真实记忆补验',mode:'all',executionOwner:'live-user'},scope);await save();
 r.nextTurn??=await execute('agent.prepareTurn',{sessionId:r.continuitySession.sessionId,message:'继续第二集《邸报》。严格根据第一集已采用摘要接续：朱清仍在原处，灰青长袍、素色冠巾，右手仍捏着半张皱邸报；不新增人物。只生成1个场景、1个4秒镜头，总时长4秒，9:16、无对白、无配乐、无字幕。镜头为朱清低头看向右手的皱邸报，不走位、不松手。正文80字以内，镜头prompt150字以内，其余字段简短。仅按系统JSON结构返回完整可采用提案。',profileRef:r.testProfileRef,templateId:'short-film',targets:{shotIds:[],entityIds:[]},outputTokens:8192},scope);await save();
 if(!r.nextTurn.context.sources.some(x=>x.kind==='memory'&&x.id===summary.id&&x.revision===summary.revision)||!r.nextTurn.generation.prompt.includes(summary.body))throw Error('NEXT_EPISODE_MISSING_FIXED_MEMORY');
 r.proof={summaryId:summary.id,summaryRevision:summary.revision,summaryBody:summary.body,sources:summary.sources,nextRunId:r.nextTurn.runId,nextTurnSubmitted:false,fixedMemoryIncluded:true};
 await fs.writeFile(path.join(c.evidence,'long-request/continuity-proof.json'),JSON.stringify(r.proof,null,2));
 await c.page.getByLabel('当前子项目').selectOption(d.b.id);await c.sleep(1000);await c.page.screenshot({path:path.join(c.evidence,'long-request/next-episode.png'),fullPage:true});
 log('NEXT_EPISODE_REAL_MEMORY_INCLUDED',r.proof);
}
