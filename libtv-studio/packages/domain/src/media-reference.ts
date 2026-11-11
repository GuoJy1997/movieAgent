import type { MediaReference } from '../../contracts/src/assets.ts';
/** A persisted reference always identifies immutable content, never a path or latest alias. */
export function mediaReferenceKey(ref: MediaReference): string {
  return ref.kind === 'artifact' ? `${ref.libraryId}:artifact:${ref.artifactId}` : `${ref.libraryId}:asset:${ref.assetId}:${ref.version}`;
}
