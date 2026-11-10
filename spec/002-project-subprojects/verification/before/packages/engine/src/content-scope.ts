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
   script:[['creation_current','id','project_id']],shot:[['creation_current','id','project_id']],entity:[['creation_current','id','project_id']],canvas:[['canvas','id','project_id']],timeline:[['timeline','id','project_id']],session:[['agent_session','session_id','project_id']],prepared:[['generation_prepared','prepared_id','project_id']],task:[['generation_task','task_id','project_id']],production:[['shot_production','production_id','project_id']],render:[['render_plan','plan_id','project_id']],audio:[['audio_batch','plan_id','project_id']],workflow:[['workflow','workflow_id','project_id']]
  };
  if(kind==='plan'){for(const k of ['render','audio','production','assembly']){const o=s.owner(k,id);if(o)return o;}const a=db.prepare('SELECT project_id FROM timeline_assembly_plan WHERE plan_id=?').get(id);if(a)return fallback(String(a.project_id));return undefined;}
  if(kind==='run'){const r=db.prepare('SELECT session_id FROM agent_run WHERE run_id=?').get(id);if(r)return inferred('session',String(r.session_id));const p=db.prepare('SELECT prepared_id FROM generation_prepared WHERE json_extract(plan_json,\'$.runId\')=?').get(id);if(p)return inferred('prepared',String(p.prepared_id));}
  if(kind==='job'){const r=db.prepare('SELECT plan_id FROM local_media_job WHERE job_id=?').get(id);if(r)return inferred('render',String(r.plan_id));}
  if(kind==='task'){const r=db.prepare('SELECT prepared_id FROM generation_task WHERE task_id=?').get(id);if(r){const o=inferred('prepared',String(r.prepared_id));if(o)return o;}}
  if(kind==='take'){const r=db.prepare('SELECT shot_id FROM dialogue_take WHERE take_id=?').get(id);if(r)return inferred('shot',String(r.shot_id));}
  for(const[t,key,pkey]of candidates[kind]??[]){if(!tableExists(t))continue;const columns=db.prepare('PRAGMA table_info('+t+')').all().map(c=>c.name);if(!columns.includes(pkey)||!columns.includes(key))continue;
   const row=db.prepare('SELECT '+pkey+' pid FROM '+t+' WHERE '+key+'=?'+(t==='creation_current'?' AND kind=?':'')).get(...(t==='creation_current'?[id,kind]:[id]));if(row)return fallback(String(row.pid),kind==='entity');
  }return undefined;
 }
 function fallback(projectId:string,shared=false){const d=s.ensureDefault(projectId);return d.ok?{projectId,subprojectId:shared?null:d.value}:undefined;}
 function scope(request:Request):Result<WorkScope|null>{if(request.scope){const own=s.read(request.scope);if(!own.ok)return own;return ok(request.scope);}const p=isRecord(request.payload)&&typeof request.payload.projectId==='string'?request.payload.projectId:null;if(p){const def=s.ensureDefault(p);return def.ok?ok({projectId:p,subprojectId:def.value}):def;}return ok(null);}
 function guard(request:Request):Result<void>{
  if(!request.scope)return ok(undefined);const sc=request.scope,valid=s.read(sc);if(!valid.ok)return valid;
  const p=isRecord(request.payload)?request.payload:{};
  if(typeof p.projectId==='string'&&p.projectId!==sc.projectId)return fail('WRONG_PROJECT','请求不属于当前项目。');
  if(valid.value.status==='archived'&&!request.kind.startsWith('subproject.')&&!request.kind.includes('.list')&&!request.kind.includes('.read'))return fail('SUBPROJECT_ARCHIVED','请先恢复已归档子项目。');
  function check(kind:string,id:unknown):Result<void>{if(typeof id!=='string')return ok(undefined);const o=inferred(kind,id);return o&&(o.projectId!==sc.projectId||o.subprojectId!==null&&o.subprojectId!==sc.subprojectId)?fail('WRONG_SUBPROJECT','目标属于其他子项目。'):ok(undefined);}
  function walk(x:unknown,key=''):Result<void>{if(Array.isArray(x)){for(const v of x){if(['shotIds','shots'].includes(key)){const c=check('shot',isRecord(v)?v.id:v);if(!c.ok)return c;}const c=walk(v,key);if(!c.ok)return c;}return ok(undefined);}
   if(!isRecord(x))return ok(undefined);for(const[k,v]of Object.entries(x)){
    let c=primary[k]?check(primary[k][0],v):ok(undefined);if(!c.ok)return c;
    if(['scriptRef','timelineRef','voiceLineRef'].includes(k)&&isRecord(v)){c=check(k==='scriptRef'?'script':k==='timelineRef'?'timeline':'voiceLine',v.id);if(!c.ok)return c;}
    if(k==='target'&&isRecord(v)&&request.kind.startsWith('timeline.')){c=check('timeline',v.id);if(!c.ok)return c;}
    c=walk(v,k);if(!c.ok)return c;
   }return ok(undefined);}
  if(request.kind==='creation.saveScript'||request.kind==='creation.saveShot'){const c=check(request.kind.endsWith('Script')?'script':'shot',p.id);if(!c.ok)return c;}
  if(request.kind==='creation.history'){const c=check(String(p.kind),p.id);if(!c.ok)return c;}
  return walk(p);
 }
 function record(request:Request,result:unknown):Result<void>{
  if(request.kind==='project.create'&&isRecord(result)){const d=s.ensureDefault(String(result.id));return d.ok?ok(undefined):d;}
  const sc=scope(request);if(!sc.ok)return sc;if(!sc.value||!isRecord(result))return ok(undefined);const target=sc.value;
  const bind=(kind:string,id:unknown,shared=false):Result<void>=>typeof id==='string'?s.bind(kind,id,target,shared):ok(undefined);
  const pairs:[string,unknown,boolean?][]=[];
  if(request.kind==='creation.saveScript')pairs.push(['script',result.id]);if(request.kind==='creation.saveShot')pairs.push(['shot',result.id]);if(request.kind==='creation.saveEntity')pairs.push(['entity',result.id,true]);
  if(request.kind==='timeline.create')pairs.push(['timeline',result.id]);
  function refs(r:Record<string,unknown>){for(const[k,kind]of [['preparedId','prepared'],['runId','run'],['productionId','production'],['workflowId','workflow'],['taskId','task'],['sessionId','session'],['jobId','job']]as const)if(r[k])pairs.push([kind,r[k]]);
   if(r.planId)pairs.push([request.kind.startsWith('timeline.')?'assembly':request.kind.startsWith('audio.')?'audio':request.kind.startsWith('shots.')?'production':'render',r.planId]);
   for(const key of ['generation','plan','prepared'])if(isRecord(r[key]))refs(r[key]);
   for(const key of ['tasks','steps'])if(Array.isArray(r[key]))for(const item of r[key])if(isRecord(item))refs(item);
  }refs(result);
  if(request.kind==='agent.acceptProposal'&&isRecord(result.result))for(const key of ['scripts','shots','entities'])if(Array.isArray(result.result[key]))for(const r of result.result[key])if(isRecord(r))pairs.push([key==='scripts'?'script':key==='shots'?'shot':'entity',r.id,key==='entities']);
  for(const[k,id,shared]of pairs){const old=s.owner(k,String(id));if(old){if(old.projectId!==target.projectId||old.subprojectId!==null&&old.subprojectId!==target.subprojectId)return fail('WRONG_SUBPROJECT','返回对象属于其他子项目。');continue;}const b=bind(k,id,shared);if(!b.ok)return b;}
  return ok(undefined);
 }
 function filter(request:Request,result:Result<unknown>):Result<unknown>{if(!request.scope||!result.ok||!isRecord(result.value))return result;const sc=request.scope,v={...result.value};
  const keep=(kind:string,id:unknown)=>{const o=typeof id==='string'?inferred(kind,id):undefined;return !!o&&o.projectId===sc.projectId&&(o.subprojectId===null||o.subprojectId===sc.subprojectId);};
  const byKey:Record<string,[string,string]>={scripts:['script','id'],shots:['shot','id'],selections:['shot','shotId'],timelines:['timeline','id'],sessions:['session','sessionId'],tasks:['task','taskId'],workflows:['workflow','workflowId'],jobs:['job','jobId']};
  for(const[key,[kind,id]]of Object.entries(byKey))if(Array.isArray(v[key]))v[key]=v[key].filter(x=>isRecord(x)&&keep(kind,x[id]));
  return ok(v);
 }
 return{guard,record,filter,scope,inferred};
}
