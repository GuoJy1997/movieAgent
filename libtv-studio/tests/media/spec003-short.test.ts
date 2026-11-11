import{segmentRenderPlan}from'../../packages/engine/src/media/render-segments.ts';
import type{TimelineOp}from'../../packages/contracts/src/timeline.ts';
import {expect,it} from 'vitest';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';import{resolve,join}from'node:path';import{randomUUID,createHash}from'node:crypto';import{spawnSync}from'node:child_process';
import{renderSingleMedia}from'../../packages/engine/src/media/compile.ts';
import{seedCapacityProject,value}from'../fixtures/timeline-capacity-media.ts';import{loadMediaRuntime}from'../../packages/engine/src/media/manifest.ts';import{startEngine}from'../../packages/engine/src/bootstrap.ts';import{timelineExporter}from'../../apps/desktop/src/main/timeline-export.ts';
it('renders and exports a real 33-picture/33-voice timeline with subtitles through bounded segments',async()=>{
 const evidence=resolve('D:/movieAgent/verification/2026-11-01-spec003/short-real-'+randomUUID());await mkdir(evidence,{recursive:true});
 const seed=await seedCapacityProject(evidence,33,1600,33),runtime=value(await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64'))),e=value(await startEngine({root:seed.libraryRoot,runtime}));const exporter=timelineExporter(e.exports,e.assets);value(e.renderScheduler.start());
 const original=value(e.timelines.read({projectId:seed.projectId,timelineId:'cut'}));const operations=original.videoClips.flatMap<TimelineOp>((c,i)=>i===0?[{kind:'trim',clipId:c.id,sourceInTicks:0,durationTicks:40*1600}]:[{kind:'move',clipId:c.id,startTicks:(i+40)*1600}]);operations.push({kind:'setCue',cue:{id:'cross-segment',startTicks:28*1600,endTicks:32*1600,text:'跨段字幕与固定声音验收'}});const changed=value(await e.commands.execute({schemaVersion:1,libraryId:seed.libraryId,connectionEpoch:'test',commandId:randomUUID(),kind:'timeline.applyOps',payload:{projectId:seed.projectId,timelineId:'cut',expectedRevision:original.revision,operations}})).result as typeof original;seed.revision=changed.revision;seed.durationTicks=73*1600;
 try{
  const outputs:any[]=[];const comparisons:any[]=[];const segmentation:any[]=[];for(const purpose of ['mp4','wav'] as const){
   const p=value(await e.renders.prepare({timelineRef:{libraryId:seed.libraryId,projectId:seed.projectId,id:'cut',revision:seed.revision},purpose,executionOwner:'capacity-test',runId:randomUUID()}));
   const windows=value(segmentRenderPlan(p));segmentation.push({purpose,cues:p.timeline.subtitleCues,windows:windows.map(w=>({startTicks:w.startTicks,endTicks:w.endTicks}))});expect(windows.some(w=>p.timeline.subtitleCues.some(c=>c.startTicks<w.endTicks&&c.endTicks>w.endTicks))).toBe(true);
   const j=value(e.renders.enqueue({planId:p.planId,planHash:p.planHash,executionOwner:p.executionOwner,runId:p.runId,diskBudgetBytes:p.requiredFreeBytes}));
   const end=Date.now()+120000;for(;;){const job=value(e.renders.read({projectId:seed.projectId,jobId:j.jobId}));if(job.state==='SUCCEEDED')break;if(['FAILED','CANCELLED','INTERRUPTED'].includes(job.state))throw Error(JSON.stringify(job));if(Date.now()>end)throw Error('render timed out');await new Promise(r=>setTimeout(r,50));}
   const receipt=value(await exporter.exportTimeline({root:seed.root,libraryId:seed.libraryId,projectId:seed.projectId},{requestId:randomUUID(),projectId:seed.projectId,timelineId:'cut',revision:seed.revision,kind:purpose,renderJobId:j.jobId}));const path=join(seed.root,receipt.relativePath);
   expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(receipt.hash);
   const decoded=spawnSync(runtime.ffmpegPath,['-v','error','-i',path,'-f','null','-'],{windowsHide:true,encoding:'utf8',timeout:30000});expect(decoded.status,decoded.stderr).toBe(0);outputs.push({purpose,path,receipt});
   const stage=join(evidence,'reference-'+purpose);await mkdir(stage);const inputs=await Promise.all(p.manifest.entries.map(async(m,i)=>{const input=join(stage,'s'+i);await copyFile(join(seed.libraryRoot,'objects',m.hash.slice(0,2),m.hash),input);return input;}));
   const reference=join(stage,'reference.'+purpose);value(await renderSingleMedia(p,runtime,stage,inputs,reference,new AbortController().signal));
   const decode=(file:string)=>{const args=purpose==='wav'?['-map','0:a:0','-f','s16le','-ac','2','-ar','48000']:['-map','0:v:0','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo'];const r=spawnSync(runtime.ffmpegPath,['-v','error','-i',file,...args,'-'],{windowsHide:true,timeout:60000,maxBuffer:16*1024*1024});expect(r.status,String(r.stderr)).toBe(0);return r.stdout;};
   const actual=decode(path),expected=decode(reference);expect(actual.length).toBe(expected.length);
   if(purpose==='wav'){expect(actual.length).toBe(seed.durationTicks*4);expect(actual.subarray(-16000*4).every(byte=>byte===0)).toBe(true);let max=0;for(let i=0;i<actual.length;i+=2)max=Math.max(max,Math.abs(actual.readInt16LE(i)-expected.readInt16LE(i)));expect(max).toBeLessThanOrEqual(2);comparisons.push({purpose,samplesPerChannel:actual.length/4,maxPcmError:max});}
   else{expect(actual.length/3).toBe(seed.durationTicks/1600);expect([...actual.subarray(40*3,41*3)]).toEqual([0,0,0]);let max=0;for(let i=0;i<actual.length;i++)max=Math.max(max,Math.abs(actual[i]!-expected[i]!));expect(max).toBeLessThanOrEqual(5);comparisons.push({purpose,frames:actual.length/3,maxFrameMeanRgbError:max});}
  }
  for(const kind of ['srt','csv','sources'] as const)outputs.push({kind,receipt:value(await exporter.exportTimeline({root:seed.root,libraryId:seed.libraryId,projectId:seed.projectId},{requestId:randomUUID(),projectId:seed.projectId,timelineId:'cut',revision:seed.revision,kind}))});
  await writeFile(join(evidence,'result.json'),JSON.stringify({seed,outputs,comparisons,segmentation,paidModelCalls:0},null,2));
 }finally{await exporter.close();value(await e.close());}
},240000);
