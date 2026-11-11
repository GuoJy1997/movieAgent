import { AudioAdapter } from './audio-adapter.ts';
import type { ArtifactSource } from './artifact-source.ts';
export class OpenAISpeechAdapter extends AudioAdapter {
  constructor(spool: ArtifactSource) { super('openai-speech-v1', spool); }
}
