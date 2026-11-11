import { createHash } from 'node:crypto';
import type { MediaProbe, MediaRuntime, MediaStream } from '../../../contracts/src/media-info.ts';
import { fail, isRecord, ok, type Result } from '../../../contracts/src/result.ts';
import { assertStagedFile, compileMediaProcess, runMediaProcess } from './process.ts';
const FORMATS = ['wav', 'mp3', 'mov,mp4,m4a,3gp,3g2,mj2'];
const DEMUXERS = 'wav,mp3,mov';
const rational = (v: unknown) => typeof v === 'string' && /^-?\d+\/[1-9]\d*$/.test(v) ? Number(v.split('/')[0]) / Number(v.split('/')[1]) : NaN;
const number = (v: unknown) => (typeof v === 'string' && v.trim() !== '' || typeof v === 'number') ? Number(v) : NaN;
export function parseMediaProbe(raw: unknown, objectHash: string, runtimeHash: string): Result<MediaProbe> {
  try {
    if (!/^[a-f0-9]{64}$/.test(objectHash) || !/^[a-f0-9]{64}$/.test(runtimeHash) || !isRecord(raw) || !isRecord(raw.format) || !FORMATS.includes(raw.format.format_name as string) || !Array.isArray(raw.streams) || raw.streams.length < 1 || raw.streams.length > 4 || JSON.stringify(raw).length > 1024 * 1024) throw Error('INVALID_MEDIA');
    const formatDuration = number(raw.format.duration); if (!Number.isFinite(formatDuration) || formatDuration <= 0) throw Error('INVALID_MEDIA_DURATION');
    const streams: MediaStream[] = [];
    for (const s of raw.streams) {
      if (!isRecord(s) || !['audio', 'video'].includes(s.codec_type as string) || !Number.isSafeInteger(s.index) || streams.some(x => x.index === s.index) || typeof s.codec_name !== 'string' || s.codec_name.length > 64) throw Error('UNSUPPORTED_MEDIA_STREAM');
      const base = rational(s.time_base), startPts = s.start_pts === undefined ? (s.start_time === undefined ? 0 : number(s.start_time) / base) : number(s.start_pts);
      const duration = s.duration_ts === undefined ? number(s.duration ?? raw.format.duration) / base : number(s.duration_ts);
      if (!Number.isFinite(base) || base <= 0 || !Number.isSafeInteger(startPts) || !Number.isSafeInteger(Math.round(duration)) || duration <= 0 || !Number.isSafeInteger(startPts + Math.round(duration))) throw Error('INVALID_MEDIA_PTS');
      const colorTransfer = s.color_transfer as string | undefined;
      if (['smpte2084', 'arib-std-b67'].includes(colorTransfer ?? '') || s.color_primaries === 'bt2020' || s.color_space === 'bt2020nc' || s.color_space === 'bt2020c' || (Array.isArray(s.side_data_list) && s.side_data_list.some(d => isRecord(d) && /mastering display|content light/i.test(String(d.side_data_type))))) throw Error('HDR_UNSUPPORTED');
      const stream: MediaStream = { index: s.index as number, kind: s.codec_type as 'audio' | 'video', codec: s.codec_name, timeBase: s.time_base as string, startPts, endPts: startPts + Math.round(duration), startSeconds: startPts * base, durationTicks: Math.round(duration * base * 48000) };
      if (stream.kind === 'audio') {
        const sampleRate = number(s.sample_rate), channels = number(s.channels);
        if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isInteger(channels) || channels < 1 || channels > 8) throw Error('UNSUPPORTED_AUDIO');
        if (!['pcm_s16le', 'pcm_s24le', 'mp3', 'aac'].includes(stream.codec) || stream.codec === 'aac' && s.profile !== undefined && s.profile !== 'LC') throw Error('UNSUPPORTED_AUDIO');
        Object.assign(stream, { sampleRate, channels });
      } else {
        const width = number(s.width), height = number(s.height);
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > 40000000) throw Error('PIXEL_LIMIT');
        let rotation = number(isRecord(s.tags) ? s.tags.rotate ?? 0 : 0);
        if (Array.isArray(s.side_data_list)) for (const data of s.side_data_list) if (isRecord(data) && data.rotation !== undefined) rotation = number(data.rotation);
        if (!Number.isFinite(rotation) || rotation % 90 !== 0) throw Error('UNSUPPORTED_ROTATION');
        Object.assign(stream, { width, height, rotation: ((rotation % 360) + 360) % 360, sampleAspectRatio: typeof s.sample_aspect_ratio === 'string' ? s.sample_aspect_ratio : '1:1', ...(typeof s.avg_frame_rate === 'string' ? { averageFrameRate: s.avg_frame_rate } : {}), ...(typeof s.r_frame_rate === 'string' ? { realFrameRate: s.r_frame_rate } : {}), variableFrameRate: rational(s.avg_frame_rate) !== rational(s.r_frame_rate) });
      }
      for (const [source, target] of [['color_space', 'colorSpace'], ['color_transfer', 'colorTransfer'], ['color_primaries', 'colorPrimaries']] as const) if (typeof s[source] === 'string' && s[source].length <= 64) Object.assign(stream, { [target]: s[source] });
      streams.push(stream);
    }
    const video = streams.filter(s => s.kind === 'video'), audio = streams.filter(s => s.kind === 'audio');
    if (video.length > 1 || audio.length > 1 || video.length === 0 && audio.length !== 1 || raw.format.format_name !== 'mov,mp4,m4a,3gp,3g2,mj2' && video.length) throw Error('UNSUPPORTED_MEDIA_STREAM');
    const originSeconds = Math.min(...streams.map(s => s.startSeconds));
    const durationTicks = Math.round(Math.max(...streams.map(s => s.startSeconds + s.durationTicks / 48000)) * 48000 - originSeconds * 48000);
    if (!Number.isSafeInteger(durationTicks) || durationTicks <= 0 || durationTicks > 600 * 48000 || video.length === 0 && formatDuration > 600) throw Error('MEDIA_DURATION_LIMIT');
    return ok({ probeId: createHash('sha256').update(`media-probe-v1:${objectHash}:${runtimeHash}`).digest('hex'), objectHash, runtimeHash, durationTicks, container: raw.format.format_name as string, originSeconds, width: video[0]?.width ?? 0, height: video[0]?.height ?? 0, hasAudio: audio.length > 0, streams, verification: 'probed' });
  } catch (error) { return fail(error instanceof Error ? error.message : 'INVALID_MEDIA', '媒体格式、时长、时间戳或色彩信息不受支持。'); }
}
export async function probeMediaFile(runtime: MediaRuntime, path: string, stagingRoot: string, objectHash: string, signal = new AbortController().signal): Promise<Result<MediaProbe>> {
  try { await assertStagedFile(stagingRoot, path); } catch { return fail('INVALID_STAGING_PATH', '媒体暂存文件无效。'); }
  const result = await runMediaProcess(compileMediaProcess({ tool: 'ffprobe', runtime, stagingRoot, timeoutMs: 30000, maxStdoutBytes: 1024 * 1024, args: ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', DEMUXERS, '-max_streams', '4', '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,profile,width,height,time_base,start_pts,start_time,duration_ts,duration,sample_rate,channels,sample_aspect_ratio,avg_frame_rate,r_frame_rate,color_space,color_transfer,color_primaries:stream_tags=rotate:stream_side_data=rotation,side_data_type', '-of', 'json', path] }), signal);
  if (!result.ok) return result;
  try { return parseMediaProbe(JSON.parse(result.value.stdout), objectHash, runtime.runtimeHash); } catch { return fail('INVALID_MEDIA_PROBE', '媒体探测输出无效。'); }
}
/** Complete decode for new audio imports; stream metadata alone is insufficient. */
export async function verifyAudioDecode(runtime: MediaRuntime, path: string, stagingRoot: string, signal=new AbortController().signal): Promise<Result<void>> {
  try { await assertStagedFile(stagingRoot, path); } catch { return fail('INVALID_STAGING_PATH', '音频暂存文件无效。'); }
  const decoded = await runMediaProcess(compileMediaProcess({ tool: 'ffmpeg', runtime, stagingRoot, timeoutMs: 30000, maxStdoutBytes: 4096, args: ['-v', 'error', '-nostdin', '-xerror', '-max_alloc', '67108864', '-threads', '4', '-protocol_whitelist', 'file,pipe', '-format_whitelist', DEMUXERS, '-max_streams', '4', '-i', path, '-map', '0:a:0', '-vn', '-sn', '-dn', '-threads', '4', '-f', 'null', '-'] }), signal);
  return decoded.ok ? ok(undefined) : decoded;
}
