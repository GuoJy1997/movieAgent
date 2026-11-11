import { expect, it } from 'vitest';
import type { Session } from 'electron';
import type { ReadLease } from '../../packages/contracts/src/media-info.ts';
import { installMediaProtocol, type PrivilegedMediaReader } from '../../apps/desktop/src/main/media-protocol.ts';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const input = { libraryId: 'library', ref: { kind: 'assetVersion' as const, libraryId: 'library', assetId: 'asset', version: 1 }, variant: 'original' as const };
const lease = (id: string, expired = false): ReadLease => ({ leaseId: id, hash: 'a'.repeat(64), mime: 'audio/wav', byteLength: 1, expiresAt: expired ? 0 : Date.now() + 120000 });
function harness(reader: PrivilegedMediaReader) {
  let handle!: (r: Request) => Promise<Response>;
  const session = { protocol: { handle: (_: string, callback: typeof handle) => { handle = callback; }, unhandle() {} } } as unknown as Session;
  const api = installMediaProtocol(session, 'library', async () => { throw Error('legacy read unexpected'); }, reader);
  return { api, request: (url: string, signal?: AbortSignal) => handle(new Request(url, { signal })) };
}
it.each(['invalidate', 'close'] as const)('does not publish an issue completed after %s', async action => {
  const opened = deferred<ReadLease>(), entered = deferred<void>(), closed: string[] = [];
  const h = harness({ openMediaRead: async () => { entered.resolve(); return { ok: true, value: await opened.promise }; }, readMediaRange: async () => { throw Error('unexpected'); }, closeMediaRead: async id => { closed.push(id); } });
  const issued = h.api.issue(input); await entered.promise; h.api[action](); opened.resolve(lease('late-issue'));
  try { expect(await issued).toMatchObject({ ok: false }); expect(closed).toContain('late-issue'); } finally { h.api.close(); }
});
it.each(['invalidate', 'cancel', 'abort'] as const)('closes a late renewal and does not read after %s', async action => {
  const renewal = deferred<ReadLease>(), entered = deferred<void>(), closed: string[] = []; let opens = 0, reads = 0;
  const h = harness({ openMediaRead: async () => { opens++; if (opens === 3) { entered.resolve(); return { ok: true, value: await renewal.promise }; } return { ok: true, value: lease(`open-${opens}`, opens === 2) }; }, readMediaRange: async () => { reads++; return { ok: true, value: { leaseId: 'renewed', offset: 0, bytes: new Uint8Array([42]), eof: true } }; }, closeMediaRead: async id => { closed.push(id); } });
  const issued = await h.api.issue(input); if (!issued.ok) throw Error('issue'); const abort = new AbortController(); const response = await h.request(issued.value, abort.signal); const reader = response.body!.getReader();
  await entered.promise;
  if (action === 'invalidate') h.api.invalidate(); else if (action === 'abort') abort.abort(); else await reader.cancel();
  renewal.resolve(lease('late-renewal'));
  try { if (action === 'cancel') expect(await reader.read()).toEqual({ done: true, value: undefined }); else await expect(reader.read()).rejects.toThrow(); await new Promise(resolve => setTimeout(resolve, 0)); expect(reads).toBe(0); expect(closed).toContain('late-renewal'); }
  finally { h.api.close(); }
});
it.each(['invalidate', 'cancel', 'abort'] as const)('does not enqueue a pending read completed after %s', async action => {
  const chunk = deferred<Uint8Array>(), entered = deferred<void>(), closed: string[] = [];
  const h = harness({ openMediaRead: async () => ({ ok: true, value: lease('reading') }), readMediaRange: async () => { entered.resolve(); return { ok: true, value: { leaseId: 'reading', offset: 0, bytes: await chunk.promise, eof: true } }; }, closeMediaRead: async id => { closed.push(id); } });
  const issued = await h.api.issue(input); if (!issued.ok) throw Error('issue'); const abort = new AbortController(); const response = await h.request(issued.value, abort.signal); const reader = response.body!.getReader(); await entered.promise;
  if (action === 'invalidate') h.api.invalidate(); else if (action === 'abort') abort.abort(); else await reader.cancel(); chunk.resolve(new Uint8Array([42]));
  try { if (action === 'cancel') expect(await reader.read()).toEqual({ done: true, value: undefined }); else await expect(reader.read()).rejects.toThrow(); await new Promise(resolve => setTimeout(resolve, 0)); expect(closed).toContain('reading'); }
  finally { h.api.close(); }
});

it('revalidates repeated fixed-cache authorization without exhausting URL capacity',async()=>{
 let allowed=true,serial=0;const ref={libraryId:'library',cacheId:'a'.repeat(64),sourceHash:'b'.repeat(64),recipeHash:'c'.repeat(64)};
 const h=harness({openMediaRead:async()=>({ok:true,value:lease('original')}),readMediaRange:async()=>{throw Error('unexpected original');},closeMediaRead:async()=>{},openDerivedMediaRead:async()=>allowed?{ok:true,value:lease('derived-'+(++serial))}:{ok:false,error:{code:'DERIVED_MEDIA_MISSING',message:'revoked'}},readDerivedMediaRange:async r=>({ok:true,value:{leaseId:r.leaseId,offset:r.offset,bytes:new Uint8Array([42]),eof:true}}),closeDerivedMediaRead:async()=>{}});
 try{let url='';for(let i=0;i<600;i++){const result=await h.api.issueDerived(ref);expect(result.ok,'authorization '+i).toBe(true);if(result.ok)url=result.value;}expect((await h.request(url)).status).toBe(200);allowed=false;expect(await h.api.issueDerived(ref)).toMatchObject({ok:false,error:{code:'DERIVED_MEDIA_MISSING'}});expect((await h.request(url)).status).toBe(403);}finally{h.api.close();}
});

it('keeps distinct URL capacity bounded and revokes reused authorizations on workspace invalidation',async()=>{
 let serial=0;const base={libraryId:'library',cacheId:'0'.repeat(64),sourceHash:'b'.repeat(64),recipeHash:'c'.repeat(64)};
 const h=harness({openMediaRead:async()=>({ok:true,value:lease('original')}),readMediaRange:async()=>{throw Error('unexpected');},closeMediaRead:async()=>{},openDerivedMediaRead:async()=>({ok:true,value:lease('bounded-'+(++serial))}),readDerivedMediaRange:async r=>({ok:true,value:{leaseId:r.leaseId,offset:r.offset,bytes:new Uint8Array([42]),eof:true}}),closeDerivedMediaRead:async()=>{}});
 try{let first='';for(let i=0;i<512;i++){const r=await h.api.issueDerived({...base,cacheId:i.toString(16).padStart(64,'0')});expect(r.ok).toBe(true);if(i===0&&r.ok)first=r.value;}expect(await h.api.issueDerived({...base,cacheId:'f'.repeat(64)})).toMatchObject({ok:false,error:{code:'MEDIA_CAPACITY'}});expect(await h.api.issueDerived(base)).toMatchObject({ok:true});h.api.invalidate();expect((await h.request(first)).status).toBe(403);expect(await h.api.issueDerived(base)).toMatchObject({ok:true});}finally{h.api.close();}
});

it('releases each authorized consumer, keeps a shared consumer valid, and rejects forged release URLs',async()=>{
 let serial=0;const h=harness({openMediaRead:async()=>({ok:true,value:lease('release-'+(++serial))}),readMediaRange:async r=>({ok:true,value:{leaseId:r.leaseId,offset:0,bytes:new Uint8Array([42]),eof:true}}),closeMediaRead:async()=>{}});
 try{const a=await h.api.issue(input),b=await h.api.issue(input);if(!a.ok||!b.ok)throw Error('issue');expect(a.value).toBe(b.value);expect((h.api as any).release(a.value.replace('/library/','/other/')).ok).toBe(false);expect((h.api as any).release(a.value+'?extra=1').ok).toBe(false);expect((h.api as any).release('file:///outside').ok).toBe(false);expect((h.api as any).release(a.value).ok).toBe(true);const response=await h.request(b.value);expect(response.status).toBe(200);await response.arrayBuffer();expect((h.api as any).release(b.value).ok).toBe(true);expect((await h.request(a.value)).status).toBe(403);expect((h.api as any).release(a.value).ok).toBe(true);
 for(let i=0;i<600;i++){const r=await h.api.issue({...input,ref:{...input.ref,assetId:'item'+i}});expect(r.ok).toBe(true);if(r.ok)(h.api as any).release(r.value);}
 }finally{h.api.close();}
});
