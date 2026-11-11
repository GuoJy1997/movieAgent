import {expect,it} from 'vitest';
import {join} from 'node:path';
import {nativeFixture,value} from '../fixtures/native-generation';
import {createMcpService} from '../../apps/desktop/src/main/mcp/service';
import {discoverInstances,readDescriptor,PipeMcpClient} from '../../apps/desktop/src/main/mcp/transport';
import type {McpEngineAccess} from '../../apps/desktop/src/main/mcp/access';
it('starts disabled, publishes a usable local connection on enable, and revokes it on disable',async()=>{
 const f=await nativeFixture('minimax-video-v2'),libraryId=f.engine.identity.libraryId;
 const access:McpEngineAccess={identity:()=>({libraryId,connectionEpoch:'test'}),execute:async(kind,payload,commandId,sc)=>f.engine.commands.execute({schemaVersion:1,libraryId,connectionEpoch:'test',commandId,kind,payload,scope:{projectId:sc.projectId,subprojectId:sc.subprojectId}}),query:async(kind,payload,sc)=>f.engine.commands.query({schemaVersion:1,libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind,payload,...(sc?{scope:{projectId:sc.projectId,subprojectId:sc.subprojectId}}:{})}),registerGrant:async grant=>f.engine.assets.registerGrant(grant),readMedia:i=>f.engine.assets.read(i)};
 const discoveryDir=join(f.root,'discovery'),options={stateRoot:join(f.root,'mcp-state'),discoveryDir,access:()=>access,name:'Fixture',workspacePath:f.root,execPath:process.execPath,stdioPath:'stdio.js',confirm:async()=>false};
 const service=await createMcpService(options);let client:PipeMcpClient|undefined;
 try{
  expect(value(await service.status()).enabled).toBe(false);expect(await discoverInstances(discoveryDir)).toHaveLength(0);
  const status=value(await service.configure({action:'enable'}));expect(status.enabled).toBe(true);
  expect(status.sources[0].id).toBe('inbox');expect(JSON.stringify(status.clientConfig)).not.toContain('token');
  const instances=await discoverInstances(discoveryDir);expect(instances).toHaveLength(1);
  const descriptor=await readDescriptor(join(discoveryDir,instances[0]!.instanceId+'.json'));client=new PipeMcpClient(descriptor,'Acceptance');
  expect(await client.call('system_doctor',{instanceId:status.instanceId})).toMatchObject({ok:true,value:{ready:true}});
  expect(value(await service.status()).clients).toHaveLength(1);
  value(await service.configure({action:'disable'}));
  expect(await client.call('system_doctor',{instanceId:status.instanceId})).toMatchObject({ok:false});
  expect(await discoverInstances(discoveryDir)).toHaveLength(0);
 }finally{await client?.close();await service.close();}
 const reopened=await createMcpService(options);try{expect(value(await reopened.status()).enabled).toBe(false);}finally{await reopened.close();}
},30000);
