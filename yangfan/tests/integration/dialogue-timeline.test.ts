import { expect, it } from 'vitest';
import { applyTimelineOps } from '../../packages/domain/src/timeline-edit.ts';
import { DEFAULT_SUBTITLE_STYLE, type TimelineRevision } from '../../packages/contracts/src/timeline.ts';

const video = { kind: 'assetVersion', libraryId: 'library', assetId: 'video', version: 1 } as const;
const audio = { kind: 'assetVersion', libraryId: 'library', assetId: 'audio', version: 1 } as const;
const selection = { libraryId: 'library', projectId: 'project', shotId: 'shot', shotRevision: 1, dialogueRef: { id: 'dialogue', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, takeId: 'take', selectionRevision: 1, route: 'dubbed-lipsync', video, audio, sourceVideoHash: 'a'.repeat(64), audioHash: 'b'.repeat(64), reviewRevision: 1, selectedAt: new Date().toISOString() } as const;
const input = { selection, video: { hash: 'c'.repeat(64), probeId: 'video-probe', durationTicks: 48000 }, audio: { hash: 'b'.repeat(64), probeId: 'audio-probe' }, startTicks: 0, durationTicks: 48000, dialogueGroupId: 'dialogue-group' };

it('assembles mutually exclusive native and dubbed sound sources in one dialogue group', async () => {
  const module = await import('../../packages/domain/src/dialogue-assembly.ts');
  expect(module.assembleDialogueClips).toBeTypeOf('function');
  const dubbed = module.assembleDialogueClips!(input);
  expect(dubbed).toMatchObject({ ok: true, value: { soundPolicy: 'dubbed', environmentAudioLost: true, videoClip: { mute: true, dialogueGroupId: 'dialogue-group' }, audioClip: { mute: false, track: 'voice', dialogueGroupId: 'dialogue-group' } } });
  const native = module.assembleDialogueClips!({ ...input, selection: { ...selection, route: 'native-reference', audio: null, audioHash: null }, audio: undefined });
  expect(native).toMatchObject({ ok: true, value: { soundPolicy: 'native', videoClip: { mute: false }, audioClip: null } });
});

it('moves, trims, splits and deletes a dialogue group as one interval', async () => {
  const module = await import('../../packages/domain/src/dialogue-assembly.ts');
  const assembled = module.assembleDialogueClips!(input);
  expect(assembled.ok).toBe(true); if (!assembled.ok) return;
  const timeline: TimelineRevision = { libraryId: 'library', projectId: 'project', id: 'timeline', revision: 1, scriptRef: { id: 'script', revision: 1 }, title: 'T', fps: { num: 30, den: 1 }, canvas: { width: 1920, height: 1080 }, timebase: 48000, videoClips: [assembled.value.videoClip], audioClips: [assembled.value.audioClip!], subtitleCues: [], subtitleStyle: DEFAULT_SUBTITLE_STYLE, createdAt: new Date().toISOString() };
  const moved = applyTimelineOps(timeline, [{ kind: 'move', clipId: assembled.value.videoClip.id, startTicks: 48000 }]);
  expect(moved).toMatchObject({ ok: true, value: { videoClips: [{ startTicks: 48000 }], audioClips: [{ startTicks: 48000 }] } });
  const split = applyTimelineOps(timeline, [{ kind: 'split', clipId: assembled.value.videoClip.id, atTicks: 24000, operationId: 'split' }]);
  expect(split).toMatchObject({ ok: true });
  if (split.ok) {
    expect(split.value.videoClips).toHaveLength(2); expect(split.value.audioClips).toHaveLength(2);
    const [left, right] = split.value.videoClips;
    expect(right!.dialogueGroupId).not.toBe(left!.dialogueGroupId);
    const deleted = applyTimelineOps(split.value, [{ kind: 'delete', clipId: right!.id }]);
    expect(deleted).toMatchObject({ ok: true, value: { videoClips: [left], audioClips: [split.value.audioClips[0]] } });
    const movedRight = applyTimelineOps(split.value, [{ kind: 'move', clipId: right!.id, startTicks: 48000 }]);
    expect(movedRight).toMatchObject({ ok: true, value: { videoClips: [{ startTicks: 0 }, { startTicks: 48000 }], audioClips: [{ startTicks: 0 }, { startTicks: 48000 }] } });
    const trimmedRight = applyTimelineOps(split.value, [{ kind: 'trim', clipId: right!.id, sourceInTicks: 24000, durationTicks: 16000 }]);
    expect(trimmedRight).toMatchObject({ ok: true, value: { videoClips: [{ durationTicks: 24000 }, { durationTicks: 16000 }], audioClips: [{ durationTicks: 24000 }, { durationTicks: 16000 }] } });
  }
  expect(applyTimelineOps(timeline, [{ kind: 'setGain', clipId: assembled.value.videoClip.id, gainMilli: 1000, mute: false }])).toMatchObject({ ok: false });
  expect(applyTimelineOps(timeline, [{ kind: 'setGain', clipId: assembled.value.audioClip!.id, gainMilli: 1000, mute: true }])).toMatchObject({ ok: false });
  const trimmed = applyTimelineOps(timeline, [{ kind: 'trim', clipId: assembled.value.videoClip.id, sourceInTicks: 0, durationTicks: 24000 }]);
  expect(trimmed).toMatchObject({ ok: true, value: { videoClips: [{ durationTicks: 24000 }], audioClips: [{ durationTicks: 24000 }] } });
  const removed = applyTimelineOps(timeline, [{ kind: 'delete', clipId: assembled.value.audioClip!.id }]);
  expect(removed).toMatchObject({ ok: true, value: { videoClips: [], audioClips: [] } });
  const unlinked = applyTimelineOps(timeline, [{ kind: 'unlinkDialogueGroup', clipId: assembled.value.videoClip.id }, { kind: 'move', clipId: assembled.value.videoClip.id, startTicks: 48000 }]);
  expect(unlinked).toMatchObject({ ok: true, value: { videoClips: [{ startTicks: 48000 }], audioClips: [{ startTicks: 0 }] } });
  if (unlinked.ok) { expect(unlinked.value.videoClips[0]).not.toHaveProperty('dialogueGroupId'); expect(unlinked.value.audioClips[0]).not.toHaveProperty('dialogueGroupId'); }
});

it('ripples a following dialogue group once and rejects overlapping group edits without mutation', async () => {
  const module = await import('../../packages/domain/src/dialogue-assembly.ts');
  const assembled = module.assembleDialogueClips!({ ...input, startTicks: 96000 });
  expect(assembled.ok).toBe(true); if (!assembled.ok) return;
  const ordinary = { ...assembled.value.videoClip, id: 'ordinary', startTicks: 48000, dialogueGroupId: undefined };
  const timeline: TimelineRevision = { libraryId: 'library', projectId: 'project', id: 'timeline', revision: 1, scriptRef: { id: 'script', revision: 1 }, title: 'T', fps: { num: 30, den: 1 }, canvas: { width: 1920, height: 1080 }, timebase: 48000, videoClips: [ordinary, assembled.value.videoClip], audioClips: [assembled.value.audioClip!], subtitleCues: [], subtitleStyle: DEFAULT_SUBTITLE_STYLE, createdAt: new Date().toISOString() };
  const rippled = applyTimelineOps(timeline, [{ kind: 'rippleDelete', clipId: 'ordinary', operationId: 'ripple' }]);
  expect(rippled).toMatchObject({ ok: true, value: { videoClips: [{ startTicks: 48000 }], audioClips: [{ startTicks: 48000 }] } });
  const music = { ...assembled.value.audioClip!, id: 'other-voice', track: 'voice' as const, startTicks: 48000, dialogueGroupId: undefined };
  const overlapping: TimelineRevision = { ...timeline, videoClips: [assembled.value.videoClip], audioClips: [assembled.value.audioClip!, music] };
  const rejected = applyTimelineOps(overlapping, [{ kind: 'move', clipId: assembled.value.videoClip.id, startTicks: 48000 }]);
  expect(rejected.ok).toBe(false);
  expect(overlapping.videoClips[0]?.startTicks).toBe(96000);
  expect(overlapping.audioClips[0]?.startTicks).toBe(96000);
});
