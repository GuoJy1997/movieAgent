import { isolatedModelConfig } from './support/product-launch.ts';
import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { startEngine } from '../../packages/engine/src/bootstrap.ts';
import { CommandOutbox } from '../../apps/desktop/src/main/command-outbox.ts';
it.each(['same-library-outbox','other-library-outbox','queued-task','collecting-task','unknown-task','idle'] as const)('checks %s after library ownership and before provider activation/replay', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-admission-'));
  const library = join(root, 'library'), profile = join(root, 'profile'), observation = join(root, 'observation.json');
  const opened = await startEngine({ root: library, providerContext: { evidence: 'fixture', requestImage: async () => { throw Error('fixture must never dispatch'); } } }); if (!opened.ok) throw Error('fixture');
  const libraryId = opened.value.identity.libraryId;
  if (scenario.endsWith('task')) {
    const execute = async (kind: string, payload: unknown): Promise<any> => {
      const result = await opened.value.commands.execute({ schemaVersion: 1, libraryId, connectionEpoch: 'fixture', commandId: crypto.randomUUID(), kind, payload });
      if (!result.ok) throw Error(result.error.code); return result.value.result;
    };
    const project = await execute('project.create', { name: 'fixture' });
    const connection = await execute('provider.saveConnection', { id: 'c', expectedRevision: 0, name: 'fixture', adapterType: 'openai-image-v1', baseUrl: 'https://example.invalid/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 1000, concurrency: 1 });
    const model = await execute('model.saveDefinition', { id: 'm', expectedRevision: 0, name: 'fixture', modelId: 'fixture', connectionRef: connection, capabilities: { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } });
    const profileRef = await execute('profile.save', { id: 'p', expectedRevision: 0, name: 'fixture', modelRef: model, parameters: {} });
    const prepared = await execute('generation.prepare', { projectId: project.id, profileRef, prompt: 'fixture', inputVersion: 'v1', executionOwner: 'human', runId: 'fixture' });
    const task = await execute('generation.approveAndEnqueue', { preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, currency: 'USD', allowanceMicros: 1, budgetLimitMicros: 1, acknowledgeUnknown: true, executionOwner: 'human', runId: 'fixture' });
    if (scenario !== 'queued-task') {
      const claim = opened.value.generation.claim(task.attemptId); if (!claim.ok) throw Error('claim');
      const permit = await opened.value.generation.acquireDispatch(task.attemptId, claim.value.leaseToken); if (!permit.ok) throw Error(permit.error.code);
      const outcome = opened.value.generation.recordOutcome(task.attemptId, claim.value.leaseToken, scenario === 'collecting-task' ? { kind: 'completed', providerTaskId: 'fixture', output: { kind: 'unavailable', reason: 'fixture' } } : { kind: 'unknown' }, 'openai-image-v1');
      if (!outcome.ok) throw Error(outcome.error.code);
      opened.value.generation.release(task.attemptId, claim.value.leaseToken);
    }
  }
  await opened.value.close();
  // This represents a row arriving after the script's preflight. Main owns the
  // library by the time it can replay this legitimate durable command.
  const outbox = new CommandOutbox(join(profile, 'client-state/command-outbox.sqlite'));
  if (scenario.endsWith('outbox')) expect(outbox.enqueue({ schemaVersion: 1, libraryId: scenario === 'other-library-outbox' ? 'other-library' : libraryId, connectionEpoch: 'fixture', commandId: 'must-not-replay', kind: 'project.create', payload: { name: 'must not exist' } }).ok).toBe(true);
  outbox.close();
  const launcher = join(root, 'launcher.cjs');
  await writeFile(launcher, `const fs=require('node:fs');const {app,utilityProcess}=require('electron');let starts=0;const fork=utilityProcess.fork.bind(utilityProcess);utilityProcess.fork=(...args)=>{const child=fork(...args),post=child.postMessage.bind(child);child.postMessage=data=>{if(data.kind==='provider.start')starts++;return post(data);};return child;};app.on('browser-window-created',(_event,window)=>window.webContents.once('did-stop-loading',()=>app.quit()));app.on('quit',()=>fs.writeFileSync(${JSON.stringify(observation)},JSON.stringify({starts})));require(${JSON.stringify(resolve('apps/desktop/out/main/index.js'))});`);
  const electron = createRequire(import.meta.url)('electron') as string;
  const child = spawn(electron, [launcher, await isolatedModelConfig(root), `--library-root=${library}`, `--user-data-dir=${profile}`, `--live-image-check-library=${libraryId}`], { stdio: 'ignore', windowsHide: true });
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill(), 12000);
  try {
    const [code] = await exited;
    expect(code).toBe(0);
    expect(JSON.parse(await readFile(observation, 'utf8'))).toEqual({ starts: scenario === 'idle' ? 1 : 0 });
    expect(JSON.parse(await readFile(join(profile, 'live-check-admission.json'), 'utf8'))).toEqual(scenario === 'idle' ? { admitted: true } : { admitted: false, reason: 'LIVE_LIBRARY_NOT_IDLE' });
    const reopened = await startEngine({ root: library }); if (!reopened.ok) throw Error('reopen');
    try {
      expect(reopened.value.projects.list()).toMatchObject({ ok: true, value: scenario.endsWith('task') ? [{ name: 'fixture' }] : [] });
      if (scenario.endsWith('task')) expect(reopened.value.generation.list()).toMatchObject({ tasks: [{ state: scenario === 'queued-task' ? 'QUEUED' : scenario === 'collecting-task' ? 'COLLECTING' : 'SUBMISSION_UNKNOWN' }] });
    } finally { await reopened.value.close(); }
    const retained = new CommandOutbox(join(profile, 'client-state/command-outbox.sqlite'));
    try { expect(retained.pending(scenario === 'other-library-outbox' ? 'other-library' : libraryId)).toHaveLength(scenario.endsWith('outbox') ? 1 : 0); } finally { retained.close(); }
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill(); await rm(root, { recursive: true, force: true }); }
});
