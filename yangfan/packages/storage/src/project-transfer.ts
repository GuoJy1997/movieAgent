import { randomUUID } from 'node:crypto';
import { join, basename } from 'node:path';
import { lstat } from 'node:fs/promises';
import { parseProjectManifest, type ProjectManifest } from '../../contracts/src/directory-projects.ts';
import { BACKUP_LIMITS, type TransferReceipt } from '../../contracts/src/project-maintenance.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { acquireProjectMaintenance } from './project-maintenance-lock.ts';
import { createBackupUnderGuard, restoreProjectBackup } from './project-backup.ts';
import { localDirectory, readLimited, transferDestination, transferError, TransferError } from './project-transfer-files.ts';
import { readProjectPolicy, replaceProjectPolicy, type ProjectPolicy } from './project-policy.ts';
import { readTransferReceipt as receiptAt } from './project-transfer-receipt.ts';
const val = <T>(r: Result<T>): T => { if (!r.ok) throw new TransferError(r.error.code); return r.value; };
const project = async (root: string): Promise<ProjectManifest> => val(parseProjectManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readLimited(root, 'movieagent.project.json', BACKUP_LIMITS.projectManifestBytes)))));
/** Native caller must first confirm that the original is no longer executing elsewhere. */
export async function activateRestoredProject(projectRoot: string): Promise<Result<TransferReceipt>> {
  let guard: Awaited<ReturnType<typeof acquireProjectMaintenance>> | undefined;
  try {
    const root = await localDirectory(projectRoot); guard = await acquireProjectMaintenance(root);
    const receipt = await receiptAt(root), libraryRoot = join(root, '.movieagent/library'), policy = await readProjectPolicy(libraryRoot);
    if (!policy || policy.state === 'retired') throw new TransferError('PROJECT_RETIRED');
    await replaceProjectPolicy(libraryRoot, { ...policy, state: 'active' });
    return ok({ ...receipt, scheduling: 'active' });
  } catch (error) { return fail(transferError(error), '无法启用此项目。请先关闭项目窗口，并确认原项目已停止执行。'); } finally { guard?.close(); }
}
/** Verified transfer retains its safety backup and original bytes. Retirement precedes activation. */
export async function migrateDirectoryProject(input: { projectRoot: string; destination: string; appVersion: string }): Promise<Result<TransferReceipt>> {
  let sourceGuard: Awaited<ReturnType<typeof acquireProjectMaintenance>> | undefined;
  let targetGuard: Awaited<ReturnType<typeof acquireProjectMaintenance>> | undefined;
  try {
    const root = await localDirectory(input.projectRoot), destination = await transferDestination(root, input.destination), manifest = await project(root);
    sourceGuard = await acquireProjectMaintenance(root);
    const oldPolicy = await readProjectPolicy(join(root, '.movieagent/library'));
    let receipt: TransferReceipt;
    let targetExists = false;
    try { await lstat(destination); targetExists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (targetExists) {
      await localDirectory(destination); receipt = await receiptAt(destination);
      if (receipt.sourceWorkspaceId !== manifest.workspaceId || receipt.libraryId !== (manifest.binding?.libraryId ?? null) || receipt.projectId !== (manifest.binding?.projectId ?? null) || oldPolicy?.state !== 'retired' || oldPolicy.transferId !== receipt.backupId) throw new TransferError('TRANSFER_TARGET_EXISTS');
    } else {
      if (oldPolicy?.state === 'retired') throw new TransferError('PROJECT_RETIRED');
      // This complete bundle also serves as recovery evidence if power fails during the move.
      const backupRoot = `${destination}-迁移备份-${randomUUID()}`;
      await createBackupUnderGuard(root, backupRoot, input.appVersion);
      receipt = val(await restoreProjectBackup({ backupRoot, destination, name: basename(destination) }));
    }
    targetGuard = await acquireProjectMaintenance(destination);
    const policy: ProjectPolicy = { format: 'movieagent.maintenance-state', schemaVersion: 1, state: 'retired', transferId: receipt.backupId, sourceWorkspaceId: manifest.workspaceId };
    await replaceProjectPolicy(join(root, '.movieagent/library'), policy);
    const targetPolicy = await readProjectPolicy(join(destination, '.movieagent/library'));
    if (!targetPolicy || targetPolicy.state === 'retired' || targetPolicy.transferId !== receipt.backupId) throw new TransferError('INVALID_PROJECT_POLICY');
    await replaceProjectPolicy(join(destination, '.movieagent/library'), { ...targetPolicy, state: 'active' });
    return ok({ ...receipt, scheduling: 'active', sourceRetired: true });
  } catch (error) { return fail(transferError(error), '迁移未完成。请保留源目录和迁移备份；目标副本在确认完成前保持暂停。'); }
  finally { targetGuard?.close(); sourceGuard?.close(); }
}
