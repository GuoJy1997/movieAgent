import {expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createDirectoryProject,bindDirectoryProject} from '../../apps/desktop/src/main/project-directories.ts';
import {startEngine} from '../../packages/engine/src/bootstrap.ts';
import {createProjectBackup,restoreProjectBackup,inspectProjectBackup} from '../../packages/storage/src/project-backup.ts';
const take=(r:any):any=>{if(!r.ok)throw Error(r.error.code);return r.value;};
it('backs up all children, fixed ownership, completion and memory and restores without replaying completion tasks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'subprojects-backup-'));
 let engine:any=null,restoredEngine:any=null;
 try{
 const directory=take(await createDirectoryProject({mode:'new',directory:root,name:'Series'}));
 engine=take(await startEngine({root:directory.libraryRoot}));
 const run=async(kind:string,payload:unknown,scope?:any)=>take(await engine.commands.execute({schemaVersion:1,libraryId:engine.identity.libraryId,connectionEpoch:'test',commandId:crypto.randomUUID(),kind,payload,...(scope?{scope}:{})})).result;
 const p=await run('project.create',{name:'Series'});
 take(await bindDirectoryProject(directory.root,{workspaceId:directory.manifest.workspaceId,libraryId:engine.identity.libraryId,projectId:p.id}));
 const a=await run('subproject.create',{projectId:p.id,title:'A'}),b=await run('subproject.create',{projectId:p.id,title:'B'}),scope={projectId:p.id,subprojectId:a.id};
 await run('subproject.createCanvas',{...scope,title:'Second canvas'});
 await run('creation.saveScript',{projectId:p.id,id:'a-script',expectedRevision:0,title:'A',synopsis:'',body:'保留的剧本',scenes:[]},scope);
 await run('project.memorySave',{projectId:p.id,id:'rule',expectedRevision:0,kind:'rule',body:'项目设定',status:'active'});
 const c=await run('subproject.complete',{...scope,expectedRevision:1,note:'待同步'});
 await writeFile(join(directory.root,'subprojects',a.id,'notes','user.txt'),'用户资料');
 take(await engine.close());engine=null;
 const backup=take(await createProjectBackup({projectRoot:directory.root,destination:join(root,'backup'),appVersion:'0.2.0'}));
 const manifest=take(await inspectProjectBackup(backup.root));expect(manifest.files.some((f:any)=>f.path.includes(a.id+'/notes/user.txt'))).toBe(true);
 const restored=take(await restoreProjectBackup({backupRoot:backup.root,destination:join(root,'restored')}));
 restoredEngine=take(await startEngine({root:join(restored.root,'.movieagent/library')}));
 const query=(kind:string,payload:unknown,sc?:any)=>take(restoredEngine.commands.query({schemaVersion:1,libraryId:restoredEngine.identity.libraryId,connectionEpoch:'test',queryId:crypto.randomUUID(),kind,payload,...(sc?{scope:sc}:{})}));
 expect(query('subproject.list',{projectId:p.id}).items.map((s:any)=>s.id)).toEqual(expect.arrayContaining([a.id,b.id]));
 expect(query('subproject.canvases',scope).items).toHaveLength(2);
 expect(query('creation.read',{projectId:p.id},scope).scripts).toMatchObject([{id:'a-script',body:'保留的剧本'}]);
 const memory=query('project.memory',{projectId:p.id});expect(memory.entries[0].body).toBe('项目设定');expect(memory.completions[0]).toMatchObject({id:c.id,state:'pending',taskId:null});
 expect(await restoredEngine.scheduler.start()).toMatchObject({ok:false,error:{code:'RESTORED_PROJECT_PAUSED'}});
 expect(query('task.list',{}).tasks).toHaveLength(0);
 }finally{await engine?.close();await restoredEngine?.close();await rm(root,{recursive:true,force:true});}
},30000);
