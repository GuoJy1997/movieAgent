import {expect,it,vi} from 'vitest';
import {audioFixture,audioValue as value,audioExecute as execute,fixtureWav} from '../fixtures/audio-generation.ts';
async function setup() {
  const s = await audioFixture('openai-speech-v1', { native: true });
  const projectId = s.projectId, libraryId = s.engine.identity.libraryId;
  const wav = fixtureWav(2); for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(Math.round(Math.sin(i / 2 * Math.PI * 440 / 24000) * 8000), i);
  const media = await s.importAudio(wav), probe = value(await s.engine.mediaInfo.ensure(media));
  value(await execute(s.engine, 'creation.saveEntity', { projectId, id: 'role', expectedRevision: 0, kind: 'character', name: '旁白角色', description: '', constraints: '', references: [] }));
  value(await execute(s.engine, 'voice.save', { projectId, id: 'voice', expectedRevision: 0, draft: { entityRef: { id: 'role', revision: 1 }, name: '旁白', dialect: 'fixture', performanceNotes: '', reference: { ref: media, hash: probe.objectHash, probeId: probe.probeId, sourceInTicks: 0, durationTicks: 96000 }, ttsProfileRef: s.profileRef } }));
  value(await execute(s.engine, 'creation.saveScript', { projectId, id: 'script', expectedRevision: 0, title: '旁白', synopsis: '', body: '', scenes: [{ id: 'scene', title: 'Scene', location: '', time: '', description: '' }] }));
  value(await execute(s.engine, 'creation.saveShot', { projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0, title: 'Shot', durationSeconds: 5, shotSize: 'wide', cameraMovement: '', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
  const draft = { shotRef: { id: 'shot', revision: 1 }, turns: [{ turnId: 'turn', characterRef: { id: 'role', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, text: '独立旁白测试', emotion: 'calm', startTicks: 48000, durationTicks: 96000, mode: 'voiceover' }] };
  value(await execute(s.engine, 'dialogue.save', { projectId, id: 'dialogue', expectedRevision: 0, draft }));
  const line = { projectId, id: 'line', expectedRevision: 0, text: draft.turns[0]!.text, shotRef: { libraryId, ...draft.shotRef }, entityRef: { libraryId, ...draft.turns[0]!.characterRef }, dialogueSource: { dialogueRef: { id: 'dialogue', revision: 1 }, turnId: 'turn', voiceRef: { id: 'voice', revision: 1 } } };
  const query = (kind: string, payload: unknown) => s.engine.commands.query({ schemaVersion: 1, libraryId, connectionEpoch: 'fixture', queryId: crypto.randomUUID(), kind, payload });
  return { ...s, wav, draft, line, query };
}


it('assembles all reviewed turns, persists provenance and prevents a single take from confirming multiple turns',async()=>{
 const s=await setup(),projectId=s.projectId;const draft={...s.draft,turns:[{...s.draft.turns[0]!,text:'第一句',startTicks:0,durationTicks:96000},{...s.draft.turns[0]!,turnId:'turn2',text:'第二句',startTicks:144000,durationTicks:96000}]};
 value(await execute(s.engine,'dialogue.save',{projectId,id:'dialogue',expectedRevision:1,draft}));
 const selections:{turnId:string;takeId:string}[]=[];
 for(const [index,turn] of draft.turns.entries()){
  const line={...s.line,id:'line'+index,text:turn.text,dialogueSource:{dialogueRef:{id:'dialogue',revision:2},turnId:turn.turnId,voiceRef:turn.voiceRef}};value(await execute(s.engine,'audio.saveVoiceLine',line));
  const plan=value(await execute(s.engine,'audio.prepareSpeech',{projectId,lines:[{lineId:line.id,revision:1,profileRef:s.profileRef}],executionOwner:'human',runId:'a'+index}));s.response(s.wav);
  const batch=value(await execute(s.engine,'audio.approveSpeech',{planId:plan.planId,planHash:plan.planHash,executionOwner:'human',runId:plan.runId,approval:s.approval}));value(await s.engine.scheduler.run(batch.tasks[0].attemptId));
  const take=value(s.engine.audio.read({projectId})).takes.find((t:any)=>t.lineId===line.id)!;const context=value(s.query('audio.voiceoverContext',{projectId,takeId:take.id}));
  value(await execute(s.engine,'audio.reviewVoiceover',{projectId,takeId:take.id,contextHash:context.contextHash,checks:{timbre:'pass',accent:'pass',dialogue:'pass'},notes:'engineering fixture'}));selections.push({turnId:turn.turnId,takeId:take.id});
 }
 const input={projectId,dialogueRef:{id:'dialogue',revision:2},selections,executionOwner:'human',runId:'assembly'};
 expect(await execute(s.engine,'dialogue.confirmAudio',{projectId,dialogueRef:input.dialogueRef,expectedRevision:2,source:{kind:'audio-take',takeId:selections[0]!.takeId}})).toMatchObject({ok:false,error:{code:'DIALOGUE_ASSEMBLY_REQUIRED'}});
 expect(await execute(s.engine,'dialogue.prepareAssembly',{...input,selections:selections.slice(0,1)})).toMatchObject({ok:false});
 const plan=value(await execute(s.engine,'dialogue.prepareAssembly',input));
 const job=value(await execute(s.engine,'media.enqueueDerived',{planId:plan.planId,planHash:plan.planHash,executionOwner:'human',runId:plan.runId,diskBudgetBytes:plan.requiredFreeBytes}));
 value(s.engine.renderScheduler.start());await s.engine.renderScheduler.drain();
 const result=value(s.engine.renders.read({projectId,jobId:job.jobId}));expect(result.state).toBe('SUCCEEDED');
 const confirmed=value(await execute(s.engine,'dialogue.confirmAudio',{projectId,dialogueRef:input.dialogueRef,expectedRevision:2,source:{kind:'audio-assembly',jobId:job.jobId}}));
 expect(confirmed.source).toMatchObject({kind:'audio-assembly',assemblyRef:{id:plan.planId,revision:1},manifestHash:expect.any(String)});
 expect(value(await s.engine.mediaInfo.ensure(confirmed.source.ref)).durationTicks).toBe(240000);
 const pending=value(await execute(s.engine,'dialogue.prepareAssembly',{...input,runId:'later-assembly'}));
 const ensure=s.engine.mediaInfo.ensure.bind(s.engine.mediaInfo);let revoke=true;
 const spy=vi.spyOn(s.engine.mediaInfo,'ensure').mockImplementation(async ref=>{const result=await ensure(ref);if(revoke&&JSON.stringify(ref)===JSON.stringify(confirmed.source.ref)){revoke=false;const context=value(s.query('audio.voiceoverContext',{projectId,takeId:selections[0]!.takeId}));value(await execute(s.engine,'audio.reviewVoiceover',{projectId,takeId:selections[0]!.takeId,contextHash:context.contextHash,checks:{timbre:'needs-fix',accent:'pass',dialogue:'pass'},notes:'changed during confirmation'}));}return result;});
 try{expect(await execute(s.engine,'dialogue.confirmAudio',{projectId,dialogueRef:input.dialogueRef,expectedRevision:2,source:{kind:'audio-assembly',jobId:job.jobId}})).toMatchObject({ok:false,error:{code:'VOICEOVER_REVIEW_REQUIRED'}});}finally{spy.mockRestore();}
 expect(await execute(s.engine,'media.enqueueDerived',{planId:pending.planId,planHash:pending.planHash,executionOwner:'human',runId:pending.runId,diskBudgetBytes:pending.requiredFreeBytes})).toMatchObject({ok:false,error:{code:'VOICEOVER_REVIEW_REQUIRED'}});
 value(await s.engine.close());s.engine=await s.open();expect(value(s.engine.renders.read({projectId,jobId:job.jobId})).state).toBe('SUCCEEDED');
},120000);

it('rechecks a single reviewed take inside confirmation commit and before later alignment',async()=>{
 const s=await setup(),projectId=s.projectId;value(await execute(s.engine,'audio.saveVoiceLine',s.line));
 const plan=value(await execute(s.engine,'audio.prepareSpeech',{projectId,lines:[{lineId:s.line.id,revision:1,profileRef:s.profileRef}],executionOwner:'human',runId:'single'}));s.response(s.wav);
 const batch=value(await execute(s.engine,'audio.approveSpeech',{planId:plan.planId,planHash:plan.planHash,executionOwner:'human',runId:plan.runId,approval:s.approval}));value(await s.engine.scheduler.run(batch.tasks[0].attemptId));
 const take=value(s.engine.audio.read({projectId})).takes[0],context=value(s.query('audio.voiceoverContext',{projectId,takeId:take.id}));
 value(await execute(s.engine,'audio.reviewVoiceover',{projectId,takeId:take.id,contextHash:context.contextHash,checks:{timbre:'pass',accent:'pass',dialogue:'pass'},notes:'pass'}));
 const input={projectId,dialogueRef:{id:'dialogue',revision:1},expectedRevision:1,source:{kind:'audio-take',takeId:take.id}};
 const confirmed=value(await execute(s.engine,'dialogue.confirmAudio',input));expect(confirmed.source).toMatchObject({takeId:take.id,singleSourceHash:expect.any(String)});
 const ensure=s.engine.mediaInfo.ensure.bind(s.engine.mediaInfo);let count=0;
 const spy=vi.spyOn(s.engine.mediaInfo,'ensure').mockImplementation(async ref=>{const result=await ensure(ref);if(++count===2)value(await execute(s.engine,'audio.reviewVoiceover',{projectId,takeId:take.id,contextHash:context.contextHash,checks:{timbre:'needs-fix',accent:'pass',dialogue:'pass'},notes:'changed during single confirmation'}));return result;});
 try{expect(await execute(s.engine,'dialogue.confirmAudio',input)).toMatchObject({ok:false,error:{code:'VOICEOVER_REVIEW_REQUIRED'}});}finally{spy.mockRestore();}
 expect(s.engine.dialogueProduction.checkAlignmentPlan({projectId,dialogueAlignment:{dialogueRef:input.dialogueRef,audioRef:confirmed.source.ref},manifest:{entries:[]}} as never)).toMatchObject({ok:false,error:{code:'VOICEOVER_REVIEW_REQUIRED'}});
 value(await execute(s.engine,'audio.reviewVoiceover',{projectId,takeId:take.id,contextHash:context.contextHash,checks:{timbre:'pass',accent:'pass',dialogue:'pass'},notes:'rechecked'}));
 const newer=value(await execute(s.engine,'dialogue.confirmAudio',input));
 expect(s.engine.dialogueProduction.checkAlignmentPlan({projectId,dialogueAlignment:{dialogueRef:input.dialogueRef,audioRef:newer.source.ref},manifest:{entries:[]}} as never)).toMatchObject({ok:true});
},120000);
