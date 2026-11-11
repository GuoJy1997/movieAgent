import {encodeVoiceManagement,type VoiceManagementOperation} from '../../../../packages/providers/src/voice-management.ts';
import type { PreparedGeneration } from '../../../../packages/contracts/src/generation.ts';
import type { CredentialRef, ProviderConnection } from '../../../../packages/contracts/src/models.ts';
import { isRecord } from '../../../../packages/contracts/src/result.ts';
import { createHttpTransport, type HttpResponse } from '../../../../packages/providers/src/http-transport.ts';
import { textRequestBody } from '../../../../packages/providers/src/openai-chat.ts';
import { imageEditRequestBody } from '../../../../packages/providers/src/openai-image-edit.ts';
import { verifyReferenceBytes } from '../../../../packages/domain/src/reference-inputs.ts';
import { imageRequestBody } from '../../../../packages/providers/src/openai-images.ts';
import { videoRequestBody, validateVideoQuery, isVideoTaskId } from '../../../../packages/providers/src/minimax-video.ts';
import { h3RequestBytes, validateH3Request } from '../../../../packages/providers/src/minimax-h3.ts';
import { streamLipSyncMultipart, validateLipSyncInput, type LipSyncByteSource } from '../../../../packages/providers/src/sync-lipsync.ts';
import type { ImageDispatchIdentity } from '../../../../packages/providers/src/image-provider.ts';
import type { CredentialVault } from './credential-vault.ts';
import { encodeSpeechRequest, encodeTranscriptionRequest, isSpeechProtocol, validateAudioRequest } from '../../../../packages/providers/src/audio-protocol.ts';

export function createAudioGenerationCapability(libraryId: string, vault: CredentialVault, transport = createHttpTransport()) {
  return async (input: PreparedGeneration, dispatch: ImageDispatchIdentity, bytes?: Uint8Array): Promise<HttpResponse> => {
    if (!validateAudioRequest(input, input.adapterId).ok || input.libraryId !== libraryId || !isImageDispatchIdentity(dispatch)) throw Error('INVALID_AUDIO_CAPABILITY');
    const speech = isSpeechProtocol(input.adapterId);
    const body = speech ? encodeSpeechRequest(input.adapterId, input.config.model.modelId, input.prompt, input.config.parameters) : encodeTranscriptionRequest(input.adapterId, input.config.model.modelId, input.audioSource!, input.config.parameters, bytes ?? new Uint8Array());
    if (!body.ok) throw Error(body.error.code);
    const encoded = Buffer.isBuffer(body.value) ? { body: body.value, contentType: 'application/json' } : body.value;
    return withModelCredentials(libraryId, input.config.connection, vault, { 'x-client-request-id': dispatch.clientRequestId }, headers => transport.audio(input.config.connection, encoded.body, encoded.contentType, headers));
  };
}
export function isImageDispatchIdentity(v:unknown):v is ImageDispatchIdentity {
 return isRecord(v)&&Object.keys(v).length===5&&['attemptId','outputStagingId','clientRequestId'].every(k=>typeof v[k]==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v[k] as string))&&v.outputStagingId===v.attemptId+'-output'&&typeof v.requestHash==='string'&&/^[a-f0-9]{64}$/.test(v.requestHash)&&v.retries===0;
}
async function withModelCredentials(libraryId: string, connection: ProviderConnection, vault: CredentialVault, requestHeaders: Record<string, string>, run: (headers: Record<string, string>) => Promise<HttpResponse>): Promise<HttpResponse> {
  if (connection.libraryId !== libraryId) throw Error('INVALID_CREDENTIAL_OWNER');
  const refs: [string, CredentialRef][] = [...(connection.credentialRef ? [['authorization', connection.credentialRef] as [string, CredentialRef]] : []), ...Object.entries(connection.headers)];
  if (refs.some(([, ref]) => ref.libraryId !== libraryId || ref.connectionId !== connection.id)) throw Error('INVALID_CREDENTIAL_OWNER');
  const headers: Record<string, string> = {};
  async function use(index: number): Promise<HttpResponse> {
    const entry = refs[index]; if (!entry) { Object.assign(headers, requestHeaders); return run(headers); }
    const [name, ref] = entry;
    const result = await vault.withSecret(ref, async secret => {
      if (/[\r\n\u0000]/.test(secret)) throw Error('INVALID_CREDENTIAL');
      const authName=name==='authorization'&&['anthropic-messages-v1','sync-lipsync-v2'].includes(connection.adapterType)?'x-api-key':name;
      headers[authName] = authName === 'authorization' ? `Bearer ${secret}` : secret;
      try { return await use(index + 1); } finally { delete headers[authName]; }
    });
    if (!result.ok) throw Error('CREDENTIAL_USE_FAILED');
    return result.value;
  }
  return use(0);
}
export function createVideoGenerationCapability(libraryId: string, vault: CredentialVault, transport = createHttpTransport()) {
  return async (input: PreparedGeneration, dispatch: ImageDispatchIdentity, bytes: Uint8Array[] = []): Promise<HttpResponse> => {
    const checked = verifyReferenceBytes(input, bytes); if (!checked.ok) throw Error(checked.error.code);
    const body = videoRequestBody(input, checked.value);
    if (!body.ok || input.libraryId !== libraryId || !isImageDispatchIdentity(dispatch)) throw Error('INVALID_VIDEO_CAPABILITY');
    return withModelCredentials(libraryId, input.config.connection, vault, { 'x-client-request-id': dispatch.clientRequestId }, headers => transport.video(input.config.connection, body.value, headers, undefined, undefined, !!input.referenceImages?.length));
  };
}
export function createH3GenerationCapability(libraryId: string, vault: CredentialVault, transport = createHttpTransport()) {
  return async (input: PreparedGeneration, dispatch: ImageDispatchIdentity, bytes: Uint8Array[] = [], audioBytes: Uint8Array[] = []): Promise<HttpResponse> => {
    if (input.libraryId !== libraryId || !isImageDispatchIdentity(dispatch)) throw Error('INVALID_VIDEO_CAPABILITY');
    const body = h3RequestBytes(input, { images: bytes, audio: audioBytes });
    if (!body.ok) throw Error(body.error.code);
    return withModelCredentials(libraryId, input.config.connection, vault, { 'x-client-request-id': dispatch.clientRequestId }, headers => transport.video(input.config.connection, body.value, headers));
  };
}
export function createLipSyncCapability(libraryId: string, vault: CredentialVault, transport = createHttpTransport()) {
  return async (input: PreparedGeneration, dispatch: ImageDispatchIdentity, bytes: { video: LipSyncByteSource; audio: LipSyncByteSource }): Promise<HttpResponse> => {
    if (input.libraryId !== libraryId || !isImageDispatchIdentity(dispatch)) throw Error('INVALID_LIPSYNC_CAPABILITY');
    const boundary = `sync-${dispatch.clientRequestId}`;
    const body = streamLipSyncMultipart(input, bytes, boundary);
    if (!body.ok) throw Error(body.error.code);
    return withModelCredentials(libraryId, input.config.connection, vault, { 'idempotency-key': dispatch.clientRequestId, 'content-length': String(body.value.byteLength) }, headers => transport.lipsync(input.config.connection, body.value.body, `multipart/form-data; boundary=${boundary}`, headers));
  };
}
export function createLipSyncQueryCapability(libraryId: string, vault: CredentialVault, transport = createHttpTransport()) {
  return async (input: PreparedGeneration, providerTaskId: string): Promise<HttpResponse> => {
    if (!validateLipSyncInput(input).ok || input.libraryId !== libraryId || !isVideoTaskId(providerTaskId)) throw Error('INVALID_LIPSYNC_CAPABILITY');
    return withModelCredentials(libraryId, input.config.connection, vault, {}, headers => transport.lipsync(input.config.connection, null, 'application/json', headers, providerTaskId));
  };
}
export function createVideoQueryCapability(libraryId: string, vault: CredentialVault, transport = createHttpTransport()) {
  return async (input: PreparedGeneration, providerTaskId: string): Promise<HttpResponse> => {
    if ((input.adapterId === 'minimax-h3-v2' ? !validateH3Request(input).ok : !validateVideoQuery(input).ok) || input.libraryId !== libraryId || !isVideoTaskId(providerTaskId)) throw Error('INVALID_VIDEO_CAPABILITY');
    return withModelCredentials(libraryId, input.config.connection, vault, {}, headers => transport.video(input.config.connection, null, headers, providerTaskId));
  };
}
/** Installed on the locally held utility child only; never an Electron renderer IPC handler. */
export function createImageGenerationCapability(libraryId:string,vault:CredentialVault,transport=createHttpTransport()){
 return async(input:PreparedGeneration,dispatch:ImageDispatchIdentity):Promise<HttpResponse>=>{
  const body=imageRequestBody(input);
  if(!body.ok||input.libraryId!==libraryId||!isImageDispatchIdentity(dispatch))throw Error('INVALID_IMAGE_CAPABILITY');
  return withModelCredentials(libraryId, input.config.connection, vault, { 'x-client-request-id': dispatch.clientRequestId }, headers => transport.model(input.config.connection, body.value, headers));
 };
}

export function createTextGenerationCapability(libraryId: string, vault: CredentialVault, transport = createHttpTransport()) {
  return async (input: PreparedGeneration, dispatch: ImageDispatchIdentity): Promise<HttpResponse> => {
    const body = textRequestBody(input);
    if (!body.ok || input.libraryId !== libraryId || !isImageDispatchIdentity(dispatch)) throw Error('INVALID_TEXT_CAPABILITY');
    return withModelCredentials(libraryId, input.config.connection, vault, { 'x-client-request-id': dispatch.clientRequestId, ...(input.config.connection.adapterType==='anthropic-messages-v1'?{'anthropic-version':'2023-06-01'}:{}) }, headers => transport.text(input.config.connection, body.value, headers));
  };
}
export function createImageEditCapability(libraryId: string, vault: CredentialVault, transport = createHttpTransport()) {
  return async (input: PreparedGeneration, dispatch: ImageDispatchIdentity, bytes: Uint8Array[] = []): Promise<HttpResponse> => {
    const body = imageEditRequestBody(input, bytes);
    if (!body.ok || input.libraryId !== libraryId || !isImageDispatchIdentity(dispatch)) throw Error('INVALID_IMAGE_EDIT_CAPABILITY');
    return withModelCredentials(libraryId, input.config.connection, vault, { 'x-client-request-id': dispatch.clientRequestId }, headers => transport.imageEdit(input.config.connection, body.value.body, body.value.contentType, headers));
  };
}

export function createVoiceManagementCapability(libraryId:string,vault:CredentialVault,transport=createHttpTransport()){
  return async(input:PreparedGeneration,dispatch:ImageDispatchIdentity,operation:VoiceManagementOperation,bytes?:Uint8Array):Promise<HttpResponse>=>{
    if(input.libraryId!==libraryId||input.adapterId!=='minimax-speech-v1'||input.config.connection.adapterType!=='minimax-speech-v1'||!isImageDispatchIdentity(dispatch))throw Error('INVALID_VOICE_CAPABILITY');
    const encoded=encodeVoiceManagement(operation,bytes);if(!encoded.ok)throw Error(encoded.error.code);
    return withModelCredentials(libraryId,input.config.connection,vault,{'x-client-request-id':dispatch.clientRequestId},headers=>transport.voiceManagement(input.config.connection,encoded.value.path as 'get_voice'|'voice_clone'|'files/upload',encoded.value.body,encoded.value.contentType,headers));
  };
}
