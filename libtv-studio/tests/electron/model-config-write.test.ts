import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { _electron, expect as uiExpect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const apps: ElectronApplication[] = [], roots: string[] = [];const servers:Server[]=[];
async function textServer(){const server=createServer((req,res)=>{req.resume();req.on('end',()=>res.end(JSON.stringify(req.method==='GET'?{data:[{id:'simple-text'}]}:{choices:[{message:{content:'OK'},finish_reason:'stop'}]})));});servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw Error('port');return `http://127.0.0.1:${a.port}/v1`;}
const executablePath = resolve(process.env.MOVIEAGENT_TEST_PACKAGE ?? 'apps/desktop/release/win-unpacked', 'MovieAgent.exe');
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));} for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });
it('edits the packaged software config in a protected window, retains conflicting drafts and reloads after reopening', async () => {
  const root=await mkdtemp(join(tmpdir(),'packaged-config-')); roots.push(root);
  const config=join(root,'models.json'),baseURL=await textServer();
  await writeFile(config,JSON.stringify({schemaVersion:1,providers:[{id:'chat',name:'Fixture chat',kind:'text',baseURL,modelId:'chat-fixture',apiKey:'fixture-editor-key',allowPrivateEndpoint:true}]}));
  const launch=async()=>{const app=await _electron.launch({executablePath,args:[`--library-root=${join(root,'library')}`,`--user-data-dir=${join(root,'profile')}`,`--model-config=${config}`]});apps.push(app);const page=await app.firstWindow();await page.waitForFunction(()=>!!window.studio);return {app,page};};
  const {app,page}=await launch();
  expect(await page.evaluate(()=>typeof window.studio.readModelConfig)).toBe('function');
  const before=await page.evaluate(()=>window.studio.readModelConfig()); if(!before.ok)throw Error('public read');
  expect(JSON.stringify(before)).not.toContain('fixture-editor-key');
  const opened=app.waitForEvent('window');
  await page.evaluate(version=>{void window.studio.openModelConfigEditor({providerId:'chat',expectedVersion:version}).then(r=>(globalThis as any).editOutcome=r);},before.value.version);
  const editor=await opened; await uiExpect(editor.getByLabel('API Key')).toHaveAttribute('type','password');
  await uiExpect(editor.getByLabel('API Key')).toHaveValue('');
  await uiExpect(editor.getByRole('button',{name:'保存配置',exact:true})).toBeDisabled();
  expect(await editor.evaluate(()=>typeof (window as any).studio)).toBe('undefined');
  await editor.getByText('高级设置',{exact:true}).click();
  await editor.getByLabel('名称（可选）',{exact:true}).fill('Draft retained');
  await editor.getByLabel('max_tokens',{exact:true}).fill('2048');
  await editor.getByRole('button',{name:'测试连接',exact:true}).click();await uiExpect(editor.locator('#test-result')).toContainText('测试通过');
  await writeFile(config,(await readFile(config,'utf8'))+'\n');
  await editor.getByRole('button',{name:'保存配置',exact:true}).click();
  await uiExpect(editor.getByRole('alert')).toContainText('已修改');
  await uiExpect(editor.getByLabel('名称（可选）',{exact:true})).toHaveValue('Draft retained');
  await editor.getByRole('button',{name:'读取最新文件以核对'}).click();
  await uiExpect(editor.locator('#comparison')).toContainText('Fixture chat');
  await editor.getByRole('button',{name:'已核对，保留草稿并采用最新版本'}).click();
  await uiExpect(editor.getByRole('button',{name:'保存配置',exact:true})).toBeDisabled();await editor.getByRole('button',{name:'测试连接',exact:true}).click();await uiExpect(editor.locator('#test-result')).toContainText('测试通过');
  await editor.getByRole('button',{name:'保存配置',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(globalThis as any).editOutcome)).toMatchObject({ok:true,value:{status:'saved',synchronization:'imported'}});
  expect(JSON.parse(await readFile(config,'utf8'))).toMatchObject({schemaVersion:2,providers:[{name:'Draft retained',apiKey:'fixture-editor-key',parameters:{max_tokens:2048}}]});
  const current=await page.evaluate(()=>window.studio.readModelConfig());expect(JSON.stringify(current)).not.toContain('fixture-editor-key');
  for (const [id,adapter] of [['image','openai-image-v1'],['edit','openai-image-edit-v1']] as const) {
    const configRead=await page.evaluate(()=>window.studio.readModelConfig());if(!configRead.ok)throw Error('read');
    const ready=app.waitForEvent('window');await page.evaluate(version=>{(globalThis as any).editOutcome=null;void window.studio.openModelConfigEditor({expectedVersion:version}).then(r=>(globalThis as any).editOutcome=r);},configRead.value.version);
    const entry=await ready;await uiExpect(entry.getByRole('button',{name:'保存配置',exact:true})).toBeDisabled();
    await entry.getByText('高级设置',{exact:true}).click();await entry.getByLabel('名称（可选）',{exact:true}).fill(`Fixture ${id}`);await entry.getByLabel('兼容协议',{exact:true}).selectOption(adapter);
    await entry.getByLabel('Base URL',{exact:true}).fill('https://images.invalid/v1');await entry.getByLabel('模型 ID',{exact:true}).fill('image-fixture');await entry.getByLabel('API Key',{exact:true}).fill('fixture-image-private-key');
    await entry.getByLabel('size',{exact:true}).selectOption('1536x1024');await entry.getByLabel('quality',{exact:true}).selectOption('high');
    await entry.getByRole('button',{name:'保存配置',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(globalThis as any).editOutcome)).toMatchObject({ok:true,value:{status:'saved',synchronization:'imported'}});
  }
  await app.close(); apps.splice(apps.indexOf(app),1);
  const reopened=await launch();
  const after=await reopened.page.evaluate(()=>window.studio.readModelConfig());
  expect(after).toMatchObject({ok:true,value:{providers:[{name:'Draft retained',hasKey:true,parameters:{max_tokens:2048}},{kind:'image',adapterType:'openai-image-v1',parameters:{size:'1536x1024',quality:'high'}},{kind:'image',adapterType:'openai-image-edit-v1',parameters:{size:'1536x1024',quality:'high'}}]}});
  expect(JSON.stringify(after)).not.toContain('fixture-image-private-key');
  await reopened.page.getByRole('button',{name:'模型设置',exact:true}).click();
  await uiExpect(reopened.page.getByRole('heading',{name:'软件全局模型配置',exact:true})).toBeVisible();
  const linkedReady=reopened.app.waitForEvent('window');await reopened.page.getByRole('button',{name:'编辑连接',exact:true}).first().click();const linked=await linkedReady;
  await linked.getByText('高级设置',{exact:true}).click();
  await uiExpect(linked.getByLabel('名称（可选）',{exact:true})).toHaveValue('Draft retained');
  await linked.getByRole('button',{name:'取消',exact:true}).click();
  await uiExpect(reopened.page.getByRole('button',{name:'新建预设',exact:true})).toBeEnabled();
});

it('rejects other windows and malicious frames, denies network entry, and exposes only the protected editor bridge',async()=>{
  const root=await mkdtemp(join(tmpdir(),'config-policy-'));roots.push(root);const config=join(root,'models.json');await writeFile(config,JSON.stringify({schemaVersion:2,providers:[]}));
  const probe=join(root,'probe.cjs');await writeFile(probe,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('probe',{invoke:(channel,input)=>ipcRenderer.invoke(channel,input)});");
  const hostileDocument=join(root,'hostile.html');await writeFile(hostileDocument,'<html><body>Parent<iframe srcdoc="<html><body>Child</body></html>"></iframe></body></html>');
  const app=await _electron.launch({executablePath,args:[`--library-root=${join(root,'library')}`,`--user-data-dir=${join(root,'profile')}`,`--model-config=${config}`]});apps.push(app);
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.studio);const read=await page.evaluate(()=>window.studio.readModelConfig());if(!read.ok)throw Error('config');
  const ready=app.waitForEvent('window');await page.evaluate(version=>{void window.studio.openModelConfigEditor({expectedVersion:version});},read.value.version);const editor=await ready;
  await uiExpect(editor.getByRole('button',{name:'保存配置',exact:true})).toBeDisabled();
  expect(await editor.evaluate(()=>({keys:Object.keys(window.modelConfigEntry).sort(),studio:typeof (window as any).studio,require:typeof (window as any).require}))).toEqual({keys:['info','listModels','submit','test'],studio:'undefined',require:'undefined'});
  expect(await editor.evaluate(async()=>{try{await fetch('http://127.0.0.1:9/fixture');return 'allowed';}catch{return 'denied';}})).toBe('denied');
  const hostileReady=app.waitForEvent('window');
  await app.evaluate(async({BrowserWindow},{preload,path})=>{const hostile=new BrowserWindow({show:false,webPreferences:{preload,nodeIntegration:false,nodeIntegrationInSubFrames:true,contextIsolation:true,sandbox:true}});await hostile.loadFile(path);},{preload:probe,path:hostileDocument});
  const hostile=await hostileReady;await hostile.waitForFunction(()=>!!(window as any).probe);
  expect(hostile.frames()).toHaveLength(2);
  for(const frame of hostile.frames()) {
    await frame.waitForFunction(()=>!!(window as any).probe);
    for(const channel of ['model-config:info','model-config:submit','model-config:test','model-config:list-models','studio:model-config:read','studio:model-config:remove']) expect(await frame.evaluate(channel=>(window as any).probe.invoke(channel),channel)).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});
  }
  expect(await readFile(config,'utf8')).toBe(JSON.stringify({schemaVersion:2,providers:[]}));
  await editor.getByRole('button',{name:'取消',exact:true}).click();
});

it('synchronizes a second workbench before new prepare or approval and retains committed receipts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'config-two-workbenches-'));roots.push(root);const config=join(root,'models.json');
  await writeFile(config,JSON.stringify({schemaVersion:1,providers:[{id:'chat',name:'Fixture',kind:'text',baseURL:'http://127.0.0.1:1/v1',modelId:'fixture',apiKey:'fixture-shared-key',allowPrivateEndpoint:true}]}));
  const launch=async(id:string)=>{const app=await _electron.launch({executablePath,args:[`--library-root=${join(root,id,'library')}`,`--user-data-dir=${join(root,id,'profile')}`,`--model-config=${config}`]});apps.push(app);const page=await app.firstWindow();await page.waitForFunction(()=>!!window.studio);return page;};
  const a=await launch('a'),b=await launch('b');
  const initial=await b.evaluate(async()=>{
    const d=await window.studio.describe();if(!d.ok)throw Error('identity');const project=await window.studio.createProject({name:'Fixture project'});if(!project.ok)throw Error('project');
    const command={schemaVersion:1 as const,libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,commandId:crypto.randomUUID(),kind:'generation.prepare' as const,payload:{projectId:project.value.id,profileRef:{libraryId:d.value.libraryId,id:'file-chat-profile',revision:1},prompt:'fixture',inputVersion:'v1',executionOwner:'human',runId:crypto.randomUUID()}};
    const result=await window.studio.execute(command);return {command,result};
  });expect(initial.result.ok).toBe(true);if(!initial.result.ok)throw Error('prepare');
  const prepared=initial.result.value.result;
  const read=await a.evaluate(()=>window.studio.readModelConfig());if(!read.ok)throw Error('read');
  expect(await a.evaluate(version=>window.studio.removeModelConfigProvider({providerId:'chat',expectedVersion:version}),read.value.version)).toMatchObject({ok:true,value:{status:'saved'}});
  const approve={...initial.command,commandId:'new-approval',kind:'generation.approveAndEnqueue',payload:{preparedId:prepared.preparedId,approvedPlanHash:prepared.planHash,currency:'CNY',allowanceMicros:1000000,budgetLimitMicros:10000000,acknowledgeUnknown:true,executionOwner:prepared.executionOwner,runId:prepared.runId}};
  expect(await b.evaluate(c=>window.studio.execute(c as never),approve)).toMatchObject({ok:false,error:{code:'CONFIG_CHANGED'}});
  expect(await b.evaluate(c=>window.studio.execute({...c,commandId:'new-prepare'}),initial.command)).toMatchObject({ok:false,error:{code:'CONFIG_CHANGED'}});
  expect(await b.evaluate(c=>window.studio.execute({...c,commandId:'current-prepare',payload:{...c.payload,profileRef:{...c.payload.profileRef,revision:2}}}),initial.command)).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNAVAILABLE'}});
  await writeFile(config,'invalid json');
  expect(await b.evaluate(c=>window.studio.execute({...c,commandId:'invalid-file-prepare'}),initial.command)).toMatchObject({ok:false,error:{code:'MODEL_CONFIG_READ_FAILED'}});
  expect(await b.evaluate(c=>window.studio.execute(c),initial.command)).toEqual(initial.result);
});

it('tests new text before saving and keeps simple image creation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'config-simple-entry-'));roots.push(root);const config=join(root,'models.json');await writeFile(config,JSON.stringify({schemaVersion:2,providers:[]}));
  const app=await _electron.launch({executablePath,args:[`--library-root=${join(root,'library')}`,`--user-data-dir=${join(root,'profile')}`,`--model-config=${config}`]});apps.push(app);const page=await app.firstWindow();await page.waitForFunction(()=>!!window.studio);
  const baseURL=await textServer();
  for(const kind of ['text','image']){
    const read=await page.evaluate(()=>window.studio.readModelConfig());if(!read.ok)throw Error('read');const ready=app.waitForEvent('window');await page.evaluate(version=>{(globalThis as any).simpleOutcome=null;void window.studio.openModelConfigEditor({expectedVersion:version}).then(r=>(globalThis as any).simpleOutcome=r);},read.value.version);const editor=await ready;
    await uiExpect(editor.getByRole('button',{name:'保存配置',exact:true})).toBeDisabled();
    expect(await editor.locator('input:visible:not([type=checkbox])').count()).toBe(3);
    await editor.getByLabel('模型用途',{exact:true}).selectOption(kind);
    await editor.getByLabel('Base URL',{exact:true}).fill(baseURL);await editor.getByLabel('API Key',{exact:true}).fill('fixture-simple-key');await editor.getByLabel('模型 ID',{exact:true}).fill(`simple-${kind}`);
    await editor.getByText('高级设置',{exact:true}).click();await editor.getByLabel('明确授权该私有端点',{exact:true}).check();
    if(kind==='text'){await editor.getByRole('button',{name:'测试连接',exact:true}).click();await uiExpect(editor.locator('#test-result')).toContainText('测试通过');}
    await editor.getByRole('button',{name:'保存配置',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(globalThis as any).simpleOutcome)).toMatchObject({ok:true,value:{status:'saved',synchronization:'imported'}});
  }
  const read=await page.evaluate(()=>window.studio.readModelConfig());expect(read).toMatchObject({ok:true,value:{providers:[{name:'simple-text',kind:'text',adapterType:'openai-chat-v1',parameters:{max_completion_tokens:1024}},{name:'simple-image',kind:'image',adapterType:'openai-image-v1',parameters:{}}]}});
  if(!read.ok)throw Error('read');expect(new Set(read.value.providers.map(p=>p.id)).size).toBe(2);expect(JSON.stringify(read)).not.toContain('fixture-simple-key');
});

it('keeps imported reference-image and video adapters, parameters and pricing when advanced settings stay collapsed',async()=>{
  const root=await mkdtemp(join(tmpdir(),'config-retain-advanced-'));roots.push(root);const config=join(root,'models.json');
  const entries=[{id:'reference',name:'Reference',kind:'image',baseURL:'https://fixture.invalid/v1',modelId:'image-fixture',apiKey:'fixture-preserve-key',allowPrivateEndpoint:false,adapterType:'openai-image-edit-v1',parameters:{size:'1024x1536',quality:'medium'},pricing:{status:'configured',currency:'USD',perImage:0.2,version:'fixture-v1'}},{id:'video',name:'Video',kind:'video',baseURL:'https://fixture.invalid/v1',modelId:'MiniMax-H3-Highspeed',apiKey:'fixture-preserve-key',allowPrivateEndpoint:false,adapterType:'minimax-video-v2',parameters:{duration:8,resolution:'768P',ratio:'16:9'},pricing:{status:'configured',currency:'CNY',perSecond:0.5,version:'fixture-v2'}}];
  await writeFile(config,JSON.stringify({schemaVersion:2,providers:entries}));
  const app=await _electron.launch({executablePath,args:[`--library-root=${join(root,'library')}`,`--user-data-dir=${join(root,'profile')}`,`--model-config=${config}`]});apps.push(app);const page=await app.firstWindow();await page.waitForFunction(()=>!!window.studio);
  for(const entry of entries){const read=await page.evaluate(()=>window.studio.readModelConfig());if(!read.ok)throw Error('read');const ready=app.waitForEvent('window');await page.evaluate(input=>{(globalThis as any).retainedOutcome=null;void window.studio.openModelConfigEditor(input).then(r=>(globalThis as any).retainedOutcome=r);},{providerId:entry.id,expectedVersion:read.value.version});const editor=await ready;await uiExpect(editor.getByRole('button',{name:'保存配置',exact:true})).toBeEnabled();expect(await editor.locator('details').getAttribute('open')).toBeNull();await editor.getByRole('button',{name:'保存配置',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(globalThis as any).retainedOutcome)).toMatchObject({ok:true,value:{status:'saved',synchronization:'imported'}});}
  const saved=JSON.parse(await readFile(config,'utf8'));for(const entry of entries)expect(saved.providers.find((p:any)=>p.id===entry.id)).toEqual(entry);
});
