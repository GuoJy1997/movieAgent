import {expect,it} from 'vitest';
import {audioFixture,audioValue as v,audioExecute as exec,fixtureWav} from '../fixtures/audio-generation.ts';
import {readFile} from 'node:fs/promises';import {join} from 'node:path';
import {voiceExporter} from '../../apps/desktop/src/main/voice-export.ts';
it('protects source, short reference and baseline in the snapshot and exports all media with exact identities',async()=>{
 const s=await audioFixture('openai-speech-v1',{native:true}),projectId=s.projectId;
 v(await exec(s.engine,'creation.saveEntity',{projectId,id:'role',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));
 const refs=[];for(const seconds of [20,2,3]){const ref=await s.importAudio(fixtureWav(seconds),'voice-'+seconds+'.wav'),probe=v(await s.engine.mediaInfo.ensure(ref));refs.push({ref,hash:probe.objectHash,probeId:probe.probeId,sourceInTicks:0,durationTicks:seconds*48000});}
 const voice=v(await exec(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft:{entityRef:{id:'role',revision:1},name:'Voice',dialect:'山东话',performanceNotes:'',sourceKind:'sample',reference:refs[1],sourceSample:refs[0],videoReference:refs[1],baselineAudio:refs[2]}}));
 const snapshot=v(await s.engine.maintenance.snapshot()),manifest=JSON.parse(await readFile(join(s.root,'backups',snapshot.snapshotId+'.json'),'utf8'));
 expect(new Set(manifest.voiceSources.map((r:any)=>r.sourceHash))).toEqual(new Set(refs.map(r=>r.hash)));
 const exporter=voiceExporter({root:s.root,libraryId:s.engine.identity.libraryId,projectId},s.engine.assets),input={projectId,voiceRef:{id:voice.id,revision:voice.revision},requestId:crypto.randomUUID()};
 const result=v(await exporter(input,async()=>({ok:true,value:voice}))),metadata=JSON.parse(await readFile(join(s.root,result.relativePath),'utf8'));
 expect(metadata.schemaVersion).toBe(2);expect(metadata.media).toHaveLength(4);expect(metadata.remoteVerification).toBe('not-checked-on-export');
 for(const member of metadata.media)expect(await readFile(join(s.root,result.relativePath,'..',member.file))).toEqual(fixtureWav(member.durationTicks/48000));
 expect(JSON.stringify(metadata)).not.toContain('fixture-audio-key');expect(await exporter(input,async()=>({ok:true,value:voice}))).toMatchObject({ok:true,value:result});
},120000);
it('exports a provider-only voice as an offline identity manifest without inventing reference audio',async()=>{
 const s=await audioFixture(),projectId=s.projectId,libraryId=s.engine.identity.libraryId,model=s.engine.modelConfig.listModels().models[0]!;
 v(await exec(s.engine,'creation.saveEntity',{projectId,id:'role',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));
 const voice=v(await exec(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft:{entityRef:{id:'role',revision:1},name:'Voice',dialect:'',performanceNotes:'',reference:null,sourceKind:'provider-voice',ttsBinding:{profileRef:s.profileRef,modelRef:{libraryId,id:model.id,revision:model.revision},connectionRef:model.connectionRef,providerVoiceId:'Voice (A)',voiceOrigin:'system'}}}));
 const result=v(await voiceExporter({root:s.root,libraryId,projectId},s.engine.assets)({projectId,voiceRef:{id:'voice',revision:1},requestId:crypto.randomUUID()},async()=>({ok:true,value:voice}))),metadata=JSON.parse(await readFile(join(s.root,result.relativePath),'utf8'));
 expect(metadata.media).toEqual([]);expect(metadata.voice.ttsBinding.providerVoiceId).toBe('Voice (A)');expect(JSON.stringify(metadata)).not.toContain('fixture-audio-key');
});
