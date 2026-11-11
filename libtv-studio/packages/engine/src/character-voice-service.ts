import {voiceInputResolver} from './voice-input-resolver.ts';
import {parseReplaceVoiceDialogues,type ReplaceVoiceDialoguesInput,type ReplacedVoiceDialogues} from '../../contracts/src/character-voice.ts';
import { parseBindCharacterVoice, isCharacterVoiceBinding, type BindCharacterVoiceInput, type CharacterVoiceBinding } from '../../contracts/src/character-voice.ts';
import { randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { creationFor } from './creation-service.ts';
import type { assetsFor } from './asset-service.ts';
import type { mediaInfoFor } from './media-info-service.ts';
import type { rendersFor } from './render-service.ts';
import { parsePrepareVoiceReference, type PrepareVoiceReferenceInput } from '../../contracts/src/character-voice.ts';
import { isCharacterVoiceRevision, isCharacterVoiceSnapshot, isShotDialogueRevision, isShotDialogueSnapshot, parseSaveCharacterVoice, parseSaveShotDialogue, type CharacterVoiceRevision, type CharacterVoiceSnapshot, type SaveCharacterVoiceInput, type SaveShotDialogueInput, type ShotDialogueRevision, type ShotDialogueSnapshot, type VoiceProduction } from '../../contracts/src/character-voice.ts';
import type { CreationRef } from '../../contracts/src/creation.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { validateDialogue } from '../../domain/src/character-voice.ts';
import { mediaStreamEndTicks } from '../../domain/src/timeline-time.ts';

export function characterVoiceFor({ library, creation, assets, mediaInfo, renders }: { library: LibraryHandle; creation: ReturnType<typeof creationFor>; assets: ReturnType<typeof assetsFor>; mediaInfo: ReturnType<typeof mediaInfoFor>; renders: Pick<ReturnType<typeof rendersFor>, 'inspectDerived'> }) {
  const db = library.db;
  function project(projectId: string): Result<void> {
    const owner = library.checkOwnership(); if (!owner.ok) return owner;
    return db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(projectId, library.libraryId) ? ok(undefined) : fail('PROJECT_NOT_FOUND', '当前资料库中没有此项目。');
  }
  function voiceRevision(projectId: string, ref: CreationRef): CharacterVoiceRevision | undefined {
    const row = db.prepare('SELECT data_json FROM character_voice_revision WHERE id=? AND revision=? AND project_id=?').get(ref.id, ref.revision, projectId);
    if (!row) return undefined;
    const value: unknown = JSON.parse(row.data_json as string);
    return isCharacterVoiceRevision(value) ? value : undefined;
  }
  function currentVoice(projectId: string, id: string): CharacterVoiceRevision | undefined {
    const row = db.prepare('SELECT revision FROM character_voice_current WHERE id=? AND project_id=?').get(id, projectId);
    return row ? voiceRevision(projectId, { id, revision: row.revision as number }) : undefined;
  }
  function currentDialogue(projectId: string, shotId: string): ShotDialogueRevision | undefined {
    const row = db.prepare('SELECT id,revision FROM shot_dialogue_current WHERE project_id=? AND shot_id=?').get(projectId, shotId);
    if (!row) return undefined;
    const revision = db.prepare('SELECT data_json FROM shot_dialogue_revision WHERE id=? AND revision=? AND project_id=?').get(row.id as string, row.revision as number, projectId);
    if (!revision) return undefined;
    const value: unknown = JSON.parse(revision.data_json as string);
    return isShotDialogueRevision(value) ? value : undefined;
  }
  function production(input: SaveCharacterVoiceInput): Result<VoiceProduction> {
    const reference = input.draft.videoReference ?? input.draft.reference;
    if(!reference)return ok({ready:false,reason:'VIDEO_REFERENCE_MISSING'});
    const metadata = assets.assertSelectable(reference.ref); if (!metadata.ok) return metadata;
    if (!metadata.value.mime.startsWith('audio/')) return fail('INVALID_MEDIA_TYPE', '角色参考必须是音频。');
    if (metadata.value.hash !== reference.hash) return fail('REFERENCE_CHANGED', '参考音频 hash 已改变。');
    if (!reference.probeId) return ok({ ready: false, reason: 'MEDIA_ANALYSIS_REQUIRED' });
    const read = mediaInfo.read(reference.ref); if (!read.ok) return read;
    const probe = read.value;
    if (!probe || probe.probeId !== reference.probeId || probe.objectHash !== reference.hash || !probe.hasAudio) return ok({ ready: false, reason: 'MEDIA_ANALYSIS_REQUIRED' });
    if (reference.sourceInTicks + reference.durationTicks > mediaStreamEndTicks(probe, 'audio')) return fail('SOURCE_RANGE', '参考裁切超出原音频范围。');
    const stream = probe.streams.find(value => value.kind === 'audio');
    const normalized = probe.container === 'wav' && stream?.codec === 'pcm_s16le' && stream.sampleRate === 48000 && stream.channels === 1;
    if (!normalized || metadata.value.mime!=='audio/wav' || reference.sourceInTicks!==0 || reference.durationTicks!==probe.durationTicks) return ok({ ready: false, reason: 'REFERENCE_PREPARATION_REQUIRED' });
    if (reference.durationTicks < 2 * 48000 || reference.durationTicks > 15 * 48000) return ok({ ready: false, reason: 'REFERENCE_DURATION' });
    return ok({ ready: true, reason: null });
  }
  function saveVoice(raw: SaveCharacterVoiceInput, preserveFrozenIdentity=false): Result<CharacterVoiceRevision> {
    const parsed = parseSaveCharacterVoice(raw); if (!parsed.ok) return parsed; const input = parsed.value;
    const validProject = project(input.projectId); if (!validProject.ok) return validProject;
    const snapshot = creation.read({ projectId: input.projectId }); if (!snapshot.ok) return snapshot;
    const historical=preserveFrozenIdentity?db.prepare("SELECT data_json FROM creation_revision WHERE kind='entity' AND project_id=? AND id=? AND revision=?").get(input.projectId,input.draft.entityRef.id,input.draft.entityRef.revision):undefined;
    const entity = historical?JSON.parse(historical.data_json as string):snapshot.value.entities.find(value => value.id === input.draft.entityRef.id && value.revision === input.draft.entityRef.revision && value.kind === 'character');
    if (!entity||entity.kind!=='character') return fail('REVISION_CONFLICT', '角色不存在或已有新修订。');
    const id = input.id ?? randomUUID();
    if ((currentVoice(input.projectId, id)?.revision ?? 0) !== input.expectedRevision) return fail('REVISION_CONFLICT', '声音档案已有新修订。');
    if (input.draft.ttsProfileRef) {
      const ref = input.draft.ttsProfileRef;
      if (ref.libraryId !== library.libraryId || !db.prepare('SELECT 1 FROM profile_revision WHERE id=? AND revision=? AND library_id=?').get(ref.id,ref.revision,library.libraryId) || !preserveFrozenIdentity&&db.prepare('SELECT MAX(revision) AS revision FROM profile_revision WHERE id=? AND library_id=?').get(ref.id, library.libraryId)?.revision !== ref.revision) return fail('CONFIG_CHANGED', '配音预设已有新修订。');
    }
    if(input.draft.ttsBinding){
      const binding=input.draft.ttsBinding;
      for(const [table,ref] of [['profile_revision',binding.profileRef],['model_revision',binding.modelRef],['connection_revision',binding.connectionRef]] as const){if(ref.libraryId!==library.libraryId||!db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND revision=? AND library_id=?`).get(ref.id,ref.revision,library.libraryId))return fail('CONFIG_CHANGED','声音所用服务或模型不存在。');}
      const profile=JSON.parse(db.prepare('SELECT data_json FROM profile_revision WHERE id=? AND revision=? AND library_id=?').get(binding.profileRef.id,binding.profileRef.revision,library.libraryId)!.data_json as string);
      const model=JSON.parse(db.prepare('SELECT data_json FROM model_revision WHERE id=? AND revision=? AND library_id=?').get(binding.modelRef.id,binding.modelRef.revision,library.libraryId)!.data_json as string);
      if(JSON.stringify(profile.modelRef)!==JSON.stringify(binding.modelRef)||JSON.stringify(model.connectionRef)!==JSON.stringify(binding.connectionRef)||model.capabilities.taskTypes[0]!=='text_to_speech')return fail('INVALID_VOICE_BINDING','音色必须绑定同一服务的语音模型。');
    }
    for(const reference of [input.draft.reference,input.draft.videoReference,input.draft.sourceSample,input.draft.baselineAudio]){
      if(!reference)continue;const selected=assets.assertSelectable(reference.ref);if(!selected.ok)return selected;if(!selected.value.mime.startsWith('audio/')||selected.value.hash!==reference.hash)return fail('REFERENCE_CHANGED','声音样本格式或 hash 无效。');
      const probe=mediaInfo.read(reference.ref);if(!probe.ok)return probe;if(reference.probeId&&probe.value&&(probe.value.probeId!==reference.probeId||probe.value.objectHash!==reference.hash))return fail('MEDIA_ANALYSIS_REQUIRED','请重新分析声音样本。');
      if(probe.value&&(!probe.value.hasAudio||probe.value.streams.some(s=>s.kind==='video')||reference.sourceInTicks+reference.durationTicks>mediaStreamEndTicks(probe.value,'audio')))return fail('SOURCE_RANGE','声音样本选区越界或不是独立音频。');
    }
    const checked = production(input); if (!checked.ok) return checked;
    const value: CharacterVoiceRevision = { ...structuredClone(input.draft), libraryId: library.libraryId, projectId: input.projectId, id, revision: input.expectedRevision + 1, production: checked.value, createdAt: new Date().toISOString() };
    db.prepare('INSERT INTO character_voice_revision VALUES(?,?,?,?,?)').run(id, value.revision, input.projectId, entity.id, JSON.stringify(value));
    db.prepare('INSERT INTO character_voice_current(id,project_id,entity_id,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision').run(id, input.projectId, entity.id, value.revision);
    for(const source of [value.reference,value.videoReference,value.sourceSample,value.baselineAudio])if(source)db.prepare('INSERT OR IGNORE INTO character_voice_media VALUES(?,?,?,?,?,?)').run(id,value.revision,input.projectId,JSON.stringify(source.ref),source.hash,source.probeId);
    return ok(value);
  }
  function currentDialogues(projectId:string,entityId?:string):ShotDialogueRevision[]{return db.prepare('SELECT r.data_json FROM shot_dialogue_current c JOIN shot_dialogue_revision r ON r.id=c.id AND r.project_id=c.project_id AND r.revision=c.revision WHERE c.project_id=?').all(projectId).map(r=>JSON.parse(r.data_json as string)).filter(isShotDialogueRevision).filter(d=>!entityId||d.turns.some(t=>t.characterRef.id===entityId));}
  function listVoices(input: { projectId: string; entityId?: string }): Result<CharacterVoiceSnapshot> {
    const valid = project(input.projectId); if (!valid.ok) return valid;
    const voices = db.prepare('SELECT id FROM character_voice_current WHERE project_id=? ORDER BY rowid').all(input.projectId).map(row => currentVoice(input.projectId, row.id as string)).filter((value): value is CharacterVoiceRevision => !!value).filter(value => !input.entityId || value.entityRef.id === input.entityId);
    const snapshot = { libraryId: library.libraryId, projectId: input.projectId, voices, dialogues:currentDialogues(input.projectId,input.entityId), defaultBindings: bindings(input.projectId).filter(binding=>!input.entityId||binding.characterId===input.entityId) };
    return isCharacterVoiceSnapshot(snapshot) ? ok(snapshot) : fail('INVALID_STORED_DATA', '角色声音记录无效。');
  }
  function readVoice(input: { projectId: string; voiceRef: CreationRef }): Result<CharacterVoiceRevision> {
    const valid = project(input.projectId); if (!valid.ok) return valid;
    const value = voiceRevision(input.projectId, input.voiceRef);
    return value ? ok(value) : fail('REVISION_NOT_FOUND', '固定声音档案修订不存在。');
  }
  function saveDialogue(raw: SaveShotDialogueInput): Result<ShotDialogueRevision> {
    const parsed = parseSaveShotDialogue(raw); if (!parsed.ok) return parsed; const input = parsed.value;
    const validProject = project(input.projectId); if (!validProject.ok) return validProject;
    const snapshot = creation.read({ projectId: input.projectId }); if (!snapshot.ok) return snapshot;
    const shot = snapshot.value.shots.find(value => value.id === input.draft.shotRef.id && value.revision === input.draft.shotRef.revision);
    if (!shot) return fail('REVISION_CONFLICT', '镜头不存在或已有新修订。');
    const voices = listVoices({ projectId: input.projectId }); if (!voices.ok) return voices;
    const checked = validateDialogue(input.draft, { shot, characters: snapshot.value.entities, voices: input.draft.turns.flatMap(turn=>{const voice=voiceRevision(input.projectId,turn.voiceRef);return voice?[voice]:[];}) }); if (!checked.ok) return checked;
    const old = currentDialogue(input.projectId, shot.id);
    if ((old?.revision ?? 0) !== input.expectedRevision || old && input.id !== undefined && old.id !== input.id) return fail('REVISION_CONFLICT', '对白已有新修订。');
    const value: ShotDialogueRevision = { ...checked.value.draft, libraryId: library.libraryId, projectId: input.projectId, id: input.id ?? old?.id ?? randomUUID(), revision: input.expectedRevision + 1, createdAt: new Date().toISOString() };
    db.prepare('INSERT INTO shot_dialogue_revision VALUES(?,?,?,?,?)').run(value.id, value.revision, input.projectId, shot.id, JSON.stringify(value));
    db.prepare('INSERT INTO shot_dialogue_current(id,project_id,shot_id,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision').run(value.id, input.projectId, shot.id, value.revision);
    return ok(value);
  }
  function readDialogue(input: { projectId: string; shotId: string; revision?: number }): Result<ShotDialogueSnapshot> {
    const valid = project(input.projectId); if (!valid.ok) return valid;
    const revisions = db.prepare('SELECT data_json FROM shot_dialogue_revision WHERE project_id=? AND shot_id=? ORDER BY revision').all(input.projectId, input.shotId).map(row => JSON.parse(row.data_json as string)).filter(isShotDialogueRevision);
    const latest = currentDialogue(input.projectId, input.shotId) ?? null;
    const current = input.revision === undefined ? latest : revisions.find(value => value.revision === input.revision) ?? null;
    const voices = listVoices({ projectId: input.projectId }); if (!voices.ok) return voices;
    const issues = current?.turns.some(turn=>!voiceRevision(input.projectId,turn.voiceRef))?['VOICE_REFERENCE_MISSING']:current?.turns.some(turn=>currentVoice(input.projectId,turn.voiceRef.id)?.archived)?['VOICE_ARCHIVED']:[];
    const snapshot = { libraryId: library.libraryId, projectId: input.projectId, shotId: input.shotId, current, revisions, issues };
    return isShotDialogueSnapshot(snapshot) ? ok(snapshot) : fail('INVALID_STORED_DATA', '结构化对白记录无效。');
  }
  async function prepareReference(raw: PrepareVoiceReferenceInput) {
    const parsed = parsePrepareVoiceReference(raw); if (!parsed.ok) return parsed;
    const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    const voice = currentVoice(input.projectId, input.voiceRef.id);
    if (!voice || voice.revision !== input.voiceRef.revision) return fail('REVISION_CONFLICT', '角色声音已有新修订。');
    if(!voice.videoReference&&!voice.reference)return fail('VIDEO_REFERENCE_MISSING','请先选择视频声音参考样本。');
    return renders.inspectDerived({ projectId: input.projectId, references: [(voice.videoReference??voice.reference)!.ref], fps: { num: 30, den: 1 }, canvas: { width: 1080, height: 1080 }, executionOwner: input.executionOwner, runId: input.runId, voiceInput: { voiceRef: input.voiceRef, sourceInTicks: (voice.videoReference??voice.reference)!.sourceInTicks, durationTicks: (voice.videoReference??voice.reference)!.durationTicks } });
  }
  function bindings(projectId:string):CharacterVoiceBinding[]{return db.prepare('SELECT data_json FROM character_voice_binding b WHERE project_id=? AND revision=(SELECT MAX(revision) FROM character_voice_binding WHERE project_id=b.project_id AND character_id=b.character_id)').all(projectId).map(row=>JSON.parse(row.data_json as string)).filter(isCharacterVoiceBinding);}
  function bindDefault(raw:BindCharacterVoiceInput):Result<CharacterVoiceBinding>{
    const parsed=parseBindCharacterVoice(raw);if(!parsed.ok)return parsed;const input=parsed.value,valid=project(input.projectId);if(!valid.ok)return valid;
    const resolved=voiceInputResolver(library).usable(input.projectId,input.voiceRef);if(!resolved.ok)return resolved;const voice=resolved.value;if(voice.entityRef.id!==input.characterId)return fail('INVALID_VOICE_BINDING','声音不属于当前角色或已归档。');
    const current=bindings(input.projectId).find(b=>b.characterId===input.characterId);if((current?.revision??0)!==input.expectedRevision)return fail('REVISION_CONFLICT','角色默认声音已有新修订。');
    const value={libraryId:library.libraryId,projectId:input.projectId,characterId:input.characterId,voiceRef:input.voiceRef,revision:input.expectedRevision+1,updatedAt:new Date().toISOString()};db.prepare('INSERT INTO character_voice_binding VALUES(?,?,?,?)').run(input.projectId,input.characterId,value.revision,JSON.stringify(value));return ok(value);
  }
  function history(input:{projectId:string;entityId?:string}):Result<CharacterVoiceSnapshot>{const valid=project(input.projectId);if(!valid.ok)return valid;const voices=db.prepare('SELECT data_json FROM character_voice_revision WHERE project_id=? ORDER BY rowid').all(input.projectId).map(r=>JSON.parse(r.data_json as string)).filter(isCharacterVoiceRevision).filter(v=>!input.entityId||v.entityRef.id===input.entityId);return ok({libraryId:library.libraryId,projectId:input.projectId,voices,defaultBindings:bindings(input.projectId)});}
  function replaceDialogues(raw:ReplaceVoiceDialoguesInput):Result<ReplacedVoiceDialogues>{
    if(!db.isTransaction)return fail('TRANSACTION_REQUIRED','批量换声需要原子事务。');
    const parsed=parseReplaceVoiceDialogues(raw);if(!parsed.ok)return parsed;const input=parsed.value,valid=project(input.projectId);if(!valid.ok)return valid;
    const voice=voiceInputResolver(library).usable(input.projectId,input.voiceRef);if(!voice.ok)return voice;if(voice.value.entityRef.id!==input.characterId)return fail('INVALID_VOICE_BINDING','目标声音不属于所选角色。');
    const selected=[];for(const ref of input.dialogueRefs){const row=db.prepare('SELECT r.data_json FROM shot_dialogue_current c JOIN shot_dialogue_revision r ON r.id=c.id AND r.project_id=c.project_id AND r.revision=c.revision WHERE c.project_id=? AND c.id=? AND c.revision=?').get(input.projectId,ref.id,ref.revision),dialogue=row&&JSON.parse(row.data_json as string);if(!isShotDialogueRevision(dialogue))return fail('REVISION_CONFLICT','所选对白已有新修订。');if(!dialogue.turns.some(t=>t.characterRef.id===input.characterId))return fail('INVALID_DIALOGUE','所选对白没有此角色。');selected.push(dialogue);}
    const dialogues:ShotDialogueRevision[]=[];for(const dialogue of selected){const saved=saveDialogue({projectId:input.projectId,id:dialogue.id,expectedRevision:dialogue.revision,draft:{shotRef:dialogue.shotRef,turns:dialogue.turns.map(t=>t.characterRef.id===input.characterId?{...t,voiceRef:input.voiceRef}:t)}});if(!saved.ok)return saved;dialogues.push(saved.value);}
    return ok({libraryId:library.libraryId,projectId:input.projectId,dialogues});
  }
  return { replaceDialogues, bindDefault, history, saveVoice, list: listVoices, read: readVoice, saveDialogue, readDialogue, prepareReference };
}
