import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {startEngine} from '../../packages/engine/src/bootstrap.ts';
import {engines} from './timeline-fixtures.ts';
import {afterEach,expect,it} from 'vitest';
import {isTimelineRevision,parsePrepareAssembly,DEFAULT_SUBTITLE_STYLE,MAX_TIMELINE_TICKS} from '../../packages/contracts/src/timeline.ts';
import {setup,cleanup,create,command,unwrap,image,settings,shot} from './timeline-fixtures.ts';
afterEach(cleanup);
const ref={kind:'assetVersion' as const,libraryId:'library',assetId:'asset',version:1};
const picture=(i:number)=>({id:'v'+i,kind:'image' as const,media:ref,sourceHash:'a'.repeat(64),sourceProbeId:null,sourceInTicks:0,startTicks:i*48000,durationTicks:48000,gainMilli:1000,mute:true,fit:'contain' as const});
const sound=(i:number,track:'voice'|'music')=>({...picture(i),id:track+i,kind:'audio' as const,sourceProbeId:'probe',track});
function timeline(n:number){return {libraryId:'library',projectId:'project',id:'cut',revision:1,scriptRef:{id:'script',revision:1},title:'Dense',...settings,timebase:48000,videoClips:Array.from({length:n},(_,i)=>picture(i)),audioClips:[],subtitleCues:[],subtitleStyle:DEFAULT_SUBTITLE_STYLE,createdAt:'2026-11-01T00:00:00Z'};}
it('accepts 65/128/256 pictures and rejects 257 without changing time and byte boundaries',()=>{
 for(const n of [64,65,128,256])expect(isTimelineRevision(timeline(n))).toBe(true);
 expect(isTimelineRevision(timeline(257))).toBe(false);
 const t=timeline(1);t.videoClips[0]!.durationTicks=MAX_TIMELINE_TICKS;expect(isTimelineRevision(t)).toBe(true);
 t.videoClips[0]!.durationTicks+=1600;expect(isTimelineRevision(t)).toBe(false);
 expect(isTimelineRevision({...timeline(1),title:'x'.repeat(1024*1024)})).toBe(false);
});
it('accepts 256 clips independently on each audio track and rejects 257',()=>{
 for(const track of ['voice','music'] as const)for(const n of [128,129,256,257]){
  const audio=Array.from({length:n},(_,i)=>sound(i,track)).map(({fit,...c})=>c);
  expect(isTimelineRevision({...timeline(1),audioClips:audio})).toBe(n<=256);
 }
});
it('accepts 256 fixed assembly inputs but never truncates 257',()=>{
 const input={projectId:'project',scriptRef:{id:'script',revision:1},shots:Array.from({length:256},(_,i)=>({id:'shot'+i,revision:1,selectionRevision:1})),target:{id:'cut',expectedRevision:0},allowImages:true,settings,executionOwner:'human',runId:'run'};
 expect(parsePrepareAssembly(input).ok).toBe(true);expect(parsePrepareAssembly({...input,shots:[...input.shots,{id:'extra',revision:1,selectionRevision:1}]})).toMatchObject({ok:false,error:{code:'TIMELINE_CAPACITY_EXCEEDED',message:expect.stringContaining('256')}});
});
it('persists 256 clips in bounded edits and atomically refuses the next insert or split',async()=>{
 const f=await setup(),r=await image(f.e,f.root),hash=unwrap(f.e.assets.metadata(r)).hash;
 unwrap(await f.e.commands.execute(command(f.e,'timeline.create',create(f.projectId))));
 let revision=1;
 for(let i=0;i<256;i+=64){
  const operations=Array.from({length:Math.min(64,256-i)},(_,j)=>({kind:'insert',clip:{...picture(i+j),media:r,sourceHash:hash}}));
  unwrap(await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:revision,operations})));revision++;
 }
 const next=await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:revision,operations:[{kind:'insert',clip:{...picture(256),media:r,sourceHash:hash}}]}));expect(next.ok).toBe(false);
 const read=unwrap(f.e.timelines.read({projectId:f.projectId,timelineId:'cut'}));expect(read.revision).toBe(revision);expect(read.videoClips).toHaveLength(256);
 const split=await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:revision,operations:[{kind:'split',clipId:'v0',atTicks:24000,operationId:'split-overflow'}]}));expect(split.ok).toBe(false);expect(unwrap(f.e.timelines.read({projectId:f.projectId,timelineId:'cut'}))).toEqual(read);
});

it('upgrades a populated schema27 fixture without rewriting timeline JSON',async()=>{
 const f=await setup();unwrap(await f.e.commands.execute(command(f.e,'timeline.create',create(f.projectId))));unwrap(await f.e.close());
 const db=new DatabaseSync(join(f.root,'library.sqlite'));const before=db.prepare('SELECT data_json FROM timeline_revision').all();db.exec('DELETE FROM migration_log WHERE version=28; UPDATE library SET schema_version=27; PRAGMA user_version=27');db.close();
 const reopened=unwrap(await startEngine({root:f.root}));engines.push(reopened);expect(reopened.identity.schemaVersion).toBe(28);
 const read=new DatabaseSync(join(f.root,'library.sqlite'),{readOnly:true});try{expect(read.prepare('SELECT data_json FROM timeline_revision').all()).toEqual(before);expect(read.prepare('PRAGMA foreign_key_check').all()).toEqual([]);}finally{read.close();}
 expect((await readdir(join(f.root,'backups'))).some(p=>p.startsWith('schema-27-'))).toBe(true);
});

it('stores 256 shots for one script and refuses a 257th without changing existing revisions',async()=>{
 const f=await setup();
 for(let i=0;i<256;i++)unwrap(await f.e.commands.execute(command(f.e,'creation.saveShot',shot(f.projectId,'shot-'+i,{order:i}))));
 const before=unwrap(f.e.creation.read({projectId:f.projectId}));
 expect(before.shots).toHaveLength(256);expect(await f.e.commands.execute(command(f.e,'creation.saveShot',shot(f.projectId,'shot-256',{order:256})))).toMatchObject({ok:false,error:{code:'SHOT_LIMIT',message:expect.stringContaining('256')}});
 expect(unwrap(f.e.creation.read({projectId:f.projectId}))).toEqual(before);
},30000);
