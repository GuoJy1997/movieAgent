import fs from 'node:fs/promises';import path from 'node:path';import{pathToFileURL}from'node:url';import{createRequire}from'node:module';import{createInterface}from'node:readline';import{randomUUID}from'node:crypto';
const repo='D:/movieAgent/libtv-studio', evidence=path.dirname(new URL(import.meta.url).pathname.replace(/^\//,'')), require=createRequire(path.join(repo,'package.json'));
const {_electron}=require('@playwright/test');
const {createDirectoryProject,bindDirectoryProject,inspectDirectoryProject}=await import(pathToFileURL(repo+'/apps/desktop/src/main/project-directories.ts'));
const {RecentProjects}=await import(pathToFileURL(repo+'/apps/desktop/src/main/recent-projects.ts'));
const {startEngine}=await import(pathToFileURL(repo+'/packages/engine/src/bootstrap.ts'));
const take=r=>{if(!r.ok)throw Error(r.error.code);return r.value};
const parent='D:/movieAgent/projects';await fs.mkdir(parent,{recursive:true});
let old;try{old=JSON.parse(await fs.readFile(path.join(evidence,'state.json'),'utf8'))}catch{}
const name=old?.name??('连续创作真实验收-20261031-'+Date.now().toString().slice(-6));
const project=old?take(await inspectDirectoryProject(old.projectRoot)):take(await createDirectoryProject({mode:'new',directory:parent,name}));
let p;
if(old)p={id:old.projectId};else{
const e=take(await startEngine({root:project.libraryRoot}));
p=take(await e.commands.execute({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'live-init',commandId:'live-init',kind:'project.create',payload:{name}})).result;
take(await bindDirectoryProject(project.root,{workspaceId:project.manifest.workspaceId,libraryId:e.identity.libraryId,projectId:p.id}));take(await e.close());
}
const registry=take(await RecentProjects.open(path.join(evidence,'launcher/recent-projects.json')));take(await registry.remember(project));
const data=old??{runId:randomUUID(),projectId:p.id,projectRoot:project.root,libraryRoot:project.libraryRoot,name,requestedVideoCount:1,requestedVideoSeconds:4,steps:[]};
const save=async()=>fs.writeFile(path.join(evidence,'state.json'),JSON.stringify(data,null,2));
const log=(stage,detail={})=>console.log(JSON.stringify({stage,...detail}));
let app;
try{
 app=await _electron.launch({executablePath:repo+'/apps/desktop/release-spec002-task-recovery/win-unpacked/MovieAgent.exe',args:['--user-data-dir='+path.join(evidence,'user-data'),'--workspace-child','--project-root='+project.root,'--launcher-data='+path.join(evidence,'launcher'),'--model-config='+repo+'/config/models.json'],timeout:30000});
 const page=await app.firstWindow();await page.setViewportSize({width:1500,height:1000});await page.waitForFunction(()=>!!window.studio);
 let descriptor;for(let i=0;i<60;i++){const r=await page.evaluate(()=>window.studio.describe());if(r.ok){descriptor=r.value;break}await new Promise(r=>setTimeout(r,1000));}if(!descriptor)throw Error('ENGINE_NOT_READY');
 data.libraryId=descriptor.libraryId;
 const query=async(kind,payload={},scope)=>take(await page.evaluate(v=>window.studio.query(v),{schemaVersion:1,libraryId:data.libraryId,connectionEpoch:descriptor.connectionEpoch,queryId:randomUUID(),kind,payload,...(scope?{scope}:{})}));
 const execute=async(kind,payload,scope,commandId=randomUUID())=>take(await page.evaluate(v=>window.studio.execute(v),{schemaVersion:1,libraryId:data.libraryId,connectionEpoch:descriptor.connectionEpoch,commandId,kind,payload,...(scope?{scope}:{})})).result;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(stage,read,done,timeout=300000)=>{const start=Date.now();let lastLog=0;while(Date.now()-start<timeout){const r=await read();if(done(r))return r;if(Date.now()-lastLog>=10000){log(stage,{elapsedSeconds:Math.round((Date.now()-start)/1000),state:r.state??r.completions?.[0]?.state??'waiting'});lastLog=Date.now();}await sleep(1000)}throw Error(stage+'_TIMEOUT_DO_NOT_RESUBMIT')};
 const scopeOf=child=>({projectId:data.projectId,subprojectId:child.id});
 const refs=x=>({libraryId:data.libraryId,id:x.id,revision:x.revision});
 const ctx={repo,evidence,data,save,log,app,page,query,execute,wait,sleep,scopeOf,refs,take,fs,path,randomUUID};
 let models;for(let i=0;i<60;i++){models=await query('model.list');if(models.models.length>=2)break;await sleep(1000)}
 const profiles=await query('profile.list');
 data.videoModel=models.models.toSorted((a,b)=>b.revision-a.revision).find(x=>x.capabilities.outputKinds.includes('video'));
 data.textModel=models.models.toSorted((a,b)=>b.revision-a.revision).find(x=>x.capabilities.outputKinds.includes('text'));
 data.videoProfile=profiles.profiles.toSorted((a,b)=>b.revision-a.revision).find(x=>x.modelRef.id===data.videoModel?.id);
 data.textProfile=profiles.profiles.toSorted((a,b)=>b.revision-a.revision).find(x=>x.modelRef.id===data.textModel?.id);
 if(!data.videoProfile||!data.textProfile)throw Error('CONFIGURED_MODELS_NOT_IMPORTED');
 data.a??=await execute('subproject.create',{projectId:p.id,title:'第一集 · 邸报',number:'01'});
 data.b??=await execute('subproject.create',{projectId:p.id,title:'第二集 · 前情验证',number:'02'});
 await save();log('READY',{projectRoot:data.projectRoot,libraryId:data.libraryId,videoModel:data.videoModel.modelId,textModel:data.textModel.modelId});
 const input=createInterface({input:process.stdin,output:process.stdout,terminal:false});
 for await(const line of input){const phase=line.trim();if(phase==='close'){input.close();break;}if(!/^[a-z0-9-]+$/.test(phase)){log('INVALID_PHASE');continue}try{const m=await import(pathToFileURL(path.join(evidence,phase+'.mjs')).href+'?v='+Date.now());await m.run(ctx);await save();log('PHASE_DONE',{phase});}catch(error){data.lastError={phase,code:/^[A-Z0-9_: -]+$/.test(error.message)?error.message:'LOCAL_RUNNER_ERROR'};await save();log('PHASE_FAILED',data.lastError);}}
} catch(error){log('KERNEL_FAILED',{name:error.name,message:error.message,stack:error.stack});process.exitCode=1}
finally{await save();await app?.close();}

