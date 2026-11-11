import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ validation: undefined as Promise<void> | undefined, entered: undefined as (() => void) | undefined, spawned: undefined as (() => void) | undefined, onSpawn: undefined as (() => void) | undefined, autoExit: true, count: 0, killed: 0 }));
vi.mock('node:fs/promises', async original => { const real = await original<typeof import('node:fs/promises')>(); return { ...real, lstat: async (...args: Parameters<typeof real.lstat>) => { state.entered?.(); await state.validation; return real.lstat(...args); } }; });
vi.mock('node:child_process', () => ({ spawn: () => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { state.killed++; queueMicrotask(() => child.emit('close', 0)); return true; } });
  state.count++; state.onSpawn?.(); state.spawned?.(); if (state.autoExit) queueMicrotask(() => child.emit('close', 0)); return child;
} }));
import { compileMediaProcess, runMediaProcess } from '../../packages/engine/src/media/process.ts';
const roots: string[] = [];
beforeEach(() => { Object.assign(state, { validation: undefined, entered: undefined, spawned: undefined, onSpawn: undefined, autoExit: true, count: 0, killed: 0 }); });
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function request() { const root = await mkdtemp(join(tmpdir(), 'p4-cancel-')); roots.push(root); const exe = join(root, 'fixture.exe'); await writeFile(exe, 'not executed'); return compileMediaProcess({ tool: 'ffmpeg', runtime: { runtimeHash: 'a'.repeat(64), ffmpegPath: exe, ffprobePath: exe, fontManifest: { file: 'NotoSansCJKsc-Regular.otf', family: 'Noto Sans CJK SC', version: 'Sans2.004', sha256: 'b'.repeat(64) } }, args: ['-version'], stagingRoot: root, timeoutMs: 1000, maxStdoutBytes: 1024 }); }
it('does not spawn when cancellation arrives during executable validation', async () => {
  const compiled = await request(), abort = new AbortController(); let release!: () => void;
  state.validation = new Promise(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { state.entered = resolve; });
  const running = runMediaProcess(compiled, abort.signal); await entered; abort.abort(); release();
  expect(await running).toMatchObject({ ok: false, error: { code: 'MEDIA_CANCELLED' } }); expect(state.count).toBe(0);
});
it('terminates only its held child when cancelled after spawn', async () => {
  const compiled = await request(), abort = new AbortController(); state.autoExit = false; const spawned = new Promise<void>(resolve => { state.spawned = resolve; });
  const running = runMediaProcess(compiled, abort.signal); await spawned; abort.abort();
  expect(await running).toMatchObject({ ok: false, error: { code: 'MEDIA_CANCELLED' } }); expect(state.count).toBe(1); expect(state.killed).toBe(1);
});
it('does not lose an abort between spawn and listener registration', async () => {
  const compiled = await request(), abort = new AbortController(); state.onSpawn = () => abort.abort();
  expect(await runMediaProcess(compiled, abort.signal)).toMatchObject({ ok: false, error: { code: 'MEDIA_CANCELLED' } }); expect(state.killed).toBe(1);
});
