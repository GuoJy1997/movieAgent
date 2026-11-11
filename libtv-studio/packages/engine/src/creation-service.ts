import {MAX_TIMELINE_VIDEO_CLIPS} from '../../contracts/src/timeline-limits.ts';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { assetsFor } from './asset-service.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import {
  parseCreationBatch, parseCreationRead, parseCreationHistory, parseSelectShotOutput,
  isEntityRevision, isScriptRevision, isShotRevision, isShotOutputSelection, isCreationSnapshot, isCreationHistory,
  type CreationKind, type EntityRevision, type ScriptRevision, type ShotRevision, type CreationBatchResult,
  type CreationSnapshot, type CreationHistory, type CreationReadInput, type CreationHistoryInput,
  type SaveEntityInput, type SaveScriptInput, type SaveShotInput, type SelectShotOutputInput, type ShotOutputSelection,
} from '../../contracts/src/creation.ts';
import type { DialogueSelection } from '../../contracts/src/dialogue-production.ts';

type Revision = EntityRevision | ScriptRevision | ShotRevision;
const validators = { entity: isEntityRevision, script: isScriptRevision, shot: isShotRevision };

/** All mutation helpers participate in the caller's transaction. Never BEGIN/COMMIT here. */
export function creationFor(library: LibraryHandle, assets: ReturnType<typeof assetsFor>) {
  const db = library.db;
  function project(projectId: string): Result<void> {
    const own = library.checkOwnership(); if (!own.ok) return own;
    return db.prepare('SELECT 1 FROM project WHERE id=? AND library_id=?').get(projectId, library.libraryId) ? ok(undefined) : fail('PROJECT_NOT_FOUND', '当前资料库中没有此项目。');
  }
  function decode(kind: CreationKind, row: Record<string, unknown>): Revision {
    const value: unknown = JSON.parse(row.data_json as string);
    if (!validators[kind](value) || value.libraryId !== library.libraryId || value.projectId !== row.project_id || value.id !== row.id || value.revision !== row.revision) throw Error('INVALID_STORED_DATA');
    return value;
  }
  function current(kind: CreationKind, id: string): Revision | undefined {
    const row = db.prepare('SELECT r.* FROM creation_current c JOIN creation_revision r USING(kind,id,revision,project_id) WHERE c.kind=? AND c.id=?').get(kind, id);
    return row ? decode(kind, row) : undefined;
  }
  function fixedEntity(id: string, revision: number): EntityRevision | undefined {
    const row = db.prepare("SELECT * FROM creation_revision WHERE kind='entity' AND id=? AND revision=?").get(id, revision);
    return row ? decode('entity', row) as EntityRevision : undefined;
  }
  function list(kind: CreationKind, projectId: string): Revision[] {
    return db.prepare('SELECT r.* FROM creation_current c JOIN creation_revision r USING(kind,id,revision,project_id) WHERE c.kind=? AND c.project_id=? ORDER BY c.rowid').all(kind, projectId).map(row => decode(kind, row));
  }
  function selection(shotId: string): ShotOutputSelection | undefined {
    const row = db.prepare('SELECT * FROM shot_output_selection WHERE shot_id=?').get(shotId);
    if (!row) return undefined;
    const value: unknown = JSON.parse(row.data_json as string);
    if (!isShotOutputSelection(value) || value.libraryId !== library.libraryId || value.shotId !== row.shot_id || value.projectId !== row.project_id || value.selectionRevision !== row.selection_revision) throw Error('INVALID_STORED_DATA');
    return value;
  }
  function validateBatch(input: unknown): Result<CreationBatchResult> {
    const parsed = parseCreationBatch(input); if (!parsed.ok) return parsed;
    const batch = parsed.value, validProject = project(batch.projectId); if (!validProject.ok) return validProject;
    const createdAt = new Date().toISOString();
    const result: CreationBatchResult = { libraryId: library.libraryId, projectId: batch.projectId, entities: [], scripts: [], shots: [] };
    // Resolve CAS and construct every staged revision before checking cross-item references.
    for (const [kind, inputs, output] of [
      ['entity', batch.entities, result.entities], ['script', batch.scripts, result.scripts], ['shot', batch.shots, result.shots],
    ] as const) {
      for (const input of inputs) {
        const old = current(kind, input.id);
        if (old && old.projectId !== batch.projectId) return fail('WRONG_PROJECT', '此对象属于其他项目。');
        if ((old?.revision ?? 0) !== input.expectedRevision) return fail('REVISION_CONFLICT', '内容已有新修订，请刷新后重试。');
        const { expectedRevision, ...fields } = input;
        const value = { ...fields, libraryId: library.libraryId, revision: expectedRevision + 1, createdAt };
        if ('references' in input && input.references.some(r => r.libraryId !== library.libraryId) || 'entityRefs' in input && input.entityRefs.some(r => r.libraryId !== library.libraryId)) return fail('WRONG_LIBRARY', '固定引用属于其他资料库。');
        if ('entityRefs' in input && input.entityRefs.some(r => r.projectId !== batch.projectId)) return fail('WRONG_PROJECT', '实体引用属于其他项目。');
        if (!validators[kind](value)) return fail('INVALID_INPUT', '创作修订字段或大小无效。');
        // The tuple's kind determines its output list and has just validated its DTO.
        (output as Revision[]).push(value as Revision);
      }
    }
    for (const entity of result.entities) {
      for (const ref of entity.references) { const available = assets.assertSelectable(ref); if (!available.ok) return available; }
    }
    const scripts = new Map((list('script', batch.projectId) as ScriptRevision[]).map(s => [s.id, s]));
    for (const s of result.scripts) scripts.set(s.id, s);
    const shots = new Map((list('shot', batch.projectId) as ShotRevision[]).map(s => [s.id, s]));
    for (const s of result.shots) shots.set(s.id, s);
    for (const shot of result.shots) {
      const script = scripts.get(shot.scriptId);
      if (!script) {
        const elsewhere = current('script', shot.scriptId);
        return fail(elsewhere ? 'WRONG_PROJECT' : 'SCRIPT_NOT_FOUND', '镜头的剧本不存在于此项目。');
      }
      if (!script.scenes.some(s => s.id === shot.sceneId)) return fail('SCENE_NOT_FOUND', '镜头引用的场景不存在。');
      for (const ref of shot.entityRefs) {
        if (ref.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '实体引用属于其他资料库。');
        if (ref.projectId !== batch.projectId) return fail('WRONG_PROJECT', '实体引用属于其他项目。');
        const entity = result.entities.find(e => e.id === ref.entityId && e.revision === ref.revision) ?? fixedEntity(ref.entityId, ref.revision);
        if (!entity) return fail('ENTITY_NOT_FOUND', '固定实体修订不存在。');
        if (entity.projectId !== batch.projectId) return fail('WRONG_PROJECT', '实体引用属于其他项目。');
      }
    }
    // Validate final state, including untouched shots, so scene removal cannot orphan them.
    for (const script of result.scripts) {
      if ([...shots.values()].some(s => s.scriptId === script.id && !script.scenes.some(scene => scene.id === s.sceneId))) return fail('SCENE_IN_USE', '场景仍被镜头引用，请先调整镜头。');
    }
    const counts = new Map<string, number>();
    for (const shot of shots.values()) { const n = (counts.get(shot.scriptId) ?? 0) + 1; if (n > MAX_TIMELINE_VIDEO_CLIPS) return fail('SHOT_LIMIT', '每个剧本最多'+MAX_TIMELINE_VIDEO_CLIPS+'个镜头。'); counts.set(shot.scriptId, n); }
    return ok(result);
  }
  function applyBatch(input: unknown): Result<CreationBatchResult> {
    const own = library.checkOwnership(); if (!own.ok) return own;
    if (!db.isTransaction) return fail('TRANSACTION_REQUIRED', '创作写入必须在调用方事务内进行。');
    // Revalidate immediately before writes; no cached validation tokens can bypass CAS.
    const checked = validateBatch(input); if (!checked.ok) return checked;
    for (const [kind, values] of [['entity', checked.value.entities], ['script', checked.value.scripts], ['shot', checked.value.shots]] as const) {
      for (const value of values) {
        db.prepare('INSERT INTO creation_revision(kind,id,revision,project_id,data_json) VALUES(?,?,?,?,?)').run(kind, value.id, value.revision, value.projectId, JSON.stringify(value));
        db.prepare('INSERT INTO creation_current(kind,id,revision,project_id) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision').run(kind, value.id, value.revision, value.projectId);
      }
    }
    return checked;
  }
  function saveEntity(input: SaveEntityInput): Result<EntityRevision> { const r = applyBatch({ projectId: input.projectId, entities: [input], scripts: [], shots: [] }); return r.ok ? ok(r.value.entities[0]!) : r; }
  function saveScript(input: SaveScriptInput): Result<ScriptRevision> { const r = applyBatch({ projectId: input.projectId, entities: [], scripts: [input], shots: [] }); return r.ok ? ok(r.value.scripts[0]!) : r; }
  function saveShot(input: SaveShotInput): Result<ShotRevision> { const r = applyBatch({ projectId: input.projectId, entities: [], scripts: [], shots: [input] }); return r.ok ? ok(r.value.shots[0]!) : r; }
  function selectOutput(input: SelectShotOutputInput, dialogue?: DialogueSelection): Result<ShotOutputSelection> {
    const parsed = parseSelectShotOutput(input); if (!parsed.ok) return parsed;
    const validProject = project(input.projectId); if (!validProject.ok) return validProject;
    if (!db.isTransaction) return fail('TRANSACTION_REQUIRED', '选择输出必须在调用方事务内进行。');
    const shot = current('shot', input.shotId);
    if (!shot) return fail('SHOT_NOT_FOUND', '镜头不存在。');
    if (shot.projectId !== input.projectId) return fail('WRONG_PROJECT', '镜头属于其他项目。');
    if (shot.revision !== input.expectedRevision) return fail('REVISION_CONFLICT', '镜头已有新修订，结果保留供重新选择。');
    const old = selection(input.shotId);
    if ((old?.selectionRevision ?? 0) !== input.expectedSelectionRevision) return fail('SELECTION_CONFLICT', '输出选择已经改变，不能覆盖后来的选择。');
    if (input.reference) {
      const metadata = assets.assertSelectable(input.reference); if (!metadata.ok) return metadata;
      if (!metadata.value.mime.startsWith(`${input.role}/`)) return fail('INVALID_MEDIA_TYPE', '输出的媒体类型与用途不符。');
    }
    const value: ShotOutputSelection = { libraryId: library.libraryId, projectId: input.projectId, shotId: input.shotId, shotRevision: shot.revision, selectionRevision: input.expectedSelectionRevision + 1, image: old?.image ?? null, video: old?.video ?? null, updatedAt: new Date().toISOString(), [input.role]: input.reference, ...(dialogue ? { dialogue } : {}) };
    const json = JSON.stringify(value);
    db.prepare('INSERT INTO shot_output_selection_history(shot_id,selection_revision,project_id,data_json) VALUES(?,?,?,?)').run(value.shotId, value.selectionRevision, value.projectId, json);
    db.prepare('INSERT INTO shot_output_selection(shot_id,selection_revision,project_id,data_json) VALUES(?,?,?,?) ON CONFLICT(shot_id) DO UPDATE SET selection_revision=excluded.selection_revision,data_json=excluded.data_json').run(value.shotId, value.selectionRevision, value.projectId, json);
    db.prepare('DELETE FROM dialogue_selection WHERE shot_id=?').run(input.shotId);
    return ok(value);
  }
  function read(input: CreationReadInput): Result<CreationSnapshot> {
    const parsed = parseCreationRead(input); if (!parsed.ok) return parsed;
    const validProject = project(input.projectId); if (!validProject.ok) return validProject;
    try {
      if (input.scriptId) { const s = current('script', input.scriptId); if (!s) return fail('SCRIPT_NOT_FOUND', '剧本不存在。'); if (s.projectId !== input.projectId) return fail('WRONG_PROJECT', '剧本属于其他项目。'); }
      const shots = (list('shot', input.projectId) as ShotRevision[]).filter(s => !input.scriptId || s.scriptId === input.scriptId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const value: CreationSnapshot = { libraryId: library.libraryId, projectId: input.projectId, entities: list('entity', input.projectId) as EntityRevision[], scripts: (list('script', input.projectId) as ScriptRevision[]).filter(s => !input.scriptId || s.id === input.scriptId), shots, selections: shots.flatMap(s => { const selected = selection(s.id); return selected ? [selected] : []; }), snapshotSeq: Number(db.prepare('SELECT coalesce(max(seq),0) AS seq FROM domain_event').get()!.seq) };
      return isCreationSnapshot(value) ? ok(value) : fail('INVALID_STORED_DATA', '创作快照无效。');
    } catch { return fail('INVALID_STORED_DATA', '无法读取创作快照。'); }
  }
  function history(input: CreationHistoryInput): Result<CreationHistory> {
    const parsed = parseCreationHistory(input); if (!parsed.ok) return parsed;
    const validProject = project(input.projectId); if (!validProject.ok) return validProject;
    try {
      const latest = current(input.kind, input.id);
      if (!latest) return fail('CREATION_NOT_FOUND', '创作对象不存在。');
      if (latest.projectId !== input.projectId) return fail('WRONG_PROJECT', '创作对象属于其他项目。');
      const revisions = db.prepare('SELECT * FROM creation_revision WHERE kind=? AND id=? AND project_id=? ORDER BY revision').all(input.kind, input.id, input.projectId).map(r => decode(input.kind, r));
      const value = { libraryId: library.libraryId, ...input, revisions };
      return isCreationHistory(value) ? ok(value) : fail('INVALID_STORED_DATA', '创作历史无效。');
    } catch { return fail('INVALID_STORED_DATA', '无法读取创作历史。'); }
  }
  return { saveEntity, saveScript, saveShot, selectOutput, read, history, validateBatch, applyBatch };
}
