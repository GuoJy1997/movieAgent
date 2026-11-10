import {createHash,randomUUID} from 'node:crypto';
import type {LibraryHandle} from '../../storage/src/database.ts';
import type {assetsFor} from './asset-service.ts';
import type {generationFor} from './generation-service.ts';
import {subprojectsFor} from './subproject-service.ts';
import {contentScopesFor} from './content-scope.ts';
import {parseAssetQuery,parseTagAsset,parseDeliverable,type ProjectAssetCatalog,type ProjectAssetItem,type Deliverable,type DeliverableList} from '../../contracts/src/project-assets.ts';
import type {MediaReference} from '../../contracts/src/assets.ts';
import type {WorkScope} from '../../contracts/src/subprojects.ts';
import {ok,fail,type Result} from '../../contracts/src/result.ts';
export const assetKey=(ref:MediaReference)=>ref.kind==='artifact'?'artifact:'+ref.artifactId:ref.assetId;
export function projectAssetsFor(library:LibraryHandle,assets:ReturnType<typeof assetsFor>,generation:ReturnType<typeof generationFor>){
 const db=library.db,s=subprojectsFor(library),scopes=contentScopesFor(library);
 function sync(projectId:string){const p=s.project(projectId);if(!p.ok)return p;
  if(Number(db.prepare('SELECT count(*) n FROM project').get()?.n)===1)for(const a of assets.search({state:'active',latestOnly:true}).assets)db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,NULL,1)').run(projectId,a.ref.assetId);
  for(const task of generation.list().tasks){if(!task.artifactRef)continue;const owner=scopes.inferred('task',task.taskId);if(owner?.projectId===projectId)db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(projectId,assetKey(task.artifactRef),owner.subprojectId);}
  for(const r of db.prepare('SELECT o.asset_id,p.project_id FROM local_media_output o JOIN local_media_job j USING(job_id) JOIN render_plan p ON p.plan_id=j.plan_id WHERE p.project_id=?').all(projectId))db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,NULL,0)').run(projectId,String(r.asset_id));
  return ok(undefined);
 }
 function catalog(raw:unknown):Result<ProjectAssetCatalog>{const parsed=parseAssetQuery(raw);if(!parsed.ok)return parsed;const i=parsed.value,valid=s.read(i);if(!valid.ok)return valid;const scanned=sync(i.projectId);if(!scanned.ok)return scanned;
  const current=new Map(assets.search({state:'active',latestOnly:true}).assets.map(a=>[a.ref.assetId,a]));
  const items:ProjectAssetItem[]=[];
  for(const row of db.prepare('SELECT * FROM project_asset WHERE project_id=? ORDER BY rowid').all(i.projectId)){if(i.view==='current'&&row.source_subproject_id!==i.subprojectId||i.view==='common'&&row.common!==1)continue;
   const key=String(row.asset_id),ref:MediaReference=key.startsWith('artifact:')?{kind:'artifact',libraryId:library.libraryId,artifactId:key.slice(9)}:current.get(key)?.ref as MediaReference;if(!ref)continue;
   const meta=assets.assertSelectable(ref);if(!meta.ok)continue;
   items.push({...meta.value,ref,name:current.get(key)?.name??'生成结果 '+key.slice(-8),sourceSubprojectId:row.source_subproject_id===null?null:String(row.source_subproject_id),common:row.common===1});
  }return ok({libraryId:library.libraryId,projectId:i.projectId,items});
 }
 function tag(raw:unknown):Result<ProjectAssetCatalog>{const parsed=parseTagAsset(raw);if(!parsed.ok)return parsed;const i=parsed.value,valid=s.read(i);if(!valid.ok)return valid;const synced=sync(i.projectId);if(!synced.ok)return synced;const key=assetKey(i.ref);
  const own=db.prepare('SELECT 1 FROM project_asset WHERE project_id=? AND asset_id=?').get(i.projectId,key);if(!own)return fail('ASSET_NOT_IN_PROJECT','资产不属于当前父项目。');
  db.prepare('UPDATE project_asset SET common=? WHERE project_id=? AND asset_id=?').run(i.common?1:0,i.projectId,key);return catalog({...i,view:'all',ref:undefined,common:undefined} as never);
 }
 function deliver(raw:unknown):Result<Deliverable>{const parsed=parseDeliverable(raw);if(!parsed.ok)return parsed;const i=parsed.value,valid=s.read(i);if(!valid.ok)return valid;const o=scopes.inferred('timeline',i.timelineId);if(o?.projectId!==i.projectId||o.subprojectId!==i.subprojectId)return fail('WRONG_SUBPROJECT','时间线属于其他子项目。');
  const row=db.prepare('SELECT o.*,p.data_json plan_json FROM local_media_output o JOIN local_media_job j USING(job_id) JOIN render_plan p ON p.plan_id=j.plan_id WHERE o.job_id=? AND p.project_id=?').get(i.jobId,i.projectId);if(!row)return fail('OUTPUT_NOT_READY','请选择已完成的正式渲染结果。');
  const plan=JSON.parse(String(row.plan_json));if(plan.purpose!=='mp4'||plan.timelineRef?.id!==i.timelineId||plan.timelineRef?.revision!==i.timelineRevision)return fail('DELIVERABLE_MISMATCH','输出与指定时间线版本不一致。');
  const ref:MediaReference={kind:'assetVersion',libraryId:library.libraryId,assetId:String(row.asset_id),version:Number(row.version)},meta=assets.assertSelectable(ref);if(!meta.ok)return meta;
  const key=createHash('sha256').update(JSON.stringify([i.subprojectId,i.jobId,i.timelineId,i.timelineRevision])).digest('hex');const old=db.prepare('SELECT data_json FROM subproject_deliverable WHERE id=?').get(key);if(old)return ok(JSON.parse(String(old.data_json)) as Deliverable);
  const source=db.prepare('SELECT hash FROM blob_object WHERE object_id=?').get(String(row.object_id));
  const v:Deliverable={...i,libraryId:library.libraryId,id:key,media:ref,sourceHash:String(source?.hash??row.object_id),createdAt:new Date().toISOString()};
  db.prepare('INSERT INTO subproject_deliverable VALUES(?,?,?,?,?,?)').run(key,i.projectId,i.subprojectId,i.timelineId,i.timelineRevision,JSON.stringify(v));return ok(v);
 }
 function list(scope:WorkScope):Result<DeliverableList>{const v=s.read(scope);if(!v.ok)return v;return ok({libraryId:library.libraryId,projectId:scope.projectId,items:db.prepare('SELECT data_json FROM subproject_deliverable WHERE project_id=? AND subproject_id=? ORDER BY rowid').all(scope.projectId,scope.subprojectId).map(r=>JSON.parse(String(r.data_json)) as Deliverable)});}
 return{catalog,tag,deliver,list,sync};
}
