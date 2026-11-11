import {createHash} from 'node:crypto';
import type {CharacterVoiceRevision} from '../../contracts/src/character-voice.ts';
export function compileVoiceInstructions(voice:CharacterVoiceRevision,audioIndex:number):string {
  return ['Voice identity for character '+voice.entityRef.id+' = audio '+audioIndex+'.',
    voice.language?'Language: '+JSON.stringify(voice.language)+'.':'',
    voice.dialect?'Dialect: '+JSON.stringify(voice.dialect)+'.':'',
    voice.timbreDescription?'Timbre: '+JSON.stringify(voice.timbreDescription)+'.':'',
    voice.performanceNotes?'Performance instructions: '+JSON.stringify(voice.performanceNotes)+'.':'',
    'Use the reference for speaker identity; speak the current dialogue, do not repeat the sample transcript.'
  ].filter(Boolean).join(' ');
}
export function voiceIdentityFingerprint(voice:CharacterVoiceRevision,route:string,configuration:unknown):string {
  return createHash('sha256').update(JSON.stringify({id:voice.id,route,configuration,dialect:voice.dialect,language:voice.language??'',timbre:voice.timbreDescription??'',notes:voice.performanceNotes,reference:voice.videoReference??voice.reference,binding:voice.ttsBinding??voice.ttsProfileRef})).digest('hex');
}
