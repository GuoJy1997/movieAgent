import { CURRENT_SCHEMA_VERSION } from '../../packages/contracts/src/schema.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';

// Delay only the manifest unlink boundary; all directory, SQLite, and other file I/O is real.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});

const roots: string[] = [];
const handles: EngineHandle[] = [];
const children: ChildProcess[] = [];
async function libraryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'libtv-project-test-'));
  roots.push(root);
  return root;
}
async function open(root: string) {
  const result = await startEngine({ root });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  handles.push(result.value);
  return result.value;
}
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await exited;
    }
  }
  for (const handle of handles.splice(0)) await handle.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('persistent project library', () => {
  // Catches omitted INSERT/commit, identity regeneration, and missing disk reopen.
  it('preserves project identity and name after closing and reopening the real SQLite library', async () => {
    const root = await libraryRoot();
    const first = await open(root);
    const created = first.projects.create({ name: '镜头实验' });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.message);
    const identity = first.identity;
    expect((await first.close()).ok).toBe(true);
    const second = await open(root);
    expect(second.identity.libraryId).toBe(identity.libraryId);
    expect(second.identity.instanceId).not.toBe(identity.instanceId);
    expect(second.projects.list()).toEqual({ ok: true, value: [created.value] });
    expect(created.value.name).toBe('镜头实验');
    expect(created.value.id).toEqual(expect.any(String));
    const db = new DatabaseSync(join(root, 'library.sqlite'), { readOnly: true });
    expect(db.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: CURRENT_SCHEMA_VERSION });
    expect(db.prepare('SELECT name FROM project').get()).toMatchObject({ name: '镜头实验' });
    db.close();
  });

  // Catches a lock missing from startup or a losing startup deleting the winner's resources.
  it('rejects a second writer without disturbing the current owner, then permits restart', async () => {
    const root = await libraryRoot();
    const owner = await open(root);
    const lockBefore = await readFile(join(root, 'engine.lock'), 'utf8');
    const contender = await startEngine({ root: join(root, '.') });
    expect(contender).toMatchObject({ ok: false, error: { code: 'LIBRARY_IN_USE' } });
    expect(await readFile(join(root, 'engine.lock'), 'utf8')).toBe(lockBefore);
    expect(owner.projects.create({ name: 'Owner is still active' }).ok).toBe(true);
    expect((await owner.close()).ok).toBe(true);
    const replacement = await open(root);
    await owner.close();
    expect(replacement.projects.create({ name: 'Replacement owns resources' }).ok).toBe(true);
    expect(replacement.projects.list()).toMatchObject({ ok: true, value: [{ name: 'Owner is still active' }, { name: 'Replacement owns resources' }] });
  });

  it('recovers a stale manifest only after acquiring the OS-released guard, ignoring a live unrelated PID', async () => {
    const root = await libraryRoot();
    await writeFile(join(root, 'engine.lock'), JSON.stringify({ instanceId: 'stale', pid: process.pid }));
    const engine = await open(root);
    expect(engine.identity.instanceId).not.toBe('stale');
    expect(engine.projects.create({ name: 'Recovered' }).ok).toBe(true);
    expect(JSON.parse(await readFile(join(root, 'engine.lock'), 'utf8')).instanceId).toBe(engine.identity.instanceId);
  });

  // Catches in-memory-only locks and crash recovery that requires a graceful close.
  it('excludes an engine in a separate process and recovers after that owned process crashes', async () => {
    const root = await libraryRoot();
    const bootstrap = pathToFileURL(join(process.cwd(), 'packages/engine/src/bootstrap.ts')).href;
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
      import { startEngine } from ${JSON.stringify(bootstrap)};
      const result = await startEngine({ root: ${JSON.stringify(root)} });
      if (!result.ok) throw new Error(result.error.message);
      console.log(JSON.stringify(result.value.identity));
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    const identity = await new Promise<{ instanceId: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Child engine handshake timed out')), 5000);
      let buffer = '';
      let stderr = '';
      child.stderr?.on('data', chunk => { stderr += chunk; });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Child exited ${code}: ${stderr}`)); });
      child.stdout?.on('data', chunk => {
        buffer += chunk;
        if (buffer.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(buffer.trim())); }
      });
    });
    expect(await startEngine({ root })).toMatchObject({ ok: false, error: { code: 'LIBRARY_IN_USE' } });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill(); // Only the process object launched above is terminated.
    await exited;
    const recovered = await open(root);
    expect(recovered.identity.instanceId).not.toBe(identity.instanceId);
    expect(recovered.projects.create({ name: 'After crash' }).ok).toBe(true);
  });

  it('rejects invalid project names and writes after close', async () => {
    const engine = await open(await libraryRoot());
    expect(engine.projects.create({ name: '  ' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(engine.projects.create({ name: 42 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await engine.close();
    expect(engine.projects.create({ name: 'Too late' })).toMatchObject({ ok: false, error: { code: 'ENGINE_CLOSED' } });
  });

  it('bounds close while retaining the guard until delayed manifest cleanup finishes', async () => {
    const root = await libraryRoot();
    const owner = await open(root);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let release!: () => void;
    let reached!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { reached = resolve; });
    vi.mocked(unlink).mockImplementationOnce(async path => {
      reached();
      await delayed;
      await actual.unlink(path);
    });
    const closing = owner.close();
    await entered;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        closing,
        new Promise<'unbounded'>(resolve => { watchdog = setTimeout(() => resolve('unbounded'), 1600); }),
      ]);
      expect(outcome).toMatchObject({ ok: false, error: { code: 'LIBRARY_CLOSE_TIMEOUT' } });
      expect(await startEngine({ root })).toMatchObject({ ok: false, error: { code: 'LIBRARY_IN_USE' } });
      expect(JSON.parse(await readFile(join(root, 'engine.lock'), 'utf8')).instanceId).toBe(owner.identity.instanceId);
      expect(owner.projects.create({ name: 'Closed immediately' })).toMatchObject({ ok: false, error: { code: 'ENGINE_CLOSED' } });
    } finally {
      clearTimeout(watchdog);
      release();
    }
    let replacement: EngineHandle | undefined;
    await vi.waitFor(async () => {
      const result = await startEngine({ root });
      expect(result.ok).toBe(true);
      if (result.ok) { replacement = result.value; handles.push(result.value); }
    }, { timeout: 1000, interval: 25 });
    expect(replacement).toBeDefined();
    await owner.close();
    expect(JSON.parse(await readFile(join(root, 'engine.lock'), 'utf8')).instanceId).toBe(replacement!.identity.instanceId);
    expect(replacement!.projects.create({ name: 'Replacement remains owner' }).ok).toBe(true);
  });

  // Catches a missing database ownership check even if the OS guard was acquired.
  it('refuses project access after its database ownership token is replaced', async () => {
    const root = await libraryRoot();
    const engine = await open(root);
    const external = new DatabaseSync(join(root, 'library.sqlite'));
    external.prepare('UPDATE engine_owner SET instance_id = ?').run('different-startup-owner');
    expect(engine.projects.create({ name: 'Must not commit' })).toMatchObject({ ok: false, error: { code: 'OWNERSHIP_LOST' } });
    expect(engine.projects.list()).toMatchObject({ ok: false, error: { code: 'OWNERSHIP_LOST' } });
    expect(external.prepare('SELECT COUNT(*) AS count FROM project').get()).toMatchObject({ count: 0 });
    await engine.close();
    expect(external.prepare('SELECT instance_id FROM engine_owner').get()).toMatchObject({ instance_id: 'different-startup-owner' });
    external.close();
  });

  // Catches an unsafe migration changing a future database or leaking its startup lock.
  it('leaves a newer schema untouched and releases only its own startup resources', async () => {
    const root = await libraryRoot();
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec('PRAGMA user_version = 999; CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES (\'keep me\')');
    db.close();
    expect(await startEngine({ root })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_SCHEMA' } });
    const inspect = new DatabaseSync(join(root, 'library.sqlite'));
    expect(inspect.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 999 });
    expect(inspect.prepare('SELECT value FROM future_data').get()).toMatchObject({ value: 'keep me' });
    inspect.exec('PRAGMA user_version = 0');
    inspect.close();
    expect((await open(root)).projects.create({ name: 'Resources were released' }).ok).toBe(true);
  });
});
