import type { DatabaseSync } from 'node:sqlite';
export const schemaVersion = 6;
export function migrateProviderVerification(db:DatabaseSync):void {
 if((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version>=6)return;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(`CREATE TABLE provider_verification(library_id TEXT NOT NULL, connection_id TEXT NOT NULL, connection_revision INTEGER NOT NULL, model_id TEXT NOT NULL, state_json TEXT NOT NULL, PRIMARY KEY(library_id,connection_id,connection_revision,model_id)) STRICT;`);
  db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(6,?)').run(new Date().toISOString());
  db.exec('UPDATE library SET schema_version=6; PRAGMA user_version=6; COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
