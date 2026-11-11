import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { TransferError, localDirectory, plainPath } from './project-transfer-files.ts';

/** Uses exactly the guard held by openLibrary; a live engine is never interrupted. */
export async function acquireProjectMaintenance(projectRoot: string): Promise<{ close(): void }> {
  const root = await localDirectory(join(projectRoot, '.movieagent', 'library'));
  try { await plainPath(root, 'engine-guard.sqlite', 'file'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const guard = new DatabaseSync(join(root, 'engine-guard.sqlite'));
  try { guard.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE'); }
  catch { guard.close(); throw new TransferError('PROJECT_IN_USE'); }
  let closed = false;
  return { close() { if (!closed) { closed = true; try { guard.exec('ROLLBACK'); } finally { guard.close(); } } } };
}
