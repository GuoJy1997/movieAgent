import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: mock.fork } }));
vi.mock('../../apps/desktop/src/main/media-runtime.ts', () => ({ resolveMediaRuntime: async () => ({ ok: false, error: { code: 'MEDIA_RUNTIME_UNAVAILABLE', message: 'query-only fixture' } }) }));
import { startEngineHost } from '../../apps/desktop/src/main/engine-host';
import { CURRENT_SCHEMA_VERSION } from '../../packages/contracts/src/schema';

it('validates P3 utility responses by requested query kind and ignores foreign launch responses', async () => {
  const child = new EventEmitter() as EventEmitter & { postMessage(message:any):void; kill():void };
  let response:unknown, requests=0;
  child.kill=()=>{child.emit('exit');};
  child.postMessage=message=>{
    if(message.type==='initialize')queueMicrotask(()=>child.emit('message',{type:'ready',launchId:message.launchId,result:{ok:true,value:{instanceId:'instance',libraryId:'library',schemaVersion:CURRENT_SCHEMA_VERSION,nodeVersion:'24',sqliteVersion:'3'}}}));
    else if(message.type==='request'){
      requests++;
      queueMicrotask(()=>{
        child.emit('message',{type:'response',launchId:'foreign',requestId:message.requestId,result:{ok:true,value:'forged'}});
        child.emit('message',{type:'response',launchId:message.launchId,requestId:message.requestId,result:{ok:true,value:response}});
      });
    }
  };
  mock.fork.mockImplementation(()=>{queueMicrotask(()=>child.emit('spawn'));return child;});
  const host=await startEngineHost('isolated-fixture');expect(host.ok).toBe(true);if(!host.ok)return;
  const base={schemaVersion:1,libraryId:'library',connectionEpoch:'epoch',queryId:'query'};
  for(const [kind,payload,value] of [
    ['creation.read',{projectId:'project'},{libraryId:'library',projectId:'project',entities:[],scripts:[],shots:[],selections:[],snapshotSeq:0}],
    ['agent.list',{projectId:'project'},{libraryId:'library',projectId:'project',sessions:[]}],
    ['shots.history',{projectId:'project',shotId:'shot'},{libraryId:'library',projectId:'project',shotId:'shot',productions:[],outputs:[],collectionIssues:[]}],
  ] as const){response=value;expect(await host.value.query({...base,kind,payload})).toEqual({ok:true,value});}
  response={projects:[],snapshotSeq:0,streamId:'stream'};
  expect(await host.value.query({...base,kind:'creation.read',payload:{projectId:'project'}})).toMatchObject({ok:false,error:{code:'INVALID_ENGINE_RESPONSE'}});
  const before=requests;
  expect(await host.value.query({...base,kind:'creation.read',payload:{projectId:'../escape'}})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  expect(requests).toBe(before);child.emit('exit');
});
