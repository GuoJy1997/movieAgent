import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, readFile, writeFile, unlink, copyFile, rename } from 'node:fs/promises';
import { snapshotDatabase } from './maintenance.ts';
import { readProjectPolicy } from './project-policy.ts';
import { localDirectory, plainPath, sha256, TransferError } from './project-transfer-files.ts';
import { isAbsolute, join } from 'node:path';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { migrateProjects } from './migrations/0001-projects.ts';
import { migrateCommandEvents } from './migrations/0002-command-events.ts';
import { migrateModelConfig } from './migrations/0003-model-config.ts';
import { migrateAssets } from './migrations/0004-assets-collection.ts';
import { migrateGeneration } from './migrations/0005-generation.ts';
import { migrateProviderVerification } from './migrations/0006-provider-verification.ts';
import { migrateCanvas } from './migrations/0007-canvas.ts';
import { migrateAssetMetadata } from './migrations/0008-asset-metadata.ts';
import { migrateCanvasEdges } from './migrations/0009-canvas-edges.ts';
import { migrateWorkflows } from './migrations/0010-workflows.ts';
import { migrateAgent } from './migrations/0012-agent.ts';
import { migrateShotProduction } from './migrations/0013-shot-production.ts';
import { migrateShotCollectionIssues } from './migrations/0014-shot-collection-issues.ts';
import { migrateMediaInfo } from './migrations/0015-media-info.ts';
import { migrateTimeline } from './migrations/0016-timeline.ts';
import { migrateAudioCreation } from './migrations/0017-audio-creation.ts';
import { migrateLocalMediaJobs } from './migrations/0018-local-media-jobs.ts';
import { migrateFinishProposals } from './migrations/0019-finish-proposals.ts';
import { migrateCharacterVoices } from './migrations/0020-character-voices.ts';
import { migrateDialogueProductions } from './migrations/0021-dialogue-productions.ts';
import { migrateVoiceReviews } from './migrations/0022-voice-reviews.ts';
import { migrateVoiceWorkflow } from './migrations/0025-voice-workflow.ts';
import { migrateVoiceIdentity } from './migrations/0024-voice-identity.ts';
import { migrateDialogueAuthority } from './migrations/0023-dialogue-authority.ts';
import { migrateCreation } from './migrations/0011-creation.ts';
import { CURRENT_SCHEMA_VERSION as schemaVersion } from '../../contracts/src/schema.ts';

export interface LibraryHandle {
  readonly root: string;
  readonly libraryId: string;
  readonly instanceId: string;
  readonly schemaVersion: number;
  readonly db: DatabaseSync;
  readonly schedulingPaused?: boolean;
  checkOwnership(): Result<void>;
  close(): Promise<Result<void>>;
}

/** The guard database holds an OS-backed exclusive lock for this handle's lifetime.
 * It is separate from the WAL business database. The OS releases it after a crash;
 * a manifest/PID is never sufficient evidence to steal ownership or kill a process.
 */
export async function openLibrary(options: { root: string; identityGuardRoot?: string }): Promise<Result<LibraryHandle>> {
  if (!options || typeof options.root !== 'string' || !isAbsolute(options.root) || options.root.startsWith('\\\\')) {
    return fail('INVALID_LIBRARY_PATH', '请选择本地磁盘上的绝对资料库路径。');
  }
  let guard: DatabaseSync | undefined;
  let db: DatabaseSync | undefined;
  let identityGuard: DatabaseSync | undefined;
  let ownsGuard = false;
  let ownsManifest = false;
  let manifestPath = '';
  const instanceId = randomUUID();
  try {
    await mkdir(options.root, { recursive: true });
    const root = await realpath(options.root);
    guard = new DatabaseSync(join(root, 'engine-guard.sqlite'));
    try {
      guard.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE');
      ownsGuard = true;
    } catch {
      guard.close();
      return fail('LIBRARY_IN_USE', '此资料库已由另一个引擎占用。请先关闭该实例。');
    }
    const policy = await readProjectPolicy(root);
    if (policy?.state === 'retired') throw new TransferError('PROJECT_RETIRED');
    manifestPath = join(root, 'engine.lock');
    const manifest = JSON.stringify({ instanceId, pid: process.pid, startedAt: new Date().toISOString() });
    try {
      await writeFile(manifestPath, manifest, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Holding the exclusive guard proves that a previous manifest is stale.
      await writeFile(manifestPath, manifest, { mode: 0o600 });
    }
    ownsManifest = true;
    // Future libraries must never be opened writable or switched to WAL before refusal.
    try {
      const existing = await plainPath(root, 'library.sqlite', 'file');
      const inspection = new DatabaseSync(existing, { readOnly: true });
      try { if (Number(inspection.prepare('PRAGMA user_version').get()!.user_version) > schemaVersion) throw new TransferError('UNSUPPORTED_SCHEMA'); }
      finally { inspection.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const directory of ['objects', 'previews', 'temp', 'exports', 'backups', 'logs']) await mkdir(join(root, directory), { recursive: true });
    db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec('PRAGMA busy_timeout = 0; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL');
    if ((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version > schemaVersion) throw new Error('UNSUPPORTED_SCHEMA');
    const fromSchema = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (fromSchema < schemaVersion) {
      // The guard is the shared migration/snapshot/restore maintenance lock.
      // Never run partially committed migration steps against the original.
      const migrationId = randomUUID();
      const backup = join(root, 'backups', `schema-${fromSchema}-${migrationId}.sqlite`);
      const candidate = join(root, 'temp', `migration-${migrationId}.sqlite`);
      let staged: DatabaseSync | undefined;
      try {
        snapshotDatabase(db, backup);
        await copyFile(backup, candidate);
        staged = new DatabaseSync(candidate); staged.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
        migrateProjects(staged, randomUUID()); migrateCommandEvents(staged, randomUUID());
        migrateModelConfig(staged); migrateAssets(staged); migrateGeneration(staged);
        migrateProviderVerification(staged); migrateCanvas(staged); migrateAssetMetadata(staged); migrateCanvasEdges(staged); migrateWorkflows(staged); migrateCreation(staged); migrateAgent(staged); migrateShotProduction(staged); migrateShotCollectionIssues(staged); migrateMediaInfo(staged); migrateTimeline(staged);
        migrateAudioCreation(staged);
        migrateLocalMediaJobs(staged);
        migrateFinishProposals(staged);
        migrateCharacterVoices(staged);
        migrateDialogueProductions(staged);
        migrateVoiceReviews(staged);
        migrateDialogueAuthority(staged);
        migrateVoiceIdentity(staged);
        migrateVoiceWorkflow(staged);
        if (staged.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || staged.prepare('PRAGMA foreign_key_check').all().length) throw Error('MIGRATION_VALIDATION_FAILED');
        staged.close(); staged = undefined;
        // Close checkpoints the old WAL before the atomic replacement. If an
        // external connection prevents replacement, fail and keep both copies.
        const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        if (checkpoint?.busy !== 0) throw Error('MIGRATION_CHECKPOINT_BUSY');
        db.close(); db = undefined;
        await rename(candidate, join(root, 'library.sqlite'));
        db = new DatabaseSync(join(root, 'library.sqlite'));
        db.exec('PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
      } catch (error) {
        try { staged?.close(); } catch { /* Keep candidate and original evidence. */ }
        await writeFile(join(root, 'logs', `migration-${migrationId}.json`), JSON.stringify({ code: 'MIGRATION_FAILED', diagnosticId: migrationId, fromSchema, toSchema: schemaVersion, backup: `schema-${fromSchema}-${migrationId}.sqlite`, compatibleBackupRequired: true }), { flag: 'wx', mode: 0o600 });
        throw error;
      }
    }
    const libraryId = (db.prepare('SELECT id FROM library WHERE singleton = 1').get() as { id: string }).id;
    if (options.identityGuardRoot) {
      await mkdir(options.identityGuardRoot, { recursive: true });
      const ownersRoot = await localDirectory(options.identityGuardRoot);
      const filename = `${sha256(Buffer.from(libraryId))}.sqlite`;
      try { await plainPath(ownersRoot, filename, 'file'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      identityGuard = new DatabaseSync(join(ownersRoot, filename));
      try { identityGuard.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE'); }
      catch { throw new TransferError('LIBRARY_IDENTITY_IN_USE'); }
    }
    db.prepare('INSERT INTO engine_owner(singleton, instance_id, started_at) VALUES(1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET instance_id = excluded.instance_id, started_at = excluded.started_at').run(instanceId, new Date().toISOString());
    const ownedDb = db;
    const ownedGuard = guard;
    let closed = false;
    let closing: Promise<Result<void>> | undefined;
    function checkOwnership(): Result<void> {
      if (closed) return fail('ENGINE_CLOSED', '引擎已关闭，请重新连接。');
      const row = ownedDb.prepare('SELECT instance_id FROM engine_owner WHERE singleton = 1').get();
      return row?.instance_id === instanceId ? ok(undefined) : fail('OWNERSHIP_LOST', '引擎已失去此资料库的写入所有权。');
    }
    return ok({
      root, libraryId, instanceId, schemaVersion, db: ownedDb, checkOwnership, schedulingPaused: policy?.state === 'paused',
      close() {
        if (closing) return closing;
        closed = true;
        const cleanup = async (): Promise<Result<void>> => {
          let failed = false;
          try { ownedDb.prepare('DELETE FROM engine_owner WHERE instance_id = ?').run(instanceId); } catch { failed = true; }
          try { ownedDb.close(); } catch { failed = true; }
          try {
            const current = JSON.parse(await readFile(manifestPath, 'utf8')) as { instanceId?: unknown };
            if (current.instanceId === instanceId) await unlink(manifestPath);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed = true; }
          // This guard must outlive ALL pending manifest work, including after the
          // public deadline. Otherwise late unlink could delete a new owner's lock.
          if (failed) return fail('LIBRARY_CLOSE_FAILED', '清理失败；原实例保留所有权，退出该实例后才能重新打开并恢复。');
          try { ownedGuard.exec('ROLLBACK'); } catch { failed = true; }
          try { ownedGuard.close(); } catch { failed = true; }
          try { identityGuard?.exec('ROLLBACK'); identityGuard?.close(); } catch { failed = true; }
          return failed ? fail('LIBRARY_CLOSE_FAILED', '资料库清理未完全完成；下次启动将重新检查所有权。') : ok(undefined);
        };
        closing = new Promise(resolve => {
          const deadline = setTimeout(() => resolve(fail('LIBRARY_CLOSE_TIMEOUT', '资料库清理超时；写入已停止，清理完成前资料库仍被占用。')), 1000);
          // A timeout bounds the caller, not ownership. Cleanup continues under
          // this handle's guard; the host may still terminate its owned process.
          void cleanup().then(result => { clearTimeout(deadline); resolve(result); });
        });
        return closing;
      },
    });
  } catch (error) {
    try { db?.close(); } catch { /* Preserve the original startup error. */ }
    if (ownsManifest) {
      try {
        if (JSON.parse(await readFile(manifestPath, 'utf8')).instanceId === instanceId) await unlink(manifestPath);
      } catch { /* A foreign manifest is never removed. */ }
    }
    try { if (ownsGuard) guard?.exec('ROLLBACK'); guard?.close(); } catch { /* OS releases any remaining locks on process exit. */ }
    try { identityGuard?.close(); } catch { /* The process owns this handle only. */ }
    return fail(error instanceof TransferError ? error.code : error instanceof Error && error.message === 'UNSUPPORTED_SCHEMA' ? 'UNSUPPORTED_SCHEMA' : 'LIBRARY_OPEN_FAILED', '无法打开资料库。请检查项目是否停用、被其他窗口占用或版本不兼容。');
  }
}
