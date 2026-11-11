import { lstat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isWorkspaceId } from '../../contracts/src/directory-projects.ts';
import { isRecord } from '../../contracts/src/result.ts';
import { readLimited, TransferError, writeTransferJson } from './project-transfer-files.ts';
export interface ProjectPolicy { format: 'movieagent.maintenance-state'; schemaVersion: 1; state: 'paused' | 'active' | 'retired'; transferId: string; sourceWorkspaceId: string }
const filename = '.maintenance-state.json';
/** Missing means an ordinary project. Invalid policy fails closed. */
export async function readProjectPolicy(libraryRoot: string): Promise<ProjectPolicy | null> {
  try { await lstat(join(libraryRoot, filename)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readLimited(libraryRoot, filename, 8192)));
    if (!isRecord(value) || Object.keys(value).length !== 5 || value.format !== 'movieagent.maintenance-state' || value.schemaVersion !== 1 || !['paused','active','retired'].includes(value.state as string) || !isWorkspaceId(value.transferId) || !isWorkspaceId(value.sourceWorkspaceId)) throw Error();
    return value as unknown as ProjectPolicy;
  } catch { throw new TransferError('INVALID_PROJECT_POLICY'); }
}
export async function replaceProjectPolicy(libraryRoot: string, policy: ProjectPolicy): Promise<void> {
  // Caller owns the directory guard; never rewrite through an existing link.
  await readProjectPolicy(libraryRoot);
  const temporary = `.maintenance-${randomUUID()}.tmp`;
  await writeTransferJson(libraryRoot, temporary, policy);
  await rename(join(libraryRoot, temporary), join(libraryRoot, filename));
}
