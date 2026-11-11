import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openLibrary } from '../../packages/storage/src/database.ts';

it('verifies once, reads at most one MiB chunks and rejects foreign, closed or changed objects', async () => {
  const module = await import('../../packages/storage/src/bounded-object-io.ts').catch(() => null); expect(module).not.toBeNull(); if (!module) return;
  const root = await mkdtemp(join(tmpdir(), 'p4-bounded-')); const opened = await openLibrary({ root }); if (!opened.ok) throw Error('library');
  try {
    const bytes = Buffer.alloc(3 * 1024 * 1024, 42), hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `objects/${hash.slice(0, 2)}/${hash}`; await mkdir(join(root, 'objects', hash.slice(0, 2)), { recursive: true }); await writeFile(join(root, storageKey), bytes);
    const io = module.boundedObjectIOFor(opened.value); const receipt = { objectId: hash, hash, storageKey, byteLength: bytes.length, mime: 'audio/wav', width: 0, height: 0 };
    expect(await io.open({ libraryId: 'foreign', receipt }, hash)).toMatchObject({ ok: false });
    const lease = await io.open({ libraryId: opened.value.libraryId, receipt }, hash); expect(lease.ok).toBe(true); if (!lease.ok) return;
    expect(await io.read({ leaseId: lease.value.leaseId, offset: 0, length: 1048577 })).toMatchObject({ ok: false });
    const chunk = await io.read({ leaseId: lease.value.leaseId, offset: 1048576, length: 1048576 }); expect(chunk).toMatchObject({ ok: true }); if (chunk.ok) expect(chunk.value.bytes).toEqual(bytes.subarray(1048576, 2097152));
    const parallel = await Promise.all([0, 1, 2].map(offset => io.read({ leaseId: lease.value.leaseId, offset, length: 1 }))); expect(parallel.filter(result => !result.ok)).toHaveLength(1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120001);
    expect(await io.read({ leaseId: lease.value.leaseId, offset: 0, length: 1 })).toMatchObject({ ok: false, error: { code: 'MEDIA_LEASE_EXPIRED' } }); clock.mockRestore();
    const renewed = await io.open({ libraryId: opened.value.libraryId, receipt }, hash); expect(renewed.ok).toBe(true); if (!renewed.ok) return;
    await writeFile(join(root, storageKey), Buffer.alloc(bytes.length, 43)); expect(await io.read({ leaseId: lease.value.leaseId, offset: 0, length: 1 })).toMatchObject({ ok: false });
    expect(await io.read({ leaseId: renewed.value.leaseId, offset: 0, length: 1 })).toMatchObject({ ok: false, error: { code: 'OBJECT_INTEGRITY_FAILED' } });
    await io.close(lease.value.leaseId); expect(await io.read({ leaseId: lease.value.leaseId, offset: 0, length: 1 })).toMatchObject({ ok: false });
    await io.dispose();
  } finally { vi.restoreAllMocks(); await opened.value.close(); await rm(root, { recursive: true, force: true }); }
});
