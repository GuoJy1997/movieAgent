import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLibrary} from '../../packages/storage/src/database.ts';
import {projectsFor} from '../../packages/engine/src/projects.ts';
import {DatabaseSync} from 'node:sqlite';
const take=<T>(v:import('../../packages/contracts/src/result.ts').Result<T>):T=>{if(!v.ok)throw Error(v.error.code);return v.value;};
it('creates two independent subprojects with multiple canvases and checks parent/CAS ownership',async()=>{
 const mod=await import('../../packages/engine/src/subproject-service.ts').catch(()=>null);expect(mod,'subproject service is implemented').not.toBeNull();if(!mod)return;
 const root=await mkdtemp(join(tmpdir(),'subprojects-')),lib=take(await openLibrary({root}));
 try{const p=take(projectsFor(lib).create({name:'Series'})),q=take(projectsFor(lib).create({name:'Other'})),s=mod.subprojectsFor(lib);
 const initial=take(s.list(p.id));expect(initial.items).toHaveLength(1);expect(initial.items[0]?.title).toBe('默认子项目');
 const a=take(s.create({projectId:p.id,title:'第一集'})),b=take(s.create({projectId:p.id,title:'第二集'}));
 expect(a.id).not.toBe(b.id);expect(take(s.listCanvases({projectId:p.id,subprojectId:a.id})).items).toHaveLength(1);
 const extra=take(s.createCanvas({projectId:p.id,subprojectId:a.id,title:'场景二'}));expect(extra.id).not.toBe(a.primaryCanvasId);
 expect(take(s.listCanvases({projectId:p.id,subprojectId:b.id})).items).toHaveLength(1);
 expect(s.update({projectId:q.id,id:a.id,expectedRevision:a.revision,title:'Wrong'})).toMatchObject({ok:false});
 const updated=take(s.update({projectId:p.id,id:a.id,expectedRevision:a.revision,title:'更名'}));expect(updated.primaryCanvasId).toBe(a.primaryCanvasId);
 expect(s.update({projectId:p.id,id:a.id,expectedRevision:a.revision,title:'Late'})).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});
 expect(lib.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{await lib.close();await rm(root,{recursive:true,force:true});}
});
it('migrates a populated schema25 canvas without changing old node JSON or IDs',async()=>{
 const mod=await import('../../packages/storage/src/migrations/0026-subprojects.ts').catch(()=>null);expect(mod).not.toBeNull();if(!mod)return;
 const db=new DatabaseSync(':memory:');try{db.exec("PRAGMA foreign_keys=ON; CREATE TABLE library(id TEXT PRIMARY KEY,schema_version INTEGER); INSERT INTO library VALUES('lib',25); CREATE TABLE project(id TEXT PRIMARY KEY,library_id TEXT,name TEXT,created_at TEXT); INSERT INTO project VALUES('p','lib','P','now'); CREATE TABLE migration_log(version INTEGER,applied_at TEXT); CREATE TABLE canvas(id TEXT PRIMARY KEY,project_id TEXT UNIQUE REFERENCES project(id),library_id TEXT,revision INTEGER); INSERT INTO canvas VALUES('p','p','lib',3); CREATE TABLE canvas_node(canvas_id TEXT REFERENCES canvas(id),node_id TEXT,node_json TEXT); INSERT INTO canvas_node VALUES('p','n','{\"fixed\":true}'); PRAGMA user_version=25");
 mod.migrateSubprojects(db);expect(db.prepare('SELECT node_json FROM canvas_node').get()?.node_json).toBe('{"fixed":true}');expect(db.prepare('SELECT primary_canvas_id FROM subproject').get()?.primary_canvas_id).toBe('p');
 db.prepare('INSERT INTO canvas(id,project_id,library_id,revision) VALUES(?,?,?,0)').run('new','p','lib');expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 mod.migrateSubprojects(db);expect(db.prepare('SELECT COUNT(*) n FROM subproject').get()?.n).toBe(1);
 }finally{db.close();}
});
