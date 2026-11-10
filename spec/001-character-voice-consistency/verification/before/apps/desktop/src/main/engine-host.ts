import { isDerivedMediaRef, type DerivedMediaRef } from '../../../../packages/contracts/src/render.ts';
import { isExportTimelineInput, isPreparedExport, isExportOutcome, isExportReceipt, isCancelTimelineExport, type ExportTimelineInput, type PreparedExport, type ExportOutcome, type ExportReceipt } from '../../../../packages/contracts/src/timeline-export.ts';
import { utilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fail, isRecord, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { isIdentity, isResult, isVoid, type EngineIdentity } from '../../../../packages/contracts/src/desktop.ts';
import { isReceipt } from '../../../../packages/contracts/src/commands.ts';
import { isEventBatch } from '../../../../packages/contracts/src/events.ts';
import { parseQuery, queryOutputValidators } from '../../../../packages/contracts/src/queries.ts';
import { isCredentialStatus, type CredentialStatus } from '../../../../packages/contracts/src/models.ts';
import type { EngineTransport } from './local-connection.ts';
import { isMediaRangeRequest, isMediaChunk, isReadLease } from '../../../../packages/contracts/src/desktop.ts';
import { isMediaReference, type MediaReference } from '../../../../packages/contracts/src/assets.ts';
import type { ReadLease, MediaChunk, MediaRangeRequest } from '../../../../packages/contracts/src/media-info.ts';
import { resolveMediaRuntime } from './media-runtime.ts';
import { type MediaRead, type MediaReadInput } from '../../../../packages/contracts/src/assets.ts';
import type { FileGrant } from './file-grants.ts';
import type { CredentialVault } from './credential-vault.ts';
import { createAudioGenerationCapability, createTextGenerationCapability, createImageEditCapability, createImageGenerationCapability, createVideoGenerationCapability, createVideoQueryCapability, isImageDispatchIdentity } from './provider-capability.ts';
import { isVideoTaskId } from '../../../../packages/providers/src/minimax-video.ts';
import { isPreparedGeneration } from '../../../../packages/contracts/src/generation.ts';
import { createDialogueProviderRoute } from './dialogue-provider-routing.ts';
import { GRACEFUL_SHUTDOWN_MS, type ShutdownReport } from '../../../../packages/engine/src/shutdown.ts';
const isShutdownReport = (value: unknown): value is ShutdownReport => isRecord(value) && typeof value.reason === 'string' && (value.errorCode === undefined || typeof value.errorCode === 'string' && value.errorCode.length <= 128) && ['stoppedClaiming','persisted','resourcesExited','cleanupPending','interrupted'].every(key => typeof value[key] === 'boolean');

export interface EngineHost extends EngineTransport {
  prepareExport(input: ExportTimelineInput): Promise<Result<PreparedExport>>;
  recordExportOutcome(input: ExportOutcome): Promise<Result<ExportReceipt>>;
  cancelExport(input: {requestId:string}): Promise<Result<void>>;
  readonly identity: EngineIdentity;
  close(): Promise<Result<void>>;
  quiesceEngine(reason: string, deadline: number): Promise<ShutdownReport>;
  reconcile(): Promise<Result<void>>;
  updateCredentialStatus(status: CredentialStatus): Promise<Result<void>>;
  credentialStatuses(): Promise<Result<CredentialStatus[]>>;
  registerFileGrant(grant: FileGrant): Promise<Result<void>>;
  readMedia(input: MediaReadInput): Promise<Result<MediaRead>>;
  openDerivedMediaRead(ref: DerivedMediaRef, expectedHash?: string): Promise<Result<ReadLease>>;
  readDerivedMediaRange(input: MediaRangeRequest): Promise<Result<MediaChunk>>;
  closeDerivedMediaRead(leaseId: string): Promise<void>;
  openMediaRead(ref: MediaReference, expectedHash?: string): Promise<Result<ReadLease>>;
  readMediaRange(input: MediaRangeRequest): Promise<Result<MediaChunk>>;
  closeMediaRead(leaseId: string): Promise<void>;
  startProvider(vault: CredentialVault): Promise<Result<void>>;
}

export async function startEngineHost(root: string, options: { identityGuardRoot?: string; evidence?: 'fixture'; onExit?: () => void } = {}): Promise<Result<EngineHost>> {
  const mediaRuntime = await resolveMediaRuntime();
  const launchId = randomUUID();
  const child = utilityProcess.fork(join(__dirname, 'engine-process.js'), [], { serviceName: 'MovieAgent Library Engine', stdio: 'pipe' });
  // Only this locally held process object may be killed. No PID lookup or kill is used.
  let exited = false;
  let available = true;
  let closing: Promise<Result<void>> | undefined;
  let shutdown: Promise<ShutdownReport> | undefined;
  let readyIdentity: EngineIdentity | undefined;
  let imageCapability: ReturnType<typeof createImageGenerationCapability> | undefined;
  let textCapability: ReturnType<typeof createTextGenerationCapability> | undefined;
  let audioCapability: ReturnType<typeof createAudioGenerationCapability> | undefined;
  let editCapability: ReturnType<typeof createImageEditCapability> | undefined;
  let videoCapability: ReturnType<typeof createVideoGenerationCapability> | undefined;
  let videoQueryCapability: ReturnType<typeof createVideoQueryCapability> | undefined;
  let dialogueCapability: ReturnType<typeof createDialogueProviderRoute> | undefined;
  const activeImages = new Set<string>();
  const dispatchedImages = new Set<string>();
  const pending = new Map<string, { receive(value: unknown): void; timeout: ReturnType<typeof setTimeout> }>();
  let resolveExit!: () => void;
  const exit = new Promise<void>(resolve => { resolveExit = resolve; });
  let resolveReady!: (value: Result<EngineIdentity>) => void;
  const ready = new Promise<Result<EngineIdentity>>(resolve => { resolveReady = resolve; });
  const readyTimeout = setTimeout(() => resolveReady(fail('ENGINE_START_TIMEOUT', '本地引擎启动超时。请重新打开资料库。')), 10_000);
  child.stdout?.on('data', () => { /* Drain output; business logs must use the bounded logger introduced later. */ });
  child.stderr?.on('data', () => { /* Do not forward process internals to the renderer. */ });
  child.on('spawn', () => child.postMessage({ type: 'initialize', launchId, root, identityGuardRoot: options.identityGuardRoot, runtime: mediaRuntime.ok ? mediaRuntime.value : undefined, providerEvidence: options.evidence === 'fixture' ? 'fixture' : 'real' }));
  child.on('message', (data: unknown) => {
    if (!isRecord(data) || data.launchId !== launchId) return;
    if (data.type === 'ready' && isResult(data.result, isIdentity)) resolveReady(data.result);
    if (data.type === 'response' && typeof data.requestId === 'string') pending.get(data.requestId)?.receive(data.result);
    if (['provider.lipsync','provider.lipsync.query','provider.audio','provider.image','provider.text','provider.image.edit','provider.video','provider.video.query'].includes(data.type as string) && typeof data.requestId === 'string' && data.requestId.length <= 128) {
      const respond = (result: unknown) => { if (!exited) child.postMessage({ type: data.type + '.response', launchId, requestId: data.requestId, result }); };
      if (!available || closing || shutdown || !isPreparedGeneration(data.prepared) || data.prepared.libraryId !== readyIdentity?.libraryId || data.instanceId !== readyIdentity?.instanceId || activeImages.size >= 4) { respond(fail('PROVIDER_CAPABILITY_DENIED', '模型调用能力不可用。')); return; }
      if(data.type==='provider.lipsync'||data.type==='provider.lipsync.query'||data.type==='provider.video'&&data.prepared.adapterId==='minimax-h3-v2') {
        const query=data.type==='provider.lipsync.query';
        if(!dialogueCapability||!query&&(!isImageDispatchIdentity(data.dispatch)||dispatchedImages.has(data.dispatch.attemptId)&&!(data.type==='provider.lipsync'&&data.reconcile===true))){respond(fail('PROVIDER_CAPABILITY_DENIED','对白能力不可用。'));return;}
        const attemptId=query?'query-'+data.requestId:(data.dispatch as {attemptId:string}).attemptId;
        if(activeImages.has(attemptId))return;
        activeImages.add(attemptId);if(!query)dispatchedImages.add(attemptId);
        void dialogueCapability(data.type as 'provider.video'|'provider.lipsync'|'provider.lipsync.query',data.prepared,data).then(value=>respond(ok(value)),()=>respond(fail('PROVIDER_TRANSPORT_FAILED','对白请求结果待核对。'))).finally(()=>activeImages.delete(attemptId));return;
      }
      if (data.type === 'provider.video.query') {
        if (!videoQueryCapability || !isVideoTaskId(data.providerTaskId)) { respond(fail('PROVIDER_CAPABILITY_DENIED', '视频查询能力不可用。')); return; }
        const queryId = 'query-' + data.requestId;
        if (activeImages.has(queryId)) return;
        activeImages.add(queryId);
        void videoQueryCapability(data.prepared, data.providerTaskId).then(value => respond(ok(value)), () => respond(fail('PROVIDER_TRANSPORT_FAILED', '查询暂不可用，已知任务将继续对账。'))).finally(() => activeImages.delete(queryId));
        return;
      }
      if (data.type === 'provider.audio') {
        if (!audioCapability || !isImageDispatchIdentity(data.dispatch) || dispatchedImages.has(data.dispatch.attemptId) || data.audioBytes !== undefined && (!(data.audioBytes instanceof Uint8Array) || data.audioBytes.byteLength > 24000000)) { respond(fail('PROVIDER_CAPABILITY_DENIED', '音频提交能力不可用。')); return; }
        const attemptId = data.dispatch.attemptId;
        activeImages.add(attemptId); dispatchedImages.add(attemptId);
        void audioCapability(data.prepared, data.dispatch, data.audioBytes as Uint8Array | undefined).then(value => respond(ok(value)), () => respond(fail('PROVIDER_TRANSPORT_FAILED', '音频提交结果未知。'))).finally(() => activeImages.delete(attemptId));
        return;
      }
      const capability = data.type === 'provider.video' ? videoCapability : data.type === 'provider.text' ? textCapability : data.type === 'provider.image.edit' ? editCapability : imageCapability;
      if (data.referenceBytes !== undefined && (!Array.isArray(data.referenceBytes) || data.referenceBytes.length > 4 || data.referenceBytes.some(b => !(b instanceof Uint8Array) || b.byteLength > 10 * 1024 * 1024) || data.referenceBytes.reduce((sum, b) => sum + b.byteLength, 0) > 32 * 1024 * 1024)) { respond(fail('PROVIDER_CAPABILITY_DENIED', '参考图字节无效。')); return; }
      if (!capability || !isImageDispatchIdentity(data.dispatch) || dispatchedImages.has(data.dispatch.attemptId)) { respond(fail('PROVIDER_CAPABILITY_DENIED', '模型提交能力不可用。')); return; }
      const attemptId = data.dispatch.attemptId;
      activeImages.add(attemptId); dispatchedImages.add(attemptId);
      void capability(data.prepared, data.dispatch, data.referenceBytes as Uint8Array[] | undefined).then(value => respond(ok(value)), () => respond(fail('PROVIDER_TRANSPORT_FAILED', '供应商请求结果未知，请检查任务状态。'))).finally(() => activeImages.delete(attemptId));
    }
  });
  child.on('exit', () => {
    exited = true;
    available = false;
    clearTimeout(readyTimeout);
    resolveReady(fail('ENGINE_EXITED', '本地引擎已退出。请重新打开资料库。'));
    for (const request of [...pending.values()]) request.receive(fail('ENGINE_EXITED', '本地引擎已退出。'));
    resolveExit();
    if (!shutdown && readyIdentity) options.onExit?.();
  });
  const started = await ready;
  clearTimeout(readyTimeout);
  async function stopOwnedProcess(deadline = Date.now() + 1500) {
    if (exited) return true;
    child.kill();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = await Promise.race([exit.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, Math.min(1500, deadline - Date.now()))); })]);
    clearTimeout(timer);
    return stopped;
  }
  if (!started.ok) {
    await stopOwnedProcess();
    return started;
  }
  const identity = started.value; readyIdentity = identity;
  function request<T>(kind: string, payload: unknown, validate: (value: unknown) => value is T, deadline?: number): Promise<Result<T>> {
    if (!available || exited) return Promise.resolve(fail('ENGINE_CLOSED', '引擎已关闭，请重新连接。'));
    return new Promise(resolve => {
      const requestId = randomUUID();
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        resolve(fail('ENGINE_REQUEST_TIMEOUT', '引擎响应超时。写入结果尚未确认，请重新打开资料库检查。'));
      }, deadline !== undefined ? Math.max(1, deadline - Date.now()) : kind === 'execute' ? 120000 : kind === 'media.read' ? 30000 : 5000);
      pending.set(requestId, {
        timeout,
        receive(value) {
          clearTimeout(timeout);
          pending.delete(requestId);
          resolve(isResult(value, validate) ? value : fail('INVALID_ENGINE_RESPONSE', '收到无效的引擎响应。'));
        },
      });
      try { child.postMessage({ type: 'request', launchId, instanceId: identity.instanceId, requestId, kind, payload }); }
      catch { pending.get(requestId)?.receive(fail('ENGINE_DISCONNECTED', '引擎连接已中断。')); }
    });
  }
  function quiesceEngine(reason: string, deadline: number): Promise<ShutdownReport> {
    if (shutdown) return shutdown.then(report => ({ ...report, stoppedClaiming: report.stoppedClaiming || exited, resourcesExited: report.resourcesExited || exited }));
    shutdown = (async () => {
      const result = await request('quiesce', { reason, deadline }, isShutdownReport, deadline - 1500);
      available = false;
      // Reserve the final 1.5s of the same absolute budget for owned-process exit.
      if (result.ok && result.value.resourcesExited && !exited) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([exit, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, Math.min(1500, deadline - Date.now()))); })]); clearTimeout(timer);
      }
      const forced = !exited;
      const stopped = exited || await stopOwnedProcess(deadline);
      const report = result.ok ? result.value : { reason, stoppedClaiming: stopped, persisted: false, resourcesExited: false, cleanupPending: true, interrupted: true };
      return { ...report, resourcesExited: stopped, cleanupPending: report.cleanupPending || forced || !stopped, interrupted: report.interrupted || forced || !stopped };
    })();
    return shutdown;
  }
  return ok({
    identity,
    execute: input => request('execute', input, isReceipt),
    query: input => { const parsed=parseQuery(input); return parsed.ok ? request('query', parsed.value, (value): value is unknown => queryOutputValidators[parsed.value.kind](value)) : Promise.resolve(parsed); },
    readEvents: input => request('events', input, isEventBatch),
    updateCredentialStatus: status => request('credential.status', status, isVoid),
    credentialStatuses: () => request('credential.references', undefined, (value): value is CredentialStatus[] => Array.isArray(value) && value.every(isCredentialStatus)),
    registerFileGrant: grant => request('file.grant', grant, isVoid),
    prepareExport: input => isExportTimelineInput(input) ? request('timeline.prepareExportInternal', input, isPreparedExport) : Promise.resolve(fail('INVALID_INPUT','导出参数无效。')),
    recordExportOutcome: input => isExportOutcome(input) ? request('timeline.recordExportOutcomeInternal', input, isExportReceipt) : Promise.resolve(fail('INVALID_INPUT','发布回执无效。')),
    cancelExport: input => isCancelTimelineExport(input) ? request('timeline.cancelExportInternal', input, isVoid) : Promise.resolve(fail('INVALID_INPUT','取消参数无效。')),
    readMedia: input => request('media.read', input, (value): value is MediaRead => isRecord(value) && value.bytes instanceof Uint8Array && typeof value.mime === 'string' && typeof value.hash === 'string'),
    openDerivedMediaRead: (ref, expectedHash) => !isDerivedMediaRef(ref) || ref.libraryId !== identity.libraryId || expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedHash) ? Promise.resolve(fail('INVALID_INPUT','派生媒体引用无效。')) : request('media.derivedOpenInternal',{ref,...(expectedHash === undefined ? {} : {expectedHash})},isReadLease),
    readDerivedMediaRange: input => !isMediaRangeRequest(input) ? Promise.resolve(fail('INVALID_MEDIA_RANGE','缓存范围无效。')) : request('media.derivedRangeInternal',input,isMediaChunk),
    closeDerivedMediaRead: async leaseId => { await request('media.derivedCloseInternal',{leaseId},isVoid); },
    openMediaRead: (ref, expectedHash) => !isMediaReference(ref) || ref.libraryId !== identity.libraryId || expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedHash) ? Promise.resolve(fail('INVALID_INPUT', '固定媒体读取引用无效。')) : request('media.openInternal', { ref, ...(expectedHash === undefined ? {} : { expectedHash }) }, isReadLease),
    readMediaRange: input => isMediaRangeRequest(input) ? request('media.rangeInternal', input, isMediaChunk) : Promise.resolve(fail('INVALID_INPUT', '媒体数据块参数无效。')),
    closeMediaRead: leaseId => typeof leaseId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(leaseId) ? request('media.closeInternal', { leaseId }, isVoid).then(() => undefined) : Promise.resolve(),
    startProvider(vault) { dialogueCapability ??= createDialogueProviderRoute(identity.libraryId,vault,{openMediaRead:(ref,expectedHash)=>request('media.openInternal',{ref,expectedHash},isReadLease),readMediaRange:input=>request('media.rangeInternal',input,isMediaChunk),closeMediaRead:async leaseId=>{await request('media.closeInternal',{leaseId},isVoid);}}); audioCapability ??= createAudioGenerationCapability(identity.libraryId, vault); textCapability ??= createTextGenerationCapability(identity.libraryId, vault); editCapability ??= createImageEditCapability(identity.libraryId, vault); imageCapability ??= createImageGenerationCapability(identity.libraryId, vault); videoCapability ??= createVideoGenerationCapability(identity.libraryId, vault); videoQueryCapability ??= createVideoQueryCapability(identity.libraryId, vault); return request('provider.start', undefined, isVoid); },
    reconcile: () => request('provider.recover', undefined, isVoid, Date.now() + GRACEFUL_SHUTDOWN_MS),
    quiesceEngine,
    close() {
      if (closing) return closing;
      closing = (async () => {
        const report = await quiesceEngine('quit', Date.now() + GRACEFUL_SHUTDOWN_MS);
        return report.resourcesExited && !report.cleanupPending ? ok(undefined) : fail('ENGINE_CLEANUP_PENDING', '本机编排已停止；中断的清理将在下次启动恢复。云端任务可能继续。');
      })();
      return closing;
    },
  });
}
