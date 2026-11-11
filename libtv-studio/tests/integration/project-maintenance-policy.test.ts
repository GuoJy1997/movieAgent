import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startEngine } from '../../packages/engine/src/bootstrap.ts';
import { openLibrary } from '../../packages/storage/src/database.ts';
import { bindDirectoryProject, createDirectoryProject, inspectDirectoryProject } from '../../apps/desktop/src/main/project-directories.ts';
import { createProjectBackup, restoreProjectBackup } from '../../packages/storage/src/project-backup.ts';
import type { Result } from '../../packages/contracts/src/result.ts';
import { isDefinitiveCommandRejection } from '../../apps/desktop/src/main/command-rejection.ts';
const roots: string[] = [];
const val = <T>(r: Result<T>): T => { if (!r.ok) throw Error(r.error.code); return r.value; };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function restored() {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-p5-policy-')); roots.push(root);
  const project = val(await createDirectoryProject({ mode: 'new', directory: root, name: '原项目' }));
  val(await createProjectBackup({ projectRoot: project.root, destination: join(root, 'backup'), appVersion: '0.2.0' }));
  const receipt = val(await restoreProjectBackup({ backupRoot: join(root, 'backup'), destination: join(root, 'restored') }));
  return { root, project, receipt, libraryRoot: join(receipt.root, '.movieagent/library') };
}
it('keeps restored scheduling and executing commands blocked across reopen, while allowing initialization', async () => {
  const f = await restored();
  for (let i = 0; i < 2; i++) {
    const engine = val(await startEngine({ root: f.libraryRoot }));
    try {
      expect(await engine.scheduler.start()).toMatchObject({ ok: false, error: { code: 'RESTORED_PROJECT_PAUSED' } });
      expect(await engine.scheduler.recover()).toMatchObject({ ok: false, error: { code: 'RESTORED_PROJECT_PAUSED' } });
      expect(await engine.scheduler.run('no-such-attempt')).toMatchObject({ ok: false, error: { code: 'RESTORED_PROJECT_PAUSED' } });
      expect(await engine.commands.execute({ kind: 'generation.enqueue' })).toMatchObject({ ok: false, error: { code: 'RESTORED_PROJECT_PAUSED' } });
      expect(val(engine.projects.list())).toHaveLength(0);
    } finally { val(await engine.close()); }
  }
});
it('activates only a closed restored project and migrates a source without deleting it', async () => {
  const f = await restored(); const path = '../../packages/storage/src/project-transfer.ts'; const actions = await import(path).catch(() => ({}));
  expect(actions.activateRestoredProject).toBeTypeOf('function'); expect(actions.migrateDirectoryProject).toBeTypeOf('function');
  const engine = val(await startEngine({ root: f.libraryRoot }));
  try { expect(await actions.activateRestoredProject(f.receipt.root)).toMatchObject({ ok: false, error: { code: 'PROJECT_IN_USE' } }); }
  finally { val(await engine.close()); }
  val(await actions.activateRestoredProject(f.receipt.root));
  const resumed = val(await startEngine({ root: f.libraryRoot }));
  try { expect((await resumed.scheduler.start()).ok).toBe(true); } finally { val(await resumed.close()); }
  const target = join(f.root, 'moved');
  const moved = val<any>(await actions.migrateDirectoryProject({ projectRoot: f.project.root, destination: target, appVersion: '0.2.0' }));
  expect(moved).toMatchObject({ root: target, scheduling: 'active', sourceRetired: true });
  expect((await inspectDirectoryProject(f.project.root)).ok).toBe(true);
  expect(await openLibrary({ root: f.project.libraryRoot })).toMatchObject({ ok: false, error: { code: 'PROJECT_RETIRED' } });
  expect(val<any>(await actions.migrateDirectoryProject({ projectRoot: f.project.root, destination: target, appVersion: '0.2.0' })).workspaceId).toBe(moved.workspaceId);
});
it('prevents two copies of one library from owning execution under the same launcher profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-p5-owner-')); roots.push(root);
  const first = val(await openLibrary({ root: join(root, 'one') })); const id = first.libraryId; val(await first.close());
  await mkdir(join(root, 'two'));
  const { copyFile } = await import('node:fs/promises'); await copyFile(join(root, 'one/library.sqlite'), join(root, 'two/library.sqlite'));
  const options = { identityGuardRoot: join(root, 'owners') };
  const a = val(await openLibrary({ root: join(root, 'one'), ...options }));
  try { const duplicate = await openLibrary({ root: join(root, 'two'), ...options }); if (duplicate.ok) val(await duplicate.value.close()); expect(duplicate).toMatchObject({ ok: false, error: { code: 'LIBRARY_IDENTITY_IN_USE' } }); }
  finally { val(await a.close()); }
  const b = val(await openLibrary({ root: join(root, 'two'), ...options })); expect(b.libraryId).toBe(id); val(await b.close());
});
it('refuses opening a retired migration source even through the direct library path', async () => {
  const f = await restored(); await writeFile(join(f.project.libraryRoot, '.maintenance-state.json'), JSON.stringify({ format: 'movieagent.maintenance-state', schemaVersion: 1, state: 'retired', transferId: f.receipt.backupId, sourceWorkspaceId: f.project.manifest.workspaceId }));
  const opened = await openLibrary({ root: f.project.libraryRoot }); if (opened.ok) val(await opened.value.close());
  expect(opened).toMatchObject({ ok: false, error: { code: 'PROJECT_RETIRED' } });
  expect((await inspectDirectoryProject(f.project.root)).ok).toBe(true);
});
it('keeps queued and unknown paid intentions unchanged without submitting or reconciling a restored copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-p5-tasks-')); roots.push(root);
  const directory = val(await createDirectoryProject({ mode: 'new', directory: root, name: '有任务的短剧' }));
  let submits = 0, reconciles = 0;
  const generation = { adapter: { adapterId: 'fixture-v1', validate: (r: any) => ({ ok: true as const, value: r }), async submit() { submits++; return { kind: 'unknown' as const }; }, async reconcile() { reconciles++; return { kind: 'unsupported' as const }; } }, context: {} };
  const original = val(await startEngine({ root: directory.libraryRoot, generation }));
  const libraryId = original.identity.libraryId;
  async function exec(kind: string, payload: unknown) { const r = await original.commands.execute({ schemaVersion: 1, libraryId, connectionEpoch: 'fixture', commandId: crypto.randomUUID(), kind, payload }); return val(r).result as any; }
  const project = await exec('project.create', { name: '任务测试' });
  val(await bindDirectoryProject(directory.root, { workspaceId: directory.manifest.workspaceId, libraryId, projectId: project.id }));
  try {
    await exec('provider.saveConnection', { id: 'c', expectedRevision: 0, name: 'Fixture', adapterType: 'openai-image-v1', baseUrl: 'https://fixture.example.invalid/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 1000, concurrency: 2 });
    await exec('model.saveDefinition', { id: 'm', expectedRevision: 0, name: 'Fixture', modelId: 'dummy', connectionRef: { libraryId, id: 'c', revision: 1 }, capabilities: { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } });
    await exec('profile.save', { id: 'p', expectedRevision: 0, name: 'Fixture', modelRef: { libraryId, id: 'm', revision: 1 }, parameters: {} });
    for (let i = 0; i < 2; i++) {
      const plan = await exec('generation.prepare', { projectId: project.id, profileRef: { libraryId, id: 'p', revision: 1 }, prompt: '不发往外网的夹具', inputVersion: 'text-v1', executionOwner: 'human', runId: 'run-' + i });
      const task = await exec('generation.approveAndEnqueue', { preparedId: plan.preparedId, approvedPlanHash: plan.planHash, currency: 'USD', allowanceMicros: 1000, budgetLimitMicros: 10000, acknowledgeUnknown: true, executionOwner: 'human', runId: 'run-' + i });
      if (i === 1) val(await original.scheduler.run(task.attemptId));
    }
  } finally { val(await original.close()); }
  expect(submits).toBe(1); expect(reconciles).toBe(0);
  val(await createProjectBackup({ projectRoot: directory.root, destination: join(root, 'backup'), appVersion: '0.2.0' }));
  val(await restoreProjectBackup({ backupRoot: join(root, 'backup'), destination: join(root, 'copy') }));
  for (let i = 0; i < 2; i++) {
    const engine = val(await startEngine({ root: join(root, 'copy/.movieagent/library'), generation }));
    try {
      const before = engine.generation.list().tasks; expect(before).toHaveLength(2);
      expect(before.map(t => t.providerState).sort()).toEqual(['unknown','unsubmitted']);
      expect(await engine.scheduler.start()).toMatchObject({ ok: false, error: { code: 'RESTORED_PROJECT_PAUSED' } });
      await engine.scheduler.recover(); await engine.scheduler.wake(); engine.scheduler.resume();
      const envelope = { schemaVersion: 1 as const, libraryId, connectionEpoch: 'fixture', commandId: 'paused-enqueue', kind: 'generation.approveAndEnqueue' as const, payload: {} as any };
      expect(await engine.commands.execute(envelope)).toMatchObject({ ok: false, error: { code: 'RESTORED_PROJECT_PAUSED' } });
      expect(isDefinitiveCommandRejection(envelope, 'RESTORED_PROJECT_PAUSED')).toBe(true);
      expect(engine.generation.list().tasks).toEqual(before);
      expect(submits).toBe(1); expect(reconciles).toBe(0);
    } finally { val(await engine.close()); }
  }
});
