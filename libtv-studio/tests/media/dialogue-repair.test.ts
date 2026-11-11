import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import {dialogueFrameRate,verifyDialogueRepair} from '../../packages/engine/src/media/dialogue-repair.ts';

it('fully decodes repaired video, ignores embedded audio and enforces one-frame duration tolerance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dialogue-repair-'));
  try {
    const loaded = await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64'));
    expect(loaded.ok).toBe(true); if (!loaded.ok) return;
    const runtime = loaded.value, output = join(root, 'repair.mp4');
    expect(spawnSync(runtime.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=32x32:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output], { shell: false, windowsHide: true }).status).toBe(0);
    const module = await import('../../packages/engine/src/media/dialogue-repair.ts');
    expect(module.verifyDialogueRepair).toBeTypeOf('function');
    const valid = await module.verifyDialogueRepair!({ runtime, path: output, stagingRoot: root, expectedDurationTicks: 48000, fps: 30 });
    expect(valid, JSON.stringify(valid)).toMatchObject({ ok: true, value: { mime: 'video/mp4' } });
    const wrongDuration = await module.verifyDialogueRepair!({ runtime, path: output, stagingRoot: root, expectedDurationTicks: 2 * 48000, fps: 30 });
    expect(wrongDuration).toMatchObject({ ok: false, error: { code: 'DIALOGUE_ALIGNMENT_FAILED' } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('uses exact rational output frame facts for native verification and fails closed on invalid facts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dialogue-rational-'));
 try{
  const loaded=await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64'));expect(loaded.ok).toBe(true);if(!loaded.ok)return;
  const runtime=loaded.value,path=join(root,'rational.mp4');
  expect(spawnSync(runtime.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=red:s=32x32:r=30000/1001','-frames:v','30','-c:v','libx264','-pix_fmt','yuv420p',path],{shell:false,windowsHide:true}).status).toBe(0);
  const accepted=await verifyDialogueRepair({runtime,path,stagingRoot:root,expectedDurationTicks:46447});expect(accepted.ok,JSON.stringify(accepted)).toBe(true);if(!accepted.ok)return;
  expect(accepted.value.probe.durationTicks).toBe(48048);expect(dialogueFrameRate(accepted.value.probe)).toEqual({ok:true,value:{num:30000,den:1001}});
  expect(await verifyDialogueRepair({runtime,path,stagingRoot:root,expectedDurationTicks:46446})).toMatchObject({ok:false,error:{code:'DIALOGUE_ALIGNMENT_FAILED'}});
  for(const averageFrameRate of [undefined,'0/0','-1/1','NaN','9007199254740992/1'])expect(dialogueFrameRate({...accepted.value.probe,streams:accepted.value.probe.streams.map(stream=>({...stream,averageFrameRate}))})).toMatchObject({ok:false,error:{code:'DIALOGUE_FRAME_RATE_REQUIRED'}});
 }finally{await rm(root,{recursive:true,force:true});}
});
