import { isDialogueSelection, type DialogueSelection } from '../../contracts/src/dialogue-production.ts';
import { isAudioClip, isVideoClip, type AudioClip, type VideoClip } from '../../contracts/src/timeline.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';

export interface DialogueAssemblyInput {
  selection: DialogueSelection;
  video: { hash: string; probeId: string; durationTicks: number };
  audio?: { hash: string; probeId: string };
  startTicks: number;
  durationTicks: number;
  dialogueGroupId: string;
}
export interface DialogueAssembly {
  videoClip: VideoClip;
  audioClip: AudioClip | null;
  dialogueGroupId: string;
  soundPolicy: 'native' | 'dubbed' | 'voiceover';
  environmentAudioLost: boolean;
}
const validId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function assembleDialogueClips(input: DialogueAssemblyInput): Result<DialogueAssembly> {
  if (!isDialogueSelection(input.selection) || !validId(input.dialogueGroupId) || !validId(input.video.probeId) || !validHash(input.video.hash) || !Number.isSafeInteger(input.startTicks) || input.startTicks < 0 || !Number.isSafeInteger(input.durationTicks) || input.durationTicks <= 0 || input.durationTicks > input.video.durationTicks || input.startTicks + input.durationTicks > 600 * 48000) return fail('INVALID_INPUT', '对白组装媒体或时间范围无效。');
  const selection = input.selection, native = selection.route === 'native-reference';
  if (native ? selection.audio !== null || selection.audioHash !== null : !selection.audio || !input.audio || selection.audioHash !== input.audio.hash || !validId(input.audio.probeId)) return fail('DIALOGUE_MEDIA_MISMATCH', '对白声音来源与固定媒体不符。');
  const common = { media: structuredClone(selection.video), sourceHash: input.video.hash, sourceProbeId: input.video.probeId, sourceInTicks: 0, startTicks: input.startTicks, durationTicks: input.durationTicks, gainMilli: 1000, dialogueGroupId: input.dialogueGroupId };
  const videoClip: VideoClip = { ...common, id: `${input.dialogueGroupId}_video`, kind: 'video', fit: 'contain', mute: !native, provenance: { shotId: selection.shotId, shotRevision: selection.shotRevision, selectionRevision: selection.selectionRevision, productionId: null, productionShotRevision: null } };
  const audioClip: AudioClip | null = native ? null : { ...common, id: `${input.dialogueGroupId}_audio`, kind: 'audio', media: structuredClone(selection.audio!), sourceHash: input.audio!.hash, sourceProbeId: input.audio!.probeId, track: 'voice', mute: false };
  if (!isVideoClip(videoClip) || audioClip && !isAudioClip(audioClip)) return fail('INVALID_INPUT', '对白组装片段无效。');
  const soundPolicy = native ? 'native' : selection.route === 'voiceover' ? 'voiceover' : 'dubbed';
  return ok({ videoClip, audioClip, dialogueGroupId: input.dialogueGroupId, soundPolicy, environmentAudioLost: !native });
}
