import { app, BrowserWindow, safeStorage } from 'electron';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { CredentialVault } from '../../../apps/desktop/src/main/credential-vault.ts';
import { openCredentialWindow } from '../../../apps/desktop/src/main/credential-window.ts';
import type { CredentialRef, ProviderConnection } from '../../../packages/contracts/src/models.ts';
import { fail, ok } from '../../../packages/contracts/src/result.ts';
import { startEngine, type EngineHandle } from '../../../packages/engine/src/bootstrap.ts';
import type { CredentialEditorOutcome } from '../../../packages/contracts/src/desktop.ts';
import type { Result } from '../../../packages/contracts/src/result.ts';
const root = process.argv.find(value => value.startsWith('--fixture-root='))!.slice('--fixture-root='.length);
const assets = process.argv.find(value => value.startsWith('--credential-assets='))!.slice('--credential-assets='.length);
app.setPath('userData', join(root, 'profile'));
const owner = { libraryId: 'fixture-library', connectionId: 'fixture-connection' };
const unavailable = { isEncryptionAvailable: () => false, encryptString: (): Buffer => { throw new Error('Unavailable'); }, decryptString: (): string => { throw new Error('Unavailable'); } };
async function contains(directory: string, dummy: string) { for (const name of await readdir(directory)) if ((await readFile(join(directory, name))).includes(Buffer.from(dummy))) return true; return false; }
void app.whenReady().then(async () => {
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await parent.loadURL('about:blank');
  let sessionRef: CredentialRef | undefined;
  let delayedEngine: EngineHandle | undefined;
  let delayedVault: CredentialVault | undefined;
  let delayedRef: CredentialRef | undefined;
  let entered = false;
  let settled = false;
  let lastOutcome: Result<CredentialEditorOutcome> | undefined;
  let release!: () => void;
  let operation: Promise<Result<CredentialEditorOutcome>> | undefined;
  const sessionVault = await CredentialVault.open(join(root, 'session-vault'), unavailable, []);
  (globalThis as any).credentialFixture = {
    async exerciseProtected() {
      const directory = join(root, 'protected-vault');
      const vault = await CredentialVault.open(directory, safeStorage, []);
      const one = await vault.put('dummy-real-dpapi-one', owner); const two = await vault.put('dummy-real-dpapi-two', owner);
      if (!one.ok || !two.ok) throw new Error('System protection is unavailable in this Electron test environment');
      vault.close();
      const reopened = await CredentialVault.open(directory, safeStorage, []);
      const oldUse = await reopened.withSecret(one.value, async secret => secret === 'dummy-real-dpapi-one');
      const newUse = await reopened.withSecret(two.value, async secret => secret === 'dummy-real-dpapi-two');
      const wrong = await reopened.withSecret({ ...one.value, libraryId: 'foreign' }, async () => true);
      await reopened.revoke(one.value);
      const revokedUse = await reopened.withSecret(one.value, async () => true);
      const status = await (await CredentialVault.open(directory, safeStorage, [])).status(one.value);
      return { available: reopened.protectionAvailable(), revisions: [one.value.version, two.value.version], reopenedUse: newUse.ok && newUse.value, oldStillUsable: oldUse.ok && oldUse.value, wrongOwner: wrong.ok, revokedUse, revokedState: status.ok && status.value.state, plaintextOnDisk: await contains(directory, 'dummy-real-dpapi') };
    },
    async openSessionEditor() {
      const connection: ProviderConnection = { ...owner, id: owner.connectionId, revision: 1, name: 'Dummy', adapterType: 'openai-image-v1', baseUrl: 'https://images.example/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1, createdAt: new Date().toISOString() };
      return openCredentialWindow({ parent, connection, vault: sessionVault, synchronize: async status => { sessionRef = status.ref; return ok(undefined); }, documentPath: join(assets, 'renderer/credentials/index.html'), preloadPath: join(assets, 'preload/credentials.js') });
    },
    async sessionEvidence() {
      if (!sessionRef) throw new Error('No session credential');
      const use = await sessionVault.withSecret(sessionRef, async secret => secret === 'dummy-explicit-session-key');
      const status = await (await CredentialVault.open(join(root, 'session-vault'), unavailable, [])).status(sessionRef);
      return { usable: use.ok && use.value, reopenedState: status.ok && status.value.state, plaintextOnDisk: await contains(join(root, 'session-vault'), 'dummy-explicit-session-key') };
    },
    async openDelayedEditor(action: 'save' | 'revoke' | 'cancel', stage: 'vault' | 'registration', rejectRegistration = false) {
      const started = await startEngine({ root: join(root, 'delayed-library') }); if (!started.ok) throw new Error('Delayed fixture library');
      delayedEngine = started.value;
      const libraryId = delayedEngine.identity.libraryId;
      const connection: ProviderConnection = { libraryId, id: 'delayed-connection', revision: 1, name: 'Dummy delayed operation', adapterType: 'openai-image-v1', baseUrl: 'https://images.example/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 60000, concurrency: 1, createdAt: new Date().toISOString() };
      const { libraryId: _l, revision: _r, createdAt: _c, ...draft } = connection;
      const created = (await delayedEngine.commands.execute({ schemaVersion: 1, libraryId, connectionEpoch: 'fixture-client', commandId: 'delayed-create', kind: 'provider.saveConnection', payload: { ...draft, expectedRevision: 0 } }));
      if (!created.ok) throw new Error('Delayed fixture connection');
      delayedVault = await CredentialVault.open(join(root, 'delayed-vault'), safeStorage, delayedEngine.modelConfig.credentialStatuses().map(status => status.ref));
      if (action === 'revoke') {
        const old = await delayedVault.put('dummy-delayed-original', { libraryId, connectionId: connection.id }); if (!old.ok) throw new Error('Delayed fixture credential');
        delayedRef = old.value; connection.credentialRef = old.value;
        const registered = delayedEngine.modelConfig.updateCredentialStatus({ ref: old.value, state: 'protected' }); if (!registered.ok) throw new Error('Delayed fixture registration');
      }
      const gate = new Promise<void>(resolve => { release = resolve; });
      const originalPut = delayedVault.put.bind(delayedVault);
      const originalRevoke = delayedVault.revoke.bind(delayedVault);
      delayedVault.put = async (...args) => { if (stage === 'vault') { entered = true; await gate; } const result = await originalPut(...args); if (result.ok) delayedRef = result.value; return result; };
      delayedVault.revoke = async (...args) => { if (stage === 'vault' && action === 'revoke') { entered = true; await gate; } return originalRevoke(...args); };
      operation = openCredentialWindow({ parent, connection, vault: delayedVault, synchronize: async status => {
        if (stage === 'registration') { entered = true; await gate; }
        return rejectRegistration ? fail('FIXTURE_REGISTRATION_FAILED', 'Controlled registration failure') : delayedEngine!.modelConfig.updateCredentialStatus(status);
      }, documentPath: join(assets, 'renderer/credentials/index.html'), preloadPath: join(assets, 'preload/credentials.js') });
      void operation.then(result => { settled = true; lastOutcome = result; });
      return operation;
    },
    async delayedState() { await new Promise<void>(resolve => setImmediate(resolve)); return { entered, settled, ...(lastOutcome ? { result: lastOutcome } : {}) }; },
    delayedOutcome() { return operation; },
    releaseDelayed() { release(); },
    async delayedEvidence() {
      await operation;
      await delayedEngine!.close(); delayedVault!.close();
      const reopened = await startEngine({ root: join(root, 'delayed-library') }); if (!reopened.ok) throw new Error('Delayed fixture reopen');
      const statuses = reopened.value.modelConfig.credentialStatuses(); await reopened.value.close();
      const vault = await CredentialVault.open(join(root, 'delayed-vault'), safeStorage, statuses.map(status => status.ref));
      const status = delayedRef ? await vault.status(delayedRef) : undefined; vault.close();
      return { statuses, vaultState: status?.ok ? status.value.state : null, files: (await readdir(join(root, 'delayed-vault'))).length, plaintextOnDisk: await contains(join(root, 'delayed-vault'), 'dummy-delayed') };
    },
  };
});
app.on('window-all-closed', () => app.quit());
