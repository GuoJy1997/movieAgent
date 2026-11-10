export async function run(c){
 const{data:d,execute,query,scopeOf,wait,save,log,fs,path}=c,r=d.liveLong,scope=scopeOf(d.b);
 if(!r.nextTurn||!r.proof?.fixedMemoryIncluded)throw Error('MEMORY_PROOF_FIRST');
 let run=await query('agent.run',{runId:r.nextTurn.runId},scope);
 if(run.state==='PREPARED'){
  await execute('agent.approveTurn',{runId:r.nextTurn.runId,approval:{preparedId:r.nextTurn.generation.preparedId,approvedPlanHash:r.nextTurn.generation.planHash,currency:'CNY',allowanceMicros:1000000,budgetLimitMicros:10000000,acknowledgeUnknown:true,executionOwner:'live-user',runId:r.nextTurn.runId}},scope,'live-continuity-'+r.nextTurn.runId);
  r.continuitySubmittedAt=new Date().toISOString();await save();
 }
 const started=Date.now();
 run=await wait('REAL_AGENT_CONTINUITY',()=>query('agent.run',{runId:r.nextTurn.runId},scope),x=>!['PREPARED','PLANNING'].includes(x.state),360000);
 r.continuityState=run.state;r.continuityElapsedSeconds=Math.round((Date.now()-started)/1000);await save();
 if(!['PROPOSED','ACCEPTED'].includes(run.state))throw Error('REAL_AGENT_'+run.state+'_'+(run.errorCode??'NO_PROPOSAL'));
 const draft=run.proposal.draft;await fs.writeFile(path.join(c.evidence,'long-request/episode2-proposal.json'),JSON.stringify(draft,null,2));
 const text=JSON.stringify(draft);
 if(!draft.script||draft.shots.length!==1||draft.shots[0].durationSeconds!==4||!text.includes('邸报')||!text.includes('右手'))throw Error('CONTINUITY_DRAFT_CONSTRAINTS_FAILED');
 if(run.state==='PROPOSED')r.continuityAction=await execute('agent.acceptProposal',{runId:run.runId,projectId:d.projectId,executionOwner:'live-user',proposalHash:run.proposal.proposalHash,selectedShotKeys:draft.shots.map(x=>x.key),selectedEntityKeys:draft.entities.map(x=>x.key),includeScript:true},scope);
 const creation=await query('creation.read',{projectId:d.projectId},scope);
 r.agentRealProof={runId:run.runId,accepted:true,scripts:creation.scripts.map(x=>({id:x.id,revision:x.revision,title:x.title})),shots:creation.shots.map(x=>({id:x.id,revision:x.revision,durationSeconds:x.durationSeconds,title:x.title})),fixedMemoryIncluded:true,preservedRightHandProp:true,elapsedSeconds:r.continuityElapsedSeconds,additionalVideoRequests:0};
 await fs.writeFile(path.join(c.evidence,'long-request/agent-continuity-result.json'),JSON.stringify(r.agentRealProof,null,2));await save();
 log('REAL_AGENT_CONTINUITY_ACCEPTED',r.agentRealProof);
}
