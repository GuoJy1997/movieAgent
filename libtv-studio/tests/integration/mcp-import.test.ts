import {expect,it,afterEach} from 'vitest';
import {mkdir,writeFile,unlink,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {nativeFixture,execute,value} from '../fixtures/native-generation';
import {McpOperationStore} from '../../apps/desktop/src/main/mcp/operation-store';
import {McpAssetImporter} from '../../apps/desktop/src/main/mcp/asset-import';
import {receiveImage} from '../../apps/desktop/src/main/mcp/import-files';
import type {McpEngineAccess} from '../../apps/desktop/src/main/mcp/access';
const stores:McpOperationStore[]=[];
afterEach(()=>{for(const s of stores.splice(0))s.close();});
async function fixture(){
 const f=await nativeFixture('minimax-video-v2'),projectId=f.prepareInput().projectId;
 const sub=value(f.engine.commands.query({schemaVersion:1,libraryId:f.engine.identity.libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind:'subproject.list',payload:{projectId}})).items[0];
 const scope={libraryId:f.engine.identity.libraryId,projectId,subprojectId:sub.id};
 const inbox=join(f.root,'inbox'),stagingRoot=join(f.root,'mcp-stage');await mkdir(inbox);
 const bytes=await sharp({create:{width:512,height:288,channels:3,background:'#c98765'}}).png().toBuffer();await writeFile(join(inbox,'agent.png'),bytes);
 const access:McpEngineAccess={identity:()=>({libraryId:scope.libraryId,connectionEpoch:'test'}),execute:async(kind,payload,commandId,sc)=>f.engine.commands.execute({schemaVersion:1,libraryId:scope.libraryId,connectionEpoch:'test',commandId,kind,payload,scope:{projectId:sc.projectId,subprojectId:sc.subprojectId}}),query:async(kind,payload,sc)=>f.engine.commands.query({schemaVersion:1,libraryId:scope.libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind,payload,...(sc?{scope:{projectId:sc.projectId,subprojectId:sc.subprojectId}}:{})}),registerGrant:async grant=>f.engine.assets.registerGrant(grant),readMedia:i=>f.engine.assets.read(i)};
 const store=new McpOperationStore(join(f.root,'mcp-operations.sqlite'));stores.push(store);
 const sources=[{id:'inbox',path:inbox,name:'Agent inbox'}];
 const importer=new McpAssetImporter({store,access:()=>access,sources:()=>sources,stagingRoot});
 const input={requestId:'import-1',scope,name:'Agent portrait',source:{kind:'localFile' as const,importSourceId:'inbox',path:'agent.png'},shared:true,sourceInfo:{sourceKind:'agent' as const,sourceApp:'Codex'}};
 return {...f,scope,inbox,stagingRoot,bytes,store,sources,access,importer,input};
}
it('collects a real external image, classifies it, and replays without duplicate assets after the source is removed',async()=>{
 const f=await fixture();const started=value(await f.importer.start(f.input));const op=value(await f.importer.wait(started.operationId));
 expect(op.state).toBe('completed');expect(op.asset.name).toBe('Agent portrait');expect(op.asset.sourceArtifactRef).toBeNull();
 expect(op.hash).toMatch(/^[a-f0-9]{64}$/);
 await unlink(join(f.inbox,'agent.png'));
 const replay=value(await f.importer.start(f.input));expect(replay.asset.ref).toEqual(op.asset.ref);
 expect(f.engine.assets.search({latestOnly:true}).assets).toHaveLength(1);
 const media=value(await f.engine.assets.read({libraryId:f.scope.libraryId,ref:op.asset.ref,variant:'original'}));expect(Buffer.from(media.bytes)).toEqual(f.bytes);
 const catalog=value(await f.access.query('project.assets',{projectId:f.scope.projectId,subprojectId:f.scope.subprojectId,view:'common'},f.scope));
 expect(catalog.items).toHaveLength(1);
 expect(f.store.provenance(op.asset.ref)).toMatchObject({sourceKind:'agent',sourceApp:'Codex'});
 expect(await f.importer.start({...f.input,name:'different request'})).toMatchObject({ok:false,error:{code:'COMMAND_ID_REUSED'}});
});
it('persists a partial import and resumes bindings without repeating a successful asset collection',async()=>{
 const f=await fixture();
 value(await execute(f.engine,'creation.saveEntity',{projectId:f.scope.projectId,id:'hero',expectedRevision:0,kind:'character',name:'Hero',description:'',constraints:'',references:[]}));
 const input={...f.input,bindings:[{kind:'entity' as const,entityId:'hero',expectedRevision:1}]};
 let cut=true;const access={...f.access,execute:async(...args:Parameters<McpEngineAccess['execute']>)=>{if(args[0]==='creation.saveEntity'&&cut){cut=false;return {ok:false as const,error:{code:'ENGINE_DISCONNECTED',message:'fixture disconnect'}};}return f.access.execute(...args);}};
 const importer=new McpAssetImporter({store:f.store,access:()=>access,sources:()=>f.sources,stagingRoot:f.stagingRoot});
 const started=value(await importer.start(input)),partial=value(await importer.wait(started.operationId));
 expect(partial.state).toBe('partial');expect(partial.asset.ref.version).toBe(1);
 f.store.close();const reopenedStore=new McpOperationStore(join(f.root,'mcp-operations.sqlite'));stores.push(reopenedStore);
 const reopened=new McpAssetImporter({store:reopenedStore,access:()=>f.access,sources:()=>f.sources,stagingRoot:f.stagingRoot});
 value(await reopened.resume(started.operationId,f.scope));const done=value(await reopened.wait(started.operationId));expect(done.state).toBe('completed');
 expect(f.engine.assets.search({latestOnly:true}).assets).toHaveLength(1);
 expect(value(f.engine.creation.read({projectId:f.scope.projectId})).entities[0].references).toEqual([done.asset.ref]);
});
it('retains the asset on binding revision conflict and does not overwrite concurrent entity edits',async()=>{
 const f=await fixture();
 value(await execute(f.engine,'creation.saveEntity',{projectId:f.scope.projectId,id:'hero',expectedRevision:0,kind:'character',name:'Latest hero',description:'',constraints:'',references:[]}));
 const op0=value(await f.importer.start({...f.input,bindings:[{kind:'entity',entityId:'hero',expectedRevision:0}]}));
 const op=value(await f.importer.wait(op0.operationId));expect(op.state).toBe('partial');expect(op.error.code).toBe('REVISION_CONFLICT');
 expect(value(f.engine.creation.read({projectId:f.scope.projectId})).entities[0].name).toBe('Latest hero');
 expect(f.engine.assets.search({latestOnly:true}).assets).toHaveLength(1);
});
it('accepts bounded bytes while rejecting malformed payloads and directory escapes',async()=>{
 const f=await fixture();
 const op0=value(await f.importer.start({...f.input,source:{kind:'bytes',fileName:'agent.png',mimeType:'image/png',base64:f.bytes.toString('base64')}}));
 expect(value(await f.importer.wait(op0.operationId)).state).toBe('completed');
 for(const path of ['../outside.png','C:/outside.png','sub/../../outside.png'])expect(await receiveImage({kind:'localFile',importSourceId:'inbox',path},f.sources,f.stagingRoot,crypto.randomUUID())).toMatchObject({ok:false});
 for(const base64 of ['!!bad!!',Buffer.alloc(8*1024*1024+1).toString('base64')])expect(await receiveImage({kind:'bytes',fileName:'bad.png',mimeType:'image/png',base64},f.sources,f.stagingRoot,crypto.randomUUID())).toMatchObject({ok:false});
 expect(await receiveImage({kind:'bytes',fileName:'bad.png',mimeType:'image/png',base64:Buffer.from('not png').toString('base64')},f.sources,f.stagingRoot,crypto.randomUUID())).toMatchObject({ok:false});
});
it('rejects a symlinked source and a foreign scope before creating any asset',async()=>{
 const f=await fixture();
 await symlink(f.inbox,join(f.root,'linked'),'junction');
 expect(await receiveImage({kind:'localFile',importSourceId:'link',path:'agent.png'},[{id:'link',path:join(f.root,'linked'),name:'bad'}],f.stagingRoot,crypto.randomUUID())).toMatchObject({ok:false});
 expect(await f.importer.start({...f.input,scope:{...f.scope,libraryId:'foreign'}})).toMatchObject({ok:false});
 expect(f.engine.assets.search({latestOnly:true}).assets).toHaveLength(0);
});

it('binds one collected version to entity, shot and canvas, and a new asset version does not retarget them',async()=>{
 const f=await fixture(),projectId=f.scope.projectId;
 value(await execute(f.engine,'creation.saveEntity',{projectId,id:'hero',expectedRevision:0,kind:'character',name:'Hero',description:'',constraints:'',references:[]}));
 value(await execute(f.engine,'creation.saveScript',{projectId,id:'script',expectedRevision:0,title:'Test',synopsis:'',body:'',scenes:[{id:'scene',title:'Scene',location:'',time:'',description:''}]}));
 value(await execute(f.engine,'creation.saveShot',{projectId,id:'shot',expectedRevision:0,scriptId:'script',sceneId:'scene',order:0,title:'Shot',durationSeconds:4,shotSize:'wide',cameraMovement:'',subject:'hero',action:'',dialogue:'',sound:'',aspectRatio:'16:9',prompt:'hero',entityRefs:[]}));
 const input={...f.input,bindings:[{kind:'entity',entityId:'hero',expectedRevision:1},{kind:'shot',shotId:'shot',expectedRevision:1,expectedSelectionRevision:0},{kind:'canvas',canvasId:projectId,baseRevision:0,nodeId:'picture',x:10,y:20}]};
 const begun=value(await f.importer.start(input)),first=value(await f.importer.wait(begun.operationId));expect(first.state).toBe('completed');
 const ref=first.asset.ref;expect(value(f.engine.canvas.read(projectId)).nodes[0].content.media).toEqual(ref);
 await writeFile(join(f.inbox,'agent.png'),await sharp({create:{width:512,height:288,channels:3,background:'#abcdef'}}).png().toBuffer());
 const secondStart=value(await f.importer.start({...f.input,requestId:'version-2',targetAsset:{assetId:ref.assetId,expectedVersion:1}})),second=value(await f.importer.wait(secondStart.operationId));
 expect(second.state).toBe('completed');expect(second.asset.ref.version).toBe(2);expect(second.hash).not.toBe(first.hash);
 const creation=value(f.engine.creation.read({projectId}));expect(creation.entities[0].references).toEqual([ref]);expect(creation.selections[0].image).toEqual(ref);
 expect(value(f.engine.canvas.read(projectId)).nodes[0].content.media).toEqual(ref);
});
it('recovers collection committed before a lost response and never creates a second asset',async()=>{
 const f=await fixture();let lost=true;
 const access={...f.access,execute:async(...args:Parameters<McpEngineAccess['execute']>)=>{const result=await f.access.execute(...args);if(args[0]==='asset.importGrantedFiles'&&lost){lost=false;return {ok:false as const,error:{code:'ENGINE_DISCONNECTED',message:'lost acknowledgement'}};}return result;}};
 const importer=new McpAssetImporter({store:f.store,access:()=>access,sources:()=>f.sources,stagingRoot:f.stagingRoot});
 const started=value(await importer.start(f.input));expect(value(await importer.wait(started.operationId)).state).toBe('failed');
 expect(f.engine.assets.search({latestOnly:true}).assets).toHaveLength(1);
 value(await importer.resume(started.operationId,f.scope));expect(value(await importer.wait(started.operationId)).state).toBe('completed');
 expect(f.engine.assets.search({latestOnly:true}).assets).toHaveLength(1);
});
it('preserves cancellation while an accepted step completes and stops later binding steps',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>{release=r;}),observed=new Promise<void>(r=>{entered=r;});
 const access={...f.access,execute:async(...args:Parameters<McpEngineAccess['execute']>)=>{const result=await f.access.execute(...args);if(args[0]==='asset.updateMetadata'){entered();await gate;}return result;}};
 const importer=new McpAssetImporter({store:f.store,access:()=>access,sources:()=>f.sources,stagingRoot:f.stagingRoot});
 const started=value(await importer.start(f.input));await observed;expect(value(importer.cancel(started.operationId,f.scope)).state).toBe('cancelling');release();
 const done=value(await importer.wait(started.operationId));expect(done.state).toBe('cancelled');expect(done.asset).not.toBeNull();expect(done.completedSteps).not.toContain('shared');
});
