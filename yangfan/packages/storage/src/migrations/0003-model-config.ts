import type { DatabaseSync } from 'node:sqlite';
export const schemaVersion = 3;
export function migrateModelConfig(db: DatabaseSync): void {
  if ((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version >= 3) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE connection_revision (id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), library_id TEXT NOT NULL REFERENCES library(id), data_json TEXT NOT NULL, PRIMARY KEY(id,revision)) STRICT;
      CREATE TABLE model_revision (id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), library_id TEXT NOT NULL REFERENCES library(id), connection_id TEXT NOT NULL, connection_revision INTEGER NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(id,revision), FOREIGN KEY(connection_id,connection_revision) REFERENCES connection_revision(id,revision)) STRICT;
      CREATE TABLE profile_revision (id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), library_id TEXT NOT NULL REFERENCES library(id), model_id TEXT NOT NULL, model_revision INTEGER NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(id,revision), FOREIGN KEY(model_id,model_revision) REFERENCES model_revision(id,revision)) STRICT;
      CREATE TABLE credential_authorization (id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>0), library_id TEXT NOT NULL REFERENCES library(id), connection_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('protected','session','revoked','unavailable')), UNIQUE(connection_id,version)) STRICT;
      CREATE TRIGGER immutable_connection BEFORE UPDATE ON connection_revision BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
      CREATE TRIGGER immutable_model BEFORE UPDATE ON model_revision BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
      CREATE TRIGGER immutable_profile BEFORE UPDATE ON profile_revision BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(3,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=3; PRAGMA user_version=3; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
