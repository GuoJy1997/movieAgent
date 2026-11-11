import {lstatSync,mkdirSync,readFileSync,realpathSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import type {LibraryHandle} from '../../storage/src/database.ts';
import {fail,ok,type Result} from '../../contracts/src/result.ts';
/** Only bound directory projects get readable work folders; database remains authoritative. */
export function ensureSubprojectDirectory(library:LibraryHandle,projectId:string,subprojectId:string):Result<void>{
 if(basename(library.root)!=='library'||basename(dirname(library.root))!=='.movieagent')return ok(undefined);
 const root=dirname(dirname(library.root));
 try{
  const manifest=JSON.parse(readFileSync(join(root,'movieagent.project.json'),'utf8'));
  if(manifest.binding?.libraryId!==library.libraryId||manifest.binding?.projectId!==projectId)return ok(undefined);
  if(realpathSync(root)!==resolve(root)||lstatSync(root).isSymbolicLink())return fail('PROJECT_PATH_UNSAFE','项目目录不可重定向。');
  for(const relative of ['shared','shared/assets','shared/documents','shared/memory','subprojects','subprojects/'+subprojectId,...['scripts','storyboards','notes','exports'].map(n=>'subprojects/'+subprojectId+'/'+n)]){
   const target=join(root,...relative.split('/'));
   try{mkdirSync(target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
   const st=lstatSync(target);
   if(st.isSymbolicLink()||!st.isDirectory()||realpathSync(target)!==resolve(target))return fail('PROJECT_PATH_UNSAFE','子项目目录包含链接或非目录文件。');
  }
  return ok(undefined);
 }catch{return fail('SUBPROJECT_DIRECTORY_FAILED','子项目工作目录未能建立，请检查目录权限。');}
}
