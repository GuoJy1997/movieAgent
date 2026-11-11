import {voiceIdentityFingerprint} from '../../domain/src/voice-identity.ts';
import {voiceInputResolver} from './voice-input-resolver.ts';
import type {PrepareVoiceAuditionInput} from '../../contracts/src/audio.ts';
import type {VoiceAuditionStatus} from '../../contracts/src/dialogue-production.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { PreparedGeneration, TaskRef } from '../../contracts/src/generation.ts';
import { AUDIO_LIMITS, type AudioBatchPlan, type AudioBatchSnapshot, type AudioSnapshot, type ApproveSpeechInput, type FrozenAudioSource, type PrepareSpeechInput, type PrepareTranscriptionInput, type SaveTranscriptInput, type SaveVoiceLineInput, type TranscriptRevision, type VoiceLineRevision } from '../../contracts/src/audio.ts';
import type { assetsFor } from './asset-service.ts';
import type { mediaInfoFor } from './media-info-service.ts';
import type { generationFor } from './generation-service.ts';
import { voiceoverAuthority } from './voiceover-authority.ts';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Synchronous writes participate in the router's one receipt/event transaction. */
export function audioFor(library: LibraryHandle, generation: ReturnType<typeof generationFor>, assets: ReturnType<typeof assetsFor>, mediaInfo: ReturnType<typeof mediaInfoFor>) {
  const voiceover = voiceoverAuthority(library, assets);
  function project(projectId: string): Result<void> {
    const own = library.checkOwnership(); if (!own.ok) return own;
    return library.db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(projectId, library.libraryId) ? ok(undefined) : fail('PROJECT_NOT_FOUND', '项目不存在。');
  }
  function line(projectId: string, id: string, revision?: number): VoiceLineRevision | undefined {
    const row = revision === undefined ? library.db.prepare('SELECT data_json FROM voice_line_revision WHERE project_id=? AND id=? ORDER BY revision DESC LIMIT 1').get(projectId, id) : library.db.prepare('SELECT data_json FROM voice_line_revision WHERE project_id=? AND id=? AND revision=?').get(projectId, id, revision);
    return row ? JSON.parse(row.data_json as string) : undefined;
  }
  function saveVoiceLine(input: SaveVoiceLineInput): Result<VoiceLineRevision> {
    const checked = project(input.projectId); if (!checked.ok) return checked;
    const linked = voiceover.checkLine(input); if (!linked.ok) return linked;
    if ((line(input.projectId, input.id)?.revision ?? 0) !== input.expectedRevision) return fail('REVISION_CONFLICT', '台词已修改，请重新读取。');
    for (const [ref, kind] of [[input.shotRef, 'shot'], [input.entityRef, 'entity']] as const) {
      if (!ref) continue;
      if (ref.libraryId !== library.libraryId || !library.db.prepare('SELECT 1 FROM creation_revision WHERE kind=? AND project_id=? AND id=? AND revision=?').get(kind, input.projectId, ref.id, ref.revision)) return fail('REVISION_NOT_FOUND', '关联的固定创作修订不存在。');
    }
    const { expectedRevision, ...fields } = input;
    const value = { ...fields, libraryId: library.libraryId, revision: expectedRevision + 1, createdAt: new Date().toISOString() };
    library.db.prepare('INSERT INTO voice_line_revision VALUES(?,?,?,?)').run(input.projectId, input.id, value.revision, JSON.stringify(value));
    return ok(value);
  }
  function prepareSpeech(input: PrepareSpeechInput): Result<AudioBatchPlan> {
    const checked = project(input.projectId); if (!checked.ok) return checked;
    const frozen = input.lines.map(item => ({ ...item, line: line(input.projectId, item.lineId, item.revision) }));
    if (frozen.some(item => !item.line || line(input.projectId, item.lineId)?.revision !== item.revision)) return fail('INPUT_CHANGED', '台词修订已变化，请重新选择。');
    for (const item of frozen) { const linked=voiceover.checkLine(item.line!,item.profileRef); if(!linked.ok)return linked; }
    if(frozen.length>1&&!input.exception)for(const item of frozen){const voiceRef=item.line!.dialogueSource?.voiceRef??item.line!.voiceRef;if(!voiceRef)continue;const status=qualification({projectId:input.projectId,voiceRef,profileRef:item.profileRef});if(!status.ok)return status;if(!status.value.allowed)return fail('AUDITION_REQUIRED','该声音的三情绪音频试听尚未通过：'+status.value.missing.join('、')+'。可先做单条试听，或为本批填写具体例外原因。');}
    if (frozen.reduce((sum, item) => sum + Array.from(item.line!.text).length, 0) > AUDIO_LIMITS.batchCharacters) return fail('AUDIO_BATCH_LIMIT', '每批台词合计最多16000字符。');
    const items = [];
    for (const item of frozen) {
      const prepared = generation.prepare({ projectId: input.projectId, profileRef: item.profileRef, prompt: item.line!.text, inputVersion: `${item.lineId}-${item.revision}`, executionOwner: input.executionOwner, runId: input.runId },undefined,true,item.line!.dialogueSource?.voiceRef??item.line!.voiceRef);
      if (!prepared.ok) return prepared;
      if (prepared.value.config.model.capabilities.taskTypes[0] !== 'text_to_speech') return fail('UNSUPPORTED_CAPABILITY', '请选择配音预设。');
      items.push({ lineId: item.lineId, revision: item.revision, prepared: prepared.value });
    }
    const currencies = new Set(items.flatMap(item => item.prepared.currency ? [item.prepared.currency] : []));
    if (currencies.size > 1) return fail('CURRENCY_MISMATCH', '整批配音需使用同一币种。');
    const base = { ...(input.exception?{exception:input.exception}:{}),libraryId: library.libraryId, projectId: input.projectId, planId: randomUUID(), executionOwner: input.executionOwner, runId: input.runId, expiresAt: Math.min(...items.map(item => item.prepared.expiresAt)), items, estimateMicros: items.some(item => item.prepared.estimateMicros === null) ? null : items.reduce((sum, item) => sum + item.prepared.estimateMicros!, 0), currency: [...currencies][0] ?? null };
    const plan = { ...base, planHash: digest(base) };
    library.db.prepare('INSERT INTO audio_batch(plan_id,project_id,plan_json,state) VALUES(?,?,?,?)').run(plan.planId, plan.projectId, JSON.stringify(plan), 'prepared');
    for (const [ordinal, item] of items.entries()) library.db.prepare('INSERT INTO audio_batch_item(plan_id,ordinal,line_id,line_revision,prepared_id) VALUES(?,?,?,?,?)').run(plan.planId, ordinal, item.lineId, item.revision, item.prepared.preparedId);
    return ok(plan);
  }
  function qualification(input:{projectId:string;voiceRef:import('../../contracts/src/creation.ts').CreationRef;profileRef:import('../../contracts/src/models.ts').RevisionRef}):Result<VoiceAuditionStatus>{
    const voice=voiceInputResolver(library).read(input.projectId,input.voiceRef);if(!voice.ok)return voice;
    const prepared=generation.prepare({projectId:input.projectId,profileRef:input.profileRef,prompt:'qualification',inputVersion:'qualification',executionOwner:'desktop-user',runId:'qualification'},undefined,false,input.voiceRef);if(!prepared.ok)return prepared;
    const print=voiceIdentityFingerprint(voice.value,'tts',prepared.value.config),passed=new Set<string>();
    const rows=library.db.prepare("SELECT t.data_json AS take_json,l.data_json AS line_json FROM audio_take t JOIN voice_line_revision l ON l.project_id=t.project_id AND l.id=json_extract(t.data_json,'$.lineId') AND l.revision=json_extract(t.data_json,'$.lineRevision') WHERE t.project_id=?").all(input.projectId);
    for(const row of rows){const take=JSON.parse(row.take_json as string),line=JSON.parse(row.line_json as string);if(!line.voiceRef||!line.auditionEmotion)continue;const candidate=voiceInputResolver(library).read(input.projectId,line.voiceRef);if(!candidate.ok)continue;
      const context=voiceover.context({projectId:input.projectId,takeId:take.id});if(!context.ok)continue;const {review,contextHash,outputHash}=context.value;if(!review||review.contextHash!==contextHash||review.outputHash!==outputHash||Object.values(review.checks).some(c=>c!=='pass'))continue;
      const raw=library.db.prepare('SELECT p.plan_json FROM generation_prepared p JOIN generation_task t ON t.prepared_id=p.prepared_id WHERE t.task_id=?').get(take.task.taskId);if(!raw)continue;const previous=JSON.parse(raw.plan_json as string);
      if(voiceIdentityFingerprint(candidate.value,'tts',previous.config)===print)passed.add(line.auditionEmotion);
    }
    const missing=(['calm','excited','quiet'] as const).filter(e=>!passed.has(e));return ok({allowed:missing.length===0,missing,fingerprint:print});
  }
  function prepareAudition(input:PrepareVoiceAuditionInput):Result<AudioBatchPlan>{
    const id=randomUUID(),saved=saveVoiceLine({projectId:input.projectId,id,expectedRevision:0,text:input.text,voiceRef:input.voiceRef,auditionEmotion:input.emotion});if(!saved.ok)return saved;
    return prepareSpeech({projectId:input.projectId,lines:[{lineId:id,revision:1,profileRef:input.profileRef}],executionOwner:input.executionOwner,runId:input.runId});
  }
  function batch(input: { projectId: string; planId: string }): Result<AudioBatchSnapshot> {
    const checked = project(input.projectId); if (!checked.ok) return checked;
    const row = library.db.prepare('SELECT * FROM audio_batch WHERE plan_id=? AND project_id=?').get(input.planId, input.projectId);
    if (!row) return fail('AUDIO_BATCH_NOT_FOUND', '配音批次不存在。');
    const plan: AudioBatchPlan = JSON.parse(row.plan_json as string);
    const tasks = library.db.prepare('SELECT * FROM audio_batch_item WHERE plan_id=? ORDER BY ordinal').all(input.planId).map(item => {
      const task = item.task_id ? generation.read(item.task_id as string) : null;
      return { lineId: item.line_id as string, revision: item.line_revision as number, task: task?.ok ? { libraryId: library.libraryId, taskId: task.value.taskId, attemptId: task.value.attemptId } : null, diagnostic: (item.diagnostic as string | null) ?? (task?.ok ? task.value.errorCode : null) };
    });
    return ok({ libraryId: library.libraryId, plan, state: row.state as AudioBatchSnapshot['state'], tasks });
  }
  function approveSpeech(input: ApproveSpeechInput): Result<{ libraryId: string; tasks: TaskRef[] }> {
    const row = library.db.prepare('SELECT * FROM audio_batch WHERE plan_id=?').get(input.planId);
    if (!row) return fail('AUDIO_BATCH_NOT_FOUND', '配音批次不存在。');
    const plan: AudioBatchPlan = JSON.parse(row.plan_json as string), approvalJson = JSON.stringify(input);
    if(plan.items.length>1&&!plan.exception)for(const item of plan.items){const saved=line(plan.projectId,item.lineId,item.revision),voiceRef=saved?.dialogueSource?.voiceRef??saved?.voiceRef;if(!voiceRef)continue;const status=qualification({projectId:plan.projectId,voiceRef,profileRef:{libraryId:library.libraryId,id:item.prepared.config.profile.id,revision:item.prepared.config.profile.revision}});if(!status.ok)return status;if(!status.value.allowed)return fail('AUDITION_REQUIRED','当前声音资格已改变，请重新准备批次。');}
    if (row.state === 'stopped') return fail('AUDIO_BATCH_STOPPED', '批次已停止。');
    if (row.approval_json) {
      if (row.approval_json !== approvalJson) return fail('APPROVAL_REUSED', '批准已消费，不能改变范围。');
      const current = batch({ projectId: plan.projectId, planId: plan.planId });
      return current.ok ? ok({ libraryId: library.libraryId, tasks: current.value.tasks.map(item => item.task!) }) : current;
    }
    if (plan.planHash !== input.planHash || plan.executionOwner !== input.executionOwner || plan.runId !== input.runId || plan.expiresAt <= generation.now()) return fail('APPROVAL_MISMATCH', '批次身份、指纹或有效期不符。');
    const a = input.approval;
    if (a.allowanceMicros < plan.items.length || a.allowanceMicros > a.budgetLimitMicros || plan.currency !== null && plan.currency !== a.currency || plan.estimateMicros === null && !a.acknowledgeUnknown) return fail('ALLOWANCE_EXCEEDED', '整批币种、有限额度或未知价格确认不足。');
    const minimums = plan.items.map(item => Math.max(1, item.prepared.estimateMicros ?? 1));
    const minimum = minimums.reduce((sum, value) => sum + value, 0);
    if (minimum > a.allowanceMicros) return fail('ALLOWANCE_EXCEEDED', '风险额度低于整批估算。');
    const existing = Number(library.db.prepare('SELECT COALESCE(SUM(reservation_micros),0) AS total FROM generation_task WHERE project_id=? AND currency=?').get(plan.projectId, a.currency)!.total) + generation.waitingReservations(plan.projectId, a.currency);
    if (existing > a.budgetLimitMicros - a.allowanceMicros) return fail('BUDGET_EXCEEDED', '整批预算不足，未入队任何项目。');
    for (const item of plan.items) {
      if (line(plan.projectId, item.lineId)?.revision !== item.revision) return fail('INPUT_CHANGED', '批准前台词已修改。');
      const linked = voiceover.checkLine(line(plan.projectId,item.lineId,item.revision)!, {libraryId:library.libraryId,id:item.prepared.config.profile.id,revision:item.prepared.config.profile.revision}); if(!linked.ok)return linked;
      const current = generation.checkCurrent(item.prepared); if (!current.ok) return current;
    }
    // The router transaction owns all child rows and the full reservation. No public command loop.
    library.db.prepare("UPDATE audio_batch SET approval_json=?,state='approved' WHERE plan_id=?").run(approvalJson, plan.planId);
    const surplus = a.allowanceMicros - minimum, count = plan.items.length, tasks: TaskRef[] = [];
    for (const [index, item] of plan.items.entries()) {
      const allowanceMicros = minimums[index]! + Math.floor(surplus / count) + (index < surplus % count ? 1 : 0);
      const task = generation.approveAudioItem(plan.planId, { preparedId: item.prepared.preparedId, approvedPlanHash: item.prepared.planHash, executionOwner: plan.executionOwner, runId: plan.runId, ...a, allowanceMicros });
      if (!task.ok) return task;
      library.db.prepare('UPDATE audio_batch_item SET task_id=? WHERE prepared_id=?').run(task.value.taskId, item.prepared.preparedId);
      tasks.push(task.value);
    }
    return ok({ libraryId: library.libraryId, tasks });
  }
  function stopBatch(input: { projectId: string; planId: string; executionOwner: string }): Result<AudioBatchSnapshot> {
    const found = batch(input); if (!found.ok) return found;
    if (found.value.plan.executionOwner !== input.executionOwner) return fail('APPROVAL_MISMATCH', '执行身份不符。');
    library.db.prepare("UPDATE audio_batch SET state='stopped' WHERE plan_id=?").run(input.planId);
    for (const item of found.value.tasks) if (item.task) { const cancelled = generation.cancel(item.task.taskId); if (!cancelled.ok) return cancelled; }
    return batch(input);
  }
  async function inspectTranscription(input: PrepareTranscriptionInput): Promise<Result<FrozenAudioSource>> {
    const checked = project(input.projectId); if (!checked.ok) return checked;
    const metadata = assets.assertSelectable(input.source); if (!metadata.ok) return metadata;
    if (!metadata.value.mime.startsWith('audio/') || metadata.value.byteLength > AUDIO_LIMITS.uploadBytes) return fail('AUDIO_UPLOAD_LIMIT', '转写仅接受最多24000000字节的音频，请拆分后重试。');
    const probe = await mediaInfo.ensure(input.source); if (!probe.ok) return probe;
    const current = assets.assertSelectable(input.source); if (!current.ok) return current;
    if (current.value.hash !== metadata.value.hash) return fail('INPUT_CHANGED', '音频原件已变化。');
    return ok({ ref: structuredClone(input.source), hash: metadata.value.hash, mime: metadata.value.mime, byteLength: metadata.value.byteLength, durationTicks: probe.value.durationTicks });
  }
  function prepareTranscription(input: PrepareTranscriptionInput, source: FrozenAudioSource): Result<PreparedGeneration> {
    const current = assets.assertSelectable(source.ref); if (!current.ok) return current;
    if (current.value.hash !== source.hash) return fail('INPUT_CHANGED', '音频已变化。');
    const prepared = generation.prepare({ projectId: input.projectId, profileRef: input.profileRef, prompt: 'Transcribe selected audio.', inputVersion: source.hash, executionOwner: input.executionOwner, runId: input.runId, audioSource: source });
    return prepared.ok && prepared.value.config.model.capabilities.taskTypes[0] !== 'speech_to_text' ? fail('UNSUPPORTED_CAPABILITY', '请选择音频转写预设。') : prepared;
  }
  function saveTranscript(input: SaveTranscriptInput): Result<TranscriptRevision> {
    const checked = project(input.projectId); if (!checked.ok) return checked;
    const row = library.db.prepare('SELECT data_json FROM transcript_revision WHERE project_id=? AND id=? ORDER BY revision DESC LIMIT 1').get(input.projectId, input.id);
    const old: TranscriptRevision | undefined = row ? JSON.parse(row.data_json as string) : undefined;
    if ((old?.revision ?? 0) !== input.expectedRevision) return fail('REVISION_CONFLICT', '转写已修改。');
    if (input.segments.some(segment => segment.endTicks > (old?.sourceDurationTicks ?? 0))) return fail('INVALID_TRANSCRIPT_TIMING', '校时句段不能超出固定音频范围。');
    const { expectedRevision, ...fields } = input;
    const value: TranscriptRevision = { ...fields, libraryId: library.libraryId, revision: expectedRevision + 1, source: old?.source ?? null, sourceHash: old?.sourceHash ?? null, sourceDurationTicks: old?.sourceDurationTicks ?? null, task: old?.task ?? null, createdAt: new Date().toISOString() };
    library.db.prepare('INSERT INTO transcript_revision(project_id,id,revision,data_json) VALUES(?,?,?,?)').run(input.projectId, input.id, value.revision, JSON.stringify(value));
    return ok(value);
  }
  function read(input: { projectId: string }): Result<AudioSnapshot> {
    const checked = project(input.projectId); if (!checked.ok) return checked;
    const values = <T>(table: string) => library.db.prepare(`SELECT data_json FROM ${table} WHERE project_id=? ORDER BY rowid`).all(input.projectId).map(row => JSON.parse(row.data_json as string) as T);
    const diagnostics = library.db.prepare('SELECT audio_publication.task_id,diagnostic,task_attempt.attempt_id,task_attempt.view_json FROM audio_publication JOIN generation_task USING(task_id) JOIN task_attempt USING(task_id) WHERE project_id=? AND diagnostic IS NOT NULL').all(input.projectId).map(row => ({ task: { libraryId: library.libraryId, taskId: row.task_id as string, attemptId: row.attempt_id as string }, code: row.diagnostic as string, rawOutput: (JSON.parse(row.view_json as string) as import('../../contracts/src/generation.ts').TaskView).artifactRef }));
    return ok({ libraryId: library.libraryId, projectId: input.projectId, voiceLines: values<VoiceLineRevision>('voice_line_revision'), takes: values<AudioSnapshot['takes'][number]>('audio_take'), transcripts: values<TranscriptRevision>('transcript_revision'), diagnostics });
  }
  return { qualification,prepareAudition,saveVoiceLine, prepareSpeech, approveSpeech, stopBatch, inspectTranscription, prepareTranscription, saveTranscript, read, batch, voiceoverContext: voiceover.context, reviewVoiceover: voiceover.review };
}
