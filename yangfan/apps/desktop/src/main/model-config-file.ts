import { open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { ADAPTER_TYPES, parseModelEndpoint, parseSaveModel, parseSaveProfile, type AdapterType, type ParameterValue, type Pricing, type ModelDefinition, type NetworkPolicy } from '../../../../packages/contracts/src/models.ts';
import { fileModelDefaults, resolveModelParameters } from '../../../../packages/domain/src/model-config.ts';

// These types contain secrets and must stay in main. Only redacted public configuration/status crosses ordinary IPC.
export interface LocalModelProvider {
  id: string; name: string; kind: 'text' | 'image' | 'video' | 'speech' | 'transcription'; baseURL: string; apiKey: string; modelId: string;
  allowPrivateEndpoint: boolean; state: 'ready' | 'unconfigured'; networkPolicy: NetworkPolicy;
  adapterType: AdapterType; parameters: Record<string, ParameterValue>; pricing: Pricing;
}
export interface LocalModelConfig { schemaVersion: 1 | 2; source: string; providers: LocalModelProvider[] }
const fields = ['id', 'name', 'kind', 'baseURL', 'apiKey', 'modelId', 'allowPrivateEndpoint'];
const v2fields = [...fields, 'adapterType', 'parameters', 'pricing'];
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !!v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const invalid = () => fail('MODEL_CONFIG_INVALID', '模型配置格式无效：请检查版本、条目数量、重复 ID 和字段类型。');
export function modelConfigPublicStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(modelConfigPublicStrings);
  if (isRecord(value)) return Object.entries(value).filter(([k]) => k !== 'apiKey').flatMap(([,v]) => modelConfigPublicStrings(v));
  return [];
}

export function parseModelConfigFile(value: unknown, source: string): Result<LocalModelConfig> {
  if (!isRecord(value) || !exact(value, ['schemaVersion', 'providers']) || ![1,2].includes(value.schemaVersion as number) || !Array.isArray(value.providers) || value.providers.length > 32) return invalid();
  const providers: LocalModelProvider[] = [], ids = new Set<string>(), publicValues = [source];
  for (const p of value.providers) {
    if (!isRecord(p) || !exact(p, value.schemaVersion === 2 ? v2fields : fields) || typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,112}$/.test(p.id) || ids.has(p.id) || !text(p.name, 120) || !['text', 'image', 'video', ...(value.schemaVersion === 2 ? ['speech', 'transcription'] : [])].includes(p.kind as string) || typeof p.allowPrivateEndpoint !== 'boolean' || typeof p.baseURL !== 'string' || typeof p.apiKey !== 'string' || typeof p.modelId !== 'string') return invalid();
    ids.add(p.id);
    publicValues.push(p.id, p.name, p.kind as string, p.baseURL, p.modelId);
    const adapterType = value.schemaVersion === 1 ? (p.kind === 'text' ? 'openai-chat-v1' : p.kind === 'video' ? 'minimax-video-v2' : 'openai-image-v1') : p.adapterType;
    if (!(ADAPTER_TYPES as readonly unknown[]).includes(adapterType)) return invalid();
    if (value.schemaVersion === 2 && !isRecord(p.parameters)) return invalid();
    const defaults = fileModelDefaults(adapterType as AdapterType, (value.schemaVersion === 2 ? p.parameters : {}) as Record<string, ParameterValue>);
    const taskType = defaults.capabilities.taskTypes[0];
    const kind = taskType === 'text_to_speech' ? 'speech' : taskType === 'speech_to_text' ? 'transcription' : defaults.capabilities.outputKinds[0];
    if (kind !== p.kind) return invalid();
    const ref = { libraryId: 'file-validation', id: 'file-validation', revision: 1 };
    const model = parseSaveModel({ id: p.id, expectedRevision: 0, name: p.name, modelId: p.modelId || 'unconfigured', connectionRef: ref, ...defaults, pricing: value.schemaVersion === 2 ? p.pricing : defaults.pricing });
    const profile = parseSaveProfile({ id: p.id, expectedRevision: 0, name: p.name, modelRef: ref, parameters: value.schemaVersion === 2 ? p.parameters : {} });
    if (!model.ok || !profile.ok) return invalid();
    const parameters = resolveModelParameters({ ...model.value, ...ref, createdAt: '' } as ModelDefinition, profile.value.parameters); if (!parameters.ok) return invalid();
    const extended = { adapterType: adapterType as AdapterType, parameters: parameters.value, pricing: model.value.pricing };
    publicValues.push(...modelConfigPublicStrings(extended));
    const empty = [p.baseURL, p.apiKey, p.modelId].map(v => v.trim().length === 0);
    if ((value.schemaVersion === 1 && empty.some(Boolean) && !empty.every(Boolean)) || (value.schemaVersion === 2 && (empty[0] !== empty[2] || empty[0] && !empty[1]))) return fail('MODEL_CONFIG_INCOMPLETE', '请同时填写模型地址与模型 ID；V1 配置还必须填写 Key。');
    if (empty.every(Boolean)) {
      if ([p.baseURL, p.apiKey, p.modelId].some(v => v.length > 8192 || /[\u0000-\u001f\u007f]/.test(v))) return invalid();
      providers.push({ ...extended, id: p.id, name: p.name.trim(), kind: p.kind as 'text' | 'image' | 'video', baseURL: '', apiKey: '', modelId: '', allowPrivateEndpoint: p.allowPrivateEndpoint, state: 'unconfigured', networkPolicy: { privateEndpoint: null } });
      continue;
    }
    if (!(p.apiKey === '' && value.schemaVersion === 2 || text(p.apiKey, 8192)) || !text(p.modelId, 200) || !/^[a-zA-Z0-9_./:-]+$/.test(p.modelId)) return invalid();
    let networkPolicy: NetworkPolicy = { privateEndpoint: null };
    try {
      const url = new URL(p.baseURL);
      if (p.allowPrivateEndpoint) networkPolicy = { privateEndpoint: { hostname: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), purpose: 'model-api' } };
    } catch { return fail('MODEL_CONFIG_ENDPOINT_INVALID', '模型地址无效，请检查 HTTPS 地址和私网授权。'); }
    const endpoint = parseModelEndpoint(p.baseURL, networkPolicy);
    if (!endpoint.ok) return fail('MODEL_CONFIG_ENDPOINT_INVALID', '模型地址无效：禁止账号、查询参数、片段及公共 HTTP；私网需显式授权。');
    // Reach a fixed point before import: normal command parsing removes one trailing slash per pass.
    const baseURL = endpoint.value.baseUrl.replace(/\/+$/, '');
    providers.push({ ...extended, id: p.id, name: p.name.trim(), kind: p.kind as 'text' | 'image' | 'video', baseURL, apiKey: p.apiKey, modelId: p.modelId, allowPrivateEndpoint: p.allowPrivateEndpoint, state: p.apiKey ? 'ready' : 'unconfigured', networkPolicy: endpoint.value.networkPolicy });
  }
  // Reject accidentally pasted credentials in any public field, including another entry.
  publicValues.push(...providers.flatMap(p => [p.id, p.name, p.baseURL, p.modelId]));
  if (providers.some(p => p.apiKey && publicValues.some(value => value.includes(p.apiKey)))) return fail('MODEL_CONFIG_SECRET_IN_PUBLIC_FIELD', '凭据出现在公开配置字段中，请仅在 apiKey 字段填写凭据。');
  return ok({ schemaVersion: value.schemaVersion as 1 | 2, source, providers });
}

/** Revalidate a detached copy before any mutation, including calls from trusted main code. */
export function validateLocalModelConfig(value: unknown): Result<LocalModelConfig> {
  if (!isRecord(value) || !exact(value, ['schemaVersion', 'source', 'providers']) || typeof value.source !== 'string' || !isAbsolute(value.source) || !Array.isArray(value.providers)) return invalid();
  const raw: Record<string, unknown>[] = [];
  for (const p of value.providers) {
    if (!isRecord(p) || !exact(p, [...v2fields, 'state', 'networkPolicy'])) return invalid();
    raw.push(Object.fromEntries((value.schemaVersion === 2 ? v2fields : fields).map(k => [k, p[k]])));
  }
  return parseModelConfigFile({ schemaVersion: value.schemaVersion, providers: raw }, value.source);
}

export async function loadModelConfig(path: string): Promise<Result<LocalModelConfig>> {
  try {
    const handle = await open(path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return fail('MODEL_CONFIG_READ_FAILED', '无法读取模型配置文件，请检查路径和访问权限。');
      if (stat.size > 65536) return fail('MODEL_CONFIG_TOO_LARGE', '模型配置文件不能超过 64 KiB。');
      // A bounded read also covers a file that grows after stat; never read an unbounded file.
      const buffer = Buffer.alloc(65537); let count = 0;
      while (count < buffer.length) { const read = await handle.read(buffer, count, buffer.length - count, null); if (!read.bytesRead) break; count += read.bytesRead; }
      if (count > 65536) return fail('MODEL_CONFIG_TOO_LARGE', '模型配置文件不能超过 64 KiB。');
      try { return parseModelConfigFile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))), resolve(path)); }
      catch { return fail('MODEL_CONFIG_JSON_INVALID', '模型配置不是有效的 UTF-8 JSON，请检查 JSON 语法。'); }
      finally { buffer.fill(0); }
    } finally { await handle.close(); }
  } catch { return fail('MODEL_CONFIG_READ_FAILED', '无法读取模型配置文件，请检查路径和访问权限。'); }
}
