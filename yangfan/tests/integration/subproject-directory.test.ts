import {expect,it} from 'vitest';
import {mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDirectoryProject,bindDirectoryProject} from '../../apps/desktop/src/main/project-directories.ts';
import {openLibrary} from '../../packages/storage/src/database.ts';
import {projectsFor} from '../../packages/engine/src/projects.ts';
import {subprojectsFor} from '../../packages/engine/src/subproject-service.ts';
const take=(r:any):any=>{if(!r.ok)throw Error(r.error.code);return r.value;};
it('creates stable child folders in a bound project without moving old user files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'subproject-dir-'));
 const folder=take(await createDirectoryProject({mode:'new',directory:root,name:'Series'}));
 const lib=take(await openLibrary({root:folder.libraryRoot}));
 try{
  const p=take(projectsFor(lib).create({name:'Series'}));
  take(await bindDirectoryProject(folder.root,{workspaceId:folder.manifest.workspaceId,libraryId:lib.libraryId,projectId:p.id}));
  await writeFile(join(folder.root,'scripts/outline.md'),'old outline');
  const service=subprojectsFor(lib),a=take(service.create({projectId:p.id,title:'第一集'}));
  expect((await stat(join(folder.root,'subprojects',a.id,'scripts'))).isDirectory()).toBe(true);
  take(service.update({projectId:p.id,id:a.id,expectedRevision:a.revision,title:'更名'}));
  expect((await stat(join(folder.root,'subprojects',a.id,'exports'))).isDirectory()).toBe(true);
 }finally{await lib.close();await rm(root,{recursive:true,force:true});}
});
