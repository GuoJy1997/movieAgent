import {afterEach,expect,it} from 'vitest';
import {cleanup,setup,create,command,unwrap,image,settings} from './timeline-fixtures.ts';
import {isDomainEvent} from '../../packages/contracts/src/events.ts';
import {queryOutputValidators} from '../../packages/contracts/src/queries.ts';
import {parseApplyTimelineOps,isTimelineRevision,DEFAULT_SUBTITLE_STYLE,type TimelineRevision} from '../../packages/contracts/src/timeline.ts';
import {isDefinitiveCommandRejection} from '../../apps/desktop/src/main/command-rejection.ts';
import {applyTimelineOps} from '../../packages/domain/src/timeline-edit.ts';
import {timelineEndTicks,timelineWarnings,validateRenderContent} from '../../packages/domain/src/timeline-time.ts';
afterEach(cleanup);
it('creates empty immutable timelines with CAS, receipts, history and restore',async()=>{
 const {e,projectId}=await setup();const c=command(e,'timeline.create',create(projectId),'create-cut');const r=await e.commands.execute(c);
 expect(r).toMatchObject({ok:true,value:{result:{revision:1,videoClips:[]}}});if(!r.ok)return;expect(await e.commands.execute(c)).toEqual(r);
 expect(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'setSettings',settings:{...settings,fps:{num:24,den:1}}}]}))).toMatchObject({ok:true,value:{result:{revision:2,fps:{num:24}}}});
 expect(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:1,operations:[]}))).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});
 expect(await e.commands.execute(command(e,'timeline.restore',{projectId,timelineId:'cut',expectedRevision:2,sourceRevision:1}))).toMatchObject({ok:true,value:{result:{revision:3,fps:{num:30}}}});
 expect(e.commands.query({...command(e,'timeline.history',{projectId,timelineId:'cut'}),queryId:'history'})).toMatchObject({ok:true,value:{revisions:[{revision:1},{revision:2},{revision:3}]}});
});
it('rejects restore across a populated FPS lock without revision, receipt or event writes', async () => {
 const {e,root,projectId}=await setup();
 const ref=await image(e,root),metadata=unwrap(e.assets.metadata(ref));
 const clip={id:'v',kind:'image',media:ref,sourceHash:metadata.hash,sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:480000,fit:'contain',gainMilli:1000,mute:true};
 unwrap(await e.commands.execute(command(e,'timeline.create',create(projectId))));
 const edit=async(expectedRevision:number,operations:unknown[])=>unwrap(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision,operations})));
 await edit(1,[{kind:'insert',clip}]); // revision2: populated30fps
 await edit(2,[{kind:'delete',clipId:'v'}]);
 await edit(3,[{kind:'setSettings',settings:{...settings,fps:{num:24,den:1}}}]);
 await edit(4,[{kind:'insert',clip}]); // revision5: populated24fps
 const historyRequest={...command(e,'timeline.history',{projectId,timelineId:'cut'}),queryId:'restore-history'};
 const beforeHistory=e.commands.query(historyRequest);
 const beforeEvents=unwrap(e.events.read({libraryId:e.identity.libraryId,connectionEpoch:'fixture'})).cursor;
 const rejected=command(e,'timeline.restore',{projectId,timelineId:'cut',expectedRevision:5,sourceRevision:2},'restore-fps-rejected');
 expect(await e.commands.execute(rejected)).toMatchObject({ok:false,error:{code:'FPS_LOCKED'}});
 expect(e.commands.query(historyRequest)).toEqual(beforeHistory);
 expect(e.commands.query({...command(e,'command.receipt',{commandId:rejected.commandId}),queryId:'restore-receipt'})).toEqual({ok:true,value:null});
 expect(unwrap(e.events.read({libraryId:e.identity.libraryId,connectionEpoch:'fixture',cursor:beforeEvents}))).toMatchObject({cursor:beforeEvents,events:[]});
 expect(isDefinitiveCommandRejection(rejected as never,'FPS_LOCKED')).toBe(true);
 expect(await e.commands.execute(command(e,'timeline.restore',{projectId,timelineId:'cut',expectedRevision:5,sourceRevision:5}))).toMatchObject({ok:true,value:{result:{revision:6,fps:{num:24}}}});
 await edit(6,[{kind:'delete',clipId:'v'}]);
 expect(await e.commands.execute(command(e,'timeline.restore',{projectId,timelineId:'cut',expectedRevision:7,sourceRevision:2}))).toMatchObject({ok:true,value:{result:{revision:8,fps:{num:30},videoClips:[{id:'v'}]}}});
});
function draft():TimelineRevision {
 const media={kind:'artifact' as const,libraryId:'lib',artifactId:'fixed'};
 return {libraryId:'lib',projectId:'p',id:'cut',revision:1,scriptRef:{id:'s',revision:1},title:'Cut',...settings,timebase:48000,videoClips:[{id:'v',kind:'video',media,sourceHash:'a'.repeat(64),sourceProbeId:'probe',sourceInTicks:0,startTicks:0,durationTicks:1440000,fit:'contain',gainMilli:1000,mute:true}],audioClips:[],subtitleCues:[],subtitleStyle:DEFAULT_SUBTITLE_STYLE,createdAt:'2026-01-01T00:00:00Z'};
}
it('splits with a fixed source, keeps duration, handles trim/move/gain/fit/cue and shortens tail',()=>{
 const t=draft(),r=unwrap(applyTimelineOps(t,[{kind:'split',clipId:'v',atTicks:480000,operationId:'split'}]));
 expect(r.videoClips.map(c=>[c.startTicks,c.durationTicks,c.sourceInTicks])).toEqual([[0,480000,0],[480000,960000,480000]]);expect(r.videoClips.every(c=>c.sourceHash===t.videoClips[0]!.sourceHash)).toBe(true);expect(timelineEndTicks(r)).toBe(1440000);
 const right=r.videoClips[1]!.id;const edited=unwrap(applyTimelineOps(r,[{kind:'trim',clipId:right,sourceInTicks:720000,durationTicks:480000},{kind:'move',clipId:right,startTicks:720000},{kind:'setGain',clipId:right,gainMilli:500,mute:false},{kind:'setFit',clipId:right,fit:'cover'},{kind:'setCue',cue:{id:'sub',startTicks:0,endTicks:1600,text:'你好'}}]));
 expect(edited.videoClips[1]).toMatchObject({sourceInTicks:720000,startTicks:720000,durationTicks:480000,gainMilli:500,mute:false,fit:'cover'});expect(timelineEndTicks(edited)).toBe(1200000);expect(timelineEndTicks(unwrap(applyTimelineOps(edited,[{kind:'delete',clipId:right}])))).toBe(480000);
});
it('rejects overflow, nonpositive duration, off-frame boundaries, duplicates, cue injection and operation/payload caps',()=>{
 const t=draft();for(const change of [{durationTicks:0},{durationTicks:-1600},{startTicks:1},{sourceInTicks:1},{durationTicks:Number.MAX_SAFE_INTEGER}])expect(isTimelineRevision({...t,videoClips:[{...t.videoClips[0],...change}]})).toBe(false);
 expect(applyTimelineOps(t,[{kind:'insert',clip:t.videoClips[0]!}])).toMatchObject({ok:false});
 expect(applyTimelineOps(t,[{kind:'setCue',cue:{id:'sub',startTicks:0,endTicks:1600,text:'<script>bad</script>'}}])).toMatchObject({ok:false});
 const input={projectId:'p',timelineId:'cut',expectedRevision:1,operations:Array.from({length:101},()=>({kind:'delete',clipId:'v'}))};expect(parseApplyTimelineOps(input)).toMatchObject({ok:false});
 expect(parseApplyTimelineOps({...input,operations:[{kind:'setCue',cue:{id:'sub',startTicks:0,endTicks:1600,text:'界'.repeat(400000)}}]})).toMatchObject({ok:false});
 expect(parseApplyTimelineOps({...input,operations:[{kind:'setSettings',settings:{...settings,fps:{num:29.97,den:1}}}]})).toMatchObject({ok:false});
});
it('rejects ripple expansion exceeding 256 audio clips without mutating the input',()=>{
 const t=draft();t.videoClips[0]={...t.videoClips[0]!,startTicks:480000,durationTicks:240000};
 t.audioClips=Array.from({length:256},(_,i)=>({id:'a'+i,kind:'audio',track:'music',media:{kind:'artifact',libraryId:'lib',artifactId:'audio'},sourceHash:'b'.repeat(64),sourceProbeId:'audio-probe',sourceInTicks:0,startTicks:i===0?0:1440000+(i-1)*1600,durationTicks:i===0?1440000:1600,gainMilli:1000,mute:false}));
 expect(isTimelineRevision(t)).toBe(true);const frozen=structuredClone(t);expect(applyTimelineOps(t,[{kind:'rippleDelete',clipId:'v',operationId:'ripple'}])).toMatchObject({ok:false});expect(t).toEqual(frozen);
});
it('derives the endpoint across all tracks and reports black tail and export eligibility',()=>{
 const t=draft();t.audioClips=[{id:'music',kind:'audio',track:'music',media:{kind:'artifact',libraryId:'lib',artifactId:'bgm'},sourceHash:'b'.repeat(64),sourceProbeId:'probe',sourceInTicks:0,startTicks:0,durationTicks:2880000,gainMilli:1000,mute:false}];
 expect(timelineEndTicks(t)).toBe(2880000);expect(timelineWarnings(t)).toEqual([{code:'BLACK_VIDEO_TAIL',startTicks:1440000,endTicks:2880000}]);expect(validateRenderContent(t,'mp4')).toBe(true);t.videoClips=[];expect(validateRenderContent(t,'mp4')).toBe(false);expect(validateRenderContent(t,'wav')).toBe(true);t.audioClips=[];expect(validateRenderContent(t,'wav')).toBe(false);
});
it('requires evidence of a video audio stream before considering it a WAV audio source',()=>{const t=draft();t.videoClips[0]!.mute=false;expect(validateRenderContent(t,'wav')).toBe(false);});
it('settles definitive timeline CAS/approval conflicts while leaving storage errors pending',()=>{
 const c=command({identity:{libraryId:'lib'}} as never,'timeline.applyOps',{});
 expect(isDefinitiveCommandRejection(c as never,'REVISION_CONFLICT')).toBe(true);expect(isDefinitiveCommandRejection(c as never,'COMMAND_COMMIT_FAILED')).toBe(false);
});
it('locks fps when earlier operations in the same batch inserted content',()=>{
 const t=draft(),clip=t.videoClips[0]!;t.videoClips=[];expect(applyTimelineOps(t,[{kind:'insert',clip},{kind:'setSettings',settings:{...settings,fps:{num:24,den:1}}}])).toMatchObject({ok:false,error:{code:'FPS_LOCKED'}});
});
it('splits frozen trashed media while rejecting new choices of that trashed asset',async()=>{
 const {e,root,projectId}=await setup();const ref=await image(e,root),m=unwrap(e.assets.metadata(ref));unwrap(await e.commands.execute(command(e,'timeline.create',create(projectId))));const clip={id:'v',kind:'image',media:ref,sourceHash:m.hash,sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:480000,fit:'contain',gainMilli:1000,mute:true};
 unwrap(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'insert',clip}]})));unwrap(await e.commands.execute(command(e,'asset.trash',{assetId:ref.assetId,expectedRevision:1})));
 expect(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:2,operations:[{kind:'split',clipId:'v',atTicks:240000,operationId:'split'}]}))).toMatchObject({ok:true,value:{result:{revision:3,videoClips:[{sourceInTicks:0},{sourceInTicks:0}]}}});
 expect(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:3,operations:[{kind:'insert',clip:{...clip,id:'new',startTicks:480000}}]}))).toMatchObject({ok:false,error:{code:'ASSET_TRASHED'}});
});
it('validates query/event outputs and retains history after reopen',async()=>{
 const {e,root,projectId}=await setup();const cursor=unwrap(e.events.read({libraryId:e.identity.libraryId,connectionEpoch:'fixture'})).cursor;
 unwrap(await e.commands.execute(command(e,'timeline.create',create(projectId))));
 const read=e.commands.query({...command(e,'timeline.read',{projectId,timelineId:'cut'}),queryId:'read'});expect(read.ok&&queryOutputValidators['timeline.read'](read.value)).toBe(true);
 const events=unwrap(e.events.read({libraryId:e.identity.libraryId,connectionEpoch:'fixture',cursor}));expect(events.events).toHaveLength(1);expect(events.events.every(isDomainEvent)).toBe(true);expect(queryOutputValidators['timeline.read']({...(read.ok ? read.value as Record<string,unknown> : {}),videoClips:[{sourceHash:'fake'}]})).toBe(false);
 await e.close();const {startEngine}=await import('../../packages/engine/src/bootstrap.ts');const reopened=unwrap(await startEngine({root}));try{expect(reopened.commands.query({...command(reopened,'timeline.read',{projectId,timelineId:'cut'}),queryId:'read'})).toEqual(read);}finally{await reopened.close();}
});
it('inserts fixed images, validates the whole batch and locks fps on nonempty timelines',async()=>{
 const {e,root,projectId}=await setup();const ref=await image(e,root),m=unwrap(e.assets.metadata(ref));unwrap(await e.commands.execute(command(e,'timeline.create',create(projectId))));
 const clip={id:'v',kind:'image',media:ref,sourceHash:m.hash,sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:480000,fit:'contain',gainMilli:1000,mute:true};
 expect(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'insert',clip},{kind:'insert',clip:{...clip,id:'overlap'}}]}))).toMatchObject({ok:false});
 expect(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'insert',clip}]}))).toMatchObject({ok:true,value:{result:{revision:2}}});
 expect(await e.commands.execute(command(e,'timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:2,operations:[{kind:'setSettings',settings:{...settings,fps:{num:25,den:1}}}]}))).toMatchObject({ok:false,error:{code:'FPS_LOCKED'}});
});
it('has safe integer clocks and exact ripple trims with stable derived ids',async()=>{
 const time=await import('../../packages/domain/src/timeline-time.ts').catch(()=>null);expect(time).not.toBeNull();if(!time)return;
 expect([30,25,24].map(n=>time.frameTicks(n))).toEqual([1600,1920,2000]);expect(()=>time.frameTicks(29.97)).toThrow();
 const edit=await import('../../packages/domain/src/timeline-edit.ts');
 const draft={libraryId:'lib',projectId:'p',id:'cut',revision:1,scriptRef:{id:'s',revision:1},title:'Cut',fps:{num:30,den:1},timebase:48000,canvas:{width:1920,height:1080},videoClips:[{id:'v',kind:'video',media:{kind:'artifact',libraryId:'lib',artifactId:'a'},sourceHash:'a'.repeat(64),sourceProbeId:'probe',sourceInTicks:0,startTicks:480000,durationTicks:240000,fit:'contain',gainMilli:1000,mute:true}],audioClips:[{id:'bgm',kind:'audio',track:'music',media:{kind:'artifact',libraryId:'lib',artifactId:'b'},sourceHash:'b'.repeat(64),sourceProbeId:'probe2',sourceInTicks:0,startTicks:0,durationTicks:1440000,gainMilli:1000,mute:false}],subtitleCues:[{id:'cue',startTicks:432000,endTicks:528000,text:'原文'}],subtitleStyle:{fontId:'noto-sans-cjk-sc',fontSize:48,color:'#ffffff',bottomMargin:60,outline:2},createdAt:'2026-01-01T00:00:00Z'} as const;
 const result=edit.applyTimelineOps(draft as never,[{kind:'rippleDelete',clipId:'v',operationId:'op'}]);
 expect(result).toMatchObject({ok:true,value:{videoClips:[],audioClips:[{id:'bgm',startTicks:0,durationTicks:480000},{startTicks:480000,durationTicks:720000,sourceInTicks:720000}],subtitleCues:[{startTicks:432000,endTicks:480000,text:'原文'}]}});
 expect(edit.applyTimelineOps(draft as never,[{kind:'rippleDelete',clipId:'v',operationId:'op'}])).toEqual(result);expect(draft.audioClips[0].durationTicks).toBe(1440000);
 expect(edit.applyTimelineOps(draft as never,[{kind:'move',clipId:'v',startTicks:Number.MAX_SAFE_INTEGER}])).toMatchObject({ok:false});
});
