import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialVault } from '../../apps/desktop/src/main/credential-vault.ts';
import * as routing from '../../apps/desktop/src/main/dialogue-provider-routing.ts';

it('routes process H3 audio and bounded Sync media through host credentials and local HTTP', async () => {
  const seen: any[] = [];
  const server = createServer((req,res) => { const chunks: Buffer[]=[];req.on('data',c=>chunks.push(c)); req.on('end',()=>{seen.push({headers:req.headers,method:req.method,body:Buffer.concat(chunks)});res.end('{"id":"task","task_id":"task"}');}); });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address() as {port:number},root=await mkdtemp(join(tmpdir(),'dialogue-route-'));
  try {
    const vault=await CredentialVault.open(join(root,'vault'),{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''},[]);
    const secret=await vault.put('dummy-sync-key',{libraryId:'library',connectionId:'connection'},'session');expect(secret.ok).toBe(true);if(!secret.ok)return;
    const bytes=Buffer.from('bounded-fixture'),hash=createHash('sha256').update(bytes).digest('hex');
    const media={ref:{kind:'assetVersion',libraryId:'library',assetId:'audio',version:1},hash,mime:'audio/wav',byteLength:bytes.length,durationTicks:96000,probeId:'probe'};
    const config:any={schemaVersion:1,connection:{libraryId:'library',id:'connection',revision:1,createdAt:new Date().toISOString(),name:'fixture',adapterType:'minimax-h3-v2',baseUrl:`http://127.0.0.1:${address.port}`,credentialRef:secret.value,headers:{},networkPolicy:{privateEndpoint:{hostname:'127.0.0.1',port:address.port,purpose:'model-api'}},timeoutMs:1000,concurrency:1},model:{libraryId:'library',id:'model',revision:1,createdAt:new Date().toISOString(),name:'fixture',modelId:'fixture',connectionRef:{libraryId:'library',id:'connection',revision:1},capabilities:{taskTypes:['text_to_video'],inputKinds:['text','image','audio'],outputKinds:['video'],maxBatch:1},parameters:{},pricing:{status:'unknown'}},profile:{libraryId:'library',id:'profile',revision:1,createdAt:new Date().toISOString(),name:'fixture',modelRef:{libraryId:'library',id:'model',revision:1},parameters:{}},parameters:{duration:4,resolution:'768P',ratio:'16:9'},pricing:{status:'unknown'}};
    const prepared:any={libraryId:'library',projectId:'project',preparedId:'prepared',planHash:'a'.repeat(64),expiresAt:Date.now()+600000,inputVersion:'v1',executionOwner:'human',runId:'run',prompt:'audio 1 is character A',adapterId:'minimax-h3-v2',estimateMicros:null,currency:null,config,referenceAudio:[{...media,characterRef:{id:'a',revision:1},voiceRef:{id:'voice',revision:1}}]};
    config.model.parameters={duration:{type:'integer',min:4,max:15,default:4},resolution:{type:'enum',values:['768P'],default:'768P'},ratio:{type:'enum',values:['16:9'],default:'16:9'}};
    config.model.capabilities.taskTypes=['text_to_video','image_to_video'];
    let opened=0,closed=0;
    const host=routing.createDialogueProviderRoute('library',vault,{openMediaRead:async()=>{opened++;return {ok:true,value:{leaseId:'lease',byteLength:bytes.length}} as any;},readMediaRange:async()=>({ok:true,value:{bytes}} as any),closeMediaRead:async()=>{closed++;}});
    const context=routing.dialogueProcessContext(async(type,input,detail)=>host(type,input,detail));
    const dispatch={attemptId:'attempt',outputStagingId:'attempt-output',clientRequestId:'client',requestHash:'a'.repeat(64),retries:0 as const};
    await context.requestVideo!(prepared,dispatch,[],[bytes]);
    expect(JSON.parse(seen[0].body).content[1].audio_url.url).toBe(`data:audio/wav;base64,${bytes.toString('base64')}`);
    const sync={...prepared,adapterId:'sync-lipsync-v2',referenceAudio:undefined,config:{...config,connection:{...config.connection,adapterType:'sync-lipsync-v2'},model:{...config.model,capabilities:{taskTypes:['lip_sync'],inputKinds:['video','audio'],outputKinds:['video'],maxBatch:1}},parameters:{}},lipSyncAudio:media,lipSyncVideo:{...media,ref:{...media.ref,assetId:'video'},mime:'video/mp4'}};
    sync.config.model.parameters={};
    const syncDispatch={...dispatch,requestHash:createHash('sha256').update(JSON.stringify(sync)).digest('hex')};
    await context.requestLipSync!(sync,syncDispatch,{video:bytes,audio:bytes});await context.queryLipSync!(sync,'task');
    expect(seen).toHaveLength(3);expect(seen[1].headers['x-api-key']).toBe('dummy-sync-key');expect(seen[2].headers['x-api-key']).toBe('dummy-sync-key');expect(seen[1].headers.authorization).toBeUndefined();expect(seen[1].body.toString()).toContain('filename="video.mp4"');expect(opened).toBe(2);expect(closed).toBe(2);
    await expect(host('provider.lipsync', {...sync,libraryId:'other'}, {dispatch})).rejects.toThrow();expect(seen).toHaveLength(3);
    await expect(context.requestLipSync!(sync,syncDispatch,{video:bytes,audio:bytes})).rejects.toThrow();expect(seen).toHaveLength(3);
    const {createHttpTransport}=await import('../../packages/providers/src/http-transport.ts');const local=createHttpTransport();
    const officialHost=routing.createDialogueProviderRoute('library',vault,{openMediaRead:async()=>({ok:true,value:{leaseId:'lease',byteLength:bytes.length}} as any),readMediaRange:async()=>({ok:true,value:{bytes}} as any),closeMediaRead:async()=>{}},{...local,lipsync:(connection,body,type,headers,taskId,signal)=>local.lipsync({...connection,baseUrl:sync.config.connection.baseUrl,networkPolicy:sync.config.connection.networkPolicy},body,type,headers,taskId,signal)});
    const official={...sync,config:{...sync.config,connection:{...sync.config.connection,baseUrl:'https://api.sync.so',networkPolicy:{privateEndpoint:null}}}},original={...dispatch,requestHash:createHash('sha256').update(JSON.stringify(official)).digest('hex')};
    const officialProcess=routing.dialogueProcessContext((type,input,detail)=>officialHost(type,input,detail));
    await officialProcess.requestLipSync!(official,original,{video:bytes,audio:bytes});
    await expect(officialProcess.requestLipSync!(official,original,{video:bytes,audio:bytes})).rejects.toThrow();
    await officialProcess.requestLipSyncReconcile!(official,original,{video:bytes,audio:bytes});
    await expect(officialProcess.requestLipSyncReconcile!(official,{...original,clientRequestId:'changed'}, {video:bytes,audio:bytes})).rejects.toThrow();
    await expect(officialProcess.requestLipSyncReconcile!(official,{...original,requestHash:'b'.repeat(64)}, {video:bytes,audio:bytes})).rejects.toThrow();
    expect(seen).toHaveLength(5);expect(seen[3].headers['idempotency-key']).toBe(seen[4].headers['idempotency-key']);
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
