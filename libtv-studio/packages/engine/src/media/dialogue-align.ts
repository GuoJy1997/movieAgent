import type { MediaRuntime } from '../../../contracts/src/media-info.ts';
import { fail, ok, type Result } from '../../../contracts/src/result.ts';
import { compileMediaProcess, runMediaProcess } from './process.ts';
import { probeMediaFile, verifyAudioDecode } from './probe.ts';
import { hashMediaFile } from './verify.ts';

export async function alignDialogueMedia(input: { runtime: MediaRuntime; video: string; audio: string; output: string; stagingRoot: string; startTicks: number; durationTicks: number;signal?:AbortSignal }): Promise<Result<{ hash: string; durationTicks: number }>> {
  const { runtime, video, audio, output, stagingRoot, startTicks, durationTicks } = input;
  const signal=input.signal??new AbortController().signal;
  if (!Number.isSafeInteger(startTicks) || startTicks < 0 || !Number.isSafeInteger(durationTicks) || durationTicks <= 0 || durationTicks > 15 * 48000) return fail('INVALID_DIALOGUE_ALIGNMENT', '口型对齐范围无效。');
  const videoProbe = await probeMediaFile(runtime, video, stagingRoot, '0'.repeat(64),signal);
  if (!videoProbe.ok) return videoProbe;
  const audioProbe = await probeMediaFile(runtime, audio, stagingRoot, '0'.repeat(64),signal);
  if (!audioProbe.ok) return audioProbe;
  if (audioProbe.value.durationTicks > durationTicks || startTicks + durationTicks > videoProbe.value.durationTicks) return fail('AUDIO_TOO_LONG', '配音或入点超出视频范围，不自动截断。');
  const aligned = await runMediaProcess(compileMediaProcess({ tool: 'ffmpeg', runtime, stagingRoot, timeoutMs: 30000, maxStdoutBytes: 4096, args: [
    '-v', 'error', '-nostdin', '-y', '-xerror', '-threads', '4', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'wav,mp3,mov', '-max_streams', '4', '-i', audio,
    '-af', `aresample=48000,adelay=${startTicks}S:all=1,apad=whole_len=${startTicks+durationTicks}`, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', '-f', 'wav', output,
  ] }), signal);
  if (!aligned.ok) return aligned;
  const decoded = await verifyAudioDecode(runtime, output, stagingRoot,signal);
  if (!decoded.ok) return decoded;
  const hashed = await hashMediaFile(output, 4 * 1024 * 1024, signal);
  if (!hashed.ok) return hashed;
  const probe = await probeMediaFile(runtime, output, stagingRoot, hashed.value.hash,signal);
  if (!probe.ok || Math.abs(probe.value.durationTicks - (startTicks + durationTicks)) > 2000) return fail('DIALOGUE_ALIGNMENT_FAILED', '补静音后的时长不符合目标。');
  return ok({ hash: hashed.value.hash, durationTicks: startTicks + durationTicks });
}
