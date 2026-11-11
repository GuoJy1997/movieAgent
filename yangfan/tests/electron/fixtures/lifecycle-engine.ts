import { startEngine, type EngineHandle } from '../../../packages/engine/src/bootstrap.ts';
import { ok } from '../../../packages/contracts/src/result.ts';
const port = process.parentPort!;
let engine: EngineHandle | undefined, launchId: string, mode: string;
port.on('message', async event => {
  const data = event.data as any;
  if (data.type === 'initialize') {
    launchId = data.launchId; mode = data.root;
    const result = await startEngine({ root: data.root }); if (!result.ok) { port.postMessage({ type: 'ready', launchId, result }); return; }
    engine = result.value;
    await engine.commands.execute({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'fixture', commandId: 'fixture-project', kind: 'project.create', payload: { name: 'Persisted before cleanup' } });
    if (mode.endsWith('late')) await new Promise<void>(resolve => setTimeout(resolve, 11_000));
    port.postMessage({ type: 'ready', launchId, result: ok(engine.identity) });
  } else if (data.type === 'request' && data.kind === 'quiesce') {
    if (mode.endsWith('forced')) { await new Promise(() => {}); return; }
    if (mode.endsWith('slow')) await new Promise<void>(resolve => setTimeout(resolve, 3000));
    const report = await engine!.quiesceEngine(data.payload.reason, data.payload.deadline - 1500);
    port.postMessage({ type: 'response', launchId, requestId: data.requestId, result: ok(report) });
    if (report.resourcesExited) process.exit(0);
  }
});
