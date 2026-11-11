import type { DatabaseSync } from 'node:sqlite';
export function migrateCreation(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 11) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE creation_revision(
        kind TEXT NOT NULL CHECK(kind IN ('entity','script','shot')), id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision>0), project_id TEXT NOT NULL REFERENCES project(id),
        data_json TEXT NOT NULL, PRIMARY KEY(kind,id,revision), UNIQUE(kind,id,revision,project_id)
      ) STRICT;
      CREATE TABLE creation_current(
        kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, project_id TEXT NOT NULL REFERENCES project(id),
        PRIMARY KEY(kind,id), FOREIGN KEY(kind,id,revision,project_id) REFERENCES creation_revision(kind,id,revision,project_id)
      ) STRICT;
      CREATE INDEX creation_project_current ON creation_current(project_id,kind);
      CREATE TABLE shot_output_selection(
        shot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id), selection_revision INTEGER NOT NULL CHECK(selection_revision>0), data_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE shot_output_selection_history(
        shot_id TEXT NOT NULL, selection_revision INTEGER NOT NULL CHECK(selection_revision>0), project_id TEXT NOT NULL REFERENCES project(id), data_json TEXT NOT NULL,
        PRIMARY KEY(shot_id,selection_revision)
      ) STRICT;
      CREATE TRIGGER immutable_creation_revision_update BEFORE UPDATE ON creation_revision BEGIN SELECT RAISE(ABORT,'immutable creation revision'); END;
      CREATE TRIGGER immutable_creation_revision_delete BEFORE DELETE ON creation_revision BEGIN SELECT RAISE(ABORT,'immutable creation revision'); END;
      CREATE TRIGGER immutable_selection_history_update BEFORE UPDATE ON shot_output_selection_history BEGIN SELECT RAISE(ABORT,'immutable selection history'); END;
      CREATE TRIGGER immutable_selection_history_delete BEFORE DELETE ON shot_output_selection_history BEGIN SELECT RAISE(ABORT,'immutable selection history'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(11,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=11; PRAGMA user_version=11; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
