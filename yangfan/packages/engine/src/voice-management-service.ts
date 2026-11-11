import {createHash,randomUUID} from 'node:crypto';
import type {LibraryHandle} from '../../storage/src/database.ts';
import type {modelConfigFor} from './model-config-service.ts';
import type {generationFor} from './generation-service.ts';
import type {characterVoiceFor} from './character-voice-service.ts';
import type {audioFor} from './audio-service.ts';
import type {assetsFor} from './asset-service.ts';
import type {mediaInfoFor} from './media-info-service.ts';
import type {ProviderContext} from '../../providers/src/image-provider.ts';
import type {VoiceManagementOperation} from '../../providers/src/voice-management.ts';
import {decodeVoiceCatalog,decodeVoiceUpload,decodeVoiceClone,validateCloneSample} from '../../providers/src/voice-management.ts';
import {parsePrepareVoiceClone,parseApproveVoiceClone,parseRefreshVoiceCatalog,parseReconcileVoiceClone,isVoiceCloneJob,type VoiceCloneJob,type VoiceCatalog,type RefreshVoiceCatalogInput,type PrepareVoiceCloneInput,type ApproveVoiceCloneInput,type ReconcileVoiceCloneInput} from '../../contracts/src/voice-management.ts';
import {fail,ok,type Result} from '../../contracts/src/result.ts';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function voiceManagementFor(library:LibraryHandle,models:ReturnType<typeof modelConfigFor>,generation:ReturnType<typeof generationFor>,voices:ReturnType<typeof characterVoiceFor>,audio:ReturnType<typeof audioFor>,assets:ReturnType<typeof assetsFor>,media:ReturnType<typeof mediaInfoFor>,context:ProviderContext={}){
 const db=library.db,active=new Map<string,{hash:string;promise:Promise<Result<VoiceCloneJob>>}>();
 function atomic<T>(work:()=>Result<T>):Result<T>{if(db.isTransaction)return work();db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec(result.ok?'COMMIT':'ROLLBACK');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function list(input:{projectId:string}):Result<{libraryId:string;projectId:string;jobs:VoiceCloneJob[]}>{const valid=own(input.projectId);if(!valid.ok)return valid;const rows=db.prepare('SELECT job_id FROM voice_clone_job WHERE project_id=? ORDER BY rowid DESC LIMIT 100').all(input.projectId),jobs:VoiceCloneJob[]=[];for(const row of rows){const job=get({projectId:input.projectId,jobId:row.job_id as string});if(!job.ok)return job;jobs.push(job.value);}return ok({libraryId:library.libraryId,projectId:input.projectId,jobs});}
 function own(projectId:string):Result<void>{const checked=library.checkOwnership();if(!checked.ok)return checked;return db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(projectId,library.libraryId)?ok(undefined):fail('PROJECT_NOT_FOUND','项目不存在。');}
 function prepareService(input:RefreshVoiceCatalogInput){
  return generation.prepare({projectId:input.projectId,profileRef:input.profileRef,prompt:'voice service',inputVersion:'voice-service',executionOwner:'desktop-user',runId:randomUUID()},undefined,false);
 }
 function catalog(input:RefreshVoiceCatalogInput):Result<VoiceCatalog>{
  const valid=own(input.projectId);if(!valid.ok)return valid;
  const profile=models.listProfiles().profiles.find(p=>p.id===input.profileRef.id&&p.revision===input.profileRef.revision),model=profile&&models.listModels().models.find(m=>m.id===profile.modelRef.id&&m.revision===profile.modelRef.revision),connection=model&&models.listConnections().connections.find(c=>c.id===model.connectionRef.id&&c.revision===model.connectionRef.revision);
  if(!profile||!model||!connection||model.capabilities.taskTypes[0]!=='text_to_speech')return fail('VOICE_CONFIG_MISMATCH','请选择有效的语音合成预设。');
  const connectionRef={libraryId:library.libraryId,id:connection.id,revision:connection.revision};
  const row=db.prepare('SELECT data_json FROM voice_provider_catalog WHERE connection_id=? AND connection_revision=?').get(connection.id,connection.revision);
  return row?ok(JSON.parse(row.data_json as string) as VoiceCatalog):ok({libraryId:library.libraryId,connectionRef,voices:[],fetchedAt:null,stale:true,diagnostic:connection.adapterType==='minimax-speech-v1'?null:'VOICE_CATALOG_UNSUPPORTED'});
 }
 async function refreshCatalog(raw:RefreshVoiceCatalogInput):Promise<Result<VoiceCatalog>>{
  const parsed=parseRefreshVoiceCatalog(raw);if(!parsed.ok)return parsed;const input=parsed.value,cached=catalog(input);if(!cached.ok)return cached;
  const prepared=prepareService(input);if(!prepared.ok)return ok({...cached.value,stale:true,diagnostic:prepared.error.code});
  if(prepared.value.adapterId!=='minimax-speech-v1'||!context.requestVoiceManagement)return ok({...cached.value,stale:true,diagnostic:'VOICE_CATALOG_UNSUPPORTED'});
  try{
   const id=randomUUID(),response=await context.requestVoiceManagement(prepared.value,{attemptId:id,outputStagingId:id+'-output',clientRequestId:id,requestHash:digest({kind:'catalog',config:prepared.value.config}),retries:0},{kind:'catalog'});
   const decoded=response.status===200?decodeVoiceCatalog(response.bytes):fail('VOICE_CATALOG_UNAVAILABLE','当前服务不支持声音目录或暂不可用。');
   const value:VoiceCatalog=decoded.ok?{...cached.value,voices:decoded.value,fetchedAt:new Date().toISOString(),stale:false,diagnostic:null}:{...cached.value,stale:true,diagnostic:decoded.error.code};
   db.prepare('INSERT OR REPLACE INTO voice_provider_catalog VALUES(?,?,?)').run(value.connectionRef.id,value.connectionRef.revision,JSON.stringify(value));return ok(value);
  }catch{return ok({...cached.value,stale:true,diagnostic:'VOICE_CATALOG_UNAVAILABLE'});}
 }
 function readJob(input:{projectId:string;jobId:string}):Result<VoiceCloneJob>{
  const valid=own(input.projectId);if(!valid.ok)return valid;
  const row=db.prepare('SELECT data_json FROM voice_clone_job WHERE job_id=? AND project_id=?').get(input.jobId,input.projectId),value:unknown=row?JSON.parse(row.data_json as string):null;
  return isVoiceCloneJob(value)&&value.libraryId===library.libraryId?ok(value):fail('VOICE_CLONE_NOT_FOUND','克隆任务不存在。');
 }
 function update(job:VoiceCloneJob,patch:Partial<VoiceCloneJob>):VoiceCloneJob{
  const next={...job,...patch,revision:job.revision+1,updatedAt:new Date().toISOString()};
  const changed=db.prepare('UPDATE voice_clone_job SET revision=?,data_json=? WHERE job_id=? AND project_id=? AND revision=?').run(next.revision,JSON.stringify(next),job.jobId,job.projectId,job.revision);
  if(changed.changes!==1)throw Error('VOICE_CLONE_CONFLICT');return next;
 }
 function get(input:{projectId:string;jobId:string}):Result<VoiceCloneJob>{
  const result=readJob(input);if(!result.ok)return result;const job=result.value;
  if(job.state==='verifying'&&job.verificationTaskId){const task=generation.read(job.verificationTaskId);if(task.ok&&task.value.state==='SUCCEEDED')return ok({...job,state:'ready',diagnostic:null});if(task.ok&&['FAILED','CANCELLED'].includes(task.value.state))return ok({...job,state:'cloned-unverified',diagnostic:'VOICE_VERIFICATION_FAILED'});}
  return result;
 }
 async function prepare(raw:PrepareVoiceCloneInput,jobId:string):Promise<Result<VoiceCloneJob>>{
  const parsed=parsePrepareVoiceClone(raw);if(!parsed.ok)return parsed;const input=parsed.value,valid=own(input.projectId);if(!valid.ok)return valid;
  const existing=readJob({projectId:input.projectId,jobId});if(existing.ok)return existing.value.inputHash===digest(input)?existing:fail('COMMAND_ID_REUSED','克隆请求身份已被另一输入使用。');
  const entity=db.prepare("SELECT data_json FROM creation_revision WHERE kind='entity' AND project_id=? AND id=? AND revision=?").get(input.projectId,input.entityRef.id,input.entityRef.revision);
  if(!entity||JSON.parse(entity.data_json as string).kind!=='character')return fail('CHARACTER_NOT_FOUND','克隆目标角色不存在。');
  const prepared=generation.prepare({projectId:input.projectId,profileRef:input.profileRef,prompt:input.verificationText,inputVersion:'voice-clone',executionOwner:input.executionOwner,runId:input.runId},undefined,false);if(!prepared.ok)return prepared;
  if(prepared.value.adapterId!=='minimax-speech-v1'||!context.requestVoiceManagement)return fail('VOICE_CLONE_UNSUPPORTED','当前连接不支持已适配的声音克隆接口。');
  const metadata=assets.assertSelectable(input.source);if(!metadata.ok)return metadata;const probe=await media.ensure(input.source);if(!probe.ok)return probe;
  const source={ref:input.source,hash:metadata.value.hash,mime:metadata.value.mime,byteLength:metadata.value.byteLength,durationTicks:probe.value.durationTicks,probeId:probe.value.probeId};
  const checked=validateCloneSample(source);if(!checked.ok)return checked;if(!probe.value.hasAudio||probe.value.streams.some(s=>s.kind==='video'))return fail('INVALID_CLONE_SAMPLE','请选择独立声音样本。');
  const now=new Date().toISOString(),base={libraryId:library.libraryId,projectId:input.projectId,jobId,inputHash:digest(input),input,prepared:prepared.value,source,candidateVoiceId:'MovieAgent_'+jobId.replaceAll('-',''),createdAt:now};
  const job:VoiceCloneJob={...base,planHash:digest(base),revision:1,state:'prepared',voiceRef:null,providerFileId:null,lastStep:null,diagnostic:null,verificationPlan:null,verificationTaskId:null,updatedAt:now,approval:null};
  db.prepare('INSERT INTO voice_clone_job VALUES(?,?,?,?)').run(jobId,input.projectId,1,JSON.stringify(job));return ok(job);
 }
 async function sourceBytes(job:VoiceCloneJob):Promise<Uint8Array>{
  const opened=await assets.openMediaRead(job.source.ref,job.source.hash);if(!opened.ok)throw Error(opened.error.code);
  const chunks:Buffer[]=[];try{for(let offset=0;offset<opened.value.byteLength;){const chunk=await assets.readMediaRange({leaseId:opened.value.leaseId,offset,length:Math.min(1024*1024,opened.value.byteLength-offset)});if(!chunk.ok||!chunk.value.bytes.length)throw Error('REFERENCE_CHANGED');chunks.push(Buffer.from(chunk.value.bytes));offset+=chunk.value.bytes.length;}}finally{await assets.closeMediaRead(opened.value.leaseId);}
  const bytes=Buffer.concat(chunks);if(bytes.length!==job.source.byteLength||createHash('sha256').update(bytes).digest('hex')!==job.source.hash)throw Error('REFERENCE_CHANGED');return bytes;
 }
 async function call(job:VoiceCloneJob,operation:VoiceManagementOperation,bytes?:Uint8Array){
  if(!context.requestVoiceManagement)throw Error('VOICE_CLONE_UNSUPPORTED');
  const attemptId=job.jobId+'-'+operation.kind+'-'+job.revision;return context.requestVoiceManagement(job.prepared,{attemptId,outputStagingId:attemptId+'-output',clientRequestId:attemptId,requestHash:digest({operation,source:job.source.hash,config:job.prepared.config}),retries:0},operation,bytes);
 }
 function saveClonedVoice(job:VoiceCloneJob):Result<VoiceCloneJob>{
    const config=job.prepared.config,toRef=(v:{libraryId:string;id:string;revision:number})=>({libraryId:v.libraryId,id:v.id,revision:v.revision});
    return atomic(()=>{const voice=voices.saveVoice({projectId:job.projectId,id:'cloned-'+job.jobId,expectedRevision:0,draft:{entityRef:job.input.entityRef,name:job.input.name,dialect:job.input.dialect,performanceNotes:job.input.performanceNotes,sourceKind:'cloned-voice',reference:null,sourceSample:{ref:job.source.ref,hash:job.source.hash,probeId:job.source.probeId,sourceInTicks:0,durationTicks:job.source.durationTicks},ttsProfileRef:job.input.profileRef,ttsBinding:{profileRef:toRef(config.profile),modelRef:toRef(config.model),connectionRef:toRef(config.connection),providerVoiceId:job.candidateVoiceId,voiceOrigin:'cloned',cloneJobId:job.jobId}}},true);
    if(!voice.ok)return voice;return ok(update(job,{state:'cloned-unverified',voiceRef:{id:voice.value.id,revision:voice.value.revision},diagnostic:null}));});
 }
 async function approve(raw:ApproveVoiceCloneInput):Promise<Result<VoiceCloneJob>>{
  const parsed=parseApproveVoiceClone(raw);if(!parsed.ok)return parsed;const input=parsed.value;
  const pending=active.get(input.jobId);if(pending)return pending.hash===digest(input)?pending.promise:fail('APPROVAL_MISMATCH','另一次克隆批准正在执行，不能改变范围。');
  const run=async():Promise<Result<VoiceCloneJob>>=>{
   const found=get(input);if(!found.ok)return found;let job=found.value;
   if(job.planHash!==input.planHash)return fail('APPROVAL_MISMATCH','克隆计划已变化。');
   if(job.cloneConfirmedAt&&!job.voiceRef)return saveClonedVoice(job);
   if(job.approval&&JSON.stringify(job.approval)!==JSON.stringify(input.approval))return fail('APPROVAL_REUSED','该克隆已使用原批准范围。');
   if(['unknown','uploading','cloning'].includes(job.state))return fail('VOICE_CLONE_UNKNOWN','请先核对原上传/克隆操作，不能重复提交。');
   if(['cloned-unverified','verifying','ready'].includes(job.state))return ok(job);
   if(job.state==='failed')return fail('VOICE_CLONE_FAILED','原步骤已明确失败；请检查后准备新计划。');
   const fresh=generation.checkCurrent(job.prepared);if(!fresh.ok)return fresh;
   if(!input.approval.acknowledgeUnknown||input.approval.allowanceMicros>input.approval.budgetLimitMicros)return fail('BUDGET_APPROVAL_REQUIRED','克隆费用未知，请明确批准有限风险额度。');
   if(!job.approval){const reservation=atomic(()=>{
     const generationReserved=Number(db.prepare('SELECT COALESCE(SUM(reservation_micros),0) AS total FROM generation_task WHERE project_id=? AND currency=?').get(job.projectId,input.approval.currency)!.total);
     const workflowReserved=Number(db.prepare('SELECT COALESCE(SUM(reservation_micros),0) AS total FROM workflow_step JOIN workflow ON workflow.plan_id=workflow_step.workflow_id WHERE project_id=? AND currency=?').get(job.projectId,input.approval.currency)!.total);
     const cloneReserved=Number(db.prepare("SELECT COALESCE(SUM(json_extract(data_json,'$.approval.allowanceMicros')),0) AS total FROM voice_clone_job WHERE project_id=? AND json_extract(data_json,'$.approval.currency')=?").get(job.projectId,input.approval.currency)!.total);
     return generationReserved+workflowReserved+cloneReserved>input.approval.budgetLimitMicros-input.approval.allowanceMicros?fail('BUDGET_EXCEEDED','项目预算已被其他任务或未决克隆占用。'):ok(update(job,{approval:input.approval}));});if(!reservation.ok)return reservation;job=reservation.value;}
   try{
    if(!job.providerFileId){
     const bytes=await sourceBytes(job);job=update(job,{state:'uploading',lastStep:'upload'});
     const response=await call(job,{kind:'upload',mime:job.source.mime,filename:'sample'},bytes);
     if(response.status!==200){job=update(job,{state:[400,401,403,404,413,415,422,429].includes(response.status)?'failed':'unknown',diagnostic:'VOICE_UPLOAD_UNCONFIRMED'});return ok(job);}
     const file=decodeVoiceUpload(response.bytes);if(!file.ok)return ok(update(job,{state:file.error.code==='VOICE_PROVIDER_REJECTED'?'failed':'unknown',diagnostic:file.error.code}));
     job=update(job,{state:'uploaded',providerFileId:file.value,diagnostic:null});
    }
    job=update(job,{state:'cloning',lastStep:'clone'});
    const response=await call(job,{kind:'clone',fileId:job.providerFileId!,voiceId:job.candidateVoiceId,modelId:job.prepared.config.model.modelId});
    const cloned=response.status===200?decodeVoiceClone(response.bytes):fail('VOICE_CLONE_UNCONFIRMED','克隆结果待核对。');
    if(!cloned.ok)return ok(update(job,{state:response.status>=400&&response.status<500||cloned.error.code==='VOICE_PROVIDER_REJECTED'?'failed':'unknown',diagnostic:cloned.error.code}));
    job=update(job,{cloneConfirmedAt:new Date().toISOString(),diagnostic:null});
    const saved=saveClonedVoice(job);return saved.ok?saved:ok(update(job,{state:'unknown',diagnostic:'CLONED_VOICE_SAVE_PENDING: '+saved.error.code}));
   }catch(error){return ok(update(job,{state:'unknown',diagnostic:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'VOICE_CLONE_UNKNOWN'}));}
  };
  const promise=run();active.set(input.jobId,{hash:digest(input),promise});try{return await promise;}finally{active.delete(input.jobId);}
 }
 async function verify(raw:ApproveVoiceCloneInput):Promise<Result<VoiceCloneJob>>{
  const parsed=parseApproveVoiceClone(raw);if(!parsed.ok)return parsed;const input=parsed.value,found=get(input);if(!found.ok)return found;let job=found.value;
  if(job.planHash!==input.planHash)return fail('APPROVAL_MISMATCH','克隆计划不符。');
  if(job.state==='ready'||job.state==='verifying')return ok(job);
  if(job.state!=='cloned-unverified'||!job.voiceRef)return fail('VOICE_VERIFICATION_UNAVAILABLE','需要先完成克隆并保存固定声音。');
  return atomic(()=>{
  const lineId='clone-'+job.jobId+(job.verificationTaskId?'-'+job.revision:'');
  const existing=audio.read({projectId:job.projectId});if(!existing.ok)return existing;
  if(!existing.value.voiceLines.some(line=>line.id===lineId)){const saved=audio.saveVoiceLine({projectId:job.projectId,id:lineId,expectedRevision:0,text:job.input.verificationText,voiceRef:job.voiceRef!});if(!saved.ok)return saved;}
  const plan=(job.verificationTaskId?null:job.verificationPlan)??(()=>{const prepared=audio.prepareSpeech({projectId:job.projectId,lines:[{lineId,revision:1,profileRef:job.input.profileRef}],executionOwner:job.input.executionOwner,runId:job.input.runId});return prepared.ok?prepared.value:prepared;})();
  if('ok' in plan)return plan;
  const approved=audio.approveSpeech({planId:plan.planId,planHash:plan.planHash,executionOwner:plan.executionOwner,runId:plan.runId,approval:input.approval});if(!approved.ok)return approved;
  job=update(job,{state:'verifying',lastStep:'verification',verificationPlan:plan,verificationTaskId:approved.value.tasks[0]!.taskId,diagnostic:null});return ok(job);});
 }
 async function reconcile(raw:ReconcileVoiceCloneInput):Promise<Result<VoiceCloneJob>>{
  const parsed=parseReconcileVoiceClone(raw);if(!parsed.ok)return parsed;const input=parsed.value,found=readJob(input);if(!found.ok)return found;const job=found.value;
  if(job.cloneConfirmedAt&&!job.voiceRef)return saveClonedVoice(job);
  if(!['unknown','uploading','cloning','prepared','uploaded'].includes(job.state))return ok(job);
  if(input.decision==='confirmed-not-submitted'){
    const prepared=generation.prepare({projectId:job.projectId,profileRef:job.input.profileRef,prompt:job.input.verificationText,inputVersion:'voice-clone',executionOwner:job.input.executionOwner,runId:job.input.runId},undefined,false);if(!prepared.ok)return prepared;
    if(digest(prepared.value.config)!==digest(job.prepared.config))return fail('CONFIG_CHANGED','原克隆配置已改变，不能转向其他模型或账号。');
    const fresh=generation.checkCurrent(prepared.value);if(!fresh.ok)return fresh;
    return ok(update(job,{prepared:prepared.value,planHash:digest([job.planHash,prepared.value]),state:job.providerFileId?'uploaded':'prepared',diagnostic:'MANUALLY_CONFIRMED_NOT_SUBMITTED: '+input.reason}));
  }
  const result=await refreshCatalog({projectId:job.projectId,profileRef:job.input.profileRef});
  const exists=result.ok&&result.value.voices.some(v=>v.id===job.candidateVoiceId);
  return ok(update(job,{state:'unknown',diagnostic:exists?'VOICE_ID_EXISTS_REQUIRES_MANUAL_SOURCE_CHECK':'VOICE_OPERATION_STATUS_UNCONFIRMED'}));
 }
 return {list,catalog,refreshCatalog,prepare,approve,verify,reconcile,get};
}
