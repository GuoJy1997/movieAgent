import { startEngine } from '../../packages/engine/src/bootstrap.ts';
import { stat, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const [root, endpoint, fault, action] = process.argv.slice(2) as [string, string, string, string];
const send = (data: unknown) => process.send?.(data);
const pause = async (phase: string) => { if (fault === phase) { send({ phase }); await new Promise(() => {}); } };
const path = join(root, 'fixture.png'); const s = await stat(path);
const sourceRef = { path, realPath: path, allowedRoot: root, name: 'fixture.png', size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino };
const adapter = {
  adapterId: 'fixture-v1', validate: (request: any) => ({ ok: true as const, value: request }),
  async submit(_request: any, context: any) { await pause('before-send'); const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ clientRequestId: context.clientRequestId }) }); const outcome = await response.json() as any; await pause('after-response'); return { ...outcome, sourceRef }; },
  async reconcile() { return { kind: 'unsupported' as const }; },
};
const opened = await startEngine({ root, generation: { adapter, context: { evidence: 'fixture' } }, assets: { onPhase: async phase => { if (phase === 'renamed') await pause('durable-unpublished'); } } });
if (!opened.ok) throw Error(opened.error.code); const e = opened.value;
async function execute(kind: string, payload: unknown, commandId = crypto.randomUUID()) { const result = await e.commands.execute({ schemaVersion: 1, libraryId: e.identity.libraryId, connectionEpoch: 'fixture', commandId, kind, payload }); if (!result.ok) throw Error(result.error.code); return result.value.result as any; }
if (action === 'recover') {
  await e.scheduler.recover(); const tasks = e.generation.list().tasks; send({ phase: 'recovered', tasks }); await e.close(); process.exit(0);
} else if (fault === 'cleanup') {
  await execute('project.create', { name: 'Retained across cleanup failure' });
  await unlink(join(root, 'engine.lock')); await mkdir(join(root, 'engine.lock'));
  const report = await e.quiesceEngine('quit', Date.now() + 500);
  send({ phase: 'cleanup', report }); setInterval(() => {}, 1000);
} else {
  const project = await execute('project.create', { name: 'Crash fixture' });
  const libraryId = e.identity.libraryId;
  await execute('provider.saveConnection', { id: 'c', expectedRevision: 0, name: 'Fixture', adapterType: 'openai-image-v1', baseUrl: endpoint, credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: { hostname: '127.0.0.1', port: Number(new URL(endpoint).port), purpose: 'model-api' } }, timeoutMs: 1000, concurrency: 2 });
  await execute('model.saveDefinition', { id: 'm', expectedRevision: 0, name: 'Fixture', modelId: 'dummy', connectionRef: { libraryId, id: 'c', revision: 1 }, capabilities: { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } });
  await execute('profile.save', { id: 'p', expectedRevision: 0, name: 'Fixture', modelRef: { libraryId, id: 'm', revision: 1 }, parameters: {} });
  const p = await execute('generation.prepare', { projectId: project.id, profileRef: { libraryId, id: 'p', revision: 1 }, prompt: 'fixture', inputVersion: 'v1', executionOwner: 'human', runId: 'run' });
  const task = await execute('generation.approveAndEnqueue', { preparedId: p.preparedId, approvedPlanHash: p.planHash, currency: 'USD', allowanceMicros: 1, budgetLimitMicros: 2, acknowledgeUnknown: true, executionOwner: 'human', runId: 'run' });
  await e.scheduler.run(task.attemptId); send({ phase: 'done' }); await e.close(); process.exit(0);
}
