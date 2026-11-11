import { fileModelDefaults } from '../../../../packages/domain/src/model-config.ts';
import { createHash } from 'node:crypto';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { isResult, type ModelConfigStatus } from '../../../../packages/contracts/src/desktop.ts';
import { isReceipt, type CommandMap } from '../../../../packages/contracts/src/commands.ts';
import { queryOutputValidators, type QueryMap } from '../../../../packages/contracts/src/queries.ts';
import { isRevisionRef, parseSaveConnection, parseSaveModel, parseSaveProfile, type ProviderConnection, type ModelDefinition, type ModelProfile, type RevisionRef } from '../../../../packages/contracts/src/models.ts';
import type { EngineHost } from './engine-host.ts';
import type { CredentialVault } from './credential-vault.ts';
import { validateLocalModelConfig, type LocalModelConfig } from './model-config-file.ts';
import { fileImportIdentity, isFileImportReceipt } from '../../../../packages/contracts/src/model-config-file.ts';
import type { modelConfigStore } from './model-config-store.ts';

type ImportHost = Pick<EngineHost, 'identity' | 'query' | 'execute' | 'updateCredentialStatus' | 'credentialStatuses'>;
type Kind = 'provider.saveConnection' | 'model.saveDefinition' | 'profile.save';
type Stored = ProviderConnection | ModelDefinition | ModelProfile;
interface Options { host: ImportHost; vault: CredentialVault; config: LocalModelConfig }
const pending = new Map<string, Promise<unknown>>();
const messages = {
  MODEL_CONFIG_IMPORT_FAILED: '模型配置导入未完成，请重新载入配置以恢复。',
  MODEL_CONFIG_ID_CONFLICT: '文件配置 ID 与手工配置冲突，请修改配置文件中的 provider ID。',
  MODEL_CONFIG_CREDENTIAL_SYNC_FAILED: '凭据状态同步未完成，请重新载入配置以恢复。',
  MODEL_CONFIG_CREDENTIAL_SAVE_FAILED: '受保护凭据未保存，请检查系统保护和磁盘空间后重新载入。',
};
class ImportFailure extends Error { constructor(readonly code: keyof typeof messages) { super(messages[code]); } }
const stop = (code: keyof typeof messages = 'MODEL_CONFIG_IMPORT_FAILED'): never => { throw new ImportFailure(code); };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const initId = (libraryId: string, kind: Kind, id: string) => `file-init-${createHash('sha256').update(fileImportIdentity(libraryId, kind, id)).digest('hex')}`;
function latest<T extends Stored>(items: T[], id: string): T | undefined { return items.filter(v => v.id === id).sort((a, b) => b.revision - a.revision)[0]; }
function same(current: Stored | undefined, input: CommandMap[Kind]['input']): boolean {
  if (!current) return false;
  const { libraryId: _l, revision: _r, createdAt: _t, ...stored } = current;
  const { expectedRevision: _e, ...desired } = input;
  return canonical(stored) === canonical(desired);
}

async function run({ host, vault, config }: Options): Promise<Result<ModelConfigStatus>> {
  const active = config.providers.filter(p => p.state === 'ready');
  const status: ModelConfigStatus = { source: config.source, providerIds: config.providers.map(p => p.id), state: active.length ? 'ready' : 'unconfigured', errorCode: null };
  if (active.length && !vault.protectionAvailable()) return fail('SYSTEM_PROTECTION_UNAVAILABLE', '系统保护不可用，模型配置未导入。请修复系统保护后重新载入。');
  const libraryId = host.identity.libraryId;
  const envelope = { schemaVersion: 1 as const, libraryId, connectionEpoch: 'model-config-file' };
  async function query<K extends keyof QueryMap>(kind: K, payload: QueryMap[K]['input']): Promise<QueryMap[K]['output']> {
    const result = await host.query({ ...envelope, queryId: 'model-config-file', kind, payload });
    const validate = queryOutputValidators[kind] as (v: unknown) => v is QueryMap[K]['output'];
    if (!isResult(result, validate) || !result.ok) return stop();
    return result.value;
  }
  async function save(kind: Kind, input: CommandMap[Kind]['input'], current?: Stored): Promise<RevisionRef> {
    if (same(current, input)) return { libraryId, id: current!.id, revision: current!.revision };
    // Only secret-free normalized payloads contribute to persisted command identities.
    const commandId = input.expectedRevision === 0 ? initId(libraryId, kind, input.id) : `file-save-${digest({ libraryId, kind, input })}`;
    const result = await host.execute({ ...envelope, commandId, kind, payload: input });
    if (!isResult(result, isReceipt) || !result.ok || result.value.commandId !== commandId || result.value.libraryId !== libraryId || !isRevisionRef(result.value.result) || result.value.result.id !== input.id || result.value.result.revision !== input.expectedRevision + 1) return stop();
    return result.value.result;
  }
  try {
    const connections = (await query('provider.list', {})).connections;
    const models = (await query('model.list', {})).models;
    const profiles = (await query('profile.list', {})).profiles;
    // Check every collision before creating anything. Prefix alone is not proof of ownership.
    for (const p of active) {
      const entries: [Kind, Stored | undefined][] = [
        ['provider.saveConnection', latest(connections, `file-${p.id}-connection`)],
        ['model.saveDefinition', latest(models, `file-${p.id}-model`)],
        ['profile.save', latest(profiles, `file-${p.id}-profile`)],
      ];
      for (const [kind, current] of entries) if (current) {
        const receipt = await query('command.receipt', { commandId: initId(libraryId, kind, current.id) });
        if (!isFileImportReceipt(receipt, libraryId, current.id)) return stop('MODEL_CONFIG_ID_CONFLICT');
      }
    }
    for (const p of active) {
      const id = `file-${p.id}-connection`;
      let connection = latest(connections, id);
      const connectionInput = { id, expectedRevision: connection?.revision ?? 0, name: p.name, adapterType: p.adapterType, baseUrl: p.baseURL, credentialRef: null, headers: {}, networkPolicy: p.networkPolicy, timeoutMs: p.kind === 'text' ? 300000 : 60000, concurrency: 1 };
      // Credential authorization requires an existing connection; this draft is recoverable via its init receipt.
      if (!connection) {
        const draft = parseSaveConnection(connectionInput); if (!draft.ok) return stop();
        const ref = await save('provider.saveConnection', draft.value);
        const { expectedRevision: _r, ...data } = draft.value;
        connection = { ...data, ...ref, createdAt: new Date().toISOString() };
      }
      const owner = { libraryId, connectionId: id };
      let credentialRef = await vault.findProtectedMatch(p.apiKey, owner);
      if (!credentialRef) {
        const saved = await vault.put(p.apiKey, owner, 'protected');
        if (!saved.ok) return stop('MODEL_CONFIG_CREDENTIAL_SAVE_FAILED');
        credentialRef = saved.value;
      }
      const credential = await vault.status(credentialRef);
      if (!credential.ok || credential.value.state !== 'protected' || !(await host.updateCredentialStatus(credential.value)).ok) return stop('MODEL_CONFIG_CREDENTIAL_SYNC_FAILED');
      const bound = parseSaveConnection({ ...connectionInput, expectedRevision: connection.revision, credentialRef }); if (!bound.ok) return stop();
      const connectionRef = await save('provider.saveConnection', bound.value, connection);
      const model = latest(models, `file-${p.id}-model`);
      const modelInput = parseSaveModel({ id: `file-${p.id}-model`, expectedRevision: model?.revision ?? 0, name: p.name, modelId: p.modelId, connectionRef, ...fileModelDefaults(bound.value.adapterType, p.parameters), pricing: p.pricing });
      if (!modelInput.ok) return stop();
      const modelRef = await save('model.saveDefinition', modelInput.value, model);
      const profile = latest(profiles, `file-${p.id}-profile`);
      const profileInput = parseSaveProfile({ id: `file-${p.id}-profile`, expectedRevision: profile?.revision ?? 0, name: p.name, modelRef, parameters: p.parameters }); if (!profileInput.ok) return stop();
      await save('profile.save', profileInput.value, profile);
    }
    // Disabling affects only proven file-import owners. Historical revisions and
    // protected envelopes remain available to already accepted provider tasks.
    const activeIds = new Set(active.map(p => `file-${p.id}-connection`));
    async function owned(kind: Kind, item: Stored) {
      const receipt = await query('command.receipt', { commandId: initId(libraryId, kind, item.id) });
      return isFileImportReceipt(receipt, libraryId, item.id);
    }
    for (const id of new Set(connections.map(c => c.id))) {
      const c = latest(connections, id)!;
      if (activeIds.has(id) || !await owned('provider.saveConnection', c)) continue;
      const { libraryId: _l, revision, createdAt: _t, ...data } = c;
      const connectionRef = await save('provider.saveConnection', { ...data, expectedRevision: revision, credentialRef: null, headers: {} }, c);
      for (const modelId of new Set(models.filter(m => m.connectionRef.id === id).map(m => m.id))) {
        const m = latest(models, modelId)!; if (!await owned('model.saveDefinition', m)) continue;
        const { libraryId: _ml, revision: mr, createdAt: _mt, ...md } = m;
        const modelRef = await save('model.saveDefinition', { ...md, expectedRevision: mr, connectionRef }, m);
        for (const profileId of new Set(profiles.filter(p => p.modelRef.id === modelId).map(p => p.id))) {
          const p = latest(profiles, profileId)!; if (!await owned('profile.save', p)) continue;
          const { libraryId: _pl, revision: pr, createdAt: _pt, ...pd } = p;
          await save('profile.save', { ...pd, expectedRevision: pr, modelRef }, p);
        }
      }
    }
    status.managedIds = { connections: [], models: [], profiles: [] };
    for (const [kind, items, target] of [
      ['provider.saveConnection', connections, status.managedIds.connections],
      ['model.saveDefinition', models, status.managedIds.models],
      ['profile.save', profiles, status.managedIds.profiles],
    ] as const) for (const id of new Set(items.map(p => p.id))) if (await owned(kind, items.find(p => p.id === id)!)) target.push(id);
    for (const p of active) {
      if (!status.managedIds.connections.includes(`file-${p.id}-connection`)) status.managedIds.connections.push(`file-${p.id}-connection`);
      if (!status.managedIds.models.includes(`file-${p.id}-model`)) status.managedIds.models.push(`file-${p.id}-model`);
      if (!status.managedIds.profiles.includes(`file-${p.id}-profile`)) status.managedIds.profiles.push(`file-${p.id}-profile`);
    }
    return ok(status);
  } catch (error) {
    // Never forward engine, OS, parsing or provider strings that could include config values.
    const code = error instanceof ImportFailure ? error.code : 'MODEL_CONFIG_IMPORT_FAILED';
    return fail(code, messages[code]);
  }
}

export async function importModelConfig(options: Options): Promise<Result<ModelConfigStatus>> {
  const validated = validateLocalModelConfig(options.config);
  if (!validated.ok) return validated;
  // One main process owns each library; serialize reload clicks and detached copies of config.
  const libraryId = options.host.identity.libraryId;
  const operation = (pending.get(libraryId) ?? Promise.resolve()).then(() => run({ ...options, config: validated.value }));
  pending.set(libraryId, operation);
  try { return await operation; }
  finally { if (pending.get(libraryId) === operation) pending.delete(libraryId); }
}

/** Per-host admission barrier; reads the fixed file on each new admission, and
 * coalesces unchanged imports. Recreate for a restarted engine. No background I/O. */
export function createModelConfigSynchronizer(options: Omit<Options, 'config'> & { store: ReturnType<typeof modelConfigStore> }) {
  let tail: Promise<unknown> = Promise.resolve();
  let applied: { version: string; status: ModelConfigStatus } | undefined;
  return {
    synchronize(force = false): Promise<Result<ModelConfigStatus>> {
      const operation = tail.then(async () => {
        const loaded = await options.store.readPrivate(); if (!loaded.ok) return loaded;
        if (!force && applied?.version === loaded.value.version) return ok(applied.status);
        // Import may commit some revisions before an ACK/status failure. An old
        // successful file hash can no longer prove the host matches that version.
        applied = undefined;
        const result = await importModelConfig({ ...options, config: loaded.value.config });
        if (result.ok) applied = { version: loaded.value.version, status: result.value };
        return result;
      }).catch(() => fail('MODEL_CONFIG_IMPORT_FAILED','模型配置尚未同步，请重新载入后再生成。'));
      tail = operation;
      return operation;
    },
  };
}
