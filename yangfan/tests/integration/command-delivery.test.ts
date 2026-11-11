import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';
import { CommandOutbox } from '../../apps/desktop/src/main/command-outbox';
import { LocalConnection } from '../../apps/desktop/src/main/local-connection';
import type { CommandEnvelope } from '../../packages/contracts/src/commands';
import type { ObjectStoreOptions } from '../../packages/storage/src/object-store';
import sharp from 'sharp';
import { requestHash } from '../../packages/engine/src/command-router';

const roots: string[] = [];
const engines: EngineHandle[] = [];
const outboxes: CommandOutbox[] = [];
it.each(['delivery','restart'] as const)('archives dialogue selection CAS rejection on %s and preserves uncertain delivery',async mode=>{
 const {root,engine}=await setup(),path=join(root,'client/dialogue-conflict.sqlite'),outbox=new CommandOutbox(path);outboxes.push(outbox);
 const transport={identity:engine.identity,execute:async(input:unknown)=>{const c=input as CommandEnvelope;if(c.kind==='dialogue.selectTake')return {ok:false as const,error:{code:'SELECTION_CONFLICT',message:'Selection changed'}};if(c.commandId==='uncertain')throw Error('disconnect');return engine.commands.execute(c);},query:async(q:unknown)=>engine.commands.query(q),readEvents:async(q:unknown)=>engine.events.read(q)};
 const connection=new LocalConnection(transport,outbox),stale:CommandEnvelope<'dialogue.selectTake'>={schemaVersion:1,libraryId:engine.identity.libraryId,connectionEpoch:connection.connectionEpoch,commandId:'stale-dialogue',kind:'dialogue.selectTake',payload:{projectId:'project',shotId:'shot',expectedShotRevision:1,expectedSelectionRevision:0,dialogueRef:{id:'dialogue',revision:1},takeId:'take'}};
 if(mode==='delivery'){expect(await connection.execute(stale)).toMatchObject({ok:false,error:{code:'SELECTION_CONFLICT'}});expect(outbox.hasPending()).toBe(false);}else expect(outbox.enqueue(stale).ok).toBe(true);
 outbox.enqueue(command(engine,'after-dialogue','After rejected dialogue'));outbox.enqueue(command(engine,'uncertain','Unknown'));outbox.close();
 const reopened=new CommandOutbox(path);outboxes.push(reopened);const recovered=new LocalConnection(transport,reopened);expect(await recovered.recover()).toMatchObject({ok:false,error:{code:'ENGINE_DISCONNECTED'}});
 expect(reopened.pending(engine.identity.libraryId).map(c=>c.commandId)).toEqual(['uncertain']);expect(engine.projects.list()).toMatchObject({ok:true,value:[{name:'After rejected dialogue'}]});
 const db=new DatabaseSync(path,{readOnly:true});expect(db.prepare('SELECT command_id,error_code,request_hash FROM rejected_command').all()).toEqual([{command_id:'stale-dialogue',error_code:'SELECTION_CONFLICT',request_hash:requestHash(stale)}]);db.close();
});
it.each(['delivery', 'restart'] as const)('archives a real stale canvas conflict on %s and continues later recovery', async mode => {
  const { root, engine } = await setup();
  const project = await engine.commands.execute(command(engine)); if (!project.ok) throw Error('project');
  const canvasId = (project.value.result as { id: string }).id;
  const envelope = (id: string, operations: unknown[]) => ({ ...command(engine, id), kind: 'canvas.applyCommand' as const, payload: { canvasId, baseRevision: 0, operations } });
  expect(await engine.commands.execute(envelope('node', [{ kind: 'create', nodeId: 'text', content: { type: 'text', text: 'v1' }, layout: { x: 0, y: 0 } }]))).toMatchObject({ ok: true });
  const snapshot = engine.canvas.read(canvasId); if (!snapshot.ok) throw Error('snapshot');
  const v1 = snapshot.value.nodes[0]!;
  const edit = (revision: number, text: string) => [{ kind: 'setContent', nodeId: v1.nodeId, incarnation: v1.incarnation, expectedRevision: revision, content: { type: 'text', text } }];
  expect(await engine.commands.execute(envelope('v2', edit(v1.semanticRevision, 'v2')))).toMatchObject({ ok: true });
  const path = join(root, 'client/conflict.sqlite'), outbox = new CommandOutbox(path); outboxes.push(outbox);
  const connection = new LocalConnection({ identity: engine.identity, execute: async c => engine.commands.execute(c), query: async q => engine.commands.query(q), readEvents: async q => engine.events.read(q) }, outbox);
  const stale = { ...envelope('stale', edit(v1.semanticRevision, 'my draft')), connectionEpoch: connection.connectionEpoch } as CommandEnvelope<'canvas.applyCommand'>;
  if (mode === 'delivery') {
    expect(await connection.execute(stale)).toMatchObject({ ok: false, error: { code: 'CANVAS_CONFLICT' } });
    expect(outbox.pending(stale.libraryId)).toHaveLength(0);
  } else outbox.enqueue(stale);
  expect(await engine.commands.execute(envelope('resolution', edit(v1.semanticRevision + 1, 'resolved')))).toMatchObject({ ok: true });
  outbox.enqueue(command(engine, 'later-conflict', 'After conflict'));
  await engine.close(); outbox.close();
  const restarted = await startEngine({ root: join(root, 'library') }); if (!restarted.ok) throw Error('restart'); engines.push(restarted.value);
  const recovered = new CommandOutbox(path); outboxes.push(recovered);
  const next = new LocalConnection({ identity: restarted.value.identity, execute: async c => restarted.value.commands.execute(c), query: async q => restarted.value.commands.query(q), readEvents: async q => restarted.value.events.read(q) }, recovered);
  expect(await next.recover()).toEqual({ ok: true, value: undefined });
  expect(await next.recover()).toEqual({ ok: true, value: undefined });
  expect(recovered.pending(stale.libraryId)).toHaveLength(0);
  const db = new DatabaseSync(path);
  const evidence = db.prepare('SELECT * FROM rejected_command WHERE command_id=?').get('stale'); db.close();
  expect(evidence).toMatchObject({ request_hash: requestHash(stale), error_code: 'CANVAS_CONFLICT' });
  expect(JSON.parse(evidence!.envelope_json as string).payload).toEqual(stale.payload);
  expect(restarted.value.projects.list()).toMatchObject({ ok: true, value: [{ name: 'Project A' }, { name: 'After conflict' }] });
  expect(restarted.value.canvas.read(canvasId)).toMatchObject({ ok: true, value: { nodes: [{ content: { text: 'resolved' } }] } });
});
it('archives an unavailable credential only for its synchronous configuration command', async () => {
  const { root, engine } = await setup();
  const outbox = new CommandOutbox(join(root, 'client/credential.sqlite')); outboxes.push(outbox);
  const connection = new LocalConnection({ identity: engine.identity, execute: async c => engine.commands.execute(c), query: async q => engine.commands.query(q), readEvents: async q => engine.events.read(q) }, outbox);
  const input: CommandEnvelope<'provider.saveConnection'> = { ...command(engine, 'credential'), connectionEpoch: connection.connectionEpoch, kind: 'provider.saveConnection', payload: { id: 'connection', expectedRevision: 0, name: 'Dummy', baseUrl: 'https://example.com/v1', adapterType: 'openai-image-v1', headers: {}, timeoutMs: 1000, concurrency: 1, networkPolicy: { privateEndpoint: null }, credentialRef: { id: 'unavailable', version: 1, libraryId: engine.identity.libraryId, connectionId: 'connection' } } };
  expect(await connection.execute(input)).toMatchObject({ ok: false, error: { code: 'CREDENTIAL_UNAVAILABLE' } });
  expect(outbox.pending(input.libraryId)).toHaveLength(0);
});
it('quarantines an import that lost its memory grant before admission on restart and recovers the later command', async () => {
  const { root, engine } = await setup();
  const input = await importCommand(engine, root), path = join(root, 'client/grant-restart.sqlite');
  const initial = new CommandOutbox(path); outboxes.push(initial);
  expect(initial.enqueue(input).ok).toBe(true); initial.enqueue(command(engine, 'after-import', 'Recovered after lost grant'));
  await engine.close(); initial.close();
  const restarted = await startEngine({ root: join(root, 'library') }); if (!restarted.ok) throw Error(restarted.error.code); engines.push(restarted.value);
  const recovered = new CommandOutbox(path); outboxes.push(recovered);
  const connection = new LocalConnection({ identity: restarted.value.identity, execute: async c => restarted.value.commands.execute(c), query: async q => restarted.value.commands.query(q), readEvents: async q => restarted.value.events.read(q) }, recovered);
  expect(await connection.recover()).toEqual({ ok: true, value: undefined });
  expect(recovered.pending(engine.identity.libraryId)).toHaveLength(0);
  const db = new DatabaseSync(path); const rejected = db.prepare('SELECT * FROM rejected_command').get(); db.close();
  expect(rejected).toMatchObject({ library_id: input.libraryId, command_id: input.commandId, request_hash: requestHash(input), error_code: 'FILE_GRANT_NOT_FOUND' });
  expect(JSON.parse(rejected!.envelope_json as string)).toMatchObject({ ...input, connectionEpoch: connection.connectionEpoch });
  expect(restarted.value.projects.list()).toMatchObject({ ok: true, value: [{ name: 'Recovered after lost grant' }] });
  const library = new DatabaseSync(join(root, 'library/library.sqlite'), { readOnly: true }); expect(library.prepare('SELECT count(*) AS n FROM import_batch').get()).toMatchObject({ n: 0 }); library.close();
  expect(await connection.recover()).toEqual({ ok: true, value: undefined });
});
it.each(['FILE_GRANT_EXPIRED', 'FILE_GRANT_CONSUMED'])('continues after proven pre-admission %s and preserves the import evidence', async code => {
  const { root, engine } = await setup();
  if (code === 'FILE_GRANT_CONSUMED') expect(await engine.commands.execute({ ...await importCommand(engine, root), commandId: 'accepted-import' })).toMatchObject({ ok: true });
  const input = { ...await importCommand(engine, root, code === 'FILE_GRANT_EXPIRED' ? Date.now() - 1000 : Date.now() + 60000), commandId: 'unaccepted-import' };
  const path = join(root, 'client/pre-admission.sqlite'), outbox = new CommandOutbox(path); outboxes.push(outbox); outbox.enqueue(input); outbox.enqueue(command(engine, 'later', 'After rejected import'));
  const connection = new LocalConnection({ identity: engine.identity, execute: async c => engine.commands.execute(c), query: async q => engine.commands.query(q), readEvents: async q => engine.events.read(q) }, outbox);
  expect(await connection.recover()).toEqual({ ok: true, value: undefined });
  const db = new DatabaseSync(path); expect(db.prepare('SELECT error_code,request_hash FROM rejected_command').get()).toMatchObject({ error_code: code, request_hash: requestHash(input) }); db.close();
  expect(outbox.pending(input.libraryId)).toHaveLength(0); expect(engine.projects.list()).toMatchObject({ ok: true, value: [{ name: 'After rejected import' }] });
});
it('retains an accepted uncertain import after restart, then recovers its batch and original receipt without a memory grant', async () => {
  let interrupted = true;
  const assets: ObjectStoreOptions = { onPhase: phase => { if (phase === 'beforePublish' && interrupted) throw Error('fixture publication interruption'); } };
  const { root, engine } = await setup({ assets }), input = await importCommand(engine, root), path = join(root, 'client/accepted-import.sqlite');
  const outbox = new CommandOutbox(path); outboxes.push(outbox); outbox.enqueue(input); outbox.enqueue(command(engine, 'after-accepted', 'After accepted import'));
  expect(await engine.commands.execute(input)).toMatchObject({ ok: false, error: { code: 'COLLECTION_INTERRUPTED' } }); await engine.close();
  const reopened = await startEngine({ root: join(root, 'library'), assets }); if (!reopened.ok) throw Error(reopened.error.code); engines.push(reopened.value);
  const connection = new LocalConnection({ identity: reopened.value.identity, execute: async c => reopened.value.commands.execute(c), query: async q => reopened.value.commands.query(q), readEvents: async q => reopened.value.events.read(q) }, outbox);
  expect(await connection.recover()).toMatchObject({ ok: false, error: { code: 'COLLECTION_INTERRUPTED' } });
  expect(outbox.pending(input.libraryId).map(c => c.commandId)).toEqual([input.commandId, 'after-accepted']);
  const db = new DatabaseSync(path); expect(db.prepare('SELECT count(*) AS n FROM rejected_command').get()).toMatchObject({ n: 0 }); db.close();
  interrupted = false; expect(await connection.recover()).toEqual({ ok: true, value: undefined });
  const original = await reopened.value.commands.execute(input); expect(original).toMatchObject({ ok: true });
  outbox.enqueue(input); expect(await connection.recover()).toEqual({ ok: true, value: undefined });
  expect(await reopened.value.commands.execute(input)).toEqual(original);
  expect(outbox.pending(input.libraryId)).toHaveLength(0); expect(reopened.value.assets.search().assets).toHaveLength(1);
  expect(reopened.value.projects.list()).toMatchObject({ ok: true, value: [{ name: 'After accepted import' }] });
});
it('stops a queued old-library event batch immediately when its first callback switches connection', async () => {
  const { root, engine } = await setup(), { engine: other } = await setup();
  const outbox = new CommandOutbox(join(root, 'client/switch.sqlite')); outboxes.push(outbox);
  const connection = new LocalConnection({ identity: engine.identity, execute: async c => engine.commands.execute(c), query: async q => engine.commands.query(q), readEvents: async q => engine.events.read(q) }, outbox);
  const initial = engine.events.read({ libraryId: engine.identity.libraryId, connectionEpoch: connection.connectionEpoch }); if (!initial.ok) throw Error(initial.error.code);
  await engine.commands.execute(command(engine, 'old-first')); await engine.commands.execute(command(engine, 'old-second'));
  const events: string[] = [];
  const next = new LocalConnection({ identity: other.identity, execute: async c => other.commands.execute(c), query: async q => other.commands.query(q), readEvents: async q => other.events.read(q) }, outbox);
  const stop = await connection.subscribe({ libraryId: engine.identity.libraryId, connectionEpoch: connection.connectionEpoch, cursor: initial.value.cursor }, event => { events.push(event.libraryId); connection.disconnect(); });
  expect((await next.describe()).ok).toBe(true); expect(events).toEqual([engine.identity.libraryId]); stop(); next.disconnect();
});
it('quarantines definitive outbox rejection, continues later recovery, and retains uncertain writes', async () => {
  const { root, engine } = await setup();
  const outbox = new CommandOutbox(join(root, 'client/rejected.sqlite')); outboxes.push(outbox);
  await engine.commands.execute(command(engine, 'reused', 'Original'));
  outbox.enqueue(command(engine, 'reused', 'Different'));
  outbox.enqueue(command(engine, 'later', 'Recovered later'));
  outbox.enqueue(command(engine, 'uncertain', 'Unknown transport'));
  const connection = new LocalConnection({ identity: engine.identity, execute: async input => (input as CommandEnvelope).commandId === 'uncertain' ? Promise.reject(Error('disconnect')) : engine.commands.execute(input), query: async input => engine.commands.query(input), readEvents: async input => engine.events.read(input) }, outbox);
  expect(await connection.recover()).toMatchObject({ ok: false, error: { code: 'ENGINE_DISCONNECTED' } });
  expect(engine.projects.list()).toMatchObject({ ok: true, value: [{ name: 'Original' }, { name: 'Recovered later' }] });
  expect(outbox.pending(engine.identity.libraryId).map(c => c.commandId)).toEqual(['uncertain']);
  const db = new DatabaseSync(join(root, 'client/rejected.sqlite'));
  expect(db.prepare('SELECT command_id,error_code,envelope_json FROM rejected_command').get()).toMatchObject({ command_id: 'reused', error_code: 'COMMAND_ID_REUSED', envelope_json: expect.stringContaining('Different') }); db.close();
});
async function setup(options: { assets?: ObjectStoreOptions } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'libtv-command-')); roots.push(root);
  const result = await startEngine({ root: join(root, 'library'), ...options });
  if (!result.ok) throw new Error(result.error.message);
  engines.push(result.value);
  return { root, engine: result.value };
}
function command(engine: EngineHandle, commandId = 'create-1', name = 'Project A'): CommandEnvelope<'project.create'> {
  return { schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: engine.identity.instanceId, commandId, kind: 'project.create', payload: { name } };
}
async function importCommand(engine: EngineHandle, root: string, expiresAt = Date.now() + 60000): Promise<CommandEnvelope<'asset.importGrantedFiles'>> {
  const path = join(root, 'identity-fixture.png');
  await writeFile(path, await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ad1234' } }).png().toBuffer());
  const s = await stat(path);
  const registered = engine.assets.registerGrant({ grantId: 'identity-grant', importId: 'identity-import', libraryId: engine.identity.libraryId, expiresAt, files: [{ path, realPath: path, allowedRoot: root, name: 'Identity fixture', size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino }] });
  if (!registered.ok) throw new Error(registered.error.message);
  return { ...command(engine), kind: 'asset.importGrantedFiles', payload: { grantId: 'identity-grant' } };
}
afterEach(async () => {
  for (const outbox of outboxes.splice(0)) outbox.close();
  for (const engine of engines.splice(0)) await engine.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// Removing receipt lookup or persisting it after the mutation creates duplicates.
it('returns the original committed receipt after lost ACK and engine restart; same ID with changed payload is rejected', async () => {
  const { root, engine } = await setup();
  const input = command(engine);
  const first = engine.commands.execute(input);
  expect(first).toMatchObject({ ok: true, value: { commandId: 'create-1', committedSeq: 1, result: { name: 'Project A' } } });
  expect(engine.commands.execute(input)).toEqual(first);
  expect(engine.commands.execute({ ...input, payload: { name: 'Different' } })).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_REUSED' } });
  await engine.close();
  const reopened = await startEngine({ root: join(root, 'library') });
  if (!reopened.ok) throw new Error(reopened.error.message);
  engines.push(reopened.value);
  expect(reopened.value.commands.execute({ ...input, connectionEpoch: reopened.value.identity.instanceId })).toEqual(first);
  expect(reopened.value.projects.list()).toMatchObject({ ok: true, value: [{ name: 'Project A' }] });
  const db = new DatabaseSync(join(root, 'library/library.sqlite'), { readOnly: true });
  expect(db.prepare('SELECT COUNT(*) AS count FROM project').get()).toMatchObject({ count: 1 });
  expect(db.prepare('SELECT COUNT(*) AS count FROM command_receipt').get()).toMatchObject({ count: 1 });
  expect(db.prepare('SELECT COUNT(*) AS count FROM domain_event').get()).toMatchObject({ count: 1 }); db.close();
});

// A failed event insert must roll back the already inserted project and receipt.
it('commits domain changes, receipt and event atomically', async () => {
  const { root, engine } = await setup();
  const db = new DatabaseSync(join(root, 'library/library.sqlite'));
  db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON domain_event BEGIN SELECT RAISE(ABORT, 'disk failure fixture'); END");
  expect(engine.commands.execute(command(engine))).toMatchObject({ ok: false, error: { code: 'COMMAND_COMMIT_FAILED' } });
  expect(db.prepare('SELECT COUNT(*) AS count FROM project').get()).toMatchObject({ count: 0 });
  expect(db.prepare('SELECT COUNT(*) AS count FROM command_receipt').get()).toMatchObject({ count: 0 });
  db.exec('DROP TRIGGER fail_event'); db.close();
  expect(engine.commands.execute(command(engine))).toMatchObject({ ok: true });
});

it('rejects a different command kind while an accepted import is still collecting', async () => {
  let entered!: () => void, release!: () => void;
  const accepting = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const { root, engine } = await setup({ assets: { onPhase: async phase => { if (phase === 'staging') { entered(); await held; } } } });
  const input = await importCommand(engine, root);
  const importing = engine.commands.execute(input);
  try {
    await accepting;
    expect(await engine.commands.execute(command(engine))).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_REUSED' } });
    expect(engine.projects.list()).toMatchObject({ ok: true, value: [] });
  } finally { release(); await importing; }
  expect(await importing).toMatchObject({ ok: true, value: { result: { state: 'ready' } } });
});

it('rechecks command identity when a queued import reaches durable acceptance', async () => {
  const { root, engine } = await setup(); const input = await importCommand(engine, root);
  const importing = engine.commands.execute(input);
  // Import acceptance runs on its queued microtask; this synchronous command commits first.
  const project = await engine.commands.execute(command(engine));
  expect(project).toMatchObject({ ok: true });
  expect(await importing).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_REUSED' } });
  const db = new DatabaseSync(join(root, 'library/library.sqlite'), { readOnly: true });
  try { expect(db.prepare('SELECT COUNT(*) AS count FROM import_batch').get()).toMatchObject({ count: 0 }); }
  finally { db.close(); }
});

// Omitting snapshot cursor or accepting future/foreign cursors loses events or crosses libraries.
it('snapshots and resumes without gaps and returns explicit resync errors for invalid cursors', async () => {
  const { engine } = await setup();
  const initial = engine.events.read({ libraryId: engine.identity.libraryId, connectionEpoch: engine.identity.instanceId });
  if (!initial.ok) throw new Error(initial.error.message);
  expect(initial.value.snapshot).toMatchObject({ projects: [], snapshotSeq: 0 });
  engine.commands.execute(command(engine));
  const next = engine.events.read({ libraryId: engine.identity.libraryId, connectionEpoch: engine.identity.instanceId, cursor: initial.value.cursor });
  expect(next).toMatchObject({ ok: true, value: { events: [{ kind: 'project.created', seq: 1, payload: { name: 'Project A' } }] } });
  expect(engine.events.read({ libraryId: engine.identity.libraryId, connectionEpoch: engine.identity.instanceId, cursor: { ...initial.value.cursor, seq: 99 } })).toMatchObject({ ok: false, error: { code: 'RESYNC_REQUIRED' } });
  expect(engine.events.read({ libraryId: engine.identity.libraryId, connectionEpoch: engine.identity.instanceId, cursor: { ...initial.value.cursor, streamId: 'foreign' } })).toMatchObject({ ok: false, error: { code: 'RESYNC_REQUIRED' } });
});

// Enqueue must be durable before a send, and an ACK must match all three identifiers.
it('recovers main-owned outbox after reopen and only settles matching library, ID and hash', async () => {
  const { root, engine } = await setup();
  const path = join(root, 'client/outbox.sqlite');
  const first = new CommandOutbox(path); outboxes.push(first);
  const input = command(engine);
  expect(first.enqueue(input)).toMatchObject({ ok: true });
  expect(first.enqueue({ ...input, payload: { name: 'Changed' } })).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_REUSED' } });
  first.close();
  const recovered = new CommandOutbox(path); outboxes.push(recovered);
  expect(recovered.pending(engine.identity.libraryId)).toHaveLength(1);
  const receipt = (await engine.commands.execute(input));
  if (!receipt.ok) throw new Error(receipt.error.message);
  expect(recovered.settle({ ...receipt.value, requestHash: '0'.repeat(64) })).toBe(false);
  expect(recovered.settle({ ...receipt.value, libraryId: 'other' })).toBe(false);
  expect(recovered.pending(engine.identity.libraryId)).toHaveLength(1);
  expect(recovered.settle(receipt.value)).toBe(true);
  expect(recovered.pending(engine.identity.libraryId)).toHaveLength(0);
});

// A late A response may settle A, but cannot mutate the newly connected B view/outbox.
it('settles late ACK only in its original library and rejects delivery to a stale connection', async () => {
  const { root, engine: a } = await setup();
  const { engine: b } = await setup();
  const outbox = new CommandOutbox(join(root, 'client/outbox.sqlite')); outboxes.push(outbox);
  let release!: (value: unknown) => void;
  const delayed = new Promise<unknown>(resolve => { release = resolve; });
  const connection = new LocalConnection({ identity: a.identity, execute: async () => delayed, query: async () => { throw new Error('unused'); }, readEvents: async () => { throw new Error('unused'); } }, outbox);
  const input = { ...command(a), connectionEpoch: connection.connectionEpoch };
  const pending = connection.execute(input);
  expect(outbox.pending(a.identity.libraryId)).toHaveLength(1);
  connection.disconnect();
  outbox.enqueue(command(b));
  release(a.commands.execute(input));
  expect(await pending).toMatchObject({ ok: false, error: { code: 'STALE_CONNECTION' } });
  expect(outbox.pending(a.identity.libraryId)).toHaveLength(0);
  expect(outbox.pending(b.identity.libraryId)).toHaveLength(1);
});

it('rejects malformed inputs, wrong library/epoch, and unimplemented feature names without writes', async () => {
  const { engine } = await setup();
  expect(engine.commands.execute({ ...command(engine), payload: { name: 42 } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(engine.commands.execute({ ...command(engine), libraryId: 'foreign' })).toMatchObject({ ok: false, error: { code: 'WRONG_LIBRARY' } });
  expect(engine.commands.execute({ ...command(engine), kind: 'workflow.execute' })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
  expect(engine.projects.list()).toEqual({ ok: true, value: [] });
});

// Replaying an ACK-lost command must work through recovery, not only direct engine calls.
it('replays the durable queue after client and engine restart without another project or event', async () => {
  const { root, engine } = await setup();
  const input = command(engine);
  const path = join(root, 'client/outbox.sqlite');
  const oldOutbox = new CommandOutbox(path); outboxes.push(oldOutbox);
  oldOutbox.enqueue(input);
  const committed = (await engine.commands.execute(input));
  expect(committed.ok).toBe(true);
  oldOutbox.close(); await engine.close();
  const restarted = await startEngine({ root: join(root, 'library') });
  if (!restarted.ok) throw new Error(restarted.error.message);
  engines.push(restarted.value);
  const recovered = new CommandOutbox(path); outboxes.push(recovered);
  const connection = new LocalConnection({ identity: restarted.value.identity, execute: async value => restarted.value.commands.execute(value), query: async value => restarted.value.commands.query(value), readEvents: async value => restarted.value.events.read(value) }, recovered);
  expect(await connection.recover()).toEqual({ ok: true, value: undefined });
  expect(recovered.pending(restarted.value.identity.libraryId)).toHaveLength(0);
  expect(await connection.query({ schemaVersion: 1, libraryId: restarted.value.identity.libraryId, connectionEpoch: connection.connectionEpoch, queryId: 'receipt-query', kind: 'command.receipt', payload: { commandId: input.commandId } })).toEqual(committed);
  expect(await connection.query({ schemaVersion: 1, libraryId: restarted.value.identity.libraryId, connectionEpoch: connection.connectionEpoch, queryId: 'missing-receipt', kind: 'command.receipt', payload: { commandId: 'missing' } })).toEqual({ ok: true, value: null });
  const snapshot = restarted.value.events.read({ libraryId: restarted.value.identity.libraryId, connectionEpoch: restarted.value.identity.instanceId });
  expect(snapshot).toMatchObject({ ok: true, value: { snapshot: { snapshotSeq: 1, projects: [{ name: 'Project A' }] } } });
});

// A cursor before retention is an explicit resync, and missing journal rows cannot be silently skipped.
it('rejects expired or discontinuous durable event cursors', async () => {
  const { root, engine } = await setup();
  engine.commands.execute(command(engine));
  engine.commands.execute(command(engine, 'create-2', 'Project B'));
  const snapshot = engine.events.read({ libraryId: engine.identity.libraryId, connectionEpoch: engine.identity.instanceId });
  if (!snapshot.ok) throw new Error(snapshot.error.message);
  const db = new DatabaseSync(join(root, 'library/library.sqlite'));
  db.exec('UPDATE event_stream SET first_seq=2');
  const base = { libraryId: engine.identity.libraryId, connectionEpoch: engine.identity.instanceId };
  expect(engine.events.read({ ...base, cursor: { ...snapshot.value.cursor, seq: 0 } })).toMatchObject({ ok: false, error: { code: 'RESYNC_REQUIRED' } });
  db.exec('UPDATE event_stream SET first_seq=1; PRAGMA foreign_keys=OFF; DELETE FROM domain_event WHERE seq=1');
  expect(engine.events.read({ ...base, cursor: { ...snapshot.value.cursor, seq: 0 } })).toMatchObject({ ok: false, error: { code: 'RESYNC_REQUIRED' } });
  db.close();
});

// Wrong hash or malformed persisted output must never clear an unconfirmed operation.
it('validates receipts and snapshots at the utility boundary and preserves pending operations on malformed ACKs', async () => {
  const { root, engine } = await setup();
  const outbox = new CommandOutbox(join(root, 'client/outbox.sqlite')); outboxes.push(outbox);
  const input = command(engine);
  const receipt = (await engine.commands.execute(input));
  if (!receipt.ok) throw new Error(receipt.error.message);
  const connection = new LocalConnection({ identity: engine.identity, execute: async () => ({ ok: true, value: { ...receipt.value, requestHash: '0'.repeat(64) } }), query: async () => ({ ok: true, value: { projects: [{ id: 42 }], snapshotSeq: 1, streamId: 'stream' } }), readEvents: async () => ({ ok: true, value: { events: [], cursor: { libraryId: 'foreign', streamId: 'stream', seq: 0 } } }) }, outbox);
  expect(await connection.execute({ ...input, connectionEpoch: connection.connectionEpoch })).toMatchObject({ ok: false, error: { code: 'INVALID_ENGINE_RESPONSE' } });
  expect(outbox.pending(engine.identity.libraryId)).toHaveLength(1);
  expect(await connection.query({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: connection.connectionEpoch, queryId: 'query', kind: 'project.list', payload: {} })).toMatchObject({ ok: false, error: { code: 'INVALID_ENGINE_RESPONSE' } });
  expect(await connection.readEvents({ libraryId: engine.identity.libraryId, connectionEpoch: connection.connectionEpoch })).toMatchObject({ ok: false, error: { code: 'INVALID_ENGINE_RESPONSE' } });
});

// A→B→A may reuse the same engine process; connection identity must still advance.
it('assigns a fresh client epoch when reconnecting to the same running engine', async () => {
  const { root, engine } = await setup();
  const outbox = new CommandOutbox(join(root, 'client/outbox.sqlite')); outboxes.push(outbox);
  const transport = { identity: engine.identity, execute: async (input: unknown) => engine.commands.execute(input), query: async (input: unknown) => engine.commands.query(input), readEvents: async (input: unknown) => engine.events.read(input) };
  const first = new LocalConnection(transport, outbox);
  const before = await first.describe();
  first.disconnect();
  const second = new LocalConnection(transport, outbox);
  const after = await second.describe();
  if (!before.ok || !after.ok) throw new Error('No descriptor');
  expect(after.value.instanceId).toBe(before.value.instanceId);
  expect(after.value.connectionEpoch).not.toBe(before.value.connectionEpoch);
  expect(await second.execute({ ...command(engine), connectionEpoch: before.value.connectionEpoch })).toMatchObject({ ok: false, error: { code: 'STALE_CONNECTION' } });
  expect(await second.execute({ ...command(engine), connectionEpoch: after.value.connectionEpoch })).toMatchObject({ ok: true });
});

// A commit during snapshot delivery must be replayed, and an old subscription must stop.
it('delivers a commit made during subscription snapshot callback and stops events after disconnect', async () => {
  const { root, engine } = await setup();
  const outbox = new CommandOutbox(join(root, 'client/outbox.sqlite')); outboxes.push(outbox);
  const connection = new LocalConnection({ identity: engine.identity, execute: async value => engine.commands.execute(value), query: async value => engine.commands.query(value), readEvents: async value => engine.events.read(value) }, outbox);
  const received: number[] = [];
  let observed!: () => void;
  const eventArrived = new Promise<void>(resolve => { observed = resolve; });
  const stop = await connection.subscribe({ libraryId: engine.identity.libraryId, connectionEpoch: connection.connectionEpoch }, event => { received.push(event.seq); observed(); }, snapshot => {
    expect(snapshot.snapshotSeq).toBe(0);
    engine.commands.execute(command(engine));
  });
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([eventArrived, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('Committed event was lost')), 1500); })]);
    expect(received).toEqual([1]);
    connection.disconnect();
    engine.commands.execute(command(engine, 'after-disconnect'));
    expect(await connection.readEvents({ libraryId: engine.identity.libraryId, connectionEpoch: connection.connectionEpoch })).toMatchObject({ ok: false, error: { code: 'STALE_CONNECTION' } });
    expect(received).toEqual([1]);
  } finally { clearTimeout(watchdog); stop(); }
});
