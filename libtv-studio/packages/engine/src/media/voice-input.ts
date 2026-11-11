import type { MediaRuntime } from '../../../contracts/src/media-info.ts';
import { fail, ok, type Result } from '../../../contracts/src/result.ts';
import { compileMediaProcess, runMediaProcess } from './process.ts';
import { probeMediaFile, verifyAudioDecode } from './probe.ts';
import { hashMediaFile } from './verify.ts';
import { mediaStreamEndTicks } from '../../../domain/src/timeline-time.ts';

export interface PreparedVoiceInput { hash: string; mime: 'audio/wav'; byteLength: number; durationTicks: number; probeId: string }

export async function prepareVoiceInput(input: { runtime: MediaRuntime; input: string; output: string; stagingRoot: string; sourceInTicks: number; durationTicks: number; signal?: AbortSignal }): Promise<Result<PreparedVoiceInput>> {
  const { runtime, input: source, output, stagingRoot, sourceInTicks, durationTicks } = input;
  const signal = input.signal ?? new AbortController().signal;
  if (!Number.isSafeInteger(sourceInTicks) || sourceInTicks < 0 || !Number.isSafeInteger(durationTicks) || durationTicks < 2 * 48000 || durationTicks > 15 * 48000) return fail('INVALID_VOICE_REFERENCE', '声音裁切需2–15秒且在原件范围内。');
  const sourceProbe = await probeMediaFile(runtime, source, stagingRoot, '0'.repeat(64), signal);
  if (!sourceProbe.ok) return sourceProbe;
  if (sourceInTicks + durationTicks > mediaStreamEndTicks(sourceProbe.value, 'audio')) return fail('SOURCE_RANGE', '声音裁切超出原件范围。');
  const encoded = await runMediaProcess(compileMediaProcess({ tool: 'ffmpeg', runtime, stagingRoot, timeoutMs: 30000, maxStdoutBytes: 4096, args: [
    '-v', 'error', '-nostdin', '-y', '-xerror', '-copyts', '-threads', '4', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'wav,mp3,mov', '-max_streams', '4', '-i', source,
    '-map', '0:a:0', '-vn', '-sn', '-dn', '-ss', String(sourceInTicks / 48000), '-t', String(durationTicks / 48000), '-af', 'aresample=48000', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', '-f', 'wav', output,
  ] }), signal);
  if (!encoded.ok) return encoded;
  const decoded = await verifyAudioDecode(runtime, output, stagingRoot);
  if (!decoded.ok) return decoded;
  const hashed = await hashMediaFile(output, 4 * 1024 * 1024, signal);
  if (!hashed.ok) return hashed;
  const probe = await probeMediaFile(runtime, output, stagingRoot, hashed.value.hash, signal);
  if (!probe.ok) return probe;
  const stream = probe.value.streams.find(value => value.kind === 'audio');
  if (probe.value.container !== 'wav' || stream?.codec !== 'pcm_s16le' || stream.sampleRate !== 48000 || stream.channels !== 1 || probe.value.durationTicks !== durationTicks) return fail('VOICE_PREPARATION_FAILED', '标准声音裁切的时长或格式校验失败。');
  return ok({ hash: hashed.value.hash, mime: 'audio/wav', byteLength: hashed.value.byteLength, durationTicks, probeId: probe.value.probeId });
}
