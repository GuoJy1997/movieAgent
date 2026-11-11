import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {cleanup,setup,image,shot,command,unwrap,settings} from './timeline-fixtures.ts';
import {openLibrary} from '../../packages/storage/src/database.ts';
import {assetsFor} from '../../packages/engine/src/asset-service.ts';
import {timelinesFor} from '../../packages/engine/src/timeline-service.ts';
import {creationFor} from '../../packages/engine/src/creation-service.ts';
import {ok} from '../../packages/contracts/src/result.ts';
import {create} from './timeline-fixtures.ts';
afterEach(cleanup);
it('freezes selected image refs, checks all approval CAS and replays one assembly',async()=>{
 const {e,root,projectId}=await setup();const ref=await image(e,root);unwrap(await e.commands.execute(command(e,'creation.saveShot',shot(projectId))));
 const select={projectId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'image',reference:ref};unwrap(await e.commands.execute(command(e,'creation.selectOutput',select)));
 const input={projectId,scriptRef:{id:'script',revision:1},shots:[{id:'shot',revision:1,selectionRevision:1}],target:{id:'cut',expectedRevision:0},allowImages:true,settings,executionOwner:'editor',runId:'run'};
 const prep=await e.commands.execute(command(e,'timeline.prepareAssembly',input));expect(prep).toMatchObject({ok:true,value:{result:{draft:{videoClips:[{media:ref,kind:'image',mute:true}]}}}});if(!prep.ok)return;const p=prep.value.result as {planId:string;planHash:string};
 unwrap(await e.commands.execute(command(e,'creation.selectOutput',{...select,expectedSelectionRevision:1})));const apply={planId:p.planId,planHash:p.planHash,executionOwner:'editor',runId:'run'};
 expect(await e.commands.execute(command(e,'timeline.applyAssembly',apply))).toMatchObject({ok:false,error:{code:'SELECTION_CONFLICT'}});
 expect(e.commands.query({...command(e,'timeline.list',{projectId}),queryId:'list'})).toMatchObject({ok:true,value:{timelines:[]}});
 const next=unwrap(await e.commands.execute(command(e,'timeline.prepareAssembly',{...input,shots:[{id:'shot',revision:1,selectionRevision:2}]}))).result as {planId:string;planHash:string};
 const accepted={...apply,planId:next.planId,planHash:next.planHash};const first=await e.commands.execute(command(e,'timeline.applyAssembly',accepted));expect(first).toMatchObject({ok:true,value:{result:{revision:1,videoClips:[{media:ref,provenance:{shotRevision:1,selectionRevision:2,productionId:null}}]}}});
 const replay=await e.commands.execute(command(e,'timeline.applyAssembly',accepted));expect(replay.ok&&replay.value.result).toEqual(first.ok&&first.value.result);
 unwrap(await e.commands.execute(command(e,'creation.selectOutput',{...select,expectedSelectionRevision:2,reference:null})));
 expect(e.commands.query({...command(e,'timeline.read',{projectId,timelineId:'cut'}),queryId:'read'})).toMatchObject({ok:true,value:{videoClips:[{media:ref}]}});
});
it('replaces an explicitly captured existing cut and keeps old content immutable',async()=>{
 const {e,root,projectId}=await setup();const ref=await image(e,root);unwrap(await e.commands.execute(command(e,'creation.saveShot',shot(projectId))));unwrap(await e.commands.execute(command(e,'creation.selectOutput',{projectId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'image',reference:ref})));unwrap(await e.commands.execute(command(e,'timeline.create',create(projectId))));
 const p={projectId,scriptRef:{id:'script',revision:1},shots:[{id:'shot',revision:1,selectionRevision:1}],target:{id:'cut',expectedRevision:1},allowImages:true,settings,executionOwner:'editor',runId:'run'};
 const plan=unwrap(await e.commands.execute(command(e,'timeline.prepareAssembly',p))).result as {planId:string;planHash:string};unwrap(await e.commands.execute(command(e,'timeline.applyAssembly',{planId:plan.planId,planHash:plan.planHash,executionOwner:'editor',runId:'run'})));
 const next=await e.commands.execute(command(e,'timeline.prepareAssembly',{...p,target:{id:'cut',expectedRevision:2}}));expect(next).toMatchObject({ok:true});
 expect(e.commands.query({...command(e,'timeline.read',{projectId,timelineId:'cut',revision:1}),queryId:'old'})).toMatchObject({ok:true,value:{videoClips:[]}});
});
it('checks real probe ranges, forbids video-as-image, and revalidates opaque edit tokens in caller transactions',async()=>{
 const {e,root,projectId}=await setup();await e.close();const lib=unwrap(await openLibrary({root}));try{
  const assets=assetsFor(lib),ref={kind:'artifact' as const,libraryId:lib.libraryId,artifactId:'video'},hash='a'.repeat(64);
  lib.db.prepare('INSERT INTO blob_object VALUES(?,?,?,?,?,?,?)').run(hash,hash,100,'objects/aa/'+hash,'video/mp4',64,64);lib.db.prepare('INSERT INTO artifact VALUES(?,?,?,?)').run('video',lib.libraryId,hash,new Date().toISOString());
  const probe={probeId:'probe',objectHash:hash,runtimeHash:'b'.repeat(64),durationTicks:960000,container:'mp4',originSeconds:0,width:64,height:64,hasAudio:true,streams:[{index:0,kind:'video' as const,codec:'h264',timeBase:'1/48000',startPts:0,endPts:480000,startSeconds:0,durationTicks:480000},{index:1,kind:'audio' as const,codec:'aac',timeBase:'1/48000',startPts:0,endPts:960000,startSeconds:0,durationTicks:960000}],verification:'probed' as const};
  const service=timelinesFor({library:lib,assets,mediaInfo:{read:()=>ok(probe),ensure:async()=>ok(probe)}});
  lib.db.exec('BEGIN IMMEDIATE');unwrap(service.create(create(projectId)));lib.db.exec('COMMIT');
  const clip={id:'v',kind:'video' as const,media:ref,sourceHash:hash,sourceProbeId:'probe',sourceInTicks:0,startTicks:0,durationTicks:480000,fit:'contain' as const,gainMilli:1000,mute:true};
  const input={projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'insert' as const,clip}]};
  expect(service.applyOps(input)).toMatchObject({ok:false,error:{code:'TRANSACTION_REQUIRED'}});
  expect(service.validateOps({...input,operations:[{kind:'insert',clip:{...clip,kind:'image',sourceProbeId:null}}]})).toMatchObject({ok:false,error:{code:'INVALID_MEDIA_TYPE'}});
  expect(service.validateOps({...input,operations:[{kind:'insert',clip:{...clip,durationTicks:481600}}]})).toMatchObject({ok:false,error:{code:'SOURCE_RANGE'}});
  expect(service.validateOps({...input,operations:[{kind:'insert',clip:{...clip,sourceProbeId:'missing'}}]})).toMatchObject({ok:false,error:{code:'MEDIA_ANALYSIS_REQUIRED'}});
  const token=unwrap(service.validateOps(input));lib.db.exec('BEGIN IMMEDIATE');unwrap(service.applyOps(input));expect(service.applyValidatedOps(token)).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});lib.db.exec('COMMIT');
  expect(service.history({projectId,timelineId:'cut'})).toMatchObject({ok:true,value:{revisions:[{revision:1},{revision:2}]}});
  expect(()=>lib.db.exec("UPDATE timeline_revision SET data_json='{}'")).toThrow('IMMUTABLE_TIMELINE');expect(()=>lib.db.exec('DELETE FROM timeline_source_reference')).toThrow('IMMUTABLE_TIMELINE');
 }finally{await lib.close();}
});
it('captures original production revision by fixed artifact and aborts preflight on concurrent shot changes',async()=>{
 const {e,root,projectId}=await setup();unwrap(await e.commands.execute(command(e,'creation.saveShot',shot(projectId))));await e.close();const lib=unwrap(await openLibrary({root}));try{
  const assets=assetsFor(lib),creation=creationFor(lib,assets),hash='c'.repeat(64),media={kind:'artifact' as const,libraryId:lib.libraryId,artifactId:'generated'};
  lib.db.prepare('INSERT INTO blob_object VALUES(?,?,?,?,?,?,?)').run(hash,hash,100,'objects/cc/'+hash,'video/mp4',64,64);lib.db.prepare('INSERT INTO artifact VALUES(?,?,?,?)').run('generated',lib.libraryId,hash,new Date().toISOString());
  lib.db.exec('BEGIN IMMEDIATE');unwrap(creation.selectOutput({projectId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'video',reference:media}));unwrap(creation.saveShot(shot(projectId,'shot',{expectedRevision:1,title:'Edited'})));lib.db.exec('COMMIT');
  lib.db.prepare("INSERT INTO shot_production VALUES(?,?,?,'{}','applied',NULL)").run('prod',projectId,projectId);
  const output={libraryId:lib.libraryId,productionId:'prod',shotId:'shot',shotRevision:1,role:'video',nodeId:'n',workflowId:'w',stepId:'s',taskId:'t',reference:media,selected:true,errorCode:null,createdAt:Date.now()};lib.db.prepare('INSERT INTO shot_production_output VALUES(?,?,?,?)').run('prod','n','t',JSON.stringify(output));
  const probe={probeId:'probe',objectHash:hash,runtimeHash:'b'.repeat(64),durationTicks:240000,container:'mp4',originSeconds:0,width:64,height:64,hasAudio:false,streams:[{index:0,kind:'video' as const,codec:'h264',timeBase:'1/48000',startPts:0,endPts:240000,startSeconds:0,durationTicks:240000}],verification:'probed' as const};
  let change=false;const service=timelinesFor({library:lib,assets,mediaInfo:{read:()=>ok(probe),ensure:async()=>{if(change){lib.db.exec('BEGIN IMMEDIATE');unwrap(creation.saveShot(shot(projectId,'shot',{expectedRevision:2,title:'Changed while probing'})));lib.db.exec('COMMIT');}return ok(probe);}}});
  const input={projectId,scriptRef:{id:'script',revision:1},shots:[{id:'shot',revision:2,selectionRevision:1}],target:{id:'cut',expectedRevision:0},allowImages:false,settings,executionOwner:'editor',runId:'run'};
  const plan=unwrap(await service.prepareAssembly(input));expect(plan.draft.videoClips[0]).toMatchObject({media,mute:true,provenance:{shotRevision:2,selectionRevision:1,productionId:'prod',productionShotRevision:1}});
  change=true;expect(await service.prepareAssembly(input)).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});expect(lib.db.prepare('SELECT count(*) n FROM timeline_assembly_plan').get()?.n).toBe(0);expect(lib.db.prepare('SELECT count(*) n FROM timeline_revision').get()?.n).toBe(0);
 }finally{await lib.close();}
});
it('does not silently skip unavailable shots or use images without explicit permission',async()=>{
 const {e,root,projectId}=await setup();const ref=await image(e,root);unwrap(await e.commands.execute(command(e,'creation.saveShot',shot(projectId))));unwrap(await e.commands.execute(command(e,'creation.selectOutput',{projectId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'image',reference:ref})));
 expect(await e.commands.execute(command(e,'timeline.prepareAssembly',{projectId,scriptRef:{id:'script',revision:1},shots:[{id:'shot',revision:1,selectionRevision:1}],target:{id:'cut',expectedRevision:0},allowImages:false,settings,executionOwner:'editor',runId:'run'}))).toMatchObject({ok:false,error:{code:'ASSEMBLY_MEDIA_MISSING'}});
});
it('binds owner/hash/run/expiry/target and includes frozen source references in maintenance snapshots',async()=>{
 const {e,root,projectId}=await setup();const ref=await image(e,root);unwrap(await e.commands.execute(command(e,'creation.saveShot',shot(projectId))));unwrap(await e.commands.execute(command(e,'creation.selectOutput',{projectId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'image',reference:ref})));
 const p=unwrap(await e.commands.execute(command(e,'timeline.prepareAssembly',{projectId,scriptRef:{id:'script',revision:1},shots:[{id:'shot',revision:1,selectionRevision:1}],target:{id:'cut',expectedRevision:0},allowImages:true,settings,executionOwner:'editor',runId:'run'}))).result as {planId:string;planHash:string;expiresAt:number};
 const apply={planId:p.planId,planHash:p.planHash,executionOwner:'editor',runId:'run'};
 for(const extra of [{executionOwner:'other'},{runId:'other'},{planHash:'0'.repeat(64)}])expect(await e.commands.execute(command(e,'timeline.applyAssembly',{...apply,...extra}))).toMatchObject({ok:false,error:{code:'APPROVAL_MISMATCH'}});
 const now=vi.spyOn(Date,'now').mockReturnValue(p.expiresAt+1);try{expect(await e.commands.execute(command(e,'timeline.applyAssembly',apply))).toMatchObject({ok:false,error:{code:'APPROVAL_EXPIRED'}});}finally{now.mockRestore();}
 unwrap(await e.commands.execute(command(e,'timeline.create',create(projectId))));expect(await e.commands.execute(command(e,'timeline.applyAssembly',apply))).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});
 const snapshot=unwrap(await e.maintenance.snapshot());const manifest=JSON.parse(await readFile(join(root,'backups',snapshot.snapshotId+'.json'),'utf8'));expect(manifest.timelineSources).toMatchObject([{ownerKind:'assembly',ownerId:p.planId,sourceProbeId:null,referenceJson:JSON.stringify(ref)}]);
});
