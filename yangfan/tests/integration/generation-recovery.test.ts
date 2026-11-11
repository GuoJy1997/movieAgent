import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, stat, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';
import { imageProviderServer } from '../fixtures/image-provider-server';
const roots: string[] = [], engines: EngineHandle[] = [], servers: Awaited<ReturnType<typeof imageProviderServer>>[] = [];
const execute = (engine: EngineHandle, kind: string, payload: unknown, commandId: string = crypto.randomUUID()) => engine.commands.execute({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'client', commandId, kind, payload });
function value(result: any): any { expect(result).toMatchObject({ ok: true }); return result.value?.result ?? result.value; }
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'libtv-generation-')); roots.push(root); const server = await imageProviderServer(); servers.push(server);
  let now = Date.now(); let currentInput = true; let capacity = true; let reconcileSupported = false; let remoteOutput = false; let unavailableOutput = false;
  const path = join(root, 'result.png'); await writeFile(path, await sharp({ create: { width: 10, height: 5, channels: 3, background: '#ed3212' } }).png().toBuffer());
  server.setImage(await readFile(path));
  const info = await stat(path); const sourceRef = { path, realPath: await realpath(path), allowedRoot: root, name: 'result.png', size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino };
  const adapter = { adapterId: 'fixture-v1', validate: (request: any) => ({ ok: true, value: request }), async submit(_request: any, context: any) { try { const response = await fetch(server.url, { method: 'POST', body: JSON.stringify({ clientRequestId: context.clientRequestId }) }); const outcome = await response.json() as any; return outcome.kind === 'completed' ? unavailableOutput ? { ...outcome, output: { kind: 'unavailable', reason: 'inline spool failed' } } : remoteOutput ? { ...outcome, output: { kind: 'url', url: `${server.url}/result` } } : { ...outcome, sourceRef } : outcome; } catch { return { kind: 'unknown' }; } }, async reconcile(request: any) { if (!reconcileSupported) return { kind: 'unsupported' }; const response = await fetch(`${server.url}/jobs/${request.providerTaskId ?? request.clientRequestId}`); const outcome = await response.json() as any; return outcome.kind === 'completed' ? unavailableOutput ? { ...outcome, output: { kind: 'unavailable', reason: 'inline spool failed' } } : remoteOutput ? { ...outcome, output: { kind: 'url', url: `${server.url}/result` } } : { ...outcome, sourceRef } : outcome; } };
  const options: any = { root, generation: { adapter, context: {}, now: () => now, inputCurrent: () => currentInput, materializeOutput: async (output: any) => { const response = await fetch(output.url); if (!response.ok) return { ok: false, error: { code: 'OUTPUT_DOWNLOAD_FAILED', message: 'fixture HTTP failure' } }; const downloaded = join(root, 'download.png'); await writeFile(downloaded, Buffer.from(await response.arrayBuffer())); const info = await stat(downloaded); return { ok: true, value: { path: downloaded, realPath: await realpath(downloaded), allowedRoot: root, name: 'download.png', size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino } }; }, dispatchCapacity: async () => capacity } };
  async function open() { const engine = value(await startEngine(options)); engines.push(engine); return engine as EngineHandle & { generation: any; scheduler: any }; }
  const engine = await open(); const lib = engine.identity.libraryId;
  value(await execute(engine, 'project.create', { name: 'Fixture' }, 'project'));
  const projectId = value(await execute(engine, 'project.create', { name: 'Generation' })).id;
  value(await execute(engine, 'provider.saveConnection', { id: 'c', expectedRevision: 0, name: 'Fixture', adapterType: 'openai-image-v1', baseUrl: server.url, credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: { hostname: '127.0.0.1', port: Number(new URL(server.url).port), purpose: 'model-api' } }, timeoutMs: 1000, concurrency: 2 }));
  const model = { id: 'm', expectedRevision: 0, name: 'Fixture', modelId: 'dummy', connectionRef: { libraryId: lib, id: 'c', revision: 1 }, capabilities: { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } };
  value(await execute(engine, 'model.saveDefinition', model)); value(await execute(engine, 'profile.save', { id: 'p', expectedRevision: 0, name: 'Fixture', modelRef: { libraryId: lib, id: 'm', revision: 1 }, parameters: {} }));
  const prepare = async (target = engine) => value(await execute(target, 'generation.prepare', { projectId, profileRef: { libraryId: lib, id: 'p', revision: 1 }, prompt: 'a fixture tree', inputVersion: 'text-v1', executionOwner: 'human', runId: 'run-1' }));
  const approval = (prepared: any, extra = {}) => ({ preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, currency: 'USD', allowanceMicros: 700000, budgetLimitMicros: 1000000, acknowledgeUnknown: true, executionOwner: 'human', runId: 'run-1', ...extra });
  const enqueue = async (target = engine) => value(await execute(target, 'generation.approveAndEnqueue', approval(await prepare(target))));
  return { engine, root, server, prepare, approval, enqueue, open, model, setNow: (n: number) => { now = n; }, advance: () => { now += 600000; }, staleInput: () => { currentInput = false; }, unavailableOutput: () => { unavailableOutput = true; }, remoteOutput: () => { remoteOutput = true; }, supportReconcile: () => { reconcileSupported = true; }, restoreCapacity: () => { capacity = true; }, noCapacity: () => { capacity = false; } };
}
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); for (const e of engines.splice(0)) await e.close(); for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
// Removing prepared authorization consumption would create two paid intentions.
it('deduplicates repeated approvals and rejects different allowance for the same approval', async () => {
  const s = await setup(), prepared = await s.prepare(), input = s.approval(prepared);
  const first = value(await execute(s.engine, 'generation.approveAndEnqueue', input));
  expect(value(await execute(s.engine, 'generation.approveAndEnqueue', input))).toEqual(first);
  expect(await execute(s.engine, 'generation.approveAndEnqueue', { ...input, allowanceMicros: 1 })).toMatchObject({ ok: false, error: { code: 'APPROVAL_REUSED' } });
  expect(s.engine.generation.list().tasks).toHaveLength(1); expect(s.server.posts).toBe(0);
});
it('atomically reserves project budget under concurrent approvals and keeps unknown estimates distinct from zero', async () => {
  const s = await setup(), a = await s.prepare(), b = await s.prepare();
  const results = await Promise.all([execute(s.engine, 'generation.approveAndEnqueue', s.approval(a)), execute(s.engine, 'generation.approveAndEnqueue', s.approval(b))]);
  expect(results.filter(r => r.ok)).toHaveLength(1); expect(results.find(r => !r.ok)).toMatchObject({ error: { code: 'BUDGET_EXCEEDED' } });
  const task = s.engine.generation.list().tasks[0]; expect(task).toMatchObject({ estimateMicros: null, reportedActualMicros: null, reservationMicros: 700000, currency: 'USD', settlementStatus: 'unknown' });
});
it('rejects altered plan, expired approval, stale input and changed quote/config before any POST', async () => {
  const s = await setup(), p = await s.prepare();
  expect(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(p, { approvedPlanHash: '0'.repeat(64) }))).toMatchObject({ ok: false, error: { code: 'APPROVAL_MISMATCH' } });
  expect(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(p, { allowanceMicros: Infinity }))).toMatchObject({ ok: false });
  const task = value(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(p))); s.staleInput();
  expect(await s.engine.scheduler.run(task.attemptId)).toMatchObject({ ok: false, error: { code: 'INPUT_CHANGED' } }); expect(s.server.posts).toBe(0);
});
it('checks expiration and configuration again at dispatch', async () => {
  const s = await setup(), task = await s.enqueue(); s.advance();
  expect(await s.engine.scheduler.run(task.attemptId)).toMatchObject({ ok: false, error: { code: 'APPROVAL_EXPIRED' } }); expect(s.server.posts).toBe(0);
  const s2 = await setup(), t2 = await s2.enqueue(); value(await execute(s2.engine, 'model.saveDefinition', { ...s2.model, expectedRevision: 1, pricing: { status: 'configured', currency: 'USD', perImage: 1, version: 'price-2' } }));
  expect(await s2.engine.scheduler.run(t2.attemptId)).toMatchObject({ ok: false, error: { code: 'CONFIG_CHANGED' } }); expect(s2.server.posts).toBe(0);
});
it('persists submit intent before a single POST and preserves disconnect unknown across restart and lease expiry', async () => {
  const s = await setup(), task = await s.enqueue(); s.server.setMode('disconnect');
  value(await s.engine.scheduler.run(task.attemptId)); expect(s.server.posts).toBe(1);
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ providerState: 'unknown', state: 'SUBMISSION_UNKNOWN', reservationMicros: 700000 });
  await s.engine.close(); const reopened = await s.open(); s.advance();
  value(await reopened.scheduler.recover()); value(await reopened.scheduler.run(task.attemptId)); value(await execute(reopened, 'task.reconcile', { taskId: task.taskId }));
  expect(s.server.posts).toBe(1); expect(value(reopened.generation.read(task.taskId))).toMatchObject({ state: 'RECONCILE_REQUIRED', reconcileStatus: 'unsupported' });
});
it('never submits a persisted intent after crash before sending and fences a stale worker response into facts', async () => {
  const s = await setup(), task = await s.enqueue(); const lease = value(s.engine.scheduler.claim(task.attemptId));
  const permit = value(await s.engine.generation.acquireDispatch(task.attemptId, lease.leaseToken)); expect(permit.clientRequestId).toBeTruthy();
  await s.engine.close(); const reopened = await s.open(); s.advance(); value(await reopened.scheduler.recover()); value(await reopened.scheduler.run(task.attemptId)); expect(s.server.posts).toBe(0);
  expect(reopened.generation.recordOutcome(task.attemptId, lease.leaseToken, { kind: 'accepted', providerTaskId: 'late-job' }, 'fixture-v1')).toMatchObject({ ok: false, error: { code: 'STALE_LEASE' } });
  const db = new DatabaseSync(join(s.root, 'library.sqlite')); expect(db.prepare('SELECT * FROM generation_fact').all()).toHaveLength(1); db.close();
});
it('recovers the original provider job without resubmission after accepted response', async () => {
  const s = await setup(), task = await s.enqueue(); value(await s.engine.scheduler.run(task.attemptId)); await s.engine.close();
  const reopened = await s.open(); value(await reopened.scheduler.recover()); value(await reopened.scheduler.run(task.attemptId)); expect(s.server.posts).toBe(1);
  expect(value(reopened.generation.read(task.taskId))).toMatchObject({ providerTaskId: 'fixture-job-1', reconcileStatus: 'unsupported' });
});
it('cancels queued work with reservation release but preserves reservation and completed result on running cancellation', async () => {
  const s = await setup(), first = await s.enqueue(); expect(value(await execute(s.engine, 'task.requestCancel', { taskId: first.taskId }))).toMatchObject({ state: 'CANCELLED', reservationMicros: 0 });
  value(await s.engine.scheduler.run(first.attemptId)); expect(s.server.posts).toBe(0);
  const task = await s.enqueue(); s.server.hold(); s.server.setMode('completed'); const pending = s.engine.scheduler.run(task.attemptId);
  await expect.poll(() => s.server.posts).toBe(1); expect(value(await execute(s.engine, 'task.requestCancel', { taskId: task.taskId }))).toMatchObject({ cancelStatus: 'unsupported', reservationMicros: 700000 });
  s.noCapacity(); s.server.release(); value(await pending); expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'SUCCEEDED', cancelRequested: true, providerState: 'completed', collectionState: 'durable', reportedActualMicros: null, reservationMicros: 700000 });
});
it('retries only collection after completed provider POST and publishes actual artifact without auto-asset', async () => {
  const s = await setup(), task = await s.enqueue(); s.server.setMode('completed'); const db = new DatabaseSync(join(s.root, 'library.sqlite'));
  db.exec("CREATE TRIGGER fail_artifact BEFORE INSERT ON artifact BEGIN SELECT RAISE(ABORT,'fixture'); END");
  value(await s.engine.scheduler.run(task.attemptId)); expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ providerState: 'completed', collectionState: 'retryable_failure' });
  db.exec('DROP TRIGGER fail_artifact'); value(await execute(s.engine, 'task.retryCollection', { taskId: task.taskId }));
  expect(s.server.posts).toBe(1); expect(db.prepare('SELECT * FROM artifact').all()).toHaveLength(1); expect(db.prepare('SELECT * FROM asset').all()).toHaveLength(0); db.close();
});
it('pauses new dispatch when disk capacity is unavailable without blocking paid result collection', async () => {
  const s = await setup(), task = await s.enqueue(); s.noCapacity(); expect(await s.engine.scheduler.run(task.attemptId)).toMatchObject({ ok: false, error: { code: 'DISK_CAPACITY' } }); expect(s.server.posts).toBe(0);
});
it('rolls approval task and reservation back when atomic event/receipt cannot publish', async () => {
  const s = await setup(), p = await s.prepare(), db = new DatabaseSync(join(s.root, 'library.sqlite')); db.exec("CREATE TRIGGER deny_generation BEFORE INSERT ON domain_event WHEN NEW.kind='generation.enqueued' BEGIN SELECT RAISE(ABORT,'fixture'); END");
  expect(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(p))).toMatchObject({ ok: false, error: { code: 'COMMAND_COMMIT_FAILED' } }); expect(s.engine.generation.list().tasks).toHaveLength(0); db.exec('DROP TRIGGER deny_generation'); db.close(); value(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(p)));
});

// Omitting the durable permit write would send HTTP before a recoverable intent exists.
it('makes intent and stable clientRequestId visible in SQLite before the fixture receives POST', async () => {
  const s = await setup(), task = await s.enqueue(); let sawIntent = false;
  s.server.onPost(() => { const db = new DatabaseSync(join(s.root, 'library.sqlite')); const row = db.prepare('SELECT intent_json,client_request_id FROM task_attempt WHERE attempt_id=?').get(task.attemptId); sawIntent = typeof row?.intent_json === 'string' && typeof row.client_request_id === 'string'; db.close(); });
  value(await s.engine.scheduler.run(task.attemptId)); expect(sawIntent).toBe(true); expect(s.server.posts).toBe(1);
});
it('reconciles an accepted job by real HTTP GET after restart and collects its result without another POST', async () => {
  const s = await setup(), task = await s.enqueue(); value(await s.engine.scheduler.run(task.attemptId)); await s.engine.close();
  s.supportReconcile(); s.server.setMode('completed'); const reopened = await s.open(); value(await reopened.scheduler.recover());
  expect(s.server.posts).toBe(1); expect(s.server.gets).toBe(1); expect(value(reopened.generation.read(task.taskId))).toMatchObject({ state: 'SUCCEEDED', providerTaskId: 'fixture-job-1' });
});
it('reserves async command identity across kinds and avoids repeated provider query on concurrent command replay', async () => {
  const s = await setup(), task = await s.enqueue(); value(await s.engine.scheduler.run(task.attemptId)); s.supportReconcile(); s.server.hold();
  const command = execute(s.engine, 'task.reconcile', { taskId: task.taskId }, 'async-identity');
  await expect.poll(() => s.server.gets).toBe(1);
  expect(await execute(s.engine, 'project.create', { name: 'collision' }, 'async-identity')).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_REUSED' } });
  const replay = execute(s.engine, 'task.reconcile', { taskId: task.taskId }, 'async-identity'); s.server.release();
  expect(await replay).toEqual(await command); expect(s.server.gets).toBe(1); expect(s.server.posts).toBe(1);
});
it('rejects expired prepare at approval and requires explicit unknown fee allowance acknowledgment', async () => {
  const s = await setup(), p = await s.prepare();
  expect(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(p, { acknowledgeUnknown: false }))).toMatchObject({ ok: false, error: { code: 'UNKNOWN_PRICE_CONFIRMATION' } });
  s.advance(); expect(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(p))).toMatchObject({ ok: false, error: { code: 'APPROVAL_EXPIRED' } });
  expect(s.server.posts).toBe(0);
});
it('does not let a late accepted fact regress a completed provider result', async () => {
  const s = await setup(), task = await s.enqueue(); s.server.setMode('completed'); value(await s.engine.scheduler.run(task.attemptId));
  const lease = value(s.engine.scheduler.claim(task.attemptId)); value(s.engine.generation.recordOutcome(task.attemptId, lease.leaseToken, { kind: 'accepted', providerTaskId: 'wrong-late-job' }, 'fixture-v1'));
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'SUCCEEDED', providerTaskId: 'fixture-job-1' });
});

it('persists completed remote output before download and retries download alone after restart', async () => {
  const s = await setup(), task = await s.enqueue(); s.remoteOutput(); s.server.setMode('completed'); s.server.setResultStatus(503);
  value(await s.engine.scheduler.run(task.attemptId)); expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ providerState: 'completed', collectionState: 'retryable_failure', errorCode: 'OUTPUT_DOWNLOAD_FAILED' });
  expect(s.server.posts).toBe(1); expect(s.server.downloads).toBe(1); await s.engine.close();
  s.server.setResultStatus(200); const reopened = await s.open(); value(await reopened.scheduler.recover()); expect(value(reopened.generation.read(task.taskId))).toMatchObject({ state: 'SUCCEEDED' }); expect(s.server.posts).toBe(1); expect(s.server.downloads).toBe(2);
});
it('serializes simultaneous collection retry wakeups for the same durable provider result', async () => {
  const s = await setup(), task = await s.enqueue(); s.remoteOutput(); s.server.setMode('completed'); s.server.setResultStatus(503); value(await s.engine.scheduler.run(task.attemptId)); s.server.setResultStatus(200);
  const results = await Promise.all([s.engine.generation.collect(task.taskId), s.engine.generation.collect(task.taskId)]); expect(results.every(r => r.ok)).toBe(true);
  expect(s.server.posts).toBe(1); expect(s.server.downloads).toBe(2); expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'SUCCEEDED' });
});
it('fences the response after an in-flight POST lease expires and never submits again', async () => {
  const s = await setup(), task = await s.enqueue(); s.server.hold(); const pending = s.engine.scheduler.run(task.attemptId); await expect.poll(() => s.server.posts).toBe(1); s.advance(); s.server.release();
  expect(await pending).toMatchObject({ ok: false, error: { code: 'STALE_LEASE' } }); value(await s.engine.scheduler.recover()); value(await s.engine.scheduler.run(task.attemptId)); expect(s.server.posts).toBe(1);
});

it('enforces frozen connection concurrency across simultaneous dispatch permits', async () => {
  const s = await setup();
  const refs = []; for (let i = 0; i < 3; i++) refs.push(value(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(await s.prepare(), { allowanceMicros: 100000 }))));
  s.server.hold(); const first = s.engine.scheduler.run(refs[0].attemptId), second = s.engine.scheduler.run(refs[1].attemptId); await expect.poll(() => s.server.posts).toBe(2);
  const thirdWork = s.engine.scheduler.run(refs[2].attemptId); await new Promise(resolve => setTimeout(resolve, 50)); s.server.release(); const third = await thirdWork; await Promise.all([first, second]);
  expect(third).toMatchObject({ ok: false, error: { code: 'CONCURRENCY_LIMIT' } }); expect(s.server.posts).toBe(2);
});
it('keeps private remote output locators out of task reads, command receipts and task events', async () => {
  const s = await setup(), task = await s.enqueue(); s.remoteOutput(); s.server.setMode('completed'); value(await s.engine.scheduler.run(task.attemptId));
  const read = s.engine.commands.query({ schemaVersion: 1, libraryId: s.engine.identity.libraryId, connectionEpoch: 'client', queryId: 'read-task', kind: 'task.read', payload: { taskId: task.taskId } });
  const db = new DatabaseSync(join(s.root, 'library.sqlite')); const publicRows = [...db.prepare('SELECT payload_json AS data FROM domain_event').all(), ...db.prepare('SELECT receipt_json AS data FROM command_receipt').all()]; const privateRow = db.prepare('SELECT output_json FROM task_attempt WHERE attempt_id=?').get(task.attemptId); db.close();
  expect(JSON.stringify(read)).not.toContain('/result'); expect(JSON.stringify(publicRows)).not.toContain('/result'); expect(privateRow?.output_json).toContain('/result');
});
it('records completed inline output loss as unrecoverable and never treats missing bytes as unsubmitted', async () => {
  const s = await setup(), task = await s.enqueue(); s.unavailableOutput(); s.server.setMode('completed'); value(await s.engine.scheduler.run(task.attemptId));
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ providerState: 'completed', collectionState: 'unrecoverable', reservationMicros: 700000, reportedActualMicros: null });
  value(await s.engine.scheduler.run(task.attemptId)); expect(s.server.posts).toBe(1);
});
it('starts and wakes persistent scheduler without resubmitting already accepted attempts', async () => {
  const s = await setup(); await s.enqueue(); value(await s.engine.scheduler.start()); expect(s.server.posts).toBe(1); value(await s.engine.scheduler.wake()); value(await s.engine.scheduler.wake()); expect(s.server.posts).toBe(1);
});

it('fences invalid provider facts rather than publishing malformed completed rows', async () => {
  const s = await setup(), task = await s.enqueue(), lease = value(s.engine.scheduler.claim(task.attemptId));
  value(await s.engine.generation.acquireDispatch(task.attemptId, lease.leaseToken));
  expect(s.engine.generation.recordOutcome(task.attemptId, lease.leaseToken, { kind: 'completed', providerTaskId: 'fixture-job-1' }, 'fixture-v1')).toMatchObject({ ok: false, error: { code: 'INVALID_PROVIDER_OUTCOME' } });
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'SUBMITTING', providerState: 'submitting' });
});
it('provides stable durable output staging identity to dispatch and materialization across restart', async () => {
  const s = await setup(), task = await s.enqueue(), lease = value(s.engine.scheduler.claim(task.attemptId)), permit = value(await s.engine.generation.acquireDispatch(task.attemptId, lease.leaseToken));
  expect(permit.outputStagingId).toBe(`${task.attemptId}-output`);
  const db = new DatabaseSync(join(s.root, 'library.sqlite')); const row = db.prepare('SELECT intent_json FROM task_attempt WHERE attempt_id=?').get(task.attemptId); db.close();
  expect(JSON.parse(row!.intent_json as string)).toMatchObject({ outputStagingId: `${task.attemptId}-output`, retries: 0 });
});

it('lets the current worker reconcile a fenced completed fact and collect paid output without new provider traffic', async () => {
  const s = await setup(), task = await s.enqueue(); s.server.setMode('completed'); s.server.hold();
  const pending = s.engine.scheduler.run(task.attemptId); await expect.poll(() => s.server.posts).toBe(1); s.advance(); s.server.release(); expect(await pending).toMatchObject({ ok: false, error: { code: 'STALE_LEASE' } });
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ providerState: 'submitting' }); value(await s.engine.scheduler.recover());
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'SUCCEEDED', providerState: 'completed' }); expect(s.server.posts).toBe(1); expect(s.server.gets).toBe(0);
});

it('preserves cancellation requested while completed output is being materialized', async () => {
  const s = await setup(), task = await s.enqueue(); s.remoteOutput(); s.server.setMode('completed'); s.server.holdResult();
  const pending = s.engine.scheduler.run(task.attemptId); await expect.poll(() => s.server.downloads).toBe(1);
  expect(value(await execute(s.engine, 'task.requestCancel', { taskId: task.taskId }))).toMatchObject({ cancelRequested: true, cancelStatus: 'unsupported' });
  s.server.releaseResult(); value(await pending); expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'SUCCEEDED', cancelRequested: true, cancelStatus: 'unsupported' });
});
it('drains a held scheduler wake on engine close without dispatching a later queued task', async () => {
  const s = await setup(); for (let i = 0; i < 2; i++) value(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(await s.prepare(), { allowanceMicros: 100000 })));
  s.server.hold(); const starting = s.engine.scheduler.start(); await expect.poll(() => s.server.posts).toBe(1);
  const closing = s.engine.close(); s.server.release(); await expect(starting).resolves.toMatchObject({ ok: true }); await expect(closing).resolves.toMatchObject({ ok: true }); expect(s.server.posts).toBe(1);
});

// Recovery HTTP must remain owned by the scheduler until its observed result is durable.
it.each(['start', 'recover'] as const)('drains held %s reconciliation before closing SQLite and stops later recovery/dispatch', async entry => {
  const s = await setup(), tasks = [];
  for (let i = 0; i < 3; i++) tasks.push(value(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(await s.prepare(), { allowanceMicros: 100000 }))));
  value(await s.engine.scheduler.run(tasks[0].attemptId)); value(await s.engine.scheduler.run(tasks[1].attemptId)); await s.engine.close();
  s.supportReconcile(); s.server.setMode('completed'); s.server.hold(); const reopened = await s.open();
  const recovering = reopened.scheduler[entry](); const observed = recovering.then((r: unknown) => r, (e: unknown) => e);
  await expect.poll(() => s.server.gets).toBe(1);
  let closed = false; const closing = reopened.close().then(r => { closed = true; return r; });
  await new Promise(resolve => setTimeout(resolve, 25)); const closedBeforeResponse = closed;
  s.server.release(); await observed; value(await closing);
  expect(closedBeforeResponse).toBe(false);
  const db = new DatabaseSync(join(s.root, 'library.sqlite'), { readOnly: true });
  const rows = db.prepare('SELECT view_json FROM task_attempt ORDER BY rowid').all().map(r => JSON.parse(r.view_json as string)); const artifacts = db.prepare('SELECT id FROM artifact').all(); db.close();
  expect(rows[0]).toMatchObject({ state: 'SUCCEEDED', providerState: 'completed', collectionState: 'durable' });
  expect(rows[1]).toMatchObject({ providerState: 'accepted' }); expect(rows[2]).toMatchObject({ state: 'QUEUED', providerState: 'unsubmitted' }); expect(artifacts).toHaveLength(1);
  expect(s.server.posts).toBe(2); expect(s.server.gets).toBe(1); expect(await reopened.scheduler.run(tasks[2].attemptId)).toMatchObject({ ok: false, error: { code: 'SCHEDULER_CLOSED' } });
});
it.each(['expiry', 'config', 'input'] as const)('persists automatic %s approval invalidation as actionable unspent failure without POST', async change => {
  const s = await setup(), task = await s.enqueue();
  if (change === 'expiry') s.advance();
  if (change === 'input') s.staleInput();
  if (change === 'config') value(await execute(s.engine, 'model.saveDefinition', { ...s.model, expectedRevision: 1, pricing: { status: 'configured', currency: 'USD', perImage: 1, version: 'changed' } }));
  value(await s.engine.scheduler.start());
  const code = change === 'expiry' ? 'APPROVAL_EXPIRED' : change === 'input' ? 'INPUT_CHANGED' : 'CONFIG_CHANGED';
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'FAILED', providerState: 'unsubmitted', errorCode: code, reservationMicros: 0, settlementStatus: 'unspent', reportedActualMicros: null });
  const db = new DatabaseSync(join(s.root, 'library.sqlite')); const events = db.prepare("SELECT payload_json FROM domain_event WHERE kind='task.changed' ORDER BY seq").all().map(r => JSON.parse(r.payload_json as string)); const polls = db.prepare('SELECT polls FROM scheduler_job WHERE attempt_id=?').get(task.attemptId); db.close();
  expect(events.at(-1)).toMatchObject({ taskId: task.taskId, state: 'FAILED', errorCode: code, reservationMicros: 0 });
  value(await s.engine.scheduler.wake()); value(await s.engine.scheduler.run(task.attemptId));
  const inspect = new DatabaseSync(join(s.root, 'library.sqlite')); expect(inspect.prepare('SELECT polls FROM scheduler_job WHERE attempt_id=?').get(task.attemptId)).toEqual(polls); inspect.close(); expect(s.server.posts).toBe(0);
});
it('exposes automatic deadline exhaustion for unsubmitted work without keeping its unspent reservation', async () => {
  const s = await setup(), task = await s.enqueue(); s.setNow(Date.now() + 2 * 86400000); value(await s.engine.scheduler.start());
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'FAILED', providerState: 'unsubmitted', errorCode: 'SCHEDULER_DEADLINE_EXCEEDED', reservationMicros: 0, settlementStatus: 'unspent' }); expect(s.server.posts).toBe(0);
});
it('exposes submitted deadline exhaustion with pending budget and never makes unknown work dispatchable', async () => {
  const s = await setup(), task = await s.enqueue(); s.server.setMode('disconnect'); value(await s.engine.scheduler.run(task.attemptId)); s.setNow(Date.now() + 2 * 86400000); value(await s.engine.scheduler.start());
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'RECONCILE_REQUIRED', providerState: 'unknown', errorCode: 'SCHEDULER_DEADLINE_EXCEEDED', reservationMicros: 700000, settlementStatus: 'unknown', reportedActualMicros: null });
  value(await s.engine.scheduler.wake()); value(await s.engine.scheduler.run(task.attemptId)); expect(s.server.posts).toBe(1);
});
it('reports capacity backoff as queued pending occupancy and clears the reason when dispatch becomes possible', async () => {
  const s = await setup(), task = await s.enqueue(); s.noCapacity(); value(await s.engine.scheduler.start());
  expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'QUEUED', providerState: 'unsubmitted', errorCode: 'DISK_CAPACITY', reservationMicros: 700000, settlementStatus: 'unknown' }); expect(s.server.posts).toBe(0);
  s.restoreCapacity(); s.setNow(Date.now() + 6000); value(await s.engine.scheduler.wake()); expect(value(s.engine.generation.read(task.taskId))).toMatchObject({ state: 'RUNNING', errorCode: null }); expect(s.server.posts).toBe(1);
});
it('reports connection concurrency backoff while retaining only pending reservation and no extra POST', async () => {
  const s = await setup(), tasks = []; for (let i = 0; i < 3; i++) tasks.push(value(await execute(s.engine, 'generation.approveAndEnqueue', s.approval(await s.prepare(), { allowanceMicros: 100000 }))));
  value(await s.engine.scheduler.run(tasks[0].attemptId)); value(await s.engine.scheduler.run(tasks[1].attemptId)); value(await s.engine.scheduler.start());
  expect(value(s.engine.generation.read(tasks[2].taskId))).toMatchObject({ state: 'QUEUED', errorCode: 'CONCURRENCY_LIMIT', reservationMicros: 100000 }); expect(s.server.posts).toBe(2);
});

it('keeps a ten-minute lease alive across a long submit without duplicate POSTs',async()=>{
 const s=await setup(),start=Date.now();s.setNow(start);const task=await s.enqueue();s.server.hold();s.server.setMode('completed');
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 const pending=s.engine.scheduler.run(task.attemptId);let result;
 try{
  await expect.poll(()=>s.server.posts).toBe(1);
  for(let elapsed=30000;elapsed<=720000;elapsed+=30000){s.setNow(start+elapsed);await vi.advanceTimersByTimeAsync(30000);}
 }finally{s.server.release();result=await pending;vi.useRealTimers();}
 expect(result).toMatchObject({ok:true,value:{state:'SUCCEEDED',collectionState:'durable'}});
 expect(s.server.posts).toBe(1);
});
it('keeps the original accepted job lease alive across a long reconcile GET',async()=>{
 const s=await setup(),start=Date.now();s.setNow(start);const task=await s.enqueue();value(await s.engine.scheduler.run(task.attemptId));s.supportReconcile();s.server.hold();s.server.setMode('completed');
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 const pending=s.engine.generation.reconcile(task.taskId);let result;
 try{await expect.poll(()=>s.server.gets).toBe(1);for(let elapsed=30000;elapsed<=720000;elapsed+=30000){s.setNow(start+elapsed);await vi.advanceTimersByTimeAsync(30000);}}
 finally{s.server.release();result=await pending;vi.useRealTimers();}
 expect(result).toMatchObject({ok:true,value:{state:'SUCCEEDED'}});expect(s.server.posts).toBe(1);expect(s.server.gets).toBe(1);
});
it('does not renew or publish after a different worker fences a long submit',async()=>{
 const s=await setup(),start=Date.now();s.setNow(start);const task=await s.enqueue();s.server.hold();s.server.setMode('completed');
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});const pending=s.engine.scheduler.run(task.attemptId);const db=new DatabaseSync(join(s.root,'library.sqlite'));let result;
 try{await expect.poll(()=>s.server.posts).toBe(1);db.prepare("UPDATE task_lease SET token=token+1,owner='new-worker',expires_at=? WHERE attempt_id=?").run(start+900000,task.attemptId);s.setNow(start+30000);await vi.advanceTimersByTimeAsync(30000);}
 finally{s.server.release();result=await pending;vi.useRealTimers();}
 try{expect(result).toMatchObject({ok:false,error:{code:'STALE_LEASE'}});expect(db.prepare('SELECT owner,expires_at FROM task_lease WHERE attempt_id=?').get(task.attemptId)).toMatchObject({owner:'new-worker',expires_at:start+900000});expect(db.prepare('SELECT applied FROM generation_fact WHERE attempt_id=?').get(task.attemptId)).toMatchObject({applied:0});expect(s.server.posts).toBe(1);}finally{db.close();}
});
it('grants ten minutes initially but never revives an expired worker lease',async()=>{
 const s=await setup(),start=Date.now();s.setNow(start);const task=await s.enqueue(),lease=value(s.engine.generation.claim(task.attemptId));
 const db=new DatabaseSync(join(s.root,'library.sqlite'));try{expect(db.prepare('SELECT expires_at FROM task_lease WHERE attempt_id=?').get(task.attemptId)).toMatchObject({expires_at:start+600000});}finally{db.close();}
 s.setNow(start+600001);expect(s.engine.generation.renewLease(task.attemptId,lease.leaseToken)).toMatchObject({ok:false,error:{code:'STALE_LEASE'}});
});
