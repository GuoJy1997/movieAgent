import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transformWithEsbuild } from 'vite';
import { installWorkspaceIpc } from '../../apps/desktop/src/main/ipc-policy.ts';
import { ok } from '../../packages/contracts/src/result.ts';
import { parseQuery, queryOutputValidators } from '../../packages/contracts/src/queries.ts';
const handlers=vi.hoisted(()=>new Map<string,(event:unknown,input?:unknown)=>Promise<unknown>>());
vi.mock('electron',()=>({ipcMain:{handle:(name:string,fn:(event:unknown,input?:unknown)=>Promise<unknown>)=>handlers.set(name,fn),removeHandler:(name:string)=>handlers.delete(name)}}));
afterEach(()=>handlers.clear());
it('keeps public export/cancel narrow and forbids privileged outcome writes through execute or extra channels',async()=>{
 const mainFrame={url:'file:///fixture.html'},webContents={mainFrame},window={isDestroyed:()=>false,webContents};let exports=0,cancels=0;
 const remove=installWorkspaceIpc(window as never,mainFrame.url,{} as never,undefined,undefined,{exportTimeline:async()=>{exports++;return ok(undefined);},cancelTimelineExport:async()=>{cancels++;return ok(undefined);}} as never);
 const input={requestId:randomUUID(),projectId:'project',timelineId:'cut',revision:1,kind:'srt'};const event={sender:webContents,senderFrame:mainFrame};const invoke=(channel:string,input?:unknown,eventOverride=event)=>handlers.get(channel)!(eventOverride,input);
 expect(await invoke('studio:timeline:export',{...input,path:'C:/outside'})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});expect(await invoke('studio:timeline:cancel-export',{requestId:input.requestId,hash:'fake'})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});expect(exports).toBe(0);expect(cancels).toBe(0);
 expect(await invoke('studio:timeline:export',input,{sender:webContents,senderFrame:{url:mainFrame.url}})).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});
 expect(await invoke('studio:timeline:export',input)).toEqual(ok(undefined));expect(await invoke('studio:timeline:cancel-export',{requestId:input.requestId})).toEqual(ok(undefined));expect(exports).toBe(1);expect(cancels).toBe(1);
 for(const kind of ['timeline.prepareExportInternal','timeline.recordExportOutcomeInternal','timeline.cancelExportInternal']){expect(handlers.has('studio:'+kind)).toBe(false);expect(await invoke('studio:execute',{schemaVersion:1,libraryId:'lib',connectionEpoch:'epoch',commandId:'fake',kind,payload:{}})).toMatchObject({ok:false});}
 expect(parseQuery({schemaVersion:1,libraryId:'lib',connectionEpoch:'epoch',queryId:'query',kind:'timeline.exports',payload:{projectId:'project',timelineId:'cut',path:'escape'}}).ok).toBe(false);expect(queryOutputValidators['timeline.exports']({libraryId:'lib',projectId:'project',timelineId:'cut',exports:[]})).toBe(true);remove();expect(handlers.size).toBe(0);
});
it('evaluates the actual preload with an exact allowlist and no arbitrary IPC or path capability',async()=>{
 const source=await readFile('apps/desktop/src/preload/index.ts','utf8'),built=await transformWithEsbuild(source,'index.ts',{format:'cjs',target:'node24'}),exposed=new Map<string,Record<string,(input?:unknown)=>unknown>>(),calls:{channel:string;input:unknown}[]=[];
 runInNewContext(built.code,{require:(name:string)=>{expect(name).toBe('electron');return {contextBridge:{exposeInMainWorld:(name:string,bridge:Record<string,(input?:unknown)=>unknown>)=>exposed.set(name,bridge)},ipcRenderer:{invoke:(channel:string,input:unknown)=>calls.push({channel,input})}};}},{timeout:1000});
 expect([...exposed.keys()]).toEqual(['studio']);const bridge=exposed.get('studio')!;expect(Object.keys(bridge).sort()).toEqual(['cancelTimelineExport','createProject','derivedMediaUrl','describe','execute','exportCreation','exportTimeline','exportVoice','listProjects','mcpConfigure','mcpSelectImportDirectory','mcpStatus','mediaUrl','openCredentialEditor','openModelConfigEditor','openProjectFolder','openProjectLauncher','query','readEvents','readModelConfig','releaseMediaUrl','reloadModelConfig','removeModelConfigProvider','selectImportFiles','selectSubtitleFile','setTimelineDraftState','workspaceInfo']);const input={requestId:randomUUID(),projectId:'p',timelineId:'t',revision:1,kind:'srt'};bridge.exportTimeline!(input);bridge.cancelTimelineExport!({requestId:input.requestId});expect(calls.map(c=>c.channel)).toEqual(['studio:timeline:export','studio:timeline:cancel-export']);
});

it('gates capability release to the current workspace main frame and forwards only an opaque URL',async()=>{
 const frame={url:'file:///fixture.html'},webContents={mainFrame:frame},released:string[]=[],window={isDestroyed:()=>false,webContents},remove=installWorkspaceIpc(window as never,frame.url,{}as never,undefined,{releaseMediaUrl:async(url:string)=>{released.push(url);return ok(undefined);}}as never);try{const h=handlers.get('studio:media:release')!;expect(await h({sender:webContents,senderFrame:{url:frame.url}},'app-media://media/lib/token/original')).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});expect(await h({sender:webContents,senderFrame:frame},{path:'file:///outside'})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});expect(released).toHaveLength(0);expect(await h({sender:webContents,senderFrame:frame},'app-media://media/lib/token/original')).toEqual(ok(undefined));expect(released).toHaveLength(1);}finally{remove();}
});
