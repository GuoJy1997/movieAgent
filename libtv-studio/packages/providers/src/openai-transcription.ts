import { AudioAdapter } from './audio-adapter.ts';
import type { ArtifactSource } from './artifact-source.ts';
export class OpenAITranscriptionAdapter extends AudioAdapter {
  constructor(spool: ArtifactSource) { super('openai-transcription-v1', spool); }
}
