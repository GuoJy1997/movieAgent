import { createHash, randomUUID } from 'node:crypto';
import { fail, isRecord, ok, type Result } from '../../contracts/src/result.ts';
import { AUDIO_LIMITS, parseSaveTranscript, type AudioBilling, type FrozenAudioSource, type TranscriptSegment } from '../../contracts/src/audio.ts';
import type { ParameterValue } from '../../contracts/src/models.ts';
import type { PreparedGeneration } from '../../contracts/src/generation.ts';

export type AudioProtocol = 'openai-speech-v1' | 'minimax-speech-v1' | 'openai-transcription-v1' | 'minimax-transcription-v1';
export const isAudioProtocol = (v: unknown): v is AudioProtocol => ['openai-speech-v1', 'minimax-speech-v1', 'openai-transcription-v1', 'minimax-transcription-v1'].includes(v as string);
export const isSpeechProtocol = (v: unknown) => v === 'openai-speech-v1' || v === 'minimax-speech-v1';
export function audioBillingUnits(adapter: string, text: string): number {
  return Array.from(text).reduce((sum, ch) => sum + (adapter === 'minimax-speech-v1' && /\p{Script=Han}/u.test(ch) ? 2 : 1), 0);
}
export function speechBilling(adapter: string, text: string): AudioBilling {
  return { rule: adapter === 'minimax-speech-v1' ? 'minimax-weighted-han' : 'unicode-codepoints', units: audioBillingUnits(adapter, text) };
}
export function encodeSpeechRequest(adapter: string, model: string, text: string, parameters: Record<string, ParameterValue>): Result<Buffer> {
  if (!isSpeechProtocol(adapter) || !/^[a-zA-Z0-9_./:-]{1,200}$/.test(model) || !text.trim() || Array.from(text).length > AUDIO_LIMITS.lineCharacters || /[\u0000\u007f]/.test(text) || Object.keys(parameters).some(k => !['voice', 'response_format', 'speedMilli'].includes(k)) || typeof parameters.voice !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(parameters.voice) || parameters.response_format !== undefined && !['mp3', 'wav'].includes(parameters.response_format as string) || parameters.speedMilli !== undefined && (!Number.isSafeInteger(parameters.speedMilli) || (parameters.speedMilli as number) < 500 || (parameters.speedMilli as number) > 2000)) return fail('INVALID_SPEECH_INPUT', '配音文本或已测试参数无效。');
  const speed = parameters.speedMilli === undefined ? {} : { speed: (parameters.speedMilli as number) / 1000 };
  const format = parameters.response_format;
  const body = adapter === 'minimax-speech-v1'
    ? { model, text, stream: false, voice_setting: { voice_id: parameters.voice, ...speed }, ...(format === undefined ? {} : { audio_setting: { format } }) }
    : { model, input: text, voice: parameters.voice, ...(format === undefined ? {} : { response_format: format }), ...speed };
  return ok(Buffer.from(JSON.stringify(body)));
}
export function encodeTranscriptionRequest(adapter: string, model: string, source: Pick<FrozenAudioSource, 'hash' | 'mime' | 'byteLength' | 'durationTicks'>, parameters: Record<string, ParameterValue>, bytes: Uint8Array): Result<{ body: Buffer; contentType: string }> {
  const maxTicks = (adapter === 'minimax-transcription-v1' ? 500 : 600) * 48000;
  if (!['openai-transcription-v1', 'minimax-transcription-v1'].includes(adapter) || !/^[a-zA-Z0-9_./:-]{1,200}$/.test(model) || !Number.isSafeInteger(source.byteLength) || source.byteLength <= 0 || source.byteLength > AUDIO_LIMITS.uploadBytes || bytes.byteLength !== source.byteLength || !Number.isSafeInteger(source.durationTicks) || source.durationTicks <= 0 || source.durationTicks > maxTicks || !['audio/wav', 'audio/mpeg', 'audio/mp4'].includes(source.mime) || source.hash && createHash('sha256').update(bytes).digest('hex') !== source.hash || Object.keys(parameters).some(k => !['language', 'languages', 'response_format', 'timestamps'].includes(k)) || parameters.language !== undefined && parameters.languages !== undefined) return fail('INVALID_TRANSCRIPTION_INPUT', '音频超出上传限制，原件已变化，或转写参数无效。');
  const boundary = 'libtv-' + randomUUID(), chunks: Buffer[] = [];
  function field(name: string, value: string) { chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)); }
  field('model', model);
  for (const key of ['language', 'languages'] as const) {
    const value = parameters[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || !/^[a-zA-Z-]{2,20}$/.test(value)) return fail('INVALID_PARAMETERS', '语言参数无效。');
      field(key, key === 'languages' ? JSON.stringify([value]) : value);
    }
  }
  if (parameters.response_format !== undefined) {
    if (!['json', 'verbose_json'].includes(parameters.response_format as string)) return fail('INVALID_PARAMETERS', '转写响应模式未经支持。');
    field('response_format', parameters.response_format as string);
  }
  if (parameters.timestamps !== undefined) {
    if (parameters.timestamps !== 'segments' || parameters.response_format !== 'verbose_json') return fail('INVALID_PARAMETERS', '句段时间戳需要已测试的 verbose_json。');
    field('timestamp_granularities[]', 'segment');
  }
  const extension = source.mime === 'audio/wav' ? 'wav' : source.mime === 'audio/mpeg' ? 'mp3' : 'm4a';
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="source.${extension}"\r\nContent-Type: ${source.mime}\r\n\r\n`), Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--\r\n`));
  return ok({ body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` });
}
export function normalizeTranscript(value: unknown, sourceDurationTicks: number): Result<{ text: string; timing: 'none' | 'segments'; segments: TranscriptSegment[] }> {
  if (!isRecord(value) || typeof value.text !== 'string' || !value.text.trim()) return fail('INVALID_TRANSCRIPT_RESPONSE', '供应商未返回可用转写文本。');
  const segments: TranscriptSegment[] = [];
  if (value.segments !== undefined) {
    if (!Array.isArray(value.segments) || !value.segments.length) return fail('INVALID_TRANSCRIPT_TIMING', '供应商句段时间无效。');
    for (const segment of value.segments) {
      if (!isRecord(segment) || typeof segment.start !== 'number' || !Number.isFinite(segment.start) || typeof segment.end !== 'number' || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start || segment.end * 48000 > sourceDurationTicks || typeof segment.text !== 'string') return fail('INVALID_TRANSCRIPT_TIMING', '供应商句段时间无效。');
      segments.push({ startTicks: Math.round(segment.start * 48000), endTicks: Math.round(segment.end * 48000), text: segment.text });
    }
  }
  const timing = segments.length ? 'segments' : 'none';
  const parsed = parseSaveTranscript({ projectId: 'validate', id: 'validate', expectedRevision: 0, text: value.text, segments, timing });
  return parsed.ok ? ok({ text: value.text, timing, segments }) : parsed;
}
export function validateAudioRequest(input: PreparedGeneration, adapter: string): Result<PreparedGeneration> {
  const c = input.config;
  if (input.adapterId !== adapter || c.connection.adapterType !== adapter || input.libraryId !== c.connection.libraryId || c.model.connectionRef.id !== c.connection.id || c.model.connectionRef.revision !== c.connection.revision || input.referenceImages?.length || input.canvasInput) return fail('INVALID_AUDIO_CONFIG', '固定音频配置不匹配。');
  if (isSpeechProtocol(adapter)) {
    const encoded = encodeSpeechRequest(adapter, c.model.modelId, input.prompt, c.parameters);
    return c.model.capabilities.taskTypes[0] === 'text_to_speech' && encoded.ok ? ok(input) : fail('INVALID_SPEECH_INPUT', '配音输入无效。');
  }
  const p = c.parameters;
  if (Object.keys(p).some(key => !['language', 'languages', 'response_format', 'timestamps'].includes(key)) || p.language !== undefined && p.languages !== undefined || [p.language, p.languages].some(value => value !== undefined && (typeof value !== 'string' || !/^[a-zA-Z-]{2,20}$/.test(value))) || p.response_format !== undefined && !['json', 'verbose_json'].includes(p.response_format as string) || p.timestamps !== undefined && (p.timestamps !== 'segments' || p.response_format !== 'verbose_json')) return fail('INVALID_PARAMETERS', '转写模式需要已测试的语言映射和句段时间戳格式。');
  return c.model.capabilities.taskTypes[0] === 'speech_to_text' && input.audioSource && input.audioSource.durationTicks <= (adapter === 'minimax-transcription-v1' ? 500 : 600) * 48000 && input.audioSource.byteLength <= AUDIO_LIMITS.uploadBytes ? ok(input) : fail('INVALID_TRANSCRIPTION_INPUT', '转写需要受限固定音频原件。');
}
