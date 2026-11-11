import{afterEach,beforeEach,it,expect}from'vitest';import{writeFile,stat}from'node:fs/promises';import{join}from'node:path';import{randomUUID}from'node:crypto';import{setupRender}from'./render-fixtures.ts';import{cleanup,command,create,unwrap}from'./timeline-fixtures.ts';import{wav}from'../fixtures/timeline-capacity-media.ts';
afterEach(cleanup);
let f:Awaited<ReturnType<typeof setupRender>>;
// Repeated native media imports are fixture preparation, not the density admission assertion.
beforeEach(async()=>{
 f=await setupRender();const path=join(f.root,'source.wav');await writeFile(path,wav(48000,440));const st=await stat(path),clips=[];
 unwrap(await f.e.commands.execute(command(f.e,'timeline.create',create(f.projectId))));
 for(let i=0;i<33;i++){
  const id=randomUUID();unwrap(f.e.assets.registerGrant({grantId:id,importId:id,libraryId:f.e.identity.libraryId,expiresAt:Date.now()+60000,files:[{path,realPath:path,allowedRoot:f.root,name:'source.wav',size:st.size,mtimeMs:st.mtimeMs,dev:st.dev,ino:st.ino}]}));
  const imported=unwrap(await f.e.commands.execute(command(f.e,'asset.importGrantedFiles',{grantId:id}))).result as {versions:import('../../packages/contracts/src/assets.ts').AssetVersionRef[]},ref=imported.versions[0]!,m=unwrap(await f.e.renders.inspectMedia({projectId:f.projectId,reference:ref}));
  clips.push({id:'a'+i,kind:'audio',track:'voice',media:ref,sourceHash:m.hash,sourceProbeId:m.probe!.probeId,sourceInTicks:0,startTicks:i,durationTicks:1,gainMilli:1000,mute:false});
 }
 unwrap(await f.e.commands.execute(command(f.e,'timeline.applyOps',{projectId:f.projectId,timelineId:'cut',expectedRevision:1,operations:clips.map(clip=>({kind:'insert',clip}))})));
},90000);
it('refuses more than 32 independent inputs within one frame during preparation',async()=>{
 expect(await f.e.renders.prepare({timelineRef:{libraryId:f.e.identity.libraryId,projectId:f.projectId,id:'cut',revision:2},purpose:'wav',executionOwner:'human',runId:'dense-inputs'})).toMatchObject({ok:false,error:{code:'MEDIA_INPUT_DENSITY_LIMIT'}});
 expect(unwrap(f.e.renders.list({projectId:f.projectId})).jobs).toHaveLength(0);
},30000);
