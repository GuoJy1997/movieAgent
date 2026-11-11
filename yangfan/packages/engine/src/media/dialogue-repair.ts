import type { MediaProbe, MediaRuntime } from '../../../contracts/src/media-info.ts';
import { fail, ok, type Result } from '../../../contracts/src/result.ts';
import { assertStagedFile, compileMediaProcess, runMediaProcess } from './process.ts';
import { probeMediaFile,verifyAudioDecode } from './probe.ts';
import { hashMediaFile, type VerifiedRenderOutput } from './verify.ts';

export interface DialogueFrameRate {num:number;den:number}
const validRate=(rate:DialogueFrameRate)=>Number.isSafeInteger(rate.num)&&rate.num>0&&Number.isSafeInteger(rate.den)&&rate.den>0;
/** A single target frame must come from fixed probe facts, never a caller's default. */
export function dialogueFrameRate(probe:MediaProbe):Result<DialogueFrameRate>{
  const video=probe.streams.filter(stream=>stream.kind==='video');
  if(video.length!==1||video[0]!.variableFrameRate===true)return fail('DIALOGUE_FRAME_RATE_REQUIRED','需要固定视频的有效帧率。');
  const text=video[0]!.averageFrameRate;
  if(typeof text!=='string'||!/^\d+\/[1-9]\d*$/.test(text))return fail('DIALOGUE_FRAME_RATE_REQUIRED','需要固定视频的有效帧率。');
  const [num,den]=text.split('/').map(Number),rate={num:num!,den:den!};
  return validRate(rate)?ok(rate):fail('DIALOGUE_FRAME_RATE_REQUIRED','需要固定视频的有效帧率。');
}
export async function verifyDialogueRepair(input: { runtime: MediaRuntime; path: string; stagingRoot: string; expectedDurationTicks: number; fps?: number|DialogueFrameRate;signal?:AbortSignal;requireAudio?:boolean }): Promise<Result<VerifiedRenderOutput>> {
  const { runtime, path, stagingRoot, expectedDurationTicks } = input;
  const signal=input.signal??new AbortController().signal;
  const suppliedRate=typeof input.fps==='number'?{num:input.fps,den:1}:input.fps;
  if (!Number.isSafeInteger(expectedDurationTicks) || expectedDurationTicks <= 0 || expectedDurationTicks > 15 * 48000 || suppliedRate!==undefined&&!validRate(suppliedRate)) return fail('INVALID_INPUT', '口型修正验收参数无效。');
  try { await assertStagedFile(stagingRoot, path); } catch { return fail('INVALID_STAGING_PATH', '口型修正产物暂存无效。'); }
  const hashed = await hashMediaFile(path, 64 * 1024 * 1024, signal); if (!hashed.ok) return hashed;
  const probe = await probeMediaFile(runtime, path, stagingRoot, hashed.value.hash,signal); if (!probe.ok) return probe;
  const target=suppliedRate?ok(suppliedRate):dialogueFrameRate(probe.value);if(!target.ok)return target;
  if(input.requireAudio){if(!probe.value.hasAudio)return fail('DIALOGUE_AUDIO_MISSING','原生对白产物没有音轨。');const audio=await verifyAudioDecode(runtime,path,stagingRoot,signal);if(!audio.ok)return audio;}
  const video = probe.value.streams.filter(stream => stream.kind === 'video');
  if (video.length !== 1 || BigInt(Math.abs(video[0]!.durationTicks - expectedDurationTicks))*BigInt(target.value.num)>48000n*BigInt(target.value.den)) return fail('DIALOGUE_ALIGNMENT_FAILED', '口型修正画面的时长与固定输入不一致。');
  const decoded = await runMediaProcess(compileMediaProcess({ tool: 'ffmpeg', runtime, stagingRoot, timeoutMs: 30000, maxStdoutBytes: 4096, args: [
    '-v', 'error', '-nostdin', '-xerror', '-threads', '4', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov', '-max_streams', '4', '-i', path, '-map', '0:v:0', '-an', '-sn', '-dn', '-threads', '4', '-f', 'null', '-',
  ] }), signal);
  if (!decoded.ok) return decoded;
  const rehashed = await hashMediaFile(path, 64 * 1024 * 1024, signal); if (!rehashed.ok) return rehashed;
  if (rehashed.value.hash !== hashed.value.hash) return fail('OBJECT_INTEGRITY_FAILED', '口型修正产物在验收期间改变。');
  return ok({ ...hashed.value, mime: 'video/mp4', width: probe.value.width, height: probe.value.height, probe: probe.value });
}
