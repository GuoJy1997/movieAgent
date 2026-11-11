import type { DatabaseSync } from 'node:sqlite';
export function migrateWorkflows(db: DatabaseSync): void {
    if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 10)
        return;
    db.exec('BEGIN IMMEDIATE');
    try {
        db.exec(`
      CREATE TABLE workflow(plan_id TEXT PRIMARY KEY,canvas_id TEXT NOT NULL REFERENCES canvas(id),project_id TEXT NOT NULL REFERENCES project(id),plan_json TEXT NOT NULL,approval_json TEXT,state TEXT NOT NULL) STRICT;
      CREATE TABLE workflow_step(workflow_id TEXT NOT NULL REFERENCES workflow(plan_id),step_id TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,prepared_id TEXT UNIQUE REFERENCES generation_prepared(prepared_id),task_id TEXT UNIQUE REFERENCES generation_task(task_id),state TEXT NOT NULL,reservation_micros INTEGER NOT NULL DEFAULT 0 CHECK(reservation_micros>=0),currency TEXT,error_code TEXT,PRIMARY KEY(workflow_id,step_id)) STRICT;
      CREATE TRIGGER immutable_workflow_plan BEFORE UPDATE OF plan_json ON workflow BEGIN SELECT RAISE(ABORT,'immutable workflow'); END;
    `);
        db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(10,?)').run(new Date().toISOString());
        db.exec('UPDATE library SET schema_version=10; PRAGMA user_version=10; COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
