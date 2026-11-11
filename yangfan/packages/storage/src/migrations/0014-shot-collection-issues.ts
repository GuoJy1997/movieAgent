import type { DatabaseSync } from 'node:sqlite';

export function migrateShotCollectionIssues(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 14) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shot_production_collection_issue(
        issue_id TEXT PRIMARY KEY,
        production_id TEXT NOT NULL REFERENCES shot_production(production_id),
        node_id TEXT, task_id TEXT,
        error_code TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS shot_collection_issue_production ON shot_production_collection_issue(production_id);
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(14,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=14; PRAGMA user_version=14; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
