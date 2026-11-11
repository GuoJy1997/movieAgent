import type { DatabaseSync } from 'node:sqlite';
/** SQLite's VACUUM INTO reads one consistent snapshot including committed WAL. */
export function snapshotDatabase(db: DatabaseSync, destination: string): void {
  db.prepare('VACUUM INTO ?').run(destination);
}
