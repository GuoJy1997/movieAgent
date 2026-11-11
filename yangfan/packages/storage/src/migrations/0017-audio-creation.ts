import type { DatabaseSync } from 'node:sqlite';
export function migrateAudioCreation(db: DatabaseSync) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 17) return;
  db.exec('BEGIN IMMEDIATE');
  try {
  db.exec(`
    CREATE TABLE voice_line_revision (
      project_id TEXT NOT NULL REFERENCES project(id), id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0), data_json TEXT NOT NULL,
      PRIMARY KEY(project_id,id,revision)
    );
    CREATE TABLE audio_batch (
      plan_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id),
      plan_json TEXT NOT NULL, approval_json TEXT,
      state TEXT NOT NULL CHECK(state IN ('prepared','approved','stopped'))
    );
    CREATE TABLE audio_batch_item (
      plan_id TEXT NOT NULL REFERENCES audio_batch(plan_id), ordinal INTEGER NOT NULL,
      line_id TEXT NOT NULL, line_revision INTEGER NOT NULL,
      prepared_id TEXT NOT NULL UNIQUE REFERENCES generation_prepared(prepared_id),
      task_id TEXT UNIQUE REFERENCES generation_task(task_id), diagnostic TEXT,
      PRIMARY KEY(plan_id,ordinal)
    );
    CREATE TABLE audio_take (
      task_id TEXT PRIMARY KEY REFERENCES generation_task(task_id),
      project_id TEXT NOT NULL REFERENCES project(id), data_json TEXT NOT NULL
    );
    CREATE TABLE transcript_revision (
      project_id TEXT NOT NULL REFERENCES project(id), id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0), task_id TEXT,
      data_json TEXT NOT NULL, PRIMARY KEY(project_id,id,revision)
    );
    CREATE UNIQUE INDEX transcript_original_task ON transcript_revision(task_id) WHERE task_id IS NOT NULL;
    CREATE TABLE audio_publication (
      task_id TEXT PRIMARY KEY REFERENCES generation_task(task_id), diagnostic TEXT,
      usage_json TEXT
    );
    PRAGMA user_version=17;
  `);
  for (const table of ['voice_line_revision', 'transcript_revision', 'audio_take', 'audio_publication']) db.exec(`
    CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIO_REVISION'); END;
    CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIO_REVISION'); END;
  `);
  db.exec(`
    CREATE TRIGGER audio_batch_frozen_plan
      BEFORE UPDATE OF plan_id,project_id,plan_json ON audio_batch
      BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIO_BATCH'); END;
    CREATE TRIGGER audio_batch_frozen_approval
      BEFORE UPDATE OF approval_json ON audio_batch
      WHEN OLD.approval_json IS NOT NULL AND NEW.approval_json IS NOT OLD.approval_json
      BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIO_APPROVAL'); END;
    CREATE TRIGGER audio_batch_fixed_item
      BEFORE UPDATE OF plan_id,ordinal,line_id,line_revision,prepared_id ON audio_batch_item
      BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIO_ITEM'); END;
    CREATE TRIGGER audio_batch_fixed_task
      BEFORE UPDATE OF task_id ON audio_batch_item
      WHEN OLD.task_id IS NOT NULL AND NEW.task_id IS NOT OLD.task_id
      BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIO_TASK'); END;
  `);
  db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(17,?)').run(new Date().toISOString());
  db.exec('UPDATE library SET schema_version=17; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
