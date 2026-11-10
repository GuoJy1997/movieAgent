import { fail, isRecord, ok, type Result } from './result.ts';

const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const text = (v: unknown, max = 120): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
export interface RevisionRef { libraryId: string; id: string; revision: number }
export type ConnectionRevisionRef = RevisionRef;
export type ModelRevisionRef = RevisionRef;
export type ProfileRevisionRef = RevisionRef;
export interface CredentialRef { libraryId: string; connectionId: string; id: string; version: number }
export type CredentialState = 'protected' | 'session' | 'revoked' | 'unavailable';
export interface CredentialStatus { ref: CredentialRef; state: CredentialState }
export function isRevisionRef(v: unknown): v is RevisionRef { return isRecord(v) && exact(v, ['libraryId', 'id', 'revision']) && id(v.libraryId) && id(v.id) && positive(v.revision); }
export function isCredentialRef(v: unknown): v is CredentialRef { return isRecord(v) && exact(v, ['libraryId', 'connectionId', 'id', 'version']) && id(v.libraryId) && id(v.connectionId) && id(v.id) && positive(v.version); }
export function isCredentialStatus(v: unknown): v is CredentialStatus { return isRecord(v) && exact(v, ['ref', 'state']) && isCredentialRef(v.ref) && ['protected', 'session', 'revoked', 'unavailable'].includes(v.state as string); }
export interface PrivateEndpoint { hostname: string; port: number; purpose: 'model-api' }
export interface NetworkPolicy { privateEndpoint: PrivateEndpoint | null }
export const ADAPTER_TYPES = ['openai-image-v1', 'minimax-video-v2', 'minimax-h3-v2', 'sync-lipsync-v2', 'openai-chat-v1', 'anthropic-messages-v1', 'openai-image-edit-v1', 'openai-speech-v1', 'openai-transcription-v1', 'minimax-speech-v1', 'minimax-transcription-v1'] as const;
export type AdapterType = typeof ADAPTER_TYPES[number];
export interface SaveConnectionInput { id: string; expectedRevision: number; name: string; adapterType: AdapterType; baseUrl: string; credentialRef: CredentialRef | null; headers: Record<string, CredentialRef>; networkPolicy: NetworkPolicy; timeoutMs: number; concurrency: number }
export interface ProviderConnection extends Omit<SaveConnectionInput, 'expectedRevision'> { libraryId: string; revision: number; createdAt: string }
export type ParameterValue = string | number | boolean;
export type ParameterDescriptor = { type: 'enum'; values: string[]; default: string } | { type: 'integer'; min: number; max: number; default: number } | { type: 'boolean'; default: boolean };
export interface ImageCapabilities { taskTypes: ['text_to_image']; inputKinds: ['text']; outputKinds: ['image']; maxBatch: 1 }
export interface VideoCapabilities { taskTypes: ['text_to_video']; inputKinds: ['text']; outputKinds: ['video']; maxBatch: 1 }
export interface TextCapabilities { taskTypes: ['text_to_text']; inputKinds: ['text']; outputKinds: ['text']; maxBatch: 1 }
export interface ImageEditCapabilities { taskTypes: ['image_to_image']; inputKinds: ['text', 'image']; outputKinds: ['image']; maxBatch: 1 }
export interface ReferenceVideoCapabilities { taskTypes: ['text_to_video', 'image_to_video']; inputKinds: ['text', 'image']; outputKinds: ['video']; maxBatch: 1 }
export interface SpeechCapabilities { taskTypes: ['text_to_speech']; inputKinds: ['text']; outputKinds: ['audio']; maxBatch: 1 }
export interface TranscriptionCapabilities { taskTypes: ['speech_to_text']; inputKinds: ['audio']; outputKinds: ['text']; maxBatch: 1 }
export interface H3Capabilities { taskTypes: ['text_to_video', 'image_to_video']; inputKinds: ['text', 'image', 'audio']; outputKinds: ['video']; maxBatch: 1 }
export interface LipSyncCapabilities { taskTypes: ['lip_sync']; inputKinds: ['video', 'audio']; outputKinds: ['video']; maxBatch: 1 }
export type ModelCapabilities = ImageCapabilities | VideoCapabilities | TextCapabilities | ImageEditCapabilities | ReferenceVideoCapabilities | H3Capabilities | LipSyncCapabilities | SpeechCapabilities | TranscriptionCapabilities;
export function isModelCapabilities(v: unknown): v is ModelCapabilities {
  if (!isRecord(v) || !exact(v, ['taskTypes','inputKinds','outputKinds','maxBatch']) || v.maxBatch !== 1) return false;
  return [
    [['text_to_image'], ['text'], ['image']], [['text_to_video'], ['text'], ['video']],
    [['text_to_text'], ['text'], ['text']], [['image_to_image'], ['text','image'], ['image']],
    [['text_to_video','image_to_video'], ['text','image'], ['video']], [['text_to_video','image_to_video'], ['text','image','audio'], ['video']],
    [['text_to_speech'], ['text'], ['audio']], [['speech_to_text'], ['audio'], ['text']], [['lip_sync'], ['video', 'audio'], ['video']],
  ].some(([tasks, inputs, outputs]) => JSON.stringify(v.taskTypes) === JSON.stringify(tasks) && JSON.stringify(v.inputKinds) === JSON.stringify(inputs) && JSON.stringify(v.outputKinds) === JSON.stringify(outputs));
}
export type Pricing = { status: 'unknown' } | { status: 'configured'; currency: string; perImage: number; version: string } | { status: 'configured'; currency: string; perSecond: number; version: string } | { status: 'configured'; currency: string; perThousandCharacters: number; version: string } | { status: 'configured'; currency: string; perAudioSecond: number; version: string };
export interface SaveModelInput { id: string; expectedRevision: number; name: string; modelId: string; connectionRef: ConnectionRevisionRef; capabilities: ModelCapabilities; parameters: Record<string, ParameterDescriptor>; pricing: Pricing }
export interface ModelDefinition extends Omit<SaveModelInput, 'expectedRevision'> { libraryId: string; revision: number; createdAt: string }
export interface SaveProfileInput { id: string; expectedRevision: number; name: string; modelRef: ModelRevisionRef; parameters: Record<string, ParameterValue> }
export interface ModelProfile extends Omit<SaveProfileInput, 'expectedRevision'> { libraryId: string; revision: number; createdAt: string }
export interface RunConfigSnapshot { schemaVersion: 1; connection: ProviderConnection; model: ModelDefinition; profile: ModelProfile; parameters: Record<string, ParameterValue>; pricing: Pricing }

/** Configuration-time screening. Dispatch must independently resolve and check every address/redirect. */
export function isRestrictedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') && !host.includes(':')) return true;
  if (host.includes(':')) return !/^[23][0-9a-f]{3}:/.test(host); // Conservatively require authorization outside global IPv6 unicast.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 0 || b === 168) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19) || a >= 224;
  }
  return false;
}
export function parseModelEndpoint(baseUrl: unknown, policy: unknown): Result<{ baseUrl: string; networkPolicy: NetworkPolicy }> {
  if (typeof baseUrl !== 'string' || baseUrl.length > 2048 || !isRecord(policy) || !exact(policy, ['privateEndpoint'])) return fail('INVALID_INPUT', '模型地址或网络策略无效。');
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || /[\s\\]/.test(baseUrl)) throw new Error();
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    let endpoint: PrivateEndpoint | null = null;
    if (policy.privateEndpoint !== null) {
      const p = policy.privateEndpoint;
      if (!isRecord(p) || !exact(p, ['hostname', 'port', 'purpose']) || p.hostname !== url.hostname || p.port !== port || p.purpose !== 'model-api') throw new Error();
      endpoint = { hostname: url.hostname, port, purpose: 'model-api' };
    }
    if ((isRestrictedHost(url.hostname) || url.protocol === 'http:') && !endpoint) throw new Error();
    // Public HTTP endpoints never receive an insecure-transport exception.
    if (url.protocol === 'http:' && !isRestrictedHost(url.hostname)) throw new Error();
    return ok({ baseUrl: url.href.replace(/\/$/, ''), networkPolicy: { privateEndpoint: endpoint } });
  } catch { return fail('INVALID_ENDPOINT', '请使用无账号、查询参数或片段的 HTTPS 地址；本机/私网服务需精确主机与端口授权。'); }
}
function base(v: unknown): v is Record<string, unknown> & { id: string; expectedRevision: number; name: string } { return isRecord(v) && id(v.id) && Number.isSafeInteger(v.expectedRevision) && (v.expectedRevision as number) >= 0 && text(v.name); }
export function parseSaveConnection(v: unknown): Result<SaveConnectionInput> {
  if (!base(v) || !exact(v, ['id', 'expectedRevision', 'name', 'adapterType', 'baseUrl', 'credentialRef', 'headers', 'networkPolicy', 'timeoutMs', 'concurrency']) || !(ADAPTER_TYPES as readonly unknown[]).includes(v.adapterType) || v.credentialRef !== null && !isCredentialRef(v.credentialRef) || !isRecord(v.headers) || Object.keys(v.headers).length > 16 || !Number.isSafeInteger(v.timeoutMs) || (v.timeoutMs as number) < 1000 || (v.timeoutMs as number) > 300000 || !positive(v.concurrency) || v.concurrency > 4) return fail('INVALID_INPUT', '连接配置无效；密钥只能通过专用入口保存。');
  const endpoint = parseModelEndpoint(v.baseUrl, v.networkPolicy); if (!endpoint.ok) return endpoint;
  const headers: Record<string, CredentialRef> = {};
  for (const key of Object.keys(v.headers).sort()) {
    if (!/^x-[a-z0-9-]{1,60}$/i.test(key) || /^(x-forwarded-|x-real-ip$)/i.test(key) || !isCredentialRef(v.headers[key]) || Object.hasOwn(headers, key.toLowerCase())) return fail('INVALID_HEADER', '仅允许受限 X- Header，值必须是凭据引用。');
    headers[key.toLowerCase()] = v.headers[key];
  }
  return ok({ id: v.id, expectedRevision: v.expectedRevision, name: v.name.trim(), adapterType: v.adapterType as AdapterType, ...endpoint.value, credentialRef: v.credentialRef as CredentialRef | null, headers, timeoutMs: v.timeoutMs as number, concurrency: v.concurrency });
}
export function parseSaveModel(v: unknown): Result<SaveModelInput> {
  if (!base(v) || !exact(v, ['id', 'expectedRevision', 'name', 'modelId', 'connectionRef', 'capabilities', 'parameters', 'pricing']) || !text(v.modelId, 200) || !/^[a-zA-Z0-9_./:-]+$/.test(v.modelId) || !isRevisionRef(v.connectionRef) || !isModelCapabilities(v.capabilities) || !isRecord(v.parameters) || Object.keys(v.parameters).length > 8) return fail('UNSUPPORTED_CAPABILITY', 'P1 仅支持文本生成单张图片及受限参数描述。');
  const taskType = v.capabilities.taskTypes[0];
  const video = taskType === 'text_to_video', chat = taskType === 'text_to_text';
  const speech = taskType === 'text_to_speech', transcription = taskType === 'speech_to_text';
  const parameters: Record<string, ParameterDescriptor> = {};
  for (const key of Object.keys(v.parameters).sort()) {
    const p = v.parameters[key];
    if (!(video ? ['duration', 'resolution', 'ratio'] : chat ? ['max_tokens','max_completion_tokens'] : speech ? ['voice', 'response_format', 'speedMilli'] : transcription ? ['language', 'languages', 'response_format', 'timestamps'] : ['size', 'quality', 'style', 'seed']).includes(key) || !isRecord(p)) return fail('INVALID_PARAMETERS', '模型参数描述无效。');
    if (p.type === 'enum' && exact(p, ['type', 'values', 'default']) && Array.isArray(p.values) && p.values.length > 0 && p.values.length <= 32 && p.values.every(s => text(s, 100)) && new Set(p.values).size === p.values.length && typeof p.default === 'string' && p.values.includes(p.default)) parameters[key] = { type: 'enum', values: [...p.values], default: p.default };
    else if (p.type === 'integer' && exact(p, ['type', 'min', 'max', 'default']) && [p.min, p.max, p.default].every(Number.isSafeInteger) && (p.min as number) >= -2147483648 && (p.max as number) <= 2147483647 && (p.min as number) <= (p.default as number) && (p.default as number) <= (p.max as number)) parameters[key] = { type: 'integer', min: p.min as number, max: p.max as number, default: p.default as number };
    else if (p.type === 'boolean' && exact(p, ['type', 'default']) && typeof p.default === 'boolean') parameters[key] = { type: 'boolean', default: p.default };
    else return fail('INVALID_PARAMETERS', '模型参数仅接受有限枚举、整数范围或布尔值。');
  }
  if (video && (Object.keys(parameters).length !== 3 || parameters.duration?.type !== 'integer' || parameters.duration.min < 4 || parameters.duration.max > 15 || parameters.resolution?.type !== 'enum' || parameters.resolution.values.some(v => v !== '768P') || parameters.ratio?.type !== 'enum' || parameters.ratio.values.some(v => !['adaptive','21:9','16:9','4:3','1:1','3:4','9:16'].includes(v)))) return fail('INVALID_PARAMETERS', '视频参数需包含 4–15 秒、768P 与受支持画幅。');
  const tokenParameter=parameters.max_tokens??parameters.max_completion_tokens;
  if (chat && (Object.keys(parameters).length !== 1 || tokenParameter?.type !== 'integer' || tokenParameter.min < 1 || tokenParameter.max > 8192)) return fail('INVALID_PARAMETERS', '文本模型需声明 1–8192 的 max_tokens。');
  const p = v.pricing;
  if (speech && (parameters.voice?.type !== 'enum' || parameters.voice.values.some(v => !/^[a-zA-Z0-9_.:-]{1,100}$/.test(v)) || parameters.response_format !== undefined && (parameters.response_format.type !== 'enum' || parameters.response_format.values.some(v => !['mp3', 'wav'].includes(v))) || parameters.speedMilli !== undefined && (parameters.speedMilli.type !== 'integer' || parameters.speedMilli.min < 500 || parameters.speedMilli.max > 2000))) return fail('INVALID_PARAMETERS', '配音需要音色及受限格式/速度参数。');
  if (transcription && (parameters.language !== undefined && parameters.languages !== undefined || Object.entries(parameters).some(([key, value]) => value.type !== 'enum' || value.values.some(v => key === 'response_format' ? !['json', 'verbose_json'].includes(v) : key === 'timestamps' ? v !== 'segments' : !/^[a-zA-Z-]{2,20}$/.test(v))))) return fail('INVALID_PARAMETERS', '转写只接受已测试的语言与响应模式。');
  if (chat && (!isRecord(p) || p.status !== 'unknown')) return fail('INVALID_PRICING', '文本计价尚未支持，请使用未知价格。');
  const rateKey = speech ? 'perThousandCharacters' : transcription ? 'perAudioSecond' : video ? 'perSecond' : 'perImage';
  const rate = isRecord(p) ? p[rateKey] : undefined;
  if (!isRecord(p) || !(p.status === 'unknown' && exact(p, ['status']) || p.status === 'configured' && exact(p, ['status', 'currency', rateKey, 'version']) && typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency) && typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 1000000 && text(p.version, 100))) return fail('INVALID_PRICING', '请明确未知计价或填写带版本的有限单价。');
  return ok({ id: v.id, expectedRevision: v.expectedRevision, name: v.name.trim(), modelId: v.modelId, connectionRef: { ...v.connectionRef }, capabilities: structuredClone(v.capabilities), parameters, pricing: { ...p } as Pricing });
}
export function parseSaveProfile(v: unknown): Result<SaveProfileInput> {
  if (!base(v) || !exact(v, ['id', 'expectedRevision', 'name', 'modelRef', 'parameters']) || !isRevisionRef(v.modelRef) || !isRecord(v.parameters) || Object.keys(v.parameters).length > 8 || Object.keys(v.parameters).some(k => !['size', 'quality', 'style', 'seed', 'duration', 'resolution', 'ratio', 'max_tokens', 'max_completion_tokens', 'voice', 'response_format', 'speedMilli', 'language', 'languages', 'timestamps'].includes(k)) || Object.values(v.parameters).some(p => !(typeof p === 'boolean' || typeof p === 'number' && Number.isFinite(p) || text(p, 100)))) return fail('INVALID_PARAMETERS', 'Profile 或参数无效。');
  return ok({ id: v.id, expectedRevision: v.expectedRevision, name: v.name.trim(), modelRef: { ...v.modelRef }, parameters: Object.fromEntries(Object.entries(v.parameters).sort(([a], [b]) => a.localeCompare(b))) as Record<string, ParameterValue> });
}
function stored<T>(v: unknown, parse: (input: unknown) => Result<T>): boolean {
  if (!isRecord(v) || !id(v.libraryId) || !positive(v.revision) || typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt))) return false;
  const { libraryId: _l, revision, createdAt: _c, ...input } = v;
  return parse({ ...input, expectedRevision: revision - 1 }).ok;
}
export function isProviderConnection(v: unknown): v is ProviderConnection { return stored(v, parseSaveConnection); }
export function isModelDefinition(v: unknown): v is ModelDefinition { return stored(v, parseSaveModel); }
export function isModelProfile(v: unknown): v is ModelProfile { return stored(v, parseSaveProfile); }
export interface ProviderVerification { connectionRef: ConnectionRevisionRef; modelId: string; adapterId: AdapterType; configuration: 'valid' | 'invalid'; authentication: 'unknown' | 'accepted' | 'rejected'; generation: 'unverified' | 'verified'; fixtureGeneration: boolean; capabilities: { textToImage: 'adapter-declared'; batch: 1; reconcile: 'unsupported' } | { textToText: 'adapter-declared'; batch: 1; reconcile: 'unsupported' } | { imageToImage: 'adapter-declared'; batch: 1; reconcile: 'unsupported' } | { textToVideo: 'adapter-declared'; batch: 1; reconcile: 'provider-task-id' } | { lipSync: 'adapter-declared'; batch: 1; reconcile: 'provider-task-id' }; checkedAt: string }
/** Shared strict protocol facts; these are never human voice-quality evidence. */
export function providerVerificationCapabilities(adapter: unknown): ProviderVerification['capabilities'] | null {
  switch(adapter) {
    case 'minimax-video-v2': case 'minimax-h3-v2': return {textToVideo:'adapter-declared',batch:1,reconcile:'provider-task-id'};
    case 'sync-lipsync-v2': return {lipSync:'adapter-declared',batch:1,reconcile:'provider-task-id'};
    case 'openai-chat-v1': case 'anthropic-messages-v1': return {textToText:'adapter-declared',batch:1,reconcile:'unsupported'};
    case 'openai-image-edit-v1': return {imageToImage:'adapter-declared',batch:1,reconcile:'unsupported'};
    case 'openai-image-v1': return {textToImage:'adapter-declared',batch:1,reconcile:'unsupported'};
    default: return null;
  }
}
export function isProviderVerification(v: unknown): v is ProviderVerification {
  if(!isRecord(v)||!exact(v,['connectionRef','modelId','adapterId','configuration','authentication','generation','fixtureGeneration','capabilities','checkedAt'])||!isRevisionRef(v.connectionRef)||!text(v.modelId,200)||!['valid','invalid'].includes(v.configuration as string)||!['unknown','accepted','rejected'].includes(v.authentication as string)||!['unverified','verified'].includes(v.generation as string)||typeof v.fixtureGeneration!=='boolean'||!isRecord(v.capabilities)||typeof v.checkedAt!=='string'||!Number.isFinite(Date.parse(v.checkedAt)))return false;
  const expected=providerVerificationCapabilities(v.adapterId);
  return expected!==null&&exact(v.capabilities,Object.keys(expected))&&Object.entries(expected).every(([key,value])=>(v.capabilities as Record<string,unknown>)[key]===value);
}
export interface ProviderSnapshot { connections: ProviderConnection[]; credentialStatuses: CredentialStatus[]; verification: ProviderVerification[]; snapshotSeq: number; streamId: string }
export interface ModelSnapshot { models: ModelDefinition[]; snapshotSeq: number; streamId: string }
export interface ProfileSnapshot { profiles: ModelProfile[]; snapshotSeq: number; streamId: string }
const snapshotBase = (v: Record<string, unknown>) => Number.isSafeInteger(v.snapshotSeq) && (v.snapshotSeq as number) >= 0 && id(v.streamId);
export function isProviderSnapshot(v: unknown): v is ProviderSnapshot { return isRecord(v) && snapshotBase(v) && exact(v, ['connections', 'credentialStatuses', 'verification', 'snapshotSeq', 'streamId']) && Array.isArray(v.connections) && v.connections.every(isProviderConnection) && Array.isArray(v.credentialStatuses) && v.credentialStatuses.every(isCredentialStatus) && Array.isArray(v.verification) && v.verification.every(isProviderVerification); }
export function isModelSnapshot(v: unknown): v is ModelSnapshot { return isRecord(v) && snapshotBase(v) && exact(v, ['models', 'snapshotSeq', 'streamId']) && Array.isArray(v.models) && v.models.every(isModelDefinition); }
export function isProfileSnapshot(v: unknown): v is ProfileSnapshot { return isRecord(v) && snapshotBase(v) && exact(v, ['profiles', 'snapshotSeq', 'streamId']) && Array.isArray(v.profiles) && v.profiles.every(isModelProfile); }
