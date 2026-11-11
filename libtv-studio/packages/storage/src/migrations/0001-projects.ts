import type { DatabaseSync } from 'node:sqlite';

export const schemaVersion = 1;
export function migrateProjects(db: DatabaseSync, newLibraryId: string): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version >= schemaVersion) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE library (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        id TEXT NOT NULL UNIQUE,
        schema_version INTEGER NOT NULL CHECK (schema_version > 0)
      ) STRICT;
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES library(id),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE engine_owner (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        instance_id TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE migration_log (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    db.prepare('INSERT INTO library(singleton, id, schema_version) VALUES (1, ?, ?)').run(newLibraryId, schemaVersion);
    db.prepare('INSERT INTO migration_log(version, applied_at) VALUES (?, ?)').run(schemaVersion, new Date().toISOString());
    db.exec('PRAGMA user_version = 1; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
