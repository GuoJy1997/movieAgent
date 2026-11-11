import { expect, it, vi } from 'vitest';
import type { Session } from 'electron';
import { installMediaProtocol } from '../../apps/desktop/src/main/media-protocol.ts';
it('serves original ranges through bounded chunks and renews an expired URL by revalidating identity', async () => {
  let handler!: (r: Request) => Promise<Response>; let legacyReads = 0, closes = 0, changed = false;
  const bytes = Buffer.alloc(3 * 1024 * 1024, 7), sizes: number[] = [];
  const session = { protocol: { handle: (_: string, fn: typeof handler) => { handler = fn; }, unhandle() {} } } as unknown as Session;
  const api = installMediaProtocol(session, 'library', async () => { legacyReads++; return { ok: true, value: { bytes, mime: 'audio/wav', hash: 'a'.repeat(64) } }; }, {
    openMediaRead: async (_ref, expectedHash) => { if (expectedHash) expect(expectedHash).toBe('a'.repeat(64)); return changed ? { ok: false, error: { code: 'OBJECT_INTEGRITY_FAILED', message: 'changed' } } : { ok: true, value: { leaseId: 'lease', hash: 'a'.repeat(64), mime: 'audio/wav', byteLength: bytes.length, expiresAt: Date.now() + 120000 } }; },
    readMediaRange: async input => { sizes.push(input.length); return { ok: true, value: { leaseId: 'lease', offset: input.offset, bytes: bytes.subarray(input.offset, input.offset + input.length), eof: input.offset + input.length >= bytes.length } }; },
    closeMediaRead: async () => { closes++; },
  });
  try {
    const issued = await api.issue({ libraryId: 'library', ref: { kind: 'assetVersion', libraryId: 'library', assetId: 'asset', version: 1 }, variant: 'original' }); expect(issued.ok).toBe(true); if (!issued.ok) return;
    const response = await handler(new Request(issued.value, { headers: { Range: 'bytes=1048570-2097160' } }));
    expect(response.status).toBe(206); expect(response.headers.get('Content-Range')).toBe('bytes 1048570-2097160/3145728'); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(1048570, 2097161));
    expect(legacyReads).toBe(0); expect(sizes.every(size => size <= 1048576)).toBe(true); expect(closes).toBeGreaterThan(0);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 121000); expect((await handler(new Request(issued.value, { method: 'HEAD' }))).status).toBe(200);
    expect((await handler(new Request(issued.value, { headers: { Range: 'bytes=-0' } }))).status).toBe(416);
    changed = true; expect((await handler(new Request(issued.value))).status).toBe(403); changed = false;
    api.invalidate(); expect((await handler(new Request(issued.value))).status).toBe(403);
  } finally { vi.restoreAllMocks(); api.close(); }
});
