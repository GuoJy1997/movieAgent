import {expect,it} from 'vitest';
import {audioFixture,audioExecute,audioValue,fixtureWav} from '../fixtures/audio-generation.ts';
import {encodeSpeechRequest} from '../../packages/providers/src/audio-protocol.ts';
it.each(['minimax-speech-v1','openai-speech-v1'])('preserves provider voice IDs and dialogue text for %s',adapter=>{
  const result=encodeSpeechRequest(adapter,'manual-audio','我在这儿。',{voice:'Chinese (Mandarin)_Reliable_Executive'});
  expect(result.ok).toBe(true);if(!result.ok)return;
  const body=JSON.parse(result.value.toString());
  expect(adapter==='minimax-speech-v1'?body.voice_setting.voice_id:body.voice).toBe('Chinese (Mandarin)_Reliable_Executive');
  expect(adapter==='minimax-speech-v1'?body.text:body.input).toBe('我在这儿。');
});
it('uses the fixed role voice in a real TTS request for dialogue requiring later lip sync',async()=>{
  const s=await audioFixture('openai-speech-v1',{native:true});s.response(fixtureWav(1));
  const profile=s.engine.modelConfig.listProfiles().profiles.find(p=>p.id===s.profileRef.id)!;
  const model=s.engine.modelConfig.listModels().models.find(m=>m.id===profile.modelRef.id)!;
  audioValue(await audioExecute(s.engine,'creation.saveEntity',{projectId:s.projectId,id:'a',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));
  audioValue(await audioExecute(s.engine,'voice.save',{projectId:s.projectId,id:'voice-a',expectedRevision:0,draft:{entityRef:{id:'a',revision:1},name:'A',dialect:'山东话',performanceNotes:'沉稳',reference:null,ttsProfileRef:s.profileRef,ttsBinding:{profileRef:s.profileRef,modelRef:profile.modelRef,connectionRef:model.connectionRef,providerVoiceId:'role-A',voiceOrigin:'custom'}}}));
  audioValue(await audioExecute(s.engine,'creation.saveScript',{projectId:s.projectId,id:'script',expectedRevision:0,title:'Story',synopsis:'',body:'',scenes:[{id:'scene',title:'S',location:'',time:'',description:''}]}));
  audioValue(await audioExecute(s.engine,'creation.saveShot',{projectId:s.projectId,id:'shot',expectedRevision:0,scriptId:'script',sceneId:'scene',order:0,title:'S',durationSeconds:5,shotSize:'wide',cameraMovement:'',subject:'',action:'',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'',entityRefs:[]}));
  const dialogue=audioValue(await audioExecute(s.engine,'dialogue.save',{projectId:s.projectId,expectedRevision:0,draft:{shotRef:{id:'shot',revision:1},turns:[{turnId:'turn-a',characterRef:{id:'a',revision:1},voiceRef:{id:'voice-a',revision:1},text:'我在这儿。',emotion:'calm',startTicks:0,durationTicks:240000,mode:'dubbed-lipsync'}]}}));
  audioValue(await audioExecute(s.engine,'audio.saveVoiceLine',{projectId:s.projectId,id:'line-a',expectedRevision:0,text:'我在这儿。',shotRef:{libraryId:s.engine.identity.libraryId,id:'shot',revision:1},entityRef:{libraryId:s.engine.identity.libraryId,id:'a',revision:1},dialogueSource:{dialogueRef:{id:dialogue.id,revision:1},turnId:'turn-a',voiceRef:{id:'voice-a',revision:1}}}));
  const plan=audioValue(await audioExecute(s.engine,'audio.prepareSpeech',{projectId:s.projectId,lines:[{lineId:'line-a',revision:1,profileRef:s.profileRef}],executionOwner:'human',runId:'role-a'}));
  expect(plan.items[0].prepared.config.parameters.voice).toBe('role-A');
  expect(plan.items[0].prepared.voiceIdentity).toMatchObject({voiceRef:{id:'voice-a',revision:1},providerVoiceId:'role-A',unmappedFields:['dialect','performanceNotes']});
  const approved=audioValue(await audioExecute(s.engine,'audio.approveSpeech',{planId:plan.planId,planHash:plan.planHash,executionOwner:'human',runId:'role-a',approval:s.approval}));
  const done=audioValue(await s.engine.scheduler.run(approved.tasks[0].attemptId));
  expect(done.state).toBe('SUCCEEDED');
  expect(JSON.parse(s.requests[0]!.body.toString())).toEqual({model:'manual-audio',input:'我在这儿。',voice:'role-A'});
  expect(s.engine.modelConfig.listModels().models.find(m=>m.id===model.id)).toEqual(model);
},120000);

import {nativeFixture,value,execute} from '../fixtures/native-generation.ts';
it('compiles voice instructions into the real video prompt and permits an explicitly pinned older voice',async()=>{
  const s=await nativeFixture('minimax-h3-v2');const projectId=s.prepareInput().projectId;
  const profileRef=value(await execute(s.engine,'profile.save',{id:'native',expectedRevision:1,name:'H3',modelRef:s.prepareInput().profileRef,parameters:{ratio:'16:9'}}));
  const audio=await s.importFile(fixtureWav(2),'voice.wav');const probe=value(await s.engine.mediaInfo.ensure(audio));
  value(await execute(s.engine,'creation.saveEntity',{projectId,id:'a',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));
  const draft={entityRef:{id:'a',revision:1},name:'A',dialect:'山东话',performanceNotes:'低沉而克制',reference:{ref:audio,hash:probe.objectHash,probeId:probe.probeId,sourceInTicks:0,durationTicks:96000}};
  value(await execute(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft}));
  value(await execute(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:1,draft:{...draft,dialect:'普通话'}}));
  const prepared=await execute(s.engine,'generation.prepare',{projectId,profileRef,prompt:'A说：我在这儿。',inputVersion:'v1',executionOwner:'human',runId:'old-voice',referenceAudio:[{characterRef:{id:'a',revision:1},voiceRef:{id:'voice',revision:1},ref:audio}]});
  expect(prepared).toMatchObject({ok:true});const frozen=value(prepared);
  expect(frozen.prompt).toContain('山东话');expect(frozen.prompt).toContain('低沉而克制');
  expect(frozen.referenceAudio[0].voiceRef).toEqual({id:'voice',revision:1});
},120000);
