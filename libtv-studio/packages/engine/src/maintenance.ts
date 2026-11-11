import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { LibraryHandle } from '../../storage/src/database.ts';
import { snapshotDatabase } from '../../storage/src/maintenance.ts';
import { collectionJournalFor } from '../../storage/src/collection-journal.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { hashMediaFile } from './media/verify.ts';
import type { DurableObjectReceipt } from '../../storage/src/collection-journal.ts';
export function maintenanceFor(library: LibraryHandle, pause: () => Promise<void>, resume: () => void, admitting: () => boolean) {
  let active = false;
  let work: Promise<Result<{ snapshotId: string; schemaVersion: number }>> | undefined;
  return {
    get active() { return active; },
    async drain(): Promise<void> { await work; },
    snapshot(): Promise<Result<{ snapshotId: string; schemaVersion: number }>> {
      if (!admitting()) return Promise.resolve(fail('ENGINE_QUIESCING', '引擎正在退出。'));
      if (active) return Promise.resolve(fail('MAINTENANCE_BUSY', '维护正在进行。'));
      const own = library.checkOwnership(); if (!own.ok) return Promise.resolve(own);
      active = true;
      work = (async () => {
        try {
          await pause();
          const snapshotId = randomUUID();
          snapshotDatabase(library.db, join(library.root, 'backups', `${snapshotId}.sqlite`));
          const objects = library.db.prepare('SELECT hash,byte_length AS byteLength,storage_key AS storageKey FROM blob_object').all();
          // Already durable, unpublished originals are also protected by the manifest.
          const timelineSources = library.db.prepare('SELECT owner_kind AS ownerKind,owner_id AS ownerId,revision,clip_id AS clipId,reference_json AS referenceJson,source_hash AS sourceHash,source_probe_id AS sourceProbeId FROM timeline_source_reference ORDER BY owner_kind,owner_id,revision,clip_id').all();
          const voiceSources = library.db.prepare('SELECT voice_id AS voiceId,revision,project_id AS projectId,reference_json AS referenceJson,source_hash AS sourceHash,probe_id AS sourceProbeId FROM character_voice_media ORDER BY voice_id,revision').all();
          const collections = collectionJournalFor(library).durableReceipts();
          const localMediaJournal = library.db.prepare('SELECT job_id AS jobId,output_id AS outputId,receipt_json AS receiptJson,state FROM local_media_publication').all();
          const localMedia: typeof localMediaJournal = [];
          for (const entry of localMediaJournal) {
            const receipt = JSON.parse(String(entry.receiptJson)) as DurableObjectReceipt;
            if (!/^[a-f0-9]{64}$/.test(receipt.hash) || receipt.storageKey !== 'objects/' + receipt.hash.slice(0,2) + '/' + receipt.hash) continue;
            const verified = await hashMediaFile(join(library.root,receipt.storageKey),1024 ** 3,new AbortController().signal).catch(()=>null);
            if (verified?.ok && verified.value.hash === receipt.hash && verified.value.byteLength === receipt.byteLength) localMedia.push(entry);
          }
          await writeFile(join(library.root, 'backups', `${snapshotId}.json`), JSON.stringify({ libraryId: library.libraryId, schemaVersion: library.schemaVersion, snapshotId, objects, collections, timelineSources, voiceSources, localMedia, localMediaJournal, schedulingOnRestore: 'disabled', compatibleBackupRequired: true }), { flag: 'wx', mode: 0o600 });
          return ok({ snapshotId, schemaVersion: library.schemaVersion });
        } catch { return fail('SNAPSHOT_FAILED', '一致快照未完成。请检查磁盘；已有备份保留。'); }
        finally { active = false; resume(); }
      })();
      return work;
    },
  };
}
