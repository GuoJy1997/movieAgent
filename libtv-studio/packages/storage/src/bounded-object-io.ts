import {observeReadPool} from './read-observation.ts';
import { createHash, randomUUID } from 'node:crypto';
import { open, realpath, lstat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { LibraryHandle } from './database.ts';
import type { AuthorizedObjectRead } from './object-store.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { MediaChunk, MediaRangeRequest, ReadLease } from '../../contracts/src/media-info.ts';
const MAX_CHUNK = 1024 * 1024, TTL = 120000;
interface Held { lease: ReadLease; handle: FileHandle; path: string; stamp: string; active: number }
const stamp = (s: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
const canonical = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
/** Fixed object handles stay inside the engine. No external path or unbounded read operation. */
export function boundedObjectIOFor(library: LibraryHandle) {
  const held = new Map<string, Held>();
  const observe=observeReadPool('original');let opening=0,closing=0,activeRanges=0,closeFailures=0;
  const report=()=>observe(held.size,activeRanges,opening,closing,closeFailures);report();
  async function close(leaseId:string){const value=held.get(leaseId);if(!value)return;held.delete(leaseId);closing++;report();try{await value.handle.close();}catch(error){closeFailures++;throw error;}finally{closing--;report();}}
  return {
    async open(input: AuthorizedObjectRead, expectedHash: string): Promise<Result<ReadLease>> {
      opening++;report();let handle: FileHandle | undefined;
      try {
        const ownership = library.checkOwnership(); if (!ownership.ok) return ownership;
        if (input.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '媒体属于其他资料库。');
        const r = input.receipt;
        if (!/^[a-f0-9]{64}$/.test(expectedHash) || r.hash !== expectedHash || r.objectId !== expectedHash || r.storageKey !== `objects/${expectedHash.slice(0, 2)}/${expectedHash}` || !Number.isSafeInteger(r.byteLength) || r.byteLength <= 0 || r.byteLength > 2 * 1024 ** 3) return fail('OBJECT_INTEGRITY_FAILED', '原件身份无效。');
        for (const [id, value] of held) if (value.lease.expiresAt <= Date.now()) await close(id);
        if (held.size >= 64) return fail('MEDIA_CAPACITY', '媒体读取会话过多。');
        const path = join(library.root, r.storageKey), resolved = await realpath(path);
        if (canonical(resolved) !== canonical(path) || (await lstat(path)).isSymbolicLink()) return fail('OBJECT_INTEGRITY_FAILED', '原件路径改变。');
        handle = await open(path, 'r'); const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.size !== BigInt(r.byteLength)) throw Error('integrity');
        const cached = library.db.prepare('SELECT * FROM media_verification WHERE object_hash=?').get(expectedHash);
        if (!cached || cached.byte_length !== r.byteLength || cached.device !== String(before.dev) || cached.inode !== String(before.ino) || cached.mtime_ns !== String(before.mtimeNs) || cached.ctime_ns !== String(before.ctimeNs)) {
          const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(MAX_CHUNK); let offset = 0;
          for (;;) { const read = await handle.read(buffer, 0, buffer.length, offset); if (!read.bytesRead) break; hash.update(buffer.subarray(0, read.bytesRead)); offset += read.bytesRead; }
          if (offset !== r.byteLength || hash.digest('hex') !== expectedHash || stamp(await handle.stat({ bigint: true })) !== stamp(before)) throw Error('integrity');
          const own = library.checkOwnership(); if (!own.ok) return own;
          library.db.prepare('INSERT INTO media_verification VALUES(?,?,?,?,?,?,?) ON CONFLICT(object_hash) DO UPDATE SET byte_length=excluded.byte_length,device=excluded.device,inode=excluded.inode,mtime_ns=excluded.mtime_ns,ctime_ns=excluded.ctime_ns,verified_at=excluded.verified_at').run(expectedHash, r.byteLength, String(before.dev), String(before.ino), String(before.mtimeNs), String(before.ctimeNs), Date.now());
        }
        const lease = { leaseId: randomUUID(), hash: expectedHash, byteLength: r.byteLength, mime: r.mime, expiresAt: Date.now() + TTL };
        held.set(lease.leaseId, { lease, handle, path, stamp: stamp(before), active: 0 }); handle = undefined; return ok(lease);
      } catch { return fail('OBJECT_INTEGRITY_FAILED', '原件已改变或无法验证。'); } finally { try{await handle?.close();}catch(error){closeFailures++;throw error;}finally{opening--;report();} }
    },
    async read(input: MediaRangeRequest): Promise<Result<MediaChunk>> {
      const own = library.checkOwnership(); if (!own.ok) return own;
      if (!input || typeof input.leaseId !== 'string' || !Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(input.length) || input.length < 1 || input.length > MAX_CHUNK) return fail('INVALID_MEDIA_RANGE', '媒体数据块范围无效。');
      const value = held.get(input.leaseId);
      if (!value || value.lease.expiresAt <= Date.now()) { await close(input.leaseId); return fail('MEDIA_LEASE_EXPIRED', '读取授权已到期，请续期。'); }
      if (value.active >= 2) return fail('MEDIA_READ_BUSY', '最多同时读取两个数据块。');
      if (input.offset >= value.lease.byteLength) return fail('INVALID_MEDIA_RANGE', '媒体数据块越界。');
      value.active++;activeRanges++;report();
      try {
        if (stamp(await value.handle.stat({ bigint: true })) !== value.stamp || stamp(await lstat(value.path, { bigint: true })) !== value.stamp || canonical(await realpath(value.path)) !== canonical(value.path)) throw Error('changed');
        const bytes = Buffer.allocUnsafe(Math.min(input.length, value.lease.byteLength - input.offset)); const result = await value.handle.read(bytes, 0, bytes.length, input.offset);
        if (result.bytesRead !== bytes.length || stamp(await value.handle.stat({ bigint: true })) !== value.stamp || !library.checkOwnership().ok) throw Error('changed');
        return ok({ leaseId: input.leaseId, offset: input.offset, bytes, eof: input.offset + bytes.length === value.lease.byteLength });
      } catch { return fail('OBJECT_INTEGRITY_FAILED', '原件在读取期间改变。'); } finally { value.active--;activeRanges--;report(); }
    },
    close,
    async dispose() { await Promise.all([...held.keys()].map(close)); },
  };
}
