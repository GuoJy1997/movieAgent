import type { DatabaseSync } from 'node:sqlite';

export const schemaVersion = 7;
export function migrateCanvas(db: DatabaseSync): void {
  if ((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version >= 7) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE canvas (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE REFERENCES project(id),
        library_id TEXT NOT NULL REFERENCES library(id),
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
      ) STRICT;
      INSERT INTO canvas(id,project_id,library_id) SELECT id,id,library_id FROM project;
      CREATE TABLE canvas_node (
        canvas_id TEXT NOT NULL REFERENCES canvas(id),
        node_id TEXT NOT NULL,
        incarnation TEXT NOT NULL,
        deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
        node_json TEXT NOT NULL,
        PRIMARY KEY(canvas_id,node_id)
      ) STRICT;
      CREATE TABLE canvas_node_revision (
        canvas_id TEXT NOT NULL REFERENCES canvas(id),
        node_id TEXT NOT NULL,
        incarnation TEXT NOT NULL,
        semantic_revision INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        PRIMARY KEY(canvas_id,node_id,incarnation,semantic_revision),
        FOREIGN KEY(canvas_id,node_id) REFERENCES canvas_node(canvas_id,node_id)
      ) STRICT;
      CREATE TABLE canvas_command (
        command_id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL REFERENCES canvas(id),
        revision INTEGER NOT NULL,
        inverse_json TEXT NOT NULL,
        UNIQUE(canvas_id,revision)
      ) STRICT;
      CREATE TABLE run_binding (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL REFERENCES canvas(id),
        node_id TEXT NOT NULL,
        task_id TEXT NOT NULL UNIQUE REFERENCES generation_task(task_id),
        binding_json TEXT NOT NULL,
        FOREIGN KEY(canvas_id,node_id) REFERENCES canvas_node(canvas_id,node_id)
      ) STRICT;
      CREATE TABLE canvas_output (
        run_binding_id TEXT PRIMARY KEY REFERENCES run_binding(id),
        artifact_id TEXT NOT NULL REFERENCES artifact(id),
        output_json TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER immutable_canvas_content BEFORE UPDATE ON canvas_node_revision BEGIN SELECT RAISE(ABORT,'immutable content'); END;
      CREATE TRIGGER immutable_run_binding BEFORE UPDATE ON run_binding BEGIN SELECT RAISE(ABORT,'immutable binding'); END;
      CREATE TRIGGER immutable_canvas_output BEFORE UPDATE ON canvas_output BEGIN SELECT RAISE(ABORT,'immutable output'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(7,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=7; PRAGMA user_version=7; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
