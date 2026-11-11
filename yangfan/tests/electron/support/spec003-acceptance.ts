import{_electron,type ElectronApplication,type Page}from'@playwright/test';
import{cp,mkdir,readFile,writeFile,readdir,realpath}from'node:fs/promises';import{join,relative,basename}from'node:path';import{randomUUID}from'node:crypto';import{DatabaseSync,backup}from'node:sqlite';
import{isolatedModelConfig,packageExecutable}from'./product-launch.ts';
import{inspectDirectoryProject}from'../../../apps/desktop/src/main/project-directories.ts';
import{RecentProjects}from'../../../apps/desktop/src/main/recent-projects.ts';
export const evidenceRoot='D:/movieAgent/verification/2026-11-02-spec003-followups';
export const value=<T>(r:any):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
export async function previousCase(name:string):Promise<any>{const path=name==='max-clips'?'case-max-final.json':'cases-zip-dense.json',report=JSON.parse(await readFile('D:/movieAgent/verification/2026-11-01-spec003/packaged-final/'+path,'utf8'));return report.cases.find((c:any)=>c.name===name);}
export async function cloneCase(name:string):Promise<any>{
 const note=join(evidenceRoot,'clone-'+name+'.json');try{return JSON.parse(await readFile(note,'utf8'));}catch{}
 const prior=await previousCase(name),seed=prior.seed,source=(await realpath(seed.root)).replaceAll('\\','/');if(!source.toLowerCase().startsWith('d:/movieagent/verification/2026-11-01-spec003/'))throw Error('Unexpected fixture source');
 const root=join(evidenceRoot,'clones',name+'-'+randomUUID(),'中文 空格 短剧项目');await mkdir(join(root,'..'),{recursive:true});
 await cp(source,root,{recursive:true,force:false,errorOnExist:true,filter:p=>{const rel=relative(source,p).replaceAll('\\','/'),name=basename(p);if(/^(library\.sqlite(?:-.*)?|engine-guard\.sqlite(?:-.*)?|engine\.lock)$/.test(name))return false;if(rel.startsWith('exports/')||rel.startsWith('.movieagent/library/logs/'))return false;return true;}});
 const libraryRoot=join(root,'.movieagent','library'),db=new DatabaseSync(join(seed.libraryRoot,'library.sqlite'),{readOnly:true});try{await backup(db,join(libraryRoot,'library.sqlite'));}finally{db.close();}
 const result={...prior,seed:{...seed,root,libraryRoot}};await writeFile(note,JSON.stringify(result,null,2));return result;
}
function installMonitor(){const w=window as any;if(w.readMonitor)return;w.readMonitor={events:0,queue:{active:0,queued:0},cache:0,peakActive:0,peakQueued:0,peakCache:0,invalid:0};window.addEventListener('movieagent:timeline-read-stats',e=>{const s=(e as CustomEvent).detail,m=w.readMonitor;m.events++;if(s.kind==='queue'){m.queue={active:s.active,queued:s.queued};m.peakActive=Math.max(m.peakActive,s.active);m.peakQueued=Math.max(m.peakQueued,s.queued);if(s.active<0||s.queued<0)m.invalid++;}else if(s.kind==='cache'){m.cache=s.size;m.peakCache=Math.max(m.peakCache,s.size);if(s.size<0)m.invalid++;}});}
export async function launchDirectory(seed:any,sessionRoot:string,diagnostics?:string):Promise<{app:ElectronApplication;page:Page}>{
 await mkdir(sessionRoot,{recursive:true});const project=value<any>(await inspectDirectoryProject(seed.root)),registry=value<RecentProjects>(await RecentProjects.open(join(sessionRoot,'recent-projects.json')));value(await registry.remember(project));const config=await isolatedModelConfig(sessionRoot);
 const app=await _electron.launch({executablePath:packageExecutable,args:[config,'--workspace-child','--project-root='+seed.root,'--launcher-data='+sessionRoot,'--provider-evidence=fixture'],env:{...process.env,...(diagnostics?{MOVIEAGENT_MEDIA_DIAGNOSTICS_DIR:diagnostics}:{})},timeout:30000});
 try{await app.context().addInitScript(installMonitor);const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.evaluate(installMonitor);await page.getByText('本地引擎已连接',{exact:true}).waitFor({timeout:30000});await page.setViewportSize({width:1440,height:960});return{app,page};}catch(error){await app.close().catch(()=>{});throw error;}
}
export async function query(page:Page,kind:string,payload:any,scope?:any):Promise<any>{return value(await page.evaluate(async({kind,payload,scope})=>{const d=await window.studio.describe();if(!d.ok)throw Error('describe');return window.studio.query({schemaVersion:1,libraryId:d.value.libraryId,connectionEpoch:d.value.connectionEpoch,queryId:crypto.randomUUID(),kind,payload,...(scope?{scope}:{})}as any);},{kind,payload,scope}));}
export async function latestMetrics(directory:string):Promise<any[]>{const files=(await readdir(directory)).filter(f=>f.endsWith('.jsonl'));return Promise.all(files.map(async file=>{const lines=(await readFile(join(directory,file),'utf8')).trim().split('\n');return{file,...JSON.parse(lines.at(-1)!)};}));}
