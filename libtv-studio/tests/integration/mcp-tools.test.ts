import {expect,it,afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../../apps/desktop/src/main/mcp/server';
import {McpToolRouter} from '../../apps/desktop/src/main/mcp/router';
import {McpOperationStore} from '../../apps/desktop/src/main/mcp/operation-store';
import {McpAssetImporter} from '../../apps/desktop/src/main/mcp/asset-import';
import type {McpEngineAccess} from '../../apps/desktop/src/main/mcp/access';
import {nativeFixture,value} from '../fixtures/native-generation';
const closes:(()=>Promise<unknown>|void)[]=[];afterEach(async()=>{for(const f of closes.splice(0).reverse())await f();});
async function setup(){
 const f=await nativeFixture('minimax-video-v2'),libraryId=f.engine.identity.libraryId,projectId=f.prepareInput().projectId;
 const sub=value(f.engine.commands.query({schemaVersion:1,libraryId,connectionEpoch:'test',queryId:'sub',kind:'subproject.list',payload:{projectId}})).items[0],scope={libraryId,projectId,subprojectId:sub.id};
 const access:McpEngineAccess={identity:()=>({libraryId,connectionEpoch:'test'}),execute:async(kind,payload,commandId,sc)=>f.engine.commands.execute({schemaVersion:1,libraryId,connectionEpoch:'test',commandId,kind,payload,scope:{projectId:sc.projectId,subprojectId:sc.subprojectId}}),query:async(kind,payload,sc)=>f.engine.commands.query({schemaVersion:1,libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind,payload,...(sc?{scope:{projectId:sc.projectId,subprojectId:sc.subprojectId}}:{})}),registerGrant:async grant=>f.engine.assets.registerGrant(grant),readMedia:i=>f.engine.assets.read(i)};
 const inbox=join(f.root,'inbox');await mkdir(inbox);await writeFile(join(inbox,'portrait.png'),await sharp({create:{width:512,height:288,channels:3,background:'#468ac0'}}).png().toBuffer());
 const store=new McpOperationStore(join(f.root,'client.sqlite'));closes.push(()=>store.close());
 const sources=[{id:'inbox',path:inbox,name:'Inbox'}],importer=new McpAssetImporter({store,access:()=>access,sources:()=>sources,stagingRoot:join(f.root,'stage')});closes.push(()=>importer.close());
 const router=new McpToolRouter({instanceId:'instance',access:()=>access,store,importer,sources:()=>sources});
 const server=createMcpServer((name,args)=>router.call(name,args,{id:'client',name:'SDK test',connectedAt:new Date().toISOString()})),client=new Client({name:'test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);closes.push(()=>server.close(),()=>client.close());
 async function call(name:string,args:Record<string,unknown>={}){const response=await client.callTool({name,arguments:{instanceId:'instance',...args}});return {response,result:response.structuredContent as any};}
 return {...f,scope,call};
}
it('imports through an official MCP client and uses the same engine assets and graph',async()=>{
 const f=await setup(),{result:start}=await f.call('assets_import',{scope:f.scope,requestId:'portrait',name:'朱清参考',shared:true,source:{kind:'localFile',importSourceId:'inbox',path:'portrait.png'}});
 expect(start.ok).toBe(true);
 const {result:done}=await f.call('imports_wait',{scope:f.scope,operationId:start.value.operationId,timeoutMs:10000});expect(done.value.state).toBe('completed');
 const ref=done.value.asset.ref;
 const list=await f.call('assets_list',{scope:f.scope,view:'common'});expect(list.result.value.items[0].ref).toEqual(ref);
 const preview=await f.call('assets_preview',{scope:f.scope,ref});expect(preview.response.content).toEqual(expect.arrayContaining([expect.objectContaining({type:'image',mimeType:'image/png'})]));
 const graph=value(f.engine.canvas.read(f.scope.projectId));
 const node=await f.call('canvas_add_image',{scope:f.scope,requestId:'node',canvasId:f.scope.projectId,baseRevision:graph.revision,nodeId:'portrait',ref,x:50,y:50});expect(node.result.ok).toBe(true);
 const replay=await f.call('canvas_add_image',{scope:f.scope,requestId:'node',canvasId:f.scope.projectId,baseRevision:graph.revision,nodeId:'portrait',ref,x:50,y:50});expect(replay.result.ok).toBe(true);
 expect(value(f.engine.canvas.read(f.scope.projectId)).nodes.filter((n:any)=>n.nodeId==='portrait')).toHaveLength(1);
 const wrong=await f.call('assets_preview',{scope:{...f.scope,libraryId:'foreign'},ref});expect(wrong.response.isError).toBe(true);
 expect(f.requests).toHaveLength(0);
});
it('keeps connection settings private and rejects unknown methods rather than forwarding them',async()=>{
 const f=await setup(),models=await f.call('models_list',{scope:f.scope});
 expect(models.result.ok).toBe(true);const serialized=JSON.stringify(models.result);expect(serialized).not.toContain('127.0.0.1');expect(serialized).not.toContain('headers');expect(serialized).not.toContain('credentialRef');
 const bad=await f.call('execute',{scope:f.scope,kind:'provider.saveConnection',payload:{}});expect(bad.response.isError).toBe(true);expect(f.requests).toHaveLength(0);
});
