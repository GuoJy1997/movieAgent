import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, stat, statfs, realpath, unlink, lstat, readdir, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { DurableObjectReceipt } from '../../storage/src/collection-journal.ts';
import type { assetsFor } from './asset-service.ts';
import type { timelinesFor } from './timeline-service.ts';
import type { mediaInfoFor } from './media-info-service.ts';
import type { MediaRuntime } from '../../contracts/src/media-info.ts';
import type { MediaReference } from '../../contracts/src/assets.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { isRenderPlan, isDerivedMediaPlan, parsePrepareRender, parseEnqueueRender, parseLocalJob, parseRetryRender, parsePrepareDerived, type PrepareRenderInput, type PrepareDerivedInput, type RenderPlan, type LocalMediaPlan, type DerivedMediaPlan, type EnqueueRenderInput, type LocalJobInput, type RetryRenderInput, type LocalJobRef, type RenderJobView, type RenderSnapshot, type ResolvedMediaManifest, type LocalJobState, type DerivedMediaView } from '../../contracts/src/render.ts';
import { parseInspectMedia, isResolvedMedia, isDerivedMediaEntry, type InspectMediaInput, type ResolvedMedia, type DerivedMediaEntry } from '../../contracts/src/render.ts';
import { compileRenderPlan, renderDigest } from '../../domain/src/render-plan.ts';
import { checkFontCoverage } from './media/font.ts';
import { renderMedia } from './media/compile.ts';
import { hashMediaFile, verifyRenderOutput, type VerifiedRenderOutput } from './media/verify.ts';
import { mediaCacheIOFor } from './media/cache.ts';
import { buildDerived } from './media/derived.ts';
import { prepareVoiceInput } from './media/voice-input.ts';
import { probeMediaFile } from './media/probe.ts';
import { alignDialogueMedia } from './media/dialogue-align.ts';
export interface LocalMediaOptions {
    onPhase?: (phase: 'rendered' | 'verified' | 'journaled' | 'renamed' | 'beforePublish' | 'published', jobId: string) => void | Promise<void>;
}
const terminal = (state: string) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state);
/** Public status contains stable codes, never Node's path-bearing diagnostic message. */
function publicMediaError(error: unknown): string {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code === 'ENOSPC') return 'INSUFFICIENT_SPACE';
    if (code === 'ENOENT') return 'MEDIA_FILE_NOT_FOUND';
    if (code === 'EACCES' || code === 'EPERM') return 'MEDIA_FILE_ACCESS_DENIED';
    if (['EEXIST', 'ENOTDIR', 'EISDIR', 'ELOOP'].includes(code)) return 'MEDIA_FILE_INVALID';
    const message = error instanceof Error ? error.message : '';
    return /^[A-Z][A-Z0-9_]{0,127}$/.test(message) ? message : 'MEDIA_JOB_FAILED';
}
export function rendersFor({ library, assets, timelines, mediaInfo, runtime, options = {} }: {
    library: LibraryHandle;
    assets: ReturnType<typeof assetsFor>;
    timelines: ReturnType<typeof timelinesFor>;
    mediaInfo: ReturnType<typeof mediaInfoFor>;
    runtime?: MediaRuntime;
    options?: LocalMediaOptions;
}) {
    const db = library.db;
    const cacheIO = mediaCacheIOFor(library, runtime?.runtimeHash);
    let wake = () => { };
    const controllers = new Map<string, AbortController>();
    const stagingCleanups = new Map<string, Promise<void>>();
    async function cleanupStaging(jobId: string): Promise<void> {
        const job = row(jobId);
        if (!job || !terminal(String(job.state)) || controllers.has(jobId) || !library.checkOwnership().ok)
            return;
        try {
            const temp = resolve(library.root, 'temp');
            const directory = resolve(temp, 'media-job-' + jobId);
            const inside = relative(temp, directory);
            if (!inside || inside.startsWith('..') || isAbsolute(inside) || !/^[a-zA-Z0-9_-]{1,128}$/.test(jobId))
                throw Error('INVALID_STAGING_PATH');
            const facts = await lstat(directory).catch(error => {
                if (error?.code === 'ENOENT') return null;
                throw error;
            });
            if (!facts) { cleanupStatus(jobId, false); return; }
            // Check absolute resolved targets before recursive removal; never follow a redirected temp/job root.
            if (facts.isSymbolicLink() || (await realpath(temp)).toLowerCase() !== temp.toLowerCase()
                || (await realpath(directory)).toLowerCase() !== directory.toLowerCase())
                throw Error('INVALID_STAGING_PATH');
            if (facts.isDirectory()) await checkStagingTree(directory);
            else if (!facts.isFile()) throw Error('INVALID_STAGING_PATH');
            if (!terminal(String(row(jobId)?.state)) || !library.checkOwnership().ok) return;
            await rm(directory, { recursive: true, force: true });
            cleanupStatus(jobId, false);
        }
        catch {
            // Published success and its durable object remain valid even if temporary cleanup fails.
            cleanupStatus(jobId, true);
        }
    }
    function cleanupStatus(jobId: string, pending: boolean): void {
        if (!library.checkOwnership().ok) return;
        transaction(() => {
            const job = row(jobId);
            if (!job || !terminal(String(job.state)) || !pending && job.phase !== 'cleanup-pending')
                return ok(undefined);
            const phase = pending ? 'cleanup-pending' : String(job.state).toLowerCase();
            const error = pending && job.state === 'SUCCEEDED' ? 'STAGING_CLEANUP_PENDING'
                : job.error_code === 'STAGING_CLEANUP_PENDING' ? null : job.error_code ?? null;
            db.prepare('UPDATE local_media_job SET phase=?,error_code=? WHERE job_id=?').run(phase, error, jobId);
            const view = read({ projectId: String(job.project_id), jobId });
            if (view.ok) db.prepare("INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,'render.changed',?)").run(library.libraryId, JSON.stringify(view.value));
            return ok(undefined);
        });
    }
    async function checkStagingTree(directory: string, depth = 0): Promise<void> {
        if (depth > 8) throw Error('INVALID_STAGING_PATH');
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile())
                throw Error('INVALID_STAGING_PATH');
            if (entry.isDirectory()) await checkStagingTree(join(directory, entry.name), depth + 1);
        }
    }
    function queueStagingCleanup(jobId: string): Promise<void> {
        if (controllers.has(jobId)) return Promise.resolve();
        const existing = stagingCleanups.get(jobId);
        if (existing) return existing;
        const work = cleanupStaging(jobId).finally(() => { stagingCleanups.delete(jobId); });
        stagingCleanups.set(jobId, work);
        return work;
    }
    async function drainStagingCleanup(): Promise<void> {
        while (stagingCleanups.size) await Promise.all(stagingCleanups.values());
    }
    async function cleanupTerminalStaging(): Promise<void> {
        for (const job of db.prepare("SELECT job_id FROM local_media_job WHERE state IN ('SUCCEEDED','FAILED','CANCELLED')").all())
            await queueStagingCleanup(String(job.job_id));
    }
    function transaction<T>(fn: () => Result<T>): Result<T> {
        if (db.isTransaction)
            return fn();
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            db.exec(result.ok ? 'COMMIT' : 'ROLLBACK');
            return result;
        }
        catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
    function project(projectId: string): Result<void> {
        const own = library.checkOwnership();
        if (!own.ok)
            return own;
        return db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(projectId, library.libraryId) ? ok(undefined) : fail('PROJECT_NOT_FOUND', '当前资料库中没有此项目。');
    }
    function storedPlan(planId: string): LocalMediaPlan | undefined {
        const row = db.prepare('SELECT data_json FROM render_plan WHERE plan_id=?').get(planId);
        if (!row)
            return undefined;
        const value: unknown = JSON.parse(row.data_json as string);
        if (!(isRenderPlan(value) || isDerivedMediaPlan(value)) || value.libraryId !== library.libraryId || value.planId !== planId)
            throw Error('INVALID_STORED_DATA');
        return value;
    }
    function row(jobId: string) { return db.prepare('SELECT j.*,p.project_id,p.kind,p.owner FROM local_media_job j JOIN render_plan p ON p.plan_id=j.plan_id WHERE j.job_id=?').get(jobId); }
    function check(jobId: string): void {
        if (controllers.get(jobId)?.signal.aborted)
            throw Error('MEDIA_CANCELLED');
        if (!library.checkOwnership().ok)
            throw Error('LIBRARY_OWNERSHIP_LOST');
        const job = row(jobId);
        if (!job || job.cancel_requested || job.state === 'CANCELLED')
            throw Error('MEDIA_CANCELLED');
        if (job.lease_owner !== library.instanceId)
            throw Error('MEDIA_LEASE_LOST');
    }
    function state(jobId: string, next: LocalJobState, phase = next.toLowerCase(), errorCode: string | null = null): void {
        transaction(() => {
            const job = row(jobId);
            if (!job || job.state === 'SUCCEEDED' || job.state === 'CANCELLED' && next !== 'CANCELLED')
                return ok(undefined);
            const final = job.cancel_requested ? 'CANCELLED' : next;
            db.prepare('UPDATE local_media_job SET state=?,phase=?,error_code=?,lease_owner=?,needs_resume=? WHERE job_id=?').run(final, phase, errorCode, terminal(final) || final === 'INTERRUPTED' ? null : job.lease_owner ?? null, final === 'INTERRUPTED' ? 1 : 0, jobId);
            db.prepare('UPDATE local_media_attempt SET state=?,ended_at=?,error_code=? WHERE job_id=?').run(final, terminal(final) || final === 'INTERRUPTED' ? Date.now() : null, errorCode, jobId);
            if (terminal(final) || final === 'INTERRUPTED')
                db.prepare('DELETE FROM local_media_cache_lease WHERE plan_id=? AND NOT EXISTS(SELECT 1 FROM local_media_job WHERE plan_id=? AND state NOT IN (\'SUCCEEDED\',\'FAILED\',\'CANCELLED\',\'INTERRUPTED\'))').run(String(job.plan_id), String(job.plan_id));
            if (terminal(final)) queueMicrotask(() => { void queueStagingCleanup(jobId); });
            const snapshot = read({
                projectId: String(job.project_id), jobId
            });
            if (snapshot.ok)
                db.prepare("INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,'render.changed',?)").run(library.libraryId, JSON.stringify(snapshot.value));
            return ok(undefined);
        });
    }
    function plan(input: {
        projectId: string;
        planId: string;
    }): Result<LocalMediaPlan> {
        const valid = project(input.projectId);
        if (!valid.ok)
            return valid;
        const value = storedPlan(input.planId);
        return value && value.projectId === input.projectId ? ok(value) : fail('RENDER_PLAN_NOT_FOUND', '固定计划不存在。');
    }
    function read(input: {
        projectId: string;
        jobId: string;
    }): Result<RenderJobView> {
        const valid = project(input.projectId);
        if (!valid.ok)
            return valid;
        const job = row(input.jobId);
        if (!job || job.project_id !== input.projectId)
            return fail('LOCAL_JOB_NOT_FOUND', '本地作业不存在。');
        const output = db.prepare('SELECT asset_id,version FROM local_media_output WHERE job_id=?').get(input.jobId);
        return ok({
            libraryId: library.libraryId, projectId: input.projectId, jobId: input.jobId, planId: job.plan_id as string, kind: job.kind as 'render' | 'derived', state: job.state as LocalJobState, phase: job.phase as string, progressTicks: Number(job.progress_ticks), cancelRequested: Boolean(job.cancel_requested), needsResume: Boolean(job.needs_resume), attempt: Number(job.attempt), errorCode: job.error_code as string | null, outputRef: output ? {
                kind: 'assetVersion', libraryId: library.libraryId, assetId: output.asset_id as string, version: Number(output.version)
            } : null, history: db.prepare('SELECT attempt,state,started_at AS startedAt,ended_at AS endedAt,error_code AS errorCode FROM local_media_attempt WHERE plan_id=? ORDER BY attempt').all(String(job.plan_id)) as unknown as RenderJobView['history'], derived: db.prepare('SELECT data_json FROM local_media_derived_output WHERE job_id=? ORDER BY cache_id').all(input.jobId).map(value => JSON.parse(value.data_json as string))
        });
    }
    function list(input: {
        projectId: string;
    }): Result<RenderSnapshot> {
        const valid = project(input.projectId);
        if (!valid.ok)
            return valid;
        const jobs: RenderJobView[] = [];
        for (const value of db.prepare('SELECT j.job_id FROM local_media_job j JOIN render_plan p ON p.plan_id=j.plan_id WHERE p.project_id=? ORDER BY j.created_at,j.rowid').all(input.projectId)) {
            const result = read({
                projectId: input.projectId, jobId: value.job_id as string
            });
            if (!result.ok)
                return result;
            jobs.push(result.value);
        }
        return ok({
            libraryId: library.libraryId, projectId: input.projectId, jobs
        });
    }
    function savePrepared<T extends LocalMediaPlan>(value: T): Result<T> {
        if (!(isRenderPlan(value) || isDerivedMediaPlan(value)))
            return fail('INVALID_RENDER_PLAN', '固定本地计划无效。');
        const valid = project(value.projectId);
        if (!valid.ok)
            return valid;
        return transaction(() => {
            const existing = storedPlan(value.planId);
            if (existing)
                return existing.planHash === value.planHash ? ok(existing as T) : fail('PLAN_CHANGED', '计划身份已被使用。');
            db.prepare('INSERT INTO render_plan VALUES(?,?,?,?,?,?,?,?)').run(value.planId, value.projectId, value.kind, value.planHash, value.executionOwner, value.runId, value.expiresAt, JSON.stringify(value));
            for (const media of value.manifest.entries) {
                for (const cache of db.prepare('SELECT cache_id FROM media_cache WHERE source_hash=? AND runtime_hash=?').all(media.hash, value.manifest.runtimeHash))
                    db.prepare('INSERT OR IGNORE INTO local_media_cache_lease VALUES(?,?)').run(value.planId, String(cache.cache_id));
            }
            return ok(value);
        });
    }
    function manifest(references: MediaReference[]): Result<ResolvedMediaManifest> {
        if (!runtime)
            return fail('MEDIA_RUNTIME_UNAVAILABLE', '固定媒体运行时不可用。');
        const entries: ResolvedMediaManifest['entries'] = [];
        for (const reference of references) {
            if (entries.some(entry => JSON.stringify(entry.ref) === JSON.stringify(reference)))
                continue;
            const metadata = assets.metadata(reference);
            if (!metadata.ok)
                return metadata;
            const probe = metadata.value.mime.startsWith('image/') ? ok(null) : mediaInfo.read(reference);
            if (!probe.ok)
                return probe;
            if (!metadata.value.mime.startsWith('image/') && !probe.value)
                return fail('MEDIA_ANALYSIS_REQUIRED', '请先分析固定素材。');
            entries.push({
                ref: structuredClone(reference), ...metadata.value, probe: probe.value
            });
        }
        return ok({
            entries, runtimeHash: runtime.runtimeHash, fontHash: runtime.fontManifest.sha256
        });
    }
    async function verifySources(value: LocalMediaPlan, signal?: AbortSignal): Promise<Result<void>> {
        for (const media of value.manifest.entries) {
            if (signal?.aborted)
                return fail('MEDIA_CANCELLED', '已取消。');
            const opened = await assets.openMediaRead(media.ref, media.hash);
            if (!opened.ok)
                return opened;
            await assets.closeMediaRead(opened.value.leaseId);
            if (signal?.aborted)
                return fail('MEDIA_CANCELLED', '已取消。');
            const metadata = assets.metadata(media.ref);
            if (!metadata.ok)
                return metadata;
            if (JSON.stringify(metadata.value) !== JSON.stringify({
                hash: media.hash, mime: media.mime, byteLength: media.byteLength, width: media.width, height: media.height
            }))
                return fail('REFERENCE_CHANGED', '固定原件已改变。');
        }
        return library.checkOwnership();
    }
    async function inspectPrepare(input: PrepareRenderInput): Promise<Result<RenderPlan>> {
        const parsed = parsePrepareRender(input);
        if (!parsed.ok)
            return parsed;
        if (db.isTransaction)
            return fail('ASYNC_IN_TRANSACTION', '媒体预检不能在数据库事务内进行。');
        if (input.timelineRef.libraryId !== library.libraryId)
            return fail('WRONG_LIBRARY', '时间线属于其他资料库。');
        const timeline = timelines.read({
            projectId: input.timelineRef.projectId, timelineId: input.timelineRef.id, revision: input.timelineRef.revision
        });
        if (!timeline.ok)
            return timeline;
        const resolved = manifest([...timeline.value.videoClips, ...timeline.value.audioClips].map(clip => clip.media));
        if (!resolved.ok)
            return resolved;
        const compiled = compileRenderPlan(timeline.value, resolved.value, input);
        if (!compiled.ok)
            return compiled;
        const coverage = input.purpose==='wav'||input.burnSubtitles===false?ok({missing:[]}):await checkFontCoverage(runtime!, timeline.value.subtitleCues.map(cue => cue.text).join('\n'));
        if (!coverage.ok)
            return coverage;
        if (coverage.value.missing.length)
            return fail('FONT_GLYPH_MISSING', '固定字体缺少字符：' + coverage.value.missing.join(''));
        const sources = await verifySources(compiled.value);
        if (!sources.ok)
            return sources;
        const space = await statfs(library.root);
        if (Number(space.bavail) * Number(space.bsize) < compiled.value.requiredFreeBytes)
            return fail('INSUFFICIENT_SPACE', '磁盘可用空间不足。');
        const own = library.checkOwnership();
        return own.ok ? compiled : own;
    }
    async function inspectDerived(input: PrepareDerivedInput): Promise<Result<DerivedMediaPlan>> {
        const parsed = parsePrepareDerived(input);
        if (!parsed.ok)
            return parsed;
        if (db.isTransaction)
            return fail('ASYNC_IN_TRANSACTION', '派生预检不能在事务内进行。');
        const valid = project(input.projectId);
        if (!valid.ok)
            return valid;
        for (const reference of input.references) {
            const selected = assets.assertSelectable(reference);
            if (!selected.ok)
                return selected;
        }
        const resolved = manifest(input.references);
        if (!resolved.ok)
            return resolved;
        resolved.value.entries = resolved.value.entries.filter((entry, index, entries) => entries.findIndex(other => other.hash === entry.hash) === index);
        const recipeHash = renderDigest({
            fps: input.fps, canvas: input.canvas, runtime: resolved.value.runtimeHash, font: resolved.value.fontHash, recipe: 'editing-preview-v1', ...(input.videoFit===undefined?{}:{videoFit:input.videoFit}), ...(input.voiceInput===undefined?{}:{voiceInput:input.voiceInput}), ...(input.dialogueAlignment===undefined?{}:{dialogueAlignment:input.dialogueAlignment})
        });
        const estimatedBytes = resolved.value.entries.reduce((sum, media) => sum + media.byteLength * 3 + Math.ceil((media.probe?.durationTicks ?? 48000) / 48000 * 500000), 0);
        const value: DerivedMediaPlan = {
            kind: 'derived', libraryId: library.libraryId, projectId: input.projectId, planId: randomUUID(), planHash: renderDigest({
                recipeHash, entries: resolved.value.entries
            }), expiresAt: Date.now() + 600000, executionOwner: input.executionOwner, runId: input.runId, manifest: resolved.value, fps: input.fps, canvas: input.canvas, ...(input.videoFit===undefined?{}:{videoFit:input.videoFit}), ...(input.voiceInput===undefined?{}:{voiceInput:input.voiceInput}), ...(input.dialogueAlignment===undefined?{}:{dialogueAlignment:input.dialogueAlignment}), recipeHash, estimatedBytes, requiredFreeBytes: estimatedBytes + 1024 ** 3
        };
        const verified = await verifySources(value);
        if (!verified.ok)
            return verified;
        const space = await statfs(library.root);
        return Number(space.bavail) * Number(space.bsize) >= value.requiredFreeBytes ? ok(value) : fail('INSUFFICIENT_SPACE', '派生缓存空间不足。');
    }
    function approve(input: EnqueueRenderInput, kind: 'render' | 'derived'): Result<LocalJobRef> {
        const parsed = parseEnqueueRender(input);
        if (!parsed.ok)
            return parsed;
        const own = library.checkOwnership();
        if (!own.ok)
            return own;
        const value = storedPlan(input.planId);
        if (!value || value.kind !== kind || value.planHash !== input.planHash || value.executionOwner !== input.executionOwner || value.runId !== input.runId)
            return fail('PLAN_AUTHORITY_MISMATCH', '计划批准身份不匹配。');
        const existing = db.prepare('SELECT job_id FROM local_media_job WHERE plan_id=? AND approval_run_id=?').get(input.planId, input.runId);
        if (existing)
            return ok({
                libraryId: library.libraryId, projectId: value.projectId, jobId: existing.job_id as string
            });
        if (value.expiresAt <= Date.now())
            return fail('PLAN_EXPIRED', '准备计划已到期。');
        if (input.diskBudgetBytes < value.requiredFreeBytes)
            return fail('DISK_BUDGET_REQUIRED', '磁盘预算不足。');
        for (const media of value.manifest.entries) {
            const metadata = assets.metadata(media.ref);
            if (!metadata.ok)
                return metadata;
            if (metadata.value.hash !== media.hash)
                return fail('REFERENCE_CHANGED', '固定素材已改变。');
        }
        return createJob(value, input.runId);
    }
    function createJob(value: LocalMediaPlan, runId: string): Result<LocalJobRef> {
        return transaction(() => {
            const previous = db.prepare('SELECT job_id FROM local_media_job WHERE plan_id=? AND approval_run_id=?').get(value.planId, runId);
            if (previous)
                return ok({
                    libraryId: library.libraryId, projectId: value.projectId, jobId: previous.job_id as string
                });
            const attempt = Number(db.prepare('SELECT COALESCE(MAX(attempt),0)+1 AS attempt FROM local_media_job WHERE plan_id=?').get(value.planId)!.attempt);
            const jobId = randomUUID();
            db.prepare('INSERT INTO local_media_job(job_id,plan_id,attempt,approval_run_id,state,phase,created_at) VALUES(?,?,?,?,?,?,?)').run(jobId, value.planId, attempt, runId, 'QUEUED', 'queued', Date.now());
            db.prepare('INSERT INTO local_media_attempt(job_id,plan_id,attempt,state) VALUES(?,?,?,?)').run(jobId, value.planId, attempt, 'QUEUED');
            queueMicrotask(wake);
            return ok({
                libraryId: library.libraryId, projectId: value.projectId, jobId
            });
        });
    }
    function authorized(input: LocalJobInput): Result<NonNullable<ReturnType<typeof row>>> {
        const parsed = parseLocalJob(input);
        if (!parsed.ok)
            return parsed;
        const own = library.checkOwnership();
        if (!own.ok)
            return own;
        const job = row(input.jobId);
        return job && job.owner === input.executionOwner ? ok(job) : fail('LOCAL_JOB_AUTHORITY', '本地作业执行身份不匹配。');
    }
    function cancel(input: LocalJobInput): Result<RenderJobView> {
        const allowed = authorized(input);
        if (!allowed.ok)
            return allowed;
        if (!terminal(String(allowed.value.state))) {
            db.prepare('UPDATE local_media_job SET cancel_requested=1 WHERE job_id=?').run(input.jobId);
            controllers.get(input.jobId)?.abort();
            state(input.jobId, 'CANCELLED');
        }
        return read({
            projectId: allowed.value.project_id as string, jobId: input.jobId
        });
    }
    function resume(input: LocalJobInput): Result<RenderJobView> {
        const allowed = authorized(input);
        if (!allowed.ok)
            return allowed;
        if (!['QUEUED', 'INTERRUPTED'].includes(String(allowed.value.state)) || allowed.value.cancel_requested)
            return fail('LOCAL_JOB_NOT_RESUMABLE', '此作业不能继续。');
        const recovery = allowed.value.state === 'INTERRUPTED' || allowed.value.phase === 'recover-output';
        db.prepare("UPDATE local_media_job SET state='QUEUED',phase=?,needs_resume=0,error_code=NULL WHERE job_id=?").run(recovery ? 'recover-output' : 'queued', input.jobId);
        db.prepare("UPDATE local_media_attempt SET state='QUEUED',ended_at=NULL,error_code=NULL WHERE job_id=?").run(input.jobId);
        queueMicrotask(wake);
        return read({
            projectId: allowed.value.project_id as string, jobId: input.jobId
        });
    }
    function retry(input: RetryRenderInput): Result<LocalJobRef> {
        const parsed = parseRetryRender(input);
        if (!parsed.ok)
            return parsed;
        const allowed = authorized({
            jobId: input.jobId, executionOwner: input.executionOwner
        });
        if (!allowed.ok)
            return allowed;
        const value = storedPlan(allowed.value.plan_id as string)!;
        const replay = db.prepare('SELECT job_id,attempt FROM local_media_job WHERE plan_id=? AND approval_run_id=?').get(value.planId, input.runId);
        if (replay && Number(replay.attempt) <= Number(allowed.value.attempt))
            return fail('RETRY_RUN_ID_REUSED', '重试需要明确的新运行身份。');
        if (replay)
            return ok({
                libraryId: library.libraryId, projectId: value.projectId, jobId: replay.job_id as string
            });
        if (!['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(String(allowed.value.state)))
            return fail('LOCAL_JOB_NOT_RETRYABLE', '请先结束此本地作业。');
        return createJob(value, input.runId);
    }
    async function stage(jobId: string, value: LocalMediaPlan, directory: string): Promise<string[]> {
        const paths: string[] = [];
        for (let index = 0; index < value.manifest.entries.length; index++) {
            const media = value.manifest.entries[index]!;
            const path = join(directory, 's' + index);
            const opened = await assets.openMediaRead(media.ref, media.hash);
            if (!opened.ok)
                throw Error(opened.error.code);
            try {
                check(jobId);
                const target = await open(path, 'w', 0o600);
                try {
                    check(jobId);
                    for (let offset = 0; offset < opened.value.byteLength;) {
                        const chunk = await assets.readMediaRange({
                            leaseId: opened.value.leaseId, offset, length: Math.min(1024 * 1024, opened.value.byteLength - offset)
                        });
                        check(jobId);
                        if (!chunk.ok || chunk.value.bytes.length === 0)
                            throw Error(chunk.ok ? 'OBJECT_INTEGRITY_FAILED' : chunk.error.code);
                        await target.writeFile(chunk.value.bytes);
                        check(jobId);
                        offset += chunk.value.bytes.length;
                    }
                    await target.sync();
                    check(jobId);
                }
                finally {
                    await target.close();
                }
            }
            finally {
                await assets.closeMediaRead(opened.value.leaseId);
            }
            check(jobId);
            const hash = await hashMediaFile(path, media.byteLength, controllers.get(jobId)!.signal);
            check(jobId);
            if (!hash.ok || hash.value.hash !== media.hash)
                throw Error('OBJECT_INTEGRITY_FAILED');
            paths.push(path);
        }
        return paths;
    }
    async function publish(jobId: string, value: RenderPlan | DerivedMediaPlan, directory: string, output: string, verified: VerifiedRenderOutput): Promise<void> {
        const outputId = 'local-' + jobId;
        const assetName = 'timeline' in value ? value.timeline.title + (value.purpose === 'wav' ? '.wav' : '.mp4') : 'character-voice-reference.wav';
        const receipt: DurableObjectReceipt = {
            objectId: verified.hash, hash: verified.hash, byteLength: verified.byteLength, storageKey: 'objects/' + verified.hash.slice(0, 2) + '/' + verified.hash, mime: verified.mime, width: verified.width, height: verified.height
        };
        const durableFile = await open(output, 'r+');
        try {
            await durableFile.sync();
        }
        finally {
            await durableFile.close();
        }
        check(jobId);
        db.prepare("INSERT INTO local_media_publication VALUES(?,?,?,?,?) ON CONFLICT(job_id) DO NOTHING").run(jobId, outputId, verified.hash, JSON.stringify(receipt), 'verified');
        await options.onPhase?.('journaled', jobId);
        check(jobId);
        const objectPath = join(library.root, receipt.storageKey);
        await mkdir(join(objectPath, '..'), {
            recursive: true
        });
        check(jobId);
        if ((await realpath(join(objectPath, '..'))).toLowerCase() !== join(objectPath, '..').toLowerCase())
            throw Error('INVALID_STORAGE_KEY');
        check(jobId);
        const exists = await stat(objectPath).then(() => true, () => false);
        check(jobId);
        if (!exists) {
            await rename(output, objectPath);
            check(jobId);
        }
        await options.onPhase?.('renamed', jobId);
        check(jobId);
        const hash = await hashMediaFile(objectPath, 'maxOutputBytes' in value ? value.maxOutputBytes : 4 * 1024 * 1024, controllers.get(jobId)!.signal);
        check(jobId);
        if (!hash.ok || hash.value.hash !== verified.hash || hash.value.byteLength !== verified.byteLength)
            throw Error('OBJECT_INTEGRITY_FAILED');
        db.prepare("UPDATE local_media_publication SET state='durable' WHERE job_id=?").run(jobId);
        await options.onPhase?.('beforePublish', jobId);
        check(jobId);
        transaction(() => {
            check(jobId);
            const job = row(jobId)!;
            db.prepare('INSERT OR IGNORE INTO blob_object VALUES(?,?,?,?,?,?,?)').run(receipt.objectId, receipt.hash, receipt.byteLength, receipt.storageKey, receipt.mime, receipt.width, receipt.height);
            db.prepare('INSERT OR IGNORE INTO asset(id,library_id,name) VALUES(?,?,?)').run(outputId, library.libraryId, assetName);
            db.prepare('INSERT OR IGNORE INTO asset_version(asset_id,version,library_id,object_id,artifact_id,created_at) VALUES(?,?,?,?,NULL,?)').run(outputId, 1, library.libraryId, receipt.objectId, new Date().toISOString());
            db.prepare('INSERT OR IGNORE INTO local_media_output VALUES(?,?,?,?,?,?)').run(outputId, jobId, Number(job.attempt), receipt.objectId, outputId, 1);
            db.prepare("UPDATE local_media_publication SET state='published' WHERE job_id=?").run(jobId);
            state(jobId, 'SUCCEEDED');
            return ok(undefined);
        });
        await options.onPhase?.('published', jobId);
        void directory;
    }
    async function execute(jobId: string, controller: AbortController): Promise<void> {
        controllers.set(jobId, controller);
        let recoveryOnly = false;
        try {
            check(jobId);
            const job = row(jobId)!, value = storedPlan(job.plan_id as string)!;
            recoveryOnly = job.phase === 'recover-output';
            if (!runtime || runtime.runtimeHash !== value.manifest.runtimeHash || runtime.fontManifest.sha256 !== value.manifest.fontHash)
                throw Error('MEDIA_RUNTIME_UNAVAILABLE');
            const sources = await verifySources(value, controller.signal);
            check(jobId);
            if (!sources.ok)
                throw Error(sources.error.code);
            if (value.kind === 'render') {
                const font = await checkFontCoverage(runtime, value.timeline.subtitleCues.map(cue => cue.text).join('\n'));
                check(jobId);
                if (!font.ok)
                    throw Error(font.error.code);
                if (font.value.missing.length)
                    throw Error('FONT_GLYPH_MISSING');
            }
            const directory = join(library.root, 'temp', 'media-job-' + jobId);
            if (!recoveryOnly) {
                await mkdir(directory, { recursive: true });
                check(jobId);
                if ((await realpath(directory)).toLowerCase() !== directory.toLowerCase())
                    throw Error('INVALID_STAGING_PATH');
            }
            check(jobId);
            const space = await statfs(library.root);
            check(jobId);
            if (Number(space.bavail) * Number(space.bsize) < value.requiredFreeBytes)
                throw Error('INSUFFICIENT_SPACE');
            if (value.kind === 'derived') {
                if (recoveryOnly) await recoverDerived(jobId, value);
                else await executeDerived(jobId, value, directory, controller);
                return;
            }
            const output = join(directory, 'output.part');
            const journal = db.prepare('SELECT * FROM local_media_publication WHERE job_id=?').get(jobId);
            let finalOutput = output;
            if (journal) {
                const receipt = JSON.parse(journal.receipt_json as string) as DurableObjectReceipt;
                const durable = join(library.root, receipt.storageKey);
                if (await stat(durable).then(() => true, () => false))
                    finalOutput = durable;
                check(jobId);
            }
            else if (!(await stat(output).then(() => true, () => false))) {
                check(jobId);
                if (recoveryOnly) throw Error('LOCAL_JOB_RETRY_REQUIRED');
                const paths = await stage(jobId, value, directory);
                check(jobId);
                const encoded = await renderMedia(value, runtime, directory, paths, output, controller.signal, ticks => {
                    if (!controller.signal.aborted)
                        db.prepare('UPDATE local_media_job SET progress_ticks=MAX(progress_ticks,?) WHERE job_id=? AND state=\'RUNNING\' AND cancel_requested=0').run(Math.min(ticks, value.durationTicks), jobId);
                });
                check(jobId);
                if (!encoded.ok)
                    throw Error(encoded.error.code);
                if (value.timeline.subtitleCues.length) {
                    const font = await checkFontCoverage(runtime, value.timeline.subtitleCues.map(cue => cue.text).join('\n'));
                    check(jobId);
                    if (!font.ok || font.value.missing.length)
                        throw Error('MEDIA_FONT_INVALID');
                }
                await options.onPhase?.('rendered', jobId);
                check(jobId);
            }
            state(jobId, 'VERIFYING');
            const verified = await verifyRenderOutput(value, runtime, recoveryOnly || finalOutput !== output ? library.root : directory, finalOutput, controller.signal);
            check(jobId);
            if (!verified.ok)
                throw Error(verified.error.code);
            db.prepare('UPDATE local_media_job SET progress_ticks=? WHERE job_id=? AND cancel_requested=0').run(Math.min(value.durationTicks, verified.value.probe.durationTicks), jobId);
            if (journal && verified.value.hash !== journal.object_hash)
                throw Error('OBJECT_INTEGRITY_FAILED');
            await options.onPhase?.('verified', jobId);
            check(jobId);
            state(jobId, 'PUBLISHING');
            await publish(jobId, value, directory, finalOutput, verified.value);
        }
        catch (error) {
            const code = publicMediaError(error);
            const job = row(jobId);
            if (job && job.state !== 'SUCCEEDED') {
                const interrupted = controller.signal.aborted || recoveryOnly;
                const retryRequired = recoveryOnly && !controller.signal.aborted && !job.cancel_requested;
                state(jobId, job.cancel_requested ? 'CANCELLED' : interrupted ? 'INTERRUPTED' : 'FAILED',
                    retryRequired ? 'retry-required' : 'stopped', retryRequired ? 'LOCAL_JOB_RETRY_REQUIRED' : code);
            }
        }
        finally {
            controllers.delete(jobId);
            await queueStagingCleanup(jobId);
        }
    }
    async function recoverDerived(jobId: string, value: DerivedMediaPlan): Promise<void> {
        if (value.voiceInput || value.dialogueAlignment) {
            const output = db.prepare('SELECT 1 FROM local_media_output WHERE job_id=?').get(jobId);
            if (output) { state(jobId, 'SUCCEEDED'); return; }
            throw Error('LOCAL_JOB_RETRY_REQUIRED');
        }
        state(jobId, 'VERIFYING', 'recover-cache');
        const refs: RenderJobView['derived'] = [];
        for (const media of value.manifest.entries) {
            const wanted = media.mime.startsWith('image/') ? ['thumbnail'] : media.probe?.hasAudio ? ['proxy', 'waveform'] : ['proxy'];
            for (const kind of wanted) {
                const recipeHash = renderDigest({ recipe: value.recipeHash, kind });
                const ref = {
                    libraryId: library.libraryId,
                    cacheId: renderDigest({ sourceHash: media.hash, recipeHash, runtimeHash: value.manifest.runtimeHash }),
                    sourceHash: media.hash, recipeHash
                };
                const opened = await cacheIO.open(ref);
                if (!opened.ok) throw Error('LOCAL_JOB_RETRY_REQUIRED');
                try { check(jobId); }
                finally { await cacheIO.close(opened.value.leaseId); }
                check(jobId);
                refs.push(ref);
            }
        }
        state(jobId, 'PUBLISHING', 'recover-cache');
        transaction(() => {
            check(jobId);
            for (const ref of refs)
                db.prepare('INSERT OR IGNORE INTO local_media_derived_output VALUES(?,?,?)').run(jobId, ref.cacheId, JSON.stringify(ref));
            state(jobId, 'SUCCEEDED');
            return ok(undefined);
        });
    }
    async function executeDerived(jobId: string, value: DerivedMediaPlan, directory: string, controller: AbortController): Promise<void> {
        const inputs = await stage(jobId, value, directory);
        check(jobId);
        const cacheRoot = join(library.root, 'cache', 'media');
        await mkdir(cacheRoot, {
            recursive: true
        });
        check(jobId);
        if ((await realpath(cacheRoot)).toLowerCase() !== cacheRoot.toLowerCase())
            throw Error('INVALID_STORAGE_KEY');
        check(jobId);
        for (let index = 0; index < value.manifest.entries.length; index++) {
            const media = value.manifest.entries[index]!;
            const wanted = media.mime.startsWith('image/') ? ['thumbnail'] : media.probe?.hasAudio ? ['proxy', 'waveform'] : ['proxy'];
            const refs: RenderJobView['derived'] = [];
            let cached = true;
            for (const kind of wanted) {
                const recipeHash = renderDigest({
                    recipe: value.recipeHash, kind
                });
                const cacheId = renderDigest({
                    sourceHash: media.hash, recipeHash, runtimeHash: value.manifest.runtimeHash
                });
                const ref = {
                    libraryId: library.libraryId, cacheId, sourceHash: media.hash, recipeHash
                };
                const opened = await cacheIO.open(ref);
                check(jobId);
                if (!opened.ok) {
                    cached = false;
                    break;
                }
                await cacheIO.close(opened.value.leaseId);
                check(jobId);
                refs.push(ref);
            }
            if (!cached) {
                refs.length = 0;
                const workRoot = join(directory, 'derived-' + index);
                await mkdir(workRoot, {
                    recursive: true
                });
                check(jobId);
                // Native compiler inputs are required to remain inside its exact staging root.
                const source = join(workRoot, 'source.part');
                const sourceInput = await open(inputs[index]!, 'r');
                try {
                    check(jobId);
                    const sourceOutput = await open(source, 'w', 0o600);
                    try {
                        check(jobId);
                        const buffer = Buffer.allocUnsafe(1024 * 1024);
                        for (;;) {
                            const chunk = await sourceInput.read(buffer);
                            check(jobId);
                            if (!chunk.bytesRead)
                                break;
                            await sourceOutput.writeFile(buffer.subarray(0, chunk.bytesRead));
                            check(jobId);
                        }
                        await sourceOutput.sync();
                        check(jobId);
                    }
                    finally {
                        await sourceOutput.close();
                    }
                }
                finally {
                    await sourceInput.close();
                }
                if (value.dialogueAlignment) {
                    const output = join(workRoot, 'aligned.wav');
                    const aligned = await alignDialogueMedia({ runtime: runtime!, video: source, audio: inputs[1]!, output, stagingRoot: directory, startTicks: value.dialogueAlignment.startTicks, durationTicks: value.dialogueAlignment.durationTicks,signal:controller.signal });
                    if (!aligned.ok) throw Error(aligned.error.code);
                    check(jobId);
                    const probe = await probeMediaFile(runtime!, output, workRoot, aligned.value.hash, controller.signal);
                    if (!probe.ok) throw Error(probe.error.code);
                    const size = (await stat(output)).size;
                    await publish(jobId, value, workRoot, output, { hash: aligned.value.hash, byteLength: size, mime: 'audio/wav', width: 0, height: 0, probe: probe.value });
                    return;
                }
                if (value.voiceInput) {
                    const output = join(workRoot, 'prepared.wav');
                    const prepared = await prepareVoiceInput({ runtime: runtime!, input: source, output, stagingRoot: workRoot, sourceInTicks: value.voiceInput.sourceInTicks, durationTicks: value.voiceInput.durationTicks, signal: controller.signal });
                    if (!prepared.ok) throw Error(prepared.error.code);
                    check(jobId);
                    const probe = await probeMediaFile(runtime!, output, workRoot, prepared.value.hash, controller.signal);
                    if (!probe.ok) throw Error(probe.error.code);
                    await publish(jobId, value, workRoot, output, { hash: prepared.value.hash, byteLength: prepared.value.byteLength, mime: prepared.value.mime, width: 0, height: 0, probe: probe.value });
                    return;
                }
                const results = await buildDerived(value, media, runtime!, workRoot, source, controller.signal, ticks => {
                    if (!controller.signal.aborted)
                        db.prepare('UPDATE local_media_job SET progress_ticks=? WHERE job_id=? AND cancel_requested=0').run(ticks, jobId);
                });
                check(jobId);
                state(jobId, 'VERIFYING', 'verify-cache');
                for (const result of results) {
                    const recipeHash = renderDigest({
                        recipe: value.recipeHash, kind: result.kind
                    });
                    const cacheId = renderDigest({
                        sourceHash: media.hash, recipeHash, runtimeHash: value.manifest.runtimeHash
                    });
                    const hashed = await hashMediaFile(result.path, 256 * 1024 ** 2, controller.signal);
                    check(jobId);
                    if (!hashed.ok)
                        throw Error(hashed.error.code);
                    const storageKey = 'cache/media/' + cacheId + '.media';
                    await unlink(join(library.root, storageKey)).catch(() => undefined);
                    check(jobId);
                    await rename(result.path, join(library.root, storageKey));
                    check(jobId);
                    const recheck = await hashMediaFile(join(library.root, storageKey), 256 * 1024 ** 2, controller.signal);
                    check(jobId);
                    if (!recheck.ok || recheck.value.hash !== hashed.value.hash)
                        throw Error('CACHE_CORRUPT');
                    state(jobId, 'PUBLISHING', 'publish-cache');
                    transaction(() => {
                        check(jobId);
                        db.prepare('INSERT INTO media_cache(cache_id,source_hash,recipe_hash,runtime_hash,storage_key,byte_length,created_at,last_used_at,hash,mime,kind,extra_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cache_id) DO UPDATE SET byte_length=excluded.byte_length,last_used_at=excluded.last_used_at,hash=excluded.hash,mime=excluded.mime,kind=excluded.kind,extra_json=excluded.extra_json').run(cacheId, media.hash, recipeHash, value.manifest.runtimeHash, storageKey, hashed.value.byteLength, Date.now(), Date.now(), hashed.value.hash, result.mime, result.kind, JSON.stringify(result.extra ?? null));
                        db.prepare('INSERT OR IGNORE INTO local_media_cache_lease VALUES(?,?)').run(value.planId, cacheId);
                        return ok(undefined);
                    });
                    refs.push({
                        libraryId: library.libraryId, cacheId, sourceHash: media.hash, recipeHash
                    });
                }
            }
            transaction(() => {
                check(jobId);
                for (const ref of refs)
                    db.prepare('INSERT OR IGNORE INTO local_media_derived_output VALUES(?,?,?)').run(jobId, ref.cacheId, JSON.stringify(ref));
                return ok(undefined);
            });
        }
        check(jobId);
        state(jobId, 'SUCCEEDED');
        const cleanup = await reclaimCache();
        if (!cleanup.ok || cleanup.value.failedCacheIds.length)
            db.prepare("UPDATE local_media_job SET error_code='CACHE_CLEANUP_PENDING' WHERE job_id=?").run(jobId);
    }
    async function reclaimCache(maxBytes = 5 * 1024 ** 3): Promise<Result<{
        removedBytes: number;
        remainingBytes: number;
        failedCacheIds: string[];
    }>> {
        const own = library.checkOwnership();
        if (!own.ok)
            return own;
        const failedCacheIds: string[] = [];
        let removedBytes = 0;
        const candidates = db.prepare("SELECT * FROM media_cache c WHERE c.byte_length>0 AND NOT EXISTS(SELECT 1 FROM local_media_cache_lease l JOIN render_plan p ON p.plan_id=l.plan_id WHERE l.cache_id=c.cache_id AND (p.expires_at>? OR EXISTS(SELECT 1 FROM local_media_job j WHERE j.plan_id=p.plan_id AND j.state NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')))) ORDER BY last_used_at").all(Date.now());
        let bytes = Number(db.prepare('SELECT COALESCE(SUM(byte_length),0) AS bytes FROM media_cache').get()!.bytes);
        for (const cache of candidates) {
            if (bytes <= maxBytes)
                break;
            if (!/^[a-f0-9]{64}$/.test(String(cache.cache_id)) || cache.storage_key !== 'cache/media/' + cache.cache_id + '.media')
                continue;
            if (cacheIO.isHeld(String(cache.cache_id)))
                continue;
            const removed = await unlink(join(library.root, String(cache.storage_key))).then(() => true, error => (error as NodeJS.ErrnoException).code === 'ENOENT');
            const current = library.checkOwnership();
            if (!current.ok)
                return current;
            if (!removed) {
                failedCacheIds.push(String(cache.cache_id));
                continue;
            }
            // Historical result references survive eviction and explicitly report cache missing.
            db.prepare('UPDATE media_cache SET byte_length=0,hash=NULL WHERE cache_id=?').run(String(cache.cache_id));
            bytes -= Number(cache.byte_length);
            removedBytes += Number(cache.byte_length);
        }
        return ok({
            removedBytes, remainingBytes: bytes, failedCacheIds
        });
    }
    function recover(): void {
        transaction(() => {
            db.exec("UPDATE local_media_job SET state=CASE WHEN cancel_requested=1 THEN 'CANCELLED' ELSE 'INTERRUPTED' END,phase='interrupted',needs_resume=CASE WHEN cancel_requested=1 THEN 0 ELSE 1 END,lease_owner=NULL WHERE state IN ('RUNNING','VERIFYING','PUBLISHING'); UPDATE local_media_job SET needs_resume=1 WHERE state IN ('QUEUED','INTERRUPTED'); UPDATE local_media_attempt SET state=(SELECT state FROM local_media_job j WHERE j.job_id=local_media_attempt.job_id) WHERE state IN ('RUNNING','VERIFYING','PUBLISHING')");
            return ok(undefined);
        });
    }
    function claim(): string | undefined {
        if (!library.checkOwnership().ok)
            return;
        const claimed = transaction(() => {
            if (db.prepare("SELECT 1 FROM local_media_job WHERE state IN ('RUNNING','VERIFYING','PUBLISHING') AND lease_owner IS NOT NULL").get())
                return ok(undefined);
            const job = db.prepare("SELECT job_id FROM local_media_job WHERE state='QUEUED' AND needs_resume=0 AND cancel_requested=0 ORDER BY created_at,rowid LIMIT 1").get();
            if (!job)
                return ok(undefined);
            db.prepare("UPDATE local_media_job SET state='RUNNING',phase=CASE WHEN phase='recover-output' THEN phase ELSE 'staging' END,lease_owner=? WHERE job_id=?").run(library.instanceId, String(job.job_id));
            db.prepare("UPDATE local_media_attempt SET state='RUNNING',started_at=COALESCE(started_at,?) WHERE job_id=?").run(Date.now(), String(job.job_id));
            return ok(job.job_id as string);
        });
        return claimed.ok ? claimed.value : undefined;
    }
    return {
        async inspectMedia(input:InspectMediaInput):Promise<Result<ResolvedMedia>> {
            if(db.isTransaction)return fail('MEDIA_PREFLIGHT','媒体分析不能在数据库事务中运行。');
            const parsed=parseInspectMedia(input);if(!parsed.ok)return parsed;
            const own=project(input.projectId);if(!own.ok)return own;
            const metadata=assets.assertSelectable(input.reference);if(!metadata.ok)return metadata;
            const av=metadata.value.mime==='video/mp4'||metadata.value.mime.startsWith('audio/');
            if(!av&&!metadata.value.mime.startsWith('image/'))return fail('UNSUPPORTED_MEDIA','请选择图片、视频或声音。');
            const probe=av?await mediaInfo.ensure(input.reference):ok(null);if(!probe.ok)return probe;
            const final=assets.assertSelectable(input.reference);if(!final.ok)return final;
            if(JSON.stringify(final.value)!==JSON.stringify(metadata.value))return fail('REFERENCE_CHANGED','媒体在分析时改变。');
            const result={ref:input.reference,...final.value,probe:probe.value};
            return isResolvedMedia(result)?ok(result):fail('INVALID_STORED_DATA','媒体分析数据无效。');
        },
        inspectPrepare, inspectDerived, savePrepared, plan, read, list, cancel, resume, retry, recover, claim, execute,
        cleanupTerminalStaging, drainStagingCleanup,
        prepare: async (input: PrepareRenderInput) => { const value = await inspectPrepare(input); return value.ok ? savePrepared(value.value) : value; },
        prepareDerived: async (input: PrepareDerivedInput) => { const value = await inspectDerived(input); return value.ok ? savePrepared(value.value) : value; },
        enqueue: (input: EnqueueRenderInput) => approve(input, 'render'),
        enqueueDerived: (input: EnqueueRenderInput) => approve(input, 'derived'),
        derived(input: {
            projectId: string;
            planId: string;
        }): Result<DerivedMediaView> {
            const value = plan(input);
            if (!value.ok)
                return value;
            if (value.value.kind !== 'derived')
                return fail('WRONG_PLAN_KIND', '此计划不是派生媒体计划。');
            const snapshot = list(input);
            if (!snapshot.ok)
                return snapshot;
            const jobs = snapshot.value.jobs.filter(job => job.planId === input.planId);
            const outputs=jobs.flatMap(job=>job.derived);
            const entries:DerivedMediaEntry[]=outputs.flatMap(ref=>{
                const cache=db.prepare('SELECT kind,mime,byte_length,hash FROM media_cache WHERE cache_id=? AND source_hash=? AND recipe_hash=? AND runtime_hash=?').get(ref.cacheId,ref.sourceHash,ref.recipeHash,value.value.manifest.runtimeHash);
                if(!cache||Number(cache.byte_length)<=0||typeof cache.hash!=='string')return [];
                const entry={ref,kind:cache.kind,mime:cache.mime};return isDerivedMediaEntry(entry)?[entry]:[];
            });
            return ok({
                libraryId: library.libraryId, projectId: input.projectId, planId: input.planId, jobs, outputs, entries, recipe:{fps:value.value.fps,canvas:value.value.canvas,videoFit:value.value.videoFit??'contain'}
            });
        },
        setWake(callback: () => void) { wake = callback; },
        openDerivedMediaRead: cacheIO.open,
        readDerivedMediaRange: cacheIO.read,
        closeDerivedMediaRead: cacheIO.close,
        closeDerivedMediaReads: cacheIO.dispose,
        reclaimCache,
    };
}
