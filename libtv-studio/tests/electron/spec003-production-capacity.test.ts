import {createProjectBackup,restoreProjectBackup}from'../../packages/storage/src/project-backup.ts';import{startEngine}from'../../packages/engine/src/bootstrap.ts';
import {afterEach,expect,it} from 'vitest';
import {_electron,chromium,expect as ui,type ElectronApplication,type Browser,type Page} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,utimes,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {seedCapacityProject,value} from '../fixtures/timeline-capacity-media.ts';
import {packageExecutable,isolatedModelConfig} from './support/product-launch.ts';
import {loadMediaRuntime} from '../../packages/engine/src/media/manifest.ts';
let app:ElectronApplication|undefined;const browsers:Browser[]=[];
afterEach(async()=>{for(const b of browsers.splice(0)){for(const p of b.contexts().flatMap(c=>c.pages()))await p.close().catch(()=>{});await b.close().catch(()=>{});}if(app){await app.evaluate(async()=>{for(const c of (globalThis as any).spec003Children??[])if(c.exitCode===null)c.kill();}).catch(()=>{});await app.close().catch(()=>{});app=undefined;}});
function un(r:any):any{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
async function ipc(page:Page,kind:string,payload:unknown,execute=false):Promise<any>{
 const r=await page.evaluate(async({kind,payload,execute})=>{const d=await window.studio.describe();if(!d.ok)throw Error('describe');const base={schemaVersion:1,libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,kind,payload};return execute?window.studio.execute({...base,commandId:crypto.randomUUID()} as any):window.studio.query({...base,queryId:crypto.randomUUID()} as any);},{kind,payload,execute});const v=un(r);return execute?v.result:v;
}
async function freePort(){const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return port;}
const queryTimeouts:{jobId:string;at:number;code:string}[]=[];
async function waitJob(page:Page,projectId:string,jobId:string){const end=Date.now()+900000;for(;;){if(Date.now()>end)throw Error('LOCAL_JOB_NO_COMPLETION');let j:any;try{j=await ipc(page,'render.read',{projectId,jobId});}catch(error){if(error instanceof Error&&error.message.includes('ENGINE_REQUEST_TIMEOUT')){queryTimeouts.push({jobId,at:Date.now(),code:'ENGINE_REQUEST_TIMEOUT'});await new Promise(r=>setTimeout(r,1500));continue;}throw error;}if(j.state==='SUCCEEDED')return j;if(['FAILED','CANCELLED','INTERRUPTED'].includes(j.state))throw Error(JSON.stringify(j));if(Date.now()>end)throw Error('LOCAL_JOB_NO_COMPLETION');await new Promise(r=>setTimeout(r,250));}}
it.skipIf(!process.env.MOVIEAGENT_TEST_PACKAGE)('accepts dense and maximum timelines, stable five-format exports, and a packaged reopen',async()=>{
 const root=resolve(process.env.MOVIEAGENT_SPEC003_FIXTURES_ROOT??('D:/movieAgent/verification/2026-11-01-spec003/packaged-'+randomUUID()));await mkdir(root,{recursive:true});
 const previous=await readFile(join(root,'report.json')).catch(()=>undefined);if(previous)await writeFile(join(root,'report-before-'+Date.now()+'.json'),previous);
 const report:any={packageExecutable,root,cases:[],modelRequests:0,queryTimeouts};const persist=()=>writeFile(join(root,'report.json'),JSON.stringify(report,null,2));await persist();
 const runtime=value(await loadMediaRuntime(resolve(process.env.MOVIEAGENT_TEST_PACKAGE!,'resources/media-runtime/win32-x64')));
 const seeds:Array<{name:string}&Awaited<ReturnType<typeof seedCapacityProject>>>=[];
 for(const [name,count,ticks,voices]of [['zip-stability',3,480000,3],['dense-episode',150,96000,10],['max-clips',256,1600,256]] as const){console.log('SEED',name);const at=Date.now();const cached=await readFile(join(root,name,'seed.json'),'utf8').then(s=>JSON.parse(s),()=>undefined);seeds.push({name,...(cached??await seedCapacityProject(join(root,name),count,ticks,voices,resolve(process.env.MOVIEAGENT_TEST_PACKAGE!,'resources/media-runtime/win32-x64')))});console.log('SEEDED',name,Date.now()-at);}
 const config=await isolatedModelConfig(root);
 app=await _electron.launch({executablePath:packageExecutable,args:[config,'--user-data-dir='+join(root,'isolated-launcher')],timeout:30000});
 const launcher=await app.firstWindow();
 await app.evaluate(({dialog})=>{(globalThis as any).spec003Children=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:[(globalThis as any).spec003Folder]});const cp:any=process.getBuiltinModule('child_process'),original=cp.spawn;cp.spawn=(exe:string,args:string[],options:any)=>{const child=original(exe,[...args,'--provider-evidence=fixture','--remote-debugging-port='+(globalThis as any).spec003Port],options);(globalThis as any).spec003Children.push(child);return child;};});
 async function open(seed:typeof seeds[number]){
  const port=await freePort();await app!.evaluate((_,data)=>{(globalThis as any).spec003Folder=data.folder;(globalThis as any).spec003Port=data.port;},{folder:seed.root,port});await launcher.getByRole('button',{name:'打开项目',exact:true}).click();
  await expect.poll(async()=>{try{return (await fetch('http://127.0.0.1:'+port+'/json/version')).ok;}catch{return false;}},{timeout:30000}).toBe(true);
  const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);browsers.push(browser);await expect.poll(()=>browser.contexts().flatMap(c=>c.pages()).length,{timeout:30000}).toBeGreaterThan(0);
  const page=browser.contexts().flatMap(c=>c.pages())[0]!;page.setDefaultTimeout(15000);await page.waitForFunction(()=>!!window.studio);await ui(page.getByText('本地引擎已连接',{exact:true})).toBeVisible({timeout:30000});await page.setViewportSize({width:1440,height:960});return page;
 }
 async function close(page:Page){await page.evaluate(()=>window.close());await expect.poll(()=>app!.evaluate(()=>((globalThis as any).spec003Children??[]).every((c:any)=>c.exitCode!==null)),{timeout:30000}).toBe(true);}
 const allErrors:string[]=[];
 const selectedCases=seeds.filter(s=>!process.env.MOVIEAGENT_SPEC003_CASES||process.env.MOVIEAGENT_SPEC003_CASES.split(',').includes(s.name));expect(selectedCases.length).toBeGreaterThan(0);
 for(const seed of selectedCases){
  console.log('CASE',seed.name);const page=await open(seed);page.on('pageerror',e=>allErrors.push(e.message));
  const c:any={name:seed.name,seed,outputs:[],renderJobs:[]};report.cases.push(c);await persist();
  if(seed.name==='zip-stability'){await ipc(page,'agent.createSession',{projectId:seed.projectId,title:'预算界面验收',mode:'all',executionOwner:'capacity-test'},true);await page.getByRole('button',{name:'创作 Agent',exact:true}).click();const tokens=page.getByLabel('输出 token 预算（留空沿用预设）',{exact:true});await ui(tokens).toHaveValue('');await tokens.fill('128');await page.getByRole('button',{name:'恢复沿用预设',exact:true}).click();await ui(tokens).toHaveValue('');c.agentBudgetUiPassed=true;}
  const openedAt=Date.now();await page.getByRole('button',{name:'剪辑成片',exact:true}).click();await page.getByLabel('时间线容量').waitFor();c.editorOpenMs=Date.now()-openedAt;expect(c.editorOpenMs).toBeLessThan(3000);
  expect(await page.getByLabel('时间线容量').textContent()).toContain('画面 '+seed.count+' / 256');
  let t=await ipc(page,'timeline.read',{projectId:seed.projectId,timelineId:'cut'});expect(t.videoClips).toHaveLength(seed.count);expect(t.audioClips.filter((a:any)=>a.track==='voice')).toHaveLength(seed.voiceCount);
  // Exercise explicit restoration while keeping all source revisions immutable.
  if(seed.name!=='zip-stability'){
   await page.getByText('持久修订历史（显式恢复）',{exact:true}).click();await page.getByRole('button',{name:'恢复此修订 r2',exact:true}).click();await expect.poll(async()=>(await ipc(page,'timeline.read',{projectId:seed.projectId,timelineId:'cut'})).revision).toBe(t.revision+1);
   const old=await ipc(page,'timeline.read',{projectId:seed.projectId,timelineId:'cut'});expect(old.videoClips).toHaveLength(seed.count);await page.getByText('已保存 · 基准r'+old.revision,{exact:true}).waitFor();
   await page.getByRole('button',{name:'恢复此修订 r'+seed.revision,exact:true}).click();await expect.poll(async()=>(await ipc(page,'timeline.read',{projectId:seed.projectId,timelineId:'cut'})).revision).toBe(old.revision+1);t=await ipc(page,'timeline.read',{projectId:seed.projectId,timelineId:'cut'});
   expect(t.audioClips.filter((a:any)=>a.track==='voice')).toHaveLength(seed.voiceCount);
   await page.getByText('已保存 · 基准r'+t.revision,{exact:true}).waitFor();
  }
  c.finalRevision=t.revision;
  if(seed.name!=='zip-stability'){
   // Each real batch is separately prepared and approved using production controls.
   let jobs=await ipc(page,'render.list',{projectId:seed.projectId});
   const prepare=page.getByRole('button',{name:/^准备编辑预览/});await prepare.click();
   let total=0;for(let index=0;;index++){
    await page.getByRole('dialog').getByLabel('确认磁盘占用与固定版本').check();
    const previous=new Set(jobs.jobs.map((j:any)=>j.jobId));await page.getByRole('button',{name:'批准本机处理',exact:true}).click();
    await expect.poll(async()=>{jobs=await ipc(page,'render.list',{projectId:seed.projectId});return jobs.jobs.some((j:any)=>!previous.has(j.jobId));},{timeout:30000}).toBe(true);
    const job=jobs.jobs.find((j:any)=>!previous.has(j.jobId));await waitJob(page,seed.projectId,job.jobId);console.log('PROXY',seed.name,index+1);
    if(index===0)total=await page.getByRole('button',{name:/^(准备|重试)编辑代理第 \d+ 批$/}).count();
    if(index+1>=total)break;await page.getByRole('button',{name:'准备编辑代理第 '+(index+2)+' 批',exact:true}).click();
   }c.proxyBatches=total;
   const feedback=await page.evaluate(async()=>{const nodes=[...document.querySelectorAll<HTMLButtonElement>('.timeline-track button')].filter(n=>n.getAttribute('aria-label')?.startsWith('选择片段 ')),times:number[]=[];
    for(let i=0;i<30;i++){const node=nodes[Math.floor(i*nodes.length/30)]!,start=performance.now();node.click();await new Promise<void>(r=>requestAnimationFrame(()=>r()));times.push(performance.now()-start);}return times.sort((a,b)=>a-b);});
   c.feedbackP95Ms=feedback[Math.floor(feedback.length*.95)];await persist();expect(c.feedbackP95Ms).toBeLessThan(100);
   c.mediaPlayersBefore=await page.locator('.timeline-preview video,.timeline-preview audio').count();
   await page.evaluate(async end=>{const slider=document.querySelector<HTMLInputElement>('input[aria-label="预览播放头"]')!,set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;for(let i=0;i<100;i++){set.call(slider,String(Math.floor((i%97)/97*end/1600)*1600));slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));await new Promise<void>(r=>requestAnimationFrame(()=>r()));}},seed.durationTicks);
   c.zoomSeekP95Ms=await page.evaluate(async()=>{const times:number[]=[];for(const label of ['时间线缩放','轨道播放头']){const node=document.querySelector<HTMLInputElement>('input[aria-label="'+label+'"]')??([...document.querySelectorAll('label')].find(l=>l.textContent?.includes(label))?.querySelector<HTMLInputElement>('input'))!,setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;for(let i=0;i<30;i++){const at=performance.now();setter.call(node,String(Number(node.min)+(Number(node.max)-Number(node.min))*(i%10)/10));node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));await new Promise<void>(r=>requestAnimationFrame(()=>r()));times.push(performance.now()-at);}}return times.sort((a,b)=>a-b)[Math.floor(times.length*.95)];});await persist();expect(c.zoomSeekP95Ms).toBeLessThan(100);
   const dragNode=page.getByRole('button',{name:'选择片段 '+t.videoClips[0].id,exact:true});await dragNode.scrollIntoViewIfNeeded();const box=(await dragNode.boundingBox())!;await page.evaluate(()=>{(window as any).spec003Drag=[];document.addEventListener('pointermove',e=>{if(e.buttons===1&&(e.target as Element).closest('.timeline-clip')){const at=performance.now();requestAnimationFrame(()=>(window as any).spec003Drag.push(performance.now()-at));}},true);});await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();for(let i=0;i<30;i++)await page.mouse.move(box.x+box.width/2+Math.sin(i)*3,box.y+box.height/2);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await dragNode.dispatchEvent('pointercancel');await page.mouse.up();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>r())));const dragTimes=await page.evaluate(()=>(window as any).spec003Drag.sort((a:number,b:number)=>a-b));expect(dragTimes.length).toBeGreaterThan(0);c.dragP95Ms=dragTimes[Math.floor(dragTimes.length*.95)];await persist();expect(c.dragP95Ms).toBeLessThan(100);
   c.mediaPlayersAfter=await page.locator('.timeline-preview video,.timeline-preview audio').count();expect(c.mediaPlayersAfter).toBeLessThanOrEqual(3);
   await page.screenshot({path:join(root,seed.name+'-timeline.png')});await persist();
  }
  for(const purpose of ['mp4','wav'] as const){
   const at=Date.now(),plan=await ipc(page,'render.prepare',{timelineRef:{libraryId:seed.libraryId,projectId:seed.projectId,id:'cut',revision:t.revision},purpose,intermediateBudgetBytes:2*1024**3,executionOwner:'capacity-test',runId:randomUUID()},true);
   const job=await ipc(page,'render.enqueue',{planId:plan.planId,planHash:plan.planHash,executionOwner:plan.executionOwner,runId:plan.runId,diskBudgetBytes:plan.requiredFreeBytes},true);const finished=await waitJob(page,seed.projectId,job.jobId);c.renderJobs.push({purpose,jobId:job.jobId,planId:plan.planId,durationMs:Date.now()-at,outputRef:finished.outputRef});console.log('RENDERED',seed.name,purpose,Date.now()-at);await persist();
  }
  const beforeJobs=(await ipc(page,'render.list',{projectId:seed.projectId})).jobs.length,hashes=new Map<string,string>();
  const iterations=seed.name==='zip-stability'?10:1;
  for(let iteration=0;iteration<iterations;iteration++){
   if(iteration<5&&seed.name==='zip-stability'){
    const media=[...seed.sourceHashes];for(const job of c.renderJobs){const info=await ipc(page,'media.inspect',{projectId:seed.projectId,reference:job.outputRef},true);media.push(info.hash);}
    for(const hash of new Set(media)){const path=join(seed.libraryRoot,'objects',hash.slice(0,2),hash),now=new Date(Date.now()+iteration*1000);await utimes(path,now,now);}
   }
   for(const kind of ['mp4','wav','srt','csv','sources'] as const){
    const input={requestId:randomUUID(),projectId:seed.projectId,timelineId:'cut',revision:t.revision,kind,...(['mp4','wav'].includes(kind)?{renderJobId:c.renderJobs.find((j:any)=>j.purpose===kind).jobId}:{})};
    const at=Date.now(),receipt=un(await page.evaluate(input=>window.studio.exportTimeline(input),input));
    expect(receipt.state).toBe('completed');const path=join(seed.root,receipt.relativePath),bytes=await readFile(path);expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.hash);
    if(hashes.has(kind))expect(receipt.hash).toBe(hashes.get(kind));else hashes.set(kind,receipt.hash);
    if(iteration===0){
     const again=un(await page.evaluate(input=>window.studio.exportTimeline(input),input));expect(again).toEqual(receipt);
     if(kind==='mp4'||kind==='wav'){const decoded=spawnSync(runtime.ffmpegPath,['-v','error','-i',path,'-progress','pipe:1','-f','null','-'],{windowsHide:true,encoding:'utf8',timeout:120000});expect(decoded.status,decoded.stderr).toBe(0);if(kind==='mp4'){const frames=[...decoded.stdout.matchAll(/frame=(\d+)/g)].at(-1)?.[1];expect(Number(frames)).toBe(seed.durationTicks/1600);c.decodedFrames=Number(frames);}const probe=spawnSync(runtime.ffprobePath,['-v','error','-show_entries','stream=codec_type,duration_ts,time_base','-of','json',path],{windowsHide:true,encoding:'utf8',timeout:30000});expect(probe.status,probe.stderr).toBe(0);const streams=JSON.parse(probe.stdout).streams;for(const s of streams){const[n,d]=s.time_base.split('/').map(Number),ticks=s.duration_ts*n/d*48000;expect(Math.abs(ticks-seed.durationTicks)).toBeLessThanOrEqual(kind==='wav'?1:1600);}c.streamChecks={...c.streamChecks,[kind]:streams};}
     if(kind==='sources'){const unzip=createRequire(import.meta.url)('unzipper');const archive=await unzip.Open.buffer(bytes);expect(archive.files.length).toBe(new Set(seed.sourceHashes).size+1);const manifest=JSON.parse((await archive.files.find((f:any)=>f.path==='manifest.json').buffer()).toString());expect(manifest.timelineRef.revision).toBe(t.revision);const hashes=new Map<string,string>(manifest.sources.map((s:any)=>[s.filename,s.hash]));for(const entry of archive.files)if(entry.path!=='manifest.json')expect(createHash('sha256').update(await entry.buffer()).digest('hex')).toBe(hashes.get(entry.path));}
    }
    c.outputs.push({kind,iteration,cache:seed.name==='zip-stability'?(iteration<5?'cold':'hot'):'normal',elapsedMs:Date.now()-at,path,receipt});
   }console.log('EXPORTED',seed.name,iteration);await persist();
  }
  expect((await ipc(page,'render.list',{projectId:seed.projectId})).jobs.length).toBe(beforeJobs);
  expect((await ipc(page,'task.list',{})).tasks).toHaveLength(0);
  await copyFile(join(seed.libraryRoot,'logs','timeline-export-rpc.jsonl'),join(root,seed.name+'-rpc.jsonl')).catch(()=>{});
  await close(page);await persist();
 }
 const last=selectedCases.at(-1)!,page=await open(last),reopened=await ipc(page,'timeline.read',{projectId:last.projectId,timelineId:'cut'});expect(reopened.videoClips).toHaveLength(last.count);expect(reopened.revision).toBe(report.cases.at(-1).finalRevision);expect(reopened.audioClips.filter((a:any)=>a.track==='voice')).toHaveLength(last.voiceCount);await close(page);
 const backupId=last.name+'-'+randomUUID();const saved=un(await createProjectBackup({projectRoot:last.root,destination:join(root,'backup-'+backupId),appVersion:'0.1.0'}));const restored=un(await restoreProjectBackup({backupRoot:saved.root,destination:join(root,'restored-'+backupId)}));const restoredEngine=un(await startEngine({root:join(restored.root,'.movieagent/library'),runtime}));try{expect(un(restoredEngine.timelines.read({projectId:last.projectId,timelineId:'cut'}))).toEqual(reopened);}finally{un(await restoredEngine.close());}report.backupRestorePassed=true;
 expect(allErrors).toEqual([]);report.reopenPassed=true;report.pageErrors=allErrors;await persist();
},1800000);
