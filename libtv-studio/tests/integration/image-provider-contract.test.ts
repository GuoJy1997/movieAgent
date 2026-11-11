import { afterEach, expect, it } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAIImagesAdapter } from '../../packages/providers/src/openai-images.ts';
import { createHttpTransport, isPublicAddress } from '../../packages/providers/src/http-transport.ts';
import { ArtifactSource } from '../../packages/providers/src/artifact-source.ts';
import { ProviderEvidence } from '../../packages/providers/src/probe.ts';
import { createImageGenerationCapability } from '../../apps/desktop/src/main/provider-capability.ts';
import { openLibrary, type LibraryHandle } from '../../packages/storage/src/database.ts';
import { CredentialVault } from '../../apps/desktop/src/main/credential-vault.ts';
import type { PreparedGeneration } from '../../packages/contracts/src/generation.ts';
const servers: Server[] = [], roots: string[] = [], libraries: LibraryHandle[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfV0AAAAASUVORK5CYII=', 'base64');
async function server(handle: (req: IncomingMessage, res: ServerResponse) => void) {
 const s = createServer(handle); servers.push(s); await new Promise<void>(r => s.listen(0,'127.0.0.1',r)); return `http://127.0.0.1:${(s.address() as any).port}`;
}
async function root() { const p = await mkdtemp(join(tmpdir(),'provider-contract-')); roots.push(p); return p; }
function plan(url: string): PreparedGeneration {
 const ref = {libraryId:'lib',id:'c',revision:1}, now = new Date().toISOString();
 const connection = { ...ref,name:'fixture',createdAt:now,adapterType:'openai-image-v1',baseUrl:url,credentialRef:null,headers:{},networkPolicy:{privateEndpoint:{hostname:'127.0.0.1',port:Number(new URL(url).port),purpose:'model-api'}},timeoutMs:1000,concurrency:1 };
 const model = {libraryId:'lib',id:'m',revision:1,name:'fixture',createdAt:now,modelId:'configured-model',connectionRef:ref,capabilities:{taskTypes:['text_to_image'],inputKinds:['text'],outputKinds:['image'],maxBatch:1},parameters:{},pricing:{status:'unknown'}};
 return {libraryId:'lib',preparedId:'prep',planHash:'a'.repeat(64),expiresAt:Date.now()+10000,projectId:'project',inputVersion:'v1',executionOwner:'human',runId:'run',prompt:'one tree',adapterId:'openai-image-v1',estimateMicros:null,currency:null,config:{schemaVersion:1,connection,model,profile:{libraryId:'lib',id:'p',revision:1,name:'fixture',createdAt:now,modelRef:{libraryId:'lib',id:'m',revision:1},parameters:{}},parameters:{size:'1024x1024',quality:'low'},pricing:{status:'unknown'}}} as unknown as PreparedGeneration;
}
const dispatch = {attemptId:'attempt',outputStagingId:'attempt-output',clientRequestId:'client',requestHash:'a'.repeat(64),retries:0 as const};
async function setup(handle: (req: IncomingMessage,res: ServerResponse)=>void) {
 const url = await server(handle), p = plan(url), dir = await root(), spool = new ArtifactSource(dir); const opened = await openLibrary({root:dir}); if(!opened.ok)throw Error(); libraries.push(opened.value); const evidence = new ProviderEvidence(opened.value);
 const vault = await CredentialVault.open(join(dir,'vault'), {isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''}, []);
 const cap = createImageGenerationCapability('lib', vault);
 const adapter = new OpenAIImagesAdapter(spool,evidence);
 const context = {requestImage:cap,evidence:'fixture' as const};
 return {url,p,dir,spool,evidence,vault,adapter,context};
}
afterEach(async()=>{ for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}for(const l of libraries.splice(0))await l.close();for(const p of roots.splice(0))await rm(p,{recursive:true,force:true}); });
it('sends only the supported fixed POST fields and persists inline bytes under the durable dispatch identity',async()=>{
 let observed:any;
 const s=await setup((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{observed={url:req.url,method:req.method,headers:req.headers,body:JSON.parse(body)};res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));});});
 const outcome=await s.adapter.submit(s.p,{...dispatch,...s.context});
 expect(observed).toMatchObject({url:'/images/generations',method:'POST',body:{model:'configured-model',prompt:'one tree',n:1,size:'1024x1024',quality:'low',output_format:'png'}});
 expect(Object.keys(observed.body).sort()).toEqual(['model','n','output_format','prompt','quality','size']);
 expect(outcome).toMatchObject({kind:'completed',providerTaskId:'client'});
 if(outcome.kind!=='completed'||!outcome.sourceRef)throw Error('missing spool');
 expect(await readFile(outcome.sourceRef.path)).toEqual(png);
 expect(await new ArtifactSource(s.dir).recover(dispatch.outputStagingId)).toEqual({ok:true,value:outcome.sourceRef});
 expect(await s.adapter.probe(s.p,s.context)).toMatchObject({configuration:'valid',authentication:'unknown',generation:'unverified',fixtureGeneration:true});
});
it.each([{seed:1},{style:'vivid'},{quality:'hd'},{size:'auto'},{n:2}])('rejects unsupported parameters before transport: %j',async parameters=>{
 let posts=0;const s=await setup((_q,r)=>{posts++;r.end('{}');});s.p.config.parameters=parameters as any;
 expect(s.adapter.validate(s.p).ok).toBe(false);expect(await s.adapter.submit(s.p,{...dispatch,...s.context})).toEqual({kind:'rejected'});expect(posts).toBe(0);
});
it.each([400,401,403,422,429])('classifies explicit HTTP %i rejection without retry',async status=>{
 let posts=0;const s=await setup((_q,r)=>{posts++;r.writeHead(status);r.end(JSON.stringify({error:{message:'private should not escape'}}));});
 expect(await s.adapter.submit(s.p,{...dispatch,...s.context})).toEqual({kind:'rejected'});expect(posts).toBe(1);
});
it('keeps disconnect and server error unknown without retry or fabricated reconciliation',async()=>{
 let posts=0;const s=await setup((q)=>{posts++;q.socket.destroy();});
 expect(await s.adapter.submit(s.p,{...dispatch,...s.context})).toEqual({kind:'unknown'});expect(posts).toBe(1);
 expect(await s.adapter.reconcile({clientRequestId:'client',providerTaskId:null,request:s.p},s.context)).toEqual({kind:'unsupported'});
});
it('bounds oversized protocol responses and never exposes provider error bodies',async()=>{
 const url=await server((_q,r)=>r.end('x'.repeat(1025))),p=plan(url);
 await expect(createHttpTransport().model(p.config.connection,Buffer.from('{}'),{},1024)).rejects.toThrow('RESPONSE_LIMIT');
});
it('records URL completion privately but does not extend a private model grant to output downloads',async()=>{
 const s=await setup((_q,r)=>r.end(JSON.stringify({data:[{url:'http://127.0.0.1/private?secret=signed'}]})));
 expect(await s.adapter.submit(s.p,{...dispatch,...s.context})).toMatchObject({kind:'completed',output:{kind:'url',url:'http://127.0.0.1/private?secret=signed'}});
 expect(await s.spool.materialize({kind:'url',url:s.url+'/private'},'attempt-output')).toMatchObject({ok:false,error:{code:'OUTPUT_DOWNLOAD_FAILED'}});
});
it('does not follow a generation redirect or forward credentials to another origin',async()=>{
 let destination=0,auth='';const target=await server((_q,r)=>{destination++;r.end('{}');});
 const s=await setup((q,r)=>{auth=q.headers.authorization??'';r.writeHead(307,{location:target});r.end();});
 const saved=await s.vault.put('dummy-key',{libraryId:'lib',connectionId:'c'},'session');if(!saved.ok)throw Error('vault');s.p.config.connection.credentialRef=saved.value;
 expect(await s.adapter.submit(s.p,{...dispatch,...s.context})).toEqual({kind:'unknown'});expect(auth).toBe('Bearer dummy-key');expect(destination).toBe(0);
});
it('rejects a foreign credential owner and malformed fixed capability request before network',async()=>{
 let count=0;const s=await setup((_q,r)=>{count++;r.end('{}');});s.p.libraryId='foreign';
 await expect(s.context.requestImage(s.p,dispatch)).rejects.toThrow();expect(count).toBe(0);
});
it.each(['127.0.0.1','169.254.169.254','10.1.2.3','100.64.0.1','192.0.0.1','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1'])('blocks special output address %s',address=>expect(isPublicAddress(address)).toBe(false));
it('rejects a public hostname resolving to a private address before making a socket',async()=>{
 const transport=createHttpTransport({resolve:async()=>[{address:'127.0.0.1',family:4}]});
 await expect(transport.download('https://public.example/image')).rejects.toThrow('NETWORK_POLICY');
});
it('marks completed unavailable if inline bytes cannot be preserved, without losing completion',async()=>{
 const s=await setup((_q,r)=>r.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]})));await writeFile(join(s.dir,'provider-spool'),'block directory');
 expect(await s.adapter.submit(s.p,{...dispatch,...s.context})).toMatchObject({kind:'completed',output:{kind:'unavailable'}});
});


it('reconciles a durable inline spool after crash before fact recording without another POST',async()=>{
 let posts=0;const s=await setup((_q,r)=>{posts++;r.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));});
 const initial=await s.adapter.submit(s.p,{...dispatch,...s.context});expect(initial.kind).toBe('completed');
 const restored=new OpenAIImagesAdapter(new ArtifactSource(s.dir),s.evidence);
 expect(await restored.reconcile({clientRequestId:'client',providerTaskId:null,request:s.p,outputStagingId:'attempt-output'},s.context)).toMatchObject({kind:'completed',providerTaskId:'client',sourceRef:{size:png.length}});expect(posts).toBe(1);
});
it('retains distinct verification records by connection revision and model with no free probe request',async()=>{
 let count=0;const s=await setup((_q,r)=>{count++;r.end('{}');});
 await s.adapter.probe(s.p,s.context);s.p.config.connection.revision=2;s.p.config.model.connectionRef.revision=2;s.p.config.model.modelId='another-model';await s.adapter.probe(s.p,s.context);
 expect(count).toBe(0);const rows=libraries[libraries.length-1]!.db.prepare('SELECT connection_revision,model_id,state_json FROM provider_verification ORDER BY connection_revision').all();expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({connection_revision:1,model_id:'configured-model'});expect(rows[1]).toMatchObject({connection_revision:2,model_id:'another-model'});expect(rows.every(r=>JSON.parse(r.state_json as string).generation==='unverified')).toBe(true);
});
it('recovers a fully synced partial plus hash manifest after interruption before rename',async()=>{
 const s=await setup((_q,r)=>r.end('{}'));const {mkdir}=await import('node:fs/promises');const {createHash}=await import('node:crypto');await mkdir(join(s.dir,'provider-spool'));
 await writeFile(join(s.dir,'provider-spool','attempt-output.image.partial'),png);await writeFile(join(s.dir,'provider-spool','attempt-output.image.sha256'),createHash('sha256').update(png).digest('hex'));
 expect(await s.spool.recover('attempt-output')).toMatchObject({ok:true,value:{size:68}});
});
it('refuses a staging directory redirected outside its owned root',async()=>{
 const s=await setup((_q,r)=>r.end('{}')),outside=await root();const {symlink,readdir}=await import('node:fs/promises');await symlink(outside,join(s.dir,'provider-spool'),'junction');
 expect(await s.spool.stage('attempt-output',png)).toMatchObject({ok:false});expect(await readdir(outside)).toEqual([]);
});
it('never rebinds an existing staging identity to different bytes',async()=>{
 const s=await setup((_q,r)=>r.end('{}'));expect(await s.spool.stage('attempt-output',png)).toMatchObject({ok:true});expect(await s.spool.stage('attempt-output',Buffer.from('other'))).toMatchObject({ok:false,error:{code:'OUTPUT_STAGING_CONFLICT'}});
});
it.each([['fixture','inline'],['real','inline'],['fixture','url']] as const)('registered adapter preserves trusted %s evidence and %s output through recovery',async(evidence,output)=>{
 const {imageProviderServer}=await import('../fixtures/image-provider-server.ts');
 const {startEngine}=await import('../../packages/engine/src/bootstrap.ts');
 const {imageRequestBody}=await import('../../packages/providers/src/openai-images.ts');
 const {default:sharp}=await import('sharp');
 const fixture=await imageProviderServer();fixture.setProtocol(true);fixture.setProtocolOutput(output);fixture.setMode('completed');fixture.setImage(await sharp({create:{width:3,height:2,channels:3,background:'#335577'}}).png().toBuffer());
 const directory=await root();let engine:any;let observedIntent=false;
 try{
  const started=await startEngine({root:directory,providerContext:{evidence,requestImage:async(p)=>{const request=imageRequestBody(p);if(!request.ok)throw Error();return createHttpTransport().model(p.config.connection,request.value,{});}}});if(!started.ok)throw Error();engine=started.value;
  const {DatabaseSync}=await import('node:sqlite');fixture.onPost(()=>{const db=new DatabaseSync(join(directory,'library.sqlite'),{readOnly:true});observedIntent=!!db.prepare('SELECT intent_json FROM task_attempt WHERE intent_json IS NOT NULL').get();db.close();});
  const execute=async(kind:string,payload:unknown)=>{const r=await engine.commands.execute({schemaVersion:1,libraryId:engine.identity.libraryId,connectionEpoch:'fixture',commandId:crypto.randomUUID(),kind,payload});expect(r).toMatchObject({ok:true});return r.value.result;};
  const project=await execute('project.create',{name:'protocol'}),p=plan(fixture.url);const {libraryId:_l,revision:_r,createdAt:_c,...connection}=p.config.connection;const ref=await execute('provider.saveConnection',{...connection,expectedRevision:0});
  const {libraryId:_ml,revision:_mr,createdAt:_mc,...model}=p.config.model;const modelRef=await execute('model.saveDefinition',{...model,expectedRevision:0,connectionRef:ref});const profile=await execute('profile.save',{id:'p',expectedRevision:0,name:'profile',modelRef,parameters:{}});
  const prepared=await execute('generation.prepare',{projectId:project.id,profileRef:profile,prompt:'fixture',inputVersion:'v1',executionOwner:'human',runId:'run'});
  const task=await execute('generation.approveAndEnqueue',{preparedId:prepared.preparedId,approvedPlanHash:prepared.planHash,currency:'USD',allowanceMicros:100000,budgetLimitMicros:100000,acknowledgeUnknown:true,executionOwner:'human',runId:'run'});
  const publication=evidence==='fixture'&&output==='inline'?new DatabaseSync(join(directory,'library.sqlite')):null;
  publication?.exec("CREATE TRIGGER hold_publication BEFORE INSERT ON artifact BEGIN SELECT RAISE(ABORT,'fixture'); END");
  expect(await engine.scheduler.run(task.attemptId)).toMatchObject({ok:true});expect(engine.generation.read(task.taskId)).toMatchObject({ok:true,value:output==='url'||publication?{providerState:'completed',collectionState:'retryable_failure'}:{state:'SUCCEEDED'}});expect(observedIntent).toBe(true);expect(fixture.posts).toBe(1);
  publication?.exec('DROP TRIGGER hold_publication');publication?.close();
  const check=new DatabaseSync(join(directory,'library.sqlite'),{readOnly:true});const publicData=JSON.stringify([engine.generation.list(),check.prepare('SELECT payload_json FROM domain_event').all(),check.prepare('SELECT * FROM command_receipt').all()]);expect(publicData).not.toContain('signed-fixture');expect(publicData).not.toContain('provider-spool');check.close();await engine.close();engine=undefined;
  const again=await startEngine({root:directory,providerContext:{evidence:'real',requestImage:async()=>{throw Error('MUST_NOT_SUBMIT');}}});if(!again.ok)throw Error();engine=again.value;await engine.scheduler.recover();expect(fixture.posts).toBe(1);expect(engine.modelConfig.listConnections().verification).toMatchObject([{generation:evidence==='real'?'verified':'unverified',fixtureGeneration:evidence==='fixture'&&output==='inline'}]);
 }finally{await engine?.close();await fixture.close();}
});
it('pins the checked DNS address to the socket and respects the exact model endpoint grant',async()=>{
 let calls=0,host='';const url=await server((q,r)=>{calls++;host=q.headers.host??'';r.end('{}');}),port=new URL(url).port,p=plan(url);
 p.config.connection.baseUrl=`http://fixture.local:${port}`;p.config.connection.networkPolicy.privateEndpoint={hostname:'fixture.local',port:Number(port),purpose:'model-api'};
 const transport=createHttpTransport({resolve:async name=>{expect(name).toBe('fixture.local');return [{address:'127.0.0.1',family:4}];}});
 expect((await transport.model(p.config.connection,Buffer.from('{}'),{})).status).toBe(200);expect(host).toBe(`fixture.local:${port}`);expect(calls).toBe(1);
 p.config.connection.networkPolicy.privateEndpoint.port++;await expect(transport.model(p.config.connection,Buffer.from('{}'),{})).rejects.toThrow('NETWORK_POLICY');expect(calls).toBe(1);
});
it('times out a held response with exactly one paid submission',async()=>{
 let calls=0;const s=await setup(()=>{calls++;});expect(await s.adapter.submit(s.p,{...dispatch,...s.context})).toEqual({kind:'unknown'});expect(calls).toBe(1);
});
it('keeps a 500 response unknown and malformed successful output completed unavailable',async()=>{
 let status=500;const s=await setup((_q,r)=>{r.statusCode=status;r.end('not-json');});expect(await s.adapter.submit(s.p,{...dispatch,...s.context})).toEqual({kind:'unknown'});status=200;expect(await s.adapter.submit(s.p,{...dispatch,...s.context})).toMatchObject({kind:'completed',output:{kind:'unavailable'}});
});

// A stale exclusive .partial must not prevent collection of an already completed provider result.
it('retries completed URL output after an interrupted partial without submitting again', async () => {
 const { startEngine } = await import('../../packages/engine/src/bootstrap.ts');
 const { mkdir } = await import('node:fs/promises');
 const { default: sharp } = await import('sharp');
 const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#335577' } }).png().toBuffer();
 let posts = 0, downloads = 0, available = false;
 const url = await server((request, response) => {
  if (request.method === 'POST') { posts++; response.end('{}'); return; }
  downloads++; response.statusCode = available ? 200 : 503; response.end(available ? bytes : Buffer.alloc(0));
 });
 const directory = await root();
 // The fixture-only downloader reaches our local HTTP server. Production public-address policy stays unchanged.
 const spool = new ArtifactSource(directory, { ...createHttpTransport(), download: async locator => {
  expect(locator).toBe(url + '/output');
  const response = await fetch(locator);
  if (!response.ok) throw Error('fixture unavailable');
  return new Uint8Array(await response.arrayBuffer());
 } });
 const started = await startEngine({ root: directory, generation: {
  adapter: { adapterId: 'fixture-url', validate: input => ({ ok: true, value: input }), submit: async (_input, context) => {
   await fetch(url, { method: 'POST' });
   return { kind: 'completed', providerTaskId: context.clientRequestId, output: { kind: 'url', url: url + '/output' } };
  }, reconcile: async () => ({ kind: 'unsupported' }) },
  context: { evidence: 'fixture' }, materializeOutput: (output, _prepared, _context, id) => spool.materialize(output, id),
 } });
 if (!started.ok) throw Error(started.error.code);
 const engine = started.value;
 const execute = async (kind: string, payload: unknown) => {
  const result = await engine.commands.execute({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'fixture', commandId: crypto.randomUUID(), kind, payload });
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw Error(result.error.code);
  return result.value.result as any;
 };
 try {
  const project = await execute('project.create', { name: 'interrupted output' });
  const p = plan(url), { libraryId: _l, revision: _r, createdAt: _c, ...connection } = p.config.connection;
  const connectionRef = await execute('provider.saveConnection', { ...connection, expectedRevision: 0 });
  const { libraryId: _ml, revision: _mr, createdAt: _mc, ...model } = p.config.model;
  const modelRef = await execute('model.saveDefinition', { ...model, expectedRevision: 0, connectionRef });
  const profileRef = await execute('profile.save', { id: 'p', name: 'fixture', expectedRevision: 0, modelRef, parameters: {} });
  const prepared = await execute('generation.prepare', { projectId: project.id, profileRef, prompt: 'fixture', inputVersion: 'v1', executionOwner: 'human', runId: 'run' });
  const task = await execute('generation.approveAndEnqueue', { preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, currency: 'USD', allowanceMicros: 100000, budgetLimitMicros: 100000, acknowledgeUnknown: true, executionOwner: 'human', runId: 'run' });
  await engine.scheduler.run(task.attemptId);
  expect(engine.generation.read(task.taskId)).toMatchObject({ ok: true, value: { providerState: 'completed', collectionState: 'retryable_failure' } });
  await mkdir(join(directory, 'provider-spool'));
  await writeFile(join(directory, 'provider-spool', task.attemptId + '-output.image.partial'), bytes.subarray(0, 9));
  available = true;
  const retried = await execute('task.retryCollection', { taskId: task.taskId });
  expect(retried).toMatchObject({ state: 'SUCCEEDED', providerState: 'completed', collectionState: 'durable' });
  expect(posts).toBe(1); expect(downloads).toBe(2);
  const recovered = await spool.recover(task.attemptId + '-output');
  expect(recovered).toMatchObject({ ok: true });
  if (recovered.ok) expect(await readFile(recovered.value.path)).toEqual(bytes);
 } finally { await engine.close(); }
});

it.each(['truncated-manifest', 'valid-manifest'])('repairs uncommitted bytes with %s without changing a valid hash binding', async mode => {
 const directory = await root(), spool = new ArtifactSource(directory);
 const { mkdir } = await import('node:fs/promises');
 const { createHash } = await import('node:crypto');
 await mkdir(join(directory, 'provider-spool'));
 const path = join(directory, 'provider-spool', 'attempt-output.image');
 await writeFile(path + '.partial', png.subarray(0, 9));
 await writeFile(path + '.sha256', mode === 'valid-manifest' ? createHash('sha256').update(png).digest('hex') : 'incomplete');
 if (mode === 'valid-manifest') {
  expect(await spool.stage('attempt-output', Buffer.from('different'))).toMatchObject({ ok: false });
  expect(await readFile(path + '.partial')).toEqual(png.subarray(0, 9));
 }
 expect(await spool.stage('attempt-output', png)).toMatchObject({ ok: true });
 expect(await readFile(path)).toEqual(png);
});

it('does not replace a final identity without a manifest or remove redirected partial paths', async () => {
 const directory = await root(), outside = await root(), spool = new ArtifactSource(directory);
 const { mkdir, symlink, lstat } = await import('node:fs/promises');
 await mkdir(join(directory, 'provider-spool'));
 const path = join(directory, 'provider-spool', 'attempt-output.image');
 await writeFile(path, Buffer.from('committed identity'));
 expect(await spool.stage('attempt-output', png)).toMatchObject({ ok: false });
 expect(await readFile(path)).toEqual(Buffer.from('committed identity'));
 await writeFile(join(outside, 'sentinel'), 'do not touch');
 const redirected = join(directory, 'provider-spool', 'another-output.image.partial');
 await symlink(outside, redirected, 'junction');
 expect(await spool.stage('another-output', png)).toMatchObject({ ok: false });
 expect((await lstat(redirected)).isSymbolicLink()).toBe(true);
 expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('do not touch');
});
it('serializes concurrent repair attempts for one uncommitted staging identity', async () => {
 const directory = await root(), spool = new ArtifactSource(directory);
 const { mkdir } = await import('node:fs/promises');
 await mkdir(join(directory, 'provider-spool'));
 await writeFile(join(directory, 'provider-spool', 'attempt-output.image.partial'), 'unfinished');
 const results = await Promise.all([spool.stage('attempt-output', png), spool.stage('attempt-output', png), spool.stage('attempt-output', png)]);
 expect(results.every(result => result.ok)).toBe(true);
 expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
});
