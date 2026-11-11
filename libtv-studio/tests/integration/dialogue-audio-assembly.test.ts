import {expect,it} from 'vitest';
import {planDialogueAudioAssembly} from '../../packages/domain/src/dialogue-audio-assembly.ts';
import {assembleDialogueAudio} from '../../packages/engine/src/media/dialogue-audio-assembly.ts';
import {audioFixture,fixtureWav} from '../fixtures/audio-generation.ts';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
const dialogue:any={id:'dialogue',revision:1,shotRef:{id:'shot',revision:1},turns:[
 {turnId:'a',characterRef:{id:'a',revision:1},voiceRef:{id:'voice-a',revision:1},startTicks:48000,durationTicks:96000},
 {turnId:'b',characterRef:{id:'b',revision:1},voiceRef:{id:'voice-b',revision:1},startTicks:192000,durationTicks:96000}]};
const source=(turnId:string):import('../../packages/contracts/src/dialogue-assembly.ts').DialogueAudioSource=>({turnId,characterRef:{id:turnId,revision:1},voiceRef:{id:'voice-'+turnId,revision:1},ref:{kind:'artifact',libraryId:'library',artifactId:turnId},hash:(turnId==='a'?'a':'b').repeat(64),probeId:'probe-'+turnId,durationTicks:48000,sourceKind:'audio-take',takeId:'take-'+turnId,reviewRevision:1});
it('covers every turn once and places the correct role audio at its exact slot',()=>{
 const plan=planDialogueAudioAssembly(dialogue,[source('b'),source('a')],336000);
 expect(plan).toMatchObject({ok:true,value:{durationTicks:336000,items:[{turnId:'a',startTicks:48000,durationTicks:48000,allocatedTicks:96000},{turnId:'b',startTicks:192000,durationTicks:48000,allocatedTicks:96000}]}});
});
it('rejects missing, duplicate, wrong-role, overlapping and overlong dialogue audio',()=>{
 for(const sources of [[source('a')],[source('a'),source('a')],[{...source('a'),voiceRef:{id:'voice-b',revision:1}},source('b')],[{...source('a'),durationTicks:96001},source('b')]])expect(planDialogueAudioAssembly(dialogue,sources,336000).ok).toBe(false);
 const overlap={...dialogue,turns:[dialogue.turns[0],{...dialogue.turns[1],startTicks:96000}]};
 expect(planDialogueAudioAssembly(overlap,[source('a'),source('b')],336000).ok).toBe(false);
});
it('renders verified PCM with silence between two exact audio slots without changing their speed',async()=>{
 const s=await audioFixture('openai-speech-v1',{native:true}),a=join(s.root,'a.wav'),b=join(s.root,'b.wav'),output=join(s.root,'assembled.wav');
 const tone=(value:number)=>{const wav=fixtureWav(1);for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(value,i);return wav;};
 await writeFile(a,tone(1000));await writeFile(b,tone(2000));
 const result=await assembleDialogueAudio({runtime:s.runtime!,inputs:[{path:a,startTicks:48000,allocatedTicks:96000,durationTicks:48000},{path:b,startTicks:192000,allocatedTicks:96000,durationTicks:48000}],durationTicks:336000,output,stagingRoot:s.root});
 expect(result).toMatchObject({ok:true,value:{durationTicks:336000,mime:'audio/wav'}});
 const wav=await readFile(output),offset=wav.indexOf(Buffer.from('data'))+8;
 for(const [seconds,want] of [[0.5,0],[1.5,1000],[2.5,0],[4.5,2000],[5.5,0],[6.5,0]])expect(wav.readInt16LE(offset+Math.round(seconds!*48000)*2)).toBe(want);
},30000);
