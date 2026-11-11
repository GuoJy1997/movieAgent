import type { DatabaseSync } from 'node:sqlite';
export function migrateVoiceReviews(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 22) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE voice_audition(fingerprint TEXT NOT NULL,emotion TEXT NOT NULL,take_id TEXT NOT NULL REFERENCES dialogue_take(id),data_json TEXT NOT NULL,PRIMARY KEY(fingerprint,emotion)) STRICT;
      CREATE TABLE dialogue_review(take_id TEXT NOT NULL REFERENCES dialogue_take(id),revision INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(take_id,revision)) STRICT;
      CREATE TABLE dialogue_selection(shot_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),take_id TEXT NOT NULL REFERENCES dialogue_take(id),selection_revision INTEGER NOT NULL,data_json TEXT NOT NULL) STRICT;
      CREATE TRIGGER immutable_voice_audition BEFORE UPDATE ON voice_audition BEGIN SELECT RAISE(ABORT,'immutable voice audition'); END;
      CREATE TRIGGER immutable_dialogue_review BEFORE UPDATE ON dialogue_review BEGIN SELECT RAISE(ABORT,'immutable dialogue review'); END;
      CREATE TRIGGER immutable_dialogue_selection BEFORE UPDATE ON dialogue_selection BEGIN SELECT RAISE(ABORT,'immutable dialogue selection'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(22,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=22; PRAGMA user_version=22; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
