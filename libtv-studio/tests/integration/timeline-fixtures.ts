import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap.ts';
export const roots: string[] = [], engines: EngineHandle[] = [];
let serial=0;
export const command=(e:EngineHandle,kind:string,payload:unknown,commandId='timeline-'+(++serial))=>({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'fixture',commandId,kind,payload});
export const unwrap=<T>(r:import('../../packages/contracts/src/result.ts').Result<T>):T=>{if(!r.ok)throw Error(r.error.code);return r.value;};
export const cleanup=async()=>{for(const e of engines.splice(0))await e.close();for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});};
export async function setup(){const root=await mkdtemp(join(tmpdir(),'timeline-'));roots.push(root);const e=unwrap(await startEngine({root}));engines.push(e);const projectId=(unwrap(await e.commands.execute(command(e,'project.create',{name:'Story'}))).result as {id:string}).id;unwrap(await e.commands.execute(command(e,'creation.saveScript',{projectId,id:'script',expectedRevision:0,title:'Story',synopsis:'',body:'',scenes:[{id:'scene',title:'Scene',location:'',time:'',description:''}]})));return {e,root,projectId};}
export const settings={fps:{num:30 as const,den:1 as const},canvas:{width:1920 as const,height:1080 as const}};
export const create=(projectId:string,id='cut')=>({projectId,id,scriptRef:{id:'script',revision:1},title:'Cut',settings});
export async function image(e:EngineHandle,root:string){const path=join(root,'fixture.png');await writeFile(path,await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toBuffer());const s=await stat(path),n='image-'+(++serial);unwrap(e.assets.registerGrant({grantId:n,importId:n,libraryId:e.identity.libraryId,expiresAt:Date.now()+60000,files:[{path,realPath:path,allowedRoot:root,name:'fixture.png',size:s.size,mtimeMs:s.mtimeMs,dev:s.dev,ino:s.ino}]}));return (unwrap(await e.commands.execute(command(e,'asset.importGrantedFiles',{grantId:n}))).result as {versions:import('../../packages/contracts/src/assets.ts').AssetVersionRef[]}).versions[0]!;}
export const shot=(projectId:string,id='shot',extra={})=>({projectId,id,expectedRevision:0,scriptId:'script',sceneId:'scene',order:0,title:'Shot',durationSeconds:5,shotSize:'wide',cameraMovement:'',subject:'',action:'',dialogue:'',sound:'',aspectRatio:'16:9' as const,prompt:'',entityRefs:[],...extra});
