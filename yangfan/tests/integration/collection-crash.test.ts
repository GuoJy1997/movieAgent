import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChildProcess } from 'node:child_process';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { imageProviderServer } from '../fixtures/image-provider-server.ts';
import { lifecycleChild, stopChild } from '../fixtures/lifecycle-process.ts';
const roots: string[] = [], children: ChildProcess[] = [], servers: Awaited<ReturnType<typeof imageProviderServer>>[] = [];
afterEach(async () => { for (const c of children.splice(0)) await stopChild(c); for (const s of servers.splice(0)) await s.close(); for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
it.each(['before-send', 'after-response', 'durable-unpublished'])('recovers a real child crash at %s without another POST', async fault => {
  const root = await mkdtemp(join(tmpdir(), 'libtv-crash-')); roots.push(root);
  const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#abc123' } }).png().toBuffer(); await writeFile(join(root, 'fixture.png'), bytes);
  const server = await imageProviderServer(); servers.push(server); server.setMode('completed');
  const first = lifecycleChild(root, server.url, fault); children.push(first.child); await first.phase(fault);
  expect(server.posts).toBe(fault === 'before-send' ? 0 : 1); await stopChild(first.child);
  const second = lifecycleChild(root, server.url, 'none', 'recover'); children.push(second.child); const recovered = await second.phase('recovered');
  expect(server.posts).toBe(fault === 'before-send' ? 0 : 1);
  if (fault === 'durable-unpublished') {
    expect(recovered.tasks[0]).toMatchObject({ state: 'SUCCEEDED', providerState: 'completed', collectionState: 'durable' });
    const db = new DatabaseSync(join(root, 'library.sqlite'), { readOnly: true }); const blob = db.prepare('SELECT hash,storage_key FROM blob_object').get()!; db.close();
    expect(blob.hash).toBe(createHash('sha256').update(bytes).digest('hex')); expect(await readFile(join(root, blob.storage_key as string))).toEqual(bytes);
  } else expect(recovered.tasks[0]).toMatchObject({ state: 'RECONCILE_REQUIRED', reconcileStatus: 'unsupported', artifactRef: null });
});
