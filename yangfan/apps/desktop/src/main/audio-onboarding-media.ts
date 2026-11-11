import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { probeMediaFile, verifyAudioDecode } from '../../../../packages/engine/src/media/probe.ts';
import { resolveMediaRuntime } from './media-runtime.ts';
import type { AudioTestSource } from './audio-onboarding.ts';

export async function inspectOnboardingAudio(bytes: Uint8Array): Promise<Result<AudioTestSource>> {
  if (!bytes.byteLength || bytes.byteLength > 24000000) return fail('AUDIO_TEST_LIMIT', '测试音频超过24000000字节。');
  const runtime = await resolveMediaRuntime(); if (!runtime.ok) return runtime;
  const directory = await mkdtemp(join(tmpdir(), 'movieagent-audio-test-'));
  try {
    const path = join(directory, 'sample.audio'); await writeFile(path, bytes, { flag: 'wx' });
    const probe = await probeMediaFile(runtime.value, path, directory, createHash('sha256').update(bytes).digest('hex')); if (!probe.ok) return probe;
    if (!probe.value.hasAudio || probe.value.width !== 0) return fail('INVALID_AUDIO_SOURCE', '请选择单音轨音频。');
    const decoded = await verifyAudioDecode(runtime.value, path, directory); if (!decoded.ok) return decoded;
    return ok({ bytes, mime: probe.value.container === 'wav' ? 'audio/wav' : probe.value.container === 'mp3' ? 'audio/mpeg' : 'audio/mp4', durationTicks: probe.value.durationTicks });
  } catch { return fail('INVALID_AUDIO_SOURCE', '无法验证测试音频。'); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
export async function readOnboardingAudio(path: string): Promise<Result<AudioTestSource>> {
  try {
    const handle = await open(path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 24000000) return fail('AUDIO_TEST_LIMIT', '测试音频超过上传限制。');
      const buffer = Buffer.alloc(Math.min(stat.size + 1, 24000001)); let offset = 0;
      while (offset < buffer.length) {
        const read = await handle.read(buffer, offset, buffer.length - offset, null); if (!read.bytesRead) break; offset += read.bytesRead;
      }
      if (offset !== stat.size) return fail('AUDIO_TEST_SOURCE_CHANGED', '测试音频在读取期间改变。');
      const source = await inspectOnboardingAudio(buffer.subarray(0, offset));
      return source.ok && source.value.durationTicks > 5 * 48000 ? fail('AUDIO_TEST_LIMIT', '测试音频须不超过5秒。') : source;
    } finally { await handle.close(); }
  } catch { return fail('AUDIO_TEST_SOURCE_UNAVAILABLE', '无法读取已选测试音频。'); }
}
