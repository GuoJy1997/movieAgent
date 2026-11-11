import { createHash, randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { assetsFor } from './asset-service.ts';
import type { mediaInfoFor } from './media-info-service.ts';
import { creationFor } from './creation-service.ts';
import { voiceoverAuthority } from './voiceover-authority.ts';
import {hasValidDialogueGroups} from '../../contracts/src/timeline.ts';
import { isShotProductionOutput } from '../../contracts/src/shot-production.ts';
import type { MediaReference } from '../../contracts/src/assets.ts';
import type { TimelineOp } from '../../contracts/src/timeline.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { applyTimelineOps } from '../../domain/src/timeline-edit.ts';
import { assembleDialogueClips } from '../../domain/src/dialogue-assembly.ts';
import { frameTicks, mediaStreamEndTicks } from '../../domain/src/timeline-time.ts';
import { DEFAULT_SUBTITLE_STYLE, isTimelineRevision, isTimelineHistory, isTimelineList, isPreparedAssembly, parseCreateTimeline, parseApplyTimelineOps, parseRestoreTimeline, parsePrepareAssembly, parseApplyAssembly, parseTimelineRead, parseTimelineList, parseTimelineHistory, type TimelineRevision, type TimelineHistory, type TimelineList, type CreateTimelineInput, type ApplyTimelineOpsInput, type RestoreTimelineInput, type TimelineReadInput, type PrepareAssemblyInput, type PreparedAssembly, type ApplyAssemblyInput, type VideoClip, type ShotProvenance } from '../../contracts/src/timeline.ts';

export interface ValidatedTimelineOps { readonly input: ApplyTimelineOpsInput; readonly revision: TimelineRevision }
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sameRef=(a:MediaReference,b:MediaReference)=>a.kind===b.kind&&a.libraryId===b.libraryId&&(a.kind==='artifact'&&b.kind==='artifact'?a.artifactId===b.artifactId:a.kind==='assetVersion'&&b.kind==='assetVersion'&&a.assetId===b.assetId&&a.version===b.version);
/** Synchronous writes join the caller's transaction. Probing is explicit and outside it. */
export function timelinesFor({library,assets,mediaInfo}: {library:LibraryHandle;assets:ReturnType<typeof assetsFor>;mediaInfo:Pick<ReturnType<typeof mediaInfoFor>,'read'|'ensure'>}) {
 const db=library.db,creation=creationFor(library,assets),tokens=new WeakMap<ValidatedTimelineOps,{input:ApplyTimelineOpsInput;hash:string}>();
 function project(projectId:string):Result<void>{const own=library.checkOwnership();if(!own.ok)return own;return db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(projectId,library.libraryId)?ok(undefined):fail('PROJECT_NOT_FOUND','当前资料库中没有此项目。');}
 function decode(row:Record<string,unknown>):TimelineRevision{const v:unknown=JSON.parse(row.data_json as string);if(!isTimelineRevision(v)||v.libraryId!==library.libraryId||v.projectId!==row.project_id||v.id!==row.timeline_id||v.revision!==row.revision)throw Error('INVALID_STORED_DATA');return v;}
 function current(id:string):TimelineRevision|undefined{const row=db.prepare('SELECT r.* FROM timeline t JOIN timeline_revision r ON r.timeline_id=t.id AND r.revision=t.revision WHERE t.id=?').get(id);return row?decode(row):undefined;}
 function target(projectId:string,id:string,expected:number):Result<TimelineRevision|undefined>{const valid=project(projectId);if(!valid.ok)return valid;const old=current(id);if(old&&old.projectId!==projectId)return fail('WRONG_PROJECT','时间线属于其他项目。');return(old?.revision??0)===expected?ok(old):fail('REVISION_CONFLICT','时间线已有新修订，请刷新后重试。');}
 function script(projectId:string,ref:{id:string;revision:number},requireCurrent=false):Result<void>{const read=creation.history({projectId,kind:'script',id:ref.id});if(!read.ok)return read;return read.value.revisions.some(r=>r.revision===ref.revision)&&(!requireCurrent||read.value.revisions.at(-1)?.revision===ref.revision)?ok(undefined):fail('REVISION_CONFLICT','剧本修订已经改变。');}
 function sources(t:TimelineRevision,selectNew=false,old?:TimelineRevision):Result<void>{
  for(const c of [...t.videoClips,...t.audioClips]){
   const previous=[...(old?.videoClips??[]),...(old?.audioClips??[])].find(p=>sameRef(p.media,c.media)&&p.sourceHash===c.sourceHash&&p.sourceProbeId===c.sourceProbeId);
   const m=selectNew&&!previous?assets.assertSelectable(c.media):assets.metadata(c.media);if(!m.ok)return m;
   if(m.value.hash!==c.sourceHash)return fail('REFERENCE_CHANGED','固定原件 hash 与剪辑不符。');
   if(selectNew&&!previous&&c.kind==='audio'){const reviewed=voiceoverAuthority(library,assets).allowHash(t.projectId,c.sourceHash);if(!reviewed.ok)return reviewed;}
   if(c.kind==='image'){if(!m.value.mime.startsWith('image/'))return fail('INVALID_MEDIA_TYPE','图片片段需要图片原件。');continue;}
   if(c.kind==='video'&&m.value.mime!=='video/mp4'||c.kind==='audio'&&!m.value.mime.startsWith('audio/'))return fail('INVALID_MEDIA_TYPE','片段与固定媒体类型不符。');
   // Frozen revisions may outlive the active runtime. Resolve their exact probe ID.
   const row=db.prepare('SELECT probe_json FROM media_probe WHERE probe_id=? AND object_hash=?').get(c.sourceProbeId,c.sourceHash);
   const read=mediaInfo.read(c.media);if(!read.ok)return read;
   const p=row?JSON.parse(row.probe_json as string) as import('../../contracts/src/media-info.ts').MediaProbe:read.value;
   if(!p||p.probeId!==c.sourceProbeId||p.objectHash!==c.sourceHash)return fail('MEDIA_ANALYSIS_REQUIRED','请先分析固定媒体。');
   if(!Number.isSafeInteger(p.durationTicks)||p.durationTicks<=0||c.sourceInTicks+c.durationTicks>mediaStreamEndTicks(p,c.kind==='video'?'video':'audio'))return fail('SOURCE_RANGE','片段超出固定媒体的实际时长。');
   if(c.kind==='video'&&!p.streams.some(s=>s.kind==='video')||c.kind==='audio'&&!p.hasAudio)return fail('INVALID_MEDIA_TYPE','固定媒体缺少所需流。');
   if(p.streams.some(s=>['smpte2084','arib-std-b67'].includes(s.colorTransfer??'')))return fail('UNSUPPORTED_HDR','请先将 HDR 媒体转换为 SDR BT.709。');
  }
  return ok(undefined);
 }
 // Explicit adoption needs current selection/review authority even when another
 // retained clip uses identical bytes. Ordinary edits/splits keep admitted history.
 function newSelections(projectId:string,operations:TimelineOp[]):Result<void>{
  for(const op of operations){
   if(op.kind!=='insert'&&op.kind!=='replaceMedia')continue;
   const media=op.kind==='insert'?op.clip.media:op.media,selected=assets.assertSelectable(media);if(!selected.ok)return selected;
   if(selected.value.mime.startsWith('audio/')){const reviewed=voiceoverAuthority(library,assets).allowHash(projectId,selected.value.hash);if(!reviewed.ok)return reviewed;}
  }
  return ok(undefined);
 }
 function references(ownerKind:'revision'|'assembly',ownerId:string,t:TimelineRevision):void{for(const c of [...t.videoClips,...t.audioClips])db.prepare('INSERT INTO timeline_source_reference(owner_kind,owner_id,revision,clip_id,reference_json,source_hash,source_probe_id) VALUES(?,?,?,?,?,?,?)').run(ownerKind,ownerId,t.revision,c.id,JSON.stringify(c.media),c.sourceHash,c.sourceProbeId);}
 function write(t:TimelineRevision):Result<TimelineRevision>{
  if(!db.isTransaction)return fail('TRANSACTION_REQUIRED','时间线写入必须在调用方事务内进行。');
  if(!isTimelineRevision(t)||!hasValidDialogueGroups(t))return fail('INVALID_TIMELINE','时间线最终状态无效。');
  db.prepare('INSERT INTO timeline(id,project_id,library_id,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision').run(t.id,t.projectId,t.libraryId,t.revision);
  db.prepare('INSERT INTO timeline_revision(timeline_id,revision,project_id,data_json) VALUES(?,?,?,?)').run(t.id,t.revision,t.projectId,JSON.stringify(t));references('revision',t.id,t);return ok(t);
 }
 function create(input:CreateTimelineInput):Result<TimelineRevision>{const p=parseCreateTimeline(input);if(!p.ok)return p;input=p.value;const cas=target(input.projectId,input.id,0);if(!cas.ok)return cas;const s=script(input.projectId,input.scriptRef);if(!s.ok)return s;return write({libraryId:library.libraryId,projectId:input.projectId,id:input.id,revision:1,scriptRef:input.scriptRef,title:input.title,...input.settings,timebase:48000,videoClips:[],audioClips:[],subtitleCues:[],subtitleStyle:structuredClone(DEFAULT_SUBTITLE_STYLE),createdAt:new Date().toISOString()});}
 function validateOps(input:ApplyTimelineOpsInput):Result<ValidatedTimelineOps>{
  const p=parseApplyTimelineOps(input);if(!p.ok)return p;input=p.value;const cas=target(input.projectId,input.timelineId,input.expectedRevision);if(!cas.ok)return cas;if(!cas.value)return fail('TIMELINE_NOT_FOUND','时间线不存在。');
  const selected=newSelections(input.projectId,input.operations);if(!selected.ok)return selected;
  const result=applyTimelineOps(cas.value,input.operations);if(!result.ok)return result;const checked=sources(result.value,true,cas.value);if(!checked.ok)return checked;
  const revision={...result.value,revision:input.expectedRevision+1,createdAt:new Date().toISOString()},token={input,revision};tokens.set(token,{input:structuredClone(input),hash:digest(token)});return ok(token);
 }
 function applyValidatedOps(token:ValidatedTimelineOps):Result<TimelineRevision>{
  if(!db.isTransaction)return fail('TRANSACTION_REQUIRED','时间线写入必须在调用方事务内进行。');const captured=tokens.get(token);if(!captured||captured.hash!==digest(token))return fail('INVALID_VALIDATION','剪辑验证凭据无效。');
  const checked=validateOps(captured.input);if(!checked.ok)return checked;tokens.delete(token);return write({...checked.value.revision,createdAt:token.revision.createdAt});
 }
 function applyOps(input:ApplyTimelineOpsInput):Result<TimelineRevision>{if(!db.isTransaction)return fail('TRANSACTION_REQUIRED','时间线写入必须在调用方事务内进行。');const checked=validateOps(input);return checked.ok?applyValidatedOps(checked.value):checked;}
 function read(input:TimelineReadInput):Result<TimelineRevision>{const p=parseTimelineRead(input);if(!p.ok)return p;const valid=project(input.projectId);if(!valid.ok)return valid;try{const latest=current(input.timelineId);if(!latest)return fail('TIMELINE_NOT_FOUND','时间线不存在。');if(latest.projectId!==input.projectId)return fail('WRONG_PROJECT','时间线属于其他项目。');if(input.revision===undefined)return ok(latest);const row=db.prepare('SELECT * FROM timeline_revision WHERE timeline_id=? AND revision=?').get(input.timelineId,input.revision);return row?ok(decode(row)):fail('REVISION_NOT_FOUND','固定时间线修订不存在。');}catch{return fail('INVALID_STORED_DATA','保存的时间线修订无效。');}}
 function restore(input:RestoreTimelineInput):Result<TimelineRevision>{
  const p=parseRestoreTimeline(input);if(!p.ok)return p;
  input=p.value;
  const cas=target(input.projectId,input.timelineId,input.expectedRevision);if(!cas.ok)return cas;
  const source=read({projectId:input.projectId,timelineId:input.timelineId,revision:input.sourceRevision});if(!source.ok)return source;
  const valid=sources(source.value);if(!valid.ok)return valid;
  const selected=newSelections(input.projectId,input.operations??[]);if(!selected.ok)return selected;
  const candidate=applyTimelineOps(source.value,input.operations??[]);if(!candidate.ok)return candidate;
  const current=cas.value;
  if(current&&(current.videoClips.length||current.audioClips.length||current.subtitleCues.length)&&current.fps.num!==candidate.value.fps.num){
   return fail('FPS_LOCKED','已有内容的时间线不能修改帧率。');
  }
  // The restored revision owns historical media-read permission (including trash).
  // Current clip membership separately controls whether linked narration is adopted anew.
  const checked=sources(candidate.value,true,source.value);if(!checked.ok)return checked;
  for(const clip of candidate.value.audioClips){
   const retained=current?.audioClips.some(previous=>previous.id===clip.id&&sameRef(previous.media,clip.media)&&previous.sourceHash===clip.sourceHash&&previous.sourceProbeId===clip.sourceProbeId);
   if(!retained){const reviewed=voiceoverAuthority(library,assets).allowHash(input.projectId,clip.sourceHash);if(!reviewed.ok)return reviewed;}
  }
  return write({...candidate.value,revision:input.expectedRevision+1,createdAt:new Date().toISOString()});
 }
 function list(input:{projectId:string}):Result<TimelineList>{const p=parseTimelineList(input);if(!p.ok)return p;const valid=project(input.projectId);if(!valid.ok)return valid;try{const timelines=db.prepare('SELECT r.* FROM timeline t JOIN timeline_revision r ON r.timeline_id=t.id AND r.revision=t.revision WHERE t.project_id=? ORDER BY t.rowid').all(input.projectId).map(decode),v={libraryId:library.libraryId,projectId:input.projectId,timelines};return isTimelineList(v)?ok(v):fail('INVALID_STORED_DATA','时间线列表无效。');}catch{return fail('INVALID_STORED_DATA','时间线列表无效。');}}
 function history(input:{projectId:string;timelineId:string}):Result<TimelineHistory>{const p=parseTimelineHistory(input);if(!p.ok)return p;const latest=read(input);if(!latest.ok)return latest;try{const v={libraryId:library.libraryId,...input,revisions:db.prepare('SELECT * FROM timeline_revision WHERE timeline_id=? ORDER BY revision').all(input.timelineId).map(decode)};return isTimelineHistory(v)?ok(v):fail('INVALID_STORED_DATA','时间线历史无效。');}catch{return fail('INVALID_STORED_DATA','时间线历史无效。');}}
 function approvalCAS(input:PrepareAssemblyInput):Result<void>{
  const cas=target(input.projectId,input.target.id,input.target.expectedRevision);if(!cas.ok)return cas;
  if(cas.value&&(cas.value.videoClips.length||cas.value.audioClips.length||cas.value.subtitleCues.length)&&cas.value.fps.num!==input.settings.fps.num)return fail('FPS_LOCKED','已有内容的时间线不能修改帧率。');
  if(cas.value&&cas.value.scriptRef.id!==input.scriptRef.id)return fail('WRONG_SCRIPT','时间线属于其他剧本。');
  const s=script(input.projectId,input.scriptRef,true);if(!s.ok)return s;const snap=creation.read({projectId:input.projectId,scriptId:input.scriptRef.id});if(!snap.ok)return snap;
  for(const selected of input.shots){const shot=snap.value.shots.find(s=>s.id===selected.id);if(!shot)return fail('SHOT_NOT_FOUND','所选镜头不属于此剧本。');if(shot.revision!==selected.revision)return fail('REVISION_CONFLICT','镜头已有新修订。');const selection=snap.value.selections.find(s=>s.shotId===selected.id);if((selection?.selectionRevision??0)!==selected.selectionRevision)return fail('SELECTION_CONFLICT','镜头输出选择已经改变。');}
  return ok(undefined);
 }
 function provenance(projectId:string,shotId:string,shotRevision:number,selectionRevision:number,media:MediaReference):ShotProvenance {
  // A published asset may retain its originating artifact. Match that fixed identity,
  // never the current selection revision, to the immutable production output.
  let origin:MediaReference=media;if(media.kind==='assetVersion'){const h=assets.history({assetId:media.assetId});if(h.ok)origin=h.value.versions.find(v=>v.ref.version===media.version)?.sourceArtifactRef??media;}
  const outputs=db.prepare('SELECT o.data_json FROM shot_production_output o JOIN shot_production p ON p.production_id=o.production_id WHERE p.project_id=? ORDER BY o.rowid').all(projectId).map(r=>JSON.parse(r.data_json as string) as unknown);
  const found=outputs.find(o=>isShotProductionOutput(o)&&o.libraryId===library.libraryId&&o.shotId===shotId&&(sameRef(o.reference,media)||sameRef(o.reference,origin)));
  return {shotId,shotRevision,selectionRevision,productionId:isShotProductionOutput(found)?found.productionId:null,productionShotRevision:isShotProductionOutput(found)?found.shotRevision:null};
 }
 async function prepareAssembly(input:PrepareAssemblyInput):Promise<Result<PreparedAssembly>>{
  const p=parsePrepareAssembly(input);if(!p.ok)return p;input=p.value;if(db.isTransaction)return fail('PREFLIGHT_OUTSIDE_TRANSACTION','媒体分析必须在 SQL 事务外进行。');const cas=approvalCAS(input);if(!cas.ok)return cas;
  const snap=creation.read({projectId:input.projectId,scriptId:input.scriptRef.id});if(!snap.ok)return snap;
  const clips:VideoClip[]=[],audioClips:TimelineRevision['audioClips']=[],differences:PreparedAssembly['differences']=[];let cursor=0;const frame=frameTicks(input.settings.fps);
  for(const capture of input.shots){
   const shot=snap.value.shots.find(s=>s.id===capture.id)!,selection=snap.value.selections.find(s=>s.shotId===capture.id),media=selection?.video??(input.allowImages?selection?.image:null);
   if(!media)return fail('ASSEMBLY_MEDIA_MISSING',`镜头 ${capture.id} 缺少已选视频${input.allowImages?'或图片':''}。`);
   const m=assets.assertSelectable(media);if(!m.ok)return m;const kind=m.value.mime.startsWith('image/')?'image':'video';if(kind==='image'&&!input.allowImages||kind==='video'&&m.value.mime!=='video/mp4')return fail('INVALID_MEDIA_TYPE','粗剪只接受已选视频或明确允许的图片。');
   const intended=shot.durationSeconds*48000;let duration=intended,probeId:string|null=null;
   if(kind==='video'){const probe=await mediaInfo.ensure(media);if(!probe.ok)return probe;duration=Math.floor(mediaStreamEndTicks(probe.value,'video')/frame)*frame;probeId=probe.value.probeId;if(duration<=0)return fail('SOURCE_RANGE','镜头视频不足一个目标帧。');}
   const adopted=selection?.dialogue;
   if(adopted){
    if(kind!=='video'||adopted.shotRevision!==capture.revision||adopted.selectionRevision!==capture.selectionRevision)return fail('REVISION_CONFLICT','对白采用与镜头选择不一致。');
    const audio=adopted.audio?await mediaInfo.ensure(adopted.audio):null;if(audio&&!audio.ok)return audio;
    const audioMetadata=adopted.audio?assets.assertSelectable(adopted.audio):null;if(audioMetadata&&!audioMetadata.ok)return audioMetadata;
    const assembled=assembleDialogueClips({selection:adopted,video:{hash:m.value.hash,probeId:probeId!,durationTicks:duration},...(audio&&audioMetadata?{audio:{hash:audioMetadata.value.hash,probeId:audio.value.probeId}}:{}),startTicks:cursor,durationTicks:duration,dialogueGroupId:`dialogue_${digest([capture.id,adopted.takeId,capture.selectionRevision]).slice(0,24)}`});if(!assembled.ok)return assembled;
    clips.push(assembled.value.videoClip);if(assembled.value.audioClip)audioClips.push(assembled.value.audioClip);
   }else clips.push({id:`assembly_${digest(capture.id).slice(0,32)}`,kind,media:structuredClone(media),sourceHash:m.value.hash,sourceProbeId:probeId,sourceInTicks:0,startTicks:cursor,durationTicks:duration,fit:'contain',gainMilli:1000,mute:true,provenance:provenance(input.projectId,capture.id,capture.revision,capture.selectionRevision,media)});
   differences.push({shotId:capture.id,intendedTicks:intended,actualTicks:duration,deltaTicks:duration-intended});cursor+=duration;
  }
  const after=approvalCAS(input);if(!after.ok)return after;
  const old=current(input.target.id),draft:TimelineRevision={libraryId:library.libraryId,projectId:input.projectId,id:input.target.id,revision:input.target.expectedRevision+1,scriptRef:input.scriptRef,title:old?.title??'镜头粗剪',...input.settings,timebase:48000,videoClips:clips,audioClips,subtitleCues:[],subtitleStyle:old?.subtitleStyle??structuredClone(DEFAULT_SUBTITLE_STYLE),createdAt:new Date().toISOString()};
  if(!isTimelineRevision(draft))return fail('INVALID_TIMELINE','粗剪超过时间线时长或片段上限。');const valid=sources(draft,true);if(!valid.ok)return valid;
  const body={...input,libraryId:library.libraryId,planId:randomUUID(),expiresAt:Date.now()+600000,draft,differences};return ok({...body,planHash:digest(body)});
 }
 function savePrepared(plan:PreparedAssembly):Result<PreparedAssembly>{
  if(!db.isTransaction)return fail('TRANSACTION_REQUIRED','粗剪计划必须在调用方事务内保存。');if(!isPreparedAssembly(plan)||plan.libraryId!==library.libraryId)return fail('INVALID_ASSEMBLY','粗剪计划无效。');const {planHash,...body}=plan;if(digest(body)!==planHash)return fail('APPROVAL_MISMATCH','粗剪计划 hash 不符。');if(plan.expiresAt<=Date.now())return fail('APPROVAL_EXPIRED','粗剪计划已过期。');const cas=approvalCAS(plan);if(!cas.ok)return cas;const valid=sources(plan.draft,true);if(!valid.ok)return valid;
  db.prepare('INSERT INTO timeline_assembly_plan(plan_id,project_id,plan_hash,expires_at,data_json) VALUES(?,?,?,?,?)').run(plan.planId,plan.projectId,plan.planHash,plan.expiresAt,JSON.stringify(plan));references('assembly',plan.planId,plan.draft);return ok(plan);
 }
 function applyAssembly(input:ApplyAssemblyInput):Result<TimelineRevision>{
  const p=parseApplyAssembly(input);if(!p.ok)return p;if(!db.isTransaction)return fail('TRANSACTION_REQUIRED','采用粗剪必须在调用方事务内进行。');const own=library.checkOwnership();if(!own.ok)return own;
  const row=db.prepare('SELECT * FROM timeline_assembly_plan WHERE plan_id=?').get(input.planId);if(!row)return fail('ASSEMBLY_NOT_FOUND','粗剪计划不存在。');const plan:unknown=JSON.parse(row.data_json as string);if(!isPreparedAssembly(plan)||plan.libraryId!==library.libraryId||plan.planId!==row.plan_id||plan.planHash!==row.plan_hash||plan.expiresAt!==row.expires_at||plan.projectId!==row.project_id)return fail('INVALID_STORED_DATA','固定粗剪计划无效。');
  const {planHash,...body}=plan;if(digest(body)!==planHash||planHash!==input.planHash||plan.executionOwner!==input.executionOwner||plan.runId!==input.runId)return fail('APPROVAL_MISMATCH','批准与粗剪内容或执行身份不符。');
  const receipt=db.prepare('SELECT * FROM timeline_assembly_receipt WHERE plan_id=?').get(input.planId);if(receipt){const v:unknown=JSON.parse(receipt.data_json as string);return isTimelineRevision(v)&&v.libraryId===library.libraryId&&v.id===receipt.timeline_id&&v.revision===receipt.revision?ok(v):fail('INVALID_STORED_DATA','粗剪回执无效。');}
  if(plan.expiresAt<=Date.now())return fail('APPROVAL_EXPIRED','粗剪计划已过期。');const cas=approvalCAS(plan);if(!cas.ok)return cas;const valid=sources(plan.draft,true);if(!valid.ok)return valid;
  const written=write(plan.draft);if(!written.ok)return written;db.prepare('INSERT INTO timeline_assembly_receipt(plan_id,timeline_id,revision,data_json) VALUES(?,?,?,?)').run(plan.planId,written.value.id,written.value.revision,JSON.stringify(written.value));return written;
 }
 return {create,applyOps,validateOps,applyValidatedOps,restore,read,list,history,prepareAssembly,savePrepared,applyAssembly};
}
