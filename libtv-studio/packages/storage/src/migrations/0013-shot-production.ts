import type { DatabaseSync } from 'node:sqlite';

export function migrateShotProduction(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 13) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE shot_production(
        production_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id),
        canvas_id TEXT NOT NULL REFERENCES canvas(id), plan_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('prepared','applied','stopping','stopped')),
        workflow_id TEXT REFERENCES workflow(plan_id)
      ) STRICT;
      CREATE INDEX shot_production_project ON shot_production(project_id);
      CREATE TABLE shot_canvas_binding(
        canvas_id TEXT NOT NULL REFERENCES canvas(id), node_id TEXT NOT NULL,
        production_id TEXT NOT NULL REFERENCES shot_production(production_id),
        shot_id TEXT NOT NULL, shot_revision INTEGER NOT NULL, binding_json TEXT NOT NULL,
        PRIMARY KEY(canvas_id,node_id)
      ) STRICT;
      CREATE INDEX shot_canvas_binding_shot ON shot_canvas_binding(shot_id,shot_revision);
      CREATE TABLE shot_production_output(
        production_id TEXT NOT NULL REFERENCES shot_production(production_id),
        node_id TEXT NOT NULL, task_id TEXT NOT NULL, data_json TEXT NOT NULL,
        PRIMARY KEY(production_id,node_id,task_id)
      ) STRICT;
      CREATE INDEX shot_production_output_shot ON shot_production_output(production_id,node_id);
      CREATE TRIGGER immutable_shot_production_plan BEFORE UPDATE OF plan_json ON shot_production BEGIN SELECT RAISE(ABORT,'immutable shot production plan'); END;
      CREATE TRIGGER immutable_shot_canvas_binding BEFORE UPDATE ON shot_canvas_binding BEGIN SELECT RAISE(ABORT,'immutable shot binding'); END;
      CREATE TRIGGER immutable_shot_production_output BEFORE UPDATE ON shot_production_output BEGIN SELECT RAISE(ABORT,'immutable shot output'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(13,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=13; PRAGMA user_version=13; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
