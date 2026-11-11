import type { DatabaseSync } from 'node:sqlite';
export const schemaVersion = 5;
export function migrateGeneration(db: DatabaseSync): void {
  if ((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version >= 5) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE generation_prepared(prepared_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id), plan_json TEXT NOT NULL) STRICT;
      CREATE TABLE generation_task(task_id TEXT PRIMARY KEY, prepared_id TEXT NOT NULL UNIQUE REFERENCES generation_prepared(prepared_id), project_id TEXT NOT NULL REFERENCES project(id), approval_json TEXT NOT NULL, currency TEXT NOT NULL, reservation_micros INTEGER NOT NULL CHECK(reservation_micros>=0)) STRICT;
      CREATE TABLE task_attempt(attempt_id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES generation_task(task_id), view_json TEXT NOT NULL, intent_json TEXT, output_json TEXT, client_request_id TEXT UNIQUE, collection_id TEXT REFERENCES collection_job(collection_id)) STRICT;
      CREATE TABLE task_lease(attempt_id TEXT PRIMARY KEY REFERENCES task_attempt(attempt_id), token INTEGER NOT NULL CHECK(token>0), owner TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE scheduler_job(attempt_id TEXT PRIMARY KEY REFERENCES task_attempt(attempt_id), next_run_at INTEGER NOT NULL, polls INTEGER NOT NULL DEFAULT 0, deadline INTEGER NOT NULL) STRICT;
      CREATE TABLE generation_fact(id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL REFERENCES task_attempt(attempt_id), source TEXT NOT NULL, lease_token INTEGER NOT NULL, received_at INTEGER NOT NULL, outcome_json TEXT NOT NULL, applied INTEGER NOT NULL CHECK(applied IN (0,1))) STRICT;
      CREATE TABLE generation_command(command_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, kind TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES generation_task(task_id)) STRICT;
      CREATE INDEX generation_budget ON generation_task(project_id,currency);
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(5,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=5; PRAGMA user_version=5; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
