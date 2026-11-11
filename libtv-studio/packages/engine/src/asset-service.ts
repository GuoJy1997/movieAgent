import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { LibraryHandle } from '../../storage/src/database.ts';
import { collectionJournalFor, type DurableObjectReceipt, type FileSourceRef } from '../../storage/src/collection-journal.ts';
import { objectStoreFor, type ObjectStoreOptions } from '../../storage/src/object-store.ts';
import { boundedObjectIOFor } from '../../storage/src/bounded-object-io.ts';
import type { MediaRangeRequest, ReadLease } from '../../contracts/src/media-info.ts';
import { isRecord, fail, ok, type AppError, type Result } from '../../contracts/src/result.ts';
import { isAssetSnapshot, isMediaReference, parseMediaRead, type AssetMetadataView, type AssetView, type AssetHistory, type AssetRevisionInput, type UpdateAssetMetadataInput, type AssetSearchInput, type MediaMetadata, type MediaReference, type AssetSnapshot, type AssetVersionRef, type ImportRef, type MediaRead, type SaveArtifactInput } from '../../contracts/src/assets.ts';
import type { CommandEnvelope } from '../../contracts/src/commands.ts';
// Privileged grant registration is separate from serializable generic commands.
interface TrustedFileGrant { grantId: string; importId: string; libraryId: string; expiresAt: number; files: FileSourceRef[] }
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function assetsFor(library: LibraryHandle, options: ObjectStoreOptions = {}) {
  const grants = new Map<string, TrustedFileGrant>();
  const journal = collectionJournalFor(library), store = objectStoreFor(library, options);
  const objectIO = boundedObjectIOFor(library);
  let tail = Promise.resolve();
  const ownership = () => library.checkOwnership();
  const terminalTargetCodes = ['ASSET_NOT_FOUND', 'ASSET_TRASHED', 'REVISION_CONFLICT'];
  function terminalFailure(stored: unknown): Result<never> | null {
    if (stored === null || stored === undefined) return null;
    try {
      const error: unknown = JSON.parse(stored as string);
      if (isRecord(error) && Object.keys(error).length === 2 && terminalTargetCodes.includes(error.code as string) && typeof error.message === 'string') return fail(error.code as string, error.message);
    } catch { /* Invalid terminal state must never resume publication. */ }
    return fail('INVALID_STORED_DATA', '导入终止记录无效，请检查资料库。');
  }
  const ref = (assetId: string, version: number): AssetVersionRef => ({ kind: 'assetVersion', libraryId: library.libraryId, assetId, version });
  function jobs(importId: string) {
    return library.db.prepare('SELECT * FROM import_collection WHERE import_id=? ORDER BY rowid').all(importId).map(r => ({ ...journal.get(r.collection_id as string)!, assetId: r.asset_id as string, name: r.name as string, expectedVersion: r.expected_version as number | null }));
  }
  function blob(receipt: DurableObjectReceipt) {
    library.db.prepare('INSERT INTO blob_object(object_id,hash,byte_length,storage_key,mime,width,height) VALUES(?,?,?,?,?,?,?) ON CONFLICT(hash) DO NOTHING').run(receipt.objectId, receipt.hash, receipt.byteLength, receipt.storageKey, receipt.mime, receipt.width, receipt.height);
  }
  async function collect(command: CommandEnvelope<'asset.importGrantedFiles'>, hash: string): Promise<Result<void>> {
    const own = ownership(); if (!own.ok) return own;
    let batch = library.db.prepare('SELECT * FROM import_batch WHERE command_id=?').get(command.commandId);
    if (batch && batch.request_hash !== hash) return fail('COMMAND_ID_REUSED', '同一个命令 ID 已用于不同参数。');
    const terminal = terminalFailure(batch?.terminal_error); if (terminal) return terminal;
    if (batch?.state === 'ready') return ok(undefined);
    if (!batch) {
      const grant = grants.get(command.payload.grantId);
      if (!grant) return fail('FILE_GRANT_NOT_FOUND', '文件授权不存在，请重新选择。');
      if (grant.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '文件授权属于其他资料库。');
      if (grant.expiresAt <= Date.now()) return fail('FILE_GRANT_EXPIRED', '文件授权已到期，请重新选择。');
      if (library.db.prepare('SELECT 1 FROM import_batch WHERE grant_id=?').get(grant.grantId)) return fail('FILE_GRANT_CONSUMED', '此文件授权已经用于另一次导入。');
      if (command.payload.assetId) {
        if (grant.files.length !== 1) return fail('INVALID_INPUT', '新增版本每次只选择一个文件。');
        const target = versionTarget(command.payload.assetId, command.payload.expectedVersion!); if (!target.ok) return target;
      }
      try {
        library.db.exec('BEGIN IMMEDIATE');
        library.db.prepare('INSERT INTO import_batch(import_id,grant_id,command_id,request_hash,command_json,state) VALUES(?,?,?,?,?,?)').run(grant.importId, grant.grantId, command.commandId, hash, JSON.stringify(command), 'collecting');
        for (const file of grant.files) {
          const collectionId = randomUUID(); journal.create(collectionId, file);
          library.db.prepare('INSERT INTO import_collection(import_id,collection_id,asset_id,name,expected_version) VALUES(?,?,?,?,?)').run(grant.importId, collectionId, command.payload.assetId ?? randomUUID(), file.name, command.payload.expectedVersion ?? null);
        }
        library.db.exec('COMMIT'); grants.delete(grant.grantId);
      } catch { try { library.db.exec('ROLLBACK'); } catch { /* No transaction. */ } return fail('COLLECTION_JOURNAL_FAILED', '无法建立持久收存记录。'); }
      batch = library.db.prepare('SELECT * FROM import_batch WHERE command_id=?').get(command.commandId)!;
    }
    for (const job of jobs(batch.import_id as string)) {
      const result = await store.collect({ collectionId: job.collectionId, sourceRef: job.sourceRef }); if (!result.ok) return result;
      try { await store.beforePublish(job); } catch { return fail('COLLECTION_INTERRUPTED', '原件已保存，资产发布尚未完成，可安全重试收存。'); }
    }
    for (const job of jobs(batch.import_id as string)) {
      const verified = await store.verify(job.receipt!);
      if (!verified.ok) { journal.update(job.collectionId, 'retryable_failure', undefined, verified.error.code); return verified; }
    }
    return ownership();
  }
  function resolveOriginal(reference: MediaReference): Result<DurableObjectReceipt> {
    const own = ownership(); if (!own.ok) return own;
    if (!isMediaReference(reference)) return fail('INVALID_INPUT', '固定媒体引用无效。');
    if (reference.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '媒体属于其他资料库。');
    const row = reference.kind === 'assetVersion' ? library.db.prepare('SELECT b.* FROM asset_version v JOIN blob_object b ON b.object_id=v.object_id WHERE v.asset_id=? AND v.version=? AND v.library_id=?').get(reference.assetId, reference.version, library.libraryId) : library.db.prepare('SELECT b.* FROM artifact a JOIN blob_object b ON b.object_id=a.object_id WHERE a.id=? AND a.library_id=?').get(reference.artifactId, library.libraryId);
    if (!row) return fail('MEDIA_NOT_FOUND', '固定媒体版本不存在。');
    const receipt: DurableObjectReceipt = { objectId: row.object_id as string, hash: row.hash as string, byteLength: row.byte_length as number, storageKey: row.storage_key as string, mime: row.mime as string, width: row.width as number, height: row.height as number };
    return ok(receipt);
  }
  function metadata(reference: MediaReference): Result<MediaMetadata> {
    const found = resolveOriginal(reference); if (!found.ok) return found;
    const { hash, mime, byteLength, width, height } = found.value; return ok({ hash, mime, byteLength, width, height });
  }
  /** Use only for a new choice or ordinary preparation. Approved/frozen work uses historical readers. */
  function assertSelectable(reference: MediaReference): Result<MediaMetadata> {
    const found = metadata(reference); if (!found.ok) return found;
    if (reference.kind === 'assetVersion' && library.db.prepare('SELECT deleted_at FROM asset WHERE id=? AND library_id=?').get(reference.assetId, library.libraryId)?.deleted_at !== null) return fail('ASSET_TRASHED', '资产已在回收站，恢复后才能重新选择。');
    return found;
  }
  function assetMetadata(assetId: string): Result<AssetMetadataView> {
    const row = library.db.prepare('SELECT * FROM asset WHERE id=? AND library_id=?').get(assetId, library.libraryId);
    return row ? ok({ libraryId: library.libraryId, assetId, name: row.name as string, metadataRevision: row.metadata_revision as number, tags: JSON.parse(row.tags_json as string), deletedAt: row.deleted_at as string | null, createdAt: row.created_at as string }) : fail('ASSET_NOT_FOUND', '资产不存在。');
  }
  function versionTarget(assetId: string, expectedVersion: number): Result<number> {
    const asset = assetMetadata(assetId); if (!asset.ok) return asset;
    if (asset.value.deletedAt !== null) return fail('ASSET_TRASHED', '请先恢复资产再新增版本。');
    const latest = library.db.prepare('SELECT MAX(version) AS version FROM asset_version WHERE asset_id=? AND library_id=?').get(assetId, library.libraryId)?.version;
    return latest === expectedVersion ? ok(expectedVersion + 1) : fail('REVISION_CONFLICT', '资产版本已改变，请刷新并重新选择目标版本。');
  }
  function editMetadata(input: AssetRevisionInput | UpdateAssetMetadataInput, state?: 'trash' | 'active'): Result<AssetMetadataView> {
    const own = ownership(); if (!own.ok) return own;
    const asset = assetMetadata(input.assetId); if (!asset.ok) return asset;
    if (asset.value.metadataRevision !== input.expectedRevision) return fail('REVISION_CONFLICT', '资产元数据已改变，请刷新后重试。');
    const name = 'name' in input ? input.name : asset.value.name, tags = 'tags' in input ? input.tags : asset.value.tags;
    const deletedAt = state === 'trash' ? asset.value.deletedAt ?? new Date().toISOString() : state === 'active' ? null : asset.value.deletedAt;
    library.db.prepare('UPDATE asset SET name=?,tags_json=?,deleted_at=?,metadata_revision=metadata_revision+1 WHERE id=? AND library_id=? AND metadata_revision=?').run(name, JSON.stringify(tags), deletedAt, input.assetId, library.libraryId, input.expectedRevision);
    return assetMetadata(input.assetId);
  }
  function versions(assetId?: string): AssetView[] {
    return library.db.prepare(`SELECT a.name,a.metadata_revision,a.tags_json,a.deleted_at,v.created_at,v.asset_id,v.version,v.artifact_id,b.mime,b.width,b.height,b.byte_length FROM asset a JOIN asset_version v ON v.asset_id=a.id JOIN blob_object b ON b.object_id=v.object_id WHERE a.library_id=? ${assetId === undefined ? '' : 'AND a.id=?'} ORDER BY a.rowid,v.version`).all(...(assetId === undefined ? [library.libraryId] : [library.libraryId, assetId])).map(r => ({ ref: ref(r.asset_id as string, r.version as number), sourceArtifactRef: r.artifact_id === null ? null : { kind: 'artifact' as const, libraryId: library.libraryId, artifactId: r.artifact_id as string }, name: r.name as string, mime: r.mime as string, width: r.width as number, height: r.height as number, byteLength: r.byte_length as number, metadataRevision: r.metadata_revision as number, tags: JSON.parse(r.tags_json as string), deletedAt: r.deleted_at as string | null, createdAt: r.created_at as string }));
  }
  async function readFixedOriginal(reference: MediaReference, expected?: MediaMetadata): Promise<Result<MediaRead>> {
    const found = resolveOriginal(reference); if (!found.ok) return found;
    if (expected && ['hash','mime','byteLength','width','height'].some(k => found.value[k as keyof MediaMetadata] !== expected[k as keyof MediaMetadata])) return fail('REFERENCE_CHANGED', '固定原件元数据不符。');
    const original = await store.read({ libraryId: library.libraryId, receipt: found.value }); if (!original.ok) return original;
    const chunks: Buffer[] = []; for await (const chunk of original.value.stream) chunks.push(Buffer.from(chunk));
    return ok({ bytes: Buffer.concat(chunks), mime: original.value.mime, hash: original.value.hash });
  }
  return {
    metadata, readFixedOriginal, assertSelectable,
    async openMediaRead(reference: MediaReference, expectedHash?: string): Promise<Result<ReadLease>> {
      const found = resolveOriginal(reference); if (!found.ok) return found;
      return objectIO.open({ libraryId: library.libraryId, receipt: found.value }, expectedHash ?? found.value.hash);
    },
    readMediaRange: (input: MediaRangeRequest) => objectIO.read(input),
    closeMediaRead: (leaseId: string) => objectIO.close(leaseId),
    closeMediaReads: () => objectIO.dispose(),
    updateMetadata: (input: UpdateAssetMetadataInput) => editMetadata(input),
    trash: (input: AssetRevisionInput) => editMetadata(input, 'trash'),
    restore: (input: AssetRevisionInput) => editMetadata(input, 'active'),
    history(input: { assetId: string }): Result<AssetHistory> {
      const own = ownership(); if (!own.ok) return own;
      const asset = assetMetadata(input.assetId); return asset.ok ? ok({ libraryId: library.libraryId, assetId: input.assetId, versions: versions(input.assetId) }) : asset;
    },
    registerGrant(input: unknown): Result<void> {
      const own = ownership(); if (!own.ok) return own;
      if (!isRecord(input) || !validId(input.grantId) || !validId(input.importId) || !validId(input.libraryId) || !Number.isSafeInteger(input.expiresAt) || !Array.isArray(input.files) || !input.files.length || input.files.length > 32 || !input.files.every(f => isRecord(f) && ['path', 'realPath', 'allowedRoot'].every(k => typeof f[k] === 'string' && isAbsolute(f[k] as string)) && typeof f.name === 'string' && f.name.length > 0 && f.name.length <= 255 && ['size', 'mtimeMs', 'dev', 'ino'].every(k => typeof f[k] === 'number' && Number.isFinite(f[k]) && (f[k] as number) >= 0))) return fail('INVALID_INPUT', '文件授权无效。');
      if (input.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '文件授权属于其他资料库。');
      if (grants.has(input.grantId)) return fail('FILE_GRANT_EXISTS', '文件授权不可替换。');
      grants.set(input.grantId, structuredClone(input) as unknown as TrustedFileGrant); return ok(undefined);
    },
    prepareImport(command: CommandEnvelope<'asset.importGrantedFiles'>, hash: string, checkIdentity: () => Result<void>): Promise<Result<void>> {
      // Serialize collection namespace moves and reservations, without blocking other engine commands.
      const result = tail.then(() => {
        // A different synchronous command may have committed while this import was queued.
        const identity = checkIdentity(); return identity.ok ? collect(command, hash) : identity;
      });
      tail = result.then(() => undefined, () => undefined); return result;
    },
    publishImport(commandId: string, hash: string): Result<ImportRef> {
      const batch = library.db.prepare('SELECT * FROM import_batch WHERE command_id=?').get(commandId);
      if (!batch || batch.request_hash !== hash) return fail('COLLECTION_NOT_FOUND', '收存记录不存在。');
      const terminal = terminalFailure(batch.terminal_error); if (terminal) return terminal;
      const collected = jobs(batch.import_id as string);
      if (!collected.length || collected.some(j => !j.receipt || !['durable', 'ready'].includes(j.state))) return fail('COLLECTION_NOT_DURABLE', '原件尚未完整收存。');
      const published: AssetVersionRef[] = [];
      for (const job of collected) {
        // Publication joins the command transaction: collection I/O may have raced another version.
        let version = 1;
        if (job.expectedVersion !== null) { const target = versionTarget(job.assetId, job.expectedVersion); if (!target.ok) return target; version = target.value; }
        blob(job.receipt!);
        const createdAt = new Date().toISOString();
        if (job.expectedVersion === null) library.db.prepare('INSERT INTO asset(id,library_id,name,created_at) VALUES(?,?,?,?)').run(job.assetId, library.libraryId, job.name.slice(0, 200), createdAt);
        library.db.prepare('INSERT INTO asset_version(asset_id,version,library_id,object_id,created_at) VALUES(?,?,?,?,?)').run(job.assetId, version, library.libraryId, job.receipt!.objectId, createdAt);
        published.push(ref(job.assetId, version));
        journal.update(job.collectionId, 'ready'); journal.release(job.collectionId);
      }
      library.db.prepare("UPDATE import_batch SET state='ready' WHERE import_id=?").run(batch.import_id as string);
      return ok({ libraryId: library.libraryId, importId: batch.import_id as string, state: 'ready', versions: published });
    },
    /** Called after publication rollback. Persist rejection before main may settle its outbox. */
    rejectImportTarget(commandId: string, hash: string, error: AppError): Result<never> {
      if (!terminalTargetCodes.includes(error.code)) return { ok: false, error };
      const own = ownership(); if (!own.ok) return own;
      try {
        library.db.exec('BEGIN IMMEDIATE');
        const batch = library.db.prepare('SELECT * FROM import_batch WHERE command_id=? AND request_hash=?').get(commandId, hash);
        if (!batch || batch.state !== 'collecting') throw Error('Import identity changed');
        const existing = terminalFailure(batch.terminal_error);
        if (existing) { library.db.exec('ROLLBACK'); return existing; }
        library.db.prepare('UPDATE import_batch SET terminal_error=? WHERE command_id=? AND request_hash=?').run(JSON.stringify({ code: error.code, message: error.message }), commandId, hash);
        for (const job of jobs(batch.import_id as string)) journal.release(job.collectionId);
        library.db.exec('COMMIT');
        return { ok: false, error };
      } catch {
        try { library.db.exec('ROLLBACK'); } catch { /* No transaction. */ }
        return fail('COMMAND_COMMIT_FAILED', '导入终止状态尚未确认，请核实原操作。');
      }
    },
    saveArtifact(input: SaveArtifactInput): Result<AssetVersionRef> {
      if (input.artifactRef.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '产物属于其他资料库。');
      const artifact = library.db.prepare('SELECT object_id FROM artifact WHERE id=? AND library_id=?').get(input.artifactRef.artifactId, library.libraryId);
      if (!artifact) return fail('ARTIFACT_NOT_FOUND', '产物记录不存在。');
      const assetId = input.assetId ?? randomUUID(); let version = 1;
      if (input.assetId) {
        const target = versionTarget(assetId, input.expectedVersion!); if (!target.ok) return target; version = target.value;
      } else library.db.prepare('INSERT INTO asset(id,library_id,name,created_at) VALUES(?,?,?,?)').run(assetId, library.libraryId, input.name, new Date().toISOString());
      library.db.prepare('INSERT INTO asset_version(asset_id,version,library_id,object_id,artifact_id,created_at) VALUES(?,?,?,?,?,?)').run(assetId, version, library.libraryId, artifact.object_id as string, input.artifactRef.artifactId, new Date().toISOString());
      return ok(ref(assetId, version));
    },
    search(input: AssetSearchInput = {}): AssetSnapshot {
      const all = versions(), latest = new Map<string, number>(); for (const a of all) latest.set(a.ref.assetId, a.ref.version);
      const assets = all.filter(a => (input.state === 'trash' ? a.deletedAt !== null : a.deletedAt === null) && (!input.latestOnly || latest.get(a.ref.assetId) === a.ref.version) && (input.name === undefined || a.name.toLocaleLowerCase().includes(input.name.toLocaleLowerCase())) && (input.tag === undefined || a.tags!.includes(input.tag.trim())) && (input.mediaType === undefined || a.mime.startsWith(`${input.mediaType}/`)));
      const snapshot = { libraryId: library.libraryId, assets, snapshotSeq: Number(library.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM domain_event').get()!.seq) };
      if (!isAssetSnapshot(snapshot)) throw new Error('Invalid asset snapshot'); return snapshot;
    },
    async read(input: unknown): Promise<Result<MediaRead>> {
      const parsed = parseMediaRead(input); if (!parsed.ok) return parsed; const request = parsed.value;
      if (request.libraryId !== library.libraryId || request.ref.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '媒体属于其他资料库。');
      const own = ownership(); if (!own.ok) return own;
      const found = resolveOriginal(request.ref); if (!found.ok) return found; const receipt = found.value;
      if (request.variant === 'thumbnail') { const preview = await store.preview(receipt); return preview.ok ? ok({ bytes: preview.value, mime: 'image/png', hash: receipt.hash }) : preview; }
      return readFixedOriginal(request.ref);
    },
    pendingImports(): unknown[] { return library.db.prepare("SELECT command_json FROM import_batch WHERE state='collecting' AND terminal_error IS NULL").all().map(r => JSON.parse(r.command_json as string)); },
    async drain() { await tail; },
  };
}
