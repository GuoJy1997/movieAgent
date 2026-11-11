import { createHash, randomUUID } from 'node:crypto';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { parseApproveGeneration } from '../../../../packages/contracts/src/generation.ts';
import type { ProviderConnection } from '../../../../packages/contracts/src/models.ts';
import { createHttpTransport } from '../../../../packages/providers/src/http-transport.ts';
import { audioBillingUnits, encodeSpeechRequest, encodeTranscriptionRequest, isAudioProtocol, isSpeechProtocol, normalizeTranscript } from '../../../../packages/providers/src/audio-protocol.ts';
import { priceMicros } from '../../../../packages/domain/src/approval.ts';
import { parseModelConfigFile, type LocalModelProvider } from './model-config-file.ts';
import { h3RequestBytes } from '../../../../packages/providers/src/minimax-h3.ts';
import { isVideoTaskId } from '../../../../packages/providers/src/minimax-video.ts';
import { adapterDefaults } from '../../../../packages/domain/src/model-config.ts';
import type { modelConfigStore } from './model-config-store.ts';

export interface AudioTestSource { bytes: Uint8Array; mime: string; durationTicks: number }
interface TestPlan { testId: string; planHash: string; fingerprint: string; expiresAt: number; summary: string; source?: AudioTestSource; estimateMicros: number | null; currency: string | null }
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : isRecord(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, stable(v[key])])) : v;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');

/** One protected editor owns the plans and receipts. Ordinary renderer never receives keys or source bytes. */
export function createAudioOnboarding(store: ReturnType<typeof modelConfigStore>, options: {
  now?: () => number; timeoutMs?: number;
  pickSource?: () => Promise<Result<AudioTestSource>>;
  validateSpeech?: (bytes: Uint8Array) => Promise<Result<void>>;
} = {}) {
  const transport = createHttpTransport(), now = options.now ?? Date.now;
  let closed = false, sequence = 0, active: AbortController | undefined;
  let plan: TestPlan | undefined, receipt: { id: string; fingerprint: string; expiresAt: number; kind: 'audio' | 'h3_reference_audio' } | undefined;
  async function resolve(input: unknown, list = false): Promise<Result<{ provider: LocalModelProvider; fingerprint: string; clear: boolean }>> {
    if (closed) return fail('MODEL_TEST_CANCELLED', '配置窗口已关闭。');
    if (!isRecord(input) || Object.keys(input).some(key => !['expectedVersion', 'provider', 'testReceipt', 'licensed', 'testId', 'planHash', 'approval'].includes(key)) || typeof input.expectedVersion !== 'string' || !isRecord(input.provider)) return fail('INVALID_INPUT', '音频测试输入无效。');
    const current = await store.readPrivate(); if (!current.ok) return current;
    if (current.value.version !== input.expectedVersion) return fail('MODEL_CONFIG_CONFLICT', '配置文件已修改，请重新载入并测试。');
    const draft = input.provider;
    const fields = ['id', 'name', 'kind', 'baseURL', 'apiKey', 'modelId', 'allowPrivateEndpoint', 'adapterType', 'parameters', 'pricing', 'clearKey'];
    if (Object.keys(draft).length !== fields.length || fields.some(key => !Object.hasOwn(draft, key)) || typeof draft.apiKey !== 'string' || typeof draft.clearKey !== 'boolean' || draft.clearKey && draft.apiKey !== '') return fail('INVALID_INPUT', '音频配置草稿无效。');
    const previous = current.value.config.providers.find(provider => provider.id === draft.id);
    const { clearKey, ...raw } = draft;
    raw.apiKey = clearKey ? '' : draft.apiKey || previous?.apiKey || '';
    if (list && !raw.modelId) raw.modelId = 'manual-audio-model';
    const parsed = parseModelConfigFile({ schemaVersion: 2, providers: [...current.value.config.providers.filter(provider => provider.id !== draft.id).map(({ state, networkPolicy, ...provider }) => provider), raw] }, current.value.config.source);
    if (!parsed.ok) return parsed;
    const provider = parsed.value.providers.find(provider => provider.id === draft.id)!;
    return ok({ provider, fingerprint: digest({ version: input.expectedVersion, provider }), clear: clearKey === true });
  }
  const connection = (provider: LocalModelProvider): ProviderConnection => ({ libraryId: 'audio-onboarding', id: provider.id, revision: 1, createdAt: new Date(now()).toISOString(), name: provider.name, adapterType: provider.adapterType, baseUrl: provider.baseURL, credentialRef: null, headers: {}, networkPolicy: provider.networkPolicy, timeoutMs: options.timeoutMs ?? 30000, concurrency: 1 });
  const isH3 = (provider: LocalModelProvider) => provider.adapterType === 'minimax-h3-v2';
  function h3TestRequest(provider: LocalModelProvider, source: AudioTestSource) {
    const defaults = adapterDefaults('minimax-h3-v2'), modelRef = { libraryId: 'audio-onboarding', id: provider.id, revision: 1 }, hash = createHash('sha256').update(source.bytes).digest('hex'), characterRef = { id: 'character', revision: 1 }, voiceRef = { id: 'voice', revision: 1 };
    return h3RequestBytes({ libraryId: 'audio-onboarding', preparedId: 'onboarding', planHash: 'a'.repeat(64), expiresAt: now() + 600000, projectId: 'onboarding', inputVersion: 'onboarding', executionOwner: 'audio-onboarding', runId: 'onboarding', prompt: '请用参考声音说一句你好。', adapterId: 'minimax-h3-v2', estimateMicros: null, currency: null, config: { schemaVersion: 1, connection: connection(provider), model: { libraryId: 'audio-onboarding', id: provider.id, revision: 1, createdAt: new Date(now()).toISOString(), name: provider.name, modelId: provider.modelId, connectionRef: modelRef, capabilities: defaults.capabilities, parameters: defaults.parameters, pricing: provider.pricing }, profile: { libraryId: 'audio-onboarding', id: 'profile', revision: 1, createdAt: new Date(now()).toISOString(), name: 'H3 test', modelRef, parameters: {} }, parameters: { duration: 4, resolution: '768P', ratio: '16:9' }, pricing: provider.pricing }, referenceAudio: [{ characterRef, voiceRef, ref: { kind: 'artifact', libraryId: 'audio-onboarding', artifactId: 'voice' }, hash, mime: 'audio/wav', byteLength: source.bytes.byteLength, durationTicks: source.durationTicks, probeId: 'onboarding-probe' }], voiceBindings: [{ characterRef, voiceRef }] }, { images: [], audio: [source.bytes] });
  }
  async function listModels(input: unknown) {
    const checked = await resolve(input, true); if (!checked.ok) return checked;
    const p = checked.value.provider;
    if (!isAudioProtocol(p.adapterType) || !p.apiKey) return fail('MODEL_TEST_INCOMPLETE', '请填写音频服务地址与 Key。');
    try {
      const response = await transport.listModels(connection(p), { authorization: `Bearer ${p.apiKey}` });
      if (response.status !== 200) return fail('MODEL_LIST_UNSUPPORTED', '模型列表不可用，可手动填写音频模型 ID 后测试。');
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
      if (!isRecord(parsed) || !Array.isArray(parsed.data)) return fail('MODEL_LIST_INVALID', '模型列表格式无效，请手动填写模型 ID。');
      const models = [...new Set(parsed.data.slice(0, 1000).flatMap(item => isRecord(item) && typeof item.id === 'string' && /^[a-zA-Z0-9_./:-]{1,200}$/.test(item.id) && !item.id.includes(p.apiKey) ? [item.id] : []))];
      return ok({ models, truncated: parsed.data.length > 1000 });
    } catch { return fail('MODEL_LIST_NETWORK', '模型列表请求未完成，可手动填写模型 ID。'); }
  }
  async function prepareTest(input: unknown) {
    const own = ++sequence; active?.abort(); plan = undefined; receipt = undefined;
    const checked = await resolve(input); if (!checked.ok) return checked;
    const p = checked.value.provider;
    if (!isAudioProtocol(p.adapterType) && !isH3(p) || !p.apiKey || checked.value.clear) return fail('MODEL_TEST_INCOMPLETE', '请填写音频服务地址、Key、模型和音色。');
    let source: AudioTestSource | undefined;
    const summary = isH3(p) ? '一次4秒的H3参考声音视频测试' : isSpeechProtocol(p.adapterType) ? '你好，配音测试。' : '一次不超过5秒的已许可音频转写测试';
    if (isSpeechProtocol(p.adapterType)) {
      const encoded = encodeSpeechRequest(p.adapterType, p.modelId, summary, p.parameters); if (!encoded.ok) return encoded;
    } else {
      if (!isRecord(input) || input.licensed !== true || !options.pickSource) return fail('AUDIO_TEST_LICENSE', '请选择自有或已获许可、最长5秒的音频。');
      const picked = await options.pickSource(); if (!picked.ok) return picked; source = picked.value;
      if (source.durationTicks <= 0 || source.durationTicks > 5 * 48000 || source.bytes.byteLength > 24000000) return fail('AUDIO_TEST_LIMIT', '测试音频须不超过5秒和24000000字节。');
    }
    const latest = await resolve(input); if (!latest.ok) return latest;
    if (closed || own !== sequence || latest.value.fingerprint !== checked.value.fingerprint) return fail('MODEL_TEST_CANCELLED', '草稿已更改，请重新准备测试。');
    const testId = randomUUID(), expiresAt = now() + 5 * 60000;
    let estimateMicros: number | null = null;
    if (p.pricing.status === 'configured') {
      const rate = priceMicros('perThousandCharacters' in p.pricing ? p.pricing.perThousandCharacters : 'perAudioSecond' in p.pricing ? p.pricing.perAudioSecond : 'perSecond' in p.pricing ? p.pricing.perSecond : NaN);
      if (!rate.ok) return rate;
      estimateMicros = Math.ceil(rate.value * (isSpeechProtocol(p.adapterType) ? audioBillingUnits(p.adapterType, summary) / 1000 : source!.durationTicks / 48000));
    }
    const currency = p.pricing.status === 'configured' ? p.pricing.currency : null;
    const planHash = digest({ fingerprint: checked.value.fingerprint, testId, expiresAt, summary, source: source ? { hash: createHash('sha256').update(source.bytes).digest('hex'), mime: source.mime, durationTicks: source.durationTicks } : null });
    plan = { testId, planHash, expiresAt, summary, source, fingerprint: checked.value.fingerprint, estimateMicros, currency };
    return ok({ testId, planHash, expiresAt, summary, estimateMicros, currency });
  }
  async function runTest(input: unknown): Promise<Result<{ receipt: string }>> {
    const own = ++sequence; active?.abort(); receipt = undefined;
    const checked = await resolve(input); if (!checked.ok) return checked;
    const pending = plan; plan = undefined;
    if (!pending || !isRecord(input) || pending.testId !== input.testId || pending.planHash !== input.planHash || pending.expiresAt <= now() || pending.fingerprint !== checked.value.fingerprint || !isRecord(input.approval)) return fail('MODEL_TEST_REQUIRED', '请先准备当前配置的音频测试。');
    const approval = parseApproveGeneration({ ...input.approval, preparedId: pending.testId, approvedPlanHash: pending.planHash, executionOwner: 'audio-onboarding', runId: pending.testId });
    if (!approval.ok) return approval;
    if (!approval.value.acknowledgeUnknown || approval.value.allowanceMicros > approval.value.budgetLimitMicros) return fail('UNKNOWN_PRICE_CONFIRMATION', '请确认此次测试的有限风险额度，实际账单未知。');
    if (pending.currency !== null && pending.currency !== approval.value.currency || pending.estimateMicros !== null && pending.estimateMicros > approval.value.allowanceMicros) return fail('ALLOWANCE_EXCEEDED', '此次测试的币种或有限额度低于配置估算。');
    const p = checked.value.provider, abort = new AbortController(); active = abort;
    try {
      if (isH3(p)) {
        const body = h3TestRequest(p, pending.source!); if (!body.ok) return body;
        const response = await transport.video(connection(p), body.value, { authorization: `Bearer ${p.apiKey}` }, undefined, abort.signal);
        if (![200, 201, 202].includes(response.status)) return fail('MODEL_AUDIO_TEST_FAILED', 'H3 测试未获受理，请检查认证、模型及服务地址。');
        const data: unknown = JSON.parse(Buffer.from(response.bytes).toString('utf8'));
        if (!isRecord(data) || !isVideoTaskId(data.task_id)) return fail('INVALID_AUDIO_RESPONSE', 'H3 响应缺少有效任务 ID。');
        const latest = await resolve(input); if (!latest.ok) return latest;
        if (closed || own !== sequence || latest.value.fingerprint !== pending.fingerprint) return fail('MODEL_TEST_CANCELLED', '草稿已改变，测试不能授权保存。');
        const id = randomUUID(); receipt = { id, fingerprint: pending.fingerprint, expiresAt: now() + 10 * 60000, kind: 'h3_reference_audio' };
        return ok({ receipt: id });
      }
      const encoded = isSpeechProtocol(p.adapterType) ? encodeSpeechRequest(p.adapterType, p.modelId, pending.summary, p.parameters) : encodeTranscriptionRequest(p.adapterType, p.modelId, { hash: '', mime: pending.source!.mime, byteLength: pending.source!.bytes.byteLength, durationTicks: pending.source!.durationTicks }, p.parameters, pending.source!.bytes);
      if (!encoded.ok) return encoded;
      if (closed || own !== sequence) return fail('MODEL_TEST_CANCELLED', '测试已取消。');
      const request = Buffer.isBuffer(encoded.value) ? { body: encoded.value, contentType: 'application/json' } : encoded.value;
      const response = await transport.audio(connection(p), request.body, request.contentType, { authorization: `Bearer ${p.apiKey}` }, abort.signal);
      if (response.status !== 200) return fail('MODEL_AUDIO_TEST_FAILED', '音频测试未成功，请检查认证、模型及服务地址。');
      if (isSpeechProtocol(p.adapterType)) {
        let bytes = response.bytes;
        if (p.adapterType === 'minimax-speech-v1') {
          const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
          if (!isRecord(parsed) || !isRecord(parsed.base_resp) || parsed.base_resp.status_code !== 0 || !isRecord(parsed.data) || typeof parsed.data.audio !== 'string' || !parsed.data.audio.length || parsed.data.audio.length % 2 || !/^[0-9a-fA-F]+$/.test(parsed.data.audio)) return fail('INVALID_AUDIO_RESPONSE', '配音响应格式无效。');
          bytes = Buffer.from(parsed.data.audio, 'hex');
        }
        if (!bytes.length || bytes.length > 128 * 1024 * 1024) return fail('INVALID_AUDIO_RESPONSE', '配音响应超出限制。');
        if (options.validateSpeech) { const valid = await options.validateSpeech(bytes); if (!valid.ok) return valid; }
      } else {
        const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
        if (isRecord(raw) && raw.base_resp !== undefined && (!isRecord(raw.base_resp) || raw.base_resp.status_code !== 0)) return fail('INVALID_AUDIO_RESPONSE', '转写服务拒绝测试。');
        const valid = normalizeTranscript(isRecord(raw) && isRecord(raw.data) ? raw.data : raw, pending.source!.durationTicks); if (!valid.ok) return valid;
        if (p.parameters.timestamps === 'segments' && valid.value.timing !== 'segments') return fail('MODEL_AUDIO_MODE_UNSUPPORTED', '测试没有返回可靠句段时间，请关闭时间戳模式或更换支持的模型。');
      }
      const latest = await resolve(input); if (!latest.ok) return latest;
      if (closed || own !== sequence || latest.value.fingerprint !== pending.fingerprint) return fail('MODEL_TEST_CANCELLED', '草稿已改变，测试不能授权保存。');
      const id = randomUUID(); receipt = { id, fingerprint: pending.fingerprint, expiresAt: now() + 10 * 60000, kind: 'audio' };
      return ok({ receipt: id });
    } catch { return fail('MODEL_TEST_NETWORK', '音频测试结果未确认，未自动重试。请核实服务记录后决定是否另发测试。'); }
    finally { if (active === abort) active = undefined; }
  }
  async function authorize(input: unknown): Promise<Result<void>> {
    const checked = await resolve(input); if (!checked.ok) return checked;
    if (!isAudioProtocol(checked.value.provider.adapterType) && !isH3(checked.value.provider) || checked.value.clear || !checked.value.provider.apiKey) return ok(undefined);
    if (!isRecord(input) || !receipt || receipt.id !== input.testReceipt || receipt.fingerprint !== checked.value.fingerprint || receipt.expiresAt <= now() || receipt.kind !== (isH3(checked.value.provider) ? 'h3_reference_audio' : 'audio')) return fail('MODEL_TEST_REQUIRED', '请先测试当前音频配置，再保存。');
    receipt = undefined; return ok(undefined);
  }
  async function saveVerified(input: unknown) {
    const authorized = await authorize(input); if (!authorized.ok) return authorized;
    if (!isRecord(input) || typeof input.expectedVersion !== 'string') return fail('INVALID_INPUT', '保存输入无效。');
    return store.save({ expectedVersion: input.expectedVersion, provider: input.provider });
  }
  function cancel() { closed = true; sequence++; active?.abort(); plan = undefined; receipt = undefined; }
  return { listModels, prepareTest, runTest, saveVerified, authorize, cancel };
}
