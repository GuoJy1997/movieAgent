/** Bounded facts only. Local paths and native process diagnostics are privileged. */
export interface MediaStream {
  index: number; kind: 'audio' | 'video'; codec: string; timeBase: string;
  startPts: number; endPts: number; startSeconds: number; durationTicks: number;
  sampleRate?: number; channels?: number; width?: number; height?: number;
  rotation?: number; sampleAspectRatio?: string; colorSpace?: string; colorTransfer?: string; colorPrimaries?: string;
  averageFrameRate?: string; realFrameRate?: string; variableFrameRate?: boolean;
}
export interface MediaProbe {
  probeId: string; objectHash: string; runtimeHash: string; durationTicks: number;
  container: string; originSeconds: number; width: number; height: number; hasAudio: boolean;
  streams: MediaStream[]; verification: 'probed';
}
export interface FontManifest { file: string; family: string; version: string; sha256: string }
/** Main → engine only; never part of a renderer command. */
export interface MediaRuntime { runtimeHash: string; ffmpegPath: string; ffprobePath: string; fontManifest: FontManifest }
export interface ReadLease { leaseId: string; hash: string; byteLength: number; mime: string; expiresAt: number }
export interface MediaChunk { leaseId: string; offset: number; bytes: Uint8Array; eof: boolean }
export interface MediaRangeRequest { leaseId: string; offset: number; length: number }
