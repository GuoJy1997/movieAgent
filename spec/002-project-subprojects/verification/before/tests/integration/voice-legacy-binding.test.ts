import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';import {join} from 'node:path';
import {audioFixture,audioValue as v,audioExecute as exec,fixtureWav} from '../fixtures/audio-generation.ts';
it('migrates a resolvable legacy TTS preset without changing voice identity or manufacturing quality approval',async()=>{
 const s=await audioFixture('openai-speech-v1',{native:true,parameters:{voice:'Legacy (A)'}}),projectId=s.projectId;
 v(await exec(s.engine,'creation.saveEntity',{projectId,id:'role',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));const media=await s.importAudio(fixtureWav(2)),probe=v(await s.engine.mediaInfo.ensure(media));
 v(await exec(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft:{entityRef:{id:'role',revision:1},name:'Voice',dialect:'',performanceNotes:'',reference:{ref:media,hash:probe.objectHash,probeId:probe.probeId,sourceInTicks:0,durationTicks:96000},ttsProfileRef:s.profileRef}}));
 v(await s.engine.close());const db=new DatabaseSync(join(s.root,'library.sqlite'));db.exec('DROP TABLE character_voice_binding;DROP TABLE voice_clone_job;DROP TABLE voice_provider_catalog;DROP TABLE voice_qualification;DROP TABLE dialogue_audio_assembly;DELETE FROM migration_log WHERE version>23;UPDATE library SET schema_version=23;PRAGMA user_version=23');db.close();s.engine=await s.open();
 const voice=v(s.engine.voices.read({projectId,voiceRef:{id:'voice',revision:1}}));expect(voice).toMatchObject({id:'voice',revision:1,ttsBinding:{providerVoiceId:'Legacy (A)',profileRef:s.profileRef}});expect(voice.verified).toBeUndefined();expect(v(s.engine.voices.list({projectId})).defaultBindings).toMatchObject([{voiceRef:{id:'voice',revision:1}}]);expect(s.requests).toHaveLength(0);
},30000);
