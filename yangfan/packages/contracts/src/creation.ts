import { isMediaReference, type MediaReference } from './assets.ts';
import { fail, isRecord, ok, type Result } from './result.ts';
import { isDialogueSelection, type DialogueSelection } from './dialogue-production.ts';

export interface CreationRef { id: string; revision: number }
export type CreationKind = 'entity' | 'script' | 'shot';
export type EntityKind = 'character' | 'scene' | 'prop' | 'style';
export interface EntityRef { libraryId: string; projectId: string; entityId: string; revision: number }
interface SaveBase { projectId: string; id: string; expectedRevision: number }
export interface SaveEntityInput extends SaveBase { kind: EntityKind; name: string; description: string; constraints: string; references: MediaReference[] }
export interface ScriptScene { id: string; title: string; location: string; time: string; description: string }
export interface SaveScriptInput extends SaveBase { title: string; synopsis: string; body: string; scenes: ScriptScene[] }
export interface SaveShotInput extends SaveBase {
  scriptId: string; sceneId: string; order: number; title: string; durationSeconds: number;
  shotSize: string; cameraMovement: string; subject: string; action: string; dialogue: string; sound: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3'; prompt: string; entityRefs: EntityRef[];
}
interface RevisionBase { libraryId: string; projectId: string; id: string; revision: number; createdAt: string }
export interface EntityRevision extends RevisionBase, Omit<SaveEntityInput, keyof SaveBase> {}
export interface ScriptRevision extends RevisionBase, Omit<SaveScriptInput, keyof SaveBase> {}
export interface ShotRevision extends RevisionBase, Omit<SaveShotInput, keyof SaveBase> {}
export interface SelectShotOutputInput { projectId: string; shotId: string; expectedRevision: number; expectedSelectionRevision: number; role: 'image' | 'video'; reference: MediaReference | null }
export interface ShotOutputSelection { libraryId: string; projectId: string; shotId: string; shotRevision: number; selectionRevision: number; image: MediaReference | null; video: MediaReference | null; updatedAt: string; dialogue?: DialogueSelection }
export interface CreationReadInput { projectId: string; scriptId?: string }
export interface CreationHistoryInput { projectId: string; kind: CreationKind; id: string }
export interface CreationSnapshot { libraryId: string; projectId: string; entities: EntityRevision[]; scripts: ScriptRevision[]; shots: ShotRevision[]; selections: ShotOutputSelection[]; snapshotSeq: number }
export type CreationHistory = { libraryId: string; projectId: string; id: string } & (
  { kind: 'entity'; revisions: EntityRevision[] } | { kind: 'script'; revisions: ScriptRevision[] } | { kind: 'shot'; revisions: ShotRevision[] });
/** Engine-owned normalized changes. IDs and expected revisions must come from trusted captured targets. */
export interface CreationBatch { projectId: string; entities: SaveEntityInput[]; scripts: SaveScriptInput[]; shots: SaveShotInput[] }
export interface CreationBatchResult { libraryId: string; projectId: string; entities: EntityRevision[]; scripts: ScriptRevision[]; shots: ShotRevision[] }

const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
const text = (v: unknown, max: number, required = false): v is string => typeof v === 'string' && v.length <= max && (!required || v.trim().length > 0);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).length === allowed.length && Object.keys(v).every(k => allowed.includes(k));
const bounded = (v: unknown): boolean => { try { return new TextEncoder().encode(JSON.stringify(v)).byteLength <= 256 * 1024; } catch { return false; } };
const fixedMedia = (v: unknown): v is MediaReference => isMediaReference(v) && keys(v as unknown as Record<string, unknown>, v.kind === 'artifact' ? ['kind', 'libraryId', 'artifactId'] : ['kind', 'libraryId', 'assetId', 'version']);
const baseKeys = ['projectId', 'id', 'expectedRevision'];
const entityKeys = ['kind', 'name', 'description', 'constraints', 'references'];
const scriptKeys = ['title', 'synopsis', 'body', 'scenes'];
const shotKeys = ['scriptId', 'sceneId', 'order', 'title', 'durationSeconds', 'shotSize', 'cameraMovement', 'subject', 'action', 'dialogue', 'sound', 'aspectRatio', 'prompt', 'entityRefs'];
const revisionKeys = ['libraryId', 'projectId', 'id', 'revision', 'createdAt'];
const base = (v: Record<string, unknown>) => id(v.projectId) && id(v.id) && integer(v.expectedRevision);
export function isEntityRef(v: unknown): v is EntityRef { return isRecord(v) && keys(v, ['libraryId', 'projectId', 'entityId', 'revision']) && id(v.libraryId) && id(v.projectId) && id(v.entityId) && integer(v.revision, 1); }
function entityFields(v: Record<string, unknown>): boolean {
  return ['character', 'scene', 'prop', 'style'].includes(v.kind as string) && text(v.name, 200, true) && text(v.description, 8000) && text(v.constraints, 8000) && Array.isArray(v.references) && v.references.length <= 4 && v.references.every(fixedMedia);
}
function scene(v: unknown): v is ScriptScene { return isRecord(v) && keys(v, ['id', 'title', 'location', 'time', 'description']) && id(v.id) && text(v.title, 200, true) && ['location', 'time', 'description'].every(k => text(v[k], 2000)); }
function scriptFields(v: Record<string, unknown>): boolean {
  return text(v.title, 200, true) && text(v.synopsis, 4000) && text(v.body, 64000) && Array.isArray(v.scenes) && v.scenes.length <= 32 && v.scenes.every(scene) && new Set(v.scenes.map(s => s.id)).size === v.scenes.length;
}
function shotFields(v: Record<string, unknown>): boolean {
  return id(v.scriptId) && id(v.sceneId) && integer(v.order) && text(v.title, 200, true) && integer(v.durationSeconds, 1) && v.durationSeconds <= 120 && ['shotSize', 'cameraMovement', 'subject', 'action', 'dialogue', 'sound'].every(k => text(v[k], 2000)) && ['16:9', '9:16', '1:1', '4:3'].includes(v.aspectRatio as string) && text(v.prompt, 8000) && Array.isArray(v.entityRefs) && v.entityRefs.length <= 8 && v.entityRefs.every(isEntityRef) && new Set(v.entityRefs.map(r => `${r.libraryId}/${r.projectId}/${r.entityId}/${r.revision}`)).size === v.entityRefs.length;
}
export function parseSaveEntity(v: unknown): Result<SaveEntityInput> { return isRecord(v) && bounded(v) && keys(v, [...baseKeys, ...entityKeys]) && base(v) && entityFields(v) ? ok(structuredClone(v) as unknown as SaveEntityInput) : fail('INVALID_INPUT', '实体字段或大小无效。'); }
export function parseSaveScript(v: unknown): Result<SaveScriptInput> { return isRecord(v) && bounded(v) && keys(v, [...baseKeys, ...scriptKeys]) && base(v) && scriptFields(v) ? ok(structuredClone(v) as unknown as SaveScriptInput) : fail('INVALID_INPUT', '剧本字段、场景或大小无效。'); }
export function parseSaveShot(v: unknown): Result<SaveShotInput> { return isRecord(v) && bounded(v) && keys(v, [...baseKeys, ...shotKeys]) && base(v) && shotFields(v) ? ok(structuredClone(v) as unknown as SaveShotInput) : fail('INVALID_INPUT', '镜头字段、引用或大小无效。'); }
export function parseSelectShotOutput(v: unknown): Result<SelectShotOutputInput> {
  return isRecord(v) && bounded(v) && keys(v, ['projectId', 'shotId', 'expectedRevision', 'expectedSelectionRevision', 'role', 'reference']) && id(v.projectId) && id(v.shotId) && integer(v.expectedRevision, 1) && integer(v.expectedSelectionRevision) && ['image', 'video'].includes(v.role as string) && (v.reference === null || fixedMedia(v.reference)) ? ok(structuredClone(v) as unknown as SelectShotOutputInput) : fail('INVALID_INPUT', '请选择明确的镜头修订、选择版本和固定媒体。');
}
export function parseCreationRead(v: unknown): Result<CreationReadInput> { return isRecord(v) && Object.keys(v).every(k => ['projectId', 'scriptId'].includes(k)) && id(v.projectId) && (v.scriptId === undefined || id(v.scriptId)) ? ok(v as unknown as CreationReadInput) : fail('INVALID_INPUT', '创作查询参数无效。'); }
export function parseCreationHistory(v: unknown): Result<CreationHistoryInput> { return isRecord(v) && keys(v, ['projectId', 'kind', 'id']) && id(v.projectId) && id(v.id) && ['entity', 'script', 'shot'].includes(v.kind as string) ? ok(v as unknown as CreationHistoryInput) : fail('INVALID_INPUT', '创作历史参数无效。'); }
export function parseCreationBatch(v: unknown): Result<CreationBatch> {
  if (!isRecord(v) || !bounded(v) || !keys(v, ['projectId', 'entities', 'scripts', 'shots']) || !id(v.projectId)) return fail('INVALID_INPUT', '创作批次参数无效。');
  for (const [key, parser] of [['entities', parseSaveEntity], ['scripts', parseSaveScript], ['shots', parseSaveShot]] as const) {
    const list = v[key]; if (!Array.isArray(list) || list.length > 64 || list.some(x => !parser(x).ok || x.projectId !== v.projectId) || new Set(list.map(x => x.id)).size !== list.length) return fail('INVALID_INPUT', '创作批次字段、项目或重复目标无效。');
  }
  return ok(structuredClone(v) as unknown as CreationBatch);
}
const revisionBase = (v: Record<string, unknown>) => id(v.libraryId) && id(v.projectId) && id(v.id) && integer(v.revision, 1) && typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt));
export function isEntityRevision(v: unknown): v is EntityRevision { return isRecord(v) && bounded(v) && keys(v, [...revisionKeys, ...entityKeys]) && revisionBase(v) && entityFields(v) && (v.references as MediaReference[]).every(r => r.libraryId === v.libraryId); }
export function isScriptRevision(v: unknown): v is ScriptRevision { return isRecord(v) && bounded(v) && keys(v, [...revisionKeys, ...scriptKeys]) && revisionBase(v) && scriptFields(v); }
export function isShotRevision(v: unknown): v is ShotRevision { return isRecord(v) && bounded(v) && keys(v, [...revisionKeys, ...shotKeys]) && revisionBase(v) && shotFields(v) && (v.entityRefs as EntityRef[]).every(r => r.libraryId === v.libraryId && r.projectId === v.projectId); }
export function isShotOutputSelection(v: unknown): v is ShotOutputSelection {
  if (!isRecord(v)) return false; const { dialogue, ...base } = v;
  return keys(base, ['libraryId', 'projectId', 'shotId', 'shotRevision', 'selectionRevision', 'image', 'video', 'updatedAt']) && id(v.libraryId) && id(v.projectId) && id(v.shotId) && integer(v.shotRevision, 1) && integer(v.selectionRevision, 1) && [v.image, v.video].every(r => r === null || fixedMedia(r) && r.libraryId === v.libraryId) && typeof v.updatedAt === 'string' && Number.isFinite(Date.parse(v.updatedAt)) && (dialogue === undefined || isDialogueSelection(dialogue) && dialogue.shotId === v.shotId && dialogue.selectionRevision === v.selectionRevision);
}
export function isCreationSnapshot(v: unknown): v is CreationSnapshot {
  if (!isRecord(v) || !keys(v, ['libraryId', 'projectId', 'entities', 'scripts', 'shots', 'selections', 'snapshotSeq']) || !id(v.libraryId) || !id(v.projectId) || !integer(v.snapshotSeq)) return false;
  return [[v.entities, isEntityRevision], [v.scripts, isScriptRevision], [v.shots, isShotRevision], [v.selections, isShotOutputSelection]].every(([list, check]) => Array.isArray(list) && list.every(x => (check as (v: unknown) => boolean)(x) && x.libraryId === v.libraryId && x.projectId === v.projectId));
}
export function isCreationHistory(v: unknown): v is CreationHistory {
  if (!isRecord(v) || !keys(v, ['libraryId', 'projectId', 'id', 'kind', 'revisions']) || !id(v.libraryId) || !id(v.projectId) || !id(v.id) || !Array.isArray(v.revisions) || !['entity', 'script', 'shot'].includes(v.kind as string)) return false;
  const check = v.kind === 'entity' ? isEntityRevision : v.kind === 'script' ? isScriptRevision : isShotRevision;
  return v.revisions.length > 0 && v.revisions.every((x, i) => check(x) && x.libraryId === v.libraryId && x.projectId === v.projectId && x.id === v.id && x.revision === i + 1);
}
