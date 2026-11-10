import type {DatabaseSync} from 'node:sqlite';
/** Build an actual pre-26 fixture; don't leave newer tables behind after setting user_version. */
export function removeSubprojectSchema(db:DatabaseSync){
 const fk=Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys??0);
 db.exec('PRAGMA foreign_keys=OFF');
 for(const t of ['project_memory_head','project_memory','subproject_completion','subproject_continuity','subproject_deliverable','project_memory_settings','asset_usage','project_asset','canvas_descriptor','content_scope','subproject'])db.exec('DROP TABLE IF EXISTS '+t);
 db.exec('DROP INDEX IF EXISTS canvas_project;CREATE UNIQUE INDEX IF NOT EXISTS legacy_canvas_project_unique ON canvas(project_id)');
 db.exec('PRAGMA foreign_keys='+fk);
}
