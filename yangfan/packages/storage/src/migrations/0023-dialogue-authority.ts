import type { DatabaseSync } from 'node:sqlite';
export function migrateDialogueAuthority(db: DatabaseSync): void {
  if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>=23)return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE dialogue_batch_approval(plan_id TEXT PRIMARY KEY REFERENCES dialogue_production_plan(plan_id),approval_json TEXT NOT NULL CHECK(json_valid(approval_json) AND length(approval_json)<=65536)) STRICT;
      CREATE TABLE dialogue_review_context(take_id TEXT NOT NULL,review_revision INTEGER NOT NULL CHECK(review_revision>0),context_json TEXT NOT NULL CHECK(json_valid(context_json) AND length(context_json)<=65536),PRIMARY KEY(take_id,review_revision),FOREIGN KEY(take_id,review_revision) REFERENCES dialogue_review(take_id,revision)) STRICT;
      CREATE TRIGGER immutable_dialogue_batch_approval BEFORE UPDATE ON dialogue_batch_approval BEGIN SELECT RAISE(ABORT,'immutable dialogue approval'); END;
      CREATE TRIGGER immutable_dialogue_batch_approval_delete BEFORE DELETE ON dialogue_batch_approval BEGIN SELECT RAISE(ABORT,'immutable dialogue approval'); END;
      CREATE TRIGGER immutable_dialogue_review_context BEFORE UPDATE ON dialogue_review_context BEGIN SELECT RAISE(ABORT,'immutable dialogue review context'); END;
      CREATE TRIGGER immutable_dialogue_review_context_delete BEFORE DELETE ON dialogue_review_context BEGIN SELECT RAISE(ABORT,'immutable dialogue review context'); END;
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(23,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=23; PRAGMA user_version=23; COMMIT');
  } catch(error){db.exec('ROLLBACK');throw error;}
}
