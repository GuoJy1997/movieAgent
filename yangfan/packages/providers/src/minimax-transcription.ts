import { AudioAdapter } from './audio-adapter.ts';
import type { ArtifactSource } from './artifact-source.ts';
export class MiniMaxTranscriptionAdapter extends AudioAdapter {
  constructor(spool: ArtifactSource) { super('minimax-transcription-v1', spool); }
}
