import { app, BrowserWindow, safeStorage } from 'electron';
import { join } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { CredentialVault } from '../../../apps/desktop/src/main/credential-vault.ts';
import { loadModelConfig } from '../../../apps/desktop/src/main/model-config-file.ts';
import { importModelConfig } from '../../../apps/desktop/src/main/model-config-import.ts';
import { startEngineHost, type EngineHost } from '../../../apps/desktop/src/main/engine-host.ts';
import { isModelSnapshot, isProfileSnapshot, isProviderSnapshot } from '../../../packages/contracts/src/models.ts';
import { isResult } from '../../../packages/contracts/src/desktop.ts';
import { isTaskSnapshot } from '../../../packages/contracts/src/generation.ts';
const root = process.argv.find(v => v.startsWith('--fixture-root='))!.slice('--fixture-root='.length);
app.setPath('userData', join(root, 'profile'));
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await window.loadURL('about:blank');
  (globalThis as any).modelConfigFixture = { async run(port: number) {
    const configPath = join(root, 'models.json');
    const firstSecret = 'dummy-electron-import-original', secondSecret = 'dummy-electron-import-changed';
    const wire: unknown[] = [];
    async function connect() {
      const started = await startEngineHost(join(root, 'library'), { evidence: 'fixture' }); if (!started.ok) throw Error('fixture host start');
      const raw = started.value;
      const host: EngineHost = { ...raw, execute: async value => { wire.push(value); return raw.execute(value); }, query: async value => { wire.push(value); return raw.query(value); }, updateCredentialStatus: async value => { wire.push(value); return raw.updateCredentialStatus(value); } };
      const retained = await host.credentialStatuses(); if (!retained.ok) throw Error('fixture retained');
      const vault = await CredentialVault.open(join(root, 'vault'), safeStorage, retained.value.map(v => v.ref));
      for (const previous of retained.value) { const status = await vault.status(previous.ref); if (status.ok) await host.updateCredentialStatus(status.value); }
      return { host, vault };
    }
    async function configuration(secret: string, suffix = 'v1') {
      await writeFile(configPath, JSON.stringify({ schemaVersion: 1, providers: [{ id: 'image-default', name: 'Fixture image', kind: 'image', baseURL: `http://127.0.0.1:${port}/${suffix}`, apiKey: secret, modelId: 'image-1', allowPrivateEndpoint: true }] }));
      const loaded = await loadModelConfig(configPath); if (!loaded.ok) throw Error('fixture config'); return loaded.value;
    }
    let session = await connect();
    const config = await configuration(firstSecret);
    const protection = session.vault.protectionAvailable();
    const first = await importModelConfig({ ...session, config });
    const same = await importModelConfig({ ...session, config });
    const refs = await session.host.credentialStatuses(); if (!refs.ok) throw Error('fixture references');
    const oldRef = refs.value[0]!.ref;
    await session.host.close(); session.vault.close();
    session = await connect();
    const changed = await configuration(secondSecret, 'v2');
    const execute = session.host.execute;
    // Lose the bound-connection response after commit, then close both owners before retry.
    session.host.execute = async input => { const result = await execute(input); if ((input as { kind: string }).kind === 'provider.saveConnection') throw Error('controlled lost response'); return result; };
    const interrupted = await importModelConfig({ ...session, config: changed });
    await session.host.close(); session.vault.close(); session = await connect();
    const recovered = await importModelConfig({ ...session, config: changed });
    async function query(kind: string) { const result = await session.host.query({ schemaVersion: 1, libraryId: session.host.identity.libraryId, connectionEpoch: 'fixture', queryId: 'fixture', kind, payload: {} }); wire.push(result); return result; }
    const connections = await query('provider.list'), models = await query('model.list'), profiles = await query('profile.list'), tasks = await query('task.list');
    if (!isResult(connections, isProviderSnapshot) || !connections.ok || !isResult(models, isModelSnapshot) || !models.ok || !isResult(profiles, isProfileSnapshot) || !profiles.ok || !isResult(tasks, isTaskSnapshot) || !tasks.ok) throw Error('fixture snapshots');
    const old = await session.vault.withSecret(oldRef, async s => s === firstSecret);
    const current = await session.vault.withSecret(connections.value.connections.at(-1)!.credentialRef!, async s => s === secondSecret);
    wire.push(first, same, interrupted, recovered);
    const leaked = (value: string | Buffer) => value.includes(firstSecret) || value.includes(secondSecret);
    const files = await readdir(join(root, 'vault')); let vaultLeak = false;
    for (const file of files) vaultLeak ||= leaked(await readFile(join(root, 'vault', file)));
    await session.host.close(); session.vault.close();
    return { protection, first: first.ok, same: same.ok, interrupted: interrupted.ok, recovered: recovered.ok, credentialCount: files.length, connectionRevisions: connections.value.connections.map(v => v.revision), modelRevisions: models.value.models.map(v => v.revision), profileRevisions: profiles.value.profiles.map(v => v.revision), oldUsable: old.ok && old.value, newUsable: current.ok && current.value, wireLeak: leaked(JSON.stringify(wire)), databaseLeak: leaked(await readFile(join(root, 'library', 'library.sqlite'))), vaultLeak, pendingTasks: tasks.value.tasks.length };
  } };
});
