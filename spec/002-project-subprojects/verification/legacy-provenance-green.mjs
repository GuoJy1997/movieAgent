import {read,write,replace} from './edit.mjs';
const p='packages/engine/src/project-assets-service.ts';
replace(p,"if(owner?.projectId===projectId)db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(projectId,assetKey(task.artifactRef),owner.subprojectId)","if(owner)db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(owner.projectId,assetKey(task.artifactRef),owner.subprojectId)");
replace(p,"WHERE p.project_id=?').all(projectId))db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(projectId,String(r.asset_id)","').all())db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(String(r.project_id),String(r.asset_id)");
replace(p,"if(Number(db.prepare('SELECT count(*) n FROM project')","for(const a of assets.search({state:'active',latestOnly:true}).assets){if(!a.sourceArtifactRef)continue;const source=db.prepare('SELECT * FROM project_asset WHERE asset_id=?').get(assetKey(a.sourceArtifactRef));if(source)db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(String(source.project_id),a.ref.assetId,source.source_subproject_id??null);}\n    if(Number(db.prepare('SELECT count(*) n FROM project')");

