import { isTextProtocol, textBaseUrl } from './text-protocol.ts';
import { isAudioProtocol } from './audio-protocol.ts';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { once } from 'node:events';
import { BlockList, isIP } from 'node:net';
import { parseModelEndpoint, type ProviderConnection } from '../../contracts/src/models.ts';
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
export const MAX_AUDIO_RESPONSE_BYTES = MAX_AUDIO_BYTES * 2 + 65536;
export const MAX_TEXT_RESPONSE_BYTES = 6 * 1024 * 1024 + 64 * 1024;
export const MAX_REFERENCE_REQUEST_BYTES = 48 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64 * 1024;
export interface HttpResponse {
  status: number;
  bytes: Uint8Array;
}
export type ResolveAddresses = (host: string) => Promise<{
  address: string;
  family: number;
}[]>;
const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const)
  blocked.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
/** No proxy/environment/SDK retry. DNS is checked once per hop and pinned to the actual socket. */
export function createHttpTransport(options: {
  resolve?: ResolveAddresses;
} = {}) {
  const resolve = options.resolve ?? (host => lookup(host, { all: true, verbatim: true }));
  async function transfer(url: URL, body: Buffer | AsyncIterable<Uint8Array> | null, headers: Record<string, string>, maximum: number, timeoutMs: number, privateGrant: boolean, signal?: AbortSignal): Promise<HttpResponse & {
    location?: string;
  }> {
    const host = url.hostname.replace(/^\[|\]$/g, ''), abort = new AbortController();
    const abortExternal = () => abort.abort();
    signal?.addEventListener('abort', abortExternal, { once: true });
    if (signal?.aborted)
      abort.abort();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const deniedUrl = url.username || url.password || url.hash ||
        !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !privateGrant);
      if (deniedUrl)
        throw Error('NETWORK_POLICY');
      const addresses = await Promise.race([
        isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : resolve(host),
        new Promise<never>((_r, reject) => {
          if (abort.signal.aborted) reject(Error('NETWORK_TIMEOUT'));
          else abort.signal.addEventListener('abort', () => reject(Error('NETWORK_TIMEOUT')), { once: true });
        }),
      ]);
      const deniedAddress = addresses.some(a =>
        !isIP(a.address) || a.family !== isIP(a.address) || (!privateGrant && !isPublicAddress(a.address)));
      if (!addresses.length || deniedAddress)
        throw Error('NETWORK_POLICY');
      const selected = addresses[0]!;
      if (abort.signal.aborted)
        throw Error('NETWORK_TIMEOUT');
      return await new Promise((resolveResponse, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
          method: body ? 'POST' : 'GET', headers, agent: false, signal: abort.signal,
          lookup: ((_hostname: string, opts: any, callback: any) => opts?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family)) as any,
        }, response => {
          const chunks: Buffer[] = [];
          let length = 0;
          if (Number(response.headers['content-length']) > maximum) {
            response.destroy(Error('RESPONSE_LIMIT'));
            request.destroy(Error('RESPONSE_LIMIT'));
            return;
          }
          response.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > maximum) {
              response.destroy(Error('RESPONSE_LIMIT'));
              request.destroy(Error('RESPONSE_LIMIT'));
            } else {
              chunks.push(chunk);
            }
          });
          response.on('error', () => reject(Error(length > maximum ? 'RESPONSE_LIMIT' : 'NETWORK_FAILURE')));
          response.on('end', () => resolveResponse({ status: response.statusCode ?? 0, bytes: Buffer.concat(chunks), ...(response.headers.location ? { location: response.headers.location } : {}) }));
        });
        request.on('error', error => reject(Error(error.message === 'RESPONSE_LIMIT' ? 'RESPONSE_LIMIT' : 'NETWORK_FAILURE')));
        void (async () => {
          if (body && !Buffer.isBuffer(body)) for await (const chunk of body) {
            if (!request.write(chunk)) await Promise.race([once(request, 'drain'), once(request, 'error').then(([error]) => { throw error; })]);
          }
          request.end(Buffer.isBuffer(body) ? body : undefined);
        })().catch(reject);
      });
    }
    finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortExternal);
    }
  }
  return {
    async text(connection: ProviderConnection, body: Buffer, headers: Record<string, string>, signal?: AbortSignal): Promise<HttpResponse> {
      const endpoint = parseModelEndpoint(connection.baseUrl, connection.networkPolicy);
      if (!endpoint.ok || !isTextProtocol(connection.adapterType) || body.length > 128 * 1024) throw Error('NETWORK_POLICY');
      return transfer(new URL(textBaseUrl(endpoint.value.baseUrl) + (connection.adapterType==='anthropic-messages-v1'?'/messages':'/chat/completions')), body, { ...headers, 'content-type': 'application/json', 'content-length': String(body.length) }, MAX_TEXT_RESPONSE_BYTES, connection.timeoutMs, endpoint.value.networkPolicy.privateEndpoint !== null, signal);
    },
    async listModels(connection:ProviderConnection,headers:Record<string,string>,after?:string,signal?:AbortSignal):Promise<HttpResponse>{
      const endpoint=parseModelEndpoint(connection.baseUrl,connection.networkPolicy);if(!endpoint.ok||!isTextProtocol(connection.adapterType)&&!isAudioProtocol(connection.adapterType))throw Error('NETWORK_POLICY');
      const url=new URL(textBaseUrl(endpoint.value.baseUrl)+'/models');if(connection.adapterType==='anthropic-messages-v1'){url.searchParams.set('limit','1000');if(after)url.searchParams.set('after_id',after);}
      return transfer(url,null,headers,1024*1024,connection.timeoutMs,endpoint.value.networkPolicy.privateEndpoint!==null,signal);
    },
    async imageEdit(connection: ProviderConnection, body: Buffer, contentType: string, headers: Record<string, string>, signal?: AbortSignal): Promise<HttpResponse> {
      const endpoint = parseModelEndpoint(connection.baseUrl, connection.networkPolicy);
      if (!endpoint.ok || connection.adapterType !== 'openai-image-edit-v1' || body.length > MAX_REFERENCE_REQUEST_BYTES || !/^multipart\/form-data; boundary=movieagent-[a-f0-9-]{36}$/.test(contentType)) throw Error('NETWORK_POLICY');
      return transfer(new URL(endpoint.value.baseUrl + '/images/edits'), body, { ...headers, 'content-type': contentType, 'content-length': String(body.length) }, MAX_RESPONSE_BYTES, connection.timeoutMs, endpoint.value.networkPolicy.privateEndpoint !== null, signal);
    },
    async video(connection: ProviderConnection, body: Buffer | null, headers: Record<string, string>, providerTaskId?: string, signal?: AbortSignal, referenceInput = false): Promise<HttpResponse> {
      const endpoint = parseModelEndpoint(connection.baseUrl, connection.networkPolicy);
      if (!endpoint.ok || !['minimax-video-v2', 'minimax-h3-v2'].includes(connection.adapterType) || body !== null && (body.length > (connection.adapterType === 'minimax-h3-v2' ? 48000000 : referenceInput ? MAX_REFERENCE_REQUEST_BYTES : 128 * 1024) || providerTaskId !== undefined) || body === null && (typeof providerTaskId !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(providerTaskId))) throw Error('NETWORK_POLICY');
      // Native v2 belongs at the origin, never under a configured legacy /v1 prefix.
      const url = new URL(body === null ? `/v2/query/video_generation/${providerTaskId}` : '/v2/video_generation', endpoint.value.baseUrl);
      return transfer(url, body, { ...(body ? { 'content-type': 'application/json', 'content-length': String(body.length) } : {}), ...headers }, 1024 * 1024, connection.timeoutMs, endpoint.value.networkPolicy.privateEndpoint !== null, signal);
    },
    async lipsync(connection: ProviderConnection, body: Buffer | AsyncIterable<Uint8Array> | null, contentType: string, headers: Record<string, string>, providerTaskId?: string, signal?: AbortSignal): Promise<HttpResponse> {
      const endpoint = parseModelEndpoint(connection.baseUrl, connection.networkPolicy);
      const contentLength = body === null || Buffer.isBuffer(body) ? String(body?.length ?? 0) : headers['content-length'];
      if (!endpoint.ok || connection.adapterType !== 'sync-lipsync-v2' || body !== null && providerTaskId !== undefined || Buffer.isBuffer(body) && body.length > 68 * 1024 * 1024 + 65536 || body !== null && !Buffer.isBuffer(body) && (!contentLength || !/^\d+$/.test(contentLength) || Number(contentLength) > 68 * 1024 * 1024 + 65536) || body === null && (typeof providerTaskId !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(providerTaskId))) throw Error('NETWORK_POLICY');
      const url = new URL(body === null ? `/v2/generate/${providerTaskId}` : '/v2/generate', endpoint.value.baseUrl);
      return transfer(url, body, { ...headers, 'content-type': contentType, 'content-length': contentLength! }, 1024 * 1024, connection.timeoutMs, endpoint.value.networkPolicy.privateEndpoint !== null, signal);
    },
    async voiceManagement(connection:ProviderConnection,path:'get_voice'|'voice_clone'|'files/upload',body:Buffer,contentType:string,headers:Record<string,string>,signal?:AbortSignal):Promise<HttpResponse>{
      const endpoint=parseModelEndpoint(connection.baseUrl,connection.networkPolicy);
      if(!endpoint.ok||connection.adapterType!=='minimax-speech-v1'||!['get_voice','voice_clone','files/upload'].includes(path)||body.length>20065536)throw Error('NETWORK_POLICY');
      const base=endpoint.value.baseUrl.replace(/\/$/,'');const url=new URL(base+(new URL(base).pathname.endsWith('/v1')?'/':'/v1/')+path);
      return transfer(url,body,{...headers,'content-type':contentType,'content-length':String(body.length)},2*1024*1024,connection.timeoutMs,endpoint.value.networkPolicy.privateEndpoint!==null,signal);
    },
    async audio(connection: ProviderConnection, body: Buffer, contentType: string, headers: Record<string, string>, signal?: AbortSignal): Promise<HttpResponse> {
      const endpoint = parseModelEndpoint(connection.baseUrl, connection.networkPolicy);
      const speech = connection.adapterType === 'openai-speech-v1' || connection.adapterType === 'minimax-speech-v1';
      const native = connection.adapterType.startsWith('minimax-');
      if (!endpoint.ok || !['openai-speech-v1', 'minimax-speech-v1', 'openai-transcription-v1', 'minimax-transcription-v1'].includes(connection.adapterType) || body.length > (speech ? 128 * 1024 : 24000000 + 65536) || speech && contentType !== 'application/json' || !speech && !/^multipart\/form-data; boundary=libtv-[a-f0-9-]{36}$/.test(contentType)) throw Error('NETWORK_POLICY');
      const url = native ? new URL(speech ? '/v1/t2a_v2' : '/v1/speech_to_text', endpoint.value.baseUrl) : new URL(endpoint.value.baseUrl + (speech ? '/audio/speech' : '/audio/transcriptions'));
      return transfer(url, body, { ...headers, 'content-type': contentType, 'content-length': String(body.length) }, speech ? MAX_AUDIO_RESPONSE_BYTES : MAX_TEXT_RESPONSE_BYTES, connection.timeoutMs, endpoint.value.networkPolicy.privateEndpoint !== null, signal);
    },
    async model(connection: ProviderConnection, body: Buffer, headers: Record<string, string>, maximum = MAX_RESPONSE_BYTES, signal?: AbortSignal): Promise<HttpResponse> {
      const endpoint = parseModelEndpoint(connection.baseUrl, connection.networkPolicy);
      if (!endpoint.ok || body.length > 128 * 1024)
        throw Error('NETWORK_POLICY');
      const url = new URL(endpoint.value.baseUrl + '/images/generations');
      // POST redirects are deliberately never followed, even on the same origin.
      return transfer(url, body, { 'content-type': 'application/json', 'content-length': String(body.length), ...headers }, maximum, connection.timeoutMs, endpoint.value.networkPolicy.privateEndpoint !== null, signal);
    },
    async download(locator: string, signal?: AbortSignal, maximum = MAX_IMAGE_BYTES): Promise<Uint8Array> {
      if (locator.length > 8192 || ![MAX_IMAGE_BYTES, MAX_VIDEO_BYTES].includes(maximum))
        throw Error('NETWORK_POLICY');
      let url = new URL(locator);
      const deadline = Date.now() + 30000;
      for (let hop = 0; hop <= 3; hop++) {
        const left = deadline - Date.now();
        if (left <= 0)
          throw Error('NETWORK_TIMEOUT');
        // No model grants, cookies or credentials enter this separate content path.
        const response = await transfer(url, null, {}, maximum, left, false, signal);
        if ([301, 302, 303, 307, 308].includes(response.status) && response.location && hop < 3) {
          url = new URL(response.location, url);
          continue;
        }
        if (response.status !== 200 || !response.bytes.length)
          throw Error('OUTPUT_DOWNLOAD_FAILED');
        return response.bytes;
      }
      throw Error('OUTPUT_DOWNLOAD_FAILED');
    },
  };
}
