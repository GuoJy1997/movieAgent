import { AudioAdapter } from './audio-adapter.ts';
import type { ArtifactSource } from './artifact-source.ts';
export class MiniMaxSpeechAdapter extends AudioAdapter {
  constructor(spool: ArtifactSource, metadataSpool?: ArtifactSource) { super('minimax-speech-v1', spool, metadataSpool); }
}
