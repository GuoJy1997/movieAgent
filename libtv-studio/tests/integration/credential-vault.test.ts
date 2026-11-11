import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialVault } from '../../apps/desktop/src/main/credential-vault';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';
const roots: string[] = [];
const engines: EngineHandle[] = [];
const unavailable = { isEncryptionAvailable: () => false, encryptString: (): Buffer => { throw new Error('Unavailable'); }, decryptString: (): string => { throw new Error('Unavailable'); } };
const owner = { libraryId: 'library-a', connectionId: 'connection-a' };
afterEach(async () => { for (const engine of engines.splice(0)) await engine.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
// Removing the protection gate must not silently store a dummy key as plaintext.
it('requires explicit session mode when system protection is unavailable and never persists its secret', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-vault-')); roots.push(root);
  const vault = await CredentialVault.open(root, unavailable, []);
  expect(await vault.put('dummy-session-secret', owner, 'protected')).toMatchObject({ ok: false, error: { code: 'SYSTEM_PROTECTION_UNAVAILABLE' } });
  const saved = await vault.put('dummy-session-secret', owner, 'session'); if (!saved.ok) throw new Error('session save');
  expect(await vault.status(saved.value)).toEqual({ ok: true, value: { ref: saved.value, state: 'session' } });
  expect(await vault.withSecret(saved.value, async secret => secret === 'dummy-session-secret')).toEqual({ ok: true, value: true });
  expect(await vault.withSecret({ ...saved.value, libraryId: 'foreign' }, async () => true)).toMatchObject({ ok: false });
  for (const file of await readdir(root)) expect((await readFile(join(root, file))).includes(Buffer.from('dummy-session-secret'))).toBe(false);
  const reopened = await CredentialVault.open(root, unavailable, []);
  expect(await reopened.status(saved.value)).toMatchObject({ ok: true, value: { state: 'unavailable' } });
  expect(await reopened.withSecret(saved.value, async () => true)).toMatchObject({ ok: false, error: { code: 'CREDENTIAL_UNAVAILABLE' } });
});

// Replacing the active slot must retain an earlier run's ref and irreversible revocation.
it('retains old owned versions, serializes concurrent saves, and persists emergency revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-vault-version-')); roots.push(root);
  const vault = await CredentialVault.open(root, unavailable, []);
  const [one, two] = await Promise.all([vault.put('dummy-old', owner, 'session'), vault.put('dummy-new', owner, 'session')]);
  if (!one.ok || !two.ok) throw new Error('version save');
  expect([one.value.version, two.value.version]).toEqual([1, 2]);
  expect(await vault.withSecret(one.value, async secret => secret === 'dummy-old')).toEqual({ ok: true, value: true });
  expect(await vault.withSecret(two.value, async secret => secret === 'dummy-new')).toEqual({ ok: true, value: true });
  expect(await vault.revoke({ ...one.value, connectionId: 'foreign' })).toMatchObject({ ok: false });
  expect(await vault.revoke(one.value)).toMatchObject({ ok: true, value: { state: 'revoked' } });
  expect(await vault.withSecret(one.value, async () => true)).toMatchObject({ ok: false, error: { code: 'CREDENTIAL_REVOKED' } });
  expect(await (await CredentialVault.open(root, unavailable, [])).status(one.value)).toMatchObject({ ok: true, value: { state: 'revoked' } });
  vault.close(); expect(await vault.withSecret(two.value, async () => true)).toMatchObject({ ok: false });
});

// A missing vault must not restart at version1 and collide with retained trusted library records.
it('reconfigures a reopened existing library on the first attempt using the greater of retained metadata and envelope versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-vault-replacement-')); roots.push(root);
  async function openEngine() { const opened = await startEngine({ root: join(root, 'library') }); if (!opened.ok) throw new Error('engine'); engines.push(opened.value); return opened.value; }
  const original = await openEngine();
  const owned = { libraryId: original.identity.libraryId, connectionId: 'connection-a' };
  const input = { id: owned.connectionId, expectedRevision: 0, name: 'Dummy images', adapterType: 'openai-image-v1', baseUrl: 'https://images.example/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1 };
  const command = { schemaVersion: 1, libraryId: owned.libraryId, connectionEpoch: 'fixture-client', commandId: 'create-draft', kind: 'provider.saveConnection', payload: input };
  expect((await original.commands.execute(command)).ok).toBe(true);
  const oldVault = await CredentialVault.open(join(root, 'old-vault'), unavailable, original.modelConfig.credentialStatuses().map(status => status.ref));
  const old = await oldVault.put('dummy-old-library-key', owned, 'session'); if (!old.ok) throw new Error('old key');
  expect(original.modelConfig.updateCredentialStatus({ ref: old.value, state: 'session' }).ok).toBe(true);
  expect((await original.commands.execute({ ...command, commandId: 'bind-original', payload: { ...input, expectedRevision: 1, credentialRef: old.value } })).ok).toBe(true);
  // A later reference can survive only in the library, after a vault replacement/backup restore.
  const retained = { ...old.value, id: 'retained-version-seven', version: 7 };
  expect(original.modelConfig.updateCredentialStatus({ ref: retained, state: 'unavailable' }).ok).toBe(true);
  await original.close(); oldVault.close();
  const reopened = await openEngine();
  const trusted = reopened.modelConfig.credentialStatuses().map(status => status.ref);
  const fresh = await CredentialVault.open(join(root, 'fresh-vault'), unavailable, [...trusted, { ...retained, libraryId: 'foreign-library', version: 100 }]);
  for (const ref of trusted) expect(reopened.modelConfig.updateCredentialStatus({ ref, state: 'unavailable' }).ok).toBe(true);
  const replacement = await fresh.put('dummy-new-library-key', owned, 'session'); if (!replacement.ok) throw new Error('replacement key');
  expect(replacement.value.version).toBe(8);
  expect(reopened.modelConfig.updateCredentialStatus({ ref: replacement.value, state: 'session' })).toEqual({ ok: true, value: undefined });
  expect(reopened.modelConfig.listConnections()).toMatchObject({ connections: [{ revision: 1, credentialRef: null }, { revision: 2, credentialRef: old.value }], credentialStatuses: [{ ref: old.value, state: 'unavailable' }, { ref: retained, state: 'unavailable' }, { ref: replacement.value, state: 'session' }] });
  fresh.close();
  // A stale metadata floor must also never reuse a newer locally retained envelope version.
  const local = await CredentialVault.open(join(root, 'fresh-vault'), unavailable, trusted);
  const next = await local.put('dummy-newer-library-key', owned, 'session');
  expect(next).toMatchObject({ ok: true, value: { version: 9 } });
});
