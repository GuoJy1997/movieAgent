import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { MediaMetadata, MediaReference } from '../../contracts/src/assets.ts';
import type { MediaChunk, MediaProbe, MediaRangeRequest, MediaRuntime, ReadLease } from '../../contracts/src/media-info.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { probeMediaFile } from './media/probe.ts';
export interface MediaObjectIO {
  openMediaRead(ref: MediaReference, expectedHash?: string): Promise<Result<ReadLease>>;
  readMediaRange(input: MediaRangeRequest): Promise<Result<MediaChunk>>;
  closeMediaRead(leaseId: string): Promise<void>;
}
export interface MediaInfoAssets { metadata(ref: MediaReference): Result<MediaMetadata>; assertSelectable(ref: MediaReference): Result<MediaMetadata> }
export function mediaInfoFor({ library, assets, runtime, objectIO }: { library: LibraryHandle; assets: MediaInfoAssets; runtime?: MediaRuntime; objectIO: MediaObjectIO }) {
  const pending = new Map<string, Promise<Result<MediaProbe>>>();
  function read(ref: MediaReference): Result<MediaProbe | null> {
    const metadata = assets.metadata(ref); if (!metadata.ok) return metadata;
    if (!runtime) return ok(null);
    const row = library.db.prepare('SELECT probe_json FROM media_probe WHERE object_hash=? AND runtime_hash=?').get(metadata.value.hash, runtime.runtimeHash);
    try { return ok(row ? JSON.parse(row.probe_json as string) as MediaProbe : null); } catch { return fail('INVALID_STORED_DATA', '媒体探测记录无效。'); }
  }
  async function perform(ref: MediaReference, expected: MediaMetadata): Promise<Result<MediaProbe>> {
    if (!runtime) return fail('MEDIA_RUNTIME_UNAVAILABLE', '固定媒体运行时不可用，无法分析媒体。');
    const stageRoot = join(library.root, 'temp'), path = join(stageRoot, `probe-${randomUUID()}.part`);
    let lease: ReadLease | undefined;
    try {
      await mkdir(stageRoot, { recursive: true });
      const opened = await objectIO.openMediaRead(ref, expected.hash); if (!opened.ok) return opened; lease = opened.value;
      const target = await open(path, 'wx', 0o600); const hash = createHash('sha256');
      try {
        for (let offset = 0; offset < lease.byteLength;) {
          const result = await objectIO.readMediaRange({ leaseId: lease.leaseId, offset, length: Math.min(1024 * 1024, lease.byteLength - offset) }); if (!result.ok) return result;
          if (result.value.bytes.byteLength === 0 || result.value.bytes.byteLength > 1024 * 1024 || result.value.offset !== offset) return fail('OBJECT_INTEGRITY_FAILED', '媒体数据块无效。');
          hash.update(result.value.bytes); await target.writeFile(result.value.bytes); offset += result.value.bytes.byteLength;
        }
        await target.sync();
      } finally { await target.close(); }
      if (hash.digest('hex') !== expected.hash) return fail('OBJECT_INTEGRITY_FAILED', '媒体暂存校验失败。');
      const probe = await probeMediaFile(runtime, path, stageRoot, expected.hash); if (!probe.ok) return probe;
      const own = library.checkOwnership(); if (!own.ok) return own;
      const current = assets.assertSelectable(ref); if (!current.ok) return current;
      if (JSON.stringify(current.value) !== JSON.stringify(expected)) return fail('REFERENCE_CHANGED', '原件信息在分析期间改变。');
      // Revalidate the original after native work, outside the short atomic publication.
      const recheck = await objectIO.openMediaRead(ref, expected.hash); if (!recheck.ok) return recheck; await objectIO.closeMediaRead(recheck.value.leaseId);
      const finalOwn = library.checkOwnership(); if (!finalOwn.ok) return finalOwn;
      const final = assets.assertSelectable(ref); if (!final.ok) return final; if (final.value.hash !== expected.hash) return fail('REFERENCE_CHANGED', '原件在分析期间改变。');
      library.db.prepare('INSERT INTO media_probe(probe_id,object_hash,runtime_hash,probe_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(object_hash,runtime_hash) DO NOTHING').run(probe.value.probeId, expected.hash, runtime.runtimeHash, JSON.stringify(probe.value), Date.now());
      return probe;
    } catch { return fail('MEDIA_ANALYSIS_FAILED', '媒体分析失败，原件保持不变。'); }
    finally { if (lease) await objectIO.closeMediaRead(lease.leaseId); await unlink(path).catch(() => undefined); }
  }
  return {
    read,
    async ensure(ref: MediaReference): Promise<Result<MediaProbe>> {
      const selected = assets.assertSelectable(ref); if (!selected.ok) return selected;
      if (!runtime) return fail('MEDIA_RUNTIME_UNAVAILABLE', '固定媒体运行时不可用，无法分析媒体。');
      const existing = read(ref); if (!existing.ok) return existing;
      if (existing.value) {
        const verified = await objectIO.openMediaRead(ref, selected.value.hash); if (!verified.ok) return verified;
        await objectIO.closeMediaRead(verified.value.leaseId);
        const final = assets.assertSelectable(ref); return final.ok ? ok(existing.value) : final;
      }
      if (!(selected.value.mime.startsWith('audio/') || selected.value.mime === 'video/mp4')) return fail('UNSUPPORTED_MEDIA', '此媒体无需音视频探测。');
      const key = `${selected.value.hash}:${runtime.runtimeHash}`; const running = pending.get(key);
      if (running) { const result = await running; const current = assets.assertSelectable(ref); return current.ok ? result : current; }
      const job = perform(ref, selected.value); pending.set(key, job); try { return await job; } finally { pending.delete(key); }
    },
    async drain() { await Promise.allSettled([...pending.values()]); },
  };
}
