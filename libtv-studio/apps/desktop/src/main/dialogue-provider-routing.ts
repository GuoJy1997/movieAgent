import type { ProviderContext, ImageDispatchIdentity } from '../../../../packages/providers/src/image-provider.ts';
import type { PreparedGeneration } from '../../../../packages/contracts/src/generation.ts';
import { isPreparedGeneration } from '../../../../packages/contracts/src/generation.ts';
import type { HttpResponse } from '../../../../packages/providers/src/http-transport.ts';
import type { CredentialVault } from './credential-vault.ts';
import type { MediaReference } from '../../../../packages/contracts/src/assets.ts';
import type { ReadLease, MediaChunk, MediaRangeRequest } from '../../../../packages/contracts/src/media-info.ts';
import type { Result } from '../../../../packages/contracts/src/result.ts';
import { createH3GenerationCapability, createLipSyncCapability, createLipSyncQueryCapability, isImageDispatchIdentity } from './provider-capability.ts';
import {hasVerifiedSyncReplayContract} from '../../../../packages/providers/src/sync-lipsync.ts';
import {createHash} from 'node:crypto';
import {createHttpTransport} from '../../../../packages/providers/src/http-transport.ts';

export type DialogueProviderMessage = 'provider.video' | 'provider.lipsync' | 'provider.lipsync.query';
export interface DialogueProviderDetail { dispatch?: ImageDispatchIdentity; referenceBytes?: Uint8Array[]; referenceAudioBytes?: Uint8Array[]; providerTaskId?: string;reconcile?:true }
type Send = (type: DialogueProviderMessage, prepared: PreparedGeneration, detail: DialogueProviderDetail) => Promise<HttpResponse>;
/** Same serializable protocol used by the utility process; streams stay in main. */
export function dialogueProcessContext(send: Send): Pick<ProviderContext, 'requestVideo' | 'requestLipSync' | 'requestLipSyncReconcile' | 'queryLipSync'> {
  return {
    requestVideo: (input, dispatch, referenceBytes, referenceAudioBytes) => send('provider.video', input, { dispatch, referenceBytes, referenceAudioBytes }),
    requestLipSync: (input, dispatch) => send('provider.lipsync', input, { dispatch }),
    requestLipSyncReconcile: (input,dispatch)=>send('provider.lipsync',input,{dispatch,reconcile:true}),
    queryLipSync: (input, providerTaskId) => send('provider.lipsync.query', input, { providerTaskId }),
  };
}
interface MediaReader {
  openMediaRead(ref: MediaReference, hash?: string): Promise<Result<ReadLease>>;
  readMediaRange(input: MediaRangeRequest): Promise<Result<MediaChunk>>;
  closeMediaRead(leaseId: string): Promise<void>;
}
/** Only installed on the owned engine child, never exposed as renderer IPC. */
export function createDialogueProviderRoute(libraryId: string, vault: CredentialVault, reader: MediaReader,transport=createHttpTransport()) {
  const h3=createH3GenerationCapability(libraryId,vault,transport),sync=createLipSyncCapability(libraryId,vault,transport),query=createLipSyncQueryCapability(libraryId,vault,transport);
  const dispatched=new Map<string,{key:string;hash:string;at:number}>();
  async function* read(ref: NonNullable<PreparedGeneration['lipSyncVideo']>): AsyncIterable<Uint8Array> {
    const opened=await reader.openMediaRead(ref.ref,ref.hash);if(!opened.ok)throw Error(opened.error.code);
    try {
      if(opened.value.byteLength!==ref.byteLength)throw Error('REFERENCE_INTEGRITY_FAILED');
      for(let offset=0;offset<ref.byteLength;){const chunk=await reader.readMediaRange({leaseId:opened.value.leaseId,offset,length:Math.min(1024*1024,ref.byteLength-offset)});if(!chunk.ok||!chunk.value.bytes.length||chunk.value.bytes.length>Math.min(1024*1024,ref.byteLength-offset))throw Error('REFERENCE_INTEGRITY_FAILED');yield chunk.value.bytes;offset+=chunk.value.bytes.length;}
    } finally {await reader.closeMediaRead(opened.value.leaseId);}
  }
  return async (type: DialogueProviderMessage, input: PreparedGeneration, detail: DialogueProviderDetail): Promise<HttpResponse> => {
    if(!isPreparedGeneration(input)||input.libraryId!==libraryId)throw Error('PROVIDER_CAPABILITY_DENIED');
    if(type==='provider.lipsync.query')return query(input,detail.providerTaskId!);
    if(!isImageDispatchIdentity(detail.dispatch))throw Error('PROVIDER_CAPABILITY_DENIED');
    if(type==='provider.lipsync') {
      if(detail.reconcile&&!hasVerifiedSyncReplayContract(input))throw Error('IDEMPOTENCY_UNVERIFIED');
      const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex'),old=dispatched.get(detail.dispatch.attemptId);
      if(detail.dispatch.requestHash!==hash||old&&(!detail.reconcile||old.key!==detail.dispatch.clientRequestId||old.hash!==hash||Date.now()-old.at>7*86400000))throw Error('PROVIDER_CAPABILITY_DENIED');
      if(!input.lipSyncVideo||!input.lipSyncAudio)throw Error('INVALID_REFERENCE');
      // On host restart, only the engine's persisted explicit-reconciliation path can set this marker.
      if(!old)dispatched.set(detail.dispatch.attemptId,{key:detail.dispatch.clientRequestId,hash,at:Date.now()});
      return sync(input,detail.dispatch,{video:read(input.lipSyncVideo),audio:read(input.lipSyncAudio)});
    }
    const images=detail.referenceBytes??[],audio=detail.referenceAudioBytes??[];
    if(!Array.isArray(images)||!Array.isArray(audio)||images.length>4||audio.length>3||[...images,...audio].some(b=>!(b instanceof Uint8Array))||[...images,...audio].reduce((n,b)=>n+b.length,0)>32*1024*1024)throw Error('INVALID_REFERENCE');
    return h3(input,detail.dispatch,images,audio);
  };
}
