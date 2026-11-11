import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { isWorkspaceId, parseProjectManifest } from '../../contracts/src/directory-projects.ts';
import { isReceipt } from '../../contracts/src/commands.ts';
import { isProject } from '../../contracts/src/projects.ts';
import { isRecord } from '../../contracts/src/result.ts';
import { CURRENT_SCHEMA_VERSION } from '../../contracts/src/schema.ts';
import { BACKUP_LIMITS, type TransferReceipt } from '../../contracts/src/project-maintenance.ts';
import { plainPath, readLimited, TransferError } from './project-transfer-files.ts';
import { readProjectPolicy } from './project-policy.ts';
/** Cold caller owns the target guard. A null receipt may bind only through its own bootstrap command. */
export async function readTransferReceipt(root: string): Promise<TransferReceipt> {
  const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const receipt: unknown = decode(await readLimited(root, '.movieagent/transfer.json', 65536));
  const parsed = parseProjectManifest(decode(await readLimited(root, 'movieagent.project.json', BACKUP_LIMITS.projectManifestBytes)));
  if (!parsed.ok) throw new TransferError('INVALID_TRANSFER_RECEIPT');
  const manifest = parsed.value, policy = await readProjectPolicy(join(root, '.movieagent/library'));
  if (!policy || !isRecord(receipt) || receipt.workspaceId !== manifest.workspaceId || !isWorkspaceId(receipt.sourceWorkspaceId) || receipt.backupId !== policy.transferId || receipt.sourceWorkspaceId !== policy.sourceWorkspaceId || !['paused','active'].includes(String(receipt.scheduling)) || typeof receipt.manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.manifestHash)) throw new TransferError('INVALID_TRANSFER_RECEIPT');
  if (policy.state === 'retired') throw new TransferError('PROJECT_RETIRED');
  const sameBinding = receipt.libraryId === (manifest.binding?.libraryId ?? null) && receipt.projectId === (manifest.binding?.projectId ?? null);
  if (!sameBinding) {
    if (receipt.libraryId !== null || receipt.projectId !== null || !manifest.binding) throw new TransferError('INVALID_TRANSFER_RECEIPT');
    const db = new DatabaseSync(await plainPath(root, '.movieagent/library/library.sqlite', 'file'), { readOnly: true });
    try {
      const schema = Number(db.prepare('PRAGMA user_version').get()!.user_version), binding = manifest.binding;
      if (schema > CURRENT_SCHEMA_VERSION) throw new TransferError('UNSUPPORTED_SCHEMA');
      const commandId = `directory-init-${manifest.workspaceId}`, row = db.prepare('SELECT receipt_json FROM command_receipt WHERE command_id=? AND library_id=?').get(commandId, binding.libraryId);
      const init: unknown = row ? JSON.parse(String(row.receipt_json)) : null;
      if (!isReceipt(init) || init.commandId !== commandId || init.libraryId !== binding.libraryId || !isProject(init.result) || init.result.id !== binding.projectId || init.result.libraryId !== binding.libraryId || db.prepare('SELECT id FROM library WHERE singleton=1').get()?.id !== binding.libraryId || !db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(binding.projectId, binding.libraryId)) throw new TransferError('INVALID_TRANSFER_RECEIPT');
    } finally { db.close(); }
  }
  return { root, workspaceId: manifest.workspaceId, sourceWorkspaceId: receipt.sourceWorkspaceId, backupId: policy.transferId, manifestHash: receipt.manifestHash, libraryId: manifest.binding?.libraryId ?? null, projectId: manifest.binding?.projectId ?? null, scheduling: policy.state };
}
