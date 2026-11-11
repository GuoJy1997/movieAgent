import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Transform} from 'node:stream';
import {join} from 'node:path';
import {createMcpServer} from './server.ts';
import {PipeMcpClient,discoverInstances,readDescriptor,MAX_MCP_FRAME} from './transport.ts';
import {ok,fail} from '../../../../../packages/contracts/src/result.ts';
const directory=process.argv.find(x=>x.startsWith('--discovery='))?.slice('--discovery='.length);
const clients=new Map<string,PipeMcpClient>();
async function main(){
 if(!directory)throw Error('Use --discovery=<MovieAgent instance directory>');
 const server=createMcpServer(async(name,args)=>{
  if(name==='system_instances')return ok(await discoverInstances(directory));
  const id=args.instanceId;if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))return fail('INVALID_INSTANCE','请选择system_instances返回的实例。');
  let client=clients.get(id);
  if(!client){try{client=new PipeMcpClient(await readDescriptor(join(directory,id+'.json')),server.getClientVersion()?.name??'MCP client');clients.set(id,client);}catch{return fail('APP_NOT_RUNNING','请打开目标项目，并在模型设置中启用MCP。');}}
  const result=await client.call(name,args);
  if(!result.ok&&['STALE_CONNECTION','MCP_DISCONNECTED','APP_NOT_RUNNING'].includes(result.error.code)){await client.close();clients.delete(id);}
  return result;
 });
 let count=0;
 const bounded=new Transform({transform(chunk:Buffer,_encoding,callback){
  for(const byte of chunk){if(byte===10)count=0;else if(++count>MAX_MCP_FRAME){callback(Error('MCP frame too large'));return;}}
  callback(null,chunk);
 }});
 bounded.on('error',()=>{process.stderr.write('MovieAgent MCP input exceeds the supported frame size.\n');process.exitCode=1;process.stdin.destroy();void server.close();});
 process.stdin.pipe(bounded);await server.connect(new StdioServerTransport(bounded,process.stdout));
 const close=async()=>{for(const c of clients.values())await c.close();await server.close();};
 process.stdin.on('end',()=>void close());process.on('SIGTERM',()=>void close().finally(()=>process.exit(0)));
}
void main().catch(()=>{process.stderr.write('MovieAgent MCP could not start; check its local configuration.\n');process.exitCode=1;});
