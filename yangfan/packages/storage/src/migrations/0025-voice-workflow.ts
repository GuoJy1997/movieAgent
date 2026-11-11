import type {DatabaseSync} from 'node:sqlite';
export function migrateVoiceWorkflow(db:DatabaseSync):void{
 if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>=25)return;db.exec('BEGIN IMMEDIATE');
 try{db.exec(`ALTER TABLE character_voice_media RENAME TO character_voice_media_legacy;
 CREATE TABLE character_voice_media(voice_id TEXT NOT NULL,revision INTEGER NOT NULL,project_id TEXT NOT NULL,reference_json TEXT NOT NULL,source_hash TEXT NOT NULL,probe_id TEXT,PRIMARY KEY(voice_id,revision,reference_json),FOREIGN KEY(voice_id,revision,project_id) REFERENCES character_voice_revision(id,revision,project_id)) STRICT;
 INSERT INTO character_voice_media SELECT * FROM character_voice_media_legacy;
 DROP TABLE character_voice_media_legacy;
 CREATE TABLE voice_provider_catalog(connection_id TEXT NOT NULL,connection_revision INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(connection_id,connection_revision)) STRICT;
 CREATE TABLE voice_clone_job(job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),revision INTEGER NOT NULL,data_json TEXT NOT NULL) STRICT;
 CREATE TABLE voice_qualification(project_id TEXT NOT NULL REFERENCES project(id),voice_id TEXT NOT NULL,voice_revision INTEGER NOT NULL,fingerprint TEXT NOT NULL,emotion TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(voice_id,voice_revision,fingerprint,emotion,revision)) STRICT;
 CREATE TABLE dialogue_audio_assembly(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),revision INTEGER NOT NULL,data_json TEXT NOT NULL) STRICT;`);db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(25,?)').run(new Date().toISOString());db.exec('UPDATE library SET schema_version=25; PRAGMA user_version=25; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}
