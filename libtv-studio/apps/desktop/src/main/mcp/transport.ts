import {createServer,createConnection,type Socket} from 'node:net';
import {mkdir,writeFile,readFile,readdir,unlink,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {fail,ok,isRecord,type Result} from '../../../../../packages/contracts/src/result.ts';
import type {McpClientView} from '../../../../../packages/contracts/src/mcp.ts';
export const MAX_MCP_FRAME=12*1024*1024;
export interface McpInstanceDescriptor {version:1;instanceId:string;libraryId:string;name:string;workspacePath:string;pipe:string;token:string;pid:number;createdAt:string}
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
function frames(socket:Socket,receive:(value:unknown)=>void){
 let buffer='';socket.setEncoding('utf8');
 socket.on('data',(data:string)=>{buffer+=data;if(Buffer.byteLength(buffer)>MAX_MCP_FRAME){socket.destroy();return;}
  for(;;){const end=buffer.indexOf('\n');if(end<0)break;const text=buffer.slice(0,end);buffer=buffer.slice(end+1);try{receive(JSON.parse(text));}catch{socket.destroy();return;}}
 });
}
function send(socket:Socket,value:unknown){const text=JSON.stringify(value)+'\n';if(Buffer.byteLength(text)>MAX_MCP_FRAME){socket.destroy();return;}if(!socket.destroyed)socket.write(text);}
export async function listenMcpBridge(options:{directory:string;instanceId:string;libraryId:string;name:string;workspacePath:string;getEpoch():string;handle(name:string,args:Record<string,unknown>,client:McpClientView):Promise<Result<unknown>>}){
 await mkdir(options.directory,{recursive:true});
 if(!validId(options.instanceId))throw Error('INVALID_INSTANCE');
 const token=randomBytes(32).toString('hex'),nonce=randomUUID();
 const pipe=process.platform==='win32'?'\\\\.\\pipe\\movieagent-mcp-'+nonce:join(options.directory,'ipc-'+nonce+'.sock');
 const descriptor:McpInstanceDescriptor={version:1,instanceId:options.instanceId,libraryId:options.libraryId,name:options.name,workspacePath:options.workspacePath,pipe,token,pid:process.pid,createdAt:new Date().toISOString()};
 const clients=new Map<string,{socket:Socket;view:McpClientView}>(),sockets=new Set<Socket>();let closed=false;
 const server=createServer(socket=>{
  if(closed||sockets.size>=8){socket.destroy();return;}sockets.add(socket);
  let client:McpClientView|undefined,epoch='',active=0;
  const helloTimeout=setTimeout(()=>socket.destroy(),5000);socket.setTimeout(600000,()=>socket.destroy());
  socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(helloTimeout);sockets.delete(socket);if(client)clients.delete(client.id);});
  frames(socket,value=>{
   if(!isRecord(value)||!validId(value.id)||typeof value.name!=='string'||!isRecord(value.args)){socket.destroy();return;}
   const id=value.id;
   if(!client){
    const candidate=value.args.token;
    if(value.name!=='hello'||typeof candidate!=='string'||!/^[a-f0-9]{64}$/.test(candidate)||!timingSafeEqual(Buffer.from(candidate),Buffer.from(token))){
     send(socket,{id,result:fail('FORBIDDEN','MCP连接未获授权。')});socket.end();return;
    }
    try{epoch=options.getEpoch();}catch{send(socket,{id,result:fail('ENGINE_DISCONNECTED','当前工作区引擎不可用。')});socket.end();return;}
    const name=typeof value.args.clientName==='string'?value.args.clientName.replace(/[\x00-\x1f]/g,'').slice(0,80):'MCP client';
    client={id:randomUUID(),name,connectedAt:new Date().toISOString()};clients.set(client.id,{socket,view:client});clearTimeout(helloTimeout);
    send(socket,{id,result:ok({clientId:client.id,connectionEpoch:epoch,libraryId:descriptor.libraryId})});return;
   }
   try{if(epoch!==options.getEpoch()){send(socket,{id,result:fail('STALE_CONNECTION','引擎连接已更换，请重新连接并核对原请求。')});return;}}catch{send(socket,{id,result:fail('ENGINE_DISCONNECTED','引擎暂不可用。')});return;}
   if(active>=4){send(socket,{id,result:fail('MCP_BUSY','当前连接请求过多。')});return;}
   active++;void options.handle(value.name,value.args,client).then(result=>send(socket,{id,result}),()=>send(socket,{id,result:fail('MCP_OPERATION_FAILED','操作未确认，请核对原请求。')})).finally(()=>active--);
  });
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(pipe,()=>{server.off('error',reject);resolve();});});
 const file=join(options.directory,options.instanceId+'.json');
 try{await writeFile(file,JSON.stringify(descriptor),{mode:0o600,flag:'wx'});}catch(error){await new Promise<void>(r=>server.close(()=>r()));throw error;}
 return {descriptor,clients:()=>[...clients.values()].map(c=>c.view),revoke:(id:string)=>clients.get(id)?.socket.destroy(),
  async close(){if(closed)return;closed=true;for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));await unlink(file).catch(()=>{});}
 };
}
export async function readDescriptor(path:string):Promise<McpInstanceDescriptor>{
 const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.size>65536)throw Error('INVALID_DESCRIPTOR');
 const canonical=await realpath(path);if((process.platform==='win32'?canonical.toLowerCase():canonical)!==(process.platform==='win32'?resolve(path).toLowerCase():resolve(path)))throw Error('INVALID_DESCRIPTOR');
 const d:unknown=JSON.parse(await readFile(path,'utf8'));
 if(!isRecord(d)||d.version!==1||!validId(d.instanceId)||!validId(d.libraryId)||typeof d.pipe!=='string'||typeof d.token!=='string'||!/^[a-f0-9]{64}$/.test(d.token)||!Number.isSafeInteger(d.pid)||typeof d.name!=='string'||typeof d.workspacePath!=='string'||typeof d.createdAt!=='string')throw Error('INVALID_DESCRIPTOR');
 if(process.platform==='win32'&&!/^\\\\\.\\pipe\\movieagent-mcp-[a-f0-9-]+$/.test(d.pipe))throw Error('INVALID_DESCRIPTOR');
 if(process.platform!=='win32'&&!d.pipe.endsWith('.sock'))throw Error('INVALID_DESCRIPTOR');
 process.kill(d.pid as number,0);return d as unknown as McpInstanceDescriptor;
}
export async function discoverInstances(directory:string){
 const result:Omit<McpInstanceDescriptor,'token'|'pipe'|'pid'>[]=[];
 for(const name of (await readdir(directory).catch(()=>[])).filter(v=>/^[a-zA-Z0-9_-]+\.json$/.test(v)).slice(0,64)){
  try{const {token:_,pipe:__,pid:___,...view}=await readDescriptor(join(directory,name));result.push(view);}catch{/* Stale or invalid instance is not a usable capability. */}
 }return result;
}
export class PipeMcpClient {
 private socket:Socket|undefined;private connecting:Promise<Result<void>>|undefined;private closed=false;
 private pending=new Map<string,{resolve(value:Result<unknown>):void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private descriptor:McpInstanceDescriptor,private clientName='MCP client'){}
 private async connect():Promise<Result<void>>{
  if(this.closed)return fail('MCP_DISCONNECTED','连接已关闭，请重新发现实例。');
  if(this.connecting)return this.connecting;
  this.connecting=(async()=>{
   const socket=createConnection(this.descriptor.pipe);this.socket=socket;
   socket.on('error',()=>this.failPending());socket.on('close',()=>{this.closed=true;this.failPending();});
   frames(socket,value=>{if(!isRecord(value)||!validId(value.id)||!isRecord(value.result)||typeof value.result.ok!=='boolean'){socket.destroy();return;}const entry=this.pending.get(value.id);if(entry){clearTimeout(entry.timer);this.pending.delete(value.id);entry.resolve(value.result as Result<unknown>);}});
   const connected=await new Promise<boolean>(resolve=>{const timer=setTimeout(()=>{socket.destroy();resolve(false);},5000);socket.once('connect',()=>{clearTimeout(timer);resolve(true);});socket.once('error',()=>{clearTimeout(timer);resolve(false);});});
   if(!connected)return fail('APP_NOT_RUNNING','MovieAgent工作区尚未运行或未启用MCP。');
   const hello=await this.request('hello',{token:this.descriptor.token,clientName:this.clientName},5000);
   return hello.ok?ok(undefined):hello;
  })();return this.connecting;
 }
 private failPending(){for(const p of this.pending.values()){clearTimeout(p.timer);p.resolve(fail('MCP_DISCONNECTED','连接中断，操作结果待核对，请保留原请求ID。'));}this.pending.clear();}
 private request(name:string,args:Record<string,unknown>,timeoutMs:number):Promise<Result<unknown>>{
  const id=randomUUID(),text=JSON.stringify({id,name,args})+'\n';
  if(Buffer.byteLength(text)>MAX_MCP_FRAME)return Promise.resolve(fail('MCP_MESSAGE_TOO_LARGE','MCP消息超过12 MiB，请改用允许目录中的文件。'));
  if(!this.socket||this.socket.destroyed)return Promise.resolve(fail('MCP_DISCONNECTED','连接已中断。'));
  return new Promise(resolve=>{const timer=setTimeout(()=>{this.pending.delete(id);resolve(fail('MCP_TIMEOUT','调用等待超时；操作可能继续，请核对原请求或任务。'));},timeoutMs);this.pending.set(id,{resolve,timer});this.socket!.write(text);});
 }
 async call(name:string,args:Record<string,unknown>):Promise<Result<unknown>>{
  if(Buffer.byteLength(JSON.stringify(args))>MAX_MCP_FRAME-512)return fail('MCP_MESSAGE_TOO_LARGE','MCP消息超过12 MiB，请改用本机文件。');
  const connected=await this.connect();if(!connected.ok)return connected;
  return this.request(name,args,65000);
 }
 async close(){this.closed=true;this.socket?.destroy();this.failPending();}
}
