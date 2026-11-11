import { createHash, randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import type { PublicModelConfig, RedactedProvider, RemoveModelConfigProviderInput } from '../../../../packages/contracts/src/model-config-file.ts';
import { parseModelConfigFile, modelConfigPublicStrings, type LocalModelConfig, type LocalModelProvider } from './model-config-file.ts';

// This input is private to the dedicated entry surface. Never expose on DesktopBridge.
export interface ModelConfigDraft extends Omit<RedactedProvider, 'hasKey' | 'state'> { apiKey: string; clearKey: boolean }
const fields = ['id','name','kind','baseURL','apiKey','modelId','allowPrivateEndpoint','adapterType','parameters','pricing'];
const raw = (p: LocalModelProvider) => Object.fromEntries(fields.map(k => [k, p[k as keyof LocalModelProvider]]));
const version = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const conflict = () => fail('MODEL_CONFIG_CONFLICT', '配置文件已被修改，草稿已保留。请重新载入文件并核对后再保存。');
export function modelConfigStore(filePath: string) {
  const path = resolve(filePath);
  async function readPrivate(): Promise<Result<{ config: LocalModelConfig; version: string }>> {
    try {
      const handle = await open(path, 'r');
      const bytes = Buffer.alloc(65537);
      try {
        if (!(await handle.stat()).isFile()) throw Error();
        let size = 0; while (size < bytes.length) { const r = await handle.read(bytes, size, bytes.length - size, null); if (!r.bytesRead) break; size += r.bytesRead; }
        if (size > 65536) return fail('MODEL_CONFIG_TOO_LARGE', '模型配置不能超过 64 KiB。');
        const config = parseModelConfigFile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0,size))), path);
        return config.ok ? ok({ config: config.value, version: version(bytes.subarray(0,size)) }) : config;
      } finally { bytes.fill(0); await handle.close(); }
    } catch { return fail('MODEL_CONFIG_READ_FAILED', '无法读取配置，请检查文件权限和 JSON 格式。'); }
  }
  async function readPublic(): Promise<Result<PublicModelConfig>> {
    const result = await readPrivate(); if (!result.ok) return result;
    return ok({ source: path, version: result.value.version, providers: result.value.config.providers.map(({ apiKey, networkPolicy: _policy, ...p }) => ({ ...p, hasKey: !!apiKey })) });
  }
  async function mutate(expectedVersion: string, change: (config: LocalModelConfig) => Result<unknown[]>): Promise<Result<{ version: string }>> {
    let lock: DatabaseSync | undefined, locked = false, temporary: string | undefined;
    try {
      // Persistent sidecar is intentionally never unlinked: SQLite owns the OS lock,
      // including process-death recovery, so one writer cannot release another's lock.
      lock = new DatabaseSync(`${path}.write-lock.sqlite`);
      try { lock.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); locked = true; }
      catch { return fail('MODEL_CONFIG_BUSY', '另一个窗口正在保存配置，请保留草稿并稍后重试。'); }
      const current = await readPrivate(); if (!current.ok) return current;
      if (current.value.version !== expectedVersion) return conflict();
      const changed = change(current.value.config); if (!changed.ok) return changed;
      const checked = parseModelConfigFile({ schemaVersion: 2, providers: changed.value }, path); if (!checked.ok) return checked;
      // Include removed/replaced keys: clearing a key must never unmask a pasted secret.
      const publicValues = [...modelConfigPublicStrings(changed.value), ...modelConfigPublicStrings(checked.value.providers)];
      if (current.value.config.providers.some(p => p.apiKey && publicValues.some(v => v.includes(p.apiKey)))) return fail('MODEL_CONFIG_SECRET_IN_PUBLIC_FIELD', '凭据不能出现在公开字段中。');
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 2, providers: checked.value.providers.map(raw) }, null, 2) + '\n');
      if (bytes.length > 65536) return fail('MODEL_CONFIG_TOO_LARGE', '模型配置不能超过 64 KiB。');
      temporary = `${path}.${randomUUID()}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      // Recheck immediately before replacement to detect external editors while writing.
      const latest = await readPrivate(); if (!latest.ok) return latest;
      if (latest.value.version !== expectedVersion) return conflict();
      await rename(temporary, path); temporary = undefined;
      return ok({ version: version(bytes) });
    } catch { return fail('MODEL_CONFIG_WRITE_FAILED', '配置未保存，请检查文件权限、磁盘空间后重试；草稿已保留。'); }
    finally { if (temporary) await unlink(temporary).catch(() => {}); if (locked) lock!.exec('ROLLBACK'); lock?.close(); }
  }
  return {
    readPrivate, readPublic,
    save(input: { expectedVersion: string; provider: unknown }): Promise<Result<{ version: string }>> {
      return mutate(input.expectedVersion, config => {
        const p = input.provider;
        if (!isRecord(p) || Object.keys(p).length !== fields.length + 1 || ![...fields,'clearKey'].every(k => Object.hasOwn(p,k)) || typeof p.apiKey !== 'string' || typeof p.clearKey !== 'boolean' || p.clearKey && p.apiKey !== '') return fail('MODEL_CONFIG_INVALID', '配置输入格式无效。');
        const old = config.providers.find(v => v.id === p.id);
        const replacement = { ...p, apiKey: p.clearKey ? '' : p.apiKey || old?.apiKey || '' }; delete (replacement as Record<string,unknown>).clearKey;
        return ok([...config.providers.filter(v => v.id !== p.id).map(raw), replacement]);
      });
    },
    remove(input: RemoveModelConfigProviderInput) {
      return mutate(input.expectedVersion, config => config.providers.some(p => p.id === input.providerId) ? ok(config.providers.filter(p => p.id !== input.providerId).map(raw)) : fail('MODEL_CONFIG_NOT_FOUND', '该配置已不存在，请重新载入。'));
    },
  };
}
