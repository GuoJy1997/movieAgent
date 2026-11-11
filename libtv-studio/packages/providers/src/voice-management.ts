import {fail,isRecord,ok,type Result} from '../../contracts/src/result.ts';
export interface ProviderVoice {id:string;name:string;origin:'system'|'custom'|'cloned';description:string}
export type VoiceManagementOperation = {kind:'catalog'} | {kind:'upload';mime:string;filename:string} | {kind:'clone';fileId:string;voiceId:string;modelId:string};
export function validateCloneSample(source:{mime:string;durationTicks:number;byteLength:number}):Result<void>{
  return ['audio/wav','audio/mpeg','audio/mp4'].includes(source.mime)&&Number.isSafeInteger(source.durationTicks)&&source.durationTicks>=10*48000&&source.durationTicks<=300*48000&&Number.isSafeInteger(source.byteLength)&&source.byteLength>0&&source.byteLength<=20000000?ok(undefined):fail('INVALID_CLONE_SAMPLE','克隆样本需要10–300秒、MP3/M4A/WAV且不超过20 MB。');
}
function response(bytes:Uint8Array):Result<Record<string,unknown>>{
  if(bytes.byteLength>2*1024*1024)return fail('INVALID_VOICE_RESPONSE','声音服务响应过大。');
  try{
    const parsed:unknown=JSON.parse(Buffer.from(bytes).toString('utf8'),(key:string,value:unknown,context?:{source?:string})=>key==='file_id'&&typeof value==='number'?context?.source??String(value):value);
    if(!isRecord(parsed)||!isRecord(parsed.base_resp)||!Number.isSafeInteger(parsed.base_resp.status_code)||Number(parsed.base_resp.status_code)<0)return fail('INVALID_VOICE_RESPONSE','声音服务响应未提供明确结果。');
    return parsed.base_resp.status_code===0?ok(parsed):fail('VOICE_PROVIDER_REJECTED','声音服务明确拒绝了操作。');
  }catch{return fail('INVALID_VOICE_RESPONSE','声音服务响应无效。');}
}
export function decodeVoiceUpload(bytes:Uint8Array):Result<string>{
  const result=response(bytes);if(!result.ok)return result;
  const file=result.value.file,id=isRecord(file)?file.file_id:undefined;
  return typeof id==='string'&&/^[1-9][0-9]{0,19}$/.test(id)?ok(id):fail('INVALID_VOICE_FILE_ID','上传文件 ID 无效，不能继续克隆。');
}
export function encodeVoiceClone(fileId:string,voiceId:string,modelId:string):Result<Buffer>{
  if(!/^[1-9][0-9]{0,19}$/.test(fileId)||!/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(voiceId)||!/^[A-Za-z0-9_./:-]{1,200}$/.test(modelId))return fail('INVALID_CLONE_INPUT','克隆文件、声音 ID 或模型无效。');
  return ok(Buffer.from('{"file_id":'+fileId+',"voice_id":'+JSON.stringify(voiceId)+',"model":'+JSON.stringify(modelId)+'}'));
}
export function decodeVoiceClone(bytes:Uint8Array):Result<void>{const result=response(bytes);return result.ok?ok(undefined):result;}
export function decodeVoiceCatalog(bytes:Uint8Array):Result<ProviderVoice[]>{
  const result=response(bytes);if(!result.ok)return result;const voices:ProviderVoice[]=[];
  for(const [key,origin] of [['system_voice','system'],['voice_cloning','cloned'],['voice_generation','custom']] as const){
    const items=result.value[key];if(items===undefined)continue;
    if(!Array.isArray(items)||items.length>10000)return fail('INVALID_VOICE_RESPONSE','声音列表无效。');
    for(const item of items){if(!isRecord(item)||typeof item.voice_id!=='string'||!item.voice_id.trim()||item.voice_id.length>256||/[\u0000-\u001f\u007f]/.test(item.voice_id))return fail('INVALID_VOICE_RESPONSE','服务返回了无效音色 ID。');
      const name=typeof item.voice_name==='string'?item.voice_name:item.voice_id;
      const description=Array.isArray(item.description)?item.description.filter(x=>typeof x==='string').join('；').slice(0,2000):'';
      voices.push({id:item.voice_id,name:name.slice(0,300),origin,description});}
  }
  return ok(voices);
}
export function encodeVoiceManagement(operation:VoiceManagementOperation,bytes?:Uint8Array):Result<{path:string;body:Buffer;contentType:string}>{
  if(operation.kind==='catalog')return ok({path:'get_voice',body:Buffer.from('{"voice_type":"all"}'),contentType:'application/json'});
  if(operation.kind==='clone'){const body=encodeVoiceClone(operation.fileId,operation.voiceId,operation.modelId);return body.ok?ok({path:'voice_clone',body:body.value,contentType:'application/json'}):body;}
  if(!bytes||bytes.byteLength>20000000||!['audio/wav','audio/mpeg','audio/mp4'].includes(operation.mime))return fail('INVALID_CLONE_SAMPLE','克隆音频输入无效。');
  const extension=operation.mime==='audio/wav'?'wav':operation.mime==='audio/mpeg'?'mp3':'m4a',boundary='movieagent-voice-clone';
  return ok({path:'files/upload',contentType:'multipart/form-data; boundary='+boundary,body:Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nvoice_clone\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="sample.'+extension+'"\r\nContent-Type: '+operation.mime+'\r\n\r\n'),Buffer.from(bytes),Buffer.from('\r\n--'+boundary+'--\r\n')])});
}
