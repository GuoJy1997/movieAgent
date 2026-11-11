import type { DatabaseSync } from 'node:sqlite';
export function migrateAgent(db: DatabaseSync): void {
    if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 12)
        return;
    db.exec('BEGIN IMMEDIATE');
    try {
        db.exec(`
 CREATE TABLE agent_session(session_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),data_json TEXT NOT NULL) STRICT;
 CREATE TABLE agent_run(run_id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES agent_session(session_id),prepared_json TEXT NOT NULL,state TEXT NOT NULL,stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN (0,1)),task_json TEXT,proposal_json TEXT,error_code TEXT,harvested INTEGER NOT NULL DEFAULT 0 CHECK(harvested IN (0,1))) STRICT;
 CREATE TABLE agent_message(run_id TEXT NOT NULL REFERENCES agent_run(run_id),role TEXT NOT NULL CHECK(role IN ('user','assistant')),text TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(run_id,role)) STRICT;
 CREATE TABLE agent_action(run_id TEXT PRIMARY KEY REFERENCES agent_run(run_id),action_id TEXT NOT NULL UNIQUE,selection_hash TEXT NOT NULL,data_json TEXT NOT NULL) STRICT;
 CREATE INDEX agent_project ON agent_session(project_id);
 CREATE TRIGGER immutable_agent_prepared BEFORE UPDATE OF prepared_json ON agent_run BEGIN SELECT RAISE(ABORT,'immutable agent turn'); END;
 CREATE TRIGGER immutable_agent_proposal BEFORE UPDATE OF proposal_json ON agent_run WHEN OLD.proposal_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable agent proposal'); END;
 CREATE TRIGGER immutable_agent_action_update BEFORE UPDATE ON agent_action BEGIN SELECT RAISE(ABORT,'immutable agent action'); END;
 CREATE TRIGGER immutable_agent_action_delete BEFORE DELETE ON agent_action BEGIN SELECT RAISE(ABORT,'immutable agent action'); END;
 `);
        db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(12,?)').run(new Date().toISOString());
        db.exec('UPDATE library SET schema_version=12; PRAGMA user_version=12; COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
