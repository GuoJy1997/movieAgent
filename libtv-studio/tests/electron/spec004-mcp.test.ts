import {it,expect} from 'vitest';
import {_electron,expect as ui,type ElectronApplication,type Page} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import sharp from 'sharp';
import {createDirectoryProject} from '../../apps/desktop/src/main/project-directories';
import {RecentProjects} from '../../apps/desktop/src/main/recent-projects';
import {packageExecutable} from './support/product-launch';
const base='D:/movieAgent/verification/2026-11-02-spec004-m1';
function val<T=any>(r:any):T{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
async function execute(page:Page,kind:string,payload:any,scope?:any){return val<any>(await page.evaluate(async({kind,payload,scope})=>{const d=await window.studio.describe();if(!d.ok)throw Error('offline');return window.studio.execute({schemaVersion:1,libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,commandId:crypto.randomUUID(),kind,payload,...(scope?{scope}:{})} as any);},{kind,payload,scope})).result;}
async function query(page:Page,kind:string,payload:any){return val<any>(await page.evaluate(async({kind,payload})=>{const d=await window.studio.describe();if(!d.ok)throw Error('offline');return window.studio.query({schemaVersion:1,libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,queryId:crypto.randomUUID(),kind,payload} as any);},{kind,payload}));}
it('runs packaged stdio MCP through import, bindings, external-frame production, approval, and reopen',async()=>{
 const root=join(base,'desktop-runs',randomUUID()),data=join(root,'desktop');await mkdir(data,{recursive:true});
 const project=val<any>(await createDirectoryProject({mode:'new',directory:root,name:'MCP 外部图片验收'}));
 const registry=val<RecentProjects>(await RecentProjects.open(join(data,'recent-projects.json')));val(await registry.remember(project));
 const config=join(root,'empty-models.json');await writeFile(config,JSON.stringify({schemaVersion:1,providers:[]}));
 const report:any={status:'running',root,package:packageExecutable,modelCalls:0,fixturePosts:0,checks:[]};
 let app:ElectronApplication|undefined,client:Client|undefined,transport:StdioClientTransport|undefined;
 const requests:Buffer[]=[];const provider=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{if(req.method==='POST')requests.push(Buffer.concat(chunks));res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'Fixture refusal after request capture; no real generation.'}));});});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));const address=provider.address();if(!address||typeof address==='string')throw Error('provider');
 async function launch(){const instance=await _electron.launch({executablePath:packageExecutable,args:['--workspace-child','--project-root='+project.root,'--launcher-data='+data,'--model-config='+config,'--provider-evidence=fixture'],timeout:30000});app=instance;const page=await instance.firstWindow();page.setDefaultTimeout(20000);await page.getByText('本地引擎已连接',{exact:true}).waitFor({timeout:30000});await page.setViewportSize({width:1440,height:1000});return page;}
 async function connect(page:Page){const status=val<any>(await page.evaluate(()=>window.studio.mcpStatus!()));client=new Client({name:'MovieAgent packaged acceptance',version:'1'});transport=new StdioClientTransport({...status.clientConfig,stderr:'pipe'});const errors:string[]=[];transport.stderr?.on('data',b=>errors.push(String(b)));await client.connect(transport);return {status,errors};}
 let instanceId='';
 async function call(name:string,args:any={}){const r=await client!.callTool({name,arguments:name==='system_instances'?{}:{instanceId,...args}});const result=r.structuredContent as any;if(r.isError||!result?.ok)throw Error(name+': '+JSON.stringify(result));return result.value;}
 try{
  let page=await launch();await page.getByRole('button',{name:'模型设置',exact:true}).click();
  await page.getByRole('button',{name:'启用 MCP',exact:true}).click();await ui(page.getByRole('button',{name:'停用 MCP',exact:true})).toBeVisible();
  const connected=await connect(page);instanceId=connected.status.instanceId;
  expect((await call('system_instances')).some((x:any)=>x.instanceId===instanceId)).toBe(true);expect((await call('system_doctor')).ready).toBe(true);
  const parent=(await call('project_list')).projects[0],sub=(await call('subproject_list',{projectId:parent.id})).items[0],scope={libraryId:parent.libraryId,projectId:parent.id,subprojectId:sub.id};
  report.scope=scope;const innerScope={projectId:parent.id,subprojectId:sub.id};
  await call('entity_save',{scope,requestId:'hero',id:'hero',expectedRevision:0,kind:'character',name:'朱清',description:'MCP fixture character',constraints:'固定参考图',references:[]});
  await execute(page,'creation.saveScript',{projectId:parent.id,id:'script',expectedRevision:0,title:'开场',synopsis:'',body:'风吹梧桐。',scenes:[{id:'scene',title:'梧桐道',location:'道边',time:'午后',description:''}]},innerScope);
  await execute(page,'creation.saveShot',{projectId:parent.id,id:'shot',expectedRevision:0,scriptId:'script',sceneId:'scene',order:0,title:'G01',durationSeconds:4,shotSize:'wide',cameraMovement:'fixed',subject:'梧桐',action:'风吹树叶',dialogue:'',sound:'wind',aspectRatio:'16:9',prompt:'Still establishing shot of a quiet tree-lined road.',entityRefs:[]},innerScope);
  const canvas=(await call('canvas_list',{scope})).items[0],graph=await call('canvas_get',{scope,canvasId:canvas.id});
  const sources=await call('import_sources'),file=join(sources[0].path,'agent-output.png'),bytes=await sharp({create:{width:512,height:288,channels:3,background:'#617b68'}}).png().toBuffer();await writeFile(file,bytes);
  const input={scope,requestId:'external-picture',name:'Agent 外部参考图',shared:true,source:{kind:'localFile',importSourceId:sources[0].id,path:'agent-output.png'},sourceInfo:{sourceKind:'agent',sourceApp:'Local acceptance fixture'},bindings:[{kind:'entity',entityId:'hero',expectedRevision:1},{kind:'shot',shotId:'shot',expectedRevision:1,expectedSelectionRevision:0},{kind:'canvas',canvasId:canvas.id,baseRevision:graph.revision,nodeId:'external-image',x:60,y:80}]};
  let imported=await call('assets_import',input);imported=await call('imports_wait',{scope,operationId:imported.operationId,timeoutMs:10000});expect(imported.state).toBe('completed');expect(imported.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect((await call('assets_import',input)).asset.ref).toEqual(imported.asset.ref);await unlink(file);
  expect((await call('assets_list',{scope,view:'common'})).items).toHaveLength(1);
  const preview=await client!.callTool({name:'assets_preview',arguments:{instanceId,scope,ref:imported.asset.ref}});expect((preview.content as any[]).some(c=>c.type==='image')).toBe(true);
  await page.getByRole('button',{name:'资产',exact:true}).click();await page.getByText('Agent 外部参考图',{exact:true}).first().waitFor();await page.screenshot({path:join(root,'01-assets.png')});report.checks.push('stdio handshake','import/dedup','entity+shot+canvas binding','UI asset visible','source deletion safe');
  const connectionRef=await execute(page,'provider.saveConnection',{id:'mcp-fixture',expectedRevision:0,name:'MCP fixture',adapterType:'minimax-video-v2',baseUrl:'http://127.0.0.1:'+address.port+'/v1',credentialRef:null,headers:{},networkPolicy:{privateEndpoint:{hostname:'127.0.0.1',port:address.port,purpose:'model-api'}},timeoutMs:1000,concurrency:1});
  const modelRef=await execute(page,'model.saveDefinition',{id:'mcp-fixture',expectedRevision:0,name:'Fixture video',modelId:'MiniMax-H3-Highspeed',connectionRef,capabilities:{taskTypes:['text_to_video','image_to_video'],inputKinds:['text','image'],outputKinds:['video'],maxBatch:1},parameters:{duration:{type:'integer',min:4,max:15,default:4},resolution:{type:'enum',values:['768P'],default:'768P'},ratio:{type:'enum',values:['adaptive'],default:'adaptive'}},pricing:{status:'unknown'}});
  const videoProfileRef=await execute(page,'profile.save',{id:'mcp-fixture',expectedRevision:0,name:'Fixture video',modelRef,parameters:{}});
  const plan=await call('production_prepare',{scope,requestId:'prepare-video',scriptId:'script',canvasId:canvas.id,shots:[{shotId:'shot',revision:1}],videoProfileRef,reusedImages:[{shotId:'shot',ref:imported.asset.ref,role:'first_frame'}]});
  expect(plan.steps.map((s:any)=>s.role)).toEqual(['video']);expect(plan.steps[0].referenceImages[0].ref).toEqual(imported.asset.ref);
  await call('production_apply',{scope,requestId:'place-video',productionId:plan.productionId,approvedHash:plan.planHash,expectedCanvasRevision:plan.canvasRevision});
  const workflow=await call('production_prepare_execution',{scope,requestId:'prepare-execution',productionId:plan.productionId});expect(workflow.steps).toHaveLength(1);
  await app!.evaluate(({dialog})=>{(globalThis as any).mcpConfirmCount=0;dialog.showMessageBox=(async()=>{(globalThis as any).mcpConfirmCount++;return {response:1,checkboxChecked:false};}) as any;});
  const spend={scope,requestId:'reject-spend',productionId:plan.productionId,budgetLimitMicros:1000000,stepAllowanceMicros:10000};
  expect((await call('production_execute',spend)).submitted).toBe(false);expect(requests).toHaveLength(0);expect((await query(page,'task.list',{})).tasks).toHaveLength(0);
  await app!.evaluate(({dialog})=>{dialog.showMessageBox=(async()=>{(globalThis as any).mcpConfirmCount++;return {response:0,checkboxChecked:false};}) as any;});
  const executeArgs={...spend,requestId:'fixture-only-spend'};
  expect((await call('production_execute',executeArgs)).submitted).toBe(true);
  await expect.poll(()=>requests.length,{timeout:15000}).toBe(1);
  expect(requests[0]!.toString()).toContain(bytes.toString('base64'));
  await call('production_execute',executeArgs);expect(await app!.evaluate(()=> (globalThis as any).mcpConfirmCount)).toBe(2);
  await expect.poll(async()=> (await query(page,'task.list',{})).tasks[0]?.state,{timeout:15000}).toBe('FAILED');
  report.fixturePosts=requests.length;report.fixtureTaskOutcome='intentionally rejected by local HTTP fixture after exact image request verification';report.imageGenerationSteps=0;
  await page.getByRole('button',{name:'画布',exact:true}).click();await page.screenshot({path:join(root,'02-canvas.png')});
  const storedRef=imported.asset.ref;await client!.close();client=undefined;await app!.close();app=undefined;
  page=await launch();const reopened=await connect(page);instanceId=reopened.status.instanceId;
  const replay=await call('assets_import',input);expect(replay.asset.ref).toEqual(storedRef);
  const reopenedAsset=await call('assets_get',{scope,ref:storedRef});expect(reopenedAsset.asset.ref).toEqual(storedRef);
  const replayExecution=await call('production_execute',executeArgs);expect(replayExecution.submitted).toBe(true);expect(requests).toHaveLength(1);
  await page.getByRole('button',{name:'模型设置',exact:true}).click();await ui(page.getByRole('button',{name:'停用 MCP',exact:true})).toBeVisible();await page.screenshot({path:join(root,'03-settings.png')});
  await page.getByRole('button',{name:'停用 MCP',exact:true}).click();expect(val<any>(await page.evaluate(()=>window.studio.mcpStatus!())).enabled).toBe(false);
  report.checks.push('video-only fixed image plan','desktop decline produces zero tasks','approved local fixture submits once','restart retains assets and request receipts','disable revokes MCP');
  report.status='passed';report.asarSha256=createHash('sha256').update(await readFile(resolve(packageExecutable,'..','resources','app.asar'))).digest('hex');
 }catch(e){report.status='failed';report.error=String(e);throw e;}
 finally{await client?.close().catch(()=>{});await transport?.close().catch(()=>{});await app?.close().catch(()=>{});provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));await writeFile(join(base,'desktop-report.json'),JSON.stringify(report,null,2));}
},240000);
