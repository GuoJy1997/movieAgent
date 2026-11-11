import {expect,it} from 'vitest';
import {audioValue as value,audioExecute as execute,fixtureWav} from '../fixtures/audio-generation.ts';
import {nativeFixture} from '../fixtures/native-generation.ts';
async function nativeSetup(){
 const s=await nativeFixture('minimax-h3-v2'),projectId=s.prepareInput().projectId;
 const profileRef=value(await execute(s.engine,'profile.save',{id:'native',expectedRevision:1,name:'H3',modelRef:s.prepareInput().profileRef,parameters:{ratio:'16:9'}}));
 value(await execute(s.engine,'creation.saveEntity',{projectId,id:'a',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));
 value(await execute(s.engine,'creation.saveScript',{projectId,id:'script',expectedRevision:0,title:'S',synopsis:'',body:'',scenes:[{id:'scene',title:'S',location:'',time:'',description:''}]}));
 value(await execute(s.engine,'creation.saveShot',{projectId,id:'shot',expectedRevision:0,scriptId:'script',sceneId:'scene',order:0,title:'S',durationSeconds:5,shotSize:'wide',cameraMovement:'',subject:'',action:'',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'',entityRefs:[]}));
 const ref=await s.importFile(fixtureWav(2),'sample.wav'),probe=value(await s.engine.mediaInfo.ensure(ref));
 const draft={entityRef:{id:'a',revision:1},name:'A',dialect:'山东话',performanceNotes:'',reference:{ref,hash:probe.objectHash,probeId:probe.probeId,sourceInTicks:0,durationTicks:96000}};
 value(await execute(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft}));
 return {...s,projectId,profileRef,draft};
}
it('prepares current role appearance with an explicitly pinned historical voice and rejects mixed voices for that role',async()=>{
 const s=await nativeSetup();
 value(await execute(s.engine,'voice.save',{projectId:s.projectId,id:'voice',expectedRevision:1,draft:{...s.draft,dialect:'普通话'}}));
 value(await execute(s.engine,'creation.saveEntity',{projectId:s.projectId,id:'a',expectedRevision:1,kind:'character',name:'A renamed',description:'',constraints:'',references:[]}));
 const turn={turnId:'a',characterRef:{id:'a',revision:2},voiceRef:{id:'voice',revision:1},text:'我在这儿',emotion:'calm',startTicks:0,durationTicks:48000,mode:'native-reference'};
 value(await execute(s.engine,'dialogue.save',{projectId:s.projectId,id:'dialogue',expectedRevision:0,draft:{shotRef:{id:'shot',revision:1},turns:[turn]}}));
 const plan=value(await execute(s.engine,'dialogue.prepareProduction',{projectId:s.projectId,dialogueRefs:[{id:'dialogue',revision:1}],profileRef:s.profileRef,purpose:'audition',auditionCase:'calm',executionOwner:'human',runId:'history'}));
 expect(plan.items[0].prepared.referenceAudio[0]).toMatchObject({characterRef:{id:'a',revision:2},voiceRef:{id:'voice',revision:1}});
 expect(plan.items[0].prepared.prompt).toContain('山东话');
 const bad=await execute(s.engine,'dialogue.save',{projectId:s.projectId,id:'mixed',expectedRevision:0,draft:{shotRef:{id:'shot',revision:1},turns:[turn,{...turn,turnId:'b',startTicks:48000,voiceRef:{id:'voice',revision:2}}]}});
 expect(bad).toMatchObject({ok:false,error:{code:'INVALID_DIALOGUE'}});expect(s.requests).toHaveLength(0);
},120000);
it('blocks a prepared native request after the voice is archived while retaining historical reads',async()=>{
 const s=await nativeSetup();
 const prepared=value(await execute(s.engine,'generation.prepare',{projectId:s.projectId,profileRef:s.profileRef,prompt:'A',inputVersion:'v',executionOwner:'human',runId:'archive',referenceAudio:[{characterRef:{id:'a',revision:1},voiceRef:{id:'voice',revision:1},ref:s.draft.reference.ref}]}));
 value(await execute(s.engine,'voice.save',{projectId:s.projectId,id:'voice',expectedRevision:1,draft:{...s.draft,archived:true}}));
 expect(s.engine.voices.read({projectId:s.projectId,voiceRef:{id:'voice',revision:1}})).toMatchObject({ok:true});
 expect(s.engine.generation.checkCurrent(prepared)).toMatchObject({ok:false,error:{code:'VOICE_ARCHIVED'}});expect(s.requests).toHaveLength(0);
},120000);
