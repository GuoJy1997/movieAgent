import type { MediaReference } from '../../../../../../packages/contracts/src/assets.ts';
import type { ShotOutputSelection } from '../../../../../../packages/contracts/src/creation.ts';

export function soundSourceLabel(selection: ShotOutputSelection | undefined): string {
  if (!selection?.dialogue) return '无对白元数据 · 默认静音';
  return selection.dialogue.route === 'native-reference' ? '原生视频声音' : selection.dialogue.route === 'dubbed-lipsync' ? '独立配音＋修正画面' : '独立画外音';
}
export function outputSoundSourceLabel(reference: MediaReference, selection: ShotOutputSelection | undefined): string {
  const video = selection?.video;
  const same = video && video.libraryId === reference.libraryId && (reference.kind === 'artifact' ? video.kind === 'artifact' && video.artifactId === reference.artifactId : video.kind === 'assetVersion' && video.assetId === reference.assetId && video.version === reference.version);
  return soundSourceLabel(same ? selection : undefined);
}
/** A choice revision records when the user selected it, not when the media was made. */
export function selectedOutputRevision(reference: MediaReference, outputs: {reference: MediaReference; shotRevision: number}[]): number | null {
  return outputs.find(output => {
    const other=output.reference;
    return other.libraryId===reference.libraryId && (reference.kind==='artifact'
      ? other.kind==='artifact' && other.artifactId===reference.artifactId
      : other.kind==='assetVersion' && other.assetId===reference.assetId && other.version===reference.version);
  })?.shotRevision ?? null;
}
