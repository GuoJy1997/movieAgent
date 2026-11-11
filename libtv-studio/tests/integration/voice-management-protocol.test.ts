import {expect,it} from 'vitest';
import {decodeVoiceClone,decodeVoiceUpload,encodeVoiceClone,decodeVoiceCatalog,validateCloneSample} from '../../packages/providers/src/voice-management.ts';
it('keeps an int64 upload file ID exact without rounding through Number',()=>{
  expect(decodeVoiceUpload(Buffer.from('{"file":{"file_id":123456789012345680},"base_resp":{"status_code":0}}'))).toEqual({ok:true,value:'123456789012345680'});
});
it('encodes the original numeric file ID and candidate voice exactly',()=>{
  const result=encodeVoiceClone('123456789012345680','MovieAgent_abc123','manual-audio');
  expect(result.ok).toBe(true);if(result.ok)expect(result.value.toString()).toBe('{"file_id":123456789012345680,"voice_id":"MovieAgent_abc123","model":"manual-audio"}');
  expect(encodeVoiceClone('1e20','MovieAgent_abc123','manual').ok).toBe(false);
});
it('does not accept nonzero provider codes or malformed IDs as success',()=>{
  expect(decodeVoiceUpload(Buffer.from('{"file":{"file_id":123},"base_resp":{"status_code":1004}}')).ok).toBe(false);
  expect(decodeVoiceUpload(Buffer.from('{"file":{"file_id":1e20},"base_resp":{"status_code":0}}')).ok).toBe(false);
});
it('lists system and cloned IDs without conflating voices from different categories',()=>{
  const result=decodeVoiceCatalog(Buffer.from(JSON.stringify({system_voice:[{voice_id:'Chinese (Mandarin)_Reliable_Executive',voice_name:'A'}],voice_cloning:[{voice_id:'role-A'}],base_resp:{status_code:0}})));
  expect(result).toMatchObject({ok:true,value:[{id:'Chinese (Mandarin)_Reliable_Executive',origin:'system'},{id:'role-A',origin:'cloned'}]});
});
it('applies clone sample limits separately from short video references',()=>{
  for(const seconds of [10,120,300])expect(validateCloneSample({mime:'audio/wav',durationTicks:seconds*48000,byteLength:20000000}).ok).toBe(true);
  for(const seconds of [2,9.99,301])expect(validateCloneSample({mime:'audio/wav',durationTicks:Math.round(seconds*48000),byteLength:100}).ok).toBe(false);
  expect(validateCloneSample({mime:'audio/wav',durationTicks:480000,byteLength:20000001}).ok).toBe(false);
});

it('keeps ambiguous clone JSON separate from explicit provider rejection',()=>{
 for(const body of [{},{base_resp:{}},{base_resp:{status_code:'0'}},[]])expect(decodeVoiceClone(Buffer.from(JSON.stringify(body)))).toMatchObject({ok:false,error:{code:'INVALID_VOICE_RESPONSE'}});
 expect(decodeVoiceClone(Buffer.from('{"base_resp":{"status_code":1004}}'))).toMatchObject({ok:false,error:{code:'VOICE_PROVIDER_REJECTED'}});
});
