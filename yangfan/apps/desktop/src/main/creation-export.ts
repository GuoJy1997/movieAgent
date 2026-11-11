import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { isExportCreationInput, type ExportCreationResult } from '../../../../packages/contracts/src/creation-export.ts';
import { isCreationSnapshot, isCreationHistory, type CreationHistory, type CreationSnapshot, type EntityRevision } from '../../../../packages/contracts/src/creation.ts';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { canonicalPath, serializeDirectoryOperation } from './project-directories.ts';

type Binding = {root:string;libraryId:string;projectId:string};
/** The renderer supplies only identity/version/format; all contents come from engine queries. */
export async function exportCreation(binding:Binding|null,input:unknown,read:()=>Promise<Result<CreationSnapshot>>,history:(id:string)=>Promise<Result<CreationHistory>>):Promise<Result<ExportCreationResult>> {
  if(!isExportCreationInput(input))return fail('INVALID_INPUT','导出参数无效。');
  if(!binding)return fail('NO_DIRECTORY_PROJECT','旧版资料库没有短剧目录，请从项目启动器打开目录项目后导出。');
  if(binding.projectId!==input.projectId)return fail('WRONG_PROJECT','导出只能使用当前目录绑定的项目。');
  return serializeDirectoryOperation(binding.root,async()=>{
    try {
      const result=await read();if(!result.ok)return result;
      const snapshot=result.value;
      if(!isCreationSnapshot(snapshot)||snapshot.libraryId!==binding.libraryId||snapshot.projectId!==binding.projectId)return fail('EXPORT_SNAPSHOT_INVALID','导出快照的归属或结构无效。');
      const script=snapshot.scripts.find(s=>s.id===input.scriptId);
      if(!script||script.revision!==input.revision)return fail('REVISION_CONFLICT','剧本版本已变化，请重新读取后导出。');
      const shots=snapshot.shots.filter(s=>s.scriptId===script.id).sort((a,b)=>a.order-b.order);
      if(shots.length>64||shots.some(s=>!script.scenes.some(scene=>scene.id===s.sceneId)))return fail('EXPORT_SNAPSHOT_INVALID','镜头或场景关系无效。');
      const entities:EntityRevision[]=[],seen=new Set<string>();
      for(const shot of shots)for(const ref of shot.entityRefs){
        const key=`${ref.entityId}/${ref.revision}`;if(seen.has(key))continue;seen.add(key);
        let entity=snapshot.entities.find(e=>e.id===ref.entityId&&e.revision===ref.revision);
        if(!entity){const old=await history(ref.entityId);if(!old.ok)return old;if(!isCreationHistory(old.value)||old.value.kind!=='entity'||old.value.libraryId!==binding.libraryId||old.value.projectId!==binding.projectId||old.value.id!==ref.entityId)return fail('EXPORT_SNAPSHOT_INVALID','固定实体历史不可用。');entity=old.value.revisions.find(e=>e.revision===ref.revision);}
        if(!entity)return fail('REVISION_NOT_FOUND','镜头引用的固定实体修订不存在。');entities.push(entity);
      }
      const snapshotId=randomUUID(),filename=`${script.id}-r${script.revision}-${snapshotId}.${input.format==='json'?'json':'md'}`;
      const selections=snapshot.selections.filter(s=>shots.some(shot=>shot.id===s.shotId));
      const data={schemaVersion:1,snapshotId,snapshotSeq:snapshot.snapshotSeq,libraryId:binding.libraryId,projectId:binding.projectId,exportedAt:new Date().toISOString(),notice:'当前剧本与镜头快照；实体为镜头固定引用的精确修订。历史镜头的父剧本上下文请查阅对应生产批次。',script,shots,entities,selections};
      const source=input.format==='json'?JSON.stringify(data,null,2):[
        `# ${script.title}`,`快照 ${snapshotId} · 剧本 ${script.id} r${script.revision} · 事件序号 ${snapshot.snapshotSeq}`,data.notice,'## 梗概',script.synopsis,'## 正文',script.body,'## 场景',...script.scenes.map(s=>`### ${s.title}\n${s.id} · ${s.location} · ${s.time}\n\n${s.description}`),'## 镜头',...shots.map(s=>`### ${s.order+1}. ${s.title}\n${s.id} r${s.revision} · 场景 ${s.sceneId} · ${s.durationSeconds}秒 · ${s.aspectRatio}\n\n景别：${s.shotSize}\n运镜：${s.cameraMovement}\n主体：${s.subject}\n动作：${s.action}\n台词：${s.dialogue}\n声音：${s.sound}\n提示词：${s.prompt}\n固定实体：${s.entityRefs.map(r=>`${r.entityId} r${r.revision}`).join('、')}`),'## 固定实体',...entities.map(e=>`### ${e.name} · ${e.id} r${e.revision}\n${e.description}\n约束：${e.constraints}\n固定素材：${JSON.stringify(e.references)}`),'## 固定输出选择',JSON.stringify(selections,null,2)].join('\n\n');
      if(Buffer.byteLength(source)>4*1024*1024)return fail('EXPORT_TOO_LARGE','导出超过4 MiB上限，请拆分剧本。');
      const check=async(path:string)=>{const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||canonicalPath(await realpath(path))!==canonicalPath(path))throw Error('EXPORT_PATH_UNSAFE');};
      await check(binding.root);
      let dir=binding.root;
      for(const part of ['exports','creation']){dir=join(dir,part);await mkdir(dir).catch(error=>{if(error.code!=='EEXIST')throw error;});await check(dir);}
      // Revalidate every component immediately before exclusive creation. Never overwrite or follow a target link.
      await check(binding.root);await check(join(binding.root,'exports'));await check(dir);
      const handle=await open(join(dir,filename),'wx',0o600);
      try{await handle.writeFile(source,'utf8');await handle.sync();}finally{await handle.close();}
      return ok({filename,relativePath:`exports/creation/${filename}`,snapshotId,scriptRevision:script.revision});
    }catch{return fail('EXPORT_FAILED','无法安全写入 exports/creation。请检查目录可用性、链接和权限后重试。');}
  });
}
