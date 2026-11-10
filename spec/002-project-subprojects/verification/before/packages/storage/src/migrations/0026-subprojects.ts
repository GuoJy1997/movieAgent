import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
export const defaultSubprojectId=(projectId:string)=>'default-'+createHash('sha256').update(projectId).digest('hex').slice(0,32);
export function migrateSubprojects(db:DatabaseSync):void{
 if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>=26)return;
 db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
 try{
 db.exec(`CREATE TABLE canvas_v26(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),library_id TEXT NOT NULL REFERENCES library(id),revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)) STRICT;
 INSERT INTO canvas_v26 SELECT id,project_id,library_id,revision FROM canvas;
 DROP TABLE canvas; ALTER TABLE canvas_v26 RENAME TO canvas;
 CREATE INDEX canvas_project ON canvas(project_id);
 CREATE TABLE subproject(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),title TEXT NOT NULL,number TEXT NOT NULL DEFAULT '',display_order INTEGER NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,primary_canvas_id TEXT,primary_timeline_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
 CREATE INDEX subproject_project ON subproject(project_id,display_order);
 CREATE TABLE content_scope(kind TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES project(id),subproject_id TEXT REFERENCES subproject(id),PRIMARY KEY(kind,id)) STRICT;
 CREATE INDEX content_scope_owner ON content_scope(project_id,subproject_id,kind);
 CREATE TABLE canvas_descriptor(canvas_id TEXT PRIMARY KEY REFERENCES canvas(id),title TEXT NOT NULL) STRICT;
 CREATE TABLE project_asset(project_id TEXT NOT NULL REFERENCES project(id),asset_id TEXT NOT NULL,source_subproject_id TEXT REFERENCES subproject(id),common INTEGER NOT NULL DEFAULT 0 CHECK(common IN(0,1)),PRIMARY KEY(project_id,asset_id)) STRICT;
 CREATE TABLE asset_usage(project_id TEXT NOT NULL,subproject_id TEXT NOT NULL REFERENCES subproject(id),owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,reference_json TEXT NOT NULL,PRIMARY KEY(subproject_id,owner_kind,owner_id,reference_json)) STRICT;
 CREATE TABLE project_memory_settings(project_id TEXT PRIMARY KEY REFERENCES project(id),profile_json TEXT) STRICT;
 CREATE TABLE subproject_continuity(subproject_id TEXT NOT NULL REFERENCES subproject(id),source_subproject_id TEXT NOT NULL REFERENCES subproject(id),pinned_completion INTEGER,PRIMARY KEY(subproject_id,source_subproject_id)) STRICT;
 CREATE TABLE subproject_completion(id TEXT PRIMARY KEY,subproject_id TEXT NOT NULL REFERENCES subproject(id),revision INTEGER NOT NULL,source_hash TEXT NOT NULL,source_json TEXT NOT NULL,profile_json TEXT,state TEXT NOT NULL,task_id TEXT,prepared_json TEXT,error_code TEXT,created_at TEXT NOT NULL,UNIQUE(subproject_id,revision),UNIQUE(subproject_id,source_hash)) STRICT;
 CREATE TABLE project_memory(id TEXT NOT NULL,revision INTEGER NOT NULL,project_id TEXT NOT NULL REFERENCES project(id),subproject_id TEXT REFERENCES subproject(id),completion_id TEXT REFERENCES subproject_completion(id),kind TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,sources_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(id,revision)) STRICT;
 CREATE TABLE project_memory_head(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,FOREIGN KEY(id,revision) REFERENCES project_memory(id,revision)) STRICT;
 CREATE TABLE subproject_deliverable(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),subproject_id TEXT NOT NULL REFERENCES subproject(id),timeline_id TEXT NOT NULL,timeline_revision INTEGER NOT NULL,data_json TEXT NOT NULL) STRICT;
 CREATE TRIGGER immutable_project_memory_update BEFORE UPDATE ON project_memory BEGIN SELECT RAISE(ABORT,'immutable project memory'); END;
 CREATE TRIGGER immutable_project_memory_delete BEFORE DELETE ON project_memory BEGIN SELECT RAISE(ABORT,'immutable project memory'); END;`);
 const tableExists=(name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
 for(const p of db.prepare('SELECT * FROM project').all()){
 const pid=String(p.id),sid=defaultSubprojectId(pid),now=new Date().toISOString(),canvas=db.prepare('SELECT id FROM canvas WHERE project_id=? ORDER BY rowid').get(pid);
 db.prepare('INSERT INTO subproject VALUES(?,?,?,?,?,?,1,?,NULL,?,?)').run(sid,pid,'默认子项目','',0,'preparing',canvas?.id??null,now,now);
 const bind=(kind:string,id:string,shared=false)=>db.prepare('INSERT OR IGNORE INTO content_scope VALUES(?,?,?,?)').run(kind,id,pid,shared?null:sid);
 for(const c of db.prepare('SELECT id FROM canvas WHERE project_id=?').all(pid)){bind('canvas',String(c.id));db.prepare('INSERT INTO canvas_descriptor VALUES(?,?)').run(c.id,'制作画布');}
 if(tableExists('creation_current'))for(const c of db.prepare('SELECT kind,id FROM creation_current WHERE project_id=?').all(pid))bind(String(c.kind),String(c.id),c.kind==='entity');
 for(const [table,key,kind]of [['timeline','id','timeline'],['agent_session','session_id','session'],['generation_prepared','prepared_id','prepared'],['generation_task','task_id','task'],['shot_production','production_id','production'],['render_plan','plan_id','render'],['audio_batch','plan_id','audio']]as const){
  if(!tableExists(table))continue;const columns=db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);if(!columns.includes(key)||!columns.includes('project_id'))continue;
  for(const c of db.prepare('SELECT '+key+' id FROM '+table+' WHERE project_id=?').all(pid))bind(kind,String(c.id));
 }
 if(tableExists('asset')){const ps=db.prepare('SELECT count(*) n FROM project').get();if(Number(ps?.n)===1)for(const a of db.prepare('SELECT asset_id id FROM asset').all())db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,NULL,1)').run(pid,a.id);}
 }
 db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(26,?)').run(new Date().toISOString());db.exec('UPDATE library SET schema_version=26; PRAGMA user_version=26;');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SUBPROJECT_FOREIGN_KEY_CHECK');
 db.exec('COMMIT; PRAGMA foreign_keys=ON');
 }catch(error){db.exec('ROLLBACK; PRAGMA foreign_keys=ON');throw error;}
}
