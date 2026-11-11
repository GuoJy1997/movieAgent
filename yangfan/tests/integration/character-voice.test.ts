import { expect, it } from 'vitest';
import { audioFixture, audioValue, audioExecute, fixtureWav } from '../fixtures/audio-generation.ts';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

async function character(projectId: string, engine: any, id: string) {
  return audioValue(await audioExecute(engine, 'creation.saveEntity', { projectId, id, expectedRevision: 0, kind: 'character', name: id, description: '', constraints: '', references: [] }));
}
async function setup() {
  const s = await audioFixture('openai-speech-v1', { native: true });
  await character(s.projectId, s.engine, 'a');
  await character(s.projectId, s.engine, 'b');
  audioValue(await audioExecute(s.engine, 'creation.saveScript', { projectId: s.projectId, id: 'script', expectedRevision: 0, title: 'Story', synopsis: '', body: '', scenes: [{ id: 'scene', title: 'Scene', location: '', time: '', description: '' }] }));
  audioValue(await audioExecute(s.engine, 'creation.saveShot', { projectId: s.projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0, title: 'Shot', durationSeconds: 5, shotSize: 'wide', cameraMovement: '', subject: '', action: '', dialogue: 'legacy words', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
  const ref = await s.importAudio(fixtureWav(3), 'shared.wav');
  const probe = audioValue(await s.engine.mediaInfo.ensure(ref));
  const reference = { ref, hash: probe.objectHash, probeId: probe.probeId, sourceInTicks: 0, durationTicks: 96000 };
  return { ...s, ref, probe, reference };
}
const draft = (entityId: string, reference: unknown) => ({ entityRef: { id: entityId, revision: 1 }, name: `${entityId} voice`, dialect: '山东话', performanceNotes: '', reference });

it('twoCharactersKeepDistinctVoiceRefs and stale saves write nothing', async () => {
  const s = await setup();
  const a = audioValue(await audioExecute(s.engine, 'voice.save', { projectId: s.projectId, id: 'voice-a', expectedRevision: 0, draft: draft('a', s.reference) }));
  const b = audioValue(await audioExecute(s.engine, 'voice.save', { projectId: s.projectId, id: 'voice-b', expectedRevision: 0, draft: draft('b', { ...s.reference, sourceInTicks: 48000, durationTicks: 48000 }) }));
  expect(a.entityRef.id).toBe('a'); expect(b.entityRef.id).toBe('b');
  expect(a.reference.ref).toEqual(b.reference.ref); expect(a.reference.sourceInTicks).not.toBe(b.reference.sourceInTicks);
  audioValue(await audioExecute(s.engine, 'voice.save', { projectId: s.projectId, id: 'voice-a', expectedRevision: 1, draft: { ...draft('a', s.reference), name: 'new' } }));
  expect(await audioExecute(s.engine, 'voice.save', { projectId: s.projectId, id: 'voice-a', expectedRevision: 1, draft: draft('a', s.reference) })).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  expect(audioValue(s.engine.voices.read({ projectId: s.projectId, voiceRef: { id: 'voice-a', revision: 2 } })).name).toBe('new');
  expect(audioValue(s.engine.voices.list({ projectId: s.projectId })).voices).toHaveLength(2);
});

it('rejectCrossProjectVoice and protectReferencedVoiceMedia while retaining fixed history', async () => {
  const s = await setup();
  const other = audioValue(await audioExecute(s.engine, 'project.create', { name: 'Other' })).id;
  await character(other, s.engine, 'other-a');
  expect(await audioExecute(s.engine, 'voice.save', { projectId: s.projectId, id: 'bad', expectedRevision: 0, draft: { ...draft('a', s.reference), entityRef: { id: 'other-a', revision: 1 } } })).toMatchObject({ ok: false });
  expect(await audioExecute(s.engine, 'voice.save', { projectId: s.projectId, id: 'bad', expectedRevision: 0, draft: { ...draft('a', s.reference), entityRef: { id: 'missing', revision: 1 } } })).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  audioValue(await audioExecute(s.engine, 'voice.save', { projectId: s.projectId, id: 'voice-a', expectedRevision: 0, draft: draft('a', s.reference) }));
  const snapshot = audioValue(await s.engine.maintenance.snapshot());
  const manifest = JSON.parse(await readFile(join(s.root, 'backups', `${snapshot.snapshotId}.json`), 'utf8'));
  expect(manifest.voiceSources[0]).toMatchObject({ voiceId: 'voice-a', sourceHash: s.probe.objectHash });
  audioValue(await audioExecute(s.engine, 'asset.trash', { assetId: s.ref.assetId, expectedRevision: 1 }));
  expect(await audioExecute(s.engine, 'voice.save', { projectId: s.projectId, id: 'voice-a', expectedRevision: 1, draft: draft('a', s.reference) })).toMatchObject({ ok: false, error: { code: 'ASSET_TRASHED' } });
  expect(audioValue(s.engine.voices.read({ projectId: s.projectId, voiceRef: { id: 'voice-a', revision: 1 } })).reference.hash).toBe(s.probe.objectHash);
});

it('legacyDialogueIsNotAutoAssigned and unprobed references remain non-production drafts', async () => {
  const s = await setup();
  const saved = audioValue(await audioExecute(s.engine, 'voice.save', { projectId: s.projectId, id: 'draft-voice', expectedRevision: 0, draft: draft('a', { ...s.reference, probeId: null }) }));
  expect(saved.production).toMatchObject({ ready: false });
  const dialogue = audioValue(s.engine.dialogue.read({ projectId: s.projectId, shotId: 'shot' }));
  expect(dialogue.current).toBeNull();
  expect(audioValue(s.engine.creation.read({ projectId: s.projectId })).shots[0].dialogue).toBe('legacy words');
});
