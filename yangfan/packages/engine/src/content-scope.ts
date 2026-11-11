import type {LibraryHandle} from '../../storage/src/database.ts';
import {subprojectsFor} from './subproject-service.ts';
import type {WorkScope} from '../../contracts/src/subprojects.ts';
import {fail,ok,isRecord,type Result} from '../../contracts/src/result.ts';
type Request={kind:string;payload:unknown;scope?:WorkScope};
export function contentScopesFor(library:LibraryHandle){
 const db=library.db,s=subprojectsFor(library);
 const primary:Record<string,[string,string]>={canvasId:['canvas','canvas'],scriptId:['script','creation_current'],shotId:['shot','creation_current'],sessionId:['session','agent_session'],timelineId:['timeline','timeline'],preparedId:['prepared','generation_prepared'],taskId:['task','generation_task'],productionId:['production','shot_production'],workflowId:['workflow','workflow'],runId:['run','agent_run'],planId:['plan','render_plan'],takeId:['take','dialogue_take'],jobId:['job','local_media_job']};
 const tableExists=(t:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
 function inferred(kind:string,id:string):ReturnType<typeof s.owner>{
  const saved=s.owner(kind,id);if(saved)return saved;
  const candidates:Record<string,[string,string,string?][]>={
   script:[['creation_current','id','project_id']],shot:[['creation_current','id','project_id']],entity:[['creation_current','id','project_id']],canvas:[['canvas','id','project_id']],timeline:[['timeline','id','project_id']],session:[['agent_session','session_id','project_id']],prepared:[['generation_prepared','prepared_id','project_id']],task:[['generation_task','task_id','project_id']],production:[['shot_production','production_id','project_id']],render:[['render_plan','plan_id','project_id']],audio:[['audio_batch','plan_id','project_id']],workflow:[['workflow','plan_id','project_id']],voiceLine:[['voice_line_revision','id','project_id']],transcript:[['transcript_revision','id','project_id']]
  };
  if(kind==='plan'){for(const k of ['render','audio','production','assembly','dialogue']){const o=s.owner(k,id);if(o)return o;}for(const [table,kind]of [['render_plan','render'],['audio_batch','audio'],['dialogue_production_plan','dialogue']]as const){const found=db.prepare('SELECT project_id FROM '+table+' WHERE plan_id=?').get(id);if(found){const o=inferred(kind,id);if(o)return o;return fallback(String(found.project_id));}}const a=db.prepare('SELECT project_id FROM timeline_assembly_plan WHERE plan_id=?').get(id);if(a)return fallback(String(a.project_id));return undefined;}
  if(kind==='prepared'){const wf=db.prepare('SELECT workflow_id FROM workflow_step WHERE prepared_id=?').get(id);if(wf)return inferred('workflow',String(wf.workflow_id));for(const table of ['audio_batch_item','dialogue_production_item']as const){const r=db.prepare('SELECT plan_id FROM '+table+' WHERE prepared_id=?').get(id);if(r){const o=inferred('plan',String(r.plan_id));if(o)return o;}}const row=db.prepare('SELECT plan_json FROM generation_prepared WHERE prepared_id=?').get(id);if(row){const plan=JSON.parse(String(row.plan_json));const canvasId=plan.canvasInput?.canvasId;if(canvasId)return inferred('canvas',canvasId);const run=s.owner('run',plan.runId);if(run)return run;}}
  if(kind==='workflow'||kind==='production'){const t=kind==='workflow'?'workflow':'shot_production',key=kind==='workflow'?'plan_id':'production_id';const r=db.prepare('SELECT canvas_id FROM '+t+' WHERE '+key+'=?').get(id);if(r)return inferred('canvas',String(r.canvas_id));}
  if(kind==='run'){const f=db.prepare('SELECT session_id FROM finish_run WHERE run_id=?').get(id);if(f)return inferred('session',String(f.session_id));const r=db.prepare('SELECT session_id FROM agent_run WHERE run_id=?').get(id);if(r)return inferred('session',String(r.session_id));const p=db.prepare('SELECT prepared_id FROM generation_prepared WHERE json_extract(plan_json,\'$.runId\')=?').get(id);if(p)return inferred('prepared',String(p.prepared_id));}
  if(kind==='job'){const r=db.prepare('SELECT plan_id FROM local_media_job WHERE job_id=?').get(id);if(r)return inferred('render',String(r.plan_id));}
  if(kind==='task'){const r=db.prepare('SELECT prepared_id FROM generation_task WHERE task_id=?').get(id);if(r){const o=inferred('prepared',String(r.prepared_id));if(o)return o;}}
  if(kind==='shotDialogue'){const r=db.prepare('SELECT shot_id FROM shot_dialogue_current WHERE id=?').get(id);if(r)return inferred('shot',String(r.shot_id));}
  if(kind==='transcript'){const r=db.prepare('SELECT task_id FROM transcript_revision WHERE id=? AND task_id IS NOT NULL ORDER BY revision DESC LIMIT 1').get(id);if(r)return inferred('task',String(r.task_id));}
  if(kind==='take'){const r=db.prepare('SELECT shot_id FROM dialogue_take WHERE id=?').get(id);if(r)return inferred('shot',String(r.shot_id));const a=db.prepare('SELECT task_id FROM audio_take WHERE task_id=? OR json_extract(data_json,\'$.id\')=?').get(id,id);if(a)return inferred('task',String(a.task_id));}
  for(const[t,key,pkey]of candidates[kind]??[]){if(!tableExists(t))continue;const columns=db.prepare('PRAGMA table_info('+t+')').all().map(c=>c.name);if(!columns.includes(pkey)||!columns.includes(key))continue;
   const row=db.prepare('SELECT '+pkey+' pid FROM '+t+' WHERE '+key+'=?'+(t==='creation_current'?' AND kind=?':'')).get(...(t==='creation_current'?[id,kind]:[id]));if(row)return fallback(String(row.pid),kind==='entity');
  }return undefined;
 }
 function fallback(projectId:string,shared=false){const d=s.ensureDefault(projectId);return d.ok?{projectId,subprojectId:shared?null:d.value}:undefined;}
 function scope(request:Request):Result<WorkScope|null>{if(request.scope){const own=s.read(request.scope);if(!own.ok)return own;return ok(request.scope);}const p=isRecord(request.payload)&&typeof request.payload.projectId==='string'?request.payload.projectId:null;if(p){const input=request.payload as Record<string,unknown>,id=typeof input.subprojectId==='string'?input.subprojectId:request.kind==='subproject.update'&&typeof input.id==='string'?input.id:null;if(id){const chosen={projectId:p,subprojectId:id},valid=s.read(chosen);return valid.ok?ok(chosen):valid;}const def=s.ensureDefault(p);return def.ok?ok({projectId:p,subprojectId:def.value}):def;}return ok(null);}
 function guard(request:Request,writing=true):Result<void>{
  if(!request.scope)return ok(undefined);const sc=request.scope,valid=s.read(sc);if(!valid.ok)return valid;
  const p=isRecord(request.payload)?request.payload:{};
  if(typeof p.subprojectId==='string'&&p.subprojectId!==sc.subprojectId||request.kind==='subproject.update'&&p.id!==sc.subprojectId)return fail('WRONG_SUBPROJECT','目标属于其他子项目。');
  if(typeof p.projectId==='string'&&p.projectId!==sc.projectId)return fail('WRONG_PROJECT','请求不属于当前项目。');
  if(writing&&valid.value.status==='archived'&&!request.kind.startsWith('subproject.')&&!request.kind.includes('.list')&&!request.kind.includes('.read'))return fail('SUBPROJECT_ARCHIVED','请先恢复已归档子项目。');
  function check(kind:string,id:unknown):Result<void>{if(typeof id!=='string')return ok(undefined);const o=inferred(kind,id);return o&&(o.projectId!==sc.projectId||o.subprojectId!==null&&o.subprojectId!==sc.subprojectId)?fail('WRONG_SUBPROJECT','目标属于其他子项目。'):ok(undefined);}
  function walk(x:unknown,key=''):Result<void>{if(Array.isArray(x)){for(const v of x){const kinds:Record<string,string>={shotIds:'shot',shots:'shot',shotRefs:'shot',lines:'voiceLine',voiceLineRefs:'voiceLine',dialogueRefs:'shotDialogue',entityIds:'entity',entityRefs:'entity'};if(kinds[key]){const c=check(kinds[key],isRecord(v)?v.lineId??v.id:v);if(!c.ok)return c;}const c=walk(v,key);if(!c.ok)return c;}return ok(undefined);}
   if(!isRecord(x))return ok(undefined);
   if((x.kind==='assetVersion'||x.kind==='artifact')&&request.kind!=='project.assetAssign'){const key=x.kind==='assetVersion'?x.assetId:'artifact:'+x.artifactId;const allowed=db.prepare('SELECT 1 FROM project_asset WHERE project_id=? AND asset_id=?').get(sc.projectId,String(key));if(!allowed)return fail('ASSET_NOT_IN_PROJECT','资产不属于当前父项目，请先导入登记。');}
   for(const[k,v]of Object.entries(x)){
    let c=primary[k]?check(primary[k][0],v):ok(undefined);if(!c.ok)return c;
    if(['scriptRef','timelineRef','voiceLineRef','shotRef','dialogueRef'].includes(k)&&isRecord(v)){c=check(k==='scriptRef'?'script':k==='timelineRef'?'timeline':k==='shotRef'?'shot':k==='dialogueRef'?'shotDialogue':'voiceLine',v.id);if(!c.ok)return c;}
    if(k==='target'&&isRecord(v)&&request.kind.startsWith('timeline.')){c=check('timeline',v.id);if(!c.ok)return c;}
    c=walk(v,k);if(!c.ok)return c;
   }return ok(undefined);}
  if(request.kind==='creation.saveScript'||request.kind==='creation.saveShot'){const c=check(request.kind.endsWith('Script')?'script':'shot',p.id);if(!c.ok)return c;}
  if(request.kind==='audio.saveVoiceLine'||request.kind==='audio.saveTranscript'){const c=check(request.kind.endsWith('VoiceLine')?'voiceLine':'transcript',p.id);if(!c.ok)return c;}
  if(request.kind.startsWith('asset.')&&typeof p.assetId==='string'&&!db.prepare('SELECT 1 FROM project_asset WHERE project_id=? AND asset_id=?').get(sc.projectId,p.assetId))return fail('ASSET_NOT_IN_PROJECT','资产不属于当前父项目。');
  if(request.kind==='creation.history'){const c=check(String(p.kind),p.id);if(!c.ok)return c;}
  return walk(p);
 }
 function record(request:Request,result:unknown):Result<void>{
  if(request.kind==='project.create'&&isRecord(result)){const d=s.ensureDefault(String(result.id));return d.ok?ok(undefined):d;}
  const sc=scope(request);if(!sc.ok)return sc;if(!sc.value||!isRecord(result))return ok(undefined);const target=sc.value;
  const bind=(kind:string,id:unknown,shared=false):Result<void>=>typeof id==='string'?s.bind(kind,id,target,shared):ok(undefined);
  const pairs:[string,unknown,boolean?][]=[];
  if(request.kind==='asset.importGrantedFiles'&&Array.isArray(result.versions))for(const ref of result.versions)if(isRecord(ref))db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(target.projectId,String(ref.assetId),target.subprojectId);
  if(request.kind==='asset.saveArtifact'&&typeof result.assetId==='string'){const input=request.payload as {artifactRef:{artifactId:string}},origin=db.prepare('SELECT source_subproject_id FROM project_asset WHERE project_id=? AND asset_id=?').get(target.projectId,'artifact:'+input.artifactRef.artifactId);db.prepare('INSERT OR IGNORE INTO project_asset VALUES(?,?,?,0)').run(target.projectId,result.assetId,origin?.source_subproject_id??target.subprojectId);}
  const refsToUse=(x:unknown):void=>{if(Array.isArray(x)){for(const v of x)refsToUse(v);}else if(isRecord(x)){if(x.kind==='assetVersion'||x.kind==='artifact')db.prepare('INSERT OR IGNORE INTO asset_usage VALUES(?,?,?,?,?)').run(target.projectId,target.subprojectId,request.kind,String(result.id??result.planId??result.runId??result.taskId??'input'),JSON.stringify(x));else for(const v of Object.values(x))refsToUse(v);}};refsToUse(request.payload);
  if(request.kind==='creation.saveScript')pairs.push(['script',result.id]);if(request.kind==='creation.saveShot')pairs.push(['shot',result.id]);if(request.kind==='creation.saveEntity')pairs.push(['entity',result.id,true]);
  if(request.kind==='timeline.create'||request.kind==='timeline.applyAssembly'){pairs.push(['timeline',result.id]);db.prepare('UPDATE subproject SET primary_timeline_id=COALESCE(primary_timeline_id,?),revision=revision+1 WHERE id=? AND primary_timeline_id IS NULL').run(String(result.id),target.subprojectId);}
  if(request.kind==='audio.saveVoiceLine')pairs.push(['voiceLine',result.id]);if(request.kind==='audio.saveTranscript')pairs.push(['transcript',result.id]);
  function refs(r:Record<string,unknown>){for(const[k,kind]of [['preparedId','prepared'],['runId','run'],['productionId','production'],['workflowId','workflow'],['taskId','task'],['sessionId','session'],['jobId','job']]as const)if(r[k])pairs.push([kind,r[k]]);
   if(r.planId)pairs.push([request.kind.startsWith('timeline.')?'assembly':request.kind.startsWith('dialogue.')?'dialogue':request.kind.startsWith('audio.')?'audio':request.kind.startsWith('shots.')?'production':'render',r.planId]);
   for(const key of ['generation','plan','prepared'])if(isRecord(r[key]))refs(r[key]);
   for(const key of ['tasks','steps'])if(Array.isArray(r[key]))for(const item of r[key])if(isRecord(item))refs(item);
  }refs(result);
  if(request.kind==='finish.acceptProposal'&&isRecord(result.result)&&Array.isArray(result.result.voiceLines))for(const r of result.result.voiceLines)if(isRecord(r))pairs.push(['voiceLine',r.id]);
  if(request.kind==='agent.acceptProposal'&&isRecord(result.result))for(const key of ['scripts','shots','entities'])if(Array.isArray(result.result[key]))for(const r of result.result[key])if(isRecord(r))pairs.push([key==='scripts'?'script':key==='shots'?'shot':'entity',r.id,key==='entities']);
  for(const[k,id,shared]of pairs){const old=s.owner(k,String(id));if(old){if(old.projectId!==target.projectId||old.subprojectId!==null&&old.subprojectId!==target.subprojectId)return fail('WRONG_SUBPROJECT','返回对象属于其他子项目。');continue;}const b=bind(k,id,shared);if(!b.ok)return b;}
  return ok(undefined);
 }
 function filter(request:Request,result:Result<unknown>):Result<unknown>{if(!request.scope||!result.ok||!isRecord(result.value))return result;const sc=request.scope,v={...result.value};
  const keep=(kind:string,id:unknown)=>{const o=typeof id==='string'?inferred(kind,id):undefined;return !!o&&o.projectId===sc.projectId&&(o.subprojectId===null||o.subprojectId===sc.subprojectId);};
  const byKey:Record<string,[string,string]>={scripts:['script','id'],shots:['shot','id'],selections:['shot','shotId'],timelines:['timeline','id'],sessions:['session','sessionId'],tasks:['task','taskId'],workflows:['workflow','workflowId'],jobs:['job','jobId'],runs:['run','runId'],voiceLines:['voiceLine','id'],transcripts:['transcript','id'],productions:['plan','planId']};
  if(Array.isArray(v.assets))v.assets=v.assets.filter(x=>isRecord(x)&&isRecord(x.ref)&&!!db.prepare('SELECT 1 FROM project_asset WHERE project_id=? AND asset_id=?').get(sc.projectId,String(x.ref.assetId)));
  for(const[key,[kind,id]]of Object.entries(byKey))if(Array.isArray(v[key]))v[key]=v[key].filter(x=>isRecord(x)&&keep(kind,x[id]));
  if(request.kind==='audio.read'&&Array.isArray(v.takes))v.takes=v.takes.filter(x=>isRecord(x)&&keep('task',isRecord(x.task)?x.task.taskId:x.taskId));
  return ok(v);
 }
 return{guard,record,filter,scope,inferred};
}
