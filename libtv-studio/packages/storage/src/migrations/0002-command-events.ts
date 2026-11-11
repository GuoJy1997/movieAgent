import type { DatabaseSync } from 'node:sqlite';
export const schemaVersion = 2;
export function migrateCommandEvents(db: DatabaseSync, streamId: string): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version >= schemaVersion) return; // Future schema rejection belongs to openLibrary before any mutation.
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE event_stream (singleton INTEGER PRIMARY KEY CHECK(singleton=1), stream_id TEXT NOT NULL UNIQUE, first_seq INTEGER NOT NULL DEFAULT 1) STRICT;
      CREATE TABLE domain_event (seq INTEGER PRIMARY KEY AUTOINCREMENT, library_id TEXT NOT NULL REFERENCES library(id), kind TEXT NOT NULL, payload_json TEXT NOT NULL) STRICT;
      CREATE TABLE command_receipt (command_id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES library(id), request_hash TEXT NOT NULL, receipt_json TEXT NOT NULL, committed_seq INTEGER NOT NULL REFERENCES domain_event(seq)) STRICT;`);
    db.prepare('INSERT INTO event_stream(singleton,stream_id) VALUES(1,?)').run(streamId);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(2,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=2; PRAGMA user_version=2; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
