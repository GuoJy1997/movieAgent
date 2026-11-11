import{channel}from'node:diagnostics_channel';
import{isDeepStrictEqual}from'node:util';
let nextProtocol=0;
import { isDerivedMediaRef, type DerivedMediaRef } from '../../../../packages/contracts/src/render.ts';
import { randomUUID } from 'node:crypto';
import type { Session } from 'electron';
import { parseMediaRead, type MediaRead, type MediaReadInput, type MediaReference } from '../../../../packages/contracts/src/assets.ts';
import type { MediaChunk, MediaRangeRequest, ReadLease } from '../../../../packages/contracts/src/media-info.ts';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
/** Each workspace gets an isolated session. URLs are expiring capabilities, never storage paths. */
export interface PrivilegedMediaReader {
  openMediaRead(ref: MediaReference, expectedHash?: string): Promise<Result<ReadLease>>;
  openDerivedMediaRead?(ref: DerivedMediaRef, expectedHash?: string): Promise<Result<ReadLease>>;
  readDerivedMediaRange?(input: MediaRangeRequest): Promise<Result<MediaChunk>>;
  closeDerivedMediaRead?(leaseId: string): Promise<void>;
  readMediaRange(input: MediaRangeRequest): Promise<Result<MediaChunk>>;
  closeMediaRead(leaseId: string): Promise<void>;
}
export function installMediaProtocol(session: Session, libraryId: string, read: (input: MediaReadInput) => Promise<Result<MediaRead>>, bounded?: PrivilegedMediaReader) {
  type Capability={input:MediaReadInput|null;variant:'original'|'thumbnail'|'derived';derived?:DerivedMediaRef;hash:string;expiresAt:number;owners?:number};
  const capabilities = new Map<string,Capability>();
  const derivedLeases = new Set<string>();
  const active = new Set<string>(), streams = new Set<() => void>(); let closed = false, generation = 0;
  const metrics=channel('movieagent.media.protocol'),protocolId=String(++nextProtocol);
  const report=()=>{if(metrics.hasSubscribers)metrics.publish({protocolId,capabilities:capabilities.size,activeLeases:active.size,streams:streams.size});};report();
  async function closeLease(id:string){active.delete(id);const derived=derivedLeases.delete(id);report();if(derived)await bounded?.closeDerivedMediaRead?.(id);else await bounded?.closeMediaRead(id);report();}
  function issueCapability(value:Capability):Result<string>{
    const now=Date.now();for(const[token,cap]of capabilities)if(cap.expiresAt<=now)capabilities.delete(token);
    for(const[token,cap]of capabilities)if(cap.variant===value.variant&&cap.hash===value.hash&&isDeepStrictEqual(cap.input,value.input)&&isDeepStrictEqual(cap.derived,value.derived)){cap.expiresAt=value.expiresAt;cap.owners=(cap.owners??1)+1;report();return ok('app-media://media/'+libraryId+'/'+token+'/'+cap.variant);}
    if(capabilities.size>=512){report();return fail('MEDIA_CAPACITY','预览过多，请稍后重试。');}
    const token=randomUUID();capabilities.set(token,{...value,owners:1});report();return ok('app-media://media/'+libraryId+'/'+token+'/'+value.variant);
  }
  const openCapability = (cap: {input:MediaReadInput|null;derived?:DerivedMediaRef;hash:string}) => cap.derived ? bounded?.openDerivedMediaRead?.(cap.derived,cap.hash) ?? Promise.resolve(fail('MEDIA_UNAVAILABLE','派生读取不可用。')) : bounded!.openMediaRead(cap.input!.ref,cap.hash);
  session.protocol.handle('app-media', async request => {
    const url = new URL(request.url);
    const match = /^\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/(original|thumbnail|derived)$/.exec(url.pathname);
    const capability = match && capabilities.get(match[2]!);
    if (closed || url.hostname !== 'media' || url.search || url.hash || !match || match[1] !== libraryId || !capability || capability.variant !== match[3]) return new Response(null, { status: 403 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const epoch = generation;
    const authorized = () => !closed && generation === epoch && capabilities.get(match[2]!) === capability && !request.signal.aborted;
    if (!authorized()) return new Response(null, { status: 403 });
    let lease: ReadLease | undefined, bytes: Uint8Array | undefined, mime: string, size: number;
    if (bounded && (capability.variant === 'original' || capability.derived)) {
      const opened = await openCapability(capability);
      if (opened.ok && capability.derived) derivedLeases.add(opened.value.leaseId);
      if (!authorized()) { if (opened.ok) await closeLease(opened.value.leaseId); return new Response(null, { status: 403 }); }
      if (!opened.ok) { capabilities.delete(match[2]!);report(); return new Response(null, { status: opened.error.code === 'MEDIA_NOT_FOUND' ? 404 : 403 }); }
      lease = opened.value; if(capability.derived)derivedLeases.add(lease.leaseId); active.add(lease.leaseId);report(); mime = lease.mime; size = lease.byteLength;
    } else {
      const result = await read(capability.input!); if (!authorized() || !result.ok || result.value.hash !== capability.hash) return new Response(null, { status: 403 });
      bytes = result.value.bytes; mime = result.value.mime; size = bytes.byteLength;
    }
    // Renewal revalidates the same fixed object under the current workspace authority.
    capability.expiresAt = Date.now() + 120000;
    const headers = new Headers({ 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, ETag', ETag: `"${capability.hash}"` });
    let start = 0, end = size - 1; const range = request.headers.get('range');
    if (range !== null) {
      const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!parsed || (!parsed[1] && !parsed[2])) { if (lease) await closeLease(lease.leaseId); headers.set('Content-Range', `bytes */${size}`); return new Response(null, { status: 416, headers }); }
      if (parsed[1]) { start = Number(parsed[1]); end = parsed[2] ? Math.min(Number(parsed[2]), size - 1) : size - 1; }
      else { const suffix = Number(parsed[2]); start = Number.isSafeInteger(suffix) && suffix > 0 ? Math.max(0, size - suffix) : size; }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) { if (lease) await closeLease(lease.leaseId); headers.set('Content-Range', `bytes */${size}`); return new Response(null, { status: 416, headers }); }
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    headers.set('Content-Length', String(end - start + 1));
    if (request.method === 'HEAD') { if (lease) await closeLease(lease.leaseId); return new Response(null, { status: authorized() ? range === null ? 200 : 206 : 403, headers }); }
    if (!lease) return new Response(new Uint8Array(bytes!.slice(start, end + 1)), { status: range === null ? 200 : 206, headers });
    let offset = start, current = lease, finished = false;
    let revoke!: () => void;
    const detach = () => { streams.delete(revoke);report(); request.signal.removeEventListener('abort', revoke); };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        revoke = () => {
          if (finished) return; finished = true; detach();
          void closeLease(current.leaseId).catch(() => undefined);
          controller.error(Error('MEDIA_CAPABILITY_REVOKED'));
        };
        streams.add(revoke);report(); request.signal.addEventListener('abort', revoke, { once: true });
        if (!authorized()) revoke();
      },
      async pull(controller) {
        if (finished) return;
        if (!authorized()) { revoke(); return; }
        if (current.expiresAt <= Date.now()) {
          await closeLease(current.leaseId); if (finished || !authorized()) { revoke(); return; }
          const renewed = await openCapability(capability);
          if (renewed.ok && capability.derived) derivedLeases.add(renewed.value.leaseId);
          if (finished || !authorized()) { if (renewed.ok) await closeLease(renewed.value.leaseId); revoke(); return; }
          if (!renewed.ok) { finished = true; detach(); controller.error(Error('MEDIA_RENEWAL_FAILED')); return; } current = renewed.value; if(capability.derived)derivedLeases.add(current.leaseId); active.add(current.leaseId);report();
        }
        const length = Math.min(1024 * 1024, end - offset + 1);
        const result = capability.derived ? await bounded!.readDerivedMediaRange!({ leaseId: current.leaseId, offset, length }) : await bounded!.readMediaRange({ leaseId: current.leaseId, offset, length });
        if (finished || !authorized()) { revoke(); return; }
        if (!result.ok || result.value.offset !== offset || result.value.bytes.byteLength < 1 || result.value.bytes.byteLength > length) { finished = true; detach(); void closeLease(current.leaseId).catch(() => undefined); controller.error(Error('MEDIA_READ_FAILED')); return; }
        offset += result.value.bytes.byteLength; controller.enqueue(new Uint8Array(result.value.bytes));
        if (offset > end) { finished = true; detach(); controller.close(); await closeLease(current.leaseId); }
      },
      async cancel() { finished = true; detach(); await closeLease(current.leaseId); },
    }, { highWaterMark: 1 });
    return new Response(body, { status: range === null ? 200 : 206, headers });
  });
  return {
    /** Drops one consumer's authorization. It never grants access or resolves paths. */
    release(input:unknown):Result<void>{
      if(typeof input!=='string'||input.length>512)return fail('INVALID_INPUT','媒体授权无效。');
      let url:URL;try{url=new URL(input);}catch{return fail('INVALID_INPUT','媒体授权无效。');}
      const match=/^\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/(original|thumbnail|derived)$/.exec(url.pathname);
      if(url.protocol!=='app-media:'||url.hostname!=='media'||url.port||url.username||url.password||url.search||url.hash||!match||match[1]!==libraryId)return fail('INVALID_INPUT','媒体授权无效。');
      const cap=capabilities.get(match[2]!);if(cap&&cap.variant!==match[3])return fail('INVALID_INPUT','媒体授权无效。');
      if(cap){cap.owners=(cap.owners??1)-1;if(cap.owners<=0)capabilities.delete(match[2]!);report();}return ok(undefined);
    },
    invalidate() { generation++; capabilities.clear();report(); for (const revoke of streams) revoke(); for (const id of active) void closeLease(id).catch(() => undefined); },
    async issue(input: unknown): Promise<Result<string>> {
      const parsed = parseMediaRead(input); if (!parsed.ok) return parsed;
      const epoch = generation, authorized = () => !closed && generation === epoch;
      if (!authorized()) return fail('MEDIA_CAPABILITY_REVOKED', '媒体授权已失效。');
      if (parsed.value.libraryId !== libraryId || parsed.value.ref.libraryId !== libraryId) return fail('WRONG_LIBRARY', '媒体属于其他资料库。');
      let hash: string;
      if (bounded && parsed.value.variant === 'original') { const result = await bounded.openMediaRead(parsed.value.ref); if (!result.ok) return result; hash = result.value.hash; await bounded.closeMediaRead(result.value.leaseId); }
      else { const result = await read(parsed.value); if (!result.ok) return result; hash = result.value.hash; }
      if (!authorized()) return fail('MEDIA_CAPABILITY_REVOKED', '媒体授权已失效。');
      return issueCapability({input:parsed.value,variant:parsed.value.variant,hash,expiresAt:Date.now()+120000});
    },
    async issueDerived(input: unknown): Promise<Result<string>> {
      if (!isDerivedMediaRef(input) || input.libraryId !== libraryId) return fail('INVALID_DERIVED_REFERENCE','派生引用无效。');
      const epoch = generation;
      if (closed || !bounded?.openDerivedMediaRead || !bounded.readDerivedMediaRange || !bounded.closeDerivedMediaRead) return fail('MEDIA_UNAVAILABLE','派生媒体入口不可用。');
      const opened = await bounded.openDerivedMediaRead(input);
      if (!opened.ok) return opened;
      await bounded.closeDerivedMediaRead(opened.value.leaseId);
      if (closed || generation !== epoch) return fail('MEDIA_CAPABILITY_REVOKED','媒体授权失效。');
      return issueCapability({input:null,variant:'derived',derived:input,hash:opened.value.hash,expiresAt:Date.now()+120000});
    },
    close() { closed = true; generation++; capabilities.clear();report(); for (const revoke of streams) revoke(); for (const id of active) void closeLease(id).catch(() => undefined); session.protocol.unhandle('app-media'); },
  };
}
