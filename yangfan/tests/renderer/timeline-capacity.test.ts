import{afterAll,beforeAll,expect,it}from'vitest';
import{harness,mounted,calls,timeline,queries}from'./p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();});afterAll(async()=>{await h?.browser.close();await h?.server.close();});
function data(n:number){const q=queries(),t={...timeline,videoClips:Array.from({length:n},(_,i)=>({...timeline.videoClips[0]!,id:'clip'+i,media:{...timeline.videoClips[0]!.media,assetId:'picture'+i},sourceHash:i.toString(16).padStart(64,'0'),startTicks:i*96000,durationTicks:96000}))};q['timeline.list'].timelines=[t,q['timeline.list'].timelines[1]!];q['timeline.read:timeline-a']=t;return q;}
it('prepares only the first bounded batch of a 150-clip timeline',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:/准备编辑预览/}).click();await calls(page,1);
  const c=await page.evaluate(()=>window.p4Fixture.calls[0]!);
  expect(c.kind).toBe('media.prepareDerived');expect((c.payload.references as unknown[]).length).toBe(64);
  await page.evaluate(()=>window.p4Fixture.resolve(undefined));
  expect(await page.getByText('编辑代理批次 1 / 3',{exact:true}).count()).toBe(1);
  const begin=await page.evaluate(()=>performance.now());
  for(let i=0;i<20;i++)await page.getByRole('button',{name:'选择片段 clip'+(i*7),exact:true}).click();
  const elapsed=await page.evaluate(()=>performance.now());expect(elapsed-begin).toBeLessThan(10000);
 },data(150));
});

it('loads only nearby waveforms on a 256-clip track',async()=>{
 const audio=Array.from({length:256},(_,i)=>({id:'a'+i,kind:'audio',track:'voice',media:{kind:'assetVersion',libraryId:'library',assetId:'a'+i,version:1},sourceHash:i.toString(16).padStart(64,'0'),sourceProbeId:'probe',sourceInTicks:0,startTicks:i*48000,durationTicks:48000,gainMilli:1000,mute:false}));
 const entries=audio.map((a,i)=>({kind:'waveform',mime:'application/json',ref:{libraryId:'library',cacheId:i.toString(16).padStart(64,'0'),sourceHash:a.sourceHash,recipeHash:'a'.repeat(64)}}));
 const waves=Object.fromEntries(entries.map(e=>[e.ref.cacheId,{sampleRate:48000,bucketRate:60,peaks:Array(60).fill(0.25)}]));
 await mounted(h,async page=>{
  await page.getByRole('img',{name:'音频波形 a0',exact:true}).waitFor();
  expect(await page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='derivedMediaUrl').length)).toBeLessThan(100);
 },{...queries(),__tracks:{...timeline,audioClips:audio},__trackEntries:entries,__waveforms:waves});
});

it('keeps approved proxy batches on partial failure and ignores preparation after navigation',async()=>{
 await mounted(h,async page=>{
  const plan={kind:'derived',planId:'batch-1',planHash:'a'.repeat(64),executionOwner:'desktop-user',runId:'run',estimatedBytes:1024,requiredFreeBytes:1073742848};
  await page.getByRole('button',{name:/^准备编辑预览/}).click();await calls(page,1);await page.evaluate(plan=>window.p4Fixture.resolve(plan),plan);
  await page.getByLabel('确认磁盘占用与固定版本',{exact:true}).check();await page.getByRole('button',{name:'批准本机处理',exact:true}).click();await calls(page,2);await page.evaluate(()=>window.p4Fixture.resolve({libraryId:'library',projectId:'project',jobId:'first-job'}));
  const first=page.getByRole('button',{name:'准备编辑代理第 1 批',exact:true});await expect.poll(()=>first.isDisabled()).toBe(true);
  await page.getByRole('button',{name:'准备编辑代理第 2 批',exact:true}).click();await calls(page,3);await page.evaluate(()=>window.p4Fixture.resolve(undefined));
  await page.getByRole('button',{name:'重试编辑代理第 2 批',exact:true}).click();await calls(page,4);
  expect(await first.isDisabled()).toBe(true);const requested=await page.evaluate(()=>window.p4Fixture.calls[3]!.payload.references);expect((requested as unknown[]).length).toBe(1);
  await page.getByLabel('当前时间线',{exact:true}).selectOption('timeline-b');await page.evaluate(plan=>window.p4Fixture.resolve({...plan,planId:'late-batch-2'}),plan);
  expect(await page.getByRole('dialog').count()).toBe(0);expect(await page.evaluate(()=>window.p4Fixture.calls.filter(c=>c.kind==='media.enqueueDerived').length)).toBe(1);
 },data(65));
});

it('defers collapsed job-plan details while keeping compatible preview caches and recovery available',async()=>{
 const hash=timeline.videoClips[0]!.sourceHash,ref={libraryId:'library',cacheId:'b'.repeat(64),sourceHash:hash,recipeHash:'c'.repeat(64)};
 const t={...timeline,videoClips:[{...timeline.videoClips[0]!,kind:'video',sourceProbeId:'probe'}]};
 const jobs=[{projectId:'project',jobId:'cache',planId:'cache',kind:'derived',state:'SUCCEEDED',phase:'succeeded',progressTicks:0,attempt:1,history:[]},{projectId:'project',jobId:'failed',planId:'failed',kind:'render',state:'INTERRUPTED',phase:'interrupted',progressTicks:0,attempt:1,needsResume:true,history:[]}];
 await mounted(h,async page=>{
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='derivedMediaUrl').length)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.p4Fixture.queryReads.filter(q=>q.kind==='render.plan'))).toEqual([]);
  await page.getByText('本机处理与导出状态',{exact:true}).click();
  await page.getByRole('button',{name:'继续原作业',exact:true}).click();await calls(page,1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'render.resume',payload:{jobId:'failed',executionOwner:'fixed-owner'}});
  await page.evaluate(()=>window.p4Fixture.resolve(undefined));
  expect(await page.evaluate(()=>window.p4Fixture.queryReads.filter(q=>q.kind==='render.plan').map(q=>(q.payload as {planId:string}).planId))).toEqual(expect.arrayContaining(['cache','failed']));
 },{...queries(),'timeline.read:timeline-a':t,'render.list':{jobs},'render.plan:cache':{kind:'derived',executionOwner:'cache-owner'},'render.plan:failed':{kind:'render',executionOwner:'fixed-owner',timelineRef:{id:t.id,revision:1},purpose:'mp4'},'media.derived:cache':{recipe:{fps:t.fps,canvas:t.canvas,videoFit:'contain'},entries:[{ref,kind:'proxy',mime:'video/mp4'}]}});
});

it('bounds waveform authorization bursts and cancels waiting reads when tracks unmount',async()=>{
 const audio=Array.from({length:6},(_,i)=>({id:'q'+i,kind:'audio',track:'voice',media:{kind:'assetVersion',libraryId:'library',assetId:'q'+i,version:1},sourceHash:i.toString(16).padStart(64,'0'),sourceProbeId:'probe',sourceInTicks:0,startTicks:i*48000,durationTicks:48000,gainMilli:1000,mute:false}));
 const entries=audio.map((a,i)=>({kind:'waveform',mime:'application/json',ref:{libraryId:'library',cacheId:i.toString(16).padStart(64,'0'),sourceHash:a.sourceHash,recipeHash:'a'.repeat(64)}}));
 await mounted(h,async page=>{
  await page.getByText('读取授权波形…',{exact:true}).first().waitFor();
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='derivedMediaUrl').length)).toBe(4);
  await page.evaluate(()=>{window.p4Fixture.unmount();window.p4Fixture.releaseWaveformAuthorizations();});
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  expect(await page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='derivedMediaUrl').length)).toBe(4);
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='releaseMediaUrl').length)).toBe(4);
 },{...queries(),__tracks:{...timeline,videoClips:[],audioClips:audio},__trackEntries:entries,__holdWaveformAuthorizations:true});
});


function derivedPlan(planId:string){return {kind:'derived',libraryId:'library',projectId:'project',planId,planHash:'a'.repeat(64),expiresAt:Date.now()+120000,executionOwner:'desktop-user',runId:'run-'+planId,manifest:{entries:[],runtimeHash:'b'.repeat(64),fontHash:'c'.repeat(64)},estimatedBytes:1024,requiredFreeBytes:1073742848,fps:timeline.fps,canvas:timeline.canvas,recipeHash:'d'.repeat(64),videoFit:'contain'};}
function proxyJob(jobId:string,planId:string,state:string){return {libraryId:'library',projectId:'project',jobId,planId,kind:'derived',state,phase:state.toLowerCase(),progressTicks:0,cancelRequested:false,needsResume:state==='INTERRUPTED',attempt:1,history:[],errorCode:state==='FAILED'?'LOCAL_PROCESS_FAILED':null,outputRef:null,derived:[]};}
async function approveBatch(page:any,index:number,planId:string,jobId:string,n:number){
 await page.getByRole('button',{name:index===1?/^准备编辑预览/:'准备编辑代理第 '+index+' 批',exact:index!==1}).click();await calls(page,n);
 await page.evaluate((p:any)=>window.p4Fixture.resolve(p),derivedPlan(planId));
 await page.getByLabel('确认磁盘占用与固定版本',{exact:true}).check();await page.getByRole('button',{name:'批准本机处理',exact:true}).click();await calls(page,n+1);
 await page.evaluate((ref:any)=>window.p4Fixture.resolve(ref),{libraryId:'library',projectId:'project',jobId});
}
it('shows post-enqueue proxy states and retries only the failed batch using its fixed plan',async()=>{
 await mounted(h,async page=>{
  await approveBatch(page,1,'p1','j1',1);
  const row1=page.getByRole('button',{name:'准备编辑代理第 1 批',exact:true}).locator('..');
  expect(await row1.getByRole('button',{name:'准备编辑代理第 1 批',exact:true}).isDisabled()).toBe(true);
  for(const [state,label]of [['QUEUED','排队中'],['RUNNING','执行中'],['SUCCEEDED','成功']]){
   await page.evaluate(job=>window.p4Fixture.update({'render.list':{jobs:[job]}}),proxyJob('j1','p1',state!));
   await expect.poll(()=>row1.textContent()).toContain(label);
  }
  await approveBatch(page,2,'p2','j2',3);
  await page.evaluate(jobs=>window.p4Fixture.update({'render.list':{jobs}}),[proxyJob('j1','p1','SUCCEEDED'),proxyJob('j2','p2','FAILED')]);
  await page.getByRole('button',{name:'重试编辑代理第 2 批',exact:true}).click();await calls(page,5);
  expect(await page.evaluate(()=>window.p4Fixture.calls[4])).toMatchObject({kind:'render.retry',payload:{jobId:'j2',executionOwner:'desktop-user'}});
  await page.evaluate(()=>window.p4Fixture.resolve({libraryId:'library',projectId:'project',jobId:'j3'}));
  await page.evaluate(jobs=>window.p4Fixture.update({'render.list':{jobs}}),[proxyJob('j1','p1','SUCCEEDED'),proxyJob('j2','p2','FAILED'),proxyJob('j3','p2','RUNNING')]);
  const row2=page.getByRole('button',{name:'准备编辑代理第 2 批',exact:true}).locator('..');await expect.poll(()=>row2.textContent()).toContain('执行中');
  expect(await row1.getByRole('button',{name:'准备编辑代理第 1 批',exact:true}).isDisabled()).toBe(true);
  expect(await page.evaluate(()=>window.p4Fixture.calls.filter(c=>c.kind==='media.enqueueDerived').length)).toBe(2);
 },data(65));
});
it('follows a new proxy attempt started in the local job panel instead of the stale failed job',async()=>{
 await mounted(h,async page=>{
  await approveBatch(page,1,'panel-plan','panel-old',1);
  await page.evaluate(job=>window.p4Fixture.update({'render.list':{jobs:[job]},'render.plan:panel-plan':{kind:'derived',executionOwner:'desktop-user'}}),proxyJob('panel-old','panel-plan','FAILED'));
  await page.getByText('本机处理与导出状态',{exact:true}).click();await page.getByRole('button',{name:'新尝试（同一固定计划）',exact:true}).click();await calls(page,3);
  await page.evaluate(()=>window.p4Fixture.resolve({libraryId:'library',projectId:'project',jobId:'panel-new'}));
  await page.evaluate(jobs=>window.p4Fixture.update({'render.list':{jobs}}),[proxyJob('panel-old','panel-plan','FAILED'),proxyJob('panel-new','panel-plan','SUCCEEDED')]);
  const row=page.getByRole('button',{name:'准备编辑代理第 1 批',exact:true}).locator('..');await expect.poll(()=>row.textContent()).toContain('成功');
  expect(await page.evaluate(()=>window.p4Fixture.calls.filter(c=>c.kind==='media.enqueueDerived').length)).toBe(1);
 },data(65));
});

it('cancels and resumes the bound proxy job without preparing another batch',async()=>{
 await mounted(h,async page=>{
  await approveBatch(page,1,'control-plan','control-job',1);
  const row=page.getByRole('group',{name:'编辑代理第 1 批',exact:true});
  await page.evaluate(job=>window.p4Fixture.update({'render.list':{jobs:[job]}}),proxyJob('control-job','control-plan','RUNNING'));
  await row.getByRole('button',{name:'取消编辑代理第 1 批',exact:true}).click();await calls(page,3);
  expect(await page.evaluate(()=>window.p4Fixture.calls[2])).toMatchObject({kind:'render.cancel',payload:{jobId:'control-job',executionOwner:'desktop-user'}});await page.evaluate(()=>window.p4Fixture.resolve(undefined));
  await page.evaluate(job=>window.p4Fixture.update({'render.list':{jobs:[job]}}),proxyJob('control-job','control-plan','CANCELLED'));await expect.poll(()=>row.textContent()).toContain('已取消');
  await page.evaluate(job=>window.p4Fixture.update({'render.list':{jobs:[job]}}),proxyJob('control-job','control-plan','INTERRUPTED'));await expect.poll(()=>row.textContent()).toContain('已中断');
  await row.getByRole('button',{name:'继续编辑代理第 1 批',exact:true}).click();await calls(page,4);expect(await page.evaluate(()=>window.p4Fixture.calls[3])).toMatchObject({kind:'render.resume',payload:{jobId:'control-job',executionOwner:'desktop-user'}});await page.evaluate(()=>window.p4Fixture.resolve(undefined));
  expect(await page.evaluate(()=>window.p4Fixture.calls.filter(c=>c.kind==='media.prepareDerived').length)).toBe(1);
 },data(65));
});
it('ignores a late enqueue acknowledgement after connection change while a new plan is prepared',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:/^准备编辑预览/}).click();await calls(page,1);await page.evaluate(plan=>window.p4Fixture.resolve(plan),derivedPlan('old-epoch'));
  await page.getByLabel('确认磁盘占用与固定版本',{exact:true}).check();await page.getByRole('button',{name:'批准本机处理',exact:true}).click();await calls(page,2);
  await page.evaluate(()=>window.p4Fixture.update({__connectionEpoch:'new-epoch'}));await expect.poll(()=>page.getByRole('dialog').count()).toBe(0);
  await page.getByRole('button',{name:/^准备编辑预览/}).click();await calls(page,3);
  await page.evaluate(()=>window.p4Fixture.resolve({libraryId:'library',projectId:'project',jobId:'old-epoch-job'}));await page.evaluate(plan=>window.p4Fixture.resolve(plan),derivedPlan('new-epoch'));
  await page.getByRole('dialog').waitFor();const row=page.getByRole('group',{name:'编辑代理第 1 批',exact:true});await expect.poll(()=>row.textContent()).toContain('待确认');
  expect(await page.evaluate(()=>window.p4Fixture.calls.filter(c=>c.kind==='media.enqueueDerived').length)).toBe(1);
 },data(65));
});

it('observes waveform queue and cache release when the track owner unmounts',async()=>{
 const audio=Array.from({length:6},(_,i)=>({id:'m'+i,kind:'audio',track:'voice',media:{kind:'assetVersion',libraryId:'library',assetId:'m'+i,version:1},sourceHash:i.toString(16).padStart(64,'0'),sourceProbeId:'probe',sourceInTicks:0,startTicks:i*48000,durationTicks:48000,gainMilli:1000,mute:false}));
 const entries=audio.map(a=>({kind:'waveform',mime:'application/json',ref:{libraryId:'library',cacheId:a.sourceHash,sourceHash:a.sourceHash,recipeHash:'a'.repeat(64)}})),waves=Object.fromEntries(entries.map(e=>[e.ref.cacheId,{sampleRate:48000,bucketRate:60,peaks:Array(60).fill(.25)}]));
 await mounted(h,async page=>{
  await page.evaluate(()=>{(window as any).readStats=[];window.addEventListener('movieagent:timeline-read-stats',e=>(window as any).readStats.push((e as CustomEvent).detail));});
  await page.evaluate(data=>window.p4Fixture.mount(data),{...queries(),__tracks:{...timeline,videoClips:[],audioClips:audio},__trackEntries:entries,__waveforms:waves});
  await page.getByRole('img',{name:'音频波形 m5',exact:true}).waitFor();
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='releaseMediaUrl').length)).toBe(6);
  await expect.poll(()=>page.evaluate(()=>(window as any).readStats.some((s:any)=>s.kind==='queue'&&s.active>0))).toBe(true);
  await page.evaluate(()=>window.p4Fixture.unmount());await expect.poll(()=>page.evaluate(()=>(window as any).readStats.filter((s:any)=>s.kind==='cache').at(-1)?.size)).toBe(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).readStats.filter((s:any)=>s.kind==='queue').at(-1))).toEqual({kind:'queue',active:0,queued:0});
 },{...queries(),__waveforms:waves});
});
