import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {ListToolsRequestSchema,CallToolRequestSchema,type Tool,type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {toolDefinitions,validateTool} from './tools.ts';
import {fail,isRecord,type Result} from '../../../../../packages/contracts/src/result.ts';
export function createMcpServer(call:(name:string,args:Record<string,unknown>)=>Promise<Result<unknown>>){
 const server=new Server({name:'movieagent',version:'0.3.0'},{capabilities:{tools:{}},instructions:'Use system_instances, then system_doctor. Always select explicit instance and project/subproject scope. Use stable requestId for every write. External images may be imported without an image model; inspect imports_get for partial success. Freeze existing images using production_prepare reusedImages. Paid generation needs desktop confirmation; never submit duplicates after a timeout. M1 only: timeline/export tools are not yet available.'});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:Object.entries(toolDefinitions).map(([name,tool])=>({name,description:tool.description,inputSchema:z.toJSONSchema(tool.schema) as Tool['inputSchema'],annotations:{readOnlyHint:tool.readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:tool.openWorld}}))}));
 server.setRequestHandler(CallToolRequestSchema,async(request):Promise<CallToolResult>=>{
  const args=validateTool(request.params.name,request.params.arguments??{});
  let result:Result<unknown>;
  if(!args)result=fail('INVALID_INPUT','Unknown tool or invalid arguments; read its schema.');
  else try{result=await call(request.params.name,args);}catch{result=fail('MCP_OPERATION_FAILED','操作未确认，请使用原请求ID查询或重试。');}
  if(result.ok&&isRecord(result.value)&&isRecord(result.value.image)&&typeof result.value.image.data==='string'&&typeof result.value.image.mimeType==='string'){
   const {image,...metadata}=result.value;
   return {isError:false,structuredContent:{ok:true,value:metadata},content:[{type:'text',text:JSON.stringify(metadata)},{type:'image',data:image.data as string,mimeType:image.mimeType as string}]};
  }
  return {isError:!result.ok,structuredContent:result.ok?{ok:true,value:result.value??null}:{ok:false,error:result.error},content:[{type:'text',text:JSON.stringify(result)}]};
 });
 return server;
}
