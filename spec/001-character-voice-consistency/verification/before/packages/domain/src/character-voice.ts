import type { CharacterVoiceRevision, ShotDialogueDraft } from '../../contracts/src/character-voice.ts';
import type { EntityRevision, ShotRevision } from '../../contracts/src/creation.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';

export interface DialogueValidationContext { shot: ShotRevision; characters: EntityRevision[]; voices: CharacterVoiceRevision[] }
export interface ValidatedDialogue { draft: ShotDialogueDraft }

export function validateDialogue(draft: ShotDialogueDraft, context: DialogueValidationContext): Result<ValidatedDialogue> {
  const bad = () => fail('INVALID_DIALOGUE', '对白的角色、声音、路线、时间或字数无效。');
  if (context.shot.id !== draft.shotRef.id || context.shot.revision !== draft.shotRef.revision || !draft.turns.length || draft.turns.length > 16) return bad();
  const mode = draft.turns[0]!.mode;
  let total = 0;
  for (const turn of draft.turns) {
    const character = context.characters.find(value => value.id === turn.characterRef.id && value.revision === turn.characterRef.revision && value.kind === 'character');
    const voice = context.voices.find(value => value.id === turn.voiceRef.id && value.revision === turn.voiceRef.revision);
    if (!character || !voice || voice.entityRef.id !== character.id || voice.entityRef.revision !== character.revision || turn.mode !== mode || !turn.text.trim() || turn.startTicks < 0 || turn.durationTicks <= 0 || turn.startTicks + turn.durationTicks > context.shot.durationSeconds * 48000) return bad();
    total += Array.from(turn.text).length;
  }
  if (total > 16000) return bad();
  if (mode === 'native-reference') {
    if (new Set(draft.turns.map(turn => turn.characterRef.id)).size > 3) return bad();
    const ordered = [...draft.turns].sort((a, b) => a.startTicks - b.startTicks);
    for (let i = 1; i < ordered.length; i++) if (ordered[i - 1]!.startTicks + ordered[i - 1]!.durationTicks > ordered[i]!.startTicks) return bad();
  }
  return ok({ draft: structuredClone(draft) });
}
