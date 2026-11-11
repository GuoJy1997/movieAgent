import type { LibraryHandle } from './database.ts';
export interface FileSourceRef { path: string; realPath: string; allowedRoot: string; name: string; size: number; mtimeMs: number; dev: number; ino: number }
export interface DurableObjectReceipt { objectId: string; hash: string; byteLength: number; storageKey: string; mime: string; width: number; height: number }
export interface CollectionJob { collectionId: string; sourceRef: FileSourceRef; state: string; receipt: DurableObjectReceipt | null }
/** Only the engine owns this journal. Disk work is never performed in its SQL transactions. */
export function collectionJournalFor(library: LibraryHandle) {
  return {
    durableReceipts(): DurableObjectReceipt[] {
      return library.db.prepare('SELECT receipt_json FROM collection_job WHERE receipt_json IS NOT NULL').all().map(row => JSON.parse(row.receipt_json as string) as DurableObjectReceipt);
    },
    create(collectionId: string, sourceRef: FileSourceRef) {
      const ownership = library.checkOwnership(); if (!ownership.ok) throw new Error(ownership.error.code);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(collectionId)) throw new Error('INVALID_COLLECTION_ID');
      library.db.prepare("INSERT INTO collection_job(collection_id,source_json,state) VALUES(?,?,'pending')").run(collectionId, JSON.stringify(sourceRef));
    },
    get(collectionId: string): CollectionJob | null {
      const r = library.db.prepare('SELECT * FROM collection_job WHERE collection_id=?').get(collectionId);
      return r ? { collectionId: r.collection_id as string, sourceRef: JSON.parse(r.source_json as string), state: r.state as string, receipt: r.receipt_json ? JSON.parse(r.receipt_json as string) : null } : null;
    },
    update(collectionId: string, state: string, receipt?: DurableObjectReceipt, errorCode?: string) {
      const ownership = library.checkOwnership(); if (!ownership.ok) throw new Error(ownership.error.code);
      library.db.prepare('UPDATE collection_job SET state=?,receipt_json=COALESCE(?,receipt_json),error_code=? WHERE collection_id=?').run(state, receipt ? JSON.stringify(receipt) : null, errorCode ?? null, collectionId);
    },
    reserve(collectionId: string, bytes: number, available: number): boolean {
      const reserved = (library.db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM storage_reservation WHERE collection_id<>?').get(collectionId) as { bytes: number }).bytes;
      if (available - reserved < bytes) return false;
      library.db.prepare('INSERT INTO storage_reservation(collection_id,bytes) VALUES(?,?) ON CONFLICT(collection_id) DO UPDATE SET bytes=excluded.bytes').run(collectionId, bytes); return true;
    },
    release(collectionId: string) { library.db.prepare('DELETE FROM storage_reservation WHERE collection_id=?').run(collectionId); },
  };
}
