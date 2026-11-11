import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, statfs, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { LibraryHandle } from './database.ts';
import { collectionJournalFor, type CollectionJob, type DurableObjectReceipt, type FileSourceRef } from './collection-journal.ts';

import { inspectText, MAX_TEXT_BYTES } from './text-media.ts';
import { inspectMp4 } from './mp4.ts';

export interface CollectionLimits { maxBytes: number; maxVideoBytes: number; maxAudioBytes: number; maxPixels: number; reserveBytes: number }
export interface ObjectStoreOptions { limits?: Partial<CollectionLimits>; inspectAudio?: (path: string, stagingRoot: string, hash: string) => Promise<Result<{ mime: string; width: number; height: number }>>; onPhase?: (phase: 'staging' | 'renamed' | 'beforePublish', collectionId: string) => void | Promise<void> }
export interface CollectionRequest { collectionId: string; sourceRef: FileSourceRef }
export interface AuthorizedObjectRead { libraryId: string; receipt: DurableObjectReceipt }
export interface ObjectReadStream { stream: Readable; mime: string; hash: string; byteLength: number }
export interface ObjectStore { collect(input: CollectionRequest): Promise<Result<DurableObjectReceipt>>; read(input: AuthorizedObjectRead): Promise<Result<ObjectReadStream>> }
const canonical = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
const inside = (root: string, path: string) => { const r = relative(root, path); return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
class CollectionError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function objectStoreFor(library: LibraryHandle, options: ObjectStoreOptions = {}) {
  const journal = collectionJournalFor(library);
  const limits: CollectionLimits = { maxBytes: 32 * 1024 * 1024, maxVideoBytes: 64 * 1024 * 1024, maxAudioBytes: 128 * 1024 * 1024, maxPixels: 40_000_000, reserveBytes: 64 * 1024 * 1024, ...options.limits };
  const maximum = (mime: string) => mime === 'text/plain' ? MAX_TEXT_BYTES : mime.startsWith('audio/') ? limits.maxAudioBytes : mime === 'video/mp4' ? limits.maxVideoBytes : limits.maxBytes;
  const owned = () => { const r = library.checkOwnership(); if (!r.ok) throw new CollectionError(r.error.code); };
  async function controlledPath(key: string): Promise<string> {
    if (!/^(?:objects\/[a-f0-9]{2}\/[a-f0-9]{64}|previews\/[a-f0-9]{64}\.png|temp\/[a-zA-Z0-9_-]+\.part)$/.test(key)) throw new CollectionError('INVALID_STORAGE_KEY');
    const path = join(library.root, key); const parent = join(path, '..');
    await mkdir(parent, { recursive: true });
    if (!inside(library.root, await realpath(parent)) || canonical(await realpath(parent)) !== canonical(parent)) throw new CollectionError('INVALID_STORAGE_KEY');
    try { const s = await lstat(path); if (!s.isFile() || s.isSymbolicLink()) throw new CollectionError('INVALID_STORAGE_KEY'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return path;
  }
  async function verified(receipt: DurableObjectReceipt, path?: string, load = false, localPreview = false): Promise<Buffer> {
    const local = localPreview && library.db.prepare('SELECT 1 FROM local_media_output WHERE object_id=?').get(receipt.objectId);
    const ceiling = local ? receipt.mime === 'video/mp4' ? 1024 ** 3 : receipt.mime.startsWith('audio/') ? 128 * 1024 ** 2 : maximum(receipt.mime) : maximum(receipt.mime);
    const expected = `objects/${receipt.hash.slice(0, 2)}/${receipt.hash}`;
    if (!/^[a-f0-9]{64}$/.test(receipt.hash) || receipt.objectId !== receipt.hash || receipt.storageKey !== expected || receipt.byteLength > ceiling) throw new CollectionError('OBJECT_INTEGRITY_FAILED');
    const target = path ?? await controlledPath(receipt.storageKey);
    const handle = await open(target, 'r');
    try {
      const s = await handle.stat(); if (!s.isFile() || s.size !== receipt.byteLength || s.size > ceiling) throw new CollectionError('OBJECT_INTEGRITY_FAILED');
      const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024), chunks: Buffer[] = []; let total = 0;
      for (;;) { const { bytesRead } = await handle.read(buffer); if (!bytesRead) break; total += bytesRead; hash.update(buffer.subarray(0, bytesRead)); if (load || receipt.mime === 'text/plain') chunks.push(Buffer.from(buffer.subarray(0, bytesRead))); }
      const bytes = Buffer.concat(chunks); if (receipt.mime === 'text/plain' && !inspectText(bytes).ok) throw new CollectionError('INVALID_TEXT');
      const after = await handle.stat(); if (total !== receipt.byteLength || hash.digest('hex') !== receipt.hash || after.mtimeMs !== s.mtimeMs || after.ctimeMs !== s.ctimeMs) throw new CollectionError('OBJECT_INTEGRITY_FAILED'); return bytes;
    } finally { await handle.close(); }
  }
  async function inspect(path: string, name: string, hash: string) {
    try {
      const header = Buffer.alloc(16), file = await open(path, 'r'); try { await file.read(header, 0, header.length, 0); } finally { await file.close(); }
      const isAudio = /\.(wav|mp3|m4a)$/i.test(name) || header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE' || header.toString('ascii', 0, 3) === 'ID3' || header[0] === 0xff && (header[1]! & 0xe0) === 0xe0;
      if (isAudio) {
        if (!options.inspectAudio) throw new CollectionError('MEDIA_RUNTIME_UNAVAILABLE');
        if ((await lstat(path)).size > limits.maxAudioBytes) throw new CollectionError('OBJECT_TOO_LARGE');
        const result = await options.inspectAudio(path, join(library.root, 'temp'), hash); if (!result.ok) throw new CollectionError(result.error.code); return result.value;
      }
      const bytes = await readFile(path);
      if (/\.(txt|md)$/i.test(name)) { const result = inspectText(bytes); if (!result.ok) throw new CollectionError(result.error.code); return result.value; }
      if (bytes.toString('ascii', 4, 8) === 'ftyp') {
        if (bytes.length > limits.maxVideoBytes) throw new CollectionError('OBJECT_TOO_LARGE');
        const result = inspectMp4(bytes); if (!result.ok) throw new CollectionError(result.error.code);
        return result.value;
      }
      if (bytes.length > limits.maxBytes) throw new CollectionError('OBJECT_TOO_LARGE');
      const { default: sharp } = await import('sharp');
      const image = sharp(bytes, { limitInputPixels: limits.maxPixels, failOn: 'warning', sequentialRead: true });
      const m = await image.metadata();
      if (!m.width || !m.height || m.width * m.height > limits.maxPixels || (m.pages ?? 1) > 1) throw new CollectionError('PIXEL_LIMIT');
      if (!['png', 'jpeg', 'webp'].includes(m.format ?? '')) throw new CollectionError('UNSUPPORTED_MEDIA');
      // Force a complete bounded decode; metadata alone does not establish a valid original.
      await image.clone().timeout({ seconds: 15 }).raw().toBuffer();
      return { mime: `image/${m.format}`, width: m.width, height: m.height };
    } catch (e) { if (e instanceof CollectionError) throw e; throw new CollectionError(e instanceof Error && /pixel limit/.test(e.message) ? 'PIXEL_LIMIT' : 'INVALID_IMAGE'); }
  }
  async function thumbnail(receipt: DurableObjectReceipt, original: Buffer): Promise<Buffer> {
    const { default: sharp } = await import('sharp');
    const path = await controlledPath(`previews/${receipt.hash}.png`);
    try { const bytes = await readFile(path); await sharp(bytes, { limitInputPixels: 320 * 320 }).raw().toBuffer(); return bytes; }
    catch { /* A preview is a disposable derivation, independent of original integrity. */ }
    // Generic poster; deliberately not an extracted frame.
    const poster = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#20252d"/><path d="M142 65 L142 115 L186 90 Z" fill="#cbd5e1"/></svg>');
    const bytes = (receipt.mime === 'video/mp4' || receipt.mime === 'text/plain' || receipt.mime.startsWith('audio/')) ? await sharp(poster).png().toBuffer() : await sharp(original, { limitInputPixels: limits.maxPixels }).resize(320, 320, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const handle = await open(path, 'w', 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    return bytes;
  }
  return {
    limits,
    async collect(input: CollectionRequest): Promise<Result<DurableObjectReceipt>> {
      let stagePath: string | undefined;
      try {
        owned();
        const job = journal.get(input.collectionId);
        if (!job) return fail('COLLECTION_NOT_FOUND', '收存记录不存在。');
        // The persisted restricted source owns the collection ID; callers cannot rebind it.
        if (JSON.stringify(job.sourceRef) !== JSON.stringify(input.sourceRef)) return fail('COLLECTION_SOURCE_CHANGED', '收存来源与持久记录不一致。');
        stagePath = await controlledPath(`temp/${input.collectionId}.part`);
        let receipt = job.receipt;
        if (!receipt) {
          const src = input.sourceRef;
          if (src.size > Math.max(limits.maxBytes, limits.maxVideoBytes, /\.(wav|mp3|m4a)$/i.test(src.name) ? limits.maxAudioBytes : 0)) throw new CollectionError('OBJECT_TOO_LARGE');
          const space = await statfs(library.root);
          if (!journal.reserve(input.collectionId, src.size * 2 + 320 * 320 * 4 + limits.reserveBytes, Number(space.bavail) * Number(space.bsize))) throw new CollectionError('INSUFFICIENT_SPACE');
          const resolved = await realpath(src.path); const s = await lstat(src.path);
          if (!isAbsolute(src.path) || !inside(src.allowedRoot, resolved) || canonical(resolved) !== canonical(src.realPath) || canonical(resolved) !== canonical(src.path) || s.isSymbolicLink() || !s.isFile()) throw new CollectionError('FILE_GRANT_CHANGED');
          const source = await open(src.path, 'r');
          try {
            const actual = await source.stat();
            if (actual.dev !== src.dev || actual.ino !== src.ino || actual.size !== src.size || actual.mtimeMs !== src.mtimeMs) throw new CollectionError('FILE_GRANT_CHANGED');
            // Only this collection's partial staging path is removed. Final objects are never GC'd.
            await unlink(stagePath).catch(e => { if (e.code !== 'ENOENT') throw e; });
            const target = await open(stagePath, 'wx', 0o600);
            const hash = createHash('sha256'); let total = 0;
            try {
              journal.update(input.collectionId, 'collecting');
              const buffer = Buffer.allocUnsafe(64 * 1024);
              while (true) {
                const { bytesRead } = await source.read(buffer); if (!bytesRead) break;
                total += bytesRead; if (total > Math.max(limits.maxBytes, limits.maxVideoBytes, /\.(wav|mp3|m4a)$/i.test(src.name) ? limits.maxAudioBytes : 0)) throw new CollectionError('OBJECT_TOO_LARGE');
                hash.update(buffer.subarray(0, bytesRead)); await target.writeFile(buffer.subarray(0, bytesRead));
              }
              if (total !== src.size || total === 0) throw new CollectionError('FILE_GRANT_CHANGED');
              await target.sync();
            } finally { await target.close(); }
            const after = await source.stat(); if (after.size !== src.size || after.mtimeMs !== src.mtimeMs) throw new CollectionError('FILE_GRANT_CHANGED');
            const sha = hash.digest('hex'); const metadata = await inspect(stagePath, src.name, sha);
            receipt = { objectId: sha, hash: sha, byteLength: total, storageKey: `objects/${sha.slice(0, 2)}/${sha}`, ...metadata };
            owned(); journal.update(input.collectionId, 'validated', receipt);
          } finally { await source.close(); }
          await options.onPhase?.('staging', input.collectionId);
        }
        const finalPath = await controlledPath(receipt.storageKey);
        try { await verified(receipt); }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          await verified(receipt, stagePath); owned(); await rename(stagePath, finalPath);
          // Flush the immutable original after the namespace move as well.
          const file = await open(finalPath, 'r+'); try { await file.sync(); } finally { await file.close(); }
        }
        owned(); journal.update(input.collectionId, 'durable', receipt);
        await unlink(stagePath).catch(e => { if (e.code !== 'ENOENT') throw e; });
        await options.onPhase?.('renamed', input.collectionId);
        // Previews are regenerated on demand; their failure cannot undo a durable original.
        await thumbnail(receipt, await verified(receipt, undefined, receipt.mime.startsWith('image/'))).catch(() => undefined);
        return ok(receipt);
      } catch (e) {
        const code = e instanceof CollectionError ? e.code : 'COLLECTION_WRITE_FAILED';
        try {
          const row = library.db.prepare('SELECT receipt_json FROM collection_job WHERE collection_id=?').get(input.collectionId);
          journal.update(input.collectionId, ['INVALID_TEXT', 'TEXT_LIMIT', 'INVALID_IMAGE', 'INVALID_VIDEO', 'PIXEL_LIMIT', 'UNSUPPORTED_MEDIA', 'OBJECT_TOO_LARGE', 'FILE_GRANT_CHANGED'].includes(code) ? 'unrecoverable' : 'retryable_failure', undefined, code);
          if (!row?.receipt_json && stagePath) await unlink(stagePath).catch(() => undefined);
          journal.release(input.collectionId);
        } catch { /* Keep the original failure when shutdown already closed the journal. */ }
        return fail(code, '原件尚未收存成功，请检查文件、大小、磁盘空间后重试。');
      }
    },
    async read(input: AuthorizedObjectRead): Promise<Result<ObjectReadStream>> {
      if (input.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '媒体属于其他资料库。');
      try { owned(); if (input.receipt.mime.startsWith('audio/')) return fail('MEDIA_REQUIRES_LEASE', '音频原件使用有界读取会话。'); const bytes = await verified(input.receipt, undefined, true); return ok({ stream: Readable.from([bytes]), mime: input.receipt.mime, hash: input.receipt.hash, byteLength: bytes.length }); }
      catch { return fail('OBJECT_INTEGRITY_FAILED', '原件缺失或完整性校验失败，请从备份恢复。'); }
    },
    async preview(receipt: DurableObjectReceipt): Promise<Result<Buffer>> {
      try { owned(); return ok(await thumbnail(receipt, await verified(receipt, undefined, receipt.mime.startsWith('image/'), true))); }
      catch { return fail('OBJECT_INTEGRITY_FAILED', '无法从完整原件重建预览。'); }
    },
    async verify(receipt: DurableObjectReceipt): Promise<Result<void>> {
      try { owned(); await verified(receipt); return ok(undefined); }
      catch { return fail('OBJECT_INTEGRITY_FAILED', '发布前原件完整性校验失败，请从备份恢复。'); }
    },
    async beforePublish(job: CollectionJob) { await options.onPhase?.('beforePublish', job.collectionId); },
  };
}
