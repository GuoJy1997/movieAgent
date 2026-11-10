import type { AssetVersionRef, MediaReference } from './assets.ts';
import { isMediaReference, isAssetVersionRef } from './assets.ts';
import type { MediaProbe } from './media-info.ts';
import type { CreationRef } from './creation.ts';
import { isTimelineRevision, isTimelineSettings, type TimelineRevision, type TimelineSettings } from './timeline.ts';
import { fail, isRecord, ok, type Result } from './result.ts';
export type RenderPurpose = 'preview' | 'mp4' | 'wav';
export interface TimelineRef {
    libraryId: string;
    projectId: string;
    id: string;
    revision: number;
}
export interface ResolvedMedia {
    ref: MediaReference;
    hash: string;
    mime: string;
    byteLength: number;
    width: number;
    height: number;
    probe: MediaProbe | null;
}
export interface InspectMediaInput { projectId:string; reference:MediaReference }
export function parseInspectMedia(x:unknown):Result<InspectMediaInput> {
    return isRecord(x) && exact(x,['projectId','reference']) && id(x.projectId) && fixedReference(x.reference)
        ? ok(structuredClone(x) as unknown as InspectMediaInput) : fail('INVALID_INPUT','请选择固定素材进行本机分析。');
}
export function isResolvedMedia(x:unknown):x is ResolvedMedia {
    if(!isRecord(x)||!fixedReference(x.ref))return false;
    const runtime=isRecord(x.probe)?x.probe.runtimeHash:'0'.repeat(64);
    return typeof runtime==='string' && hash(runtime) && isManifest({entries:[x],runtimeHash:runtime,fontHash:'0'.repeat(64)},x.ref.libraryId);
}
export interface ResolvedMediaManifest {
    entries: ResolvedMedia[];
    runtimeHash: string;
    fontHash: string;
}
export interface RenderOptions {
    purpose: RenderPurpose;
    executionOwner: string;
    runId: string;
    burnSubtitles?: boolean;
}
interface PlanBase {
    libraryId: string;
    projectId: string;
    planId: string;
    planHash: string;
    expiresAt: number;
    executionOwner: string;
    runId: string;
    manifest: ResolvedMediaManifest;
    estimatedBytes: number;
    requiredFreeBytes: number;
}
export interface RenderPlan extends PlanBase {
    kind: 'render';
    compositionHash: string;
    timelineRef: TimelineRef;
    timeline: TimelineRevision;
    purpose: RenderPurpose;
    /** Legacy omission means burn; WAV never carries a picture-only choice. */
    burnSubtitles?: boolean;
    durationTicks: number;
    maxOutputBytes: number;
    notices: string[];
    policy: {
        video: 'libx264';
        audio: 'aac' | 'pcm_s16le';
        sampleRate: 48000;
        threads: 4;
        limiterMilli: 950;
    };
}
export interface DerivedMediaPlan extends PlanBase {
    kind: 'derived';
    fps: TimelineSettings['fps'];
    canvas: TimelineSettings['canvas'];
    recipeHash: string;
    /** Omitted legacy recipes use contain and retain their original recipe hash. */
    videoFit?: 'contain' | 'cover';
    voiceInput?: { voiceRef: CreationRef; sourceInTicks: number; durationTicks: number };
    dialogueAlignment?: { dialogueRef: CreationRef; startTicks: number; durationTicks: number; videoRef: MediaReference; audioRef: MediaReference };
}
export type LocalMediaPlan = RenderPlan | DerivedMediaPlan;
export type LocalJobState = 'PREPARED' | 'QUEUED' | 'RUNNING' | 'VERIFYING' | 'PUBLISHING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
export interface LocalJobRef {
    libraryId: string;
    projectId: string;
    jobId: string;
}
export interface DerivedMediaRef {
    libraryId: string;
    cacheId: string;
    sourceHash: string;
    recipeHash: string;
}
export const isDerivedMediaRef = (x: unknown): x is DerivedMediaRef => isRecord(x) && Object.keys(x).length === 4 && typeof x.libraryId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x.libraryId) && ['cacheId', 'sourceHash', 'recipeHash'].every(key => typeof x[key] === 'string' && /^[a-f0-9]{64}$/.test(x[key] as string));
export interface LocalAttempt {
    attempt: number;
    state: LocalJobState;
    startedAt: number | null;
    endedAt: number | null;
    errorCode: string | null;
}
export interface RenderJobView extends LocalJobRef {
    planId: string;
    kind: 'render' | 'derived';
    state: LocalJobState;
    phase: string;
    progressTicks: number;
    cancelRequested: boolean;
    needsResume: boolean;
    attempt: number;
    history: LocalAttempt[];
    errorCode: string | null;
    outputRef: AssetVersionRef | null;
    derived: DerivedMediaRef[];
}
export interface RenderSnapshot {
    libraryId: string;
    projectId: string;
    jobs: RenderJobView[];
}
export interface DerivedMediaView {
    libraryId: string;
    projectId: string;
    planId: string;
    jobs: RenderJobView[];
    outputs: DerivedMediaRef[];
    entries: DerivedMediaEntry[];
    recipe: DerivedMediaRecipe;
}
export interface DerivedMediaRecipe extends TimelineSettings { videoFit: 'contain' | 'cover' }
export const isDerivedMediaRecipe = (x:unknown):x is DerivedMediaRecipe => isRecord(x)&&exact(x,['fps','canvas','videoFit'])&&isTimelineSettings({fps:x.fps,canvas:x.canvas})&&(x.videoFit==='contain'||x.videoFit==='cover');
export interface DerivedMediaEntry { ref:DerivedMediaRef; kind:'proxy'|'thumbnail'|'waveform'; mime:string }
export function isDerivedMediaEntry(x:unknown):x is DerivedMediaEntry {
    return isRecord(x)&&exact(x,['ref','kind','mime'])&&isDerivedMediaRef(x.ref)&&(
        x.kind==='proxy'&&['video/mp4','audio/wav'].includes(String(x.mime))||x.kind==='thumbnail'&&x.mime==='image/png'||x.kind==='waveform'&&x.mime==='application/json');
}
export interface PrepareRenderInput extends RenderOptions {
    timelineRef: TimelineRef;
}
export interface PrepareDerivedInput extends TimelineSettings {
    projectId: string;
    references: MediaReference[];
    executionOwner: string;
    runId: string;
    videoFit?: 'contain' | 'cover';
    voiceInput?: { voiceRef: CreationRef; sourceInTicks: number; durationTicks: number };
    dialogueAlignment?: { dialogueRef: CreationRef; startTicks: number; durationTicks: number; videoRef: MediaReference; audioRef: MediaReference };
}
export interface EnqueueRenderInput {
    planId: string;
    planHash: string;
    executionOwner: string;
    runId: string;
    diskBudgetBytes: number;
}
export interface LocalJobInput {
    jobId: string;
    executionOwner: string;
}
export interface RetryRenderInput extends LocalJobInput {
    runId: string;
}
const id = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const exact = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const voiceInput = (x: unknown) => isRecord(x) && exact(x, ['voiceRef', 'sourceInTicks', 'durationTicks']) && isRecord(x.voiceRef) && exact(x.voiceRef, ['id', 'revision']) && id(x.voiceRef.id) && Number.isSafeInteger(x.voiceRef.revision) && (x.voiceRef.revision as number) > 0 && Number.isSafeInteger(x.sourceInTicks) && (x.sourceInTicks as number) >= 0 && Number.isSafeInteger(x.durationTicks) && (x.durationTicks as number) >= 2 * 48000 && (x.durationTicks as number) <= 15 * 48000;
const dialogueAlignment = (x: unknown) => isRecord(x) && exact(x, ['dialogueRef', 'startTicks', 'durationTicks', 'videoRef', 'audioRef']) && isRecord(x.dialogueRef) && exact(x.dialogueRef, ['id', 'revision']) && id(x.dialogueRef.id) && Number.isSafeInteger(x.dialogueRef.revision) && (x.dialogueRef.revision as number) > 0 && Number.isSafeInteger(x.startTicks) && (x.startTicks as number) >= 0 && Number.isSafeInteger(x.durationTicks) && (x.durationTicks as number) > 0 && (x.durationTicks as number) <= 15 * 48000 && isMediaReference(x.videoRef) && isMediaReference(x.audioRef);
export function parsePrepareRender(x: unknown): Result<PrepareRenderInput> {
    if (!isRecord(x) || !exact(x, ['timelineRef', 'purpose', 'executionOwner', 'runId',...(x.burnSubtitles===undefined?[]:['burnSubtitles'])]) || x.burnSubtitles!==undefined&&(typeof x.burnSubtitles!=='boolean'||x.purpose==='wav') || !isRecord(x.timelineRef) || !exact(x.timelineRef, ['libraryId', 'projectId', 'id', 'revision']) || ![x.timelineRef.libraryId, x.timelineRef.projectId, x.timelineRef.id, x.executionOwner, x.runId].every(id) || !Number.isSafeInteger(x.timelineRef.revision) || Number(x.timelineRef.revision) < 1 || !['preview', 'mp4', 'wav'].includes(String(x.purpose)))
        return fail('INVALID_INPUT', '固定渲染计划参数无效。');
    return ok(x as unknown as PrepareRenderInput);
}
export function parsePrepareDerived(x: unknown): Result<PrepareDerivedInput> {
    if (!isRecord(x) || !exact(x, [
        'projectId', 'references', 'fps', 'canvas', 'executionOwner', 'runId', ...(x.videoFit===undefined?[]:['videoFit']), ...(x.voiceInput===undefined?[]:['voiceInput']), ...(x.dialogueAlignment===undefined?[]:['dialogueAlignment'])
    ]) || x.videoFit!==undefined&&x.videoFit!=='contain'&&x.videoFit!=='cover' || x.voiceInput!==undefined&&!voiceInput(x.voiceInput) || x.dialogueAlignment!==undefined&&!dialogueAlignment(x.dialogueAlignment) || ![x.projectId, x.executionOwner, x.runId].every(id) || !isTimelineSettings({
        fps: x.fps, canvas: x.canvas
    }) || !Array.isArray(x.references) || x.references.length < 1 || x.references.length > 1024 || !x.references.every(reference => isMediaReference(reference) && Object.keys(reference).every(key => (reference.kind === 'artifact' ? ['kind', 'libraryId', 'artifactId'] : ['kind', 'libraryId', 'assetId', 'version']).includes(key))) || new Set(x.references.map(reference => JSON.stringify(reference))).size > 64 || new TextEncoder().encode(JSON.stringify(x)).byteLength > 1024 * 1024)
        return fail('INVALID_INPUT', '派生媒体计划参数无效。');
    return ok(x as unknown as PrepareDerivedInput);
}
export function parseEnqueueRender(x: unknown): Result<EnqueueRenderInput> { return isRecord(x) && exact(x, ['planId', 'planHash', 'executionOwner', 'runId', 'diskBudgetBytes']) && [x.planId, x.executionOwner, x.runId].every(id) && hash(x.planHash) && Number.isSafeInteger(x.diskBudgetBytes) && Number(x.diskBudgetBytes) > 0 ? ok(x as unknown as EnqueueRenderInput) : fail('INVALID_INPUT', '请确认本地作业和磁盘预算。'); }
export function parseLocalJob(x: unknown): Result<LocalJobInput> { return isRecord(x) && exact(x, ['jobId', 'executionOwner']) && id(x.jobId) && id(x.executionOwner) ? ok(x as unknown as LocalJobInput) : fail('INVALID_INPUT', '本地作业参数无效。'); }
export function parseRetryRender(x: unknown): Result<RetryRenderInput> { if (!isRecord(x) || !exact(x, ['jobId', 'executionOwner', 'runId']) || !id(x.runId))
    return fail('INVALID_INPUT', '重试参数无效。'); const p = parseLocalJob({
    jobId: x.jobId, executionOwner: x.executionOwner
}); return p.ok ? ok(x as unknown as RetryRenderInput) : p; }
export function parseRenderRead(x: unknown): Result<{
    projectId: string;
    jobId: string;
}> { return isRecord(x) && exact(x, ['projectId', 'jobId']) && id(x.projectId) && id(x.jobId) ? ok(x as {
    projectId: string;
    jobId: string;
}) : fail('INVALID_INPUT', '作业查询无效。'); }
export function parseRenderPlanRead(x: unknown): Result<{
    projectId: string;
    planId: string;
}> { return isRecord(x) && exact(x, ['projectId', 'planId']) && id(x.projectId) && id(x.planId) ? ok(x as {
    projectId: string;
    planId: string;
}) : fail('INVALID_INPUT', '计划查询无效。'); }
export function parseRenderList(x: unknown): Result<{
    projectId: string;
}> { return isRecord(x) && exact(x, ['projectId']) && id(x.projectId) ? ok(x as {
    projectId: string;
}) : fail('INVALID_INPUT', '项目查询无效。'); }
export const isLocalJobRef = (x: unknown): x is LocalJobRef => isRecord(x) && [x.libraryId, x.projectId, x.jobId].every(id);
const integer = (x: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): x is number => Number.isSafeInteger(x) && Number(x) >= min && Number(x) <= max;
const baseKeys = [
    'libraryId', 'projectId', 'planId', 'planHash', 'expiresAt', 'executionOwner', 'runId', 'manifest', 'estimatedBytes', 'requiredFreeBytes'
];
function fixedReference(x: unknown): x is MediaReference {
    return isMediaReference(x) && exact(x as unknown as Record<string, unknown>, x.kind === 'artifact' ? ['kind', 'libraryId', 'artifactId'] : ['kind', 'libraryId', 'assetId', 'version']);
}
function isManifest(x: unknown, libraryId: string): x is ResolvedMediaManifest {
    if (!isRecord(x) || !exact(x, ['entries', 'runtimeHash', 'fontHash']) || !hash(x.runtimeHash) || !hash(x.fontHash) || !Array.isArray(x.entries) || x.entries.length > 320)
        return false;
    return x.entries.every(entry => {
        if (!isRecord(entry) || !exact(entry, [
            'ref', 'hash', 'mime', 'byteLength', 'width', 'height', 'probe'
        ]) || !fixedReference(entry.ref) || entry.ref.libraryId !== libraryId || !hash(entry.hash) || !integer(entry.byteLength, 1, 1024 ** 3) || !integer(entry.width, 0, 40000000) || !integer(entry.height, 0, 40000000) || ![
            'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/wav', 'audio/mpeg', 'audio/mp4'
        ].includes(String(entry.mime)))
            return false;
        if (String(entry.mime).startsWith('image/'))
            return entry.probe === null && entry.width > 0 && entry.height > 0;
        const probe = entry.probe;
        return isRecord(probe) && probe.objectHash === entry.hash && probe.runtimeHash === x.runtimeHash && id(probe.probeId) && integer(probe.durationTicks, 1, 28800000) && Array.isArray(probe.streams) && probe.streams.length > 0 && probe.streams.length <= 4 && probe.verification === 'probed' && Number.isFinite(probe.originSeconds);
    });
}
function planBase(x: Record<string, unknown>): boolean {
    return [x.libraryId, x.projectId, x.planId, x.executionOwner, x.runId].every(id) && hash(x.planHash) && integer(x.expiresAt, 1) && integer(x.estimatedBytes, 1) && integer(x.requiredFreeBytes, Number(x.estimatedBytes) + 1024 ** 3) && isManifest(x.manifest, String(x.libraryId));
}
export function isRenderPlan(x: unknown): x is RenderPlan {
    if (!isRecord(x) || !exact(x, [
        ...baseKeys, 'kind', 'compositionHash', 'timelineRef', 'timeline', 'purpose', 'durationTicks', 'maxOutputBytes', 'notices', 'policy', ...(x.burnSubtitles===undefined?[]:['burnSubtitles'])
    ]) || !planBase(x) || x.kind !== 'render' || !hash(x.compositionHash) || !isTimelineRevision(x.timeline) || !['preview', 'mp4', 'wav'].includes(String(x.purpose)) || !integer(x.durationTicks, 1, 28800000) || !Array.isArray(x.notices) || !x.notices.every(notice => notice === 'BLACK_VIDEO_TAIL') || !isRecord(x.policy))
        return false;
    if(x.burnSubtitles!==undefined&&(typeof x.burnSubtitles!=='boolean'||x.purpose==='wav'))return false;
    const t = x.timeline, ref = x.timelineRef, policy = x.policy;
    return t.libraryId === x.libraryId && t.projectId === x.projectId && isRecord(ref) && exact(ref, ['libraryId', 'projectId', 'id', 'revision']) && ref.libraryId === t.libraryId && ref.projectId === t.projectId && ref.id === t.id && ref.revision === t.revision && exact(policy, ['video', 'audio', 'sampleRate', 'threads', 'limiterMilli']) && policy.video === 'libx264' && policy.audio === (x.purpose === 'wav' ? 'pcm_s16le' : 'aac') && policy.sampleRate === 48000 && policy.threads === 4 && policy.limiterMilli === 950 && x.maxOutputBytes === (x.purpose === 'wav' ? 128 * 1024 ** 2 : x.purpose === 'preview' ? 256 * 1024 ** 2 : 1024 ** 3);
}
export const isDerivedMediaPlan = (x: unknown): x is DerivedMediaPlan => isRecord(x) && exact(x, [...baseKeys, 'kind', 'fps', 'canvas', 'recipeHash',...(x.videoFit===undefined?[]:['videoFit']),...(x.voiceInput===undefined?[]:['voiceInput']),...(x.dialogueAlignment===undefined?[]:['dialogueAlignment'])]) && (x.videoFit===undefined||x.videoFit==='contain'||x.videoFit==='cover') && (x.voiceInput===undefined||voiceInput(x.voiceInput)) && (x.dialogueAlignment===undefined||dialogueAlignment(x.dialogueAlignment)) && planBase(x) && x.kind === 'derived' && hash(x.recipeHash) && isTimelineSettings({
    fps: x.fps, canvas: x.canvas
}) && (x.manifest as ResolvedMediaManifest).entries.length <= 64;
export const isRenderJobView = (x: unknown): x is RenderJobView => isLocalJobRef(x) && isRecord(x) && id(x.planId) && ['render', 'derived'].includes(String(x.kind)) && [
    'PREPARED', 'QUEUED', 'RUNNING', 'VERIFYING', 'PUBLISHING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'
].includes(String(x.state)) && typeof x.cancelRequested === 'boolean' && typeof x.needsResume === 'boolean' && id(x.phase) && integer(x.progressTicks, 0, 28800000) && integer(x.attempt, 1) && (x.errorCode === null || typeof x.errorCode === 'string' && x.errorCode.length <= 128) && (x.outputRef === null || isAssetVersionRef(x.outputRef) && x.outputRef.libraryId === x.libraryId) && Array.isArray(x.history) && x.history.every(attempt => isRecord(attempt) && integer(attempt.attempt, 1) && typeof attempt.state === 'string' && (attempt.startedAt === null || integer(attempt.startedAt, 1)) && (attempt.endedAt === null || integer(attempt.endedAt, 1)) && (attempt.errorCode === null || typeof attempt.errorCode === 'string')) && Array.isArray(x.derived) && x.derived.every(ref => isDerivedMediaRef(ref) && ref.libraryId === x.libraryId);
export const isRenderSnapshot = (x: unknown): x is RenderSnapshot => isRecord(x) && id(x.libraryId) && id(x.projectId) && Array.isArray(x.jobs) && x.jobs.every(isRenderJobView);
export const isDerivedMediaView = (x: unknown): x is DerivedMediaView => isRenderSnapshot(x) && isRecord(x) && exact(x,['libraryId','projectId','planId','jobs','outputs','entries','recipe']) && isDerivedMediaRecipe(x.recipe) && id(x.planId) && Array.isArray(x.outputs) && x.outputs.every(r=>isDerivedMediaRef(r)&&r.libraryId===x.libraryId) && Array.isArray(x.entries)&&x.entries.every(e=>isDerivedMediaEntry(e)&&e.ref.libraryId===x.libraryId&&(x.outputs as unknown[]).some((r:unknown)=>JSON.stringify(r)===JSON.stringify(e.ref)));
