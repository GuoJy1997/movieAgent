import { createServer } from 'node:http';
export async function imageProviderServer() {
  let protocol = false; let protocolOutput: 'inline' | 'url' = 'inline';
  let posts = 0, gets = 0, downloads = 0, resultStatus = 200; let image: Buffer = Buffer.alloc(0); let onPost: (() => void) | undefined; let mode: 'accepted' | 'disconnect' | 'completed' | 'rejected' = 'accepted';
  let releaseResult: (() => void) | undefined; let heldResult: Promise<void> | undefined;
  let release: (() => void) | undefined; let held: Promise<void> | undefined;
  const server = createServer(async (req, res) => {
    if (req.url === '/result') { downloads++; if (heldResult) await heldResult; res.statusCode = resultStatus; res.end(image); return; }
    if (req.method === 'POST') { for await (const _chunk of req) { /* consume body */ } posts++; onPost?.(); if (held) await held; if (mode === 'disconnect') { req.socket.destroy(); return; } res.setHeader('Content-Type', 'application/json'); if (protocol) { res.statusCode = mode === 'rejected' ? 400 : 200; res.end(JSON.stringify(mode === 'completed' ? { data: [protocolOutput === 'url' ? { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/result?signed-fixture=private` } : { b64_json: image.toString('base64') }] } : { error: { code: 'fixture' } })); return; } res.end(JSON.stringify(mode === 'rejected' ? { kind: 'rejected' } : { kind: mode, providerTaskId: 'fixture-job-1' })); return; }
    gets++; if (held) await held; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ kind: mode === 'disconnect' ? 'accepted' : mode, providerTaskId: 'fixture-job-1' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture bind');
  return { url: `http://127.0.0.1:${address.port}`, setProtocolOutput(value: 'inline' | 'url') { protocolOutput = value; }, setProtocol(value: boolean) { protocol = value; }, get posts() { return posts; }, get gets() { return gets; }, get downloads() { return downloads; }, setImage(bytes: Buffer) { image = bytes; }, setResultStatus(status: number) { resultStatus = status; }, onPost(callback: () => void) { onPost = callback; }, setMode(value: typeof mode) { mode = value; }, holdResult() { heldResult = new Promise<void>(resolve => { releaseResult = resolve; }); }, releaseResult() { releaseResult?.(); heldResult = undefined; }, hold() { held = new Promise<void>(resolve => { release = resolve; }); }, release() { release?.(); held = undefined; }, async close() { releaseResult?.(); release?.(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
