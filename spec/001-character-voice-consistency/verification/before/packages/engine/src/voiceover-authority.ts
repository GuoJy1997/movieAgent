import { createHash } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { assetsFor } from './asset-service.ts';
import { isAudioTake, isVoiceLineRevision, type SaveVoiceLineInput, type VoiceLineRevision } from '../../contracts/src/audio.ts';
import { isCharacterVoiceRevision, isShotDialogueRevision } from '../../contracts/src/character-voice.ts';
import type { RevisionRef } from '../../contracts/src/models.ts';
import { isPreparedGeneration } from '../../contracts/src/generation.ts';
import { isVoiceoverReview, type VoiceoverContext, type VoiceoverReview, type VoiceoverReviewInput } from '../../contracts/src/voiceover.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';

/** Independent TTS authority. No video take, provider dispatch, or new persistence. */
export function voiceoverAuthority(library: LibraryHandle, assets: ReturnType<typeof assetsFor>) {
  const db = library.db;
  function checkLine(line: SaveVoiceLineInput | VoiceLineRevision, profileRef?: RevisionRef): Result<void> {
    if (!line.dialogueSource) return ok(undefined);
    const own = library.checkOwnership(); if (!own.ok) return own;
    const { dialogueRef, turnId, voiceRef } = line.dialogueSource;
    const row = db.prepare('SELECT r.data_json FROM shot_dialogue_revision r JOIN shot_dialogue_current c ON c.id=r.id AND c.revision=r.revision WHERE r.project_id=? AND r.id=? AND r.revision=?').get(line.projectId, dialogueRef.id, dialogueRef.revision);
    const dialogue: unknown = row ? JSON.parse(row.data_json as string) : null;
    if (!isShotDialogueRevision(dialogue)) return fail('INPUT_CHANGED', '旁白来源对白已有新修订。');
    const turn = dialogue.turns.find(turn => turn.turnId === turnId);
    if (!turn || turn.mode !== 'voiceover' || turn.text !== line.text || line.shotRef?.libraryId !== library.libraryId || line.entityRef?.libraryId !== library.libraryId || line.shotRef.id !== dialogue.shotRef.id || line.shotRef.revision !== dialogue.shotRef.revision || line.entityRef.id !== turn.characterRef.id || line.entityRef.revision !== turn.characterRef.revision || voiceRef.id !== turn.voiceRef.id || voiceRef.revision !== turn.voiceRef.revision) return fail('INPUT_CHANGED', '旁白台词与固定对白来源不符。');
    for (const [kind, ref] of [['shot',line.shotRef],['entity',line.entityRef]] as const) if (db.prepare('SELECT revision FROM creation_current WHERE kind=? AND id=? AND project_id=?').get(kind,ref.id,line.projectId)?.revision !== ref.revision) return fail('INPUT_CHANGED','旁白镜头或角色已有新修订。');
    const voiceRow = db.prepare('SELECT r.data_json FROM character_voice_revision r JOIN character_voice_current c ON c.id=r.id AND c.revision=r.revision WHERE r.project_id=? AND r.id=? AND r.revision=?').get(line.projectId,voiceRef.id,voiceRef.revision);
    const voice:unknown = voiceRow ? JSON.parse(voiceRow.data_json as string) : null;
    if (!isCharacterVoiceRevision(voice) || voice.entityRef.id !== turn.characterRef.id || voice.entityRef.revision !== turn.characterRef.revision || !voice.ttsProfileRef) return fail('INPUT_CHANGED','请为当前声音修订保存 TTS 预设，并更新对白来源。');
    if (profileRef && JSON.stringify(voice.ttsProfileRef) !== JSON.stringify(profileRef)) return fail('INPUT_CHANGED','旁白必须使用固定声音的 TTS 预设。');
    const source = assets.assertSelectable(voice.reference.ref); if (!source.ok) return source;
    return source.value.hash === voice.reference.hash ? ok(undefined) : fail('REFERENCE_CHANGED','声音来源已经改变。');
  }
  function latest(projectId:string,takeId:string):VoiceoverReview|null {
    const rows = db.prepare("SELECT c.receipt_json,e.payload_json FROM command_receipt c JOIN domain_event e ON e.seq=c.committed_seq AND e.library_id=c.library_id WHERE c.library_id=? AND e.kind='audio.voiceoverReviewed' ORDER BY e.seq DESC").all(library.libraryId);
    for (const row of rows) {
      const event:unknown = JSON.parse(row.payload_json as string), receipt = JSON.parse(row.receipt_json as string);
      if(isVoiceoverReview(event)&&event.projectId===projectId&&event.takeId===takeId&&receipt.libraryId===library.libraryId&&JSON.stringify(receipt.result)===JSON.stringify(event))return event;
    }
    return null;
  }
  function context(input:{projectId:string;takeId:string}):Result<VoiceoverContext> {
    const own=library.checkOwnership();if(!own.ok)return own;
    const takeRow=db.prepare("SELECT data_json FROM audio_take WHERE project_id=? AND json_extract(data_json,'$.id')=?").get(input.projectId,input.takeId);
    const take:unknown=takeRow?JSON.parse(takeRow.data_json as string):null;
    if(!isAudioTake(take)||take.libraryId!==library.libraryId)return fail('AUDIO_TAKE_NOT_FOUND','固定配音结果不存在。');
    const lineRow=db.prepare('SELECT data_json FROM voice_line_revision WHERE project_id=? AND id=? AND revision=?').get(input.projectId,take.lineId,take.lineRevision);
    const line:unknown=lineRow?JSON.parse(lineRow.data_json as string):null;
    if(!isVoiceLineRevision(line)||!line.dialogueSource)return fail('VOICEOVER_SOURCE_REQUIRED','此结果没有结构化旁白来源。');
    if(db.prepare('SELECT MAX(revision) AS revision FROM voice_line_revision WHERE project_id=? AND id=?').get(input.projectId,line.id)?.revision!==line.revision)return fail('INPUT_CHANGED','旁白台词已有新修订。');
    const checked=checkLine(line,take.profileRef);if(!checked.ok)return checked;
    const preparedRow=db.prepare('SELECT p.plan_json,a.view_json FROM generation_prepared p JOIN generation_task t ON t.prepared_id=p.prepared_id JOIN task_attempt a ON a.task_id=t.task_id WHERE t.task_id=? AND a.attempt_id=? AND t.project_id=?').get(take.task.taskId,take.task.attemptId,input.projectId);
    const prepared:unknown=preparedRow?JSON.parse(preparedRow.plan_json as string):null, task=preparedRow?JSON.parse(preparedRow.view_json as string):null;
    if(!isPreparedGeneration(prepared)||task?.state!=='SUCCEEDED'||JSON.stringify(task.artifactRef)!==JSON.stringify(take.output)||prepared.config.model.capabilities.taskTypes[0]!=='text_to_speech'||prepared.config.profile.id!==take.profileRef.id||prepared.config.profile.revision!==take.profileRef.revision)return fail('VOICEOVER_SOURCE_REQUIRED','需要真实成功的固定 TTS 结果。');
    for(const [table,ref] of [['profile_revision',prepared.config.profile],['model_revision',prepared.config.model],['connection_revision',prepared.config.connection]] as const)if(db.prepare(`SELECT MAX(revision) AS revision FROM ${table} WHERE id=? AND library_id=?`).get(ref.id,library.libraryId)?.revision!==ref.revision)return fail('INPUT_CHANGED','旁白配置已有新修订，请重新生成与审核。');
    const metadata=assets.assertSelectable(take.output);if(!metadata.ok)return metadata;
    const contextHash=createHash('sha256').update(JSON.stringify({take,line,outputHash:metadata.value.hash,config:prepared.config})).digest('hex');
    return ok({libraryId:library.libraryId,projectId:input.projectId,take,line,contextHash,outputHash:metadata.value.hash,review:latest(input.projectId,take.id)});
  }
  function review(input:VoiceoverReviewInput):Result<VoiceoverReview> {
    const current=context(input);if(!current.ok)return current;
    if(current.value.contextHash!==input.contextHash)return fail('VOICEOVER_CONTEXT_CHANGED','旁白审核上下文已改变，请重新试听。');
    return ok({...input,libraryId:library.libraryId,outputHash:current.value.outputHash,reviewedAt:new Date().toISOString()});
  }
  function allowHash(projectId:string,hash:string):Result<void> {
    // Hash matching also covers published and re-imported same-byte aliases.
    const rows=db.prepare('SELECT t.data_json AS take_json,l.data_json AS line_json FROM audio_take t JOIN voice_line_revision l ON l.project_id=t.project_id AND l.id=json_extract(t.data_json,\'$.lineId\') AND l.revision=json_extract(t.data_json,\'$.lineRevision\') WHERE t.project_id=?').all(projectId);
    for(const row of rows){const take=JSON.parse(row.take_json as string),line=JSON.parse(row.line_json as string);if(!isAudioTake(take)||!isVoiceLineRevision(line)||!line.dialogueSource)continue;
      const media=assets.metadata(take.output);if(!media.ok)return media;if(media.value.hash!==hash)continue;
      const current=context({projectId,takeId:take.id});if(!current.ok)return current;
      const review=current.value.review;if(!review||review.contextHash!==current.value.contextHash||review.outputHash!==hash||Object.values(review.checks).some(check=>check!=='pass'))return fail('VOICEOVER_REVIEW_REQUIRED','请先试听并保存此旁白结果的当前人工审核。');
    }
    return ok(undefined);
  }
  return {checkLine,context,review,allowHash};
}
