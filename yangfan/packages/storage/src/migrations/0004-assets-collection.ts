import type { DatabaseSync } from 'node:sqlite';
export const schemaVersion = 4;
export function migrateAssets(db: DatabaseSync): void {
  if ((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version >= 4) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE blob_object(object_id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, byte_length INTEGER NOT NULL CHECK(byte_length>0), storage_key TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL) STRICT;
      CREATE TABLE asset(id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES library(id), name TEXT NOT NULL) STRICT;
      CREATE TABLE artifact(id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES library(id), object_id TEXT NOT NULL REFERENCES blob_object(object_id), created_at TEXT NOT NULL) STRICT;
      CREATE TABLE asset_version(asset_id TEXT NOT NULL REFERENCES asset(id), version INTEGER NOT NULL CHECK(version>0), library_id TEXT NOT NULL REFERENCES library(id), object_id TEXT NOT NULL REFERENCES blob_object(object_id), artifact_id TEXT REFERENCES artifact(id), created_at TEXT NOT NULL, PRIMARY KEY(asset_id,version)) STRICT;
      CREATE TABLE import_batch(import_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL UNIQUE, command_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, command_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('collecting','ready'))) STRICT;
      CREATE TABLE collection_job(collection_id TEXT PRIMARY KEY, source_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','collecting','validated','durable','retryable_failure','unrecoverable','ready')), receipt_json TEXT, error_code TEXT) STRICT;
      CREATE TABLE import_collection(import_id TEXT NOT NULL REFERENCES import_batch(import_id), collection_id TEXT PRIMARY KEY REFERENCES collection_job(collection_id), asset_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL) STRICT;
      CREATE TABLE storage_reservation(collection_id TEXT PRIMARY KEY REFERENCES collection_job(collection_id), bytes INTEGER NOT NULL CHECK(bytes>0)) STRICT;
      CREATE TRIGGER immutable_blob BEFORE UPDATE ON blob_object BEGIN SELECT RAISE(ABORT,'immutable object'); END;
      CREATE TRIGGER immutable_asset_version BEFORE UPDATE ON asset_version BEGIN SELECT RAISE(ABORT,'immutable version'); END;
      CREATE TRIGGER immutable_artifact BEFORE UPDATE ON artifact BEGIN SELECT RAISE(ABORT,'immutable artifact'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(4,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=4; PRAGMA user_version=4; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
