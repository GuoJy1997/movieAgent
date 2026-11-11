import { expect,it } from 'vitest';
import { mkdtemp,mkdir,readFile,copyFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { probeMediaFile } from '../../packages/engine/src/media/probe.ts';
import { buildDerived } from '../../packages/engine/src/media/derived.ts';
import type { DerivedMediaPlan,ResolvedMedia } from '../../packages/contracts/src/render.ts';
const unwrap=<T>(r:import('../../packages/contracts/src/result.ts').Result<T>)=>{if(!r.ok)throw Error(r.error.code);return r.value;};
it('bakes explicit contain and cover for portrait-to-landscape and landscape-to-portrait proxies',async()=>{
 const root=await mkdtemp(join(tmpdir(),'derived-fit-'));
 try {
  const runtime=unwrap(await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64')));
  for(const [i,dimensions,canvas] of [[0,'32x64',{width:1920,height:1080}],[1,'64x32',{width:1080,height:1920}]] as const){
   const input=join(root,`source${i}.mp4`),encoded=spawnSync(runtime.ffmpegPath,['-v','error','-y','-f','lavfi','-i',`color=red:s=${dimensions}:r=30`,'-frames:v','4','-c:v','libx264','-threads','4','-pix_fmt','yuv420p',input],{shell:false,windowsHide:true,maxBuffer:1024**2});expect(encoded.status,String(encoded.stderr)).toBe(0);
   const bytes=await readFile(input),hash=createHash('sha256').update(bytes).digest('hex'),probe=unwrap(await probeMediaFile(runtime,input,root,hash));
   const media:ResolvedMedia={ref:{kind:'assetVersion',libraryId:'library',assetId:'source',version:1},hash,mime:'video/mp4',byteLength:bytes.length,width:probe.width,height:probe.height,probe};
   for(const videoFit of ['contain','cover'] as const){
    const directory=join(root,`${i}-${videoFit}`);await mkdir(directory);const staged=join(directory,'source.mp4');await copyFile(input,staged);
    const plan:DerivedMediaPlan={kind:'derived',libraryId:'library',projectId:'project',planId:'plan',planHash:'a'.repeat(64),recipeHash:'b'.repeat(64),expiresAt:Date.now()+600000,executionOwner:'user',runId:'run',manifest:{entries:[media],runtimeHash:runtime.runtimeHash,fontHash:runtime.fontManifest.sha256},fps:{num:30,den:1},canvas,videoFit,estimatedBytes:1,requiredFreeBytes:1024**3+1};
    const outputs=await buildDerived(plan,media,runtime,directory,staged,new AbortController().signal,()=>{});
    const decoded=spawnSync(runtime.ffmpegPath,['-v','error','-i',outputs[0]!.path,'-frames:v','1','-vf','scale=96:96,format=gray','-f','rawvideo','-'],{shell:false,windowsHide:true,maxBuffer:1024**2});expect(decoded.status,String(decoded.stderr)).toBe(0);
    const edge=i===0?48*96+2:2*96+48,center=48*96+48;
    expect(decoded.stdout[center]).toBeGreaterThan(50);
    if(videoFit==='contain')expect(decoded.stdout[edge]).toBeLessThan(10);else expect(decoded.stdout[edge]).toBeGreaterThan(50);
   }
  }
 } finally {await rm(root,{recursive:true,force:true});}
});
