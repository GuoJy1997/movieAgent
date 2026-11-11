import type { AdapterType, ParameterValue } from '../../contracts/src/models.ts';
import { fail, isRecord, ok, type Result } from '../../contracts/src/result.ts';
import { inspectText } from '../../storage/src/text-media.ts';
export type TextProtocol = 'openai-chat-v1' | 'anthropic-messages-v1';
export const isTextProtocol = (adapter: unknown): adapter is TextProtocol => adapter === 'openai-chat-v1' || adapter === 'anthropic-messages-v1';
/** Host roots use /v1; custom prefixes and explicit versions remain intact. */
export function textBaseUrl(base: string): string { const url=new URL(base);if(url.pathname==='/'||url.pathname==='')url.pathname='/v1';return url.href.replace(/\/+$/,''); }
export function textAuthHeaders(protocol: TextProtocol, secret: string): Record<string,string> {
  return protocol==='anthropic-messages-v1'?{'x-api-key':secret,'anthropic-version':'2023-06-01'}:{authorization:`Bearer ${secret}`};
}
export function encodeTextRequest(protocol: AdapterType, model: string, prompt: string, parameters: Record<string,ParameterValue>): Result<Buffer> {
  if(!isTextProtocol(protocol))return fail('UNSUPPORTED_PROTOCOL','请选择受支持的文本协议。');
  const keys=Object.keys(parameters),key=keys[0],value=key?parameters[key]:undefined;
  if(keys.length!==1 || !['max_tokens',...(protocol==='openai-chat-v1'?['max_completion_tokens']:[])].includes(key!) || !Number.isSafeInteger(value) || (value as number)<1 || (value as number)>8192)return fail('UNSUPPORTED_PARAMETERS','请选择一种 1–8192 的文本输出长度参数。');
  return ok(Buffer.from(JSON.stringify({model,messages:[{role:'user',content:prompt}],stream:false,...(protocol==='openai-chat-v1'?{n:1}:{}),[key!]:value})));
}
export function extractTextResponse(protocol: TextProtocol, response: Uint8Array): Result<Buffer> {
  const invalid=()=>fail('INVALID_TEXT_RESPONSE','未收到有效文本；请检查模型、协议和输出长度，推理可能已耗尽所选输出预算。');
  try {
    const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response));if(!isRecord(parsed))return invalid();let text:string;
    if(protocol==='openai-chat-v1'){
      if(!Array.isArray(parsed.choices)||parsed.choices.length!==1)return invalid();const choice=parsed.choices[0];
      if(!isRecord(choice)||!['stop','length'].includes(choice.finish_reason as string)||!isRecord(choice.message)||typeof choice.message.content!=='string'||choice.message.tool_calls!==undefined||choice.message.function_call!==undefined)return invalid();text=choice.message.content;
    } else {
      if(parsed.type!=='message'||parsed.role!=='assistant'||!['end_turn','max_tokens','stop_sequence'].includes(parsed.stop_reason as string)||!Array.isArray(parsed.content)||parsed.content.length>128)return invalid();
      const finalText:string[]=[];
      for(const block of parsed.content){
        if(!isRecord(block))return invalid();
        if(block.type==='text'&&typeof block.text==='string')finalText.push(block.text);
        else if(block.type==='thinking'&&typeof block.thinking==='string'&&typeof block.signature==='string'&&block.signature.length>0)continue;
        else if(block.type==='redacted_thinking'&&typeof block.data==='string'&&block.data.length>0)continue;
        else return invalid();
      }
      text=finalText.join('');
    }
    const bytes=Buffer.from(text,'utf8');return bytes.toString('utf8')===text&&text.trim()&&inspectText(bytes).ok?ok(bytes):invalid();
  }catch{return invalid();}
}
