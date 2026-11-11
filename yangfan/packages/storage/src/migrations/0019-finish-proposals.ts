import type { DatabaseSync } from 'node:sqlite';

export function migrateFinishProposals(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 19) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE finish_run(run_id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES agent_session(session_id),prepared_json TEXT NOT NULL,state TEXT NOT NULL,stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN (0,1)),task_json TEXT,proposal_json TEXT,error_code TEXT,harvested INTEGER NOT NULL DEFAULT 0 CHECK(harvested IN (0,1))) STRICT;
      CREATE TABLE finish_message(run_id TEXT NOT NULL REFERENCES finish_run(run_id),role TEXT NOT NULL CHECK(role IN ('user','assistant')),text TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(run_id,role)) STRICT;
      CREATE TABLE finish_action(run_id TEXT PRIMARY KEY REFERENCES finish_run(run_id),action_id TEXT NOT NULL UNIQUE,selection_hash TEXT NOT NULL,data_json TEXT NOT NULL) STRICT;
      CREATE INDEX finish_session ON finish_run(session_id);
      CREATE TRIGGER immutable_finish_prepared BEFORE UPDATE OF prepared_json ON finish_run BEGIN SELECT RAISE(ABORT,'immutable finish turn'); END;
      CREATE TRIGGER immutable_finish_proposal BEFORE UPDATE OF proposal_json ON finish_run WHEN OLD.proposal_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable finish proposal'); END;
      CREATE TRIGGER immutable_finish_action_update BEFORE UPDATE ON finish_action BEGIN SELECT RAISE(ABORT,'immutable finish action'); END;
      CREATE TRIGGER immutable_finish_action_delete BEFORE DELETE ON finish_action BEGIN SELECT RAISE(ABORT,'immutable finish action'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(19,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=19; PRAGMA user_version=19; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
