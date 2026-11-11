import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDirectoryProject, inspectDirectoryProject, bindDirectoryProject } from '../../apps/desktop/src/main/project-directories.ts';
import { bootstrapWorkspace } from '../../apps/desktop/src/main/workspace-bootstrap.ts';
import { createProjectBackup, restoreProjectBackup } from '../../packages/storage/src/project-backup.ts';
import { activateRestoredProject } from '../../packages/storage/src/project-transfer.ts';
import { readProjectPolicy, replaceProjectPolicy } from '../../packages/storage/src/project-policy.ts';
import { openLibrary } from '../../packages/storage/src/database.ts';
import { startEngine } from '../../packages/engine/src/bootstrap.ts';
import type { Result } from '../../packages/contracts/src/result.ts';
const roots: string[] = [];
const val = <T>(result: Result<T>): T => { if (!result.ok) throw Error(result.error.code); return result.value; };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function copy() {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-p5-review-')); roots.push(root);
  const source = val(await createDirectoryProject({ mode: 'new', directory: root, name: '未初始化短剧' }));
  const backupRoot = join(root, 'backup'), destination = join(root, 'copy');
  val(await createProjectBackup({ projectRoot: source.root, destination: backupRoot, appVersion: '0.2.0' }));
  const receipt = val(await restoreProjectBackup({ backupRoot, destination }));
  return { root, source, backupRoot, destination, receipt, libraryRoot: join(destination, '.movieagent/library') };
}
it('reports active state on completed restore retry instead of claiming execution was paused', async () => {
  const f = await copy(); val(await activateRestoredProject(f.destination));
  expect(val(await restoreProjectBackup(f))).toMatchObject({ workspaceId: f.receipt.workspaceId, scheduling: 'active' });
  expect((await readProjectPolicy(f.libraryRoot))?.state).toBe('active');
});
it('rejects completed restore retry against a retired destination', async () => {
  const f = await copy(), policy = (await readProjectPolicy(f.libraryRoot))!;
  await replaceProjectPolicy(f.libraryRoot, { ...policy, state: 'retired' });
  expect(await restoreProjectBackup(f)).toMatchObject({ ok: false, error: { code: 'PROJECT_RETIRED' } });
});
it('rejects completed restore retry while its destination is open', async () => {
  const f = await copy(), library = val(await openLibrary({ root: f.libraryRoot }));
  try { expect(await restoreProjectBackup(f)).toMatchObject({ ok: false, error: { code: 'PROJECT_IN_USE' } }); }
  finally { val(await library.close()); }
});
it('activates a restored file-only project after normal bootstrap binds its initialization receipt', async () => {
  const f = await copy(), directory = val(await inspectDirectoryProject(f.destination)), engine = val(await startEngine({ root: f.libraryRoot }));
  let binding;
  try { binding = val(await bootstrapWorkspace(directory, { identity: engine.identity, execute: async c => engine.commands.execute(c), query: async q => engine.commands.query(q) })).manifest.binding; }
  finally { val(await engine.close()); }
  expect(val(await activateRestoredProject(f.destination))).toMatchObject({ scheduling: 'active', ...binding });
  expect(val(await restoreProjectBackup(f))).toMatchObject({ scheduling: 'active', ...binding });
  const reopened = val(await startEngine({ root: f.libraryRoot }));
  try { expect(reopened.identity.schedulingPaused).toBe(false); } finally { val(await reopened.close()); }
});
it('does not accept an unrelated database binding as file-only initialization', async () => {
  const f = await copy(), engine = val(await startEngine({ root: f.libraryRoot }));
  try { const project = val(engine.projects.create({ name: 'Unrelated' })); val(await bindDirectoryProject(f.destination, { workspaceId: f.receipt.workspaceId, libraryId: engine.identity.libraryId, projectId: project.id })); }
  finally { val(await engine.close()); }
  expect(await activateRestoredProject(f.destination)).toMatchObject({ ok: false, error: { code: 'INVALID_TRANSFER_RECEIPT' } });
});
it.each(['DELETE','WAL'])('refuses a future schema without altering %s business bytes', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'movieagent-future-p5-')); roots.push(root);
  const path = join(root, 'library.sqlite'), db = new DatabaseSync(path); let closed = false;
  try {
    db.exec(`PRAGMA journal_mode=${mode}; PRAGMA wal_autocheckpoint=0; CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES('keep future committed bytes'); PRAGMA user_version=999;`);
    if (mode === 'DELETE') { db.close(); closed = true; }
    const before = await readFile(path), walBefore = mode === 'WAL' ? await readFile(path + '-wal') : null;
    const opened = await openLibrary({ root }); if (opened.ok) val(await opened.value.close());
    expect(opened).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_SCHEMA' } });
    expect(await readFile(path)).toEqual(before);
    if (walBefore) expect(await readFile(path + '-wal')).toEqual(walBefore);
  } finally { if (!closed) db.close(); }
});
