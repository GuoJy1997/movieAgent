import{afterEach,expect,it,vi}from'vitest';
import{mkdtemp,writeFile,rm,readdir}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
const capture=vi.hoisted(()=>({args:[] as string[][],after:undefined as (()=>void)|undefined}));
vi.mock('../../packages/engine/src/media/process.ts',async()=>{const actual=await vi.importActual<any>('../../packages/engine/src/media/process.ts');return {...actual,compileMediaProcess:(v:any)=>v,runMediaProcess:async(v:any,signal:AbortSignal)=>{if(signal.aborted)return {ok:false,error:{code:'MEDIA_CANCELLED',message:'cancelled'}};capture.args.push(v.args);const t=Number(v.args[v.args.indexOf('-t')+1]),raw=v.args.includes('f32le');await writeFile(v.args.at(-1),raw?Buffer.alloc(Math.round(t*48000)*8):Buffer.from('fixture'));capture.after?.();return {ok:true,value:{exitCode:0,stdout:'',stderr:''}};}};});
import{isRenderPlan,isDerivedMediaPlan}from'../../packages/contracts/src/render.ts';import{segmentRenderPlan,windowTimeline}from'../../packages/engine/src/media/render-segments.ts';
import{renderMedia}from'../../packages/engine/src/media/compile.ts';import{compileRenderPlan}from'../../packages/domain/src/render-plan.ts';import{DEFAULT_SUBTITLE_STYLE}from'../../packages/contracts/src/timeline.ts';
const roots:string[]=[];afterEach(async()=>{capture.args=[];capture.after=undefined;for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(count:number){const root=await mkdtemp(join(tmpdir(),'render-capacity-'));roots.push(root);const runtime={runtimeHash:'a'.repeat(64),ffmpegPath:join(root,'ffmpeg.exe'),ffprobePath:join(root,'ffprobe.exe'),fontManifest:{file:'font.otf',family:'Noto',version:'1',sha256:'b'.repeat(64)}};const entries=Array.from({length:count},(_,i)=>({ref:{kind:'assetVersion' as const,libraryId:'library',assetId:'p'+i,version:1},hash:i.toString(16).padStart(64,'0'),mime:'image/png',byteLength:1,width:8,height:8,probe:null}));const clips=entries.map((m,i)=>({id:'v'+i,kind:'image' as const,media:m.ref,sourceHash:m.hash,sourceProbeId:null,sourceInTicks:0,startTicks:i*1600,durationTicks:1600,fit:'contain' as const,gainMilli:1000,mute:true}));const timeline={libraryId:'library',projectId:'project',id:'cut',revision:1,scriptRef:{id:'script',revision:1},title:'dense',fps:{num:30 as const,den:1 as const},canvas:{width:1920 as const,height:1080 as const},timebase:48000 as const,videoClips:clips,audioClips:[],subtitleCues:[],subtitleStyle:DEFAULT_SUBTITLE_STYLE,createdAt:new Date().toISOString()};const p=compileRenderPlan(timeline,{entries,runtimeHash:runtime.runtimeHash,fontHash:runtime.fontManifest.sha256},{purpose:'mp4',executionOwner:'human',runId:'run'});if(!p.ok)throw Error(p.error.code);const inputs=await Promise.all(entries.map(async(_,i)=>{const path=join(root,'input'+i+'.png');await writeFile(path,'x');return path;}));return {root,runtime,plan:p.value,inputs};}
it('renders 33 independent sources with bounded process input count and one final output',async()=>{const f=await fixture(33);expect((await renderMedia(f.plan,f.runtime,f.root,f.inputs,join(f.root,'output.mp4'),new AbortController().signal)).ok).toBe(true);expect(Math.max(...capture.args.map(a=>a.filter(x=>x==='-i').length))).toBeLessThanOrEqual(32);expect(capture.args.length).toBeGreaterThan(1);expect(capture.args.some(a=>a.includes('pcm_f32le'))).toBe(true);expect(capture.args.filter(a=>a.at(-1)?.endsWith('.mp4')&&a.at(-1)!==join(f.root,'output.mp4')).every(a=>a.includes('-an'))).toBe(true);});
it('retains the small render path at 32 sources and does not start after cancellation',async()=>{const f=await fixture(32);expect((await renderMedia(f.plan,f.runtime,f.root,f.inputs,join(f.root,'output.mp4'),new AbortController().signal)).ok).toBe(true);expect(capture.args).toHaveLength(1);const c=new AbortController();c.abort();expect(await renderMedia(f.plan,f.runtime,f.root,f.inputs,join(f.root,'cancelled.mp4'),c.signal)).toMatchObject({ok:false,error:{code:'MEDIA_CANCELLED'}});expect(capture.args).toHaveLength(1);});

it('estimates actual staged files rather than unpersisted full-resolution frames',async()=>{
 const f=await fixture(150),t={...f.plan.timeline,videoClips:f.plan.timeline.videoClips.map((c,i)=>({...c,startTicks:i*96000,durationTicks:96000}))};
 const p=compileRenderPlan(t,f.plan.manifest,{purpose:'mp4',executionOwner:'human',runId:'long'});if(!p.ok)throw Error(p.error.code);
 expect(p.value.requiredFreeBytes).toBeLessThan(5*1024**3);
});

it('freezes a user-selected 8 GiB intermediate allowance in the render plan',async()=>{
 const f=await fixture(33),p=compileRenderPlan(f.plan.timeline,f.plan.manifest,{purpose:'mp4',executionOwner:'human',runId:'budget',intermediateBudgetBytes:8*1024**3});
 if(!p.ok)throw Error(p.error.code);expect(p.value.intermediateBudgetBytes).toBe(8*1024**3);
 expect(p.value.requiredFreeBytes).toBeGreaterThan(9*1024**3);
});

it('validates 768 render manifest entries while retaining the 64-entry derived limit',async()=>{
 const f=await fixture(32),entries=Array.from({length:769},(_,i)=>({...f.plan.manifest.entries[0]!,ref:{kind:'assetVersion' as const,libraryId:f.plan.libraryId,assetId:'ref'+i,version:1},hash:i.toString(16).padStart(64,'0')}));
 expect(isRenderPlan({...f.plan,manifest:{...f.plan.manifest,entries:entries.slice(0,768)}})).toBe(true);
 expect(isRenderPlan({...f.plan,manifest:{...f.plan.manifest,entries}})).toBe(false);
 const {timeline,timelineRef,compositionHash,purpose,durationTicks,maxOutputBytes,notices,policy,intermediateBudgetBytes,...base}=f.plan;
 expect(isDerivedMediaPlan({...base,kind:'derived',fps:timeline.fps,canvas:timeline.canvas,recipeHash:'a'.repeat(64),manifest:{...f.plan.manifest,entries:entries.slice(0,65)}})).toBe(false);
});
it('cuts frame-aligned 24/25 fps windows without losing source offsets or crossing cues',async()=>{
 const f=await fixture(33);
 for(const fps of [24,25] as const){
  const frame=48000/fps,t={...f.plan.timeline,fps:{num:fps,den:1 as const},videoClips:f.plan.timeline.videoClips.map((c,i)=>({...c,startTicks:i*frame,durationTicks:frame})),subtitleCues:[{id:'cue',startTicks:30*frame,endTicks:33*frame,text:'跨段字幕'}]},p={...f.plan,timeline:t,durationTicks:33*frame},w=segmentRenderPlan(p);
  expect(w.ok).toBe(true);if(!w.ok)continue;
  expect(w.value[0]!.startTicks).toBe(0);expect(w.value.at(-1)!.endTicks).toBe(p.durationTicks);
  for(const s of w.value){expect(s.startTicks%frame).toBe(0);expect(s.endTicks%frame).toBe(0);expect(s.indices.length).toBeLessThanOrEqual(32);}
  const crop=windowTimeline({...t,audioClips:[{id:'a',kind:'audio',track:'voice',media:t.videoClips[0]!.media,sourceHash:'a'.repeat(64),sourceProbeId:'probe',sourceInTicks:123,startTicks:0,durationTicks:33*frame,gainMilli:1000,mute:false}]},32*frame,33*frame);
  expect(crop.audioClips[0]!.sourceInTicks).toBe(123+32*frame);expect(crop.subtitleCues[0]).toMatchObject({startTicks:0,endTicks:frame});
 }
});
it('cleans only owned segment files after cancellation and intermediate-budget failure',async()=>{
 const f=await fixture(33);await writeFile(join(f.root,'keep.txt'),'owned by user');
 const c=new AbortController();capture.after=()=>c.abort();
 expect(await renderMedia(f.plan,f.runtime,f.root,f.inputs,join(f.root,'cancelled.mp4'),c.signal)).toMatchObject({ok:false,error:{code:'MEDIA_CANCELLED'}});
 capture.after=undefined;
 expect(await renderMedia(f.plan,f.runtime,f.root,f.inputs,join(f.root,'budget.mp4'),new AbortController().signal,undefined,8)).toMatchObject({ok:false,error:{code:'MEDIA_STAGING_BUDGET'}});
 const names=await readdir(f.root);expect(names.filter(n=>n.startsWith('segments-'))).toEqual([]);expect(names).toContain('keep.txt');
});

it('limits each video segment to the remaining peak staging allowance before encoding',async()=>{
 const f=await fixture(33);expect((await renderMedia(f.plan,f.runtime,f.root,f.inputs,join(f.root,'budgeted.mp4'),new AbortController().signal,undefined,1000000)).ok).toBe(true);
 const first=capture.args[0]!;expect(Number(first[first.indexOf('-fs')+1])).toBeLessThan(1000000-32*1600*16+2);
});
