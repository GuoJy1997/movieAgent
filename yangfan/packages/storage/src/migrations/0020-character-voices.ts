import type { DatabaseSync } from 'node:sqlite';

export function migrateCharacterVoices(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 20) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE character_voice_revision(id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),project_id TEXT NOT NULL REFERENCES project(id),entity_id TEXT NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(id,revision),UNIQUE(id,revision,project_id)) STRICT;
      CREATE TABLE character_voice_current(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),entity_id TEXT NOT NULL,revision INTEGER NOT NULL,FOREIGN KEY(id,revision,project_id) REFERENCES character_voice_revision(id,revision,project_id)) STRICT;
      CREATE TABLE character_voice_media(voice_id TEXT NOT NULL,revision INTEGER NOT NULL,project_id TEXT NOT NULL,reference_json TEXT NOT NULL,source_hash TEXT NOT NULL,probe_id TEXT,PRIMARY KEY(voice_id,revision),FOREIGN KEY(voice_id,revision,project_id) REFERENCES character_voice_revision(id,revision,project_id)) STRICT;
      CREATE INDEX character_voice_project ON character_voice_current(project_id,entity_id);
      CREATE TABLE shot_dialogue_revision(id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),project_id TEXT NOT NULL REFERENCES project(id),shot_id TEXT NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(id,revision),UNIQUE(id,revision,project_id)) STRICT;
      CREATE TABLE shot_dialogue_current(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),shot_id TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL,FOREIGN KEY(id,revision,project_id) REFERENCES shot_dialogue_revision(id,revision,project_id)) STRICT;
      CREATE INDEX shot_dialogue_project ON shot_dialogue_current(project_id,shot_id);
      CREATE TRIGGER immutable_character_voice_update BEFORE UPDATE ON character_voice_revision BEGIN SELECT RAISE(ABORT,'immutable character voice'); END;
      CREATE TRIGGER immutable_character_voice_delete BEFORE DELETE ON character_voice_revision BEGIN SELECT RAISE(ABORT,'immutable character voice'); END;
      CREATE TRIGGER immutable_shot_dialogue_update BEFORE UPDATE ON shot_dialogue_revision BEGIN SELECT RAISE(ABORT,'immutable shot dialogue'); END;
      CREATE TRIGGER immutable_shot_dialogue_delete BEFORE DELETE ON shot_dialogue_revision BEGIN SELECT RAISE(ABORT,'immutable shot dialogue'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(20,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=20; PRAGMA user_version=20; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
