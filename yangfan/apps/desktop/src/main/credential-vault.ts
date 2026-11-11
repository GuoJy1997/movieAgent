import { mkdir, open, readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { isCredentialRef, type CredentialRef, type CredentialStatus } from '../../../../packages/contracts/src/models.ts';
export interface StringProtector { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string; getSelectedStorageBackend?(): string }
interface Entry { ref: CredentialRef; mode: 'protected' | 'session'; revoked: boolean; ciphertext?: string }
export class CredentialVault {
  private entries = new Map<string, Entry>();
  private sessions = new Map<string, string>();
  private retainedVersions = new Map<string, number>();
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private constructor(private readonly directory: string, private readonly protection: StringProtector) {}
  static async open(directory: string, protection: StringProtector, retainedReferences: readonly CredentialRef[]): Promise<CredentialVault> {
    const vault = new CredentialVault(directory, protection);
    // Only trusted library metadata may supply this floor; it is never a renderer option.
    for (const ref of retainedReferences) {
      if (!isCredentialRef(ref)) throw new Error('Retained credential reference is invalid.');
      const key = `${ref.libraryId}:${ref.connectionId}`;
      vault.retainedVersions.set(key, Math.max(vault.retainedVersions.get(key) ?? 0, ref.version));
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(directory)) {
      if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) continue;
      const data: unknown = JSON.parse(await readFile(join(directory, name), 'utf8'));
      if (!isRecord(data) || !isCredentialRef(data.ref) || name !== `${data.ref.id}.json` || !['protected', 'session'].includes(data.mode as string) || typeof data.revoked !== 'boolean' || Object.keys(data).some(k => !['ref', 'mode', 'revoked', 'ciphertext'].includes(k)) || data.mode === 'session' && data.ciphertext !== undefined || data.mode === 'protected' && (typeof data.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(data.ciphertext))) throw new Error('Credential vault metadata is invalid.');
      const entry = data as unknown as Entry;
      if ([...vault.entries.values()].some(old => old.ref.libraryId === entry.ref.libraryId && old.ref.connectionId === entry.ref.connectionId && old.ref.version === entry.ref.version)) throw new Error('Credential vault version conflict.');
      vault.entries.set(entry.ref.id, entry);
    }
    return vault;
  }
  protectionAvailable(): boolean {
    try { return !this.closed && this.protection.isEncryptionAvailable() && this.protection.getSelectedStorageBackend?.() !== 'basic_text'; } catch { return false; }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const run = this.pending.then(operation, operation); this.pending = run.then(() => undefined, () => undefined); return run; }
  private find(ref: CredentialRef): Entry | undefined { const entry = this.entries.get(ref.id); return entry && entry.ref.version === ref.version && entry.ref.libraryId === ref.libraryId && entry.ref.connectionId === ref.connectionId ? entry : undefined; }
  private async persist(entry: Entry): Promise<void> {
    const target = join(this.directory, `${entry.ref.id}.json`);
    const temporary = join(this.directory, `${entry.ref.id}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(entry)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, target);
  }
  put(secret: string, owner: { libraryId: string; connectionId: string }, mode: 'protected' | 'session' = 'protected'): Promise<Result<CredentialRef>> {
    return this.serial(async () => {
      if (this.closed) return fail('VAULT_CLOSED', '凭据存储已关闭。');
      if (typeof secret !== 'string' || secret.length < 1 || secret.length > 8192 || !secret.trim() || /[\u0000-\u001f\u007f]/.test(secret) || !isCredentialRef({ ...owner, id: 'validation', version: 1 }) || !['protected', 'session'].includes(mode)) return fail('INVALID_CREDENTIAL', '凭据格式无效。');
      if (mode === 'protected' && !this.protectionAvailable()) return fail('SYSTEM_PROTECTION_UNAVAILABLE', '系统保护不可用。请修复系统保护或明确选择仅本次会话保存。');
      const highest = Math.max(this.retainedVersions.get(`${owner.libraryId}:${owner.connectionId}`) ?? 0, ...[...this.entries.values()].filter(entry => entry.ref.libraryId === owner.libraryId && entry.ref.connectionId === owner.connectionId).map(entry => entry.ref.version));
      if (!Number.isSafeInteger(highest + 1)) return fail('CREDENTIAL_VERSION_EXHAUSTED', '凭据版本已达到上限，请建立新连接。');
      const version = highest + 1;
      const ref: CredentialRef = { libraryId: owner.libraryId, connectionId: owner.connectionId, id: randomUUID(), version };
      try {
        const entry: Entry = { ref, mode, revoked: false, ...(mode === 'protected' ? { ciphertext: this.protection.encryptString(secret).toString('base64') } : {}) };
        await this.persist(entry);
        this.entries.set(ref.id, entry);
        if (mode === 'session' && !this.closed) this.sessions.set(ref.id, secret);
        return ok({ ...ref });
      } catch { return fail('CREDENTIAL_SAVE_FAILED', '凭据未保存，请检查系统保护和磁盘空间。'); }
    });
  }
  async status(ref: CredentialRef): Promise<Result<CredentialStatus>> {
    if (this.closed || !isCredentialRef(ref)) return fail('CREDENTIAL_UNAVAILABLE', '凭据不可用。');
    const entry = this.find(ref); if (!entry) return fail('CREDENTIAL_UNAVAILABLE', '凭据引用或归属无效。');
    let state: CredentialStatus['state'] = 'unavailable';
    if (entry.revoked) state = 'revoked';
    else if (entry.mode === 'session' && this.sessions.has(ref.id)) state = 'session';
    else if (entry.mode === 'protected' && this.protectionAvailable()) {
      try { const buffer = Buffer.from(entry.ciphertext!, 'base64'); try { if (this.protection.decryptString(buffer)) state = 'protected'; } finally { buffer.fill(0); } } catch { /* Another account/machine may not decrypt this envelope. */ }
    }
    return ok({ ref: { ...ref }, state });
  }
  async withSecret<T>(ref: CredentialRef, operation: (secret: string) => Promise<T>): Promise<Result<T>> {
    const status = await this.status(ref); if (!status.ok) return status;
    if (status.value.state === 'revoked') return fail('CREDENTIAL_REVOKED', '凭据已紧急撤销，后续使用被阻止。');
    if (status.value.state === 'unavailable') return fail('CREDENTIAL_UNAVAILABLE', '凭据不可解密或仅会话凭据已过期，请重新配置。');
    const entry = this.find(ref)!;
    let secret: string | undefined;
    try {
      // Recheck after asynchronous status: a concurrent revoke wins before delivery.
      if (entry.revoked || this.closed) return fail('CREDENTIAL_REVOKED', '凭据已撤销或存储已关闭。');
      if (entry.mode === 'session') secret = this.sessions.get(ref.id);
      else { const buffer = Buffer.from(entry.ciphertext!, 'base64'); try { secret = this.protection.decryptString(buffer); } finally { buffer.fill(0); } }
      if (!secret) return fail('CREDENTIAL_UNAVAILABLE', '凭据不可用。');
      return ok(await operation(secret));
    } catch { return fail('CREDENTIAL_USE_FAILED', '凭据操作失败。'); }
    finally { secret = undefined; } // JS strings cannot be securely zeroed; never claim memory erasure.
  }
  /** Main-only recovery of an already saved protected envelope, including a save interrupted before status sync. */
  async findProtectedMatch(secret: string, owner: { libraryId: string; connectionId: string }): Promise<CredentialRef | null> {
    const entries = [...this.entries.values()].filter(entry => entry.mode === 'protected' && !entry.revoked && entry.ref.libraryId === owner.libraryId && entry.ref.connectionId === owner.connectionId).sort((a, b) => b.ref.version - a.ref.version);
    for (const entry of entries) {
      const equal = await this.withSecret(entry.ref, async value => value === secret);
      if (equal.ok && equal.value) return { ...entry.ref };
    }
    return null;
  }
  revoke(ref: CredentialRef): Promise<Result<CredentialStatus>> {
    return this.serial(async () => {
      if (this.closed || !isCredentialRef(ref)) return fail('CREDENTIAL_UNAVAILABLE', '凭据不可用。');
      const entry = this.find(ref); if (!entry) return fail('CREDENTIAL_UNAVAILABLE', '凭据引用或归属无效。');
      // Fail closed in this process even if persistence fails. Caller must report the failure.
      entry.revoked = true; this.sessions.delete(ref.id);
      try { await this.persist(entry); return ok({ ref: { ...ref }, state: 'revoked' }); }
      catch { return fail('CREDENTIAL_REVOKE_FAILED', '本会话已阻止使用，但撤销状态未能持久保存，请检查磁盘。'); }
    });
  }
  close(): void { this.closed = true; this.sessions.clear(); }
}
