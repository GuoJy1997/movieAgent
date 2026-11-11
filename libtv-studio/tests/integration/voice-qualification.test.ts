import {expect,it} from 'vitest';
import {audioFixture,audioValue as v,audioExecute as exec,fixtureWav} from '../fixtures/audio-generation.ts';
it('qualifies three emotions using only audio, preserving binding and revoking a rejected sample',async()=>{
 const s=await audioFixture('openai-speech-v1',{native:true}),projectId=s.projectId,libraryId=s.engine.identity.libraryId;
 v(await exec(s.engine,'creation.saveEntity',{projectId,id:'role',expectedRevision:0,kind:'character',name:'角色',description:'',constraints:'',references:[]}));
 const model=s.engine.modelConfig.listModels().models[0]!;const draft={entityRef:{id:'role',revision:1},name:'声音',dialect:'山东话',performanceNotes:'稳重',reference:null,ttsBinding:{providerVoiceId:'Voice (A)',profileRef:s.profileRef,modelRef:{libraryId,id:model.id,revision:model.revision},connectionRef:model.connectionRef,voiceOrigin:'system'}};
 v(await exec(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft}));const voiceRef={id:'voice',revision:1};const query=()=>s.engine.commands.query({schemaVersion:1,libraryId,connectionEpoch:'fixture',queryId:crypto.randomUUID(),kind:'voice.qualification',payload:{projectId,voiceRef,profileRef:s.profileRef}});
 let last:any;for(const emotion of ['calm','excited','quiet']){
  const plan=v(await exec(s.engine,'voice.prepareAudition',{projectId,voiceRef,profileRef:s.profileRef,emotion,text:'今天咱们好好聊聊。',executionOwner:'human',runId:emotion}));expect(s.requests.length).toBe(['calm','excited','quiet'].indexOf(emotion));s.response(fixtureWav(2));
  const batch=v(await exec(s.engine,'audio.approveSpeech',{planId:plan.planId,planHash:plan.planHash,executionOwner:'human',runId:emotion,approval:s.approval}));v(await s.engine.scheduler.run(batch.tasks[0].attemptId));
  const take=v(s.engine.audio.read({projectId})).takes.find((t:any)=>t.lineId===plan.items[0].lineId);const context=v(s.engine.audio.voiceoverContext({projectId,takeId:take.id}));last={projectId,takeId:take.id,contextHash:context.contextHash,checks:{timbre:'pass',accent:'pass',dialogue:'pass'},notes:'fixture; lipsync not applicable'};v(await exec(s.engine,'audio.reviewVoiceover',last));
 }
 expect(v(query())).toMatchObject({allowed:true,missing:[]});expect(s.requests).toHaveLength(3);expect(JSON.parse(s.requests[0]!.body.toString()).voice).toBe('Voice (A)');
 v(await exec(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:1,draft:{...draft,name:'改名'}}));
 expect(v(s.engine.commands.query({schemaVersion:1,libraryId,connectionEpoch:'fixture',queryId:crypto.randomUUID(),kind:'voice.qualification',payload:{projectId,voiceRef:{id:'voice',revision:2},profileRef:s.profileRef}}))).toMatchObject({allowed:true});
 v(await exec(s.engine,'audio.reviewVoiceover',{...last,checks:{...last.checks,accent:'needs-fix'}}));expect(v(query())).toMatchObject({allowed:false,missing:['quiet']});
},120000);
