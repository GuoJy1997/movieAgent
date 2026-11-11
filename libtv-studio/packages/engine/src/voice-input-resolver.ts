import type { LibraryHandle } from '../../storage/src/database.ts';
import type { CreationRef } from '../../contracts/src/creation.ts';
import type { RunConfigSnapshot, RevisionRef } from '../../contracts/src/models.ts';
import { isCharacterVoiceRevision, type CharacterVoiceRevision, type FrozenTTSVoice } from '../../contracts/src/character-voice.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';

/** Shared identity authority. Reads an exact saved revision, never a role default. */
export function voiceInputResolver(library: LibraryHandle) {
  function read(projectId:string,voiceRef:CreationRef):Result<CharacterVoiceRevision>{
    const own=library.checkOwnership();if(!own.ok)return own;
    const row=library.db.prepare('SELECT data_json FROM character_voice_revision WHERE project_id=? AND id=? AND revision=?').get(projectId,voiceRef.id,voiceRef.revision);
    const value:unknown=row?JSON.parse(row.data_json as string):null;
    return isCharacterVoiceRevision(value)&&value.libraryId===library.libraryId ? ok(value):fail('VOICE_NOT_FOUND','固定角色声音不存在。');
  }
  function usable(projectId:string,voiceRef:CreationRef):Result<CharacterVoiceRevision>{
    const fixed=read(projectId,voiceRef);if(!fixed.ok)return fixed;
    const latest=library.db.prepare('SELECT r.data_json FROM character_voice_current c JOIN character_voice_revision r ON r.id=c.id AND r.project_id=c.project_id AND r.revision=c.revision WHERE c.id=? AND c.project_id=?').get(voiceRef.id,projectId);
    if(fixed.value.archived||latest&&JSON.parse(latest.data_json as string).archived)return fail('VOICE_ARCHIVED','声音已归档，请明确选择可用声音。');return fixed;
  }
  const same=(a:RevisionRef,b:RevisionRef)=>a.libraryId===b.libraryId&&a.id===b.id&&a.revision===b.revision;
  function tts(projectId:string,voiceRef:CreationRef,config:RunConfigSnapshot):Result<FrozenTTSVoice>{
    const found=usable(projectId,voiceRef);if(!found.ok)return found;const voice=found.value;
    if(voice.archived)return fail('VOICE_ARCHIVED','声音已归档，请明确选择可用版本。');
    const binding=voice.ttsBinding,profile=binding?.profileRef??voice.ttsProfileRef;
    const configRef=(v:{libraryId:string;id:string;revision:number})=>({libraryId:v.libraryId,id:v.id,revision:v.revision});
    if(!profile||!same(profile,configRef(config.profile))||binding&&(!same(binding.modelRef,configRef(config.model))||!same(binding.connectionRef,configRef(config.connection))))return fail('VOICE_CONFIG_MISMATCH','角色声音必须使用绑定的语音服务、模型和预设。');
    const providerVoiceId=binding?.providerVoiceId??config.parameters.voice;
    if(typeof providerVoiceId!=='string'||!providerVoiceId.trim()||providerVoiceId.length>256||/[\u0000-\u001f\u007f]/.test(providerVoiceId))return fail('VOICE_BINDING_REQUIRED','缺少有效的固定服务音色 ID。');
    if(config.model.capabilities.taskTypes[0]!=='text_to_speech')return fail('UNSUPPORTED_CAPABILITY','此角色声音需要语音合成模型。');
    return ok({voiceRef:{...voiceRef},characterId:voice.entityRef.id,providerVoiceId,profileRef:configRef(config.profile),modelRef:configRef(config.model),connectionRef:configRef(config.connection),dialect:voice.dialect,performanceNotes:voice.performanceNotes,unmappedFields:[...(voice.language?['language']:[]),...(voice.timbreDescription?['timbreDescription']:[]),...(voice.dialect?['dialect']:[]),...(voice.performanceNotes?['performanceNotes']:[])]});
  }
  return {read,usable,tts};
}
