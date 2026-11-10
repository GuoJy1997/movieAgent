import { createHash, randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { generationFor } from './generation-service.ts';
import type { creationFor } from './creation-service.ts';
import type { assetsFor } from './asset-service.ts';
import type { characterVoiceFor } from './character-voice-service.ts';
import type { rendersFor } from './render-service.ts';
import type { mediaInfoFor } from './media-info-service.ts';
import type { audioFor } from './audio-service.ts';
import { parseConfirmDialogueAudio, parsePrepareDialogueAlignment, parseImportDialogueRepair, parsePrepareDialogueRepair, parseReconcileDialogueSubmission } from '../../contracts/src/dialogue-production.ts';
import { isDialogueProductionPlan, isDialogueTaskBatch, isDialogueProductionView, isDialogueTakeSnapshot, isDialogueTake, parsePrepareDialogueProduction, parseApproveDialogueProduction, parseStopDialogueProduction, type DialogueProductionPlan, type PrepareDialogueProductionInput, type ApproveDialogueProductionInput, type StopDialogueProductionInput, type DialogueTake, type DialogueReview, type DialogueTaskBatch, type DialogueProductionView, type DialogueTakeSnapshot, type VoiceAuditionStatus } from '../../contracts/src/dialogue-production.ts';
import { parseSelectDialogueTake, isDialogueSelection, isDialogueReview, type DialogueSelection, type SelectDialogueTakeInput } from '../../contracts/src/dialogue-production.ts';
import { parseDialogueProductionList, isDialogueProductionList, type DialogueProductionListInput, type DialogueProductionList } from '../../contracts/src/dialogue-production.ts';
import { computeAuditionFingerprint, evaluateAuditionGate } from '../../domain/src/voice-audition.ts';
import { isShotDialogueRevision, type ShotDialogueRevision } from '../../contracts/src/character-voice.ts';
import { fail, isRecord, ok, type Result } from '../../contracts/src/result.ts';
import {isConfirmedDialogueAudio,type ConfirmedDialogueAudio,type AlignedDialogueInput,type DialogueReviewContext,type ReviewDialogueTakeInput} from '../../contracts/src/dialogue-production.ts';
import type {MediaReference} from '../../contracts/src/assets.ts';
import {isDerivedMediaPlan,type DerivedMediaPlan} from '../../contracts/src/render.ts';
import type {dialogueMediaVerifier} from './dialogue-media-verifier.ts';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function dialogueProductionFor(library: LibraryHandle, generation: ReturnType<typeof generationFor>, creation: ReturnType<typeof creationFor>, assets: ReturnType<typeof assetsFor>, voices: ReturnType<typeof characterVoiceFor>, renders: Pick<ReturnType<typeof rendersFor>, 'inspectDerived'>, mediaInfo: ReturnType<typeof mediaInfoFor>, audio: ReturnType<typeof audioFor>,verifyMedia?:ReturnType<typeof dialogueMediaVerifier>) {
  const db = library.db;
  function project(projectId: string): Result<void> { const own = library.checkOwnership(); if (!own.ok) return own; return db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(projectId, library.libraryId) ? ok(undefined) : fail('PROJECT_NOT_FOUND', '项目不存在。'); }
  function plan(planId: string): Result<DialogueProductionPlan> {
    const row = db.prepare('SELECT plan_json FROM dialogue_production_plan WHERE plan_id=?').get(planId);
    if (!row) return fail('DIALOGUE_PLAN_NOT_FOUND', '对白制作计划不存在。');
    const value: unknown = JSON.parse(row.plan_json as string);
    return isDialogueProductionPlan(value) ? ok(value) : fail('INVALID_STORED_DATA', '对白计划无效。');
  }
  function state(planId: string) { return db.prepare('SELECT state FROM dialogue_production_plan WHERE plan_id=?').get(planId)?.state as string; }
  function dialogueVersion(projectId: string, ref: { id: string; revision: number }): ShotDialogueRevision | undefined {
    const row = db.prepare('SELECT r.data_json FROM shot_dialogue_current c JOIN shot_dialogue_revision r ON r.id=c.id AND r.revision=c.revision AND r.project_id=c.project_id WHERE c.id=? AND c.revision=? AND c.project_id=?').get(ref.id, ref.revision, projectId);
    if (!row) return undefined;
    const value: unknown = JSON.parse(row.data_json as string);
    return isShotDialogueRevision(value) ? value : undefined;
  }
  function fingerprint(voiceRef: { id: string; revision: number }, profileRef: DialogueProductionPlan['profileRef'], route: DialogueProductionPlan['route'], projectId: string): Result<string> {
    if(db.prepare('SELECT MAX(revision) AS revision FROM profile_revision WHERE id=? AND library_id=?').get(profileRef.id,library.libraryId)?.revision!==profileRef.revision)return fail('CONFIG_CHANGED','试镜预设已有新修订。');
    const voice = voices.read({ projectId, voiceRef }); if (!voice.ok) return voice;
    if(db.prepare('SELECT revision FROM character_voice_current WHERE id=? AND project_id=?').get(voiceRef.id,projectId)?.revision!==voiceRef.revision)return fail('REVISION_CONFLICT','声音已有新修订。');
    const snapshot = creation.read({ projectId }); if (!snapshot.ok) return snapshot;
    const entity = snapshot.value.entities.find(value => value.id === voice.value.entityRef.id && value.revision === voice.value.entityRef.revision);
    if (!entity) return fail('REVISION_CONFLICT', '角色已有新修订。');
    const entityImageHashes = entity.references.flatMap(ref => { const metadata = assets.metadata(ref); return metadata.ok ? [metadata.value.hash] : []; });
    const profile=db.prepare('SELECT data_json FROM profile_revision WHERE id=? AND revision=? AND library_id=?').get(profileRef.id,profileRef.revision,library.libraryId);
    const modelRef=profile?JSON.parse(profile.data_json as string).modelRef:undefined;
    const model=modelRef?db.prepare('SELECT data_json FROM model_revision WHERE id=? AND revision=? AND library_id=?').get(modelRef.id,modelRef.revision,library.libraryId):undefined;
    const connectionRef=model?JSON.parse(model.data_json as string).connectionRef:undefined;
    if(!modelRef||!connectionRef||db.prepare('SELECT MAX(revision) AS revision FROM model_revision WHERE id=? AND library_id=?').get(modelRef.id,library.libraryId)?.revision!==modelRef.revision||db.prepare('SELECT MAX(revision) AS revision FROM connection_revision WHERE id=? AND library_id=?').get(connectionRef.id,library.libraryId)?.revision!==connectionRef.revision)return fail('CONFIG_CHANGED','试镜配置已有新修订。');
    return ok(digest([computeAuditionFingerprint({ voiceRef, profileRef, route, dialect: voice.value.dialect, reference: voice.value.reference, entityImageHashes, templateRevision: 2 }),modelRef,connectionRef]));
  }
  function evidence(fingerprint: string,pairKey:string|null) { return db.prepare('SELECT emotion,data_json FROM voice_audition WHERE fingerprint IN (?,?)').all(fingerprint,digest([fingerprint,pairKey])).map(row => ({ ...JSON.parse(row.data_json as string),emotion: row.emotion, fingerprint })); }
  function gate(fingerprintValue: string, pairKey: string | null, exception?: { reason: string } | null,route:DialogueProductionPlan['route']='native-reference') { return evaluateAuditionGate({ fingerprint: fingerprintValue, pairKey,route, evidence: evidence(fingerprintValue,pairKey) as never, exception: exception?.reason ? { reason: exception.reason, emotions: ['calm', 'excited', 'quiet'] } : undefined }); }
  function itemGate(item:DialogueProductionPlan['items'][number],profileRef:DialogueProductionPlan['profileRef'],projectId:string,exception?:{reason:string}|null):Result<void>{
    for(const voiceRef of new Map(item.dialogue.turns.map(turn=>[turn.voiceRef.id,turn.voiceRef])).values()){
      const print=fingerprint(voiceRef,profileRef,item.dialogue.turns[0]!.mode,projectId);if(!print.ok)return print;
      const allowed=gate(print.value,item.pairKey,exception,item.dialogue.turns[0]!.mode);if(!allowed.allowed)return fail('AUDITION_REQUIRED',`试镜未通过：${allowed.missing.join('、')}。`);
    }return ok(undefined);
  }
  function prepare(raw: PrepareDialogueProductionInput): Result<DialogueProductionPlan> {
    const parsed = parsePrepareDialogueProduction(raw); if (!parsed.ok) return parsed; const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    // Validate the complete selection before preparing any video generation item.
    for (const ref of input.dialogueRefs) {
      const current = dialogueVersion(input.projectId, ref);
      if (!current) return fail('REVISION_CONFLICT', '对白已有新修订。');
      if (current.turns.some(turn => turn.mode === 'voiceover')) return fail('VOICEOVER_AUDIO_ROUTE_REQUIRED', '画外音请使用固定台词、TTS 批次和独立配音轨。');
    }
    if (input.profileRef.libraryId !== library.libraryId || db.prepare('SELECT MAX(revision) AS revision FROM profile_revision WHERE id=? AND library_id=?').get(input.profileRef.id, library.libraryId)?.revision !== input.profileRef.revision) return fail('CONFIG_CHANGED', '制作预设已有新修订。');
    const items: DialogueProductionPlan['items'] = [], expiresAt=Date.now()+600000;
    for (const [index, dialogueRef] of input.dialogueRefs.entries()) {
      const current = dialogueVersion(input.projectId, dialogueRef);
      if (!current) return fail('REVISION_CONFLICT', '对白已有新修订。');
      const route = current.turns[0]!.mode;
      if(items.length&&items[0]!.dialogue.turns[0]!.mode!==route)return fail('INVALID_DIALOGUE','同一批次必须使用同一路线。');
      if (current.turns.some(turn => turn.mode !== route)) return fail('INVALID_DIALOGUE', '一个镜头只能使用一种对白路线。');
      const voiceRefs = [...new Map(current.turns.map(turn => [turn.voiceRef.id, turn.voiceRef])).values()];
      const referenceAudio = voiceRefs.map(voiceRef => { const voice = voices.read({ projectId: input.projectId, voiceRef }); if (!voice.ok) throw Error(voice.error.code); return { characterRef: voice.value.entityRef, voiceRef, ref: voice.value.reference.ref }; });
      const snapshot=creation.read({projectId:input.projectId});if(!snapshot.ok)return snapshot;
      const shot=snapshot.value.shots.find(shot=>shot.id===current.shotRef.id&&shot.revision===current.shotRef.revision);if(!shot)return fail('REVISION_CONFLICT','镜头已有新修订。');
      const referenceImages: {role:'reference';ref:import('../../contracts/src/assets.ts').MediaReference}[]=[];
      const roles=referenceAudio.map((audio,i)=>{const character=snapshot.value.entities.find(entity=>entity.id===audio.characterRef.id&&entity.revision===audio.characterRef.revision);if(!character)return null;const images=character.references.map(ref=>{referenceImages.push({role:'reference',ref});return `image ${referenceImages.length}`;});return `character ${i+1} (${character.id}): voice = audio ${i+1}; appearance = ${images.join(', ')||'shot description'}`;});
      if(roles.some(role=>role===null)||referenceImages.length>4)return fail('INVALID_REFERENCE','角色或参考图片映射无效。');
      if(input.purpose==='audition'&&(!input.auditionCase||input.auditionCase==='exchange'&&new Set(current.turns.map(turn=>turn.characterRef.id)).size<2))return fail('INVALID_AUDITION_CASE','试镜案例与角色组合不符。');
      const prompt=[`Shot: ${shot.title}; ${shot.subject}; ${shot.action}; ${shot.prompt}`, ...roles, 'Turn order (48000 ticks/second):', ...current.turns.map((turn,i)=>`${i+1}. character ${referenceAudio.findIndex(a=>a.voiceRef.id===turn.voiceRef.id)+1}; audio ${referenceAudio.findIndex(a=>a.voiceRef.id===turn.voiceRef.id)+1}; ${turn.startTicks}–${turn.startTicks+turn.durationTicks}; emotion=${input.purpose==='audition'?input.auditionCase:turn.emotion}; ${turn.text}`)].join('\n');
      const prepared = generation.prepare({ projectId: input.projectId, profileRef: input.profileRef, prompt, inputVersion: digest([current, referenceAudio,referenceImages,input.auditionCase]), executionOwner: input.executionOwner, runId: `${input.runId}-${index}`, referenceAudio,referenceImages },expiresAt);
      if (!prepared.ok) return prepared;
      const firstVoice = voiceRefs[0]!;
      const auditionFingerprint = fingerprint(firstVoice, input.profileRef, route, input.projectId); if (!auditionFingerprint.ok) return auditionFingerprint;
      const characters=[...new Set(current.turns.map(turn=>turn.characterRef.id))].sort();
      const pairKey = characters.length>1 ? characters.join('/') : null;
      items.push({ dialogue: current, prepared: prepared.value, auditionFingerprint: auditionFingerprint.value, pairKey });
    }
    const route = items[0]!.dialogue.turns[0]!.mode;
    if (input.purpose === 'production') for (const item of items) { const allowed = itemGate(item,input.profileRef,input.projectId,input.exception); if (!allowed.ok) return allowed;
    }
    const body = { libraryId: library.libraryId, projectId: input.projectId, planId: randomUUID(), expiresAt, route, profileRef: input.profileRef, purpose: input.purpose, auditionCase: input.auditionCase ?? null, exception: input.exception ?? null, executionOwner: input.executionOwner, runId: input.runId, items, estimateMicros: items.some(item=>item.prepared.estimateMicros===null)?null:items.reduce((sum,item)=>sum+item.prepared.estimateMicros!,0), currency: items[0]!.prepared.currency };
    return ok({ ...body, approvedHash: digest(body) });
  }
  function check(plan: DialogueProductionPlan): Result<void> {
    if (db.prepare('SELECT MAX(revision) AS revision FROM profile_revision WHERE id=? AND library_id=?').get(plan.profileRef.id, library.libraryId)?.revision !== plan.profileRef.revision) return fail('CONFIG_CHANGED', '制作预设已有新修订。');
    for (const item of plan.items) {
      if (!dialogueVersion(plan.projectId, { id: item.dialogue.id, revision: item.dialogue.revision })) return fail('REVISION_CONFLICT', '对白已有新修订。');
      const snapshot=creation.read({projectId:plan.projectId});if(!snapshot.ok)return snapshot;
      if(!snapshot.value.shots.some(shot=>shot.id===item.dialogue.shotRef.id&&shot.revision===item.dialogue.shotRef.revision))return fail('REVISION_CONFLICT','镜头已有新修订。');
      for(const turn of item.dialogue.turns)if(db.prepare('SELECT revision FROM character_voice_current WHERE id=? AND project_id=?').get(turn.voiceRef.id,plan.projectId)?.revision!==turn.voiceRef.revision)return fail('REVISION_CONFLICT','声音已有新修订。');
      const fresh=generation.checkCurrent(item.prepared);if(!fresh.ok)return fresh;
      if(item.prepared.lipSyncVideo&&item.prepared.lipSyncAudio){const facts=alignedFacts(plan.projectId,{id:item.dialogue.id,revision:item.dialogue.revision},item.prepared.lipSyncVideo.ref,item.prepared.lipSyncAudio.ref);if(!facts.ok)return facts;if(facts.value.videoHash!==item.prepared.lipSyncVideo.hash||facts.value.audioHash!==item.prepared.lipSyncAudio.hash)return fail('REFERENCE_CHANGED','固定修正来源已改变。');}
      if (plan.purpose === 'production' && !item.prepared.lipSyncVideo) { const allowed = itemGate(item,plan.profileRef,plan.projectId,plan.exception); if (!allowed.ok) return allowed; }
    }
    return ok(undefined);
  }
  function savePrepared(value: DialogueProductionPlan): Result<DialogueProductionPlan> {
    if (!db.isTransaction) return fail('TRANSACTION_REQUIRED', '对白计划必须在事务内保存。');
    if (!isDialogueProductionPlan(value) || value.approvedHash !== digest({ ...value, approvedHash: undefined }) && value.approvedHash !== digest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'approvedHash')))) return fail('APPROVAL_MISMATCH', '计划 hash 不符。');
    if (value.expiresAt <= Date.now()) return fail('APPROVAL_EXPIRED', '计划已过期。');
    const checked = check(value); if (!checked.ok) return checked;
    db.prepare('INSERT INTO dialogue_production_plan VALUES(?,?,?,?,?,?,?,?)').run(value.planId, value.projectId, value.approvedHash, value.executionOwner, value.runId, value.expiresAt, 'prepared', JSON.stringify(value));
    for (const item of value.items) {db.prepare('INSERT OR IGNORE INTO generation_prepared(prepared_id,project_id,plan_json) VALUES(?,?,?)').run(item.prepared.preparedId,value.projectId,JSON.stringify(item.prepared));db.prepare('INSERT INTO dialogue_production_item VALUES(?,?,?,NULL,NULL)').run(value.planId, item.dialogue.id, item.prepared.preparedId);}
    return ok(value);
  }
  function approve(raw: ApproveDialogueProductionInput): Result<DialogueTaskBatch> {
    const parsed = parseApproveDialogueProduction(raw); if (!parsed.ok) return parsed; const input = parsed.value, found = plan(input.planId); if (!found.ok) return found;
    const value = found.value;
    if (value.approvedHash !== input.approvedHash || value.executionOwner !== input.executionOwner || value.runId !== input.runId) return fail('APPROVAL_MISMATCH', '批次批准身份不符。');
    const consumed=db.prepare('SELECT approval_json FROM dialogue_batch_approval WHERE plan_id=?').get(value.planId);
    if(consumed){const saved=JSON.parse(consumed.approval_json as string);return digest(saved.input)===digest(input)?ok(saved.batch):fail('APPROVAL_REUSED','本批批准已消费，不能改变范围。');}
    if (state(value.planId) === 'stopped') return fail('DIALOGUE_PRODUCTION_STOPPED', '批次已停止。');
    if (value.expiresAt <= Date.now()) return fail('APPROVAL_EXPIRED', '批次已过期。');
    const checked = check(value); if (!checked.ok) return checked;
    const existing = db.prepare('SELECT task_id FROM dialogue_production_item WHERE plan_id=?').all(value.planId);
    if (existing.length && existing.every(row => row.task_id)) {
      const tasks = [];
      for (const row of existing) { const view = generation.read(row.task_id as string); if (!view.ok) return view; tasks.push({ libraryId: library.libraryId, taskId: row.task_id as string, attemptId: view.value.attemptId }); }
      return ok({ libraryId: library.libraryId, tasks });
    }
    const tasks = [];
    const known=value.items.reduce((sum,item)=>sum+(item.prepared.estimateMicros??0),0),unknown=value.items.filter(item=>item.prepared.estimateMicros===null).length;
    if(known>input.approval.allowanceMicros||unknown&&!input.approval.acknowledgeUnknown||input.approval.allowanceMicros<value.items.length)return fail('BUDGET_EXCEEDED','批次总额超出批准或未知费用未经确认。');
    const allocations=value.items.map(item=>Math.max(1,item.prepared.estimateMicros??0));
    let remaining=input.approval.allowanceMicros-allocations.reduce((sum,n)=>sum+n,0);
    if(remaining<0)return fail('BUDGET_EXCEEDED','批次额度不足。');
    allocations.forEach((n,i)=>{const extra=Math.floor(remaining/(allocations.length-i));allocations[i]=n+extra;remaining-=extra;});
    for (const [index,item] of value.items.entries()) {
      const task = generation.approve({ preparedId: item.prepared.preparedId, approvedPlanHash: item.prepared.planHash, ...input.approval, allowanceMicros:allocations[index]!, executionOwner: value.executionOwner, runId: item.prepared.runId },undefined,undefined,value.planId);
      if (!task.ok) return task;
      db.prepare('UPDATE dialogue_production_item SET task_id=? WHERE plan_id=? AND dialogue_id=?').run(task.value.taskId, value.planId, item.dialogue.id);
      tasks.push(task.value);
    }
    db.prepare("UPDATE dialogue_production_plan SET state='approved' WHERE plan_id=?").run(value.planId);
    const batch = { libraryId: library.libraryId, tasks };
    db.prepare('INSERT INTO dialogue_batch_approval VALUES(?,?)').run(value.planId,JSON.stringify({input,allocations,batch}));
    return isDialogueTaskBatch(batch) ? ok(batch) : fail('INVALID_STORED_DATA', '批次任务无效。');
  }
  function stop(raw: StopDialogueProductionInput): Result<void> {
    const parsed = parseStopDialogueProduction(raw); if (!parsed.ok) return parsed; const input = parsed.value, found = plan(input.planId); if (!found.ok) return found;
    if (found.value.projectId !== input.projectId || found.value.executionOwner !== input.executionOwner) return fail('APPROVAL_MISMATCH', '停止身份不符。');
    db.prepare("UPDATE dialogue_production_plan SET state='stopped' WHERE plan_id=?").run(input.planId);
    for (const row of db.prepare('SELECT task_id FROM dialogue_production_item WHERE plan_id=?').all(input.planId)) if (row.task_id) { const cancel = generation.cancel(row.task_id as string); if (!cancel.ok) return cancel; }
    return ok(undefined);
  }
  function production(input: { projectId: string; planId: string }): Result<DialogueProductionView> {
    const found = plan(input.planId); if (!found.ok) return found;
    if (found.value.projectId !== input.projectId) return fail('WRONG_PROJECT', '批次属于其他项目。');
    const view = { libraryId: library.libraryId, plan: found.value, state: state(input.planId), tasks: found.value.items.map(item => { const row = db.prepare('SELECT task_id,diagnostic FROM dialogue_production_item WHERE plan_id=? AND dialogue_id=?').get(input.planId, item.dialogue.id); const task = row?.task_id ? generation.read(row.task_id as string) : undefined; return { dialogueId: item.dialogue.id, task: task?.ok ? { libraryId: library.libraryId, taskId: task.value.taskId, attemptId: task.value.attemptId } : null, diagnostic: row?.diagnostic ?? null }; }) };
    return isDialogueProductionView(view) ? ok(view) : fail('INVALID_STORED_DATA', '批次视图无效。');
  }
  function takes(input: { projectId: string; shotId: string }): Result<DialogueTakeSnapshot> {
    const valid = project(input.projectId); if (!valid.ok) return valid;
    const takes = db.prepare('SELECT data_json FROM dialogue_take WHERE project_id=? AND shot_id=? ORDER BY rowid').all(input.projectId, input.shotId).map(row => JSON.parse(row.data_json as string)) as DialogueTake[];
    const reviews = db.prepare('SELECT data_json FROM dialogue_review WHERE take_id IN (SELECT id FROM dialogue_take WHERE project_id=? AND shot_id=?) ORDER BY revision').all(input.projectId, input.shotId).map(row => JSON.parse(row.data_json as string)) as DialogueReview[];
    const snapshot = { libraryId: library.libraryId, projectId: input.projectId, shotId: input.shotId, takes, reviews };
    return isDialogueTakeSnapshot(snapshot) ? ok(snapshot) : fail('INVALID_STORED_DATA', '对白 take 记录无效。');
  }
  function productions(raw: DialogueProductionListInput): Result<DialogueProductionList> {
    const parsed = parseDialogueProductionList(raw); if (!parsed.ok) return parsed;
    const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    const shotMatch = "EXISTS (SELECT 1 FROM json_each(p.plan_json,'$.items') i WHERE json_extract(i.value,'$.dialogue.shotRef.id')=?)";
    let before = Number.MAX_SAFE_INTEGER;
    if (input.beforePlanId) {
      const anchor = db.prepare(`SELECT p.rowid AS sequence FROM dialogue_production_plan p WHERE p.plan_id=? AND p.project_id=? AND ${shotMatch}`).get(input.beforePlanId, input.projectId, input.shotId);
      if (!anchor) return fail('INVALID_CURSOR', '历史分页不属于当前项目与镜头。');
      before = Number(anchor.sequence);
    }
    const limit = input.limit ?? 10;
    const rows = db.prepare(`SELECT p.plan_id FROM dialogue_production_plan p WHERE p.project_id=? AND p.rowid<? AND ${shotMatch} ORDER BY p.rowid DESC LIMIT ?`).all(input.projectId, before, input.shotId, limit + 1);
    const summaries: DialogueProductionList['productions'] = [];
    for (const row of rows.slice(0, limit)) {
      const found = production({ projectId: input.projectId, planId: row.plan_id as string }); if (!found.ok) return found;
      const { plan, state, tasks } = found.value;
      summaries.push({ planId: plan.planId, state, purpose: plan.purpose, profileRef: plan.profileRef, executionOwner: plan.executionOwner, runId: plan.runId, expiresAt: plan.expiresAt, tasks });
    }
    const result = { libraryId: library.libraryId, projectId: input.projectId, shotId: input.shotId, productions: summaries, nextBeforePlanId: rows.length > limit ? summaries.at(-1)!.planId : null };
    return isDialogueProductionList(result) ? ok(result) : fail('INVALID_STORED_DATA', '对白批次历史无效。');
  }
  function reviewContext(input:{projectId:string;takeId:string}):Result<DialogueReviewContext>{
    const valid=project(input.projectId);if(!valid.ok)return valid;
    const row=db.prepare('SELECT data_json FROM dialogue_take WHERE id=? AND project_id=?').get(input.takeId,input.projectId),take:unknown=row&&JSON.parse(row.data_json as string);if(!isDialogueTake(take))return fail('DIALOGUE_TAKE_NOT_FOUND','对白 take 不存在。');
    const dialogue=dialogueVersion(input.projectId,take.dialogueRef);if(!dialogue)return fail('REVISION_CONFLICT','台词已有新修订。');
    const snapshot=creation.read({projectId:input.projectId});if(!snapshot.ok)return snapshot;
    const shot=snapshot.value.shots.find(shot=>shot.id===take.shotId);if(!shot)return fail('REVISION_CONFLICT','镜头不存在。');
    const current=voices.list({projectId:input.projectId});if(!current.ok)return current;
    const fixedVoices=[...new Map(dialogue.turns.map(turn=>[turn.voiceRef.id,turn.voiceRef])).values()];
    const voiceObjects=fixedVoices.map(ref=>current.value.voices.find(voice=>voice.id===ref.id));if(voiceObjects.some(voice=>!voice))return fail('REVISION_CONFLICT','当前声音档案缺失。');
    for(const voice of voiceObjects){if(!snapshot.value.entities.some(entity=>entity.id===voice!.entityRef.id&&entity.revision===voice!.entityRef.revision))return fail('REVISION_CONFLICT','角色已有新修订，请更新当前声音档案后复核。');const selected=assets.assertSelectable(voice!.reference.ref);if(!selected.ok)return selected;if(selected.value.hash!==voice!.reference.hash)return fail('REFERENCE_CHANGED','声音来源 hash 不符。');}
    const video=assets.assertSelectable(take.video);if(!video.ok)return video;if(take.audio){const sound=assets.assertSelectable(take.audio);if(!sound.ok)return sound;if(sound.value.hash!==take.audioHash)return fail('REFERENCE_CHANGED','固定配音已改变。');}
    const planRow=db.prepare('SELECT p.plan_json FROM dialogue_production_item i JOIN dialogue_production_plan p ON p.plan_id=i.plan_id JOIN dialogue_take t ON t.task_id=i.task_id WHERE t.id=?').get(take.id);
    const sourcePlan:DialogueProductionPlan|undefined=planRow?JSON.parse(planRow.plan_json as string):undefined;
    const latest=(table:string,id:string)=>{const row=db.prepare(`SELECT data_json FROM ${table} WHERE id=? AND library_id=? ORDER BY revision DESC LIMIT 1`).get(id,library.libraryId);return row?JSON.parse(row.data_json as string):undefined;};
    const profile=sourcePlan?latest('profile_revision',sourcePlan.profileRef.id):undefined,model=profile?latest('model_revision',profile.modelRef.id):undefined,connection=model?latest('connection_revision',model.connectionRef.id):undefined;
    if(sourcePlan&&(!profile||!model||!connection))return fail('CONFIG_CHANGED','当前配置缺失。');
    const revisionRef=(value:any)=>value?{libraryId:library.libraryId,id:value.id,revision:value.revision}:null;
    const voiceRefs=voiceObjects.map(voice=>({id:voice!.id,revision:voice!.revision}));
    const captured=sourcePlan?.items.find(item=>item.dialogue.id===take.dialogueRef.id)?.prepared.config;
    const stale=shot.revision!==dialogue.shotRef.revision||fixedVoices.some((ref,i)=>ref.revision!==voiceRefs[i]!.revision)||!!captured&&(captured.profile.revision!==profile.revision||captured.model.revision!==model.revision||captured.connection.revision!==connection.revision);
    const body={libraryId:library.libraryId,projectId:input.projectId,takeId:take.id,stale,shotRef:{id:shot.id,revision:shot.revision},voiceRefs,profileRef:revisionRef(profile),modelRef:revisionRef(model),connectionRef:revisionRef(connection)};
    return ok({...body,contextHash:digest([body,dialogue,voiceObjects.map(voice=>({entityRef:voice!.entityRef,reference:voice!.reference,dialect:voice!.dialect})),video.value.hash,take.audioHash])});
  }
  function reviewTake(input: ReviewDialogueTakeInput): Result<DialogueReview> {
    const valid = project(input.projectId); if (!valid.ok) return valid;
    const row = db.prepare('SELECT review_revision FROM dialogue_take WHERE id=? AND project_id=?').get(input.takeId, input.projectId);
    if (!row || row.review_revision !== input.expectedReviewRevision) return fail('REVISION_CONFLICT', '审核基准已改变。');
    const context=reviewContext(input);if(!context.ok)return context;
    if(context.value.stale&&input.reviewContextHash===undefined||input.reviewContextHash!==undefined&&input.reviewContextHash!==context.value.contextHash)return fail('DIALOGUE_REVIEW_CONTEXT_CHANGED','请明确复核当前声音、镜头和配置上下文。');
    if (!isRecord(input.checks) || Object.values(input.checks).some(check => !['pass', 'needs-fix', 'not-applicable'].includes(check as string)) || typeof input.notes !== 'string' || input.notes.length > 8000) return fail('INVALID_INPUT', '审核字段无效。');
    const review: DialogueReview = { libraryId: library.libraryId, projectId: input.projectId, takeId: input.takeId, revision: input.expectedReviewRevision + 1, checks: input.checks, notes: input.notes, checkedAt: new Date().toISOString() };
    db.prepare('INSERT INTO dialogue_review VALUES(?,?,?)').run(input.takeId, review.revision, JSON.stringify(review));
    db.prepare('INSERT INTO dialogue_review_context VALUES(?,?,?)').run(input.takeId,review.revision,JSON.stringify(context.value));
    db.prepare('UPDATE dialogue_take SET review_revision=? WHERE id=?').run(review.revision, input.takeId);
    const planRow = db.prepare('SELECT p.plan_json,i.dialogue_id FROM dialogue_production_item i JOIN dialogue_production_plan p ON p.plan_id=i.plan_id JOIN dialogue_take t ON t.task_id=i.task_id WHERE t.id=?').get(input.takeId);
    if (planRow) {
      const plan = JSON.parse(planRow.plan_json as string) as DialogueProductionPlan, item = plan.items.find(value => value.dialogue.id === planRow.dialogue_id);
      if (plan.auditionCase && item && check(plan).ok) for(const voiceRef of new Map(item.dialogue.turns.map(turn=>[turn.voiceRef.id,turn.voiceRef])).values()){
        const print=fingerprint(voiceRef,plan.profileRef,plan.route,plan.projectId);if(!print.ok)return print;
        db.prepare('INSERT OR REPLACE INTO voice_audition VALUES(?,?,?,?)').run(plan.auditionCase==='exchange'?digest([print.value,item.pairKey]):print.value,plan.auditionCase,input.takeId,JSON.stringify({...review,pairKey:item.pairKey}));
      }
    }
    return ok(review);
  }
  function auditionStatus(input: { projectId: string; voiceRef: { id: string; revision: number }; profileRef: DialogueProductionPlan['profileRef']; route: DialogueProductionPlan['route'] }): Result<VoiceAuditionStatus> {
    const print = fingerprint(input.voiceRef, input.profileRef, input.route, input.projectId); if (!print.ok) return print;
    const result = gate(print.value, null,undefined,input.route);
    return ok({ allowed: result.allowed, missing: result.missing, fingerprint: print.value });
  }
  async function confirmAudio(raw: unknown) {
    const parsed = parseConfirmDialogueAudio(raw); if (!parsed.ok) return parsed;
    const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    const dialogue = dialogueVersion(input.projectId, input.dialogueRef);
    if (!dialogue || dialogue.revision !== input.expectedRevision) return fail('REVISION_CONFLICT', '台词修订已改变，请重新确认配音。');
    let ref, hash;
    const source = input.source;
    if (source.kind === 'audio-take') {
      const snapshot = audio.read({ projectId: input.projectId }); if (!snapshot.ok) return snapshot;
      const take = snapshot.value.takes.find(value => value.id === source.takeId);
      if (!take) return fail('AUDIO_TAKE_NOT_FOUND', '配音 take 不存在。');
      ref = take.output;
    } else ref = source.media;
    const metadata = assets.assertSelectable(ref); if (!metadata.ok) return metadata;
    hash = metadata.value.hash;
    const probe = await mediaInfo.ensure(ref); if (!probe.ok) return probe;
    if(!probe.value.hasAudio||probe.value.streams.some(stream=>stream.kind==='video'))return fail('INVALID_MEDIA_TYPE','确认来源必须是独立音频。');
    return ok({ libraryId: library.libraryId, projectId: input.projectId, dialogueRef: input.dialogueRef, source: { kind: input.source.kind, ref, hash, probeId: probe.value.probeId }, confirmedAt: new Date().toISOString() });
  }
  function saveConfirmedAudio(value:ConfirmedDialogueAudio):Result<ConfirmedDialogueAudio>{
    if(!db.isTransaction||!isConfirmedDialogueAudio(value)||value.libraryId!==library.libraryId)return fail('INVALID_INPUT','确认回执无效。');
    if(!dialogueVersion(value.projectId,value.dialogueRef))return fail('REVISION_CONFLICT','确认期间台词已有新修订。');
    const metadata=assets.assertSelectable(value.source.ref);if(!metadata.ok)return metadata;
    const probe=mediaInfo.read(value.source.ref);if(!probe.ok)return probe;
    return metadata.value.hash===value.source.hash&&probe.value?.probeId===value.source.probeId&&probe.value.hasAudio?ok(value):fail('REFERENCE_CHANGED','确认期间音频已改变。');
  }
  function confirmation(projectId:string,dialogueRef:{id:string;revision:number},ref:MediaReference):Result<ConfirmedDialogueAudio>{
    const rows=db.prepare("SELECT c.receipt_json,e.payload_json FROM command_receipt c JOIN domain_event e ON e.seq=c.committed_seq AND e.library_id=c.library_id WHERE c.library_id=? AND e.kind='dialogue.audioConfirmed'").all(library.libraryId);
    for(const row of rows){const receipt=JSON.parse(row.receipt_json as string),value:unknown=JSON.parse(row.payload_json as string);if(isConfirmedDialogueAudio(value)&&value.libraryId===library.libraryId&&value.projectId===projectId&&digest(value.dialogueRef)===digest(dialogueRef)&&digest(value.source.ref)===digest(ref)&&digest(receipt.result)===digest(value)){
      const metadata=assets.assertSelectable(ref);if(!metadata.ok)return metadata;const probe=mediaInfo.read(ref);if(!probe.ok)return probe;
      if(metadata.value.hash===value.source.hash&&probe.value?.probeId===value.source.probeId)return ok(value);
    }}return fail('DIALOGUE_CONFIRMATION_REQUIRED','需要当前台词与固定音频的已提交人工确认。');
  }
  function checkAlignmentPlan(value:DerivedMediaPlan):Result<void>{
    const alignment=value.dialogueAlignment;if(!alignment)return fail('INVALID_INPUT','缺少对齐参数。');
    if(!dialogueVersion(value.projectId,alignment.dialogueRef))return fail('REVISION_CONFLICT','台词已有新修订。');
    const confirmed=confirmation(value.projectId,alignment.dialogueRef,alignment.audioRef);if(!confirmed.ok)return confirmed;
    for(const entry of value.manifest.entries){const metadata=assets.assertSelectable(entry.ref);if(!metadata.ok)return metadata;if(metadata.value.hash!==entry.hash)return fail('REFERENCE_CHANGED','对齐来源已改变。');}
    return ok(undefined);
  }
  function alignedFacts(projectId:string,dialogueRef:{id:string;revision:number},videoRef:MediaReference,audioRef:MediaReference):Result<AlignedDialogueInput&{targetProbe:{probeId:string;hash:string}}>{
    if(audioRef.kind!=='assetVersion')return fail('DIALOGUE_ALIGNMENT_REQUIRED','需要成功对齐的固定音频。');
    const row=db.prepare("SELECT p.data_json FROM local_media_output o JOIN local_media_job j ON j.job_id=o.job_id JOIN render_plan p ON p.plan_id=j.plan_id WHERE o.asset_id=? AND o.version=? AND j.state='SUCCEEDED' AND p.project_id=?").get(audioRef.assetId,audioRef.version,projectId);
    const value:unknown=row&&JSON.parse(row.data_json as string);
    if(!isDerivedMediaPlan(value)||!value.dialogueAlignment||digest(value.dialogueAlignment.dialogueRef)!==digest(dialogueRef)||digest(value.dialogueAlignment.videoRef)!==digest(videoRef))return fail('DIALOGUE_ALIGNMENT_REQUIRED','对齐来源、台词或成功记录不符。');
    const checked=checkAlignmentPlan(value);if(!checked.ok)return checked;
    const video=assets.assertSelectable(videoRef),audio=assets.assertSelectable(audioRef);if(!video.ok)return video;if(!audio.ok)return audio;
    const vp=mediaInfo.read(videoRef),ap=mediaInfo.read(audioRef);if(!vp.ok)return vp;if(!ap.ok)return ap;
    const duration=value.dialogueAlignment.startTicks+value.dialogueAlignment.durationTicks;
    if(vp.value?.durationTicks!==duration||ap.value?.durationTicks!==duration)return fail('DIALOGUE_ALIGNMENT_FAILED','固定音视频必须等长。');
    const captured=value.manifest.entries.find(entry=>entry.hash===video.value.hash&&digest(entry.ref)===digest(videoRef))?.probe;
    if(!captured||captured.objectHash!==video.value.hash)return fail('DIALOGUE_FRAME_RATE_REQUIRED','缺少固定来源视频的探测记录。');
    return ok({videoRef,audioRef,videoHash:video.value.hash,audioHash:audio.value.hash,durationTicks:duration,targetProbe:{probeId:captured.probeId,hash:captured.objectHash}});
  }
  async function prepareAlignment(raw: unknown) {
    const parsed = parsePrepareDialogueAlignment(raw); if (!parsed.ok) return parsed;
    const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    if (!dialogueVersion(input.projectId, input.dialogueRef)) return fail('REVISION_CONFLICT', '台词修订已改变。');
    const confirmed=confirmation(input.projectId,input.dialogueRef,input.confirmedAudioRef);if(!confirmed.ok)return confirmed;
    const video = await mediaInfo.ensure(input.sourceVideo); if (!video.ok) return video;
    const audioProbe = await mediaInfo.ensure(input.confirmedAudioRef); if (!audioProbe.ok) return audioProbe;
    const durationTicks = video.value.durationTicks - input.startTicks;
    if (input.startTicks >= video.value.durationTicks || audioProbe.value.durationTicks > durationTicks) return fail('AUDIO_TOO_LONG', '配音或入点超出视频范围。');
    return renders.inspectDerived({ projectId: input.projectId, references: [input.sourceVideo, input.confirmedAudioRef], fps: { num: 30, den: 1 }, canvas: { width: 1080, height: 1080 }, executionOwner: input.executionOwner, runId: input.runId, dialogueAlignment: { dialogueRef: input.dialogueRef, startTicks: input.startTicks, durationTicks, videoRef: input.sourceVideo, audioRef: input.confirmedAudioRef } });
  }
  async function importRepair(raw: unknown): Promise<Result<DialogueTake>> {
    const parsed = parseImportDialogueRepair(raw); if (!parsed.ok) return parsed;
    const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    const dialogue = dialogueVersion(input.projectId, input.dialogueRef); if (!dialogue) return fail('REVISION_CONFLICT', '台词修订已改变。');
    if(new Set(dialogue.turns.map(turn=>turn.characterRef.id)).size!==1)return fail('MULTI_SPEAKER_LIPSYNC','口型修正只支持一个可见讲话角色。');
    const source = await mediaInfo.ensure(input.sourceVideo); if (!source.ok) return source;
    const audioProbe = await mediaInfo.ensure(input.confirmedAudioRef); if (!audioProbe.ok) return audioProbe;
    const repaired = await mediaInfo.ensure(input.repairedVideo); if (!repaired.ok) return repaired;
    const facts=alignedFacts(input.projectId,input.dialogueRef,input.sourceVideo,input.confirmedAudioRef);if(!facts.ok)return facts;
    if(!verifyMedia)return fail('MEDIA_RUNTIME_UNAVAILABLE','修正版需要完整技术验收。');
    const repairedMetadata=assets.assertSelectable(input.repairedVideo);if(!repairedMetadata.ok)return repairedMetadata;
    const verified=await verifyMedia(input.repairedVideo,repairedMetadata.value.hash,facts.value.durationTicks,false,facts.value.targetProbe);if(!verified.ok)return verified;
    const sourceMetadata = assets.assertSelectable(input.sourceVideo); if (!sourceMetadata.ok) return sourceMetadata;
    const audioMetadata = assets.assertSelectable(input.confirmedAudioRef); if (!audioMetadata.ok) return audioMetadata;
    const take: DialogueTake = { libraryId: library.libraryId, projectId: input.projectId, id: randomUUID(), shotId: dialogue.shotRef.id, dialogueRef: input.dialogueRef, voiceRef: dialogue.turns[0]!.voiceRef, route: 'dubbed-lipsync', origin: { kind: 'manual', receiptId: randomUUID(), repairedVideo: input.repairedVideo, confirmedAudioRef: input.confirmedAudioRef }, video: input.repairedVideo, audio: input.confirmedAudioRef, sourceVideoHash: sourceMetadata.value.hash, audioHash: audioMetadata.value.hash, reviewRevision: 0, createdAt: new Date().toISOString() };
    return ok(take);
  }
  function saveImportedRepair(take: DialogueTake): Result<DialogueTake> {
    if (!db.isTransaction) return fail('TRANSACTION_REQUIRED', '手工修正版必须在事务内保存。');
    if (!isDialogueTake(take) || take.origin.kind !== 'manual') return fail('INVALID_INPUT', '手工修正版来源无效。');
    const dialogue = dialogueVersion(take.projectId, take.dialogueRef); if (!dialogue) return fail('REVISION_CONFLICT', '台词修订已改变。');
    const alignment=db.prepare("SELECT p.data_json FROM local_media_output o JOIN local_media_job j ON j.job_id=o.job_id JOIN render_plan p ON p.plan_id=j.plan_id WHERE o.asset_id=? AND o.version=?").get(take.audio?.kind==='assetVersion'?take.audio.assetId:'',take.audio?.kind==='assetVersion'?take.audio.version:0);
    const source=alignment&&JSON.parse(alignment.data_json as string).dialogueAlignment?.videoRef;
    if(!source)return fail('DIALOGUE_ALIGNMENT_REQUIRED','缺少固定对齐来源。');
    const facts=alignedFacts(take.projectId,take.dialogueRef,source,take.audio!);if(!facts.ok)return facts;
    if(facts.value.videoHash!==take.sourceVideoHash||facts.value.audioHash!==take.audioHash)return fail('REFERENCE_CHANGED','保存期间来源已改变。');
    for (const ref of [take.origin.repairedVideo, take.origin.confirmedAudioRef]) { const selected = assets.assertSelectable(ref); if (!selected.ok) return selected; }
    db.prepare('INSERT INTO dialogue_take(id,project_id,shot_id,dialogue_id,dialogue_revision,origin_kind,task_id,data_json,review_revision) VALUES(?,?,?,?,?,?,?,?,0)').run(take.id, take.projectId, take.shotId, take.dialogueRef.id, take.dialogueRef.revision, 'manual', null, JSON.stringify(take));
    return ok(take);
  }
  async function prepareRepair(raw: unknown): Promise<Result<DialogueProductionPlan>> {
    const parsed = parsePrepareDialogueRepair(raw); if (!parsed.ok) return parsed;
    const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    const dialogue = dialogueVersion(input.projectId, input.dialogueRef); if (!dialogue) return fail('REVISION_CONFLICT', '台词修订已改变。');
    if (new Set(dialogue.turns.map(turn => turn.characterRef.id)).size > 1) return fail('MULTI_SPEAKER_LIPSYNC', '首版口型修正只支持单个可见讲话人物，请拆成单独镜头。');
    if (input.profileRef.libraryId !== library.libraryId || db.prepare('SELECT MAX(revision) AS revision FROM profile_revision WHERE id=? AND library_id=?').get(input.profileRef.id, library.libraryId)?.revision !== input.profileRef.revision) return fail('CONFIG_CHANGED', '口型预设已有新修订。');
    const video = await mediaInfo.ensure(input.alignedInput.videoRef); if (!video.ok) return video;
    const audioProbe = await mediaInfo.ensure(input.alignedInput.audioRef); if (!audioProbe.ok) return audioProbe;
    const videoMetadata = assets.assertSelectable(input.alignedInput.videoRef); if (!videoMetadata.ok) return videoMetadata;
    const audioMetadata = assets.assertSelectable(input.alignedInput.audioRef); if (!audioMetadata.ok) return audioMetadata;
    const facts=alignedFacts(input.projectId,input.dialogueRef,input.alignedInput.videoRef,input.alignedInput.audioRef);if(!facts.ok)return facts;
    if(facts.value.audioHash!==input.alignedInput.audioHash||facts.value.videoHash!==input.alignedInput.videoHash||facts.value.durationTicks!==input.alignedInput.durationTicks)return fail('DIALOGUE_ALIGNMENT_FAILED','调用方对齐事实不匹配固定记录。');
    const prepared = generation.prepare({ projectId: input.projectId, profileRef: input.profileRef, prompt: '单人口型修正', inputVersion: digest(input.alignedInput), executionOwner: input.executionOwner, runId: input.runId, lipSyncVideo: { ref: input.alignedInput.videoRef, hash: videoMetadata.value.hash, mime: 'video/mp4', byteLength: videoMetadata.value.byteLength, durationTicks: video.value.durationTicks, probeId: facts.value.targetProbe.probeId }, lipSyncAudio: { ref: input.alignedInput.audioRef, hash: audioMetadata.value.hash, mime: 'audio/wav', byteLength: audioMetadata.value.byteLength, durationTicks: audioProbe.value.durationTicks, probeId: audioProbe.value.probeId } },Date.now()+600000,false);
    if (!prepared.ok) return prepared;
    const firstVoice = dialogue.turns[0]!.voiceRef, auditionFingerprint = fingerprint(firstVoice, input.profileRef, 'dubbed-lipsync', input.projectId); if (!auditionFingerprint.ok) return auditionFingerprint;
    const body = { libraryId: library.libraryId, projectId: input.projectId, planId: randomUUID(), expiresAt: Date.now() + 600000, route: 'dubbed-lipsync' as const, profileRef: input.profileRef, purpose: 'production' as const, auditionCase: null, exception: null, executionOwner: input.executionOwner, runId: input.runId, items: [{ dialogue, prepared: prepared.value, auditionFingerprint: auditionFingerprint.value, pairKey: null }], estimateMicros: prepared.value.estimateMicros, currency: prepared.value.currency };
    return ok({ ...body, approvedHash: digest(body) });
  }
  function selectTake(raw: SelectDialogueTakeInput): Result<DialogueSelection> {
    const parsed = parseSelectDialogueTake(raw); if (!parsed.ok) return parsed;
    const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    if (!db.isTransaction) return fail('TRANSACTION_REQUIRED', '对白采用必须在事务内保存。');
    const dialogue = dialogueVersion(input.projectId, input.dialogueRef); if (!dialogue || dialogue.shotRef.id !== input.shotId || dialogue.shotRef.revision !== input.expectedShotRevision) return fail('REVISION_CONFLICT', '镜头或对白已有新修订。');
    const row = db.prepare('SELECT data_json,review_revision FROM dialogue_take WHERE id=? AND project_id=? AND shot_id=?').get(input.takeId, input.projectId, input.shotId);
    const take: unknown = row && JSON.parse(row.data_json as string); if (!row || !isDialogueTake(take) || JSON.stringify(take.dialogueRef) !== JSON.stringify(input.dialogueRef)) return fail('DIALOGUE_TAKE_NOT_FOUND', '对白 take 不存在或修订不符。');
    const reviewRow = db.prepare('SELECT data_json FROM dialogue_review WHERE take_id=? ORDER BY revision DESC LIMIT 1').get(input.takeId), review: unknown = reviewRow && JSON.parse(reviewRow.data_json as string);
    if (!isDialogueReview(review) || review.revision !== row.review_revision) return fail('DIALOGUE_REVIEW_REQUIRED', '请先完成当前 take 的人工审核。');
    const context=reviewContext({projectId:input.projectId,takeId:input.takeId});if(!context.ok)return context;
    const reviewed=db.prepare('SELECT context_json FROM dialogue_review_context WHERE take_id=? AND review_revision=?').get(input.takeId,review.revision);
    if(!reviewed||JSON.parse(reviewed.context_json as string).contextHash!==context.value.contextHash)return fail('DIALOGUE_REVIEW_CONTEXT_CHANGED','当前上下文已有变化，请重新明确审核。');
    if (['timbre', 'accent', 'dialogue'].some(check => review.checks[check as 'timbre'] !== 'pass') || review.checks.lipsync !== 'pass' && !(take.route === 'voiceover' && review.checks.lipsync === 'not-applicable')) return fail('DIALOGUE_QUALITY_NOT_PASSED', '存在未通过的质量检查，不能采用此 take。');
    if(take.route!=='native-reference'){
      const alignment=take.audio?.kind==='assetVersion'?db.prepare('SELECT p.data_json FROM local_media_output o JOIN local_media_job j ON j.job_id=o.job_id JOIN render_plan p ON p.plan_id=j.plan_id WHERE o.asset_id=? AND o.version=?').get(take.audio.assetId,take.audio.version):undefined;
      const source=alignment&&JSON.parse(alignment.data_json as string).dialogueAlignment?.videoRef;if(!source||!take.audio)return fail('DIALOGUE_ALIGNMENT_REQUIRED','采用需要固定对齐来源。');
      const facts=alignedFacts(take.projectId,take.dialogueRef,source,take.audio);if(!facts.ok)return facts;if(facts.value.videoHash!==take.sourceVideoHash||facts.value.audioHash!==take.audioHash)return fail('REFERENCE_CHANGED','采用来源 hash 不符。');
    }
    const video = assets.assertSelectable(take.video); if (!video.ok) return video;
    if (take.audio) { const audio = assets.assertSelectable(take.audio); if (!audio.ok) return audio; if (audio.value.hash !== take.audioHash) return fail('REFERENCE_CHANGED', '固定配音 hash 已改变。'); }
    const selection: DialogueSelection = { libraryId: library.libraryId, projectId: input.projectId, shotId: input.shotId, shotRevision: input.expectedShotRevision, dialogueRef: input.dialogueRef, voiceRef: take.voiceRef, takeId: take.id, selectionRevision: input.expectedSelectionRevision + 1, route: take.route, video: take.video, audio: take.audio, sourceVideoHash: take.sourceVideoHash, audioHash: take.audioHash, reviewRevision: review.revision, selectedAt: new Date().toISOString() };
    const selected = creation.selectOutput({ projectId: input.projectId, shotId: input.shotId, expectedRevision: input.expectedShotRevision, expectedSelectionRevision: input.expectedSelectionRevision, role: 'video', reference: take.video }, selection); if (!selected.ok) return selected;
    db.prepare('INSERT INTO dialogue_selection VALUES(?,?,?,?,?)').run(input.shotId, input.projectId, take.id, selection.selectionRevision, JSON.stringify(selection));
    return isDialogueSelection(selection) ? ok(selection) : fail('INVALID_STORED_DATA', '对白采用记录无效。');
  }
  async function reconcileSubmission(raw: unknown) {
    const parsed = parseReconcileDialogueSubmission(raw); if (!parsed.ok) return parsed;
    const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    const task = generation.read(input.taskId); if (!task.ok) return task;
    const prepared = generation.preparedFor(task.value.attemptId); if (!prepared.ok) return prepared;
    if (prepared.value.projectId !== input.projectId || prepared.value.executionOwner !== input.executionOwner || prepared.value.adapterId !== 'sync-lipsync-v2') return fail('APPROVAL_MISMATCH', '原提交核对身份不符。');
    return generation.reconcile(input.taskId, true);
  }
  return { prepare, savePrepared, approve, stop, production, productions, takes, reviewTake,reviewContext, auditionStatus, confirmAudio,saveConfirmedAudio,checkAlignmentPlan, prepareAlignment, importRepair, saveImportedRepair, prepareRepair, reconcileSubmission, selectTake };
}
