import {expect,it} from 'vitest';
import {audioFixture,audioValue as value,audioExecute as execute,fixtureWav} from '../fixtures/audio-generation.ts';
it('keeps two exact speakers across three dialogue shots and six actual serialized TTS requests',async()=>{
 const s=await audioFixture('openai-speech-v1',{native:true}),projectId=s.projectId,libraryId=s.engine.identity.libraryId;
 const model=s.engine.modelConfig.listModels().models[0]!,modelRef={libraryId,id:model.id,revision:model.revision};
 value(await execute(s.engine,'creation.saveScript',{projectId,id:'script',expectedRevision:0,title:'S',synopsis:'',body:'',scenes:[{id:'scene',title:'S',location:'',time:'',description:''}]}));
 for(const id of ['a','b']){value(await execute(s.engine,'creation.saveEntity',{projectId,id,expectedRevision:0,kind:'character',name:id,description:'',constraints:'',references:[]}));value(await execute(s.engine,'voice.save',{projectId,id:'voice-'+id,expectedRevision:0,draft:{entityRef:{id,revision:1},name:id,dialect:'山东话',performanceNotes:'不读成另一角色',reference:null,sourceKind:'provider-voice',ttsBinding:{profileRef:s.profileRef,modelRef,connectionRef:model.connectionRef,providerVoiceId:'Speaker ('+id+')',voiceOrigin:'custom'}}}));}
 const lines=[];for(let i=0;i<3;i++){
 const id='shot-'+i;value(await execute(s.engine,'creation.saveShot',{projectId,id,expectedRevision:0,scriptId:'script',sceneId:'scene',order:i,title:id,durationSeconds:5,shotSize:'wide',cameraMovement:'',subject:'',action:'',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'',entityRefs:[]}));
 const turns=['a','b'].map((role,n)=>({turnId:role,characterRef:{id:role,revision:1},voiceRef:{id:'voice-'+role,revision:1},text:role+' 的第 '+i+' 句。',emotion:'calm',startTicks:n*96000,durationTicks:96000,mode:'dubbed-lipsync'}));
 const dialogue=value(await execute(s.engine,'dialogue.save',{projectId,id:'dialogue-'+i,expectedRevision:0,draft:{shotRef:{id,revision:1},turns}}));
 for(const turn of turns){const lineId=id+'-'+turn.turnId;value(await execute(s.engine,'audio.saveVoiceLine',{projectId,id:lineId,expectedRevision:0,text:turn.text,shotRef:{libraryId,id,revision:1},entityRef:{libraryId,...turn.characterRef},dialogueSource:{dialogueRef:{id:dialogue.id,revision:1},turnId:turn.turnId,voiceRef:turn.voiceRef}}));lines.push({lineId,revision:1,profileRef:s.profileRef});}}
 const plan=value(await execute(s.engine,'audio.prepareSpeech',{projectId,lines,exception:{reason:'仅本地工程夹具，不代表听感通过'},executionOwner:'human',runId:'multi-role'}));
 const expected=Array.from({length:3},()=>['Speaker (a)','Speaker (b)']).flat();expect(plan.items.map((i:any)=>i.prepared.config.parameters.voice)).toEqual(expected);
 s.response(fixtureWav(1));const batch=value(await execute(s.engine,'audio.approveSpeech',{planId:plan.planId,planHash:plan.planHash,executionOwner:'human',runId:plan.runId,approval:s.approval}));for(const task of batch.tasks)expect(value(await s.engine.scheduler.run(task.attemptId)).state).toBe('SUCCEEDED');
 expect(s.requests.map(r=>JSON.parse(r.body.toString()).voice)).toEqual(expected);expect(s.requests.map(r=>JSON.parse(r.body.toString()).input)).toEqual(plan.items.map((i:any)=>i.prepared.prompt));expect(s.engine.modelConfig.listModels().models[0]).toEqual(model);
},120000);
