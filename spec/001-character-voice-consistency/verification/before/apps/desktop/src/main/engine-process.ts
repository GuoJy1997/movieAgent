import { startEngine, type EngineHandle } from '../../../../packages/engine/src/bootstrap.ts';
import { fail, isRecord, ok } from '../../../../packages/contracts/src/result.ts';
import { randomUUID } from 'node:crypto';
import type { ProviderContext } from '../../../../packages/providers/src/image-provider.ts';
import type { PreparedGeneration } from '../../../../packages/contracts/src/generation.ts';
import type { ImageDispatchIdentity } from '../../../../packages/providers/src/image-provider.ts';
import { MAX_RESPONSE_BYTES, MAX_TEXT_RESPONSE_BYTES, MAX_AUDIO_RESPONSE_BYTES, type HttpResponse } from '../../../../packages/providers/src/http-transport.ts';
import { isMediaRuntime, isMediaRangeRequest } from '../../../../packages/contracts/src/desktop.ts';
import { isDerivedMediaRef } from '../../../../packages/contracts/src/render.ts';
import { isMediaReference } from '../../../../packages/contracts/src/assets.ts';
import { isExportTimelineInput, isExportOutcome, isCancelTimelineExport } from '../../../../packages/contracts/src/timeline-export.ts';
import { dialogueProcessContext, type DialogueProviderDetail } from './dialogue-provider-routing.ts';

const port = process.parentPort;
if (!port) throw new Error('The engine must be launched as an Electron utility process.');
let engine: EngineHandle | undefined;
let launchId: string | undefined;
let initializing = false;
let providerStarted = false;
const imagePending = new Map<string, (value: unknown) => void>();
function providerRequest(type: 'provider.image' | 'provider.text' | 'provider.audio' | 'provider.image.edit' | 'provider.video' | 'provider.video.query' | 'provider.lipsync' | 'provider.lipsync.query', prepared: PreparedGeneration, detail: DialogueProviderDetail | { dispatch: ImageDispatchIdentity; audioBytes?: Uint8Array }) { return new Promise<HttpResponse>((resolve, reject) => {
  if (!providerStarted || !engine) { reject(Error('PROVIDER_NOT_READY')); return; }
  const requestId = randomUUID();
  const timer = setTimeout(() => { imagePending.delete(requestId); reject(Error('PROVIDER_TIMEOUT')); }, prepared.config.connection.timeoutMs + 5000);
  imagePending.set(requestId, value => {
    clearTimeout(timer); imagePending.delete(requestId);
    if (isRecord(value) && value.ok === true && isRecord(value.value) && Number.isInteger(value.value.status) && value.value.bytes instanceof Uint8Array && value.value.bytes.byteLength <= (type === 'provider.audio' ? MAX_AUDIO_RESPONSE_BYTES : type === 'provider.image' || type === 'provider.image.edit' ? MAX_RESPONSE_BYTES : type === 'provider.text' ? MAX_TEXT_RESPONSE_BYTES : 1024 * 1024)) resolve(value.value as unknown as HttpResponse);
    else reject(Error('PROVIDER_TRANSPORT_FAILED'));
  });
  port!.postMessage({ type, launchId, instanceId: engine.identity.instanceId, requestId, prepared, ...detail });
}); }
const providerContext: ProviderContext = { ...dialogueProcessContext(providerRequest), evidence: 'real', requestAudio: (prepared, dispatch, audioBytes) => providerRequest('provider.audio', prepared, { dispatch, audioBytes }), requestImage: (prepared, dispatch) => providerRequest('provider.image', prepared, { dispatch }), requestText: (prepared, dispatch) => providerRequest('provider.text', prepared, { dispatch }), requestImageEdit: (prepared, dispatch, referenceBytes) => providerRequest('provider.image.edit', prepared, { dispatch, referenceBytes }), queryVideo: (prepared, providerTaskId) => providerRequest('provider.video.query', prepared, { providerTaskId }) };
port.on('message', async (event) => {
  const data: unknown = event.data;
  if (!isRecord(data) || typeof data.launchId !== 'string') return;
  if (data.type === 'initialize' && !initializing && !engine && typeof data.root === 'string') {
    initializing = true;
    launchId = data.launchId;
    if (data.runtime !== undefined && !isMediaRuntime(data.runtime)) { port.postMessage({ type: 'ready', launchId, result: fail('MEDIA_RUNTIME_UNAVAILABLE', '固定媒体运行时注入无效。') }); return; }
    const started = await startEngine({ root: data.root, identityGuardRoot: typeof data.identityGuardRoot === 'string' ? data.identityGuardRoot : undefined, runtime: data.runtime, providerContext: { ...providerContext, evidence: data.providerEvidence === 'fixture' ? 'fixture' : 'real' } });
    if (started.ok) engine = started.value;
    port.postMessage({ type: 'ready', launchId, result: started.ok ? ok(started.value.identity) : started });
    if (!started.ok) process.exitCode = 1;
    return;
  }
  if (['provider.lipsync.response','provider.lipsync.query.response','provider.audio.response','provider.image.response','provider.text.response','provider.image.edit.response','provider.video.response','provider.video.query.response'].includes(data.type as string) && data.launchId === launchId && typeof data.requestId === 'string') { imagePending.get(data.requestId)?.(data.result); return; }
  if (data.type !== 'request' || data.launchId !== launchId || typeof data.requestId !== 'string' || typeof data.instanceId !== 'string') return;
  const result = !engine || data.instanceId !== engine.identity.instanceId
    ? fail('ENGINE_NOT_READY', '引擎尚未连接。')
    : data.kind === 'provider.start' && data.payload === undefined ? await (async () => {
      if (!providerStarted) { providerStarted = true; void engine!.scheduler.start(); }
      return ok(undefined);
    })()
    : data.kind === 'provider.recover' && data.payload === undefined && providerStarted ? await engine.scheduler.recover().then(result => result.ok ? engine!.scheduler.wake() : result)
    : data.kind === 'quiesce' && isRecord(data.payload) && typeof data.payload.reason === 'string' && typeof data.payload.deadline === 'number' && Number.isFinite(data.payload.deadline) ? ok(await engine.quiesceEngine(data.payload.reason, data.payload.deadline - 1500))
    : data.kind === 'execute' ? await engine.commands.execute(data.payload)
      : data.kind === 'query' ? engine.commands.query(data.payload)
        : data.kind === 'events' ? engine.events.read(data.payload)
        : data.kind === 'credential.status' ? engine.modelConfig.updateCredentialStatus(data.payload)
        : data.kind === 'credential.references' && data.payload === undefined ? ok(engine.modelConfig.credentialStatuses())
        : data.kind === 'file.grant' ? engine.assets.registerGrant(data.payload)
        : data.kind === 'media.read' ? await engine.assets.read(data.payload)
        : data.kind === 'timeline.prepareExportInternal' && isExportTimelineInput(data.payload) ? await engine.exports.prepareExport(data.payload)
        : data.kind === 'timeline.recordExportOutcomeInternal' && isExportOutcome(data.payload) ? await engine.exports.recordExportOutcome(data.payload)
        : data.kind === 'timeline.cancelExportInternal' && isCancelTimelineExport(data.payload) ? await engine.exports.cancelExport(data.payload)
        : data.kind === 'media.derivedOpenInternal' && isRecord(data.payload) && Object.keys(data.payload).every(key=>['ref','expectedHash'].includes(key)) && isDerivedMediaRef(data.payload.ref) && data.payload.ref.libraryId === engine.identity.libraryId && (data.payload.expectedHash === undefined || typeof data.payload.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(data.payload.expectedHash)) ? await engine.renders.openDerivedMediaRead(data.payload.ref,data.payload.expectedHash as string | undefined)
        : data.kind === 'media.derivedRangeInternal' && isMediaRangeRequest(data.payload) ? await engine.renders.readDerivedMediaRange(data.payload)
        : data.kind === 'media.derivedCloseInternal' && isRecord(data.payload) && Object.keys(data.payload).length === 1 && typeof data.payload.leaseId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(data.payload.leaseId) ? await engine.renders.closeDerivedMediaRead(data.payload.leaseId).then(()=>ok(undefined))
        : data.kind === 'media.openInternal' && isRecord(data.payload) && Object.keys(data.payload).every(k => ['ref','expectedHash'].includes(k)) && isMediaReference(data.payload.ref) && data.payload.ref.libraryId === engine.identity.libraryId && (data.payload.expectedHash === undefined || typeof data.payload.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(data.payload.expectedHash)) ? await engine.assets.openMediaRead(data.payload.ref, data.payload.expectedHash as string | undefined)
        : data.kind === 'media.rangeInternal' && isMediaRangeRequest(data.payload) ? await engine.assets.readMediaRange(data.payload)
        : data.kind === 'media.closeInternal' && isRecord(data.payload) && Object.keys(data.payload).length === 1 && typeof data.payload.leaseId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(data.payload.leaseId) ? await engine.assets.closeMediaRead(data.payload.leaseId).then(() => ok(undefined))
        : data.kind === 'close' ? await engine.close()
          : fail('UNKNOWN_COMMAND', '未知的引擎命令。');
  port.postMessage({ type: 'response', launchId, requestId: data.requestId, result });
  if (data.kind === 'close' || data.kind === 'quiesce' && result.ok && isRecord(result.value) && 'resourcesExited' in result.value && result.value.resourcesExited === true) process.exit(0);
});
