import { afterEach, expect, it } from 'vitest';
import { _electron, expect as uiExpect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import sharp from 'sharp';
import { packageExecutable } from './support/product-launch.ts';
import { ArtifactSource } from '../../packages/providers/src/artifact-source';
let app: ElectronApplication | undefined, server: Server | undefined, root: string;
afterEach(async () => { await app?.close(); app=undefined; if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));server=undefined;}if(root)await rm(root,{recursive:true,force:true}); });
async function createProject(page:Page,name:string) { await page.getByLabel('项目名称').fill(name);await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('button',{name:`打开 ${name}`,exact:true}).click(); }
async function save(page:Page) { await page.getByRole('button',{name:'保存内容',exact:true}).click(); await uiExpect(page.getByRole('button',{name:'保存内容',exact:true})).toBeDisabled(); }
async function fitCanvas(page:Page) {
 const layouts=await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-id'),transform:(n as HTMLElement).style.transform})));
 await page.getByRole('button',{name:'Fit View',exact:true}).click();
 await expect.poll(()=>page.locator('.react-flow__node').evaluateAll(nodes=>{const stage=document.querySelector('.canvas-stage')!.getBoundingClientRect();return nodes.map(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.left>=stage.left&&r.right<=stage.right&&r.top>=stage.top&&r.bottom<=stage.bottom;});}),{timeout:5000}).toEqual([true,true,true,true]);
 expect(await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-id'),transform:(n as HTMLElement).style.transform})))).toEqual(layouts);
 await uiExpect(page.getByText('所有修改已保存',{exact:false})).toBeVisible();
}
it('connects typed ports in the packaged UI and approves one frozen native text → image → first-frame video workflow', async()=>{
 root=await mkdtemp(join(tmpdir(),'p2-desktop-chain-'));const library=join(root,'library'),config=join(root,'models.json');
 const png=await sharp({create:{width:256,height:256,channels:3,background:'#718477'}}).png().toBuffer();
 const requests:{url:string;body:string}[]=[];let videoComplete=false;
 server=createServer((q,r)=>{let body='';q.on('data',c=>body+=c);q.on('end',()=>{requests.push({url:q.url!,body});if(q.url==='/v1/chat/completions')r.end(JSON.stringify({choices:[{message:{content:'A lake <script>window.p2Unsafe=true</script>'},finish_reason:'stop'}]}));else if(q.url==='/v1/images/generations'||q.url==='/v1/images/edits')r.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));else if(q.url==='/v2/video_generation')r.end(JSON.stringify({task_id:'p2-native-video'}));else if(q.url==='/v2/query/video_generation/p2-native-video')r.end(JSON.stringify({task:{id:'p2-native-video',status:videoComplete?'succeeded':'running',content:videoComplete?{url:'https://cdn.example/p2.mp4'}:{}}}));else{r.writeHead(404);r.end();}});});
 await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
 await writeFile(config,JSON.stringify({schemaVersion:2,providers:[['text','openai-chat-v1','text',{max_tokens:128}],['image','openai-image-v1','image',{size:'1024x1024'}],['edit','openai-image-edit-v1','image',{}],['video','minimax-video-v2','video',{duration:4,resolution:'768P',ratio:'adaptive'}]].map(([id,adapterType,kind,parameters])=>({id,name:`Fixture ${id}`,adapterType,kind,parameters,pricing:{status:'unknown'},baseURL:`http://127.0.0.1:${port}/v1`,modelId:id==='video'?'MiniMax-H3-Highspeed':`fixture-${id}`,apiKey:'fixture-p2-key',allowPrivateEndpoint:true}))}));
 const launch=async()=>{app=await _electron.launch({executablePath:packageExecutable,args:['--provider-evidence=fixture',`--library-root=${library}`,`--user-data-dir=${join(root,'profile')}`,`--model-config=${config}`]});const page=await app.firstWindow();page.on('pageerror',e=>console.error('P2 renderer:',e.message));page.on('console',m=>{if(m.type()==='error')console.error('P2 console:',m.text());});await page.setViewportSize({width:1440,height:900});return page;};
 let page=await launch();await createProject(page,'P2 chain');
 await page.getByRole('button',{name:'添加文本',exact:true}).click();await page.getByLabel('文本内容').fill('A quiet lake');await save(page);
 await page.getByRole('button',{name:'添加生成节点',exact:true}).click();await page.getByLabel('生成预设').selectOption({label:'Fixture text · v1'});await page.getByLabel('提示词',{exact:true}).fill('Write a scene');await save(page);
 await uiExpect(page.getByLabel('连接来源')).toBeVisible();
 const ids=await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-id')!));
 const connect=async(source:string,port:string)=>{await page.getByLabel('连接来源').selectOption(source);await page.getByLabel('目标端口').selectOption(port);await page.getByRole('button',{name:'连接到当前节点',exact:true}).click();};
 await connect(ids[0]!,'prompt');await uiExpect(page.locator('.react-flow__edge')).toHaveCount(1);
 await page.getByRole('button',{name:'添加生成节点',exact:true}).click();await page.getByLabel('生成预设').selectOption({label:'Fixture image · v1'});await page.getByLabel('提示词',{exact:true}).fill('Paint this');await save(page);await connect(ids[1]!,'prompt');
 const imageId=await page.locator('.react-flow__node').last().getAttribute('data-id');
 await page.getByRole('button',{name:'添加生成节点',exact:true}).click();await page.getByLabel('生成预设').selectOption({label:'Fixture video · v1'});await page.getByLabel('提示词',{exact:true}).fill('Move the clouds');await save(page);await connect(imageId!,'first_frame');
 await fitCanvas(page);await uiExpect(page.locator('.react-flow__edge')).toHaveCount(3);await mkdir(resolve('test-results/p2-workflow'),{recursive:true});await page.screenshot({path:resolve('test-results/p2-workflow/connected-canvas.png')});
 await page.getByRole('button',{name:'运行所需上游',exact:true}).click();await uiExpect(page.getByRole('dialog')).toContainText('3 个生成步骤');
 await uiExpect(page.getByRole('dialog')).toContainText('first_frame');
 for(const field of await page.getByLabel(/步骤 \d+ 风险额度/).all())await field.fill('1');
 await page.getByLabel('项目预算上限',{exact:true}).fill('10');await page.getByLabel('批准币种',{exact:true}).fill('CNY');await page.getByLabel('我理解未知费用与供应商账单风险',{exact:true}).check();
 await mkdir(resolve('test-results/p2-workflow'),{recursive:true});await page.screenshot({path:resolve('test-results/p2-workflow/approval.png')});
 await page.getByRole('button',{name:'一次批准并运行计划',exact:true}).click();await uiExpect(page.getByRole('dialog')).toHaveCount(0);
 await expect.poll(()=>requests.filter(r=>r.url==='/v2/video_generation').length,{timeout:30000}).toBe(1);
 expect(JSON.parse(requests.find(r=>r.url==='/v1/images/generations')!.body).prompt).toContain('A lake');
 expect(JSON.parse(requests.find(r=>r.url==='/v2/video_generation')!.body).content[1].role).toBe('first_frame');
 const w=await page.evaluate(async()=>{const d=await window.studio.describe();if(!d.ok)throw Error('describe');const r=await window.studio.query({schemaVersion:1,libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,queryId:crypto.randomUUID(),kind:'workflow.list',payload:{}});if(!r.ok)throw Error(r.error.message);return r.value.workflows[0]!;});
 const attempt=w.steps[2]!.task!.attemptId;
 expect((await new ArtifactSource(library,undefined,'video').stage(`${attempt}-output`,await readFile(resolve('tests/fixtures/video-sample.mp4')))).ok).toBe(true);videoComplete=true;
 await uiExpect(page.getByText('计划已完成',{exact:true})).toBeVisible({timeout:30000});
 await uiExpect(page.locator('.canvas-card video')).toHaveCount(1);expect(await page.evaluate(()=>(window as any).p2Unsafe)).toBeUndefined();
 await page.getByRole('button',{name:'输出历史',exact:true}).click();await uiExpect(page.locator('.history-item')).toHaveCount(3);await uiExpect(page.getByText('输入版本追溯',{exact:true}).first()).toBeVisible();
 await page.setViewportSize({width:1100,height:720});await fitCanvas(page);await uiExpect(page.locator('.react-flow__edge')).toHaveCount(3);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Native capture avoids Playwright's video-compositor screenshot timeout.
 const capture=await app!.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));await writeFile(resolve('test-results/p2-workflow/history-1100.png'),Buffer.from(capture,'base64'));
 await app!.close();app=undefined;page=await launch();await page.getByRole('button',{name:'打开 P2 chain',exact:true}).click();await uiExpect(page.locator('.react-flow__edge')).toHaveCount(3);await uiExpect(page.getByText('计划已完成',{exact:true})).toBeVisible();expect(requests.filter(r=>r.url==='/v2/video_generation')).toHaveLength(1);
});

it('creates independent project presets for text length, image quality and adaptive video without rewriting the global file',async()=>{
 root=await mkdtemp(join(tmpdir(),'p2-project-presets-'));const config=join(root,'models.json');
 const body=JSON.stringify({schemaVersion:2,providers:[{id:'chat',name:'Fixture chat',kind:'text',adapterType:'openai-chat-v1',baseURL:'https://fixture.invalid/v1',modelId:'fixture-chat',apiKey:'dummy-preset-key',allowPrivateEndpoint:false,parameters:{max_tokens:128},pricing:{status:'unknown'}}]});await writeFile(config,body);
 app=await _electron.launch({executablePath:packageExecutable,args:[`--library-root=${join(root,'library')}`,`--user-data-dir=${join(root,'profile')}`,`--model-config=${config}`]});const page=await app.firstWindow();
 await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByRole('button',{name:'新建预设',exact:true}).click();await page.getByLabel('预设名称').fill('Longer local text');
 await uiExpect(page.getByLabel('最大文本长度（max_tokens）')).toBeVisible();await page.getByLabel('最大文本长度（max_tokens）').fill('512');await mkdir(resolve('test-results/p2-workflow'),{recursive:true});await page.screenshot({path:resolve('test-results/p2-workflow/text-parameters.png')});await page.getByRole('button',{name:'保存预设',exact:true}).click();
 await uiExpect(page.getByRole('heading',{name:/Longer local text/})).toBeVisible();expect(await readFile(config,'utf8')).toBe(body);
});

it('resets project preset parameters when switching model categories',async()=>{
 root=await mkdtemp(join(tmpdir(),'p2-preset-model-switch-'));const config=join(root,'models.json');
 await writeFile(config,JSON.stringify({schemaVersion:2,providers:[['chat','text','openai-chat-v1',{max_tokens:128}],['image','image','openai-image-v1',{size:'1024x1024',quality:'auto'}]].map(([id,kind,adapterType,parameters])=>({id,name:`Fixture ${id}`,kind,adapterType,parameters,baseURL:'https://fixture.invalid/v1',modelId:`fixture-${id}`,apiKey:'dummy-switch-key',allowPrivateEndpoint:false,pricing:{status:'unknown'}}))}));
 const original=await readFile(config,'utf8');app=await _electron.launch({executablePath:packageExecutable,args:[`--library-root=${join(root,'library')}`,`--user-data-dir=${join(root,'profile')}`,`--model-config=${config}`]});const page=await app.firstWindow();
 await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByRole('button',{name:'新建预设',exact:true}).click();await page.getByLabel('预设名称').fill('Switch to image');await page.getByLabel('模型版本').selectOption({label:'Fixture chat · v1'});await page.getByLabel('最大文本长度（max_tokens）').fill('512');await page.getByLabel('模型版本').selectOption({label:'Fixture image · v1'});await page.getByLabel('质量（quality）').selectOption('high');await page.getByRole('button',{name:'保存预设',exact:true}).click();await uiExpect(page.getByRole('dialog')).toHaveCount(0);
 const profiles=await page.evaluate(async()=>{const d=await window.studio.describe();if(!d.ok)throw Error('describe');const r=await window.studio.query({schemaVersion:1,libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,queryId:crypto.randomUUID(),kind:'profile.list',payload:{}});if(!r.ok)throw Error(r.error.message);return r.value.profiles;});expect(profiles.find(p=>p.name==='Switch to image')!.parameters).toEqual({quality:'high',size:'1024x1024'});expect(await readFile(config,'utf8')).toBe(original);
});

async function textWorkspace() {
 root=await mkdtemp(join(tmpdir(),'p2-ui-branches-'));const config=join(root,'models.json'),requests:string[]=[];const pending:{end():void}[]=[];
 server=createServer((q,r)=>{let body='';q.on('data',c=>body+=c);q.on('end',()=>{const prompt=JSON.parse(body).messages[0].content as string;requests.push(prompt);const done=()=>r.end(JSON.stringify({choices:[{message:{content:'Frozen result '+prompt},finish_reason:'stop'}]}));if(prompt.includes('Hold'))pending.push({end:done});else if(prompt.includes('Reject')){r.writeHead(400);r.end(JSON.stringify({error:{message:'fixture rejection'}}));}else if(prompt.includes('Unknown'))q.socket.destroy();else done();});});
 await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
 await writeFile(config,JSON.stringify({schemaVersion:2,providers:['chat','independent'].map(id=>({id,name:id==='chat'?'Fixture chat':'Fixture independent',kind:'text',adapterType:'openai-chat-v1',baseURL:`http://127.0.0.1:${port}/v1`,modelId:'fixture-chat',apiKey:'dummy-ui-branch-key',allowPrivateEndpoint:true,parameters:{max_tokens:128},pricing:{status:'unknown'}}))}));
 const launch=async()=>{app=await _electron.launch({executablePath:packageExecutable,args:['--provider-evidence=fixture',`--library-root=${join(root,'library')}`,`--user-data-dir=${join(root,'profile')}`,`--model-config=${config}`]});const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900});return page;};
 const page=await launch();await createProject(page,'Branches');
 const add=async(prompt:string)=>{await page.getByRole('button',{name:'添加生成节点',exact:true}).click();if(prompt==='Independent')await page.getByLabel('生成预设').selectOption({label:'Fixture independent · v1'});await page.getByLabel('提示词',{exact:true}).fill(prompt);await save(page);return (await page.locator('.react-flow__node').last().getAttribute('data-id'))!;};
 const focus=async(id:string)=>{await page.locator(`.react-flow__node[data-id="${id}"] header`).evaluate(el=>(el as HTMLElement).click());};
 const connect=async(source:string)=>{await page.getByLabel('连接来源').selectOption(source);await page.getByLabel('目标端口').selectOption('prompt');await page.getByRole('button',{name:'连接到当前节点',exact:true}).click();};
 const approve=async()=>{await uiExpect(page.getByRole('dialog',{name:'确认执行计划'})).toBeVisible();for(const field of await page.getByLabel(/步骤 \d+ 风险额度/).all())await field.fill('1');await page.getByLabel('项目预算上限',{exact:true}).fill('100');await page.getByLabel('我理解未知费用与供应商账单风险',{exact:true}).check();await page.getByRole('button',{name:'一次批准并运行计划',exact:true}).click();await uiExpect(page.getByRole('dialog')).toHaveCount(0);};
 return {page,requests,pending,launch,add,focus,connect,approve};
}
it('rejects invalid/cyclic connections, disconnects/undoes and uses actual port dragging',async()=>{
 const s=await textWorkspace(),a=await s.add('Alpha'),b=await s.add('Beta');
 await s.page.getByLabel('连接来源').selectOption(a);await s.page.getByLabel('目标端口').selectOption('reference');await s.page.getByRole('button',{name:'连接到当前节点',exact:true}).click();await uiExpect(s.page.getByRole('alert')).toContainText('GRAPH');await uiExpect(s.page.locator('.react-flow__edge')).toHaveCount(0);await s.page.getByRole('button',{name:'关闭提示',exact:true}).click();
 await s.connect(a);await uiExpect(s.page.locator('.react-flow__edge')).toHaveCount(1);await s.focus(a);await s.connect(b);await uiExpect(s.page.getByRole('alert')).toContainText('GRAPH');await uiExpect(s.page.locator('.react-flow__edge')).toHaveCount(1);await s.page.getByRole('button',{name:'关闭提示',exact:true}).click();
 await s.page.getByRole('button',{name:'断开连线',exact:true}).click();await uiExpect(s.page.locator('.react-flow__edge')).toHaveCount(0);await s.page.getByRole('button',{name:'撤销',exact:true}).click();await uiExpect(s.page.locator('.react-flow__edge')).toHaveCount(1);await s.page.getByRole('button',{name:'断开连线',exact:true}).click();await uiExpect(s.page.locator('.react-flow__edge')).toHaveCount(0);await uiExpect(s.page.getByRole('button',{name:'连接到当前节点',exact:true})).toBeEnabled();

 const from=await s.page.locator(`.react-flow__node[data-id="${a}"] .react-flow__handle.source`).boundingBox(),to=await s.page.locator(`.react-flow__node[data-id="${b}"] .react-flow__handle.target`).boundingBox();if(!from||!to)throw Error('typed handles');
 expect(await s.page.evaluate(({from,to})=>[from,to].map(p=>document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)?.classList.contains('react-flow__handle')),{from,to})).toEqual([true,true]);
 await s.page.mouse.move(from.x+from.width/2,from.y+from.height/2);await s.page.mouse.down();await s.page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:16});await s.page.mouse.up();await uiExpect(s.page.locator('.react-flow__edge')).toHaveCount(1);expect(s.requests).toHaveLength(0);
});
it('stops future children, preserves late results as history after manual edits, and reopening makes no duplicate POST',async()=>{
 const s=await textWorkspace(),a=await s.add('Hold old input');await s.add('Dependent');await s.connect(a);await s.page.getByRole('button',{name:'运行当前节点',exact:true}).click();await uiExpect(s.page.getByRole('alert')).toContainText('WORKFLOW_INPUT_UNAVAILABLE');await s.page.getByRole('button',{name:'关闭提示',exact:true}).click();
 await s.page.getByRole('button',{name:'运行所需上游',exact:true}).click();await s.approve();await expect.poll(()=>s.requests.length).toBe(1);
 await s.focus(a);await s.page.getByLabel('提示词',{exact:true}).fill('Manual newer input');await save(s.page);await s.page.getByRole('button',{name:'停止后续步骤',exact:true}).click();await uiExpect(s.page.getByText(/Fixture chat · 已停止/).first()).toBeVisible();s.pending[0]!.end();
 await uiExpect(s.page.getByText('计划已停止',{exact:true})).toBeVisible({timeout:30000});await s.page.getByRole('button',{name:'输出历史',exact:true}).click();await uiExpect(s.page.locator('.history-item')).toHaveCount(1);await uiExpect(s.page.locator('.history-item')).toContainText('保留历史');await uiExpect(s.page.locator('.history-item')).toContainText('输入内容已变化');
 await app!.close();app=undefined;const reopened=await s.launch();await reopened.getByRole('button',{name:'打开 Branches',exact:true}).click();await uiExpect(reopened.getByText('计划已停止',{exact:true})).toBeVisible();await uiExpect(reopened.locator('.react-flow__edge')).toHaveCount(1);expect(s.requests).toHaveLength(1);
});
it.each(['Reject','Unknown'])('continues the selected independent branch when %s blocks dependent work and exposes original-task recovery',async(mode)=>{
 const s=await textWorkspace(),a=await s.add(mode+' root');await s.add('Dependent');await s.connect(a);await s.add('Independent');
 await s.page.getByText(/执行选择 ·/).click();for(const field of await s.page.getByLabel(/^选入执行 /).all())await field.check();await s.page.getByRole('button',{name:'运行选定子图',exact:true}).click();await uiExpect(s.page.getByRole('dialog')).toContainText('3 个生成步骤');await s.approve();await expect.poll(()=>s.requests.length).toBe(2);
 await uiExpect(s.page.getByText('依赖阻断',{exact:false})).toBeVisible({timeout:30000});await uiExpect(s.page.getByText(/Fixture independent · 已完成/)).toBeVisible({timeout:30000});expect(s.requests).toContain('Independent');expect(s.requests.some(p=>p==='Dependent')).toBe(false);
 if(mode==='Unknown'){await s.page.getByRole('button',{name:'查看步骤任务 1',exact:true}).click();await uiExpect(s.page.getByRole('dialog')).toContainText('未知，不能重复提交');await uiExpect(s.page.getByRole('button',{name:'核实原任务',exact:true})).toBeEnabled();await s.page.keyboard.press('Escape');}
 await app!.close();app=undefined;const reopened=await s.launch();await reopened.getByRole('button',{name:'打开 Branches',exact:true}).click();await uiExpect(reopened.getByText('依赖阻断',{exact:false})).toBeVisible();expect(s.requests).toHaveLength(2);
});

it('uses fixed asset versions and ordered roles for native image edits, reference video and first/last-frame video',async()=>{
 root=await mkdtemp(join(tmpdir(),'p2-native-references-'));const library=join(root,'library'),config=join(root,'models.json'),reference=join(root,'reference.png');
 const png=await sharp({create:{width:256,height:256,channels:3,background:'#254677'}}).png().toBuffer();await writeFile(reference,png);
 const requests:{url:string;body:string}[]=[];let submitted=0;const finished=new Set<string>();
 server=createServer((q,r)=>{let body='';q.on('data',c=>body+=c);q.on('end',()=>{requests.push({url:q.url!,body});if(q.url==='/v1/images/edits')r.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));else if(q.url==='/v2/video_generation')r.end(JSON.stringify({task_id:`reference-${++submitted}`}));else if(q.url?.startsWith('/v2/query/video_generation/')){const id=q.url.split('/').pop()!;r.end(JSON.stringify({task:{id,status:finished.has(id)?'succeeded':'running',content:finished.has(id)?{url:'https://cdn.example/reference.mp4'}:{}}}));}else{r.writeHead(404);r.end();}});});await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
 await writeFile(config,JSON.stringify({schemaVersion:2,providers:[['edit','openai-image-edit-v1','image',{}],['video','minimax-video-v2','video',{duration:4,resolution:'768P',ratio:'adaptive'}]].map(([id,adapterType,kind,parameters])=>({id,name:`Fixture ${id}`,adapterType,kind,parameters,pricing:{status:'unknown'},baseURL:`http://127.0.0.1:${port}/v1`,modelId:id==='video'?'MiniMax-H3-Highspeed':'fixture-edit',apiKey:'dummy-reference-key',allowPrivateEndpoint:true}))}));
 app=await _electron.launch({executablePath:packageExecutable,args:['--provider-evidence=fixture',`--library-root=${library}`,`--user-data-dir=${join(root,'profile')}`,`--model-config=${config}`]});const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900});await createProject(page,'References');
 await page.getByRole('button',{name:'资产',exact:true}).click();await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},reference);await page.getByRole('button',{name:'导入素材',exact:true}).click();await uiExpect(page.getByRole('button',{name:'预览 reference.png',exact:true})).toBeVisible();await page.getByRole('button',{name:'画布',exact:true}).click();await page.getByRole('button',{name:'添加生成节点',exact:true}).click();await page.getByLabel('生成预设').selectOption({label:'Fixture edit · v1'});await page.getByLabel('提示词',{exact:true}).fill('Edit the fixed picture');
 const addRef=async(role:string)=>{await page.getByLabel('参考图片固定版本').selectOption({label:'reference.png · v1'});await page.getByLabel('参考角色',{exact:true}).selectOption(role);await page.getByRole('button',{name:'添加固定参考',exact:true}).click();};
 const single=async()=>{await save(page);await page.getByRole('button',{name:'准备生成',exact:true}).click();await uiExpect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('单次风险额度',{exact:true}).fill('1');await page.getByLabel('项目预算上限',{exact:true}).fill('100');await page.getByLabel('批准币种',{exact:true}).fill('CNY');await page.getByLabel('我理解费用未知，额度不能限制供应商实际账单',{exact:true}).check();await page.getByRole('button',{name:/批准并生成/}).click();await uiExpect(page.getByRole('dialog')).toHaveCount(0);};
 await addRef('reference');await single();await expect.poll(()=>requests.filter(r=>r.url==='/v1/images/edits').length).toBe(1);await uiExpect(page.locator('.canvas-card img')).toHaveCount(1);expect(requests.find(r=>r.url==='/v1/images/edits')!.body).toContain('name="image[]"');
 for(const roles of [['reference'],['first_frame','last_frame']]){
  await page.getByLabel('生成预设').selectOption({label:'Fixture video · v1'});await page.getByRole('button',{name:'移除参考 1',exact:true}).click();for(const role of roles)await addRef(role);await single();
  await expect.poll(()=>submitted).toBe(roles.length===1?1:2);const task=await page.evaluate(async id=>{const d=await window.studio.describe();if(!d.ok)throw Error('descriptor');const tasks=await window.studio.query({schemaVersion:1,libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,queryId:crypto.randomUUID(),kind:'task.list',payload:{}});if(!tasks.ok)throw Error(tasks.error.message);return tasks.value.tasks.find(t=>t.providerTaskId===id)!;},`reference-${submitted}`);
  const body=JSON.parse(requests.filter(r=>r.url==='/v2/video_generation').at(-1)!.body);expect(body.content.filter((c:any)=>c.type==='image_url').map((c:any)=>c.role)).toEqual(roles.map(role=>role==='reference'?'reference_image':role));
  expect((await new ArtifactSource(library,undefined,'video').stage(`${task.attemptId}-output`,await readFile(resolve('tests/fixtures/video-sample.mp4')))).ok).toBe(true);finished.add(`reference-${submitted}`);await uiExpect(page.locator('.canvas-card video')).toHaveCount(1,{timeout:30000});await expect.poll(()=>page.locator('.canvas-card video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
  if(roles.length===1)await page.getByLabel('提示词',{exact:true}).fill('First and last frames');
 }
 await page.getByText('节点模式与参数 · video',{exact:true}).click();await page.getByLabel('画面比例',{exact:true}).selectOption('9:16');await page.screenshot({path:resolve('test-results/p2-workflow/video-parameters.png')});await page.getByRole('button',{name:'保存节点参数为项目预设',exact:true}).click();await uiExpect(page.getByLabel('生成预设')).toHaveValue(/:/);await page.getByRole('button',{name:'移除参考 1',exact:true}).click();await page.getByRole('button',{name:'移除参考 1',exact:true}).click();await save(page);await page.getByRole('button',{name:'准备生成',exact:true}).click();await uiExpect(page.getByRole('dialog')).toContainText('"ratio":"9:16"');await page.getByRole('button',{name:'暂不生成',exact:true}).click();
 expect(JSON.parse(await readFile(config,'utf8')).providers[1].parameters.ratio).toBe('adaptive');
});
