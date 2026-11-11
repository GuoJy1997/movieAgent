import { expect,it } from 'vitest';
import { parseSrt,transcriptCues } from '../../apps/desktop/src/renderer/features/timeline/SubtitleEditor.tsx';
import { timeline } from './p4-harness.ts';
import type { TranscriptRevision } from '../../packages/contracts/src/audio.ts';
import { timelineSrt } from '../../packages/domain/src/timeline-export-format.ts';
it('round trips exported leading LF, normalized internal blanks, numeric text and adjacent headers',()=>{
 const texts=['\nhello','hello\n\nworld','123','next'];
 const t={...timeline,subtitleCues:texts.map((text,i)=>({id:`q${i}`,text,startTicks:i*48000,endTicks:(i+1)*48000}))};
 expect(parseSrt(timelineSrt(t),t.fps).map(c=>c.text)).toEqual(['\nhello','hello\nworld','123','next']);
 expect(parseSrt('1\n00:00:00,000 --> 00:00:01,000\na\n2\n00:00:01,000 --> 00:00:02,000\nb',t.fps).map(c=>c.text)).toEqual(['a','b']);
 expect(parseSrt('00:00:00,000 --> 00:00:01,000\n123\n00:00:01,000 --> 00:00:02,000\n456',t.fps).map(c=>c.text)).toEqual(['123','456']);
});
it('preserves numeric subtitle text when the SRT omits an index line',()=>{
 expect(parseSrt('00:00:00,000 --> 00:00:01,000\n123',{num:30,den:1})[0]?.text).toBe('123');
});
it('maps fixed ASR revision segments through source trim and timeline offset',()=>{
 const source={kind:'artifact' as const,libraryId:'library',artifactId:'voice'};
 const transcript={id:'asr',revision:4,source,timing:'segments',segments:[{startTicks:48000,endTicks:120000,text:'第一句'},{startTicks:192000,endTicks:288000,text:'第二句'}]} as TranscriptRevision;
 const t={...timeline,audioClips:[{id:'audio',kind:'audio' as const,track:'voice' as const,media:source,sourceHash:'c'.repeat(64),sourceProbeId:'probe',sourceInTicks:96000,startTicks:480000,durationTicks:144000,gainMilli:1000,mute:false}]};
 expect(transcriptCues(transcript,t)).toMatchObject([{startTicks:480000,endTicks:504000,text:'第一句',transcript:{id:'asr',revision:4,segmentId:'0'}},{startTicks:576000,endTicks:624000,text:'第二句',transcript:{id:'asr',revision:4,segmentId:'1'}}]);
 expect(transcriptCues({...transcript,timing:'none',segments:[]},t)).toEqual([]);
});
