import { isMediaReference, type MediaReference } from './assets.ts';
import { isRevisionRef, type RevisionRef } from './models.ts';
import type { CreationRef } from './creation.ts';
import { fail, isRecord, ok, type Result } from './result.ts';

export type DialogueRoute = 'native-reference' | 'dubbed-lipsync' | 'voiceover';
export type DialogueEmotion = 'calm' | 'excited' | 'quiet' | 'exchange';
export interface VoiceReference { ref: MediaReference; hash: string; probeId: string | null; sourceInTicks: number; durationTicks: number }
export interface CharacterVoiceDraft { entityRef: CreationRef; name: string; dialect: string; performanceNotes: string; reference: VoiceReference | null; ttsProfileRef?: RevisionRef; sourceKind?: 'sample' | 'provider-voice' | 'cloned-voice'; language?: string; timbreDescription?: string; sourceSample?: VoiceReference; videoReference?: VoiceReference; baselineAudio?: VoiceReference; ttsBinding?: VoiceTTSBinding; archived?: boolean }
export interface VoiceTTSBinding { providerVoiceId: string; connectionRef: RevisionRef; modelRef: RevisionRef; profileRef: RevisionRef; voiceOrigin: 'system' | 'custom' | 'cloned'; cloneJobId?: string }
export interface CharacterVoiceBinding { libraryId: string; projectId: string; characterId: string; voiceRef: CreationRef; revision: number; updatedAt: string }
export interface BindCharacterVoiceInput { projectId: string; characterId: string; voiceRef: CreationRef; expectedRevision: number }
export interface VoiceProduction { ready: boolean; reason: string | null }
export interface CharacterVoiceRevision extends CharacterVoiceDraft { libraryId: string; projectId: string; id: string; revision: number; production: VoiceProduction; createdAt: string }
export interface SaveCharacterVoiceInput { projectId: string; id?: string; expectedRevision: number; draft: CharacterVoiceDraft }
export interface CharacterVoiceSnapshot { libraryId: string; projectId: string; voices: CharacterVoiceRevision[]; defaultBindings?: CharacterVoiceBinding[]; dialogues?:ShotDialogueRevision[] }
export interface DialogueTurn { turnId: string; characterRef: CreationRef; voiceRef: CreationRef; text: string; emotion: DialogueEmotion; startTicks: number; durationTicks: number; mode: DialogueRoute }
export interface ShotDialogueDraft { shotRef: CreationRef; turns: DialogueTurn[] }
export interface ShotDialogueRevision extends ShotDialogueDraft { libraryId: string; projectId: string; id: string; revision: number; createdAt: string }
export interface SaveShotDialogueInput { projectId: string; id?: string; expectedRevision: number; draft: ShotDialogueDraft }
export interface ShotDialogueSnapshot { libraryId: string; projectId: string; shotId: string; current: ShotDialogueRevision | null; revisions: ShotDialogueRevision[]; issues: string[] }

const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const exact = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
const ref = (v: unknown): v is CreationRef => isRecord(v) && exact(v, ['id', 'revision']) && id(v.id) && integer(v.revision, 1);
const text = (v: unknown, max: number, required = false) => typeof v === 'string' && v.length <= max && (!required || v.trim().length > 0) && !/[\u0000\u007f]/.test(v);
const media = (v: unknown): v is MediaReference => isMediaReference(v) && Object.keys(v).length === (v.kind === 'artifact' ? 3 : 4);
export function isVoiceReference(v: unknown): v is VoiceReference {
  return isRecord(v) && exact(v, ['ref', 'hash', 'probeId', 'sourceInTicks', 'durationTicks']) && media(v.ref) && typeof v.hash === 'string' && /^[a-f0-9]{64}$/.test(v.hash) && (v.probeId === null || id(v.probeId)) && integer(v.sourceInTicks) && integer(v.durationTicks, 1) && (v.sourceInTicks as number) + (v.durationTicks as number) <= 600 * 48000;
}
export function isVoiceTTSBinding(v: unknown): v is VoiceTTSBinding {
  return isRecord(v) && exact(v, ['providerVoiceId','connectionRef','modelRef','profileRef','voiceOrigin'], ['cloneJobId']) && text(v.providerVoiceId,256,true) && !/[\u0000-\u001f\u007f]/.test(v.providerVoiceId as string) && isRevisionRef(v.connectionRef) && isRevisionRef(v.modelRef) && isRevisionRef(v.profileRef) && ['system','custom','cloned'].includes(v.voiceOrigin as string) && (v.cloneJobId===undefined||id(v.cloneJobId));
}
export function isCharacterVoiceDraft(v: unknown): v is CharacterVoiceDraft {
  if (!isRecord(v) || !exact(v, ['entityRef','name','dialect','performanceNotes','reference'], ['ttsProfileRef','sourceKind','language','timbreDescription','sourceSample','videoReference','baselineAudio','ttsBinding','archived'])) return false;
  return ref(v.entityRef) && text(v.name,200,true) && text(v.dialect,200) && text(v.performanceNotes,8000) && (v.reference===null||isVoiceReference(v.reference)) && (v.ttsProfileRef===undefined||isRevisionRef(v.ttsProfileRef)) && (v.ttsBinding===undefined||isVoiceTTSBinding(v.ttsBinding)) && (v.reference!==null||v.ttsBinding!==undefined||v.sourceSample!==undefined||v.videoReference!==undefined) && (v.sourceKind===undefined||['sample','provider-voice','cloned-voice'].includes(v.sourceKind as string)) && (v.language===undefined||text(v.language,200)) && (v.timbreDescription===undefined||text(v.timbreDescription,2000)) && ['sourceSample','videoReference','baselineAudio'].every(k=>v[k]===undefined||isVoiceReference(v[k])) && (v.archived===undefined||typeof v.archived==='boolean');
}
export function isCharacterVoiceBinding(v: unknown): v is CharacterVoiceBinding {
  return isRecord(v) && exact(v,['libraryId','projectId','characterId','voiceRef','revision','updatedAt']) && id(v.libraryId) && id(v.projectId) && id(v.characterId) && ref(v.voiceRef) && integer(v.revision,1) && typeof v.updatedAt==='string' && Number.isFinite(Date.parse(v.updatedAt));
}
export function parseBindCharacterVoice(v: unknown): Result<BindCharacterVoiceInput> {
  return isRecord(v) && exact(v,['projectId','characterId','voiceRef','expectedRevision']) && id(v.projectId) && id(v.characterId) && ref(v.voiceRef) && integer(v.expectedRevision) ? ok(structuredClone(v) as unknown as BindCharacterVoiceInput) : fail('INVALID_INPUT','角色默认声音绑定无效。');
}
export function isDialogueTurn(v: unknown): v is DialogueTurn {
  return isRecord(v) && exact(v, ['turnId', 'characterRef', 'voiceRef', 'text', 'emotion', 'startTicks', 'durationTicks', 'mode']) && id(v.turnId) && ref(v.characterRef) && ref(v.voiceRef) && text(v.text, 4000, true) && ['calm', 'excited', 'quiet', 'exchange'].includes(v.emotion as string) && integer(v.startTicks) && integer(v.durationTicks, 1) && ['native-reference', 'dubbed-lipsync', 'voiceover'].includes(v.mode as string);
}
export function isShotDialogueDraft(v: unknown): v is ShotDialogueDraft {
  return isRecord(v) && exact(v, ['shotRef', 'turns']) && ref(v.shotRef) && Array.isArray(v.turns) && v.turns.length > 0 && v.turns.length <= 16 && v.turns.every(isDialogueTurn) && new Set(v.turns.map(t => t.turnId)).size === v.turns.length && v.turns.reduce((sum, turn) => sum + Array.from(turn.text).length, 0) <= 16000;
}
function parseSave<T>(v: unknown, kind: 'voice' | 'dialogue'): Result<T> {
  const validDraft = kind === 'voice' ? isCharacterVoiceDraft : isShotDialogueDraft;
  return isRecord(v) && exact(v, ['projectId', 'expectedRevision', 'draft'], ['id']) && id(v.projectId) && (v.id === undefined || id(v.id)) && integer(v.expectedRevision) && validDraft(v.draft) ? ok(structuredClone(v) as T) : fail('INVALID_INPUT', kind === 'voice' ? '角色声音档案无效。' : '结构化对白无效。');
}
export const parseSaveCharacterVoice = (v: unknown): Result<SaveCharacterVoiceInput> => parseSave(v, 'voice');
export const parseSaveShotDialogue = (v: unknown): Result<SaveShotDialogueInput> => parseSave(v, 'dialogue');
export function isCharacterVoiceRevision(v: unknown): v is CharacterVoiceRevision {
  if(!isRecord(v))return false;
  const {libraryId,projectId,id:voiceId,revision,createdAt,production,...draft}=v;
  return id(libraryId)&&id(projectId)&&id(voiceId)&&integer(revision,1)&&typeof createdAt==='string'&&Number.isFinite(Date.parse(createdAt))&&isCharacterVoiceDraft(draft)&&isRecord(production)&&exact(production,['ready','reason'])&&typeof production.ready==='boolean'&&(production.reason===null||typeof production.reason==='string');
}
export function isCharacterVoiceSnapshot(v: unknown): v is CharacterVoiceSnapshot {
  return isRecord(v)&&exact(v,['libraryId','projectId','voices'],['defaultBindings','dialogues'])&&id(v.libraryId)&&id(v.projectId)&&Array.isArray(v.voices)&&v.voices.every(voice=>isCharacterVoiceRevision(voice)&&voice.libraryId===v.libraryId&&voice.projectId===v.projectId)&&(v.dialogues===undefined||Array.isArray(v.dialogues)&&v.dialogues.every(d=>isShotDialogueRevision(d)&&d.libraryId===v.libraryId&&d.projectId===v.projectId))&&(v.defaultBindings===undefined||Array.isArray(v.defaultBindings)&&v.defaultBindings.every(binding=>isCharacterVoiceBinding(binding)&&binding.libraryId===v.libraryId&&binding.projectId===v.projectId));
}
export function isShotDialogueRevision(v: unknown): v is ShotDialogueRevision {
  return isRecord(v) && exact(v, ['libraryId', 'projectId', 'id', 'revision', 'createdAt', 'shotRef', 'turns']) && id(v.libraryId) && id(v.projectId) && id(v.id) && integer(v.revision, 1) && typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt)) && isShotDialogueDraft({ shotRef: v.shotRef, turns: v.turns });
}
export function isShotDialogueSnapshot(v: unknown): v is ShotDialogueSnapshot {
  return isRecord(v) && exact(v, ['libraryId', 'projectId', 'shotId', 'current', 'revisions', 'issues']) && id(v.libraryId) && id(v.projectId) && id(v.shotId) && (v.current === null || isShotDialogueRevision(v.current)) && Array.isArray(v.revisions) && v.revisions.every(isShotDialogueRevision) && Array.isArray(v.issues) && v.issues.every(issue => typeof issue === 'string');
}
export interface VoiceExportInput { projectId: string; voiceRef: CreationRef; requestId: string }
export interface VoiceExportReceipt { requestId: string; projectId: string; voiceRef: CreationRef; relativePath: string; hash: string; byteLength: number }
export function parseVoiceExport(v: unknown): Result<VoiceExportInput> { return isRecord(v) && exact(v, ['projectId', 'voiceRef', 'requestId']) && id(v.projectId) && ref(v.voiceRef) && typeof v.requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v.requestId) ? ok(structuredClone(v) as unknown as VoiceExportInput) : fail('INVALID_INPUT', '声音导出身份无效。'); }
export interface PrepareVoiceReferenceInput { projectId: string; voiceRef: CreationRef; executionOwner: string; runId: string }
export function parsePrepareVoiceReference(v: unknown): Result<PrepareVoiceReferenceInput> {
  return isRecord(v) && exact(v, ['projectId', 'voiceRef', 'executionOwner', 'runId']) && id(v.projectId) && ref(v.voiceRef) && id(v.executionOwner) && id(v.runId) ? ok(structuredClone(v) as unknown as PrepareVoiceReferenceInput) : fail('INVALID_INPUT', '角色声音准备参数无效。');
}

export interface FrozenTTSVoice {voiceRef:CreationRef;characterId:string;providerVoiceId:string;profileRef:RevisionRef;modelRef:RevisionRef;connectionRef:RevisionRef;dialect:string;performanceNotes:string;unmappedFields:string[]}
export function isFrozenTTSVoice(v:unknown):v is FrozenTTSVoice{return isRecord(v)&&exact(v,['voiceRef','characterId','providerVoiceId','profileRef','modelRef','connectionRef','dialect','performanceNotes','unmappedFields'])&&ref(v.voiceRef)&&id(v.characterId)&&text(v.providerVoiceId,256,true)&&![v.providerVoiceId].some(x=>/[\u0000-\u001f\u007f]/.test(x as string))&&isRevisionRef(v.profileRef)&&isRevisionRef(v.modelRef)&&isRevisionRef(v.connectionRef)&&text(v.dialect,200)&&text(v.performanceNotes,8000)&&Array.isArray(v.unmappedFields)&&v.unmappedFields.length<=4&&v.unmappedFields.every(x=>['language','timbreDescription','dialect','performanceNotes'].includes(x as string));}

export interface ReplaceVoiceDialoguesInput {projectId:string;characterId:string;voiceRef:CreationRef;dialogueRefs:CreationRef[]}
export interface ReplacedVoiceDialogues {libraryId:string;projectId:string;dialogues:ShotDialogueRevision[]}
export function parseReplaceVoiceDialogues(v:unknown):Result<ReplaceVoiceDialoguesInput>{return isRecord(v)&&exact(v,['projectId','characterId','voiceRef','dialogueRefs'])&&id(v.projectId)&&id(v.characterId)&&ref(v.voiceRef)&&Array.isArray(v.dialogueRefs)&&v.dialogueRefs.length>0&&v.dialogueRefs.length<=100&&v.dialogueRefs.every(ref)&&new Set(v.dialogueRefs.map(r=>r.id)).size===v.dialogueRefs.length?ok(structuredClone(v) as unknown as ReplaceVoiceDialoguesInput):fail('INVALID_INPUT','请选择确切声音版本与最多100份对白修订。');}
export function isReplacedVoiceDialogues(v:unknown):v is ReplacedVoiceDialogues{return isRecord(v)&&exact(v,['libraryId','projectId','dialogues'])&&id(v.libraryId)&&id(v.projectId)&&Array.isArray(v.dialogues)&&v.dialogues.every(d=>isShotDialogueRevision(d)&&d.libraryId===v.libraryId&&d.projectId===v.projectId);}
