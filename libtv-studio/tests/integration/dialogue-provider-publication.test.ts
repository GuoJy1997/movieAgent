import { expect,it } from 'vitest';
import { join } from 'node:path';
import { readFile,stat,realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { audioFixture,audioExecute as execute,audioValue as value,fixtureWav } from '../fixtures/audio-generation.ts';
import { fileModelDefaults } from '../../packages/domain/src/model-config.ts';
import { ArtifactSource } from '../../packages/providers/src/artifact-source.ts';
import { isProviderSnapshot,isProviderVerification } from '../../packages/contracts/src/models.ts';

for(const adapter of ['minimax-h3-v2','sync-lipsync-v2'] as const)it(`commits genuine ${adapter} collection and strict fixture verification query`,async()=>{
 const response=(body:unknown)=>({status:200,bytes:Buffer.from(JSON.stringify(body))});
 const s=await audioFixture('openai-speech-v1',{native:true,providerContext:{requestVideo:async()=>response({task_id:'known'}),queryVideo:async()=>response({task:{status:'succeeded',content:{url:'https://fixture.invalid/video'}}}),requestLipSync:async()=>response({id:'known'}),queryLipSync:async()=>response({id:'known',status:'COMPLETED',output:{url:'https://fixture.invalid/video'}})}});
 const projectId=s.projectId,audio=await s.importAudio(fixtureWav(2)),audioProbe=value(await s.engine.mediaInfo.ensure(audio));
 const path=join(s.root,'output.mp4');expect(spawnSync(s.runtime!.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=red:s=64x64:r=30:d=4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4','-c:v','libx264','-threads','2','-c:a','aac','-shortest',path],{shell:false,windowsHide:true}).status).toBe(0);
 const bytes=await readFile(path),info=await stat(path),grantId=crypto.randomUUID();value(s.engine.assets.registerGrant({grantId,importId:crypto.randomUUID(),libraryId:s.engine.identity.libraryId,expiresAt:Date.now()+60000,files:[{path,realPath:await realpath(path),allowedRoot:s.root,name:'output.mp4',size:info.size,mtimeMs:info.mtimeMs,dev:info.dev,ino:info.ino}]}));const video=value(await execute(s.engine,'asset.importGrantedFiles',{grantId})).versions[0],videoProbe=value(await s.engine.mediaInfo.ensure(video));
 const connectionRef=value(await execute(s.engine,'provider.saveConnection',{id:'dialogue',expectedRevision:0,name:'Fixture',adapterType:adapter,baseUrl:'https://fixture.invalid/v1',credentialRef:null,headers:{},networkPolicy:{privateEndpoint:null},timeoutMs:1000,concurrency:1}));
 const modelRef=value(await execute(s.engine,'model.saveDefinition',{id:'dialogue',expectedRevision:0,name:'Fixture',modelId:'fixture',connectionRef,...fileModelDefaults(adapter,{})}));const profileRef=value(await execute(s.engine,'profile.save',{id:'dialogue',expectedRevision:0,name:'Fixture',modelRef,parameters:{}}));
 let input:any={projectId,profileRef,prompt:'fixture',inputVersion:'source',executionOwner:'human',runId:'publication'};
 if(adapter==='minimax-h3-v2'){
  value(await execute(s.engine,'creation.saveEntity',{projectId,id:'role',expectedRevision:0,kind:'character',name:'Role',description:'',constraints:'',references:[]}));
  value(await execute(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft:{entityRef:{id:'role',revision:1},name:'Voice',dialect:'',performanceNotes:'',reference:{ref:audio,hash:audioProbe.objectHash,probeId:audioProbe.probeId,sourceInTicks:0,durationTicks:96000}}}));
  input.referenceAudio=[{characterRef:{id:'role',revision:1},voiceRef:{id:'voice',revision:1},ref:audio}];
 }else input={...input,lipSyncVideo:{ref:video,hash:videoProbe.objectHash,mime:'video/mp4',byteLength:bytes.length,durationTicks:videoProbe.durationTicks,probeId:videoProbe.probeId},lipSyncAudio:{ref:audio,hash:audioProbe.objectHash,mime:'audio/wav',byteLength:fixtureWav(2).length,durationTicks:96000,probeId:audioProbe.probeId}};
 // Sync fixed media is an internal producer seam, never a renderer generation flag.
 const prepared=value(adapter==='sync-lipsync-v2'?s.engine.generation.prepare(input):await execute(s.engine,'generation.prepare',input));const task=value(await execute(s.engine,'generation.approveAndEnqueue',{preparedId:prepared.preparedId,approvedPlanHash:prepared.planHash,executionOwner:'human',runId:'publication',...s.approval}));
 value(await new ArtifactSource(s.root,undefined,'video').stage(`${task.attemptId}-output`,bytes));value(await s.engine.scheduler.run(task.attemptId));const collected=value(await s.engine.generation.reconcile(task.taskId));expect(collected,JSON.stringify(collected)).toMatchObject({state:'SUCCEEDED',collectionState:'durable',errorCode:null});
 const snapshot=value(s.engine.commands.query({schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'fixture',queryId:'verification',kind:'provider.list',payload:{}}));expect(isProviderSnapshot(snapshot)).toBe(true);
 const verification=snapshot.verification.find((v:any)=>v.adapterId===adapter);expect(isProviderVerification(verification)).toBe(true);expect(verification).toMatchObject({fixtureGeneration:true,generation:'unverified',authentication:'unknown',capabilities:{[adapter==='minimax-h3-v2'?'textToVideo':'lipSync']:'adapter-declared',reconcile:'provider-task-id'}});
 expect(isProviderVerification({...verification,capabilities:{textToImage:'adapter-declared',batch:1,reconcile:'unsupported'}})).toBe(false);
},20000);
