import type {DatabaseSync} from 'node:sqlite';
/** A local scheduling decision, never a provider completion or billing fact. */
export function migrateUnknownTaskRelease(db:DatabaseSync):void{
 if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>=27)return;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('CREATE TABLE unknown_task_release(task_id TEXT PRIMARY KEY REFERENCES generation_task(task_id),attempt_id TEXT NOT NULL UNIQUE REFERENCES task_attempt(attempt_id),released_at INTEGER NOT NULL CHECK(released_at>0)) STRICT');
  db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(27,?)').run(new Date().toISOString());
  db.exec('UPDATE library SET schema_version=27; PRAGMA user_version=27; COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
