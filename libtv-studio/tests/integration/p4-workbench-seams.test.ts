import { afterEach,expect,it,vi } from 'vitest';
import { cleanup,command,image,unwrap,setup,shot,settings,create } from './timeline-fixtures.ts';
import type { TimelineRevision,TimelineHistory } from '../../packages/contracts/src/timeline.ts';
import { setupRender } from './render-fixtures.ts';
import { parseCommand } from '../../packages/contracts/src/commands.ts';
import { mkdtemp,writeFile,rm,truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timelineDraftClose } from '../../apps/desktop/src/main/timeline-draft-close.ts';
import { isDerivedMediaView,parsePrepareDerived,isDerivedMediaPlan } from '../../packages/contracts/src/render.ts';
import { renderDigest } from '../../packages/domain/src/render-plan.ts';
import { isDefinitiveCommandRejection } from '../../apps/desktop/src/main/command-rejection.ts';
afterEach(cleanup);
it('checks restore FPS locking against the final historical-plus-ops candidate',async()=>{
 const {e,root,projectId}=await setup(),ref=await image(e,root),metadata=unwrap(e.assets.metadata(ref));
 unwrap(await e.commands.execute(command(e,'timeline.create',{...create(projectId),settings:{...settings,fps:{num:25,den:1}}})));
 unwrap(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'setSettings',settings}]})));
 const clip={id:'c',kind:'image',media:ref,sourceHash:metadata.hash,sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:48000,fit:'contain',gainMilli:1000,mute:true};
 unwrap(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:2,operations:[{kind:'insert',clip}]})));
 expect(await e.commands.execute(command(e,'timeline.restore',{projectId,timelineId:'cut',expectedRevision:3,sourceRevision:1}))).toMatchObject({ok:false,error:{code:'FPS_LOCKED'}});
 expect(await e.commands.execute(command(e,'timeline.restore',{projectId,timelineId:'cut',expectedRevision:3,sourceRevision:1,operations:[{kind:'setSettings',settings},{kind:'insert',clip}]}))).toMatchObject({ok:true,value:{result:{revision:4,fps:{num:30}}}});
});
it('atomically restores fixed history plus bounded edits preserving provenance and rejects invalid writes',async()=>{
 const {e,root,projectId}=await setup(),ref=await image(e,root);
 unwrap(await e.commands.execute(command(e,'creation.saveShot',shot(projectId))));unwrap(await e.commands.execute(command(e,'creation.selectOutput',{projectId,shotId:'shot',expectedRevision:1,expectedSelectionRevision:0,role:'image',reference:ref})));
 const p=unwrap(await e.commands.execute(command(e,'timeline.prepareAssembly',{projectId,scriptRef:{id:'script',revision:1},shots:[{id:'shot',revision:1,selectionRevision:1}],target:{id:'cut',expectedRevision:0},allowImages:true,settings,executionOwner:'editor',runId:'run'}))).result as {planId:string;planHash:string};
 const original=unwrap(await e.commands.execute(command(e,'timeline.applyAssembly',{planId:p.planId,planHash:p.planHash,executionOwner:'editor',runId:'run'}))).result as TimelineRevision;
 const clip=original.videoClips[0]!;
 unwrap(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'replaceMedia',clipId:clip.id,media:ref,sourceHash:clip.sourceHash,sourceProbeId:null,sourceInTicks:0,durationTicks:clip.durationTicks}]})));
 const payload={projectId,timelineId:'cut',expectedRevision:2,sourceRevision:1,operations:[{kind:'setSettings',settings,title:'unsaved intermediate'}]};
 const envelope=command(e,'timeline.restore',payload),result=unwrap(await e.commands.execute(envelope));
 expect(result.result).toMatchObject({revision:3,title:'unsaved intermediate'});expect((result.result as TimelineRevision).videoClips[0]).toEqual(clip);expect(unwrap(await e.commands.execute(envelope))).toEqual(result);
 const query=()=>e.commands.query({...command(e,'timeline.history',{projectId,timelineId:'cut'}),queryId:'history'});
 for(const extra of [{expectedRevision:2},{sourceRevision:999},{operations:[{kind:'delete',clipId:'missing'}]},{operations:[{kind:'insert',clip}]},{operations:Array.from({length:101},()=>({kind:'delete',clipId:'missing'}))},{operations:[{kind:'replaceMedia',clipId:clip.id,media:{kind:'assetVersion',libraryId:e.identity.libraryId,assetId:'missing',version:1},sourceHash:clip.sourceHash,sourceProbeId:null,sourceInTicks:0,durationTicks:clip.durationTicks}]}]){
  const rejected=command(e,'timeline.restore',{...payload,expectedRevision:3,...extra}),cursor=unwrap(e.events.read({libraryId:e.identity.libraryId,connectionEpoch:'fixture'})).cursor;
  const failure=await e.commands.execute(rejected);expect(failure).toMatchObject({ok:false});if(failure.ok)throw Error('expected rejection');expect(isDefinitiveCommandRejection(rejected as never,failure.error.code)).toBe(true);
  const history=query();if(!history.ok)throw Error(history.error.code);expect((history.value as TimelineHistory).revisions).toHaveLength(3);
  expect(e.commands.query({...command(e,'command.receipt',{commandId:rejected.commandId}),queryId:'receipt'})).toEqual({ok:true,value:null});expect(unwrap(e.events.read({libraryId:e.identity.libraryId,connectionEpoch:'fixture',cursor}))).toMatchObject({cursor,events:[]});
 }
 expect(parseCommand(command(e,'timeline.restore',{...payload,snapshot:original})).ok).toBe(false);
 unwrap(await e.commands.execute(command(e,'asset.trash',{assetId:ref.assetId,expectedRevision:1})));
 const historical=unwrap(await e.commands.execute(command(e,'timeline.restore',{...payload,expectedRevision:3}))).result as TimelineRevision;expect(historical.videoClips[0]).toEqual(clip);
 const rejected=command(e,'timeline.restore',{...payload,expectedRevision:4,operations:[{kind:'replaceMedia',clipId:clip.id,media:ref,sourceHash:clip.sourceHash,sourceProbeId:null,sourceInTicks:0,durationTicks:clip.durationTicks}]});const failure=await e.commands.execute(rejected);expect(failure).toMatchObject({ok:false,error:{code:'ASSET_TRASHED'}});expect(isDefinitiveCommandRejection(rejected as never,'ASSET_TRASHED')).toBe(true);
});
it('explicit media inspection returns fixed image metadata with no render job and replays its receipt',async()=>{
 const {e,root,projectId}=await setupRender();const reference=await image(e,root);
 const input=command(e,'media.inspect' as never,{projectId,reference} as never);
 expect(parseCommand(input).ok).toBe(true);
 const inspected=unwrap(await e.commands.execute(input));
 expect(inspected.result).toMatchObject({ref:reference,mime:'image/png',probe:null});
 expect(unwrap(await e.commands.execute(input))).toEqual(inspected);
 expect(unwrap(e.renders.list({projectId})).jobs).toEqual([]);
 expect(parseCommand({...input,payload:{projectId,reference,path:'C:/secret'}}).ok).toBe(false);
});
it('narrow SRT reader rejects oversized and malformed UTF-8 and exposes no path',async()=>{
 const path='../../apps/desktop/src/main/subtitle-file.ts';
 const module=await import(path).catch(()=>({}));
 expect(typeof module.readSubtitleFile).toBe('function');
 const root=await mkdtemp(join(tmpdir(),'subtitle-read-')),file=join(root,'caption.srt');
 try {
  const text='1\n00:00:00,000 --> 00:00:01,000\n字幕\n';await writeFile(file,text);
  expect(await module.readSubtitleFile(file)).toEqual({ok:true,value:{name:'caption.srt',text}});
  await writeFile(file,Buffer.from([0xff,0xfe,0x00]));expect(await module.readSubtitleFile(file)).toMatchObject({ok:false,error:{code:'INVALID_SUBTITLE_ENCODING'}});
  await truncate(file,4*1024**2+1);expect(await module.readSubtitleFile(file)).toMatchObject({ok:false,error:{code:'SUBTITLE_FILE_LIMIT'}});
 } finally {await rm(root,{recursive:true,force:true});}
});
it('refuses stale modal discard and leaves the engine live when returning to save',async()=>{
 let resolve:(choice:'save'|'discard'|'cancel')=>void=()=>{};let shown=0;
 const close=timelineDraftClose(()=>new Promise(r=>{resolve=r;}),()=>{shown++;});
 close.update({dirty:true,token:'a'});const first=close.mayQuit();close.update({dirty:true,token:'b'});resolve('discard');expect(await first).toBe(false);
 const second=close.mayQuit();resolve('save');expect(await second).toBe(false);expect(shown).toBe(1);
 close.update({dirty:false,token:'a'});const third=close.mayQuit();resolve('cancel');expect(await third).toBe(false);
 close.update({dirty:false,token:'b'});expect(await close.mayQuit()).toBe(true);
});
it('exposes typed fixed-plan derived entries and omits evicted caches without guessing order',async()=>{
 const {e,root,projectId}=await setupRender();const reference=await image(e,root);
 const plan=unwrap(await e.renders.prepareDerived({projectId,references:[reference],fps:{num:30,den:1},canvas:{width:1080,height:1080},executionOwner:'user',runId:'derive'}));
 const input={projectId,references:[reference],fps:plan.fps,canvas:plan.canvas,executionOwner:'user',runId:'derive'};
 expect(parsePrepareDerived({...input,videoFit:'cover'}).ok).toBe(true);expect(parsePrepareDerived({...input,videoFit:'stretch'}).ok).toBe(false);
 expect(plan.recipeHash).toBe(renderDigest({fps:plan.fps,canvas:plan.canvas,runtime:plan.manifest.runtimeHash,font:plan.manifest.fontHash,recipe:'editing-preview-v1'}));
 const cover=unwrap(await e.renders.prepareDerived({...input,videoFit:'cover'}));expect(cover.recipeHash).not.toBe(plan.recipeHash);expect(isDerivedMediaPlan(cover)).toBe(true);
 const job=unwrap(e.renders.enqueueDerived({planId:plan.planId,planHash:plan.planHash,executionOwner:'user',runId:'derive',diskBudgetBytes:plan.requiredFreeBytes}));
 expect(e.renders.claim()).toBe(job.jobId);await e.renders.execute(job.jobId,new AbortController());
 const view=unwrap(e.renders.derived({projectId,planId:plan.planId}));expect(isDerivedMediaView(view)).toBe(true);
 expect(view.recipe).toEqual({fps:plan.fps,canvas:plan.canvas,videoFit:'contain'});expect(isDerivedMediaView({...view,recipe:{...view.recipe,videoFit:'stretch'}})).toBe(false);
 expect(view.entries).toHaveLength(1);expect(view.entries[0]).toMatchObject({kind:'thumbnail',mime:'image/png',ref:{sourceHash:plan.manifest.entries[0]!.hash}});
 expect(isDerivedMediaView({...view,entries:[{...view.entries[0],kind:'proxy',mime:'application/json'}]})).toBe(false);
 const clock=vi.spyOn(Date,'now').mockReturnValue(plan.expiresAt+1);try{unwrap(await e.renders.reclaimCache(0));}finally{clock.mockRestore();}
 expect(unwrap(e.renders.derived({projectId,planId:plan.planId})).entries).toEqual([]);
});
