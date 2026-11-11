import { expect, it } from 'vitest';
import { validateDialogue } from '../../packages/domain/src/character-voice.ts';
import { audioFixture, audioValue, audioExecute, fixtureWav } from '../fixtures/audio-generation.ts';

const shot = { id: 'shot', revision: 1, durationSeconds: 5 } as any;
const character = { id: 'a', revision: 1, kind: 'character' } as any;
const voice = { id: 'voice-a', revision: 1, entityRef: { id: 'a', revision: 1 }, reference: { hash: 'a'.repeat(64) }, production: { ready: true, reason: null } } as any;
const turn = { turnId: 't1', characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice-a', revision: 1 }, text: '你好', emotion: 'calm', startTicks: 0, durationTicks: 48000, mode: 'native-reference' } as const;
const draft = { shotRef: { id: 'shot', revision: 1 }, turns: [turn] };

it('validates structured dialogue bounds, speaker count, overlaps and voice ownership', () => {
  expect(validateDialogue(draft, { shot, characters: [character], voices: [voice] })).toMatchObject({ ok: true });
  for (const invalid of [
    { ...draft, turns: [{ ...turn, text: '' }] },
    { ...draft, turns: [{ ...turn, startTicks: 0, durationTicks: 5 * 48000 + 1 }] },
    { ...draft, turns: [{ ...turn, voiceRef: { id: 'voice-a', revision: 2 } }] },
    { ...draft, turns: [{ ...turn, characterRef: { id: 'b', revision: 1 } }] },
    { ...draft, turns: [turn, { ...turn, turnId: 't2', startTicks: 24000 }] },
    { ...draft, turns: Array.from({ length: 4 }, (_, i) => ({ ...turn, turnId: `t${i}`, characterRef: { id: `c${i}`, revision: 1 }, voiceRef: { id: `v${i}`, revision: 1 }, startTicks: i * 48000 })) },
  ]) expect(validateDialogue(invalid as any, { shot, characters: [character], voices: [voice] }).ok).toBe(false);
});

it('changingVoicePreservesOldDialogue and never rewrites the legacy shot string', async () => {
  const s = await audioFixture('openai-speech-v1', { native: true });
  const projectId = s.projectId;
  audioValue(await audioExecute(s.engine, 'creation.saveEntity', { projectId, id: 'a', expectedRevision: 0, kind: 'character', name: 'A', description: '', constraints: '', references: [] }));
  audioValue(await audioExecute(s.engine, 'creation.saveScript', { projectId, id: 'script', expectedRevision: 0, title: 'Story', synopsis: '', body: '', scenes: [{ id: 'scene', title: 'Scene', location: '', time: '', description: '' }] }));
  audioValue(await audioExecute(s.engine, 'creation.saveShot', { projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0, title: 'Shot', durationSeconds: 5, shotSize: 'wide', cameraMovement: '', subject: '', action: '', dialogue: 'legacy', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
  const ref = await s.importAudio(fixtureWav(3));
  const probe = audioValue(await s.engine.mediaInfo.ensure(ref));
  const reference = { ref, hash: probe.objectHash, probeId: probe.probeId, sourceInTicks: 0, durationTicks: 96000 };
  const voiceDraft = { entityRef: { id: 'a', revision: 1 }, name: 'A voice', dialect: '', performanceNotes: '', reference };
  audioValue(await audioExecute(s.engine, 'voice.save', { projectId, id: 'voice-a', expectedRevision: 0, draft: voiceDraft }));
  const saved = audioValue(await audioExecute(s.engine, 'dialogue.save', { projectId, id: 'dialogue', expectedRevision: 0, draft }));
  expect(saved.turns[0].voiceRef).toEqual({ id: 'voice-a', revision: 1 });
  audioValue(await audioExecute(s.engine, 'voice.save', { projectId, id: 'voice-a', expectedRevision: 1, draft: { ...voiceDraft, name: 'New voice' } }));
  const read = audioValue(s.engine.dialogue.read({ projectId, shotId: 'shot' }));
  expect(read.current.turns[0].voiceRef).toEqual({ id: 'voice-a', revision: 1 });
  expect(read.current.turns[0].text).toBe('你好');
  expect(read.issues).toEqual([]);
  expect(audioValue(s.engine.creation.read({ projectId })).shots[0].dialogue).toBe('legacy');
});
