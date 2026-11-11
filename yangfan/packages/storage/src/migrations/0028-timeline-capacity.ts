import type {DatabaseSync} from 'node:sqlite';
/** Format capability floor only: immutable timeline/plan JSON and hashes are untouched. */
export function migrateTimelineCapacity(db:DatabaseSync):void{
 if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>=28)return;
 db.exec('BEGIN IMMEDIATE');
 try{db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(28,?)').run(new Date().toISOString());db.exec('UPDATE library SET schema_version=28; PRAGMA user_version=28; COMMIT');}
 catch(error){db.exec('ROLLBACK');throw error;}
}
