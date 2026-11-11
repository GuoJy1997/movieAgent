import { afterEach, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, stat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap.ts';
import { fileModelDefaults } from '../../packages/domain/src/model-config.ts';
import type { AdapterType, ParameterValue } from '../../packages/contracts/src/models.ts';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { resolve } from 'node:path';
import { CredentialVault } from '../../apps/desktop/src/main/credential-vault.ts';
import { createAudioGenerationCapability } from '../../apps/desktop/src/main/provider-capability.ts';
import type { ProviderContext } from '../../packages/providers/src/image-provider.ts';
export function audioValue(result: any): any {
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(result).toMatchObject({ ok: true });
  return result.value?.result ?? result.value;
}
export const audioExecute = (e: EngineHandle, kind: string, payload: unknown, commandId = crypto.randomUUID()) => e.commands.execute({ schemaVersion: 1, libraryId: e.identity.libraryId, connectionEpoch: 'fixture', commandId, kind, payload });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
export async function audioFixture(adapter: AdapterType = 'openai-speech-v1', options: { native?: boolean; parameters?: Record<string, ParameterValue>; onPhase?: (phase: string) => void; providerContext?: Partial<ProviderContext> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'p4-audio-'));
  const requests: { url: string; body: Buffer; headers: any }[] = [];
  let response: Buffer = Buffer.from('RIFF0000WAVEfmt '), status = 200, cut = false;
  let gate: Promise<void> | undefined;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      requests.push({ url: req.url!, body: Buffer.concat(chunks), headers: req.headers });
      if (gate) await gate;
      if (cut) req.socket.destroy(); else { res.statusCode = status; res.end(response); }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture address');
  const vault = await CredentialVault.open(join(root, 'vault'), { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, []);
  let engine: EngineHandle, libraryId = '';
  const runtime = options.native ? audioValue(await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64'))) : undefined;
  async function open() {
    engine = audioValue(await startEngine({ root, runtime, assets: { onPhase: options.onPhase, inspectAudio: async () => ({ ok: true, value: { mime: 'audio/wav', width: 0, height: 0 } }) }, providerContext: { evidence: 'fixture', ...options.providerContext, requestAudio: (input, dispatch, bytes) => createAudioGenerationCapability(libraryId, vault)(input, dispatch, bytes) } }));
    libraryId = engine.identity.libraryId;
    if (libraryId && engine.modelConfig.listConnections().connections.some(connection => connection.id === 'audio')) audioValue(engine.modelConfig.updateCredentialStatus(audioValue(await vault.status(credential))));
    return engine;
  }
  await open();
  cleanups.push(async () => { await engine.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const projectId = audioValue(await audioExecute(engine!, 'project.create', { name: 'Audio fixture' })).id;
  const credential = audioValue(await vault.put('fixture-audio-key', { libraryId, connectionId: 'audio' }, 'session'));
  const connectionInput = { id: 'audio', expectedRevision: 0, name: 'Audio', adapterType: adapter, baseUrl: `http://127.0.0.1:${address.port}/v1`, credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: { hostname: '127.0.0.1', port: address.port, purpose: 'model-api' } }, timeoutMs: 1000, concurrency: 1 };
  audioValue(await audioExecute(engine!, 'provider.saveConnection', connectionInput));
  audioValue(engine!.modelConfig.updateCredentialStatus(audioValue(await vault.status(credential))));
  const connectionRef = audioValue(await audioExecute(engine!, 'provider.saveConnection', { ...connectionInput, expectedRevision: 1, credentialRef: credential }));
  const modelRef = audioValue(await audioExecute(engine!, 'model.saveDefinition', { id: 'audio', expectedRevision: 0, name: 'Audio', modelId: 'manual-audio', connectionRef, ...fileModelDefaults(adapter, options.parameters ?? {}) }));
  const profileRef = audioValue(await audioExecute(engine!, 'profile.save', { id: 'audio', expectedRevision: 0, name: 'Audio', modelRef, parameters: {} }));
  const approval = { currency: 'CNY', allowanceMicros: 1000000, budgetLimitMicros: 100000000, acknowledgeUnknown: true };
  async function batch(texts = ['hello']) {
    const lines = [];
    for (const [index, text] of texts.entries()) {
      audioValue(await audioExecute(engine!, 'audio.saveVoiceLine', { projectId, id: 'line' + index, expectedRevision: 0, text }));
      lines.push({ lineId: 'line' + index, revision: 1, profileRef });
    }
    return audioValue(await audioExecute(engine!, 'audio.prepareSpeech', { projectId, lines, executionOwner: 'human', runId: 'run' }));
  }
  async function importAudio(bytes: Buffer, name = 'source.wav') {
    const path = join(root, name); await writeFile(path, bytes);
    const info = await stat(path), grantId = crypto.randomUUID();
    audioValue(engine.assets.registerGrant({ grantId, importId: crypto.randomUUID(), libraryId, expiresAt: Date.now() + 60000, files: [{ path, realPath: await realpath(path), allowedRoot: root, name, size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino }] }));
    return audioValue(await audioExecute(engine, 'asset.importGrantedFiles', { grantId })).versions[0];
  }
  const holdResponse = () => { let release!: () => void; gate = new Promise<void>(resolve => { release = resolve; }); return () => { gate = undefined; release(); }; };
  return { root, vault, engine: engine!, runtime, connectionRef, importAudio, open, projectId, profileRef, requests, batch, approval, holdResponse, response: (value: unknown, code = 200) => { response = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)); status = code; }, cut: () => { cut = true; } };
}
export function fixtureWav(seconds = 1): Buffer {
  const samples = Math.round(seconds * 48000), bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}
