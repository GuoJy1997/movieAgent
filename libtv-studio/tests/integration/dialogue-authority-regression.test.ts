import {expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {setup} from './dialogue-production.test.ts';
import {execute,value} from '../fixtures/native-generation.ts';
import sharp from 'sharp';

it('confirmation preflight cannot authorize alignment and stale awaited confirmation writes no receipt',async()=>{
 const s=await setup(),voice=value(s.engine.voices.read({projectId:s.projectId,voiceRef:{id:'voice',revision:1}}));
 const input={projectId:s.projectId,dialogueRef:s.dialogueRefs[0],source:{kind:'imported-audio',media:voice.reference.ref},expectedRevision:1};
 value(await s.engine.dialogueProduction.confirmAudio(input));
 expect(await execute(s.engine,'dialogue.prepareAlignment',{projectId:s.projectId,dialogueRef:s.dialogueRefs[0],sourceVideo:voice.reference.ref,confirmedAudioRef:voice.reference.ref,startTicks:0,executionOwner:'human',runId:'forged'})).toMatchObject({ok:false,error:{code:'DIALOGUE_CONFIRMATION_REQUIRED'}});
 const original=s.engine.mediaInfo.ensure;let release!:()=>void;const gate=new Promise<void>(r=>release=r),spy=vi.spyOn(s.engine.mediaInfo,'ensure').mockImplementation(async ref=>{await gate;return original(ref);});
 const commandId=crypto.randomUUID(),pending=s.engine.commands.execute({schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'test',commandId,kind:'dialogue.confirmAudio',payload:input});
 const dialogue=value(s.engine.dialogue.read({projectId:s.projectId,shotId:'shot-0'})).current;
 value(await execute(s.engine,'dialogue.save',{projectId:s.projectId,id:dialogue.id,expectedRevision:1,draft:{shotRef:dialogue.shotRef,turns:dialogue.turns.map((turn:any)=>({...turn,text:'changed'}))}}));
 release();expect(await pending).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});spy.mockRestore();
 const db=new DatabaseSync(join(s.root,'library.sqlite'));expect(db.prepare('SELECT 1 FROM command_receipt WHERE command_id=?').get(commandId)).toBeUndefined();expect(db.prepare("SELECT COUNT(*) AS n FROM domain_event WHERE kind='dialogue.audioConfirmed'").get()?.n).toBe(0);db.close();expect(s.requests).toHaveLength(0);
});

it('formal multi-voice plans require every participating voice even when the first voice passed',async()=>{
 const s=await setup(),voice=value(s.engine.voices.read({projectId:s.projectId,voiceRef:{id:'voice',revision:1}}));
 const image=await s.importFile(await sharp({create:{width:256,height:256,channels:3,background:'#123456'}}).png().toBuffer(),'b.png');
 value(await execute(s.engine,'creation.saveEntity',{projectId:s.projectId,id:'b',expectedRevision:0,kind:'character',name:'B',description:'',constraints:'',references:[image]}));
 value(await execute(s.engine,'voice.save',{projectId:s.projectId,id:'voice-b',expectedRevision:0,draft:{entityRef:{id:'b',revision:1},name:'B',dialect:'',performanceNotes:'',reference:voice.reference}}));
 const dialogue=value(s.engine.dialogue.read({projectId:s.projectId,shotId:'shot-0'})).current;
 value(await execute(s.engine,'dialogue.save',{projectId:s.projectId,id:dialogue.id,expectedRevision:1,draft:{shotRef:dialogue.shotRef,turns:[...dialogue.turns,{...dialogue.turns[0],turnId:'b-turn',characterRef:{id:'b',revision:1},voiceRef:{id:'voice-b',revision:1},startTicks:48000}]}}));
 const status=value(s.engine.dialogueProduction.auditionStatus({projectId:s.projectId,voiceRef:{id:'voice',revision:1},profileRef:s.profileRef,route:'native-reference'}));
 const db=new DatabaseSync(join(s.root,'library.sqlite'));
 db.prepare('INSERT INTO dialogue_take VALUES(?,?,?,?,?,?,?,?,?)').run('fixture-evidence',s.projectId,'shot-0','dialogue-0',2,'manual',null,'{}',0);
 for(const emotion of ['calm','excited','quiet'])db.prepare('INSERT INTO voice_audition VALUES(?,?,?,?)').run(status.fingerprint,emotion,'fixture-evidence',JSON.stringify({checks:{timbre:'pass',accent:'pass',dialogue:'pass',lipsync:'pass'},pairKey:null}));
 const {createHash}=await import('node:crypto');db.prepare('INSERT INTO voice_audition VALUES(?,?,?,?)').run(createHash('sha256').update(JSON.stringify([status.fingerprint,'a/b'])).digest('hex'),'exchange','fixture-evidence',JSON.stringify({checks:{timbre:'pass',accent:'pass',dialogue:'pass',lipsync:'pass'},pairKey:'a/b'}));
 db.close();
 expect(await execute(s.engine,'dialogue.prepareProduction',{projectId:s.projectId,dialogueRefs:[{id:dialogue.id,revision:2}],profileRef:s.profileRef,purpose:'production',executionOwner:'human',runId:'needs-b'})).toMatchObject({ok:false,error:{code:'AUDITION_REQUIRED'}});expect(s.requests).toHaveLength(0);
 const exchange=value(await execute(s.engine,'dialogue.prepareProduction',{projectId:s.projectId,dialogueRefs:[{id:dialogue.id,revision:2}],profileRef:s.profileRef,purpose:'audition',auditionCase:'exchange',executionOwner:'human',runId:'exchange'}));
 expect(exchange.items[0].prepared.referenceImages[0].ref).toEqual(image);
 expect(exchange.items[0].prepared.prompt).toContain('character 2 (b): voice = audio 2; appearance = image 1');
 expect(exchange.items[0].prepared.referenceAudio.map((a:any)=>a.characterRef.id)).toEqual(['a','b']);
});
