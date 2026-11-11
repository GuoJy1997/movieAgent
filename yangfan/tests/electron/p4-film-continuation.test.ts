import { afterEach, expect, it } from 'vitest';
import { _electron, chromium, expect as ui, type Browser, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile, copyFile, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectDirectoryProject } from '../../apps/desktop/src/main/project-directories.ts';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { packageExecutable } from './support/product-launch.ts';
import { isEventBatch } from '../../packages/contracts/src/events.ts';
import sharp from 'sharp';
let launcher:ElectronApplication|undefined,server:Server|undefined;
let persistRequests:(()=>Promise<void>)|undefined;
const browsers:Browser[]=[];
afterEach(async()=>{
  await persistRequests?.();
  for(const browser of browsers.splice(0)){for(const page of browser.contexts().flatMap(c=>c.pages()))await page.close().catch(()=>{});await browser.close().catch(()=>{});}
  if(launcher){try{await expect.poll(()=>launcher!.evaluate(()=>((globalThis as any).p4Children??[]).every((child:any)=>child.exitCode!==null)),{timeout:20000}).toBe(true);}finally{await launcher.evaluate(()=>{for(const child of (globalThis as any).p4Children??[])if(child.exitCode===null)child.kill();});await launcher.close();launcher=undefined;}}
  server?.closeAllConnections();await new Promise<void>(done=>server?server.close(()=>done()):done());server=undefined;
  // Owned acceptance project and outputs are deliberately retained for inspection.
});
function value(result:any):any{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value?.result??result.value;}
async function ipc(page:Page,type:'query'|'execute',kind:string,payload:unknown):Promise<any>{return page.evaluate(async({type,kind,payload})=>{const d=await window.studio.describe();if(!d.ok)throw Error('DESCRIBE');const envelope={schemaVersion:1,libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,kind,payload};return type==='query'?window.studio.query({...envelope,queryId:crypto.randomUUID()} as any):window.studio.execute({...envelope,commandId:crypto.randomUUID()} as any);},{type,kind,payload});}

const approval={currency:'CNY',allowanceMicros:10000000,budgetLimitMicros:2000000000,acknowledgeUnknown:true};
it.skipIf(!process.env.MOVIEAGENT_P4_RESUME)('continues verified journey4 exports/decode/UNKNOWN/reopen on its exact retained project and package',async()=>{
 const root=resolve(process.env.MOVIEAGENT_P4_RESUME!);
 expect(root).toBe(resolve('C:/Users/1266/AppData/Local/Temp/movieagent-p4-owned-KXdXbW'));
 expect(resolve(process.env.MOVIEAGENT_TEST_PACKAGE!)).toBe(resolve('apps/desktop/release-p4/win-unpacked'));
 const evidence=resolve('test-results/p4-film');await mkdir(evidence,{recursive:true});
 const project=value(await inspectDirectoryProject(join(root,'自有验收项目'))),projectId=project.manifest.binding.projectId,libraryId=project.manifest.binding.libraryId;
 const asar=resolve('apps/desktop/release-p4/win-unpacked/resources/app.asar'),packageHash=createHash('sha256').update(await readFile(asar)).digest('hex');
 const runtime=value(await loadMediaRuntime(resolve('apps/desktop/release-p4/win-unpacked/resources/media-runtime/win32-x64')));
 const native=(args:string[])=>{const r=spawnSync(runtime.ffmpegPath,args,{shell:false,windowsHide:true,encoding:'utf8',maxBuffer:16*1024*1024});expect(r.status,r.stderr).toBe(0);return r;};
 const config=join(root,'fixture-models.json'),configuration=JSON.parse(await readFile(config,'utf8')),port=Number(new URL(configuration.providers[0].baseURL).port);
 const requests:any[]=JSON.parse(await readFile(join(evidence,'requests.json'),'utf8'));await writeFile(join(evidence,'journey4-requests.json'),JSON.stringify(requests,null,2));
 const priorPostCount=requests.filter(r=>r.method==='POST').length;let unknownNext=false;
 persistRequests=()=>writeFile(join(evidence,'requests.json'),JSON.stringify(requests,null,2));
 server=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{const body=Buffer.concat(chunks);requests.push({method:req.method,url:req.url,headers:{authorization:req.headers.authorization,'x-api-key':req.headers['x-api-key'],'x-client-request-id':req.headers['x-client-request-id'],'idempotency-key':req.headers['idempotency-key']},hash:createHash('sha256').update(body).digest('hex')});if(req.method==='POST'&&unknownNext){unknownNext=false;req.socket.destroy();return;}res.statusCode=404;res.end('{}');});});
 await new Promise<void>(done=>server!.listen(port,'127.0.0.1',done));
 const ports:number[]=[];for(let i=0;i<2;i++){const listener=createServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));ports.push((listener.address() as {port:number}).port);await new Promise<void>(done=>listener.close(()=>done()));}
 launcher=await _electron.launch({executablePath:packageExecutable,args:[`--model-config=${config}`,`--user-data-dir=${join(root,'launcher')}`]});const launchPage=await launcher.firstWindow();
 await launcher.evaluate(({dialog},data)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[data.folder]});const cp:any=process.getBuiltinModule('child_process'),spawn=cp.spawn;(globalThis as any).p4Children=[];cp.spawn=(exe:string,args:string[],options:any)=>{const child=spawn(exe,[...args,'--provider-evidence=fixture',`--remote-debugging-port=${data.ports.shift()}`],options);(globalThis as any).p4Children.push(child);return child;};},{folder:project.root,ports:[...ports]});
 const errors:string[]=[];
 async function connect(index:number){await expect.poll(async()=>{try{return(await fetch(`http://127.0.0.1:${ports[index]}/json/version`)).ok;}catch{return false;}},{timeout:30000}).toBe(true);const browser=await chromium.connectOverCDP(`http://127.0.0.1:${ports[index]}`);browsers.push(browser);await expect.poll(()=>browser.contexts().flatMap(c=>c.pages()).length,{timeout:30000}).toBeGreaterThan(0);const page=browser.contexts().flatMap(c=>c.pages())[0]!;page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.studio);await ui(page.getByText('本地引擎已连接',{exact:true})).toBeVisible({timeout:30000});await page.setViewportSize({width:1440,height:960});return page;}
 await launchPage.getByRole('button',{name:'打开项目',exact:true}).click();let page=await connect(0);
 const query=async(kind:string,payload:unknown)=>value(await ipc(page,'query',kind,payload)),cmd=async(kind:string,payload:unknown)=>value(await ipc(page,'execute',kind,payload));
 const eventCursor=value(await page.evaluate(async()=>{const d=await window.studio.describe();if(!d.ok)throw Error('describe');return window.studio.readEvents({libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch});})).cursor;
 const timelineId=(await query('timeline.list',{projectId})).timelines[0].id,timeline=await query('timeline.read',{projectId,timelineId});expect(timeline.videoClips).toHaveLength(4);expect(timeline.audioClips.some((c:any)=>c.id==='narration')).toBe(true);
 const tasks=(await query('task.list',{})).tasks;expect(tasks.filter((t:any)=>t.providerTaskId?.startsWith('h3-')&&t.state==='SUCCEEDED')).toHaveLength(9);expect(tasks.filter((t:any)=>t.providerTaskId?.startsWith('sync-')&&t.state==='SUCCEEDED')).toHaveLength(1);
 const takes=[],reviews=[];for(const shotId of ['aud-a-calm','aud-a-excited','aud-a-quiet','aud-b-calm','aud-b-excited','aud-b-quiet','aud-exchange','cut-0','cut-1','cut-2']){const snapshot=await query('dialogue.takes',{projectId,shotId});takes.push(...snapshot.takes);reviews.push(...snapshot.reviews);}
 expect(takes).toHaveLength(11);expect(reviews).toHaveLength(11);expect(reviews.every((r:any)=>r.revision===1&&Object.values(r.checks).every(check=>check==='pass'))).toBe(true);
 const audio=(await query('audio.read',{projectId}));expect(audio.takes).toHaveLength(1);expect(audio.transcripts.some((t:any)=>t.revision===2&&t.text==='手改字幕确认')).toBe(true);expect(audio.transcripts.some((t:any)=>t.revision===1&&t.text==='原始识别')).toBe(true);
 const jobs=(await query('render.list',{projectId})).jobs,beforeJobs=jobs.length;const plans=await Promise.all(jobs.filter((j:any)=>j.kind==='render').map(async(j:any)=>({job:j,plan:await query('render.plan',{projectId,planId:j.planId})})));
 const findOutput=(purpose:string)=>plans.find((p:any)=>p.plan.purpose===purpose&&p.job.state==='SUCCEEDED').job;
 const preview=findOutput('preview'),mp4=findOutput('mp4'),wav=findOutput('wav');expect(plans.filter((p:any)=>p.job.state==='CANCELLED')).toHaveLength(1);
 for(const j of [preview,mp4,wav]){const info=await cmd('media.inspect',{projectId,reference:j.outputRef}),bytes=await readFile(join(project.libraryRoot,'objects',info.hash.slice(0,2),info.hash));expect(createHash('sha256').update(bytes).digest('hex')).toBe(info.hash);}
 const productions=await query('dialogue.productions',{projectId,shotId:'cut-2'}),production=await query('dialogue.production',{projectId,planId:productions.productions.find((p:any)=>p.runId==='sync-repair').planId}),prepared=production.plan.items[0].prepared;
 const repairInput={projectId,dialogueRef:{id:'d-cut-2',revision:1},alignedInput:{videoRef:prepared.lipSyncVideo.ref,audioRef:prepared.lipSyncAudio.ref,durationTicks:prepared.lipSyncVideo.durationTicks,videoHash:prepared.lipSyncVideo.hash,audioHash:prepared.lipSyncAudio.hash},profileRef:production.plan.profileRef,executionOwner:'desktop-user',runId:'sync-repair'};
 await writeFile(join(evidence,'continuity-checkpoint.json'),JSON.stringify({root,packageHash,projectId,libraryId,tasks,takes,timeline,jobs,production,priorPostCount,checkedAt:new Date().toISOString()},null,2));expect(requests.filter(r=>r.method==='POST')).toHaveLength(priorPostCount);
 await page.getByRole('button',{name:'剪辑成片',exact:true}).click();
  const receipts:any[]=[];
  for(const kind of ['mp4','wav','srt','csv','sources']){const input={requestId:crypto.randomUUID(),projectId,timelineId:timeline.id,revision:timeline.revision,kind,...(kind==='mp4'?{renderJobId:mp4.jobId}:kind==='wav'?{renderJobId:wav.jobId}:{})};if(kind==='mp4'){const blocker=join(project.root,'exports','video');await writeFile(blocker,'owned retry fixture',{flag:'wx'});expect(await page.evaluate(input=>window.studio.exportTimeline(input as any),input)).toMatchObject({ok:false,error:{code:'EXPORT_PATH_UNSAFE'}});await unlink(blocker);}const receipt=value(await page.evaluate(input=>window.studio.exportTimeline(input as any),input));expect(receipt.state).toBe('completed');receipts.push(receipt);expect(value(await page.evaluate(input=>window.studio.exportTimeline(input as any),input))).toEqual(receipt);}
  expect((await query('render.list',{projectId})).jobs.length).toBe(beforeJobs);
  await page.getByRole('button',{name:'导出',exact:true}).click();await page.screenshot({path:join(evidence,'02-final-timeline-exports.png')});
  for(const receipt of receipts){const source=join(project.root,receipt.relativePath);const bytes=await readFile(source);expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.hash);await copyFile(source,join(evidence,basename(source)));}
  const movie=join(project.root,receipts.find(r=>r.kind==='mp4').relativePath);native(['-v','error','-i',movie,'-map','0:v:0','-map','0:a:0','-f','null','-']);
  const probe=spawnSync(runtime.ffprobePath,['-v','error','-show_streams','-show_format','-of','json',movie],{shell:false,windowsHide:true,encoding:'utf8'});expect(probe.status).toBe(0);const facts=JSON.parse(probe.stdout);expect(facts.streams.find((s:any)=>s.codec_type==='video')).toMatchObject({width:1920,height:1080});expect(Number(facts.format.duration)).toBe(30);
  for(const [i,time] of [2,7,12,22].entries())native(['-v','error','-y','-ss',String(time),'-i',movie,'-frames:v','1',join(evidence,`cut-${i+1}.png`)]);
  for(const [i,channel] of [0,0,1,2].entries()){const {data,info}=await sharp(join(evidence,`cut-${i+1}.png`)).raw().toBuffer({resolveWithObject:true});const centre=(540*info.width+960)*info.channels;expect(data[centre+channel]).toBeGreaterThan(channel===1?100:200);for(const other of [0,1,2].filter(v=>v!==channel))expect(data[centre+other]).toBeLessThan(40);if(i!==1){let white=0;for(let y=900;y<1050;y++)for(let x=200;x<1720;x++){const at=(y*info.width+x)*info.channels;if(data[at]!>200&&data[at+1]!>200&&data[at+2]!>200)white++;}expect(white).toBeGreaterThan(100);}}
  const pcm=spawnSync(runtime.ffmpegPath,['-v','error','-i',movie,'-vn','-f','s16le','-ac','1','-ar','48000','pipe:1'],{shell:false,windowsHide:true,maxBuffer:4*1024*1024});expect(pcm.status).toBe(0);expect(pcm.stdout.length).toBeGreaterThanOrEqual(30*48000*2);for(const at of [2,7,12,22]){const data=pcm.stdout.subarray(at*96000,(at+1)*96000);let energy=0;for(let i=0;i<data.length;i+=2)energy+=data.readInt16LE(i)**2;expect(Math.sqrt(energy/(data.length/2))).toBeGreaterThan(100);}
  expect(await readFile(join(project.root,receipts.find(r=>r.kind==='srt').relativePath),'utf8')).toContain('第一镜：平静的回应');
  expect(await readFile(join(project.root,receipts.find(r=>r.kind==='csv').relativePath),'utf8')).toContain('dialogue_route');
  const unknownPlan=await cmd('dialogue.prepareRepair',{...repairInput,runId:'unknown-sync'});unknownNext=true;const unknownBatch=await cmd('dialogue.approveProduction',{planId:unknownPlan.planId,approvedHash:unknownPlan.approvedHash,executionOwner:unknownPlan.executionOwner,runId:unknownPlan.runId,approval});await expect.poll(async()=>['SUBMISSION_UNKNOWN','RECONCILE_REQUIRED'].includes((await query('task.read',{taskId:unknownBatch.tasks[0].taskId})).state),{timeout:30000}).toBe(true);
  const beforeReopen=requests.filter(r=>r.method==='POST').length;
  await writeFile(join(evidence,'engineering-result.json'),JSON.stringify({continuationOf:'task-8-packaged-journey-4',packageHash,packageExecutable,root,projectId,timeline,preview,mp4,wav,receipts,media:facts,providerOutputFixture:'owned immutable ArtifactSource spool; real packaged POST/GET; remote CDN download unverified',quality:'synthetic engineering only'},null,2));
  const continuationEvents=await page.evaluate(async cursor=>{const d=await window.studio.describe();if(!d.ok)throw Error('describe');return window.studio.readEvents({libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,cursor});},eventCursor);
  expect(continuationEvents.ok&&isEventBatch(continuationEvents.value)).toBe(true);expect(value(continuationEvents).events.length).toBeGreaterThan(0);
  expect(createHash('sha256').update(await readFile(asar)).digest('hex')).toBe(packageHash);
  await page.close();await expect.poll(()=>launcher!.evaluate(()=>(globalThis as any).p4Children[0].exitCode),{timeout:20000}).toBe(0);
  await launchPage.getByRole('button',{name:'打开项目',exact:true}).click();page=await connect(1);await page.getByRole('button',{name:'剪辑成片',exact:true}).click();await ui(page.getByLabel('当前时间线')).toContainText('P4 三十秒成片');
  expect((await query('timeline.read',{projectId,timelineId:timeline.id})).videoClips).toHaveLength(4);expect(['SUBMISSION_UNKNOWN','RECONCILE_REQUIRED']).toContain((await query('task.read',{taskId:unknownBatch.tasks[0].taskId})).state);
  expect(requests.filter(r=>r.method==='POST')).toHaveLength(beforeReopen);expect(errors).toEqual([]);await page.screenshot({path:join(evidence,'03-reopened.png')});
  const h3Requests=requests.filter(r=>r.method==='POST'&&r.url==='/v2/video_generation');expect(h3Requests).toHaveLength(9);expect(h3Requests.every(r=>r.headers.authorization==='Bearer dummy-p4-only'&&r.body.content.some((c:any)=>c.type==='audio_url'))).toBe(true);
  const syncRequests=requests.filter(r=>r.method==='POST'&&r.url==='/v2/generate');expect(syncRequests).toHaveLength(2);expect(syncRequests.every(r=>r.headers['x-api-key']==='dummy-p4-only')).toBe(true);
  await writeFile(join(evidence,'requests.json'),JSON.stringify(requests.map(({body,...rest})=>({...rest,...(body?{audioReferences:body.content.filter((c:any)=>c.type==='audio_url').length,prompt:body.content[0].text}:{} )})),null,2));
},600000);
