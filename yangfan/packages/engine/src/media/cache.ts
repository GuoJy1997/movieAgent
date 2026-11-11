import {observeReadPool} from '../../../storage/src/read-observation.ts';
import { randomUUID } from 'node:crypto';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { LibraryHandle } from '../../../storage/src/database.ts';
import { isDerivedMediaRef, type DerivedMediaRef } from '../../../contracts/src/render.ts';
import type { ReadLease, MediaRangeRequest, MediaChunk } from '../../../contracts/src/media-info.ts';
import { fail, ok, type Result } from '../../../contracts/src/result.ts';
import { hashMediaFile } from './verify.ts';
import { boundedObjectIOFor } from '../../../storage/src/bounded-object-io.ts';
const stamp = (value: {
    size: bigint;
    dev: bigint;
    ino: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
}) => [value.size, value.dev, value.ino, value.mtimeNs, value.ctimeNs].join(':');
/** Cache refs deliberately have no MediaReference/original-object conversion. */
export function mediaCacheIOFor(library: LibraryHandle, runtimeHash?: string) {
    const originalIO = boundedObjectIOFor(library);
    const held = new Map<string, {
        lease: ReadLease;
        file: FileHandle;
        path: string;
        stamp: string;
        active: number;
        cacheId: string;
    }>();
    const observe=observeReadPool('derived');let opening=0,closing=0,activeRanges=0,closeFailures=0;
    const report=()=>observe(held.size,activeRanges,opening,closing,closeFailures);report();
    async function close(id:string){const value=held.get(id);if(!value)return;held.delete(id);closing++;report();try{await value.file.close();}catch(error){closeFailures++;throw error;}finally{closing--;report();}}
    return {
        async open(ref: DerivedMediaRef, expectedHash?: string): Promise<Result<ReadLease>> {
            opening++;report();let file: FileHandle | undefined;
            try {
                const own = library.checkOwnership();
                if (!own.ok)
                    return own;
                if (!isDerivedMediaRef(ref) || ref.libraryId !== library.libraryId)
                    return fail('INVALID_DERIVED_REFERENCE', '派生媒体引用无效。');
                const row = library.db.prepare('SELECT * FROM media_cache WHERE cache_id=? AND source_hash=? AND recipe_hash=? AND runtime_hash=?').get(ref.cacheId, ref.sourceHash, ref.recipeHash, runtimeHash ?? '');
                if (!row || typeof row.hash !== 'string' || expectedHash !== undefined && expectedHash !== row.hash || !library.db.prepare('SELECT 1 FROM blob_object WHERE hash=?').get(ref.sourceHash))
                    return fail('DERIVED_MEDIA_MISSING', '派生缓存缺失，请明确重新准备。');
                const source = library.db.prepare('SELECT * FROM blob_object WHERE hash=?').get(ref.sourceHash)!;
                const original = await originalIO.open({
                    libraryId: library.libraryId, receipt: {
                        objectId: String(source.object_id), hash: String(source.hash), byteLength: Number(source.byte_length), storageKey: String(source.storage_key), mime: String(source.mime), width: Number(source.width), height: Number(source.height)
                    }
                }, ref.sourceHash);
                if (!original.ok)
                    return original;
                await originalIO.close(original.value.leaseId);
                if (row.storage_key !== 'cache/media/' + ref.cacheId + '.media')
                    return fail('INVALID_DERIVED_REFERENCE', '缓存身份无效。');
                const path = join(library.root, row.storage_key);
                if ((await realpath(path)).toLowerCase() !== path.toLowerCase() || (await lstat(path)).isSymbolicLink())
                    return fail('CACHE_CORRUPT', '缓存路径改变。');
                const checked = await hashMediaFile(path, 256 * 1024 ** 2, new AbortController().signal);
                if (!checked.ok || checked.value.hash !== row.hash || checked.value.byteLength !== row.byte_length)
                    return fail('CACHE_CORRUPT', '缓存校验失败，请重新准备。');
                if (!library.checkOwnership().ok)
                    return fail('LIBRARY_OWNERSHIP_LOST', '资料库授权失效。');
                for (const [id, value] of held)
                    if (value.lease.expiresAt <= Date.now())
                        await close(id);
                if (held.size >= 64)
                    return fail('MEDIA_CAPACITY', '缓存读取过多。');
                file = await open(path, 'r');
                const facts = await file.stat({
                    bigint: true
                });
                if (!facts.isFile() || facts.size !== BigInt(checked.value.byteLength) || stamp(facts) !== checked.value.identity)
                    return fail('CACHE_CORRUPT', '缓存已改变。');
                const lease: ReadLease = {
                    leaseId: randomUUID(), hash: row.hash, byteLength: checked.value.byteLength, mime: String(row.mime), expiresAt: Date.now() + 120000
                };
                held.set(lease.leaseId, {
                    lease, file, path, stamp: stamp(facts), active: 0, cacheId: ref.cacheId
                });
                file = undefined;
                library.db.prepare('UPDATE media_cache SET last_used_at=? WHERE cache_id=?').run(Date.now(), ref.cacheId);
                return ok(lease);
            }
            catch {
                return fail('DERIVED_MEDIA_MISSING', '派生缓存不可读，请明确重新准备。');
            }
            finally {
                try{await file?.close();}catch(error){closeFailures++;throw error;}finally{opening--;report();}
            }
        },
        async read(input: MediaRangeRequest): Promise<Result<MediaChunk>> {
            const own = library.checkOwnership();
            if (!own.ok)
                return own;
            const value = held.get(input.leaseId);
            if (!value || value.lease.expiresAt <= Date.now()) {
                await close(input.leaseId);
                return fail('MEDIA_LEASE_EXPIRED', '缓存读取授权已到期。');
            }
            if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset >= value.lease.byteLength || !Number.isSafeInteger(input.length) || input.length < 1 || input.length > 1024 * 1024)
                return fail('INVALID_MEDIA_RANGE', '缓存读取范围无效。');
            if (value.active >= 2)
                return fail('MEDIA_READ_BUSY', '最多同时读取两个数据块。');
            value.active++;activeRanges++;report();
            try {
                if (stamp(await value.file.stat({
                    bigint: true
                })) !== value.stamp || stamp(await lstat(value.path, {
                    bigint: true
                })) !== value.stamp)
                    return fail('CACHE_CORRUPT', '缓存在读取期间改变。');
                const bytes = Buffer.allocUnsafe(Math.min(input.length, value.lease.byteLength - input.offset));
                const result = await value.file.read(bytes, 0, bytes.length, input.offset);
                if (result.bytesRead !== bytes.length || stamp(await value.file.stat({
                    bigint: true
                })) !== value.stamp || !library.checkOwnership().ok)
                    return fail('CACHE_CORRUPT', '缓存在读取期间改变。');
                return ok({
                    leaseId: input.leaseId, offset: input.offset, bytes, eof: input.offset + bytes.length === value.lease.byteLength
                });
            }
            finally {
                value.active--;activeRanges--;report();
            }
        },
        close,
        isHeld(cacheId: string) { return [...held.values()].some(value => value.cacheId === cacheId); },
        async dispose() { await Promise.all([...held.keys()].map(close)); await originalIO.dispose(); },
    };
}
