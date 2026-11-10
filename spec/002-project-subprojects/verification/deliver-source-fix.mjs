import {read,write,replace} from './edit.mjs';
const p='packages/engine/src/project-assets-service.ts';
const line=read(p).split('\n').find(l=>l.includes("if(Number(db.prepare('SELECT count(*) n FROM project')")) ;
if(!line)throw Error('missing source');replace(p,line,'');replace(p,'return ok(undefined);\n }',line+'\n  return ok(undefined);\n }');
replace('packages/engine/src/content-scope.ts',"if(request.kind==='asset.saveArtifact'&&typeof result.assetId==='string')db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(target.projectId,result.assetId,target.subprojectId);",
"if(request.kind==='asset.saveArtifact'&&typeof result.assetId==='string'){const input=request.payload as {artifactRef:{artifactId:string}},origin=db.prepare('SELECT source_subproject_id FROM project_asset WHERE project_id=? AND asset_id=?').get(target.projectId,'artifact:'+input.artifactRef.artifactId);db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(target.projectId,result.assetId,origin?.source_subproject_id??target.subprojectId);}");

