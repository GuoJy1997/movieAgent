import {expect,it} from 'vitest';
import {nativeFixture,value,execute} from '../fixtures/native-generation.ts';
import {prepared} from '../fixtures/agent.ts';
import {fixtureWav} from '../fixtures/audio-generation.ts';
it('gives the Agent only the selected role fixed voice and instructions without calling a media service',async()=>{
 const s=await nativeFixture('openai-chat-v1','max_tokens',undefined,true),projectId=s.prepareInput().projectId,media=await s.importFile(fixtureWav(2),'voice.wav'),probe=value(await s.engine.mediaInfo.ensure(media));
 value(await execute(s.engine,'creation.saveEntity',{projectId,id:'role',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));
 value(await execute(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft:{entityRef:{id:'role',revision:1},name:'Voice',dialect:'山东话',performanceNotes:'克制',reference:{ref:media,hash:probe.objectHash,probeId:probe.probeId,sourceInTicks:0,durationTicks:96000}}}));
 value(await execute(s.engine,'voice.bindDefault',{projectId,characterId:'role',voiceRef:{id:'voice',revision:1},expectedRevision:0}));
 const p=await prepared(s,{targets:{shotIds:[],entityIds:['role']}});
 expect(p.turn.targets.voices).toMatchObject([{id:'voice',revision:1,entityRef:{id:'role'}}]);expect(p.turn.generation.prompt).toContain('山东话');expect(p.turn.generation.prompt).toContain('克制');expect(p.turn.context.sources).toContainEqual({kind:'voice',key:'voice-0',id:'voice',revision:1});expect(s.requests).toHaveLength(0);
},30000);
