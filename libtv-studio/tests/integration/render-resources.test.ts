import { afterEach, expect, it, vi } from 'vitest';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setupRender } from './render-fixtures.ts';
import { cleanup, command, create, image, unwrap } from './timeline-fixtures.ts';
import { queryOutputValidators } from '../../packages/contracts/src/queries.ts';
const disk = vi.hoisted(() => ({
    full: false, cleanupDenied: false
}));
vi.mock('node:fs/promises', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:fs/promises')>();
    return {
        ...original, statfs: async (...args: Parameters<typeof original.statfs>) => disk.full ? {
            bavail: 0, bsize: 4096
        } : original.statfs(...args),
        rm: async (...args: Parameters<typeof original.rm>) => {
            if (disk.cleanupDenied && String(args[0]).includes('media-job-'))
                throw Object.assign(Error('EPERM: private cleanup path ' + args[0]), { code: 'EPERM' });
            return original.rm(...args);
        }
    };
});
afterEach(async () => { disk.full = false; disk.cleanupDenied = false; await cleanup(); });
async function fixture(localMedia?: import('../../packages/engine/src/render-service.ts').LocalMediaOptions) {
    const context = await setupRender(localMedia), { e, root, projectId } = context;
    const ref = await image(e, root), metadata = unwrap(e.assets.metadata(ref));
    unwrap(await e.commands.execute(command(e, 'timeline.create', create(projectId))));
    unwrap(await e.commands.execute(command(e, 'timeline.applyOps', {
        projectId, timelineId: 'cut', expectedRevision: 1, operations: [{
                kind: 'insert', clip: {
                    id: 'image', kind: 'image', media: ref, sourceHash: metadata.hash, sourceProbeId: null, sourceInTicks: 0, startTicks: 0, durationTicks: 4800, fit: 'contain', gainMilli: 1000, mute: true
                }
            }]
    })));
    const input = {
        timelineRef: {
            libraryId: e.identity.libraryId, projectId, id: 'cut', revision: 2
        }, purpose: 'mp4' as const, executionOwner: 'user', runId: 'run'
    };
    return {
        ...context, input
    };
}
it('persists stable filesystem error codes that remain valid in read and list transport', async () => {
    const { e, input, root, projectId } = await fixture();
    const plan = unwrap(await e.renders.prepare(input));
    const job = unwrap(e.renders.enqueue({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    }));
    await mkdir(join(root, 'temp'), { recursive: true });
    const staging = join(root, 'temp', 'media-job-' + job.jobId);
    await writeFile(staging, 'blocks staging mkdir');
    e.renderScheduler.start();
    await e.renderScheduler.drain();
    const view = unwrap(e.renders.read({ projectId, jobId: job.jobId }));
    expect(view).toMatchObject({ state: 'FAILED', errorCode: 'MEDIA_FILE_INVALID', outputRef: null });
    expect(JSON.stringify(view)).not.toContain(root);
    expect(queryOutputValidators['render.read'](view)).toBe(true);
    expect(queryOutputValidators['render.list'](unwrap(e.renders.list({ projectId })))).toBe(true);
    await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('keeps published output valid when owned staging cleanup is denied, then reclaims the leftover', async () => {
    const { e, input, root, projectId } = await fixture();
    const plan = unwrap(await e.renders.prepare(input));
    const job = unwrap(e.renders.enqueue({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    }));
    disk.cleanupDenied = true;
    e.renderScheduler.start();
    await e.renderScheduler.drain();
    const view = unwrap(e.renders.read({ projectId, jobId: job.jobId }));
    expect(view).toMatchObject({ state: 'SUCCEEDED', phase: 'cleanup-pending', errorCode: 'STAGING_CLEANUP_PENDING' });
    expect(queryOutputValidators['render.read'](view)).toBe(true);
    const latest = () => {
        const db = new DatabaseSync(join(root, 'library.sqlite'));
        try {
            return JSON.parse(String(db.prepare("SELECT payload_json FROM domain_event WHERE kind='render.changed' ORDER BY seq DESC LIMIT 1").get()!.payload_json));
        } finally { db.close(); }
    };
    expect(latest()).toMatchObject({ state: 'SUCCEEDED', phase: 'cleanup-pending', errorCode: 'STAGING_CLEANUP_PENDING' });
    const original = unwrap(await e.assets.openMediaRead(view.outputRef!));
    await e.assets.closeMediaRead(original.leaseId);
    const staging = join(root, 'temp', 'media-job-' + job.jobId);
    expect((await stat(staging)).isDirectory()).toBe(true);
    disk.cleanupDenied = false;
    await e.renders.cleanupTerminalStaging();
    await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(unwrap(e.renders.read({ projectId, jobId: job.jobId }))).toMatchObject({ state: 'SUCCEEDED', phase: 'succeeded', errorCode: null });
    expect(latest()).toMatchObject({ state: 'SUCCEEDED', phase: 'succeeded', errorCode: null });
});
it('rejects low disk budgets, real missing glyph coverage, and disk exhaustion at job execution', async () => {
    const { e, input, projectId } = await fixture();
    const plan = unwrap(await e.renders.prepare(input));
    const approval = {
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    };
    expect(e.renders.enqueue({
        ...approval, diskBudgetBytes: plan.requiredFreeBytes - 1
    })).toMatchObject({
        ok: false, error: {
            code: 'DISK_BUDGET_REQUIRED'
        }
    });
    const job = unwrap(e.renders.enqueue(approval));
    disk.full = true;
    e.renderScheduler.start();
    await e.renderScheduler.drain();
    expect(unwrap(e.renders.read({
        projectId, jobId: job.jobId
    }))).toMatchObject({
        state: 'FAILED', errorCode: 'INSUFFICIENT_SPACE', outputRef: null
    });
    expect(await e.renders.prepare({
        ...input, runId: 'low-disk'
    })).toMatchObject({
        ok: false, error: {
            code: 'INSUFFICIENT_SPACE'
        }
    });
    disk.full = false;
    unwrap(await e.commands.execute(command(e, 'timeline.applyOps', {
        projectId, timelineId: 'cut', expectedRevision: 2, operations: [{
                kind: 'setCue', cue: {
                    id: 'unsupported', startTicks: 0, endTicks: 1600, text: '\u{10ffff}'
                }
            }]
    })));
    expect(await e.renders.prepare({
        ...input, timelineRef: {
            ...input.timelineRef, revision: 3
        }
    })).toMatchObject({
        ok: false, error: {
            code: 'FONT_GLYPH_MISSING'
        }
    });
});
it('pause waits for the active boundary and prevents another job; snapshots retain only complete local objects and journals', async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    let first = true;
    const { e, input, projectId, root } = await fixture({
        onPhase: async (phase) => { if (phase === 'rendered' && first) {
            first = false;
            entered();
            await gate;
        } }
    });
    const plan = unwrap(await e.renders.prepare(input)), second = unwrap(await e.renders.prepare({
        ...input, purpose: 'preview', runId: 'second'
    }));
    const one = unwrap(e.renders.enqueue({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'run', diskBudgetBytes: plan.requiredFreeBytes
    }));
    const two = unwrap(e.renders.enqueue({
        planId: second.planId, planHash: second.planHash, executionOwner: 'user', runId: 'second', diskBudgetBytes: second.requiredFreeBytes
    }));
    e.renderScheduler.start();
    await started;
    const pausing = e.renderScheduler.pause();
    release();
    await pausing;
    e.renderScheduler.wake();
    await e.renderScheduler.drain();
    expect(unwrap(e.renders.read({
        projectId, jobId: one.jobId
    })).state).toBe('SUCCEEDED');
    expect(unwrap(e.renders.read({
        projectId, jobId: two.jobId
    })).state).toBe('QUEUED');
    const snapshot = unwrap(await e.maintenance.snapshot());
    const manifest = JSON.parse(await readFile(join(root, 'backups', snapshot.snapshotId + '.json'), 'utf8'));
    expect(manifest.localMedia).toHaveLength(1);
    expect(manifest.localMediaJournal).toHaveLength(1);
    expect(JSON.stringify(manifest)).not.toContain('output.part');
    await e.renderScheduler.drain();
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    expect(() => db.prepare("UPDATE render_plan SET data_json='{}' WHERE plan_id=?").run(plan.planId)).toThrow(/immutable local plan/);
    expect(() => db.prepare("UPDATE local_media_output SET version=2 WHERE job_id=?").run(one.jobId)).toThrow(/immutable local output/);
    db.close();
});
it('normalizes explicit audio-derived work and publishes at most 60 waveform buckets per second', async () => {
    const { e, root, projectId, runtime } = await setupRender(), path = join(root, 'tone.wav');
    const made = spawnSync(runtime.ffmpegPath, [
        '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.2', '-c:a', 'pcm_s16le', path
    ], {
        shell: false, windowsHide: true, encoding: 'utf8'
    });
    expect(made.status, made.stderr).toBe(0);
    const facts = await stat(path);
    unwrap(e.assets.registerGrant({
        grantId: 'tone', importId: 'tone', libraryId: e.identity.libraryId, expiresAt: Date.now() + 60000, files: [{
                path, realPath: path, allowedRoot: root, name: 'tone.wav', size: facts.size, mtimeMs: facts.mtimeMs, dev: facts.dev, ino: facts.ino
            }]
    }));
    const ref = (unwrap(await e.commands.execute(command(e, 'asset.importGrantedFiles', {
        grantId: 'tone'
    }))).result as import('../../packages/contracts/src/assets.ts').ImportRef).versions[0]!;
    const probe = unwrap(await e.mediaInfo.ensure(ref));
    const plan = unwrap(await e.renders.prepareDerived({
        projectId, references: [ref], fps: {
            num: 30, den: 1
        }, canvas: {
            width: 1080, height: 1080
        }, executionOwner: 'user', runId: 'waveform'
    }));
    const job = unwrap(e.renders.enqueueDerived({
        planId: plan.planId, planHash: plan.planHash, executionOwner: 'user', runId: 'waveform', diskBudgetBytes: plan.requiredFreeBytes
    }));
    e.renderScheduler.start();
    await e.renderScheduler.drain();
    const result = unwrap(e.renders.read({
        projectId, jobId: job.jobId
    }));
    expect(result).toMatchObject({
        state: 'SUCCEEDED', outputRef: null
    });
    expect(result.derived).toHaveLength(2);
    let buckets = 0;
    for (const derived of result.derived) {
        const lease = unwrap(await e.renders.openDerivedMediaRead(derived));
        if (lease.mime === 'application/json') {
            const data = unwrap(await e.renders.readDerivedMediaRange({
                leaseId: lease.leaseId, offset: 0, length: 1024 * 1024
            }));
            const waveform = JSON.parse(Buffer.from(data.bytes).toString());
            expect(waveform.bucketRate).toBe(60);
            buckets = waveform.peaks.length;
            expect(waveform.peaks.some((peak: number) => peak > 0)).toBe(true);
        }
        await e.renders.closeDerivedMediaRead(lease.leaseId);
    }
    expect(buckets).toBe(12);
    const before = unwrap(e.renders.derived({
        projectId, planId: plan.planId
    }));
    expect(before.outputs).toHaveLength(2);
    await writeFile(join(root, 'cache', 'media', result.derived[0]!.cacheId + '.media'), 'bad');
    expect(await e.renders.openDerivedMediaRead(result.derived[0]!)).toMatchObject({
        ok: false
    });
    const picture = await image(e, root), pictureInfo = unwrap(e.assets.metadata(picture)), audioInfo = unwrap(e.assets.metadata(ref));
    unwrap(await e.commands.execute(command(e, 'timeline.create', create(projectId))));
    unwrap(await e.commands.execute(command(e, 'timeline.applyOps', {
        projectId, timelineId: 'cut', expectedRevision: 1, operations: [
            {
                kind: 'insert', clip: {
                    id: 'picture', kind: 'image', media: picture, sourceHash: pictureInfo.hash, sourceProbeId: null, sourceInTicks: 0, startTicks: 0, durationTicks: 9600, fit: 'contain', gainMilli: 1000, mute: true
                }
            },
            {
                kind: 'insert', clip: {
                    id: 'audio', kind: 'audio', track: 'voice', media: ref, sourceHash: audioInfo.hash, sourceProbeId: probe.probeId, sourceInTicks: 0, startTicks: 0, durationTicks: 9600, gainMilli: 1000, mute: false
                }
            },
        ]
    })));
    const frozen = {
        libraryId: e.identity.libraryId, projectId, id: 'cut', revision: 2
    };
    const mp4 = unwrap(await e.renders.prepare({
        timelineRef: frozen, purpose: 'mp4', executionOwner: 'user', runId: 'mp4'
    })), wav = unwrap(await e.renders.prepare({
        timelineRef: frozen, purpose: 'wav', executionOwner: 'user', runId: 'wav'
    }));
    expect(mp4.compositionHash).toBe(wav.compositionHash);
    expect(mp4.planHash).not.toBe(wav.planHash);
    const movie = unwrap(e.renders.enqueue({
        planId: mp4.planId, planHash: mp4.planHash, executionOwner: 'user', runId: 'mp4', diskBudgetBytes: mp4.requiredFreeBytes
    }));
    unwrap(e.renders.cancel({
        jobId: movie.jobId, executionOwner: 'user'
    }));
    const soundtrack = unwrap(e.renders.enqueue({
        planId: wav.planId, planHash: wav.planHash, executionOwner: 'user', runId: 'wav', diskBudgetBytes: wav.requiredFreeBytes
    }));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await e.renderScheduler.drain();
    expect(unwrap(e.renders.read({
        projectId, jobId: movie.jobId
    })).state).toBe('CANCELLED');
    expect(unwrap(e.renders.read({
        projectId, jobId: soundtrack.jobId
    }))).toMatchObject({
        state: 'SUCCEEDED', attempt: 1
    });
    const retry = unwrap(e.renders.retry({
        jobId: movie.jobId, executionOwner: 'user', runId: 'movie-retry'
    }));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await e.renderScheduler.drain();
    expect(unwrap(e.renders.read({
        projectId, jobId: retry.jobId
    }))).toMatchObject({
        state: 'SUCCEEDED', attempt: 2
    });
    expect(unwrap(e.renders.read({
        projectId, jobId: soundtrack.jobId
    }))).toMatchObject({
        state: 'SUCCEEDED', attempt: 1
    });
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM generation_task').get()!.n).toBe(0);
    db.close();
});
