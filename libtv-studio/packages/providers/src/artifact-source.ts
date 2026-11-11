import { inspectText, MAX_TEXT_BYTES } from '../../storage/src/text-media.ts';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, rename, realpath, statfs, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { FileSourceRef } from '../../storage/src/collection-journal.ts';
import type { ImageOutput } from './image-provider.ts';
import { createHttpTransport, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES } from './http-transport.ts';
const hash = (bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(path:string)=>process.platform==='win32'?path.toLowerCase():path;
/** Only trusted adapter code can create or resolve these opaque staging identities. */
export class ArtifactSource {
 private readonly directory:string;
 private readonly maximum:number;
 private readonly mediaKind: 'image' | 'video' | 'text' | 'audio';
 private readonly downloads:ReturnType<typeof createHttpTransport>;
 private readonly pending=new Map<string,Promise<Result<FileSourceRef>>>();
 constructor(root: string, downloads = createHttpTransport(), mediaKind: 'image' | 'video' | 'text' | 'audio' = 'image') {
  this.mediaKind = mediaKind;
  this.maximum = mediaKind === 'audio' ? MAX_AUDIO_BYTES : mediaKind === 'text' ? MAX_TEXT_BYTES : mediaKind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  this.directory = resolve(root, mediaKind === 'audio' ? 'provider-spool-audio' : mediaKind === 'text' ? 'provider-spool-text' : mediaKind === 'video' ? 'provider-spool-video' : 'provider-spool');
  this.downloads = downloads;
 }
 private path(id:string){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('INVALID_STAGING_ID');return join(this.directory,id+(this.mediaKind==='audio'?'.audio':this.mediaKind==='text'?'.txt':this.mediaKind==='video'?'.mp4':'.image'));}
 private async ownedDirectory(){if(canonical(await realpath(this.directory))!==canonical(this.directory))throw Error('INVALID_STAGING_PATH');}
 private async read(path:string,maximum:number){
  await this.ownedDirectory();const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>maximum)throw Error('INVALID_STAGING_FILE');
  const handle=await open(path,'r');
  try{
   const opened=await handle.stat();if(!opened.isFile()||opened.size>maximum)throw Error('OUTPUT_LIMIT');
   const bytes=Buffer.alloc(opened.size+1);let length=0;
   while(length<bytes.length){const read=await handle.read(bytes,length,bytes.length-length,null);if(read.bytesRead===0)break;length+=read.bytesRead;}
   if(length!==opened.size)throw Error('STAGING_CHANGED');return {bytes:bytes.subarray(0,length),info:opened};
  }finally{await handle.close();}
 }
 async recover(id:string):Promise<Result<FileSourceRef>>{
  try{
   const path=this.path(id),saved=(await this.read(path+'.sha256',64)).bytes.toString('ascii');if(!/^[a-f0-9]{64}$/.test(saved))throw Error();
   let data;
   try{data=await this.read(path,this.maximum);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    const partial=await this.read(path+'.partial',this.maximum);if(!partial.bytes.length||hash(partial.bytes)!==saved)throw Error();
    await rename(path+'.partial',path);data=await this.read(path,this.maximum);
   }
   if(this.mediaKind==='text'&&!inspectText(data.bytes).ok)throw Error();
   if(!data.bytes.length||saved!==hash(data.bytes))throw Error();
   const audioExtension = data.bytes.subarray(0, 4).toString('ascii') === 'RIFF' ? '.wav' : data.bytes.subarray(4, 8).toString('ascii') === 'ftyp' ? '.m4a' : '.mp3';
   return ok({path,realPath:await realpath(path),allowedRoot:this.directory,name:id+(this.mediaKind==='audio'?audioExtension:this.mediaKind==='text'?'.txt':this.mediaKind==='video'?'.mp4':'.png'),size:data.info.size,mtimeMs:data.info.mtimeMs,dev:data.info.dev,ino:data.info.ino});
  }catch{return fail('OUTPUT_STAGING_UNAVAILABLE','持久输出暂不可用，请检查磁盘。');}
 }
 private async writeOnce(path:string,bytes:Uint8Array){const handle=await open(path,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
 /** Repair only unpublished candidates. A final file or valid manifest remains an immutable binding. */
 private async prepareWrite(path: string, bytes: Uint8Array): Promise<boolean> {
  await this.ownedDirectory();
  try {
   await lstat(path);
   throw Error('STAGING_CONFLICT');
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const partialPath = path + '.partial', manifestPath = path + '.sha256';
  let partial: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
   partial = await lstat(partialPath);
   if (!partial.isFile() || partial.isSymbolicLink() || partial.size > this.maximum) throw Error('INVALID_STAGING_FILE');
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let manifest: Awaited<ReturnType<ArtifactSource['read']>> | undefined;
  try { manifest = await this.read(manifestPath, 64); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const saved = manifest?.bytes.toString('ascii');
  const bound = saved !== undefined && /^[a-f0-9]{64}$/.test(saved);
  if (bound && saved !== hash(bytes)) throw Error('STAGING_CONFLICT');

  // Validate every candidate before removing either. Never follow or remove a redirected path.
  for (const [candidate, info] of [[partialPath, partial], [manifestPath, !bound ? manifest?.info : undefined]] as const) {
   if (!info) continue;
   await this.ownedDirectory();
   const current = await lstat(candidate);
   if (!current.isFile() || current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino) throw Error('STAGING_CHANGED');
   await unlink(candidate);
  }
  // Keep a valid manifest in place even during repair, so another crash cannot erase its binding.
  return bound;
 }
 private async persist(id: string, bytes: Uint8Array): Promise<Result<FileSourceRef>> {
  if (this.mediaKind === 'text') { const valid = inspectText(bytes); if (!valid.ok) return valid; }
  if (!bytes.length || bytes.length > this.maximum) return fail('OUTPUT_LIMIT', '输出超过原件大小限制。');
  const existing = await this.recover(id);
  if (existing.ok) {
   const saved = await this.read(existing.value.path, this.maximum);
   const sameContent = hash(saved.bytes) === hash(bytes);
   return sameContent ? existing : fail('OUTPUT_STAGING_CONFLICT', '输出身份已绑定其他内容。');
  }
  try {
   const path = this.path(id);
   await mkdir(this.directory, { recursive: true });
   await this.ownedDirectory();
   const space = await statfs(this.directory);
   if (Number(space.bavail) * Number(space.bsize) < bytes.length + 65536) throw Error();
   const manifestRetained = await this.prepareWrite(path, bytes);
   // wx still prevents competing writers; only incomplete unpublished candidates were removed.
   await this.writeOnce(path + '.partial', bytes);
   if (!manifestRetained) await this.writeOnce(path + '.sha256', Buffer.from(hash(bytes)));
   // The manifest and bytes are synced before final publication; recover can finish this rename.
   try {
    await lstat(path);
    throw Error('STAGING_CONFLICT');
   } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
   }
   await rename(path + '.partial', path);
   const final = await open(path, 'r+');
   try { await final.sync(); }
   finally { await final.close(); }
   return this.recover(id);
  } catch {
   return fail('OUTPUT_STAGING_FAILED', '输出未能持久保存，请检查磁盘。');
  }
 }
 async stage(id:string,bytes:Uint8Array):Promise<Result<FileSourceRef>>{
  const previous = this.pending.get(id) ?? Promise.resolve();
  const work = previous.then(() => this.persist(id, bytes))
   .catch(() => fail('OUTPUT_STAGING_FAILED', '输出未能持久保存，请检查磁盘。'))
   .finally(() => { if (this.pending.get(id) === work) this.pending.delete(id); });
  this.pending.set(id, work);
  return work;
 }
 async materialize(output:ImageOutput,id:string,signal?:AbortSignal):Promise<Result<FileSourceRef>>{
  const existing=await this.recover(id);if(existing.ok)return existing;
  if(this.mediaKind==='text'||output.kind!=='url')return fail('OUTPUT_UNRECOVERABLE','供应商输出已无法恢复。');
  try{return await this.stage(id,await this.downloads.download(output.url,signal,this.maximum));}catch{return fail('OUTPUT_DOWNLOAD_FAILED','输出下载失败；仅可重试收存，不会重新生成。');}
 }
}
