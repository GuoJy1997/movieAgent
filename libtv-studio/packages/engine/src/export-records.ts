import { createHash, randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { exportPolicy, exportRelativePath, isExportTimelineInput, isPreparedExport, isExportOutcome, isCancelTimelineExport, type ExportTimelineInput, type PreparedExport, type ExportSource, type ExportReceipt, type ExportSnapshot, type ExportStoryboardVoice } from '../../contracts/src/timeline-export.ts';
import type { assetsFor } from './asset-service.ts';
import type { timelinesFor } from './timeline-service.ts';
import type { rendersFor } from './render-service.ts';
import { isShotRevision, isShotOutputSelection } from '../../contracts/src/creation.ts';
import {isShotDialogueRevision} from '../../contracts/src/character-voice.ts';
const snapshotHash=(p:Pick<PreparedExport,'timeline'|'sources'|'storyboard'|'output'>)=>createHash('sha256').update(JSON.stringify({timeline:p.timeline,sources:p.sources,storyboard:p.storyboard,output:p.output})).digest('hex');
export function exportRecordsFor(library:LibraryHandle,assets:ReturnType<typeof assetsFor>,timelines:ReturnType<typeof timelinesFor>,renders:ReturnType<typeof rendersFor>) {
 const db=library.db;
 const digest=(i:ExportTimelineInput)=>createHash('sha256').update(JSON.stringify({projectId:i.projectId,timelineId:i.timelineId,revision:i.revision,kind:i.kind,renderJobId:i.renderJobId??null})).digest('hex');
 function stored(id:string):PreparedExport|undefined {const row=db.prepare('SELECT * FROM timeline_export_operation WHERE operation_id=?').get(id);if(!row)return;const value:unknown=JSON.parse(String(row.receipt_json));if(!isPreparedExport(value)||value.receipt.requestId!==id||value.receipt.libraryId!==library.libraryId||value.receipt.projectId!==row.project_id||value.receipt.state!==row.state||value.receipt.renderJobId!==(row.job_id??undefined)||digest(value.receipt)!==row.request_hash||snapshotHash(value)!==value.snapshotHash)throw Error('INVALID_STORED_DATA');return value;}
 function persist(value:PreparedExport):void {db.prepare('UPDATE timeline_export_operation SET receipt_json=?,state=? WHERE operation_id=?').run(JSON.stringify(value),value.receipt.state,value.receipt.requestId);}
 async function prepareExport(input:unknown):Promise<Result<PreparedExport>> {
  if(!isExportTimelineInput(input))return fail('INVALID_INPUT','导出参数无效。');const own=library.checkOwnership();if(!own.ok)return own;
  try {
   const old=stored(input.requestId);if(old)return digest(old.receipt)===digest(input)?ok(old):fail('COMMAND_ID_REUSED','此导出请求身份已用于其他内容。');
   const timeline=timelines.read({projectId:input.projectId,timelineId:input.timelineId,revision:input.revision});if(!timeline.ok)return timeline;
   const sources:ExportSource[]=[],seen=new Set<string>(),names=new Map<string,string>();
   for(const clip of [...timeline.value.videoClips,...timeline.value.audioClips]){const meta=assets.metadata(clip.media);if(!meta.ok)return meta;if(meta.value.hash!==clip.sourceHash)return fail('REFERENCE_CHANGED','固定素材 hash 不符。');const ref=clip.media,key=ref.kind==='artifact'?`artifact/${ref.artifactId}`:`asset/${ref.assetId}/${ref.version}`;if(seen.has(key))continue;seen.add(key);const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','audio/wav':'wav','audio/mpeg':'mp3','audio/mp4':'m4a'} as Record<string,string>)[meta.value.mime];if(!ext)return fail('INVALID_MEDIA_TYPE','原件类型不能导出。');let filename=names.get(meta.value.hash);if(!filename){filename=`original-${String(names.size+1).padStart(4,'0')}.${ext}`;names.set(meta.value.hash,filename);}sources.push({ref:structuredClone(ref),hash:meta.value.hash,byteLength:meta.value.byteLength,mime:meta.value.mime,filename});}
   let output:ExportSource|null=null;
   if(input.renderJobId){const job=renders.read({projectId:input.projectId,jobId:input.renderJobId});if(!job.ok)return job;const plan=renders.plan({projectId:input.projectId,planId:job.value.planId});if(!plan.ok)return plan;if(job.value.state!=='SUCCEEDED'||job.value.kind!=='render'||!job.value.outputRef||!plan.value||plan.value.kind!=='render'||plan.value.purpose!==input.kind||plan.value.timelineRef.id!==input.timelineId||plan.value.timelineRef.revision!==input.revision||plan.value.timelineRef.projectId!==input.projectId||plan.value.timelineRef.libraryId!==library.libraryId)return fail('EXPORT_JOB_MISMATCH','导出需要同一固定时间线修订的成功作业。');const meta=assets.metadata(job.value.outputRef);if(!meta.ok)return meta;if(meta.value.mime!==(input.kind==='mp4'?'video/mp4':'audio/wav')||meta.value.byteLength>exportPolicy[input.kind].cap)return fail('EXPORT_JOB_MISMATCH','本地产物规格不符。');output={ref:job.value.outputRef,...meta.value,filename:`original-0001.${input.kind}`} as ExportSource;delete (output as unknown as Record<string,unknown>).width;delete (output as unknown as Record<string,unknown>).height;}
   if(input.kind==='sources'&&[...new Map(sources.map(s=>[s.hash,s])).values()].reduce((n,s)=>n+s.byteLength,0)>exportPolicy.sources.cap-1024*1024)return fail('EXPORT_TOO_LARGE','原件包超过2 GiB上限。');
   const storyboard=timeline.value.videoClips.map(clip=>{
    const provenance=clip.provenance;let dialogue:string|null=null,voice:ExportStoryboardVoice|null=null;
    if(provenance){
     const row=db.prepare("SELECT data_json FROM creation_revision WHERE kind='shot' AND id=? AND revision=? AND project_id=?").get(provenance.shotId,provenance.shotRevision,input.projectId);
     if(row){const shot:unknown=JSON.parse(String(row.data_json));if(!isShotRevision(shot)||shot.libraryId!==library.libraryId||shot.projectId!==input.projectId||shot.id!==provenance.shotId||shot.revision!==provenance.shotRevision)throw Error('INVALID_STORED_DATA');dialogue=shot.dialogue;}
     const selectedRow=db.prepare('SELECT data_json FROM shot_output_selection_history WHERE shot_id=? AND selection_revision=? AND project_id=?').get(provenance.shotId,provenance.selectionRevision,input.projectId),selected:unknown=selectedRow&&JSON.parse(String(selectedRow.data_json));
     if(selectedRow&&(!isShotOutputSelection(selected)||selected.libraryId!==library.libraryId||selected.projectId!==input.projectId))throw Error('INVALID_STORED_DATA');
     if(isShotOutputSelection(selected)&&selected.dialogue){const adopted=selected.dialogue;const row=db.prepare('SELECT data_json FROM shot_dialogue_revision WHERE id=? AND revision=? AND project_id=?').get(adopted.dialogueRef.id,adopted.dialogueRef.revision,input.projectId),fixed:unknown=row&&JSON.parse(row.data_json as string);if(!isShotDialogueRevision(fixed))throw Error('INVALID_STORED_DATA');voice={takeId:adopted.takeId,voiceRef:adopted.voiceRef,dialogueRef:adopted.dialogueRef,route:adopted.route,sourceVideoHash:adopted.sourceVideoHash,audioHash:adopted.audioHash,reviewRevision:adopted.reviewRevision,turns:fixed.turns};}
    }
    return {clipId:clip.id,shotId:provenance?.shotId??null,shotRevision:provenance?.shotRevision??null,dialogue,...(voice?{voice}:{})};
   });
   const exportId=randomUUID(),receipt:ExportReceipt={...input,libraryId:library.libraryId,exportId,relativePath:exportRelativePath(input,exportId),state:'prepared',byteLength:0,hash:null,errorCode:null};const frozen={timeline:timeline.value,sources,storyboard,output};const prepared:PreparedExport={schemaVersion:1,snapshotHash:snapshotHash(frozen),receipt,...frozen,temporary:null};
   if(!isPreparedExport(prepared))return fail('EXPORT_SNAPSHOT_INVALID','固定导出清单无效。');db.prepare('INSERT INTO timeline_export_operation(operation_id,project_id,job_id,request_hash,receipt_json,state,created_at) VALUES(?,?,?,?,?,?,?)').run(input.requestId,input.projectId,input.renderJobId??null,digest(input),JSON.stringify(prepared),'prepared',Date.now());return ok(prepared);
  }catch{return fail('EXPORT_RECORD_FAILED','无法读取或保存固定导出记录。');}
 }
 async function recordExportOutcome(input:unknown):Promise<Result<ExportReceipt>> {
  if(!isExportOutcome(input))return fail('INVALID_INPUT','导出发布回执无效。');const own=library.checkOwnership();if(!own.ok)return own;
  try {const p=stored(input.requestId);if(!p||p.receipt.exportId!==input.exportId)return fail('EXPORT_NOT_FOUND','导出身份不存在。');const r=p.receipt;if(r.state==='completed')return input.state==='completed'&&r.hash===input.hash&&r.byteLength===input.byteLength?ok(r):fail('EXPORT_STATE_CONFLICT','导出已经完成。');
   if(r.state==='cancelled'&&!(input.state==='completed'&&input.publishedAfterCancellation===true&&r.hash!==null&&r.hash===input.hash&&r.byteLength===input.byteLength))return input.state==='cancelled'?ok(r):fail('EXPORT_STATE_CONFLICT','已取消的导出不能自动恢复，请新建导出。');
   if(input.byteLength>exportPolicy[r.kind].cap)return fail('EXPORT_TOO_LARGE','超过导出上限。');
   if(input.state==='completed'&&(r.state!=='verified'&&!(r.state==='cancelled'&&input.publishedAfterCancellation===true)||r.hash!==input.hash||r.byteLength!==input.byteLength))return fail('EXPORT_STATE_CONFLICT','完成需要同一核验回执。');
   if(r.state==='verified'&&input.state!=='completed'&&input.state!=='failed'&&input.state!=='cancelled')return fail('EXPORT_STATE_CONFLICT','待确认发布应先恢复。');
   if(input.state==='copying'&&(input.hash!==null||input.errorCode!==null)||input.state==='verified'&&input.errorCode!==null)return fail('INVALID_INPUT','发布状态无效。');
   const {temporary,publishedAfterCancellation,...outcome}=input;if(temporary)p.temporary=temporary;p.receipt={...r,...outcome};persist(p);return ok(p.receipt);
  }catch{return fail('EXPORT_RECORD_FAILED','导出回执保存失败。');}
 }
 function list(input:{projectId:string;timelineId:string}):Result<ExportSnapshot> {const read=timelines.read(input);if(!read.ok)return read;try{const values=db.prepare('SELECT operation_id FROM timeline_export_operation WHERE project_id=? ORDER BY created_at,rowid').all(input.projectId).map(r=>stored(String(r.operation_id))!.receipt).filter(r=>r.timelineId===input.timelineId);return ok({libraryId:library.libraryId,...input,exports:values});}catch{return fail('EXPORT_RECORD_FAILED','导出记录读取失败。');}}
 async function cancelExport(input:unknown):Promise<Result<void>>{if(!isCancelTimelineExport(input))return fail('INVALID_INPUT','取消导出身份无效。');const own=library.checkOwnership();if(!own.ok)return own;try{const p=stored(input.requestId);if(p&&p.receipt.state!=='completed'){p.receipt={...p.receipt,state:'cancelled',errorCode:'EXPORT_CANCELLED'};persist(p);}return ok(undefined);}catch{return fail('EXPORT_RECORD_FAILED','取消状态保存失败。');}}
 return {prepareExport,recordExportOutcome,list,cancelExport};
}
