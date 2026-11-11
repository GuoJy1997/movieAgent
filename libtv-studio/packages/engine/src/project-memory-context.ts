import type {LibraryHandle} from '../../storage/src/database.ts';
import type {MemoryEntry} from '../../contracts/src/project-memory.ts';
import type {WorkScope} from '../../contracts/src/subprojects.ts';
export function memoryContext(library:LibraryHandle,scope:WorkScope):MemoryEntry[]{
 const db=library.db;
 const result=db.prepare("SELECT m.* FROM project_memory m JOIN project_memory_head h ON h.id=m.id AND h.revision=m.revision WHERE m.project_id=? AND m.status='active' AND (m.subproject_id IS NULL OR m.subproject_id=?) ORDER BY CASE WHEN m.kind='rule' THEN 0 ELSE 1 END,m.rowid").all(scope.projectId,scope.subprojectId).map(memoryRow);
 for(const selection of db.prepare('SELECT * FROM subproject_continuity WHERE subproject_id=?').all(scope.subprojectId)){
  const row=selection.pinned_completion===null?
   db.prepare("SELECT m.* FROM project_memory m JOIN project_memory_head h ON h.id=m.id AND h.revision=m.revision WHERE m.project_id=? AND m.subproject_id=? AND m.kind='summary' AND m.status='active'").get(scope.projectId,String(selection.source_subproject_id)):
   db.prepare("SELECT m.* FROM project_memory m JOIN project_memory_head h ON h.id=m.id JOIN project_memory current ON current.id=h.id AND current.revision=h.revision WHERE m.project_id=? AND m.subproject_id=? AND m.kind='summary' AND m.revision=? AND current.status='active' AND m.status='active'").get(scope.projectId,String(selection.source_subproject_id),Number(selection.pinned_completion));
  if(row)result.push(memoryRow(row));
 }
 return result;
}
export function memoryRow(r:Record<string,unknown>):MemoryEntry{return{id:String(r.id),revision:Number(r.revision),projectId:String(r.project_id),subprojectId:r.subproject_id===null?null:String(r.subproject_id),kind:r.kind as MemoryEntry['kind'],body:String(r.body),status:r.status as MemoryEntry['status'],sources:JSON.parse(String(r.sources_json)),createdAt:String(r.created_at)};}
