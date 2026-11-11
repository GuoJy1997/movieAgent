import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap';
import { CredentialVault } from '../../apps/desktop/src/main/credential-vault';
import { importModelConfig } from '../../apps/desktop/src/main/model-config-import';
import { createVideoGenerationCapability, createVideoQueryCapability } from '../../apps/desktop/src/main/provider-capability';
import { ok } from '../../packages/contracts/src/result';
import type { CredentialStatus } from '../../packages/contracts/src/models';
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));
import * as configFile from '../../apps/desktop/src/main/model-config-file';
import { modelConfigStore } from '../../apps/desktop/src/main/model-config-store';

const roots: string[] = [];
const provider = { id: 'chat', name: 'Fixture chat', kind: 'text', baseURL: 'https://chat.example/v1', apiKey: 'fixture-private-key', modelId: 'chat-1', allowPrivateEndpoint: false };
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'config-write-')); roots.push(root); const path = join(root, 'models.json'); await writeFile(path, JSON.stringify({ schemaVersion: 1, providers: [provider] })); return path; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it('reads V2 adapter parameters and permits an explicit keyless configured endpoint', async () => {
  const path = await fixture();
  await writeFile(path, JSON.stringify({ schemaVersion: 2, providers: [{ ...provider, apiKey: '', adapterType: 'openai-chat-v1', parameters: { max_tokens: 2048 }, pricing: { status: 'unknown' } }] }));
  expect(await configFile.loadModelConfig(path)).toMatchObject({ ok: true, value: { schemaVersion: 2, providers: [{ state: 'unconfigured', baseURL: provider.baseURL, parameters: { max_tokens: 2048 } }] } });
});

it('rejects V2 unsupported parameters and contradictory adapter capability', async () => {
  const path = await fixture();
  for (const change of [{ parameters: { max_tokens: 8193 } }, { adapterType: 'minimax-video-v2' }, { pricing: { status: 'configured', currency: 'USD', perImage: 1, version: 'v1' } }]) {
    await writeFile(path, JSON.stringify({ schemaVersion: 2, providers: [{ ...provider, adapterType: 'openai-chat-v1', parameters: {}, pricing: { status: 'unknown' }, ...change }] }));
    expect((await configFile.loadModelConfig(path)).ok).toBe(false);
  }
});

it.each([1,2])('enforces the 32-entry bound and duplicate IDs for schema %s',async schemaVersion=>{
  const path=await fixture();const p=schemaVersion===1?provider:{...provider,adapterType:'openai-chat-v1',parameters:{},pricing:{status:'unknown'}};
  const providers=Array.from({length:32},(_,i)=>({...p,id:`entry-${i}`}));
  await writeFile(path,JSON.stringify({schemaVersion,providers}));expect((await configFile.loadModelConfig(path)).ok).toBe(true);
  for(const entries of [[...providers,{...p,id:'entry-32'}],[...providers.slice(1),providers[1]]]){await writeFile(path,JSON.stringify({schemaVersion,providers:entries}));expect((await configFile.loadModelConfig(path)).ok).toBe(false);}
});

it.each(['openai-image-v1','openai-image-edit-v1'])('supports explicit native image size/quality and omission for %s',async adapterType=>{
  const path=await fixture();
  const entry={...provider,kind:'image',adapterType,parameters:{size:'1536x1024',quality:'high'},pricing:{status:'unknown'}};
  await writeFile(path,JSON.stringify({schemaVersion:2,providers:[entry]}));
  expect(await configFile.loadModelConfig(path)).toMatchObject({ok:true,value:{providers:[{parameters:{size:'1536x1024',quality:'high'}}]}});
  await writeFile(path,JSON.stringify({schemaVersion:2,providers:[{...entry,parameters:{}}]}));
  expect(await configFile.loadModelConfig(path)).toMatchObject({ok:true,value:{providers:[{parameters:{}}]}});
  for(const parameters of [{size:'2048x2048'},{quality:'standard'},{seed:42},{style:'vivid'}]){await writeFile(path,JSON.stringify({schemaVersion:2,providers:[{...entry,parameters}]}));expect((await configFile.loadModelConfig(path)).ok).toBe(false);}
});

it('writes V2 atomically with CAS, redacts keys and preserves unchanged secrets', async () => {
  const path = await fixture(), store = modelConfigStore(path);
  const before = await store.readPublic(); if (!before.ok) throw Error('read');
  expect(JSON.stringify(before)).not.toContain(provider.apiKey);
  expect(before.value.providers[0]).toMatchObject({ hasKey: true, parameters: { max_tokens: 1024 } });
  const { hasKey: _, state: _state, ...fields } = before.value.providers[0]!;
  const draft = { ...fields, name: 'Updated', apiKey: '', clearKey: false };
  expect(await store.save({ expectedVersion: before.value.version, provider: draft })).toMatchObject({ ok: true });
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ schemaVersion: 2, providers: [{ name: 'Updated', apiKey: provider.apiKey }] });
  expect(await store.save({ expectedVersion: before.value.version, provider: draft })).toMatchObject({ ok: false, error: { code: 'MODEL_CONFIG_CONFLICT' } });
  const current = await store.readPublic(); if (!current.ok) throw Error('read');
  expect(await store.save({ expectedVersion: current.value.version, provider: { ...draft, clearKey: true } })).toMatchObject({ ok: true });
  expect(await store.readPublic()).toMatchObject({ ok: true, value: { providers: [{ hasKey: false, state: 'unconfigured', baseURL: provider.baseURL }] } });
});

it('rejects secrets in public fields including a cleared or replaced old key, without damaging the file', async () => {
  const path = await fixture(), store = modelConfigStore(path), before = await store.readPublic(); if (!before.ok) throw Error('read');
  const { hasKey: _, state: _state, ...fields } = before.value.providers[0]!;
  const bytes = await readFile(path, 'utf8');
  for (const apiKey of ['', 'replacement-fixture-key']) expect(await store.save({ expectedVersion: before.value.version, provider: { ...fields, name: provider.apiKey, apiKey, clearKey: !apiKey } })).toMatchObject({ ok: false, error: { code: 'MODEL_CONFIG_SECRET_IN_PUBLIC_FIELD' } });
  expect(await readFile(path, 'utf8')).toBe(bytes);
  await writeFile(path, bytes + '\n');
  expect(await store.remove({ expectedVersion: before.value.version, providerId: 'chat' })).toMatchObject({ ok: false, error: { code: 'MODEL_CONFIG_CONFLICT' } });
});

it('rejects quoted old keys pasted into public pricing metadata when clearing the key', async()=>{
  const path=await fixture();const key='quoted-"-fixture-secret';
  await writeFile(path,JSON.stringify({schemaVersion:1,providers:[{...provider,kind:'image',apiKey:key}]}));
  const store=modelConfigStore(path),before=await store.readPublic();if(!before.ok)throw Error('read');
  const {hasKey:_k,state:_s,...fields}=before.value.providers[0]!;
  expect(await store.save({expectedVersion:before.value.version,provider:{...fields,apiKey:'',clearKey:true,pricing:{status:'configured',currency:'CNY',perImage:1,version:key}}})).toMatchObject({ok:false,error:{code:'MODEL_CONFIG_SECRET_IN_PUBLIC_FIELD'}});
});

it('serializes actual separate writers and recovers an OS lock after its owning process terminates', async () => {
  const path = await fixture(), store = modelConfigStore(path), before = await store.readPublic(); if (!before.ok) throw Error('read');
  const moduleURL = pathToFileURL(join(process.cwd(), 'apps/desktop/src/main/model-config-store.ts')).href;
  const writer = `import {modelConfigStore} from ${JSON.stringify(moduleURL)}; let input='';for await(const c of process.stdin)input+=c;const {path,version}=JSON.parse(input);process.stdout.write(JSON.stringify(await modelConfigStore(path).remove({expectedVersion:version,providerId:'chat'})));`;
  const run = async () => { const child = spawn(process.execPath, ['--input-type=module','-e', writer], { stdio: ['pipe','pipe','pipe'], windowsHide: true }); let out=''; child.stdout.on('data',d=>out+=d); child.stdin.end(JSON.stringify({path,version:before.value.version})); await once(child,'exit'); return JSON.parse(out); };
  const results = await Promise.all([run(),run()]);
  expect(results.filter(r=>r.ok)).toHaveLength(1);
  expect(results.find(r=>!r.ok).error.code).toMatch(/MODEL_CONFIG_(BUSY|CONFLICT)/);
  const owner = spawn(process.execPath, ['--input-type=module','-e', "import {DatabaseSync} from 'node:sqlite';let s='';for await(const c of process.stdin)s+=c;const db=new DatabaseSync(JSON.parse(s));db.exec('BEGIN IMMEDIATE');console.log('locked');setInterval(()=>{},1000)"], { stdio:['pipe','pipe','pipe'], windowsHide:true });
  owner.stdin.end(JSON.stringify(path+'.write-lock.sqlite')); await once(owner.stdout,'data');
  try {
    const read = await store.readPublic(); if (!read.ok) throw Error('read');
    expect(await store.remove({expectedVersion:read.value.version,providerId:'chat'})).toMatchObject({ok:false,error:{code:'MODEL_CONFIG_BUSY'}});
    const intruder = new DatabaseSync(path+'.write-lock.sqlite'); expect(()=>intruder.exec('ROLLBACK')).toThrow(); intruder.close();
    expect(await store.remove({expectedVersion:read.value.version,providerId:'chat'})).toMatchObject({ok:false,error:{code:'MODEL_CONFIG_BUSY'}});
  } finally { owner.kill(); await once(owner,'exit'); }
  const read = await store.readPublic(); if (!read.ok) throw Error('read');
  expect(await store.remove({expectedVersion:read.value.version,providerId:'chat'})).toMatchObject({ok:false,error:{code:'MODEL_CONFIG_NOT_FOUND'}});
});

it('preserves valid old JSON when temp creation or atomic rename fails', async () => {
  const path = await fixture(), store=modelConfigStore(path), before=await store.readPublic(); if(!before.ok) throw Error('read');
  const bytes=await readFile(path,'utf8');
  const original=fs.open;
  const spy=vi.spyOn(fs,'open').mockImplementation(async (...args) => { if(args[1]==='wx') throw Error('disk failure'); return original(...args); });
  try { expect(await store.remove({expectedVersion:before.value.version,providerId:'chat'})).toMatchObject({ok:false,error:{code:'MODEL_CONFIG_WRITE_FAILED'}}); } finally { spy.mockRestore(); }
  expect(await readFile(path,'utf8')).toBe(bytes);
  const renamer=vi.spyOn(fs,'rename').mockRejectedValue(Error('locked destination'));
  try { expect(await store.remove({expectedVersion:before.value.version,providerId:'chat'})).toMatchObject({ok:false,error:{code:'MODEL_CONFIG_WRITE_FAILED'}}); } finally { renamer.mockRestore(); }
  expect(await readFile(path,'utf8')).toBe(bytes);
  expect((await fs.readdir(join(path,'..'))).filter(p=>p.endsWith('.tmp'))).toEqual([]);
});

it.each(['clear','remove'])('blocks new file-profile usage after %s while accepted tasks recover with frozen keys and original IDs', async action => {
  const path=await fixture(), root=join(path,'..'); let posts=0, queries=0, authorized=true;
  const server=createServer((req,res)=>{authorized &&= req.headers.authorization==='Bearer fixture-private-key';req.resume();req.on('end',()=>{if(req.method==='POST'){posts++;res.end(JSON.stringify({task_id:'accepted-original'}));}else {queries++;expect(req.url).toBe('/v2/query/video_generation/accepted-original');res.end(JSON.stringify({task:{id:'accepted-original',status:'running'}}));}});});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r)); const address=server.address();if(!address||typeof address==='string')throw Error('port');
  const vault=await CredentialVault.open(join(root,'vault'),{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},[]);
  let engine:EngineHandle|undefined, libraryId='';
  const openEngine=async()=>{const result=await startEngine({root:join(root,'library'),providerContext:{evidence:'fixture',requestVideo:(p,d,b)=>createVideoGenerationCapability(libraryId,vault)(p,d,b),queryVideo:(p,id)=>createVideoQueryCapability(libraryId,vault)(p,id)}});if(!result.ok)throw Error('engine');engine=result.value;libraryId=engine.identity.libraryId;return engine;};
  const value=(r:any)=>{expect(r.ok).toBe(true);return r.value?.result??r.value;};
  const execute=(kind:string,payload:unknown)=>engine!.commands.execute({schemaVersion:1,libraryId,connectionEpoch:'fixture',commandId:crypto.randomUUID(),kind,payload});
  const synchronize=async()=>{const config=await configFile.loadModelConfig(path);if(!config.ok)throw Error('config');return importModelConfig({config:config.value,vault,host:{identity:engine!.identity,execute:async v=>engine!.commands.execute(v),query:async v=>engine!.commands.query(v),updateCredentialStatus:async(v:CredentialStatus)=>engine!.modelConfig.updateCredentialStatus(v),credentialStatuses:async()=>ok(engine!.modelConfig.credentialStatuses())}});};
  try {
    await openEngine();
    await writeFile(path,JSON.stringify({schemaVersion:1,providers:[{...provider,kind:'video',modelId:'MiniMax-H3-Highspeed',baseURL:`http://127.0.0.1:${address.port}/v1`,allowPrivateEndpoint:true}]}));
    value(await synchronize());
    const projectId=value(await execute('project.create',{name:'Fixture'})).id;
    const prepare=(revision:number)=>execute('generation.prepare',{projectId,profileRef:{libraryId,id:'file-chat-profile',revision},prompt:'clouds',inputVersion:'v1',executionOwner:'human',runId:crypto.randomUUID()});
    const prepared=value(await prepare(1));const task=value(await execute('generation.approveAndEnqueue',{preparedId:prepared.preparedId,approvedPlanHash:prepared.planHash,currency:'CNY',allowanceMicros:1600000,budgetLimitMicros:10000000,acknowledgeUnknown:true,executionOwner:prepared.executionOwner,runId:prepared.runId}));
    expect(value(await engine!.scheduler.run(task.attemptId))).toMatchObject({providerState:'accepted',providerTaskId:'accepted-original'});
    const store=modelConfigStore(path), before=await store.readPublic();if(!before.ok)throw Error('config');
    const {hasKey:_k,state:_s,...fields}=before.value.providers[0]!;
    value(action==='remove'?await store.remove({providerId:'chat',expectedVersion:before.value.version}):await store.save({expectedVersion:before.value.version,provider:{...fields,apiKey:'',clearKey:true}}));
    value(await synchronize());
    expect(await prepare(1)).toMatchObject({ok:false,error:{code:'CONFIG_CHANGED'}});
    expect(await prepare(2)).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNAVAILABLE'}});
    await engine!.close();await openEngine();value(await synchronize());
    value(await engine!.scheduler.recover());
    expect(value(engine!.generation.read(task.taskId))).toMatchObject({providerState:'accepted',providerTaskId:'accepted-original'});
    expect({posts,queries,authorized}).toEqual({posts:1,queries:1,authorized:true});
  } finally {await engine?.close();vault.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
