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
    const reference = input.draft.reference;
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
  function saveVoice(raw: SaveCharacterVoiceInput): Result<CharacterVoiceRevision> {
    const parsed = parseSaveCharacterVoice(raw); if (!parsed.ok) return parsed; const input = parsed.value;
    const validProject = project(input.projectId); if (!validProject.ok) return validProject;
    const snapshot = creation.read({ projectId: input.projectId }); if (!snapshot.ok) return snapshot;
    const entity = snapshot.value.entities.find(value => value.id === input.draft.entityRef.id && value.revision === input.draft.entityRef.revision && value.kind === 'character');
    if (!entity) return fail('REVISION_CONFLICT', '角色不存在或已有新修订。');
    const id = input.id ?? randomUUID();
    if ((currentVoice(input.projectId, id)?.revision ?? 0) !== input.expectedRevision) return fail('REVISION_CONFLICT', '声音档案已有新修订。');
    if (input.draft.ttsProfileRef) {
      const ref = input.draft.ttsProfileRef;
      if (ref.libraryId !== library.libraryId || db.prepare('SELECT MAX(revision) AS revision FROM profile_revision WHERE id=? AND library_id=?').get(ref.id, library.libraryId)?.revision !== ref.revision) return fail('CONFIG_CHANGED', '配音预设已有新修订。');
    }
    const checked = production(input); if (!checked.ok) return checked;
    const value: CharacterVoiceRevision = { ...structuredClone(input.draft), libraryId: library.libraryId, projectId: input.projectId, id, revision: input.expectedRevision + 1, production: checked.value, createdAt: new Date().toISOString() };
    db.prepare('INSERT INTO character_voice_revision VALUES(?,?,?,?,?)').run(id, value.revision, input.projectId, entity.id, JSON.stringify(value));
    db.prepare('INSERT INTO character_voice_current(id,project_id,entity_id,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision').run(id, input.projectId, entity.id, value.revision);
    db.prepare('INSERT INTO character_voice_media VALUES(?,?,?,?,?,?)').run(id, value.revision, input.projectId, JSON.stringify(value.reference.ref), value.reference.hash, value.reference.probeId);
    return ok(value);
  }
  function listVoices(input: { projectId: string; entityId?: string }): Result<CharacterVoiceSnapshot> {
    const valid = project(input.projectId); if (!valid.ok) return valid;
    const voices = db.prepare('SELECT id FROM character_voice_current WHERE project_id=? ORDER BY rowid').all(input.projectId).map(row => currentVoice(input.projectId, row.id as string)).filter((value): value is CharacterVoiceRevision => !!value).filter(value => !input.entityId || value.entityRef.id === input.entityId);
    const snapshot = { libraryId: library.libraryId, projectId: input.projectId, voices };
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
    const checked = validateDialogue(input.draft, { shot, characters: snapshot.value.entities, voices: voices.value.voices }); if (!checked.ok) return checked;
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
    const issues = current?.turns.some(turn => !voices.value.voices.some(voice => voice.id === turn.voiceRef.id && voice.revision === turn.voiceRef.revision)) ? ['VOICE_REVISION_STALE'] : [];
    const snapshot = { libraryId: library.libraryId, projectId: input.projectId, shotId: input.shotId, current, revisions, issues };
    return isShotDialogueSnapshot(snapshot) ? ok(snapshot) : fail('INVALID_STORED_DATA', '结构化对白记录无效。');
  }
  async function prepareReference(raw: PrepareVoiceReferenceInput) {
    const parsed = parsePrepareVoiceReference(raw); if (!parsed.ok) return parsed;
    const input = parsed.value, valid = project(input.projectId); if (!valid.ok) return valid;
    const voice = currentVoice(input.projectId, input.voiceRef.id);
    if (!voice || voice.revision !== input.voiceRef.revision) return fail('REVISION_CONFLICT', '角色声音已有新修订。');
    return renders.inspectDerived({ projectId: input.projectId, references: [voice.reference.ref], fps: { num: 30, den: 1 }, canvas: { width: 1080, height: 1080 }, executionOwner: input.executionOwner, runId: input.runId, voiceInput: { voiceRef: input.voiceRef, sourceInTicks: voice.reference.sourceInTicks, durationTicks: voice.reference.durationTicks } });
  }
  return { saveVoice, list: listVoices, read: readVoice, saveDialogue, readDialogue, prepareReference };
}
