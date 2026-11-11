import { expect, it } from 'vitest';
import { audioFixture, audioExecute, audioValue } from '../fixtures/audio-generation.ts';

async function setup() {
  const s = await audioFixture();
  for (const id of ['a', 'b']) audioValue(await audioExecute(s.engine, 'creation.saveEntity', { projectId:s.projectId,id,expectedRevision:0,kind:'character',name:id,description:'',constraints:'',references:[] }));
  const profile = s.engine.modelConfig.listProfiles().profiles.find(p=>p.id===s.profileRef.id)!;
  const modelRef = profile.modelRef;
  const connectionRef = s.engine.modelConfig.listModels().models.find(m=>m.id===modelRef.id)!.connectionRef;
  return { ...s, binding:{profileRef:s.profileRef,modelRef,connectionRef,providerVoiceId:'Chinese (Mandarin)_Reliable_Executive',voiceOrigin:'system'} };
}
it('saves a provider voice without an uploaded sample and keeps technical and quality states distinct',async()=>{
  const s=await setup();
  const saved=audioValue(await audioExecute(s.engine,'voice.save',{projectId:s.projectId,id:'provider-voice',expectedRevision:0,draft:{entityRef:{id:'a',revision:1},name:'A',dialect:'山东',performanceNotes:'沉稳',reference:null,sourceKind:'provider-voice',ttsBinding:s.binding}}));
  expect(saved.reference).toBeNull();
  expect(saved.ttsBinding.providerVoiceId).toBe(s.binding.providerVoiceId);
  expect(saved.production.ready).toBe(false);
  expect(audioValue(s.engine.voices.list({projectId:s.projectId})).voices).toHaveLength(1);
});
it('pins a default to an exact revision, guards CAS, and retains all voice history',async()=>{
  const s=await setup(); const draft={entityRef:{id:'a',revision:1},name:'A',dialect:'',performanceNotes:'',reference:null,ttsBinding:s.binding};
  audioValue(await audioExecute(s.engine,'voice.save',{projectId:s.projectId,id:'voice-a',expectedRevision:0,draft}));
  const first=await audioExecute(s.engine,'voice.bindDefault',{projectId:s.projectId,characterId:'a',voiceRef:{id:'voice-a',revision:1},expectedRevision:0});
  expect(first).toMatchObject({ok:true});
  audioValue(await audioExecute(s.engine,'voice.save',{projectId:s.projectId,id:'voice-a',expectedRevision:1,draft:{...draft,name:'A updated'}}));
  expect(audioValue(s.engine.voices.list({projectId:s.projectId})).defaultBindings[0].voiceRef).toEqual({id:'voice-a',revision:1});
  expect(await audioExecute(s.engine,'voice.bindDefault',{projectId:s.projectId,characterId:'a',voiceRef:{id:'voice-a',revision:2},expectedRevision:0})).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});
  expect(audioValue(s.engine.voices.history({projectId:s.projectId,entityId:'a'})).voices.map((v:any)=>v.revision)).toEqual([1,2]);
});
it('rejects a default voice belonging to another character without writing a binding',async()=>{
  const s=await setup(); audioValue(await audioExecute(s.engine,'voice.save',{projectId:s.projectId,id:'voice-a',expectedRevision:0,draft:{entityRef:{id:'a',revision:1},name:'A',dialect:'',performanceNotes:'',reference:null,ttsBinding:s.binding}}));
  expect(await audioExecute(s.engine,'voice.bindDefault',{projectId:s.projectId,characterId:'b',voiceRef:{id:'voice-a',revision:1},expectedRevision:0})).toMatchObject({ok:false});
  expect(audioValue(s.engine.voices.list({projectId:s.projectId})).defaultBindings).toEqual([]);
});

it('replaces only explicitly selected current dialogues with CAS and keeps previous dialogue revisions',async()=>{
 const s=await setup(),projectId=s.projectId,draft={entityRef:{id:'a',revision:1},name:'A',dialect:'',performanceNotes:'',reference:null,ttsBinding:s.binding};
 for(const id of ['voice-old','voice-new'])audioValue(await audioExecute(s.engine,'voice.save',{projectId,id,expectedRevision:0,draft}));
 audioValue(await audioExecute(s.engine,'creation.saveScript',{projectId,id:'script',expectedRevision:0,title:'S',synopsis:'',body:'',scenes:[{id:'scene',title:'S',location:'',time:'',description:''}]}));
 for(const id of ['s1','s2']){audioValue(await audioExecute(s.engine,'creation.saveShot',{projectId,id,expectedRevision:0,scriptId:'script',sceneId:'scene',order:id==='s1'?0:1,title:id,durationSeconds:5,shotSize:'wide',cameraMovement:'',subject:'',action:'',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'',entityRefs:[]}));audioValue(await audioExecute(s.engine,'dialogue.save',{projectId,id:'d'+id,expectedRevision:0,draft:{shotRef:{id,revision:1},turns:[{turnId:'t',characterRef:{id:'a',revision:1},voiceRef:{id:'voice-old',revision:1},text:'hello',emotion:'calm',startTicks:0,durationTicks:48000,mode:'voiceover'}]}}));}
 const input={projectId,characterId:'a',voiceRef:{id:'voice-new',revision:1},dialogueRefs:[{id:'ds1',revision:1}]};
 const changed=audioValue(await audioExecute(s.engine,'voice.replaceDialogues',input));expect(changed.dialogues).toHaveLength(1);
 expect(audioValue(s.engine.voices.readDialogue({projectId,shotId:'s1'})).current.turns[0].voiceRef.id).toBe('voice-new');expect(audioValue(s.engine.voices.readDialogue({projectId,shotId:'s2'})).current.turns[0].voiceRef.id).toBe('voice-old');
 expect(audioValue(s.engine.voices.readDialogue({projectId,shotId:'s1',revision:1})).current.turns[0].voiceRef.id).toBe('voice-old');
 expect(await audioExecute(s.engine,'voice.replaceDialogues',{...input,dialogueRefs:[{id:'ds2',revision:1},{id:'ds1',revision:1}]})).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});
 expect(audioValue(s.engine.voices.readDialogue({projectId,shotId:'s2'})).current.revision).toBe(1);expect(s.requests).toHaveLength(0);
});
