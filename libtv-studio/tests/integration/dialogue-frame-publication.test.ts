import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,stat,realpath,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {startEngine} from '../../packages/engine/src/bootstrap.ts';
import {loadMediaRuntime} from '../../packages/engine/src/media/manifest.ts';
import {dialogueCoordinatorFor} from '../../packages/engine/src/dialogue-coordinator.ts';
import {audioExecute as execute,audioValue as value,fixtureWav} from '../fixtures/audio-generation.ts';
import {ok} from '../../packages/contracts/src/result.ts';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function setup(fps:number,onPhase?:(phase:string)=>void){
 const root=await mkdtemp(join(tmpdir(),'dialogue-frame-publication-')),runtime=value(await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64')));
 const engine=value(await startEngine({root,runtime,localMedia:{onPhase}})) as Exclude<Awaited<ReturnType<typeof startEngine>>,{ok:false}>['value'];
 cleanups.push(async()=>{await engine.close();await rm(root,{recursive:true,force:true});});
 const projectId=value(await execute(engine,'project.create',{name:'Frame publication'})).id;
 async function imported(path:string,name:string){const info=await stat(path),grantId=crypto.randomUUID();value(engine.assets.registerGrant({grantId,importId:crypto.randomUUID(),libraryId:engine.identity.libraryId,expiresAt:Date.now()+60000,files:[{path,realPath:await realpath(path),allowedRoot:root,name,size:info.size,mtimeMs:info.mtimeMs,dev:info.dev,ino:info.ino}]}));return value(await execute(engine,'asset.importGrantedFiles',{grantId})).versions[0];}
 async function video(name:string,frames:number,outputFps=fps){const path=join(root,name);const result=spawnSync(runtime.ffmpegPath,['-v','error','-y','-f','lavfi','-i',`color=red:s=32x32:r=${outputFps}`,'-frames:v',String(frames),'-c:v','libx264','-pix_fmt','yuv420p',path],{shell:false,windowsHide:true});expect(result.status,result.stderr.toString()).toBe(0);return imported(path,name);}
 const source=await video('source.mp4',fps),audioPath=join(root,'audio.wav');await writeFile(audioPath,fixtureWav(1));const audio=await imported(audioPath,'audio.wav'),probe=value(await engine.mediaInfo.ensure(audio));
 value(await execute(engine,'creation.saveEntity',{projectId,id:'a',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));
 value(await execute(engine,'creation.saveScript',{projectId,id:'script',expectedRevision:0,title:'S',synopsis:'',body:'',scenes:[{id:'scene',title:'S',location:'',time:'',description:''}]}));
 value(await execute(engine,'creation.saveShot',{projectId,id:'shot',expectedRevision:0,scriptId:'script',sceneId:'scene',order:0,title:'S',durationSeconds:1,shotSize:'wide',cameraMovement:'',subject:'',action:'',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'',entityRefs:[]}));
 value(await execute(engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft:{entityRef:{id:'a',revision:1},name:'A',dialect:'',performanceNotes:'',reference:{ref:audio,hash:probe.objectHash,probeId:probe.probeId,sourceInTicks:0,durationTicks:48000}}}));
 const dialogueRef={id:'dialogue',revision:1};value(await execute(engine,'dialogue.save',{projectId,id:'dialogue',expectedRevision:0,draft:{shotRef:{id:'shot',revision:1},turns:[{turnId:'turn',characterRef:{id:'a',revision:1},voiceRef:{id:'voice',revision:1},text:'hello',emotion:'calm',startTicks:0,durationTicks:48000,mode:'dubbed-lipsync'}]}}));
 value(await execute(engine,'dialogue.confirmAudio',{projectId,dialogueRef,source:{kind:'imported-audio',media:audio},expectedRevision:1}));
 const plan=value(await execute(engine,'dialogue.prepareAlignment',{projectId,dialogueRef,sourceVideo:source,confirmedAudioRef:audio,startTicks:0,executionOwner:'human',runId:'align'}));
 const job=value(await execute(engine,'media.enqueueDerived',{planId:plan.planId,planHash:plan.planHash,executionOwner:'human',runId:'align',diskBudgetBytes:plan.requiredFreeBytes}));
 return {root,runtime,engine,projectId,dialogueRef,source,audio,plan,job,video};
}
it.each([24,25,30])('uses the captured %i fps target for manual and provider repair boundaries',async fps=>{
 const s=await setup(fps);expect(s.engine.renders.claim()).toBe(s.job.jobId);await s.engine.renders.execute(s.job.jobId,new AbortController());
 const aligned=value(s.engine.renders.read({projectId:s.projectId,jobId:s.job.jobId}));expect(aligned.state).toBe('SUCCEEDED');
 const db=new DatabaseSync(join(s.root,'library.sqlite'));cleanups.push(async()=>db.close());
 const sourceProbe=value(await s.engine.mediaInfo.ensure(s.source)),sourceMetadata=value(s.engine.assets.metadata(s.source)),audioMetadata=value(s.engine.assets.metadata(aligned.outputRef));
 const sourceFrozen={ref:s.source,hash:sourceMetadata.hash,probeId:sourceProbe.probeId,durationTicks:48000,mime:'video/mp4',byteLength:sourceMetadata.byteLength};
 const artifacts=new Map<string,string>();const generation:any={read:(taskId:string)=>ok({libraryId:s.engine.identity.libraryId,taskId,attemptId:'attempt',state:'SUCCEEDED',artifactRef:{kind:'artifact',libraryId:s.engine.identity.libraryId,artifactId:artifacts.get(taskId)},errorCode:null})};
 const coordinator=dialogueCoordinatorFor({db,root:s.root,libraryId:s.engine.identity.libraryId,checkOwnership:()=>ok(undefined)} as any,generation,s.engine.assets,s.runtime);cleanups.push(()=>coordinator.close());
 for(const extra of fps===30?[0,1,2,3,4]:[0,1,2]){
  // The repair's own 25fps must not widen a captured 30fps target's tolerance.
  const repaired=await s.video(`repair-${extra}.mp4`,extra===3?26:fps+Math.min(extra,2),extra===3?25:fps),result=await execute(s.engine,'dialogue.importRepair',{projectId:s.projectId,dialogueRef:s.dialogueRef,sourceVideo:s.source,confirmedAudioRef:aligned.outputRef,repairedVideo:repaired});
  expect.soft(result.ok,`manual target${fps} extra${extra}: ${JSON.stringify(result)}`).toBe(extra<=1);
  if(!result.ok)expect(result.error.code).toBe('DIALOGUE_ALIGNMENT_FAILED');
  const object=db.prepare('SELECT object_id FROM asset_version WHERE asset_id=? AND version=?').get(repaired.assetId,repaired.version)!;
  const id=`provider-${extra}`;artifacts.set(id,id);db.prepare('INSERT INTO artifact(id,library_id,object_id,created_at) VALUES(?,?,?,?)').run(id,s.engine.identity.libraryId,object.object_id as string,new Date().toISOString());
  const plan={projectId:s.projectId,route:'dubbed-lipsync',items:[{dialogue:{id,revision:1,shotRef:{id:'shot',revision:1},turns:[{voiceRef:{id:'voice',revision:1}}]},prepared:{lipSyncVideo:extra===4?{...sourceFrozen,probeId:'missing-probe'}:sourceFrozen,lipSyncAudio:{ref:aligned.outputRef,hash:audioMetadata.hash}}}]};
  db.prepare('INSERT INTO dialogue_production_plan VALUES(?,?,?,?,?,?,?,?)').run(id,s.projectId,'a'.repeat(64),'human',id,Date.now()+600000,'approved',JSON.stringify(plan));db.prepare('INSERT INTO dialogue_production_item VALUES(?,?,?,?,NULL)').run(id,id,id,id);
  value(await (extra===0?coordinator.start():coordinator.wake()));
  // wake() may join a pass already running before this row was inserted.
  // Observe the completed background result instead of treating that join as a flush barrier.
  if(extra<=1) await expect.poll(()=>Boolean(db.prepare('SELECT 1 FROM dialogue_take WHERE task_id=?').get(id)),{timeout:10000}).toBe(true);
  else {
   await expect.poll(()=>db.prepare('SELECT diagnostic FROM dialogue_production_item WHERE plan_id=?').get(id)?.diagnostic,{timeout:10000}).toBe(extra===4?'DIALOGUE_FRAME_RATE_REQUIRED':'DIALOGUE_ALIGNMENT_FAILED');
   expect(Boolean(db.prepare('SELECT 1 FROM dialogue_take WHERE task_id=?').get(id))).toBe(false);
  }
 }
});
it.each([false,true])('checks owned abort at actual alignment beforePublish (abort=%s)',async abort=>{
 const controller=new AbortController();let reached=false;const s=await setup(30,phase=>{if(phase==='beforePublish'){reached=true;if(abort)controller.abort();}});
 expect(s.engine.renders.claim()).toBe(s.job.jobId);await s.engine.renders.execute(s.job.jobId,controller);
 const result=value(s.engine.renders.read({projectId:s.projectId,jobId:s.job.jobId}));expect(reached).toBe(true);
 const db=new DatabaseSync(join(s.root,'library.sqlite'));try{
  expect(result.state).toBe(abort?'INTERRUPTED':'SUCCEEDED');expect(Boolean(result.outputRef)).toBe(!abort);
  expect(db.prepare('SELECT COUNT(*) AS n FROM local_media_output WHERE job_id=?').get(s.job.jobId)?.n).toBe(abort?0:1);
  expect(db.prepare('SELECT COUNT(*) AS n FROM asset_version WHERE asset_id=?').get('local-'+s.job.jobId)?.n).toBe(abort?0:1);
  if(abort){expect(result.needsResume).toBe(true);expect(s.engine.renders.claim()).toBeUndefined();}
 }finally{db.close();}
});
