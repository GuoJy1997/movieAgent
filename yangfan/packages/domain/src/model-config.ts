import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { isRestrictedHost, type AdapterType, type ModelCapabilities, type ParameterDescriptor, type Pricing, type ModelDefinition, type ModelProfile, type ParameterValue, type ProviderConnection, type RunConfigSnapshot } from '../../contracts/src/models.ts';

export function resolveModelParameters(model: ModelDefinition, values: Record<string, ParameterValue>): Result<Record<string, ParameterValue>> {
  if (Object.keys(values).some(key => !Object.hasOwn(model.parameters, key))) return fail('INVALID_PARAMETERS', 'Profile 包含模型不支持的参数。');
  const resolved: Record<string, ParameterValue> = {};
  for (const [key, descriptor] of Object.entries(model.parameters)) {
    const value = values[key] ?? descriptor.default;
    if (!(descriptor.type === 'enum' && typeof value === 'string' && descriptor.values.includes(value) || descriptor.type === 'integer' && typeof value === 'number' && Number.isSafeInteger(value) && value >= descriptor.min && value <= descriptor.max || descriptor.type === 'boolean' && typeof value === 'boolean')) return fail('INVALID_PARAMETERS', 'Profile 参数不符合模型描述。');
    resolved[key] = value;
  }
  return ok(resolved);
}
/** A transport must call this after DNS resolution on every request/redirect.
 * This capability is for a model endpoint only, never for ordinary asset URLs. */
export function authorizeModelAddress(connection: ProviderConnection, hostname: string, port: number, resolvedAddress: string): Result<void> {
  const url = new URL(connection.baseUrl);
  if (hostname !== url.hostname || port !== Number(url.port || (url.protocol === 'https:' ? 443 : 80))) return fail('NETWORK_DENIED', '模型请求的主机或端口与配置不符。');
  const grant = connection.networkPolicy.privateEndpoint;
  if (isRestrictedHost(resolvedAddress) && !(grant?.hostname === hostname && grant.port === port && grant.purpose === 'model-api')) return fail('NETWORK_DENIED', '模型解析到未授权私网地址。');
  return ok(undefined);
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
export function freezeRunConfig(connection: ProviderConnection, model: ModelDefinition, profile: ModelProfile): Result<RunConfigSnapshot> {
  if (!adapterSupportsModel(connection, model)) return fail('CONFIG_MISMATCH', '适配器与模型能力不匹配。');
  if (connection.libraryId !== model.libraryId || model.libraryId !== profile.libraryId || model.connectionRef.libraryId !== connection.libraryId || model.connectionRef.id !== connection.id || model.connectionRef.revision !== connection.revision || profile.modelRef.libraryId !== model.libraryId || profile.modelRef.id !== model.id || profile.modelRef.revision !== model.revision) return fail('CONFIG_MISMATCH', '运行配置的固定版本不匹配。');
  const parameters = resolveModelParameters(model, profile.parameters); if (!parameters.ok) return parameters;
  return ok(freeze(structuredClone({ schemaVersion: 1 as const, connection, model, profile, parameters: parameters.value, pricing: model.pricing })));
}
export function adapterSupportsModel(connection: ProviderConnection, model: Pick<ModelDefinition, 'capabilities'>): boolean {
  return ({ 'openai-image-v1': 'text_to_image', 'minimax-video-v2': 'text_to_video', 'minimax-h3-v2': 'text_to_video', 'sync-lipsync-v2': 'lip_sync', 'openai-chat-v1': 'text_to_text', 'anthropic-messages-v1': 'text_to_text', 'openai-image-edit-v1': 'image_to_image', 'openai-speech-v1': 'text_to_speech', 'minimax-speech-v1': 'text_to_speech', 'openai-transcription-v1': 'speech_to_text', 'minimax-transcription-v1': 'speech_to_text' } as const)[connection.adapterType] === model.capabilities.taskTypes[0];
}

/** Native protocol defaults shared by file import and the dedicated configuration editor. */
export function adapterDefaults(adapter: AdapterType): { capabilities: ModelCapabilities; parameters: Record<string, ParameterDescriptor>; pricing: Pricing } {
  switch (adapter) {
    case 'openai-speech-v1':
    case 'minimax-speech-v1': return { capabilities: { taskTypes: ['text_to_speech'], inputKinds: ['text'], outputKinds: ['audio'], maxBatch: 1 }, parameters: { voice: { type: 'enum', values: ['manual-voice'], default: 'manual-voice' } }, pricing: { status: 'unknown' } };
    case 'openai-transcription-v1':
    case 'minimax-transcription-v1': return { capabilities: { taskTypes: ['speech_to_text'], inputKinds: ['audio'], outputKinds: ['text'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } };
    case 'anthropic-messages-v1':
    case 'openai-chat-v1': return { capabilities: { taskTypes: ['text_to_text'], inputKinds: ['text'], outputKinds: ['text'], maxBatch: 1 }, parameters: { max_tokens: { type: 'integer', min: 1, max: 8192, default: 1024 } }, pricing: { status: 'unknown' } };
    case 'openai-image-edit-v1': return { capabilities: { taskTypes: ['image_to_image'], inputKinds: ['text','image'], outputKinds: ['image'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } };
    case 'sync-lipsync-v2': return { capabilities: { taskTypes: ['lip_sync'], inputKinds: ['video', 'audio'], outputKinds: ['video'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } };
    case 'minimax-h3-v2': return { capabilities: { taskTypes: ['text_to_video', 'image_to_video'], inputKinds: ['text', 'image', 'audio'], outputKinds: ['video'], maxBatch: 1 }, parameters: { duration: { type: 'integer', min: 4, max: 15, default: 6 }, resolution: { type: 'enum', values: ['768P'], default: '768P' }, ratio: { type: 'enum', values: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], default: '16:9' } }, pricing: { status: 'unknown' } };
    case 'minimax-video-v2': return { capabilities: { taskTypes: ['text_to_video','image_to_video'], inputKinds: ['text','image'], outputKinds: ['video'], maxBatch: 1 }, parameters: { duration: { type: 'integer', min: 4, max: 15, default: 4 }, resolution: { type: 'enum', values: ['768P'], default: '768P' }, ratio: { type: 'enum', values: ['adaptive','21:9','16:9','4:3','1:1','3:4','9:16'], default: '9:16' } }, pricing: { status: 'configured', currency: 'CNY', perSecond: 0.4, version: '2026-10-25' } };
    case 'openai-image-v1': return { capabilities: { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } };
  }
}

/** Native image controls are optional: omitted parameters keep provider defaults. */
export function adapterParameterOptions(adapter: AdapterType): Record<string, ParameterDescriptor> {
  if (adapter === 'openai-image-v1' || adapter === 'openai-image-edit-v1') return {
    size: { type: 'enum', values: ['1024x1024','1024x1536','1536x1024'], default: '1024x1024' },
    quality: { type: 'enum', values: ['auto','low','medium','high'], default: 'auto' },
  };
  return adapterDefaults(adapter).parameters;
}
export function fileModelDefaults(adapter: AdapterType, values: Record<string, ParameterValue>) {
  const defaults = adapterDefaults(adapter);
  if (adapter === 'openai-speech-v1' || adapter === 'minimax-speech-v1') {
    defaults.parameters = {
      voice: { type: 'enum', values: [typeof values.voice === 'string' ? values.voice : 'manual-voice'], default: typeof values.voice === 'string' ? values.voice : 'manual-voice' },
      ...(values.response_format === undefined ? {} : { response_format: { type: 'enum' as const, values: ['wav', 'mp3'], default: 'mp3' } }),
      ...(values.speedMilli === undefined ? {} : { speedMilli: { type: 'integer' as const, min: 500, max: 2000, default: 1000 } }),
    };
  }
  if (adapter === 'openai-transcription-v1' || adapter === 'minimax-transcription-v1') {
    defaults.parameters = Object.fromEntries(Object.entries(values).filter(([key]) => ['language', 'languages', 'response_format', 'timestamps'].includes(key)).map(([key, value]) => [key, { type: 'enum' as const, values: [String(value)], default: String(value) }]));
  }
  if(adapter==='openai-chat-v1'&&Object.hasOwn(values,'max_completion_tokens')) defaults.parameters={max_completion_tokens:{type:'integer',min:1,max:8192,default:1024}};
  if (adapter === 'openai-image-v1' || adapter === 'openai-image-edit-v1') defaults.parameters = Object.fromEntries(Object.entries(adapterParameterOptions(adapter)).filter(([key]) => Object.hasOwn(values,key)));
  return defaults;
}
