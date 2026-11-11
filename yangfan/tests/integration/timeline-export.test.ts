import { afterEach, expect, it } from 'vitest';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, symlink, link, readdir, rm, rmdir, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';
import { startEngine } from '../../packages/engine/src/bootstrap.ts';
import { setupRender } from './render-fixtures.ts';
import { engines } from './timeline-fixtures.ts';
import { join } from 'node:path';
import { cleanup, setup, create, command, unwrap, image, shot } from './timeline-fixtures.ts';
import { timelineExporter } from '../../apps/desktop/src/main/timeline-export.ts';
import { timelineSrt, timelineCsv } from '../../packages/domain/src/timeline-export-format.ts';
import { isExportTimelineInput, isExportSnapshot, isExportReceipt, isExportOutcome, exportRelativePath, exportPolicy } from '../../packages/contracts/src/timeline-export.ts';
import { isTimelineRevision } from '../../packages/contracts/src/timeline.ts';
const unzip=createRequire(import.meta.url)('unzipper') as {Open:{buffer(bytes:Buffer):Promise<{files:{path:string;crc32:number;uncompressedSize:number;buffer():Promise<Buffer>}[]}>}};
afterEach(cleanup);
async function fixture() {
 const f=await setup(); const ref=await image(f.e,f.root); const hash=unwrap(f.e.assets.metadata(ref)).hash;
 unwrap(await f.e.commands.execute(command(f.e,'timeline.create',create(f.projectId))));
 unwrap(await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'insert',clip:{id:'clip',kind:'image',media:ref,sourceHash:hash,sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:48000,fit:'contain',gainMilli:1000,mute:true}},{kind:'setCue',cue:{id:'cue',startTicks:1600,endTicks:48000,text:'=中文,对白'}}]})));
 const root=join(f.root,'中文 空格');await mkdir(root);const binding={root,libraryId:f.e.identity.libraryId,projectId:f.projectId};
 const input={requestId:randomUUID(),projectId:f.projectId,timelineId:'cut',revision:2,kind:'srt' as const};
 return {...f,ref,hash,binding,input,exporter:timelineExporter(f.e.exports,f.e.assets)};
}
it('exports the exact old revision with stable receipt identity and strict bounded input',async()=>{
 const f=await fixture();expect(isExportTimelineInput({...f.input,path:'escape'})).toBe(false);expect(isExportTimelineInput({...f.input,requestId:'filename'})).toBe(false);
 const first=unwrap(await f.exporter.exportTimeline(f.binding,f.input));expect(first.state).toBe('completed');expect(first.relativePath).toMatch(/^exports\/subtitles\/cut-r2-[a-f0-9-]+\.srt$/);
 expect(await readFile(join(f.binding.root,first.relativePath),'utf8')).toBe('1\n00:00:00,033 --> 00:00:01,000\n=中文,对白\n');
 unwrap(await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:2,operations:[{kind:'setCue',cue:{id:'cue',startTicks:0,endTicks:48000,text:'changed'}}]})));
 expect(unwrap(await f.exporter.exportTimeline(f.binding,f.input))).toEqual(first);
 expect(await f.exporter.exportTimeline(f.binding,{...f.input,revision:3})).toMatchObject({ok:false,error:{code:'COMMAND_ID_REUSED'}});
 const snapshot=unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'}));expect(isExportSnapshot(snapshot)).toBe(true);expect(snapshot.exports).toEqual([first]);
});
it('rejects foreign project/revision/job and never invokes rendering on export failure',async()=>{
 const f=await fixture();for(const input of [{...f.input,projectId:'foreign'},{...f.input,requestId:randomUUID(),revision:9},{...f.input,requestId:randomUUID(),kind:'mp4',renderJobId:'not-a-job'},{...f.input,kind:'mp4'}])expect((await f.exporter.exportTimeline(f.binding,input)).ok).toBe(false);
});
it('refuses existing regular files, hardlinks and directory junctions without overwriting',async()=>{
 const f=await fixture();const prepared=unwrap(await f.e.exports.prepareExport(f.input));await mkdir(join(f.binding.root,'exports','subtitles'),{recursive:true});const target=join(f.binding.root,prepared.receipt.relativePath);await writeFile(target,'keep');
 expect((await f.exporter.exportTimeline(f.binding,f.input)).ok).toBe(false);expect(await readFile(target,'utf8')).toBe('keep');await rm(target);
 const outside=join(f.root,'outside');await mkdir(outside);const source=join(outside,'keep');await writeFile(source,'hard');await link(source,target);expect((await f.exporter.exportTimeline(f.binding,f.input)).ok).toBe(false);expect(await readFile(source,'utf8')).toBe('hard');await rm(target);await rmdir(join(f.binding.root,'exports','subtitles'));await symlink(outside,join(f.binding.root,'exports','subtitles'),'junction');expect((await f.exporter.exportTimeline(f.binding,f.input)).ok).toBe(false);expect(await readdir(outside)).toEqual(['keep']);
});
it('recovers a published file after a lost database acknowledgement using the original verified hash',async()=>{
 const f=await fixture();let lose=true;const records={...f.e.exports,recordExportOutcome:async(input:any)=>{if(input.state==='completed'&&lose){lose=false;return {ok:false as const,error:{code:'ENGINE_DISCONNECTED',message:'lost'}};}return f.e.exports.recordExportOutcome(input);}};
 const publisher=timelineExporter(records,f.e.assets);expect((await publisher.exportTimeline(f.binding,f.input)).ok).toBe(false);
 const pending=unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!;expect(pending.state).toBe('verified');
 const recovered=unwrap(await publisher.exportTimeline(f.binding,f.input));expect(recovered.state).toBe('completed');expect(recovered.exportId).toBe(pending.exportId);expect(unwrap(await publisher.exportTimeline(f.binding,f.input))).toEqual(recovered);
});
it('streams a deduplicated ZIP of original fixed bytes and a safe hash manifest',async()=>{
 const f=await fixture();const result=unwrap(await f.exporter.exportTimeline(f.binding,{...f.input,kind:'sources'}));const bytes=await readFile(join(f.binding.root,result.relativePath));expect(bytes.readUInt32LE(0)).toBe(0x04034b50);expect(bytes.includes(Buffer.from(f.hash))).toBe(true);expect(bytes.includes(Buffer.from(f.root))).toBe(false);expect(result.hash).toBe(createHash('sha256').update(bytes).digest('hex'));expect(bytes.toString().match(/original-0001\.png/g)?.length).toBe(3);
});
it('round-trips source ZIP through the independent unzipper reader and detects corrupt CRC',async()=>{
 const f=await fixture();const result=unwrap(await f.exporter.exportTimeline(f.binding,{...f.input,kind:'sources'}));const bytes=await readFile(join(f.binding.root,result.relativePath)),archive=await unzip.Open.buffer(bytes);expect(archive.files.map(x=>x.path)).toEqual(['manifest.json','original-0001.png']);
 for(const file of archive.files){const data=await file.buffer();expect(data.length).toBe(file.uncompressedSize);expect(crc32(data)).toBe(file.crc32);if(file.path.endsWith('.png'))expect(createHash('sha256').update(data).digest('hex')).toBe(f.hash);}
 const corrupted=Buffer.from(bytes),entry=archive.files[1]!,original=await entry.buffer(),at=corrupted.indexOf(original);expect(at).toBeGreaterThan(0);corrupted[at]=corrupted[at]!^1;const bad=await unzip.Open.buffer(corrupted),badData=await bad.files[1]!.buffer();expect(crc32(badData)).not.toBe(bad.files[1]!.crc32);
});
it('recovers the atomic-link crash window using only the journaled private temporary inode',async()=>{
 const f=await fixture(),p=unwrap(await f.e.exports.prepareExport(f.input));await mkdir(join(f.binding.root,'exports','subtitles'),{recursive:true});const temporaryId=randomUUID(),temp=join(f.binding.root,'exports','subtitles',`.export-${p.receipt.exportId}-${temporaryId}.partial`),target=join(f.binding.root,p.receipt.relativePath),data=Buffer.from(timelineSrt(p.timeline));await writeFile(temp,data);const stat=await lstat(temp,{bigint:true}),fixed={id:temporaryId,dev:stat.dev.toString(),ino:stat.ino.toString()};unwrap(await f.e.exports.recordExportOutcome({requestId:f.input.requestId,exportId:p.receipt.exportId,state:'copying',hash:null,byteLength:0,errorCode:null,temporary:fixed}));unwrap(await f.e.exports.recordExportOutcome({requestId:f.input.requestId,exportId:p.receipt.exportId,state:'verified',hash:createHash('sha256').update(data).digest('hex'),byteLength:data.length,errorCode:null}));await link(temp,target);
 const result=unwrap(await f.exporter.exportTimeline(f.binding,f.input));expect(result.state).toBe('completed');expect((await lstat(target)).nlink).toBe(1);expect(await readdir(join(f.binding.root,'exports','subtitles'))).toEqual([target.split(/[/\\]/).at(-1)]);
});
it('persists cancellation, closes its lease, and never revives the same request',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);let open=0,closed=0;
 const io={...f.e.assets,openMediaRead:async(ref:any,hash?:string)=>{open++;return f.e.assets.openMediaRead(ref,hash);},readMediaRange:async(input:any)=>{entered();await gate;return f.e.assets.readMediaRange(input);},closeMediaRead:async(id:string)=>{closed++;await f.e.assets.closeMediaRead(id);}};
 const publisher=timelineExporter(f.e.exports,io),input={...f.input,kind:'sources' as const},pending=publisher.exportTimeline(f.binding,input);await started;unwrap(await publisher.cancelTimelineExport({requestId:input.requestId}));release();expect(await pending).toMatchObject({ok:false,error:{code:'EXPORT_CANCELLED'}});expect(open).toBe(1);expect(closed).toBe(1);expect(unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!.state).toBe('cancelled');expect(unwrap(await f.exporter.exportTimeline(f.binding,input)).state).toBe('cancelled');
});
it('uses absolute rounded SRT endpoints and protects every CSV formula cell',async()=>{
 const f=await fixture();const t=unwrap(f.e.timelines.read({projectId:f.projectId,timelineId:'cut',revision:2}));expect(timelineSrt(t)).toContain('00:00:00,033 --> 00:00:01,000');expect(timelineCsv(t)).toContain("'=中文,对白");
});
it('keeps bounded sequential source reads behind awaited durable progress backpressure',async()=>{
 const f=await fixture(),path=join(f.root,'noise.png');const bytes=await sharp(randomBytes(1536*1536*3),{raw:{width:1536,height:1536,channels:3}}).png().toBuffer();await writeFile(path,bytes);const s=await lstat(path),grantId=randomUUID();unwrap(f.e.assets.registerGrant({grantId,importId:grantId,libraryId:f.e.identity.libraryId,expiresAt:Date.now()+60000,files:[{path,realPath:path,allowedRoot:f.root,name:'noise.png',size:s.size,mtimeMs:s.mtimeMs,dev:s.dev,ino:s.ino}]}));const imported=unwrap(await f.e.commands.execute(command(f.e,'asset.importGrantedFiles',{grantId}))).result as {versions:typeof f.ref[]};const ref=imported.versions[0]!,hash=unwrap(f.e.assets.metadata(ref)).hash;
 unwrap(await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:2,operations:[{kind:'replaceMedia',clipId:'clip',media:ref,sourceHash:hash,sourceProbeId:null,sourceInTicks:0,durationTicks:48000}]})));
 let reads=0,inFlight=0,max=0,release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);const io={...f.e.assets,readMediaRange:async(input:any)=>{expect(input.length).toBeLessThanOrEqual(1024*1024);reads++;inFlight++;max=Math.max(max,inFlight);try{return await f.e.assets.readMediaRange(input);}finally{inFlight--;}}};let gated=false;
 const records={...f.e.exports,recordExportOutcome:async(input:any)=>{if(!gated&&input.state==='copying'&&input.byteLength>=4*1024*1024){gated=true;entered();await gate;}return f.e.exports.recordExportOutcome(input);}};const publisher=timelineExporter(records,io),pending=publisher.exportTimeline(f.binding,{...f.input,revision:3,kind:'sources'});await started;expect(await publisher.exportTimeline(f.binding,{...f.input,revision:3,kind:'sources'})).toMatchObject({ok:false,error:{code:'EXPORT_BUSY'}});const before=reads;await new Promise(r=>setTimeout(r,20));expect(reads).toBe(before);release();const receipt=unwrap(await pending);expect(max).toBe(1);expect(reads).toBe(Math.ceil(bytes.length/(1024*1024)));expect(receipt.state).toBe('completed');const archive=await unzip.Open.buffer(await readFile(join(f.binding.root,receipt.relativePath)));expect(createHash('sha256').update(await archive.files[1]!.buffer()).digest('hex')).toBe(hash);
});
it('reopens durable copy receipts and recovers only matching destination bytes',async()=>{
 const f=await fixture();const prepared=unwrap(await f.e.exports.prepareExport(f.input));const result=unwrap(await f.exporter.exportTimeline(f.binding,f.input));await f.e.close();const reopened=unwrap(await startEngine({root:f.root}));engines.push(reopened);const publisher=timelineExporter(reopened.exports,reopened.assets);expect(unwrap(await publisher.exportTimeline(f.binding,f.input))).toEqual(result);expect(unwrap(reopened.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!.exportId).toBe(prepared.receipt.exportId);
});
it('exports genuine successful local job outputs and copy failure/retry never adds a render or provider task',async()=>{
 const f=await setupRender(),ref=await image(f.e,f.root),meta=unwrap(f.e.assets.metadata(ref));unwrap(await f.e.commands.execute(command(f.e,'timeline.create',create(f.projectId))));unwrap(await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:1,operations:[{kind:'insert',clip:{id:'image',kind:'image',media:ref,sourceHash:meta.hash,sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:4800,fit:'contain',gainMilli:1000,mute:true}}]})));
 const plan=unwrap(await f.e.renders.prepare({timelineRef:{libraryId:f.e.identity.libraryId,projectId:f.projectId,id:'cut',revision:2},purpose:'mp4',executionOwner:'user',runId:'export'})),job=unwrap(f.e.renders.enqueue({planId:plan.planId,planHash:plan.planHash,executionOwner:'user',runId:'export',diskBudgetBytes:plan.requiredFreeBytes}));f.e.renderScheduler.start();await f.e.renderScheduler.drain();const rendered=unwrap(f.e.renders.read({projectId:f.projectId,jobId:job.jobId}));expect(rendered.state).toBe('SUCCEEDED');
 const root=join(f.root,'disconnected'),binding={root,libraryId:f.e.identity.libraryId,projectId:f.projectId},input={requestId:randomUUID(),projectId:f.projectId,timelineId:'cut',revision:2,kind:'mp4' as const,renderJobId:job.jobId},publisher=timelineExporter(f.e.exports,f.e.assets);expect((await publisher.exportTimeline(binding,input)).ok).toBe(false);const failed=unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!;await mkdir(root);const result=unwrap(await publisher.exportTimeline(binding,input));expect(result.exportId).toBe(failed.exportId);const outputMeta=unwrap(f.e.assets.metadata(rendered.outputRef!));expect(result.hash).toBe(outputMeta.hash);expect(result.byteLength).toBe(outputMeta.byteLength);
 for(const changes of [{revision:1},{kind:'wav' as const},{projectId:'foreign'}])expect((await publisher.exportTimeline(binding,{...input,...changes,requestId:randomUUID()})).ok).toBe(false);const db=new DatabaseSync(join(f.root,'library.sqlite'));expect(db.prepare('SELECT COUNT(*) AS n FROM local_media_job').get()!.n).toBe(1);expect(db.prepare('SELECT COUNT(*) AS n FROM generation_task').get()!.n).toBe(0);db.close();
},30000);
it('reports missing fixed originals with bounded public errors and no final ZIP',async()=>{
 const f=await fixture();await rm(join(f.root,'objects',f.hash.slice(0,2),f.hash));const result=await f.exporter.exportTimeline(f.binding,{...f.input,kind:'sources'});expect(result.ok).toBe(false);const receipt=unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!;expect(receipt.state).toBe('failed');expect(receipt.errorCode).toMatch(/^[A-Z][A-Z0-9_]{0,95}$/);expect(JSON.stringify(receipt)).not.toContain(f.root);expect(await readdir(join(f.binding.root,'exports','packages'))).toEqual([]);
});
it('deduplicates archive bytes by original hash while retaining every exact reference in the manifest',async()=>{
 const f=await fixture(),other=await image(f.e,f.root),first=unwrap(f.e.timelines.read({projectId:f.projectId,timelineId:'cut',revision:2})).videoClips[0]!;unwrap(await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:2,operations:[{kind:'insert',clip:{...first,id:'second',media:other,startTicks:48000}}]})));
 const receipt=unwrap(await f.exporter.exportTimeline(f.binding,{...f.input,kind:'sources',revision:3})),archive=await unzip.Open.buffer(await readFile(join(f.binding.root,receipt.relativePath)));expect(archive.files.map(f=>f.path)).toEqual(['manifest.json','original-0001.png']);const manifest=JSON.parse((await archive.files[0]!.buffer()).toString());expect(manifest.sources.map((s:any)=>s.ref)).toEqual([f.ref,other]);expect(new Set(manifest.sources.map((s:any)=>s.filename)).size).toBe(1);
});
it('drains cancelled exports and closes their read lease before main shutdown',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);let closed=false;const io={...f.e.assets,readMediaRange:async(input:any)=>{entered();await gate;return f.e.assets.readMediaRange(input);},closeMediaRead:async(id:string)=>{await f.e.assets.closeMediaRead(id);closed=true;}};
 const publisher=timelineExporter(f.e.exports,io),pending=publisher.exportTimeline(f.binding,{...f.input,kind:'sources'});await started;try{const closing=publisher.close();expect(closing).toBeInstanceOf(Promise);release();await closing;expect(closed).toBe(true);expect(await pending).toMatchObject({ok:false,error:{code:'EXPORT_CANCELLED'}});}finally{release();await pending;}
});
it('refuses tampered destination bytes after a lost acknowledgement and preserves the original expected hash',async()=>{
 const f=await fixture(),records={...f.e.exports,recordExportOutcome:async(input:any)=>input.state==='completed'?{ok:false as const,error:{code:'ENGINE_DISCONNECTED',message:'lost'}}:f.e.exports.recordExportOutcome(input)};expect((await timelineExporter(records,f.e.assets).exportTimeline(f.binding,f.input)).ok).toBe(false);const saved=unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!,target=join(f.binding.root,saved.relativePath),original=await readFile(target);await writeFile(target,Buffer.alloc(original.length,65));expect(await f.exporter.exportTimeline(f.binding,f.input)).toMatchObject({ok:false,error:{code:'EXPORT_VERIFY_FAILED'}});expect(await readFile(target)).toEqual(Buffer.alloc(original.length,65));expect(unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!.hash).toBe(saved.hash);await writeFile(target,original);expect(unwrap(await f.exporter.exportTimeline(f.binding,f.input)).exportId).toBe(saved.exportId);
});
it('bounds output receipts by exact format limits and refuses forged paths or oversized source chunks',async()=>{
 const f=await fixture(),p=unwrap(await f.e.exports.prepareExport({...f.input,kind:'sources'}));for(const kind of ['mp4','wav','sources'] as const){const input={...f.input,kind,...(kind==='sources'?{}:{renderJobId:'job'})},receipt={...p.receipt,...input,relativePath:exportRelativePath(input,p.receipt.exportId),byteLength:exportPolicy[kind].cap};expect(isExportReceipt(receipt)).toBe(true);expect(isExportReceipt({...receipt,byteLength:receipt.byteLength+1})).toBe(false);}expect(isExportOutcome({requestId:f.input.requestId,exportId:p.receipt.exportId,state:'completed',hash:f.hash,byteLength:1,errorCode:null,path:'outside'})).toBe(false);
 let closed=false;const io={...f.e.assets,readMediaRange:async(input:any)=>({ok:true as const,value:{leaseId:input.leaseId,offset:input.offset,eof:false,bytes:new Uint8Array(1024*1024+1)}}),closeMediaRead:async(id:string)=>{closed=true;await f.e.assets.closeMediaRead(id);}};expect(await timelineExporter(f.e.exports,io).exportTimeline(f.binding,{...f.input,kind:'sources'})).toMatchObject({ok:false,error:{code:'EXPORT_SOURCE_INVALID'}});expect(closed).toBe(true);expect(await readdir(join(f.binding.root,'exports','packages'))).toEqual([]);
});
it('freezes exact storyboard dialogue separately from timeline subtitles even when the shot later changes',async()=>{
 const f=await fixture();unwrap(await f.e.commands.execute(command(f.e,'creation.saveShot',shot(f.projectId,'shot',{dialogue:'=旧对白，固定一版'}))));const t=unwrap(f.e.timelines.read({projectId:f.projectId,timelineId:'cut',revision:2}));unwrap(await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:2,operations:[{kind:'delete',clipId:'clip'},{kind:'delete',clipId:'cue'},{kind:'insert',clip:{...t.videoClips[0],id:'fixed',provenance:{shotId:'shot',shotRevision:1,selectionRevision:0,productionId:null,productionShotRevision:null}}}]})));
 const input={...f.input,kind:'csv' as const,revision:3};unwrap(await f.e.exports.prepareExport(input));unwrap(await f.e.commands.execute(command(f.e,'creation.saveShot',shot(f.projectId,'shot',{expectedRevision:1,dialogue:'NEW CURRENT DIALOGUE'}))));const receipt=unwrap(await f.exporter.exportTimeline(f.binding,input)),csv=await readFile(join(f.binding.root,receipt.relativePath),'utf8');expect(csv).toContain('storyboard_dialogue_fixed_revision');expect(csv).toContain('timeline_subtitles');expect(csv).toContain("'=旧对白，固定一版");expect(csv).not.toContain('NEW CURRENT DIALOGUE');expect(csv).not.toContain('=中文,对白');
});
it('exports a valid large CSV using <=1 MiB writes rather than treating a text buffer as one media block',async()=>{
 const f=await fixture(),input={...f.input,kind:'csv' as const},p=unwrap(await f.e.exports.prepareExport(input)),clip=p.timeline.videoClips[0]!;p.timeline.videoClips=Array.from({length:64},(_,i)=>({...clip,id:'v'+i,startTicks:i*76800,durationTicks:76800,provenance:{shotId:'s'+i,shotRevision:1,selectionRevision:0,productionId:null,productionShotRevision:null}}));p.timeline.subtitleCues=Array.from({length:1000},(_,i)=>({id:'q'+i,startTicks:i*4800,endTicks:(i+1)*4800,text:'😀'.repeat(200)}));p.storyboard=p.timeline.videoClips.map(c=>({clipId:c.id,shotId:c.provenance!.shotId,shotRevision:1,dialogue:'中'.repeat(2000)}));p.snapshotHash=createHash('sha256').update(JSON.stringify({timeline:p.timeline,sources:p.sources,storyboard:p.storyboard,output:p.output})).digest('hex');expect(isTimelineRevision(p.timeline)).toBe(true);const csv=timelineCsv(p.timeline,p.storyboard);expect(Buffer.byteLength(csv)).toBeGreaterThan(1024*1024);const records={...f.e.exports,prepareExport:async()=>({ok:true as const,value:p})};const result=unwrap(await timelineExporter(records,f.e.assets).exportTimeline(f.binding,input));expect(await readFile(join(f.binding.root,result.relativePath),'utf8')).toBe(csv);
});

it('does not revive a cancelled verified export after reopening the same request',async()=>{
 const f=await fixture();let publisher:ReturnType<typeof timelineExporter>;
 const records={...f.e.exports,recordExportOutcome:async(input:any)=>{const r=await f.e.exports.recordExportOutcome(input);if(input.state==='verified')void publisher.cancelTimelineExport({requestId:input.requestId});return r;}};
 publisher=timelineExporter(records,f.e.assets);
 expect((await publisher.exportTimeline(f.binding,f.input)).ok).toBe(false);
 const cancelled=unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!;
 expect(cancelled.state).toBe('cancelled');
 const next=unwrap(await timelineExporter(f.e.exports,f.e.assets).exportTimeline(f.binding,f.input));
 expect(next.state).toBe('cancelled');
 expect(await lstat(join(f.binding.root,cancelled.relativePath)).then(()=>true,()=>false)).toBe(false);
});
it('reopens an expired fixed source lease and keeps the original error when close fails',async()=>{
 const f=await fixture();let opened=0,expired=true;
 const io={openMediaRead:async(...a:Parameters<typeof f.e.assets.openMediaRead>)=>{opened++;return f.e.assets.openMediaRead(...a);},readMediaRange:async(input:any)=>{if(expired){expired=false;return {ok:false as const,error:{code:'MEDIA_LEASE_EXPIRED',message:'expired'}};}return f.e.assets.readMediaRange(input);},closeMediaRead:(id:string)=>f.e.assets.closeMediaRead(id)};
 expect(unwrap(await timelineExporter(f.e.exports,io).exportTimeline(f.binding,{...f.input,kind:'sources'})).state).toBe('completed');expect(opened).toBe(2);
 let nearExpiry=0;const renew={...io,openMediaRead:async(...a:Parameters<typeof f.e.assets.openMediaRead>)=>{nearExpiry++;const r=await f.e.assets.openMediaRead(...a);return r.ok&&nearExpiry===1?{ok:true as const,value:{...r.value,expiresAt:Date.now()+44000}}:r;}};expect(unwrap(await timelineExporter(f.e.exports,renew).exportTimeline(f.binding,{...f.input,requestId:randomUUID(),kind:'sources'})).state).toBe('completed');expect(nearExpiry).toBe(2);
 const before=opened,alwaysExpired={...io,readMediaRange:async()=>({ok:false as const,error:{code:'MEDIA_LEASE_EXPIRED',message:'expired'}})};expect(await timelineExporter(f.e.exports,alwaysExpired).exportTimeline(f.binding,{...f.input,requestId:randomUUID(),kind:'sources'})).toMatchObject({ok:false,error:{code:'MEDIA_LEASE_EXPIRED'}});expect(opened-before).toBe(2);
 const bad={...io,readMediaRange:async()=>({ok:false as const,error:{code:'MEDIA_READ_FAILED',message:'read'}}),closeMediaRead:async(id:string)=>{await f.e.assets.closeMediaRead(id);throw Error('CLOSE_FAILED');}};
 expect(await timelineExporter(f.e.exports,bad).exportTimeline(f.binding,{...f.input,requestId:randomUUID(),kind:'sources'})).toMatchObject({ok:false,error:{code:'MEDIA_READ_FAILED'}});
});
it('does not downgrade a committed verified receipt when its acknowledgement times out',async()=>{
 const f=await fixture();let lost=false;
 const records={...f.e.exports,recordExportOutcome:async(input:any)=>{const r=await f.e.exports.recordExportOutcome(input);if(input.state==='verified'&&!lost){lost=true;return {ok:false as const,error:{code:'ENGINE_REQUEST_TIMEOUT',message:'lost ack'}};}return r;}};
 const p=timelineExporter(records,f.e.assets);expect((await p.exportTimeline(f.binding,f.input)).ok).toBe(false);
 expect(unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!.state).toBe('verified');
 expect(unwrap(await p.exportTimeline(f.binding,f.input)).state).toBe('completed');
});

it('stops a pending copy acknowledgement on cancel and never publishes after its late reply',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const records={...f.e.exports,recordExportOutcome:async(input:any)=>{if(input.state==='copying'){entered();await gate;}return f.e.exports.recordExportOutcome(input);}};
 const publisher=timelineExporter(records,f.e.assets),pending=publisher.exportTimeline(f.binding,f.input);await started;
 try{const stopping=publisher.cancelTimelineExport({requestId:f.input.requestId});expect(await Promise.race([stopping.then(()=>true),new Promise<boolean>(r=>setTimeout(()=>r(false),200))])).toBe(true);expect(await pending).toMatchObject({ok:false,error:{code:'EXPORT_CANCELLED'}});}
 finally{release();await pending;await publisher.close();}
 const p=unwrap(await f.e.exports.prepareExport(f.input));expect(p.receipt.state).toBe('cancelled');expect(await lstat(join(f.binding.root,p.receipt.relativePath)).then(()=>true,()=>false)).toBe(false);
});

it('reconciles a cancelled atomic-link crash window only when the target is this operation inode',async()=>{
 const f=await fixture(),p=unwrap(await f.e.exports.prepareExport(f.input));await mkdir(join(f.binding.root,'exports','subtitles'),{recursive:true});
 const id=randomUUID(),temp=join(f.binding.root,'exports','subtitles',`.export-${p.receipt.exportId}-${id}.partial`),target=join(f.binding.root,p.receipt.relativePath),data=Buffer.from(timelineSrt(p.timeline));await writeFile(temp,data);const st=await lstat(temp,{bigint:true}),hash=createHash('sha256').update(data).digest('hex');
 unwrap(await f.e.exports.recordExportOutcome({requestId:f.input.requestId,exportId:p.receipt.exportId,state:'copying',hash:null,byteLength:0,errorCode:null,temporary:{id,dev:st.dev.toString(),ino:st.ino.toString()}}));
 unwrap(await f.e.exports.recordExportOutcome({requestId:f.input.requestId,exportId:p.receipt.exportId,state:'verified',hash,byteLength:data.length,errorCode:null}));await link(temp,target);unwrap(await f.e.exports.cancelExport({requestId:f.input.requestId}));
 expect(unwrap(await f.exporter.exportTimeline(f.binding,f.input))).toMatchObject({state:'completed',hash});expect((await lstat(target)).nlink).toBe(1);
 unwrap(await f.exporter.cancelTimelineExport({requestId:f.input.requestId}));expect(unwrap(f.e.exports.list({projectId:f.projectId,timelineId:'cut'})).exports[0]!.state).toBe('completed');
});

it('cleans a journaled unpublished partial after a cancelled process crash without restarting copying',async()=>{
 const f=await fixture(),p=unwrap(await f.e.exports.prepareExport(f.input));await mkdir(join(f.binding.root,'exports','subtitles'),{recursive:true});const id=randomUUID(),temp=join(f.binding.root,'exports','subtitles',`.export-${p.receipt.exportId}-${id}.partial`);await writeFile(temp,'cancelled partial');const st=await lstat(temp,{bigint:true});
 unwrap(await f.e.exports.recordExportOutcome({requestId:f.input.requestId,exportId:p.receipt.exportId,state:'copying',hash:null,byteLength:0,errorCode:null,temporary:{id,dev:st.dev.toString(),ino:st.ino.toString()}}));unwrap(await f.e.exports.cancelExport({requestId:f.input.requestId}));
 expect(unwrap(await f.exporter.exportTimeline(f.binding,f.input)).state).toBe('cancelled');expect(await lstat(temp).then(()=>true,()=>false)).toBe(false);expect(await lstat(join(f.binding.root,p.receipt.relativePath)).then(()=>true,()=>false)).toBe(false);
});
