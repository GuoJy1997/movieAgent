import { expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { nativeFixture, value, execute } from '../fixtures/native-generation.ts';
import { fixtureWav } from '../fixtures/audio-generation.ts';
import { CommandOutbox } from '../../apps/desktop/src/main/command-outbox.ts';
import { LocalConnection } from '../../apps/desktop/src/main/local-connection.ts';

export async function setup(count = 1) {
  const s = await nativeFixture('minimax-h3-v2');
  const projectId = s.prepareInput().projectId;
  const profileRef = value(await execute(s.engine, 'profile.save', { id: 'native', expectedRevision: 1, name: 'H3 landscape', modelRef: s.prepareInput().profileRef, parameters: { ratio: '16:9' } }));
  value(await execute(s.engine, 'creation.saveEntity', { projectId, id: 'a', expectedRevision: 0, kind: 'character', name: 'A', description: '', constraints: '', references: [] }));
  value(await execute(s.engine, 'creation.saveScript', { projectId, id: 'script', expectedRevision: 0, title: 'Story', synopsis: '', body: '', scenes: [{ id: 'scene', title: 'Scene', location: '', time: '', description: '' }] }));
  const audio = await s.importFile(fixtureWav(2), 'voice.wav');
  const probe = value(await s.engine.mediaInfo.ensure(audio));
  value(await execute(s.engine, 'voice.save', { projectId, id: 'voice', expectedRevision: 0, draft: { entityRef: { id: 'a', revision: 1 }, name: 'A', dialect: '山东话', performanceNotes: '', reference: { ref: audio, hash: probe.objectHash, probeId: probe.probeId, sourceInTicks: 0, durationTicks: 96000 } } }));
  const dialogueRefs = [];
  for (let i = 0; i < count; i++) {
    const id = `shot-${i}`;
    value(await execute(s.engine, 'creation.saveShot', { projectId, id, expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: i, title: id, durationSeconds: 5, shotSize: 'wide', cameraMovement: '', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
    value(await execute(s.engine, 'dialogue.save', { projectId, id: `dialogue-${i}`, expectedRevision: 0, draft: { shotRef: { id, revision: 1 }, turns: [{ turnId: 'turn', characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, text: `台词${i}`, emotion: 'calm', startTicks: 0, durationTicks: 48000, mode: 'native-reference' }] } }));
    dialogueRefs.push({ id: `dialogue-${i}`, revision: 1 });
  }
  return { ...s, projectId, profileRef, dialogueRefs };
}
const approval = { currency: 'CNY', allowanceMicros: 100000000, budgetLimitMicros: 2000000000, acknowledgeUnknown: true };
it('recovers a persisted superseded voice reference and continues a later command without settling uncertain writes',async()=>{
 const s=await setup(),query=s.engine.commands.query({schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'fixture',queryId:'voice-current',kind:'voice.list',payload:{projectId:s.projectId}}),voice=value(query).voices[0];
 value(await execute(s.engine,'voice.save',{projectId:s.projectId,id:voice.id,expectedRevision:1,draft:{entityRef:voice.entityRef,name:voice.name,dialect:voice.dialect,performanceNotes:voice.performanceNotes,reference:voice.reference}}));
 const path=join(s.root,'stale-reference-outbox.sqlite');let outbox=new CommandOutbox(path);
 const envelope=(kind:string,payload:unknown,commandId:string)=>({schemaVersion:1 as const,libraryId:s.engine.identity.libraryId,connectionEpoch:'old',commandId,kind,payload});
 outbox.enqueue(envelope('voice.prepareReference',{projectId:s.projectId,voiceRef:{id:'voice',revision:1},executionOwner:'human',runId:'old-voice'},'stale-voice'));outbox.enqueue(envelope('project.create',{name:'After stale voice'},'later'));outbox.enqueue(envelope('project.create',{name:'Uncertain'},'uncertain'));outbox.close();
 outbox=new CommandOutbox(path);try{const connection=new LocalConnection({identity:s.engine.identity,execute:async(c:unknown)=>(c as {commandId:string}).commandId==='uncertain'?Promise.reject(Error('fixture disconnect')):s.engine.commands.execute(c),query:async(q:unknown)=>s.engine.commands.query(q),readEvents:async(q:unknown)=>s.engine.events.read(q)},outbox);
 expect(await connection.recover()).toMatchObject({ok:false,error:{code:'ENGINE_DISCONNECTED'}});expect(outbox.pending(s.engine.identity.libraryId).map(c=>c.commandId)).toEqual(['uncertain']);expect(value(s.engine.projects.list()).some((p:any)=>p.name==='After stale voice')).toBe(true);
 const db=new DatabaseSync(path,{readOnly:true});expect(db.prepare('SELECT command_id,error_code FROM rejected_command').all()).toEqual([{command_id:'stale-voice',error_code:'REVISION_CONFLICT'}]);db.close();expect(s.requests).toEqual([]);
 }finally{outbox.close();}
});
it('archives actual synchronous dialogue validation rejections across persisted outbox recovery',async()=>{
 const s=await setup(),base={projectId:s.projectId,dialogueRefs:s.dialogueRefs,profileRef:s.profileRef,purpose:'production',executionOwner:'human',runId:'rejection'},plan=value(await execute(s.engine,'dialogue.prepareProduction',{...base,exception:{reason:'fixture only'}}));
 const media={kind:'assetVersion',libraryId:s.engine.identity.libraryId,assetId:'missing',version:1},stale={id:'dialogue-0',revision:2};
 const cases:[string,unknown,string][]=[
 ['voice.prepareReference',{projectId:s.projectId,voiceRef:{id:'voice',revision:2},executionOwner:'human',runId:'stale-reference'},'REVISION_CONFLICT'],
 ['generation.approveAndEnqueue',{preparedId:plan.items[0].prepared.preparedId,approvedPlanHash:plan.items[0].prepared.planHash,executionOwner:'human',runId:plan.items[0].prepared.runId,...approval},'DIALOGUE_BATCH_AUTHORIZATION'],
 ['dialogue.prepareProduction',base,'AUDITION_REQUIRED'],
 ['dialogue.prepareProduction',{...base,dialogueRefs:[stale]},'REVISION_CONFLICT'],
 ['dialogue.prepareProduction',{...base,profileRef:{...s.profileRef,revision:1}},'CONFIG_CHANGED'],
 ['dialogue.approveProduction',{planId:plan.planId,approvedHash:'0'.repeat(64),executionOwner:'human',runId:'rejection',approval},'APPROVAL_MISMATCH'],
 ['dialogue.approveProduction',{planId:plan.planId,approvedHash:plan.approvedHash,executionOwner:'human',runId:'rejection',approval:{...approval,acknowledgeUnknown:false}},'BUDGET_EXCEEDED'],
 ['dialogue.reviewTake',{projectId:s.projectId,takeId:'missing',expectedReviewRevision:0,checks:{timbre:'pass',accent:'pass',dialogue:'pass',lipsync:'pass'},notes:''},'REVISION_CONFLICT'],
 ['dialogue.selectTake',{projectId:s.projectId,shotId:'shot-0',expectedShotRevision:1,expectedSelectionRevision:0,dialogueRef:stale,takeId:'missing'},'REVISION_CONFLICT'],
 ['dialogue.confirmAudio',{projectId:s.projectId,dialogueRef:stale,expectedRevision:2,source:{kind:'imported-audio',media}},'REVISION_CONFLICT'],
 ['dialogue.prepareAlignment',{projectId:s.projectId,dialogueRef:stale,sourceVideo:media,confirmedAudioRef:media,startTicks:0,executionOwner:'human',runId:'align'},'REVISION_CONFLICT'],
 ['dialogue.importRepair',{projectId:s.projectId,dialogueRef:stale,sourceVideo:media,confirmedAudioRef:media,repairedVideo:media},'REVISION_CONFLICT'],
 ['dialogue.prepareRepair',{projectId:s.projectId,dialogueRef:stale,alignedInput:{videoRef:media,audioRef:media,durationTicks:96000,videoHash:'0'.repeat(64),audioHash:'0'.repeat(64)},profileRef:s.profileRef,executionOwner:'human',runId:'repair'},'REVISION_CONFLICT']];
 const path=join(s.root,'dialogue-outbox.sqlite');let outbox=new CommandOutbox(path);const transport={identity:s.engine.identity,execute:async(c:unknown)=>s.engine.commands.execute(c),query:async(q:unknown)=>s.engine.commands.query(q),readEvents:async(q:unknown)=>s.engine.events.read(q)};
 try{const replay:any[]=[];let connection=new LocalConnection(transport,outbox);for(const [index,[kind,payload,code]] of cases.entries()){const envelope={schemaVersion:1 as const,libraryId:s.engine.identity.libraryId,connectionEpoch:connection.connectionEpoch,commandId:`rejected-${index}`,kind,payload};expect(await connection.execute(envelope as any)).toMatchObject({ok:false,error:{code}});expect(outbox.pending(s.engine.identity.libraryId),kind).toHaveLength(0);replay.push({...envelope,commandId:`restart-${index}`});}for(const envelope of replay)expect(outbox.enqueue(envelope).ok).toBe(true);
 outbox.close();outbox=new CommandOutbox(path);connection=new LocalConnection(transport,outbox);expect(await connection.recover()).toMatchObject({ok:true});expect(outbox.hasPending()).toBe(false);expect(s.requests).toHaveLength(0);
 const db=new DatabaseSync(path,{readOnly:true});expect(db.prepare('SELECT count(*) AS n FROM rejected_command').get()).toMatchObject({n:cases.length*2});db.close();
 }finally{outbox.close();}
});

it('approves a frozen audition once without creating duplicate tasks', async () => {
  const s = await setup();
  const preparedResult = await execute(s.engine, 'dialogue.prepareProduction', { projectId: s.projectId, dialogueRefs: s.dialogueRefs, profileRef: s.profileRef, purpose: 'audition', auditionCase: 'calm', executionOwner: 'human', runId: 'audition' });
  expect(preparedResult, JSON.stringify(preparedResult)).toMatchObject({ ok: true });
  const plan = value(preparedResult);
  const h3 = await import('../../packages/providers/src/minimax-h3.ts');
  expect(h3.validateH3Request(plan.items[0]!.prepared), JSON.stringify(plan.items[0]!.prepared.referenceAudio)).toMatchObject({ ok: true });
  const input = { planId: plan.planId, approvedHash: plan.approvedHash, executionOwner: 'human', runId: 'audition', approval };
  const approved = value(await execute(s.engine, 'dialogue.approveProduction', input));
  expect(approved.tasks).toHaveLength(1);
  expect(value(await execute(s.engine, 'dialogue.approveProduction', input))).toEqual(approved);
  s.response({ task_id: 'dialogue-task' });
  value(await s.engine.scheduler.run(approved.tasks[0].attemptId));
  expect(s.requests).toHaveLength(1);
  expect(JSON.parse(s.requests[0]!.body.toString()).content.some((item: any) => item.type === 'audio_url')).toBe(true);
});

it('scopes a production exception to the current sixteen-shot batch and rejects stale plans', async () => {
  const s = await setup(16);
  const input = { projectId: s.projectId, dialogueRefs: s.dialogueRefs, profileRef: s.profileRef, purpose: 'production', exception: { reason: '本批导演确认' }, executionOwner: 'human', runId: 'production' };
  const planResult = await execute(s.engine, 'dialogue.prepareProduction', input);
  expect(planResult, JSON.stringify(planResult)).toMatchObject({ ok: true });
  const plan = value(planResult);
  const approvalResult = await execute(s.engine, 'dialogue.approveProduction', { planId: plan.planId, approvedHash: plan.approvedHash, executionOwner: 'human', runId: 'production', approval });
  expect(approvalResult, JSON.stringify(approvalResult)).toMatchObject({ ok: true });
  const approved = value(approvalResult);
  expect(approved.tasks).toHaveLength(16);
  value(await execute(s.engine, 'dialogue.save', { projectId: s.projectId, id: 'dialogue-0', expectedRevision: 1, draft: { shotRef: { id: 'shot-0', revision: 1 }, turns: [{ turnId: 'turn', characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, text: '人工改词', emotion: 'calm', startTicks: 0, durationTicks: 48000, mode: 'native-reference' }] } }));
  expect(value(await execute(s.engine, 'dialogue.approveProduction', { planId: plan.planId, approvedHash: plan.approvedHash, executionOwner: 'human', runId: 'production', approval }))).toEqual(approved);
  expect(s.requests).toHaveLength(0);
});

it('rejects generic item admission and allocates a single aggregate approval with immutable replay', async () => {
  const s=await setup(2);
  const plan=value(await execute(s.engine,'dialogue.prepareProduction',{projectId:s.projectId,dialogueRefs:s.dialogueRefs,profileRef:s.profileRef,purpose:'production',exception:{reason:'batch only'},executionOwner:'human',runId:'budget'}));
  const first=plan.items[0].prepared;
  expect(await execute(s.engine,'generation.approveAndEnqueue',{...approval,preparedId:first.preparedId,approvedPlanHash:first.planHash,executionOwner:'human',runId:first.runId})).toMatchObject({ok:false,error:{code:'DIALOGUE_BATCH_AUTHORIZATION'}});
  const input={planId:plan.planId,approvedHash:plan.approvedHash,executionOwner:'human',runId:'budget',approval:{...approval,allowanceMicros:101}};
  const batch=value(await execute(s.engine,'dialogue.approveProduction',input));
  expect(batch.tasks.map((t:any)=>value(s.engine.generation.read(t.taskId)).reservationMicros).reduce((a:number,b:number)=>a+b,0)).toBe(101);
  expect(await execute(s.engine,'dialogue.approveProduction',{...input,approval:{...input.approval,allowanceMicros:102}})).toMatchObject({ok:false,error:{code:'APPROVAL_REUSED'}});
  value(await execute(s.engine,'dialogue.stopProduction',{projectId:s.projectId,planId:plan.planId,executionOwner:'human'}));
  expect(value(await execute(s.engine,'dialogue.approveProduction',input))).toEqual(batch);
  const db=new DatabaseSync(join(s.root,'library.sqlite'));expect(()=>db.prepare('UPDATE dialogue_batch_approval SET approval_json=?').run('{}')).toThrow();db.close();
  expect(s.requests).toHaveLength(0);
});

it('keeps a ten-minute plan approvable at minute six and approved items valid after expiry', async () => {
  const real=Date.now();let now=real;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
  try {
    const s=await setup();const plan=value(await execute(s.engine,'dialogue.prepareProduction',{projectId:s.projectId,dialogueRefs:s.dialogueRefs,profileRef:s.profileRef,purpose:'audition',auditionCase:'calm',executionOwner:'human',runId:'lifetime'}));
    now=real+360000;const input={planId:plan.planId,approvedHash:plan.approvedHash,executionOwner:'human',runId:'lifetime',approval};const batch=value(await execute(s.engine,'dialogue.approveProduction',input));
    now=real+1200000;expect(s.engine.generation.checkCurrent(plan.items[0].prepared)).toMatchObject({ok:true});expect(value(await execute(s.engine,'dialogue.approveProduction',input))).toEqual(batch);expect(s.requests).toHaveLength(0);
  } finally {clock.mockRestore();}
});

it('keeps explicitly pinned voice revisions and emits the requested audition case with explicit role mappings', async () => {
  const s=await setup();const input={projectId:s.projectId,dialogueRefs:s.dialogueRefs,profileRef:s.profileRef,purpose:'audition',auditionCase:'quiet',executionOwner:'human',runId:'quiet'};
  const plan=value(await execute(s.engine,'dialogue.prepareProduction',input));
  expect(plan.items[0].prepared.prompt).toContain('audio 1');expect(plan.items[0].prepared.prompt).toContain('quiet');expect(plan.items[0].prepared.prompt).toContain('0–48000');
  const voice=value(s.engine.voices.read({projectId:s.projectId,voiceRef:{id:'voice',revision:1}}));
  const {libraryId,projectId,id,revision,production,createdAt,...draft}=voice;
  value(await execute(s.engine,'voice.save',{projectId:s.projectId,id:'voice',expectedRevision:1,draft:{...draft,dialect:'new'}}));
  expect(await execute(s.engine,'dialogue.approveProduction',{planId:plan.planId,approvedHash:plan.approvedHash,executionOwner:'human',runId:'quiet',approval})).toMatchObject({ok:true});expect(s.requests).toHaveLength(0);
});
