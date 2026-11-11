import type { DatabaseSync } from 'node:sqlite';
export function migrateDialogueProductions(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 21) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE dialogue_production_plan(plan_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),approved_hash TEXT NOT NULL,owner TEXT NOT NULL,run_id TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL,plan_json TEXT NOT NULL) STRICT;
      CREATE TABLE dialogue_production_item(plan_id TEXT NOT NULL REFERENCES dialogue_production_plan(plan_id),dialogue_id TEXT NOT NULL,prepared_id TEXT NOT NULL,task_id TEXT,diagnostic TEXT,PRIMARY KEY(plan_id,dialogue_id)) STRICT;
      CREATE TABLE dialogue_take(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),shot_id TEXT NOT NULL,dialogue_id TEXT NOT NULL,dialogue_revision INTEGER NOT NULL,origin_kind TEXT NOT NULL,task_id TEXT,data_json TEXT NOT NULL,review_revision INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE UNIQUE INDEX dialogue_provider_take ON dialogue_take(task_id) WHERE origin_kind='provider';
      CREATE INDEX dialogue_take_shot ON dialogue_take(project_id,shot_id);
      CREATE TRIGGER immutable_dialogue_plan BEFORE UPDATE OF plan_json ON dialogue_production_plan BEGIN SELECT RAISE(ABORT,'immutable dialogue plan'); END;
      CREATE TRIGGER immutable_dialogue_take BEFORE UPDATE OF data_json ON dialogue_take BEGIN SELECT RAISE(ABORT,'immutable dialogue take'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(21,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=21; PRAGMA user_version=21; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
