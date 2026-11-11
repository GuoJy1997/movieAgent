import { afterAll,beforeAll,expect,it } from 'vitest';
import { harness,mounted,queries,timeline } from './p4-harness.ts';
import { waveformPeaks } from '../../apps/desktop/src/renderer/features/timeline/TimelineWaveform.tsx';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();});afterAll(async()=>{await h?.browser.close();await h?.server.close();});
it('validates the fixed waveform schema and 36000 finite peak bound',()=>{
 expect(waveformPeaks({bucketRate:60,sampleRate:48000,peaks:Array(36000).fill(.5)})).toHaveLength(36000);
 for(const extra of [{peaks:Array(36001).fill(0)},{peaks:[NaN]},{peaks:[Infinity]},{peaks:[-.1]},{peaks:[1.01]},{bucketRate:30},{sampleRate:44100},{rawPCM:[]}])expect(()=>waveformPeaks({bucketRate:60,sampleRate:48000,peaks:[0,1],...extra})).toThrow();
});
it('selects only a fixed matching fps/canvas/fit proxy and preserves both explicit variants',async()=>{
 const hash=timeline.videoClips[0]!.sourceHash,ref=(n:string)=>({libraryId:'library',cacheId:n.repeat(64),sourceHash:hash,recipeHash:n.repeat(64)});
 const t={...timeline,videoClips:[{...timeline.videoClips[0]!,kind:'video',sourceProbeId:'probe',fit:'cover'}]};
 const plans=[['old-fps',{fps:{num:24,den:1},canvas:t.canvas,videoFit:'cover'},ref('b')],['old-canvas',{fps:t.fps,canvas:{width:1080,height:1920},videoFit:'cover'},ref('c')],['contain',{fps:t.fps,canvas:t.canvas,videoFit:'contain'},ref('d')],['cover',{fps:t.fps,canvas:t.canvas,videoFit:'cover'},ref('e')]] as const;
 const jobs=plans.map(([id])=>({jobId:id,planId:id,kind:'derived',state:'SUCCEEDED',history:[]}));
 const data={...queries(),'timeline.read:timeline-a':t,'render.list':{jobs},...Object.fromEntries(plans.map(([id,recipe,ref])=>[`media.derived:${id}`,{recipe,entries:[{ref,kind:'proxy',mime:'video/mp4'}]}]))};
 await mounted(h,async page=>{
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='derivedMediaUrl').map(c=>(c.payload as {cacheId:string}).cacheId))).toEqual(['e'.repeat(64)]);
  await page.getByRole('button',{name:'选择片段 clip-a',exact:true}).click();await page.getByLabel('画面适配',{exact:true}).selectOption('contain');
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='derivedMediaUrl').at(-1)?.payload)).toMatchObject({cacheId:'d'.repeat(64)});
  await page.getByLabel('画面适配',{exact:true}).selectOption('cover');await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='derivedMediaUrl').at(-1)?.payload)).toMatchObject({cacheId:'e'.repeat(64)});
  expect(await page.locator('.timeline-preview video').evaluate(el=>getComputedStyle(el).objectFit)).toBe('fill');
 },data);
 await mounted(h,async page=>{
  await page.getByText('准备编辑预览：缺少兼容代理（帧率、画幅、适配）',{exact:true}).waitFor();expect(await page.locator('.timeline-preview video').count()).toBe(0);expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  await page.evaluate(jobs=>window.p4Fixture.update({'render.list':{jobs}}),jobs);await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='derivedMediaUrl').at(-1)?.payload)).toMatchObject({cacheId:'e'.repeat(64)});
  await page.getByLabel('编辑代理画面适配',{exact:true}).selectOption('cover');await page.getByRole('button',{name:'准备编辑预览（裁切铺满）',exact:true}).click();await page.waitForFunction(()=>window.p4Fixture.calls.length===1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'media.prepareDerived',payload:{videoFit:'cover',fps:t.fps,canvas:t.canvas}});
  await page.evaluate(()=>window.p4Fixture.resolve(undefined));await page.getByLabel('编辑代理画面适配',{exact:true}).selectOption('contain');await page.getByRole('button',{name:'准备编辑预览（完整包含）',exact:true}).click();await page.waitForFunction(()=>window.p4Fixture.calls.length===2);expect(await page.evaluate(()=>window.p4Fixture.calls[1])).toMatchObject({kind:'media.prepareDerived',payload:{videoFit:'contain'}});
 },{...data,'render.list':{jobs:jobs.slice(0,3)}});
});
it('draws bounded authorized waveform peaks at source trim and timeline placement with explicit invalid/missing states',async()=>{
 const ref=(n:string,sourceHash:string)=>({libraryId:'library',cacheId:n.repeat(64),sourceHash,recipeHash:n.repeat(64)});
 const audio=(id:string,hash:string,start:number)=>({id,kind:'audio',track:'voice',media:{kind:'assetVersion',libraryId:'library',assetId:id,version:1},sourceHash:hash,sourceProbeId:'probe',sourceInTicks:1600,startTicks:start,durationTicks:1600,gainMilli:1000,mute:false});
 const good=ref('b','c'.repeat(64)),bad=ref('d','e'.repeat(64)),large=ref('a','1'.repeat(64));const t={...timeline,audioClips:[audio('good',good.sourceHash,48000),audio('bad',bad.sourceHash,96000),audio('missing','f'.repeat(64),144000),audio('over-bound',large.sourceHash,192000)]};
 await mounted(h,async page=>{
  const wave=page.getByRole('img',{name:'音频波形 good',exact:true});await wave.waitFor();
  expect(await wave.locator('rect').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('x'),n.getAttribute('height')]))).toEqual([['0','90'],['500','40']]);
  expect(await page.getByRole('button',{name:'选择片段 good',exact:true}).evaluate(el=>el.style.left)).toBe('24px');
  await page.getByRole('button',{name:'选择片段 good',exact:true}).click();await page.getByLabel('源入点（秒）',{exact:true}).fill('0.05');await page.getByLabel('片段时长（秒）',{exact:true}).fill(String(800/48000));await page.getByRole('button',{name:'采用入出点',exact:true}).click();
  await expect.poll(()=>wave.locator('rect').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('x'),n.getAttribute('height')]))).toEqual([['0','40']]);
  await expect.poll(()=>page.getByText('波形无效，请重新准备',{exact:true}).count()).toBe(2);await page.getByText('缺少波形，请明确准备编辑预览',{exact:true}).waitFor();
  expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
 },{...queries(),'timeline.read:timeline-a':t,'render.list':{jobs:[{jobId:'wave',planId:'wave',kind:'derived',state:'SUCCEEDED',history:[]}]},'media.derived:wave':{recipe:{fps:t.fps,canvas:t.canvas,videoFit:'contain'},entries:[{ref:good,kind:'waveform',mime:'application/json'},{ref:bad,kind:'waveform',mime:'application/json'},{ref:large,kind:'waveform',mime:'application/json'}]},__waveforms:{[good.cacheId]:{bucketRate:60,sampleRate:48000,peaks:[.1,.2,.9,.4]},[bad.cacheId]:{bucketRate:60,sampleRate:48000,peaks:[1.2]},[large.cacheId]:{bucketRate:60,sampleRate:48000,peaks:[0],padding:'x'.repeat(1024**2)}}});
});
it('shows missing proxy honestly without auto enqueue or fake video frame',async()=>{
 const data=queries(); const t={...timeline,videoClips:[{...timeline.videoClips[0]!,kind:'video',sourceProbeId:'probe'}]};
 await mounted(h,async page=>{
  await page.getByText('编辑预览 · 非正式校验',{exact:true}).waitFor();
  await page.getByText('准备编辑预览：缺少兼容代理（帧率、画幅、适配）',{exact:true}).waitFor();
  expect(await page.locator('.timeline-preview video').count()).toBe(0);
  expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
 },{...data,'timeline.read:timeline-a':t,'timeline.list':{timelines:[t]}});
});
it('renews proxy authorization after 120 seconds and stops old audio on rapid seek and timeline navigation',async()=>{
 const ref={libraryId:'library',cacheId:'b'.repeat(64),sourceHash:'c'.repeat(64),recipeHash:'d'.repeat(64)};
 const audio={id:'voice',kind:'audio',track:'voice',media:{kind:'assetVersion',libraryId:'library',assetId:'sound',version:1},sourceHash:ref.sourceHash,sourceProbeId:'probe',sourceInTicks:0,startTicks:0,durationTicks:180*48000,gainMilli:1000,mute:false};
 const t={...timeline,audioClips:[audio]},job={libraryId:'library',projectId:'project',jobId:'derived-job',planId:'derived-plan',kind:'derived',state:'SUCCEEDED',phase:'succeeded',progressTicks:0,attempt:1,needsResume:false,history:[],errorCode:null,derived:[ref]};
 await mounted(h,async page=>{
  await page.evaluate(()=>{const state={plays:0,pauses:0,loads:0};(window as unknown as {mediaState:typeof state}).mediaState=state;HTMLMediaElement.prototype.play=async function(){state.plays++;};HTMLMediaElement.prototype.pause=function(){state.pauses++;};HTMLMediaElement.prototype.load=function(){state.loads++;};});
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await expect.poll(async()=>({count:await page.locator('.timeline-preview audio').count(),status:await page.locator('.preview-audio-status').innerText()})).toEqual({count:1,status:'配音 · 100%'});
  const initialSource=await page.locator('.timeline-preview audio').getAttribute('src');
  await page.clock.fastForward(121000);
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='derivedMediaUrl').length)).toBeGreaterThan(1);
  await expect.poll(()=>page.locator('.timeline-preview audio').getAttribute('src')).not.toBe(initialSource);
  await page.getByLabel('预览播放头',{exact:true}).fill(String(20*48000));await page.getByLabel('预览播放头',{exact:true}).fill(String(25*48000));
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {mediaState:{pauses:number}}).mediaState.pauses)).toBeGreaterThan(1);
  await page.getByLabel('当前时间线',{exact:true}).selectOption('timeline-b');
  expect(await page.locator('.timeline-preview audio').count()).toBe(0);
  expect(await page.evaluate(()=>(window as unknown as {mediaState:{loads:number}}).mediaState.loads)).toBeGreaterThan(0);
 },{...queries(),'timeline.read:timeline-a':t,'render.list':{jobs:[job]},'media.derived:derived-plan':{recipe:{fps:t.fps,canvas:t.canvas,videoFit:'contain'},entries:[{ref,kind:'proxy',mime:'audio/wav'}]}});
});
it('export copy failure retries the same request without rendering again',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'导出',exact:true}).click();
  await page.getByLabel('导出格式',{exact:true}).selectOption('srt');
  await page.evaluate(()=>window.p4Fixture.setExport({ok:false,error:{code:'COPY_FAILED',message:'目录断开'}}));
  await page.getByRole('button',{name:'复制到短剧目录',exact:true}).click();
  await page.getByText('目录断开',{exact:true}).waitFor();
  await page.getByRole('button',{name:'仅重试复制',exact:true}).click();
  const copies=await page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='exportTimeline'));
  expect(copies).toHaveLength(2);expect(copies[0]?.payload).toEqual(copies[1]?.payload);
  expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
 });
});
it('applies gain above 100 percent through an audio gain node and closes it on navigation',async()=>{
 const ref={libraryId:'library',cacheId:'b'.repeat(64),sourceHash:'c'.repeat(64),recipeHash:'d'.repeat(64)};
 const audio={id:'voice',kind:'audio',track:'voice',media:{kind:'assetVersion',libraryId:'library',assetId:'sound',version:1},sourceHash:ref.sourceHash,sourceProbeId:'probe',sourceInTicks:0,startTicks:0,durationTicks:48000,gainMilli:1000,mute:false};
 const t={...timeline,audioClips:[audio]},job={libraryId:'library',projectId:'project',jobId:'derived-job',planId:'derived-plan',kind:'derived',state:'SUCCEEDED',phase:'succeeded',progressTicks:0,attempt:1,needsResume:false,history:[],errorCode:null,derived:[ref]};
 await mounted(h,async page=>{
  await page.evaluate(()=>{const state={gain:0,closed:0};(window as unknown as {gainState:typeof state}).gainState=state;window.AudioContext=class {destination={};currentTime=0;state='running';createMediaElementSource(){return {connect(){},disconnect(){}};}createGain(){return {gain:{setValueAtTime(value:number){state.gain=value;}},connect(){},disconnect(){}};}async resume(){}async close(){state.closed++;}} as unknown as typeof AudioContext;});
  await page.getByRole('button',{name:'选择片段 voice',exact:true}).click();
  await page.getByLabel('音量（%）',{exact:true}).fill('200');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {gainState:{gain:number}}).gainState.gain)).toBe(2);
  await page.getByLabel('当前时间线',{exact:true}).selectOption('timeline-b');await page.getByRole('button',{name:'放弃草稿并离开',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {gainState:{closed:number}}).gainState.closed)).toBe(1);
 },{...queries(),'timeline.read:timeline-a':t,'render.list':{jobs:[job]},'media.derived:derived-plan':{recipe:{fps:t.fps,canvas:t.canvas,videoFit:'contain'},entries:[{ref,kind:'proxy',mime:'audio/wav'}]}});
});
