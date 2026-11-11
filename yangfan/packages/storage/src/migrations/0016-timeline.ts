import type { DatabaseSync } from 'node:sqlite';
export function migrateTimeline(db: DatabaseSync): void {
 if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>=16)return;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(`CREATE TABLE timeline(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,library_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0)) STRICT;
   CREATE TABLE timeline_revision(timeline_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),project_id TEXT NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(timeline_id,revision),FOREIGN KEY(timeline_id) REFERENCES timeline(id)) STRICT;
   CREATE TABLE timeline_assembly_plan(plan_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,plan_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,data_json TEXT NOT NULL) STRICT;
   CREATE TABLE timeline_assembly_receipt(plan_id TEXT PRIMARY KEY,timeline_id TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,FOREIGN KEY(plan_id) REFERENCES timeline_assembly_plan(plan_id),FOREIGN KEY(timeline_id,revision) REFERENCES timeline_revision(timeline_id,revision)) STRICT;
   CREATE TABLE timeline_source_reference(owner_kind TEXT NOT NULL CHECK(owner_kind IN ('revision','assembly')),owner_id TEXT NOT NULL,revision INTEGER NOT NULL,clip_id TEXT NOT NULL,reference_json TEXT NOT NULL,source_hash TEXT NOT NULL,source_probe_id TEXT,PRIMARY KEY(owner_kind,owner_id,revision,clip_id)) STRICT;
   CREATE INDEX timeline_project ON timeline(project_id);
   CREATE INDEX timeline_source_hash ON timeline_source_reference(source_hash);
   CREATE INDEX timeline_source_probe ON timeline_source_reference(source_probe_id);`);
  for(const table of ['timeline_revision','timeline_assembly_plan','timeline_assembly_receipt','timeline_source_reference'])db.exec(`CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TIMELINE'); END; CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TIMELINE'); END;`);
  db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(16,?)').run(new Date().toISOString());
  db.exec('UPDATE library SET schema_version=16; PRAGMA user_version=16; COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
