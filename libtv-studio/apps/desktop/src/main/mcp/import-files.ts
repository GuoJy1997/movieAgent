import {lstat,realpath,open,mkdir,rename,unlink} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,extname,basename,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {McpImageSource,McpImportSourceDirectory} from '../../../../../packages/contracts/src/mcp.ts';
import {fail,ok,type Result} from '../../../../../packages/contracts/src/result.ts';
export interface ReceivedImage {path:string;hash:string;mime:string;width:number;height:number;byteLength:number}
const MAX_FILE=32*1024*1024,MAX_BYTES=8*1024*1024;
const inside=(root:string,file:string)=>{const rel=relative(root,file);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
const equal=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
async function regularFile(path:string,root:string){
 const canonicalRoot=await realpath(root);if(!equal(resolve(root),canonicalRoot))throw Error('SOURCE_LINK');
 const r=await realpath(path),s=await lstat(path);
 if(!inside(canonicalRoot,r)||!equal(resolve(path),r)||!s.isFile()||s.isSymbolicLink())throw Error('SOURCE_LINK');
 const file=await open(path,'r');
 try{
  const before=await file.stat();if(before.size>MAX_FILE||before.size<1||before.ino!==s.ino||before.dev!==s.dev)throw Error('SOURCE_TOO_LARGE');
  // Bound the read independently of stat: a growing source must not allocate unbounded memory.
  const chunks:Buffer[]=[];let total=0;
  for(;;){const b=Buffer.alloc(64*1024),{bytesRead}=await file.read(b,0,Math.min(b.length,MAX_FILE+1-total));if(!bytesRead)break;total+=bytesRead;if(total>MAX_FILE)throw Error('SOURCE_TOO_LARGE');chunks.push(b.subarray(0,bytesRead));}
  const after=await file.stat(),again=await lstat(path);
  if(before.size!==total||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||again.ino!==before.ino||again.dev!==before.dev||!equal(await realpath(path),r))throw Error('SOURCE_CHANGED');
  return Buffer.concat(chunks,total);
 }finally{await file.close();}
}
export async function receiveImage(source:McpImageSource,sources:McpImportSourceDirectory[],stagingRoot:string,operationId:string):Promise<Result<ReceivedImage>>{
 let temp:string|undefined;
 try{
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId))return fail('INVALID_INPUT','导入身份无效。');
  let bytes:Buffer;
  if(source.kind==='localFile'){
   const root=sources.find(s=>s.id===source.importSourceId)?.path;
   if(!root||!source.path||isAbsolute(source.path)||/[<>:"|?*\x00-\x1f]/.test(source.path)||source.path.startsWith('\\')||!['.png','.jpg','.jpeg','.webp'].includes(extname(source.path).toLowerCase()))return fail('IMPORT_SOURCE_DENIED','请选择允许目录中的图片。');
   const file=resolve(root,source.path);if(!inside(resolve(root),file))return fail('IMPORT_SOURCE_DENIED','图片路径超出允许目录。');
   bytes=await regularFile(file,root);
  }else{
   if(source.base64.length>Math.ceil(MAX_BYTES/3)*4||source.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(source.base64)||basename(source.fileName)!==source.fileName||/[\\/:]/.test(source.fileName))return fail('INVALID_IMAGE_PAYLOAD','图片字节编码无效或超过8 MiB。');
   bytes=Buffer.from(source.base64,'base64');if(!bytes.length||bytes.length>MAX_BYTES||bytes.toString('base64')!==source.base64)return fail('INVALID_IMAGE_PAYLOAD','图片字节编码无效或超过8 MiB。');
  }
  const image=sharp(bytes,{limitInputPixels:40000000,failOn:'warning',sequentialRead:true}),meta=await image.metadata();
  if(!['png','jpeg','webp'].includes(meta.format??'')||!meta.width||!meta.height||(meta.pages??1)>1||meta.width*meta.height>40000000)return fail('INVALID_IMAGE','仅接受静态PNG、JPEG和WebP图片。');
  await image.clone().timeout({seconds:15}).raw().toBuffer();
  await mkdir(stagingRoot,{recursive:true});if(!equal(await realpath(stagingRoot),resolve(stagingRoot)))return fail('IMPORT_SOURCE_DENIED','暂存目录包含链接。');
  const hash=createHash('sha256').update(bytes).digest('hex'),path=join(stagingRoot,operationId+'.'+(meta.format==='jpeg'?'jpg':meta.format));
  temp=join(stagingRoot,'.'+randomUUID()+'.part');
  const file=await open(temp,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await rename(temp,path);temp=undefined;
  return ok({path,hash,mime:'image/'+meta.format,width:meta.width,height:meta.height,byteLength:bytes.length});
 }catch{return fail('IMAGE_RECEIVE_FAILED','无法接收图片：检查文件、格式、大小、路径链接或源文件变化。');}
 finally{if(temp)await unlink(temp).catch(()=>{});}
}
