import { expect, it } from 'vitest';
import { audioFixture, audioValue as value, audioExecute as execute, fixtureWav } from '../fixtures/audio-generation.ts';
import { isDomainEvent } from '../../packages/contracts/src/events.ts';
import { isReceipt } from '../../packages/contracts/src/commands.ts';
import { settings } from './timeline-fixtures.ts';
import { timelineSegmentId } from '../../packages/domain/src/timeline-edit.ts';

async function setup() {
  const s = await audioFixture('openai-speech-v1', { native: true });
  const projectId = s.projectId, libraryId = s.engine.identity.libraryId;
  const wav = fixtureWav(2); for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(Math.round(Math.sin(i / 2 * Math.PI * 440 / 24000) * 8000), i);
  const media = await s.importAudio(wav), probe = value(await s.engine.mediaInfo.ensure(media));
  value(await execute(s.engine, 'creation.saveEntity', { projectId, id: 'role', expectedRevision: 0, kind: 'character', name: '旁白角色', description: '', constraints: '', references: [] }));
  value(await execute(s.engine, 'voice.save', { projectId, id: 'voice', expectedRevision: 0, draft: { entityRef: { id: 'role', revision: 1 }, name: '旁白', dialect: 'fixture', performanceNotes: '', reference: { ref: media, hash: probe.objectHash, probeId: probe.probeId, sourceInTicks: 0, durationTicks: 96000 }, ttsProfileRef: s.profileRef } }));
  value(await execute(s.engine, 'creation.saveScript', { projectId, id: 'script', expectedRevision: 0, title: '旁白', synopsis: '', body: '', scenes: [{ id: 'scene', title: 'Scene', location: '', time: '', description: '' }] }));
  value(await execute(s.engine, 'creation.saveShot', { projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0, title: 'Shot', durationSeconds: 5, shotSize: 'wide', cameraMovement: '', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
  const draft = { shotRef: { id: 'shot', revision: 1 }, turns: [{ turnId: 'turn', characterRef: { id: 'role', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, text: '独立旁白测试', emotion: 'calm', startTicks: 48000, durationTicks: 96000, mode: 'voiceover' }] };
  value(await execute(s.engine, 'dialogue.save', { projectId, id: 'dialogue', expectedRevision: 0, draft }));
  const line = { projectId, id: 'line', expectedRevision: 0, text: draft.turns[0]!.text, shotRef: { libraryId, ...draft.shotRef }, entityRef: { libraryId, ...draft.turns[0]!.characterRef }, dialogueSource: { dialogueRef: { id: 'dialogue', revision: 1 }, turnId: 'turn', voiceRef: { id: 'voice', revision: 1 } } };
  const query = (kind: string, payload: unknown) => s.engine.commands.query({ schemaVersion: 1, libraryId, connectionEpoch: 'fixture', queryId: crypto.randomUUID(), kind, payload });
  return { ...s, wav, draft, line, query };
}

it('uses real public TTS, durable per-output review and independent audio adoption; stale source and latest needs-fix fail closed after reopen', async () => {
  const s = await setup(), projectId = s.projectId;
  value(await execute(s.engine, 'audio.saveVoiceLine', s.line));
  const input = { projectId, lines: [{ lineId: 'line', revision: 1, profileRef: s.profileRef }], executionOwner: 'human', runId: 'voiceover' };
  const plan = value(await execute(s.engine, 'audio.prepareSpeech', input)); expect(s.requests).toHaveLength(0);
  s.response(s.wav);
  const approved = value(await execute(s.engine, 'audio.approveSpeech', { planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'voiceover', approval: s.approval }));
  value(await s.engine.scheduler.run(approved.tasks[0].attemptId));
  await expect.poll(() => value(s.engine.audio.read({ projectId })).takes.length).toBe(1);
  const take = value(s.engine.audio.read({ projectId })).takes[0], probe = value(await s.engine.mediaInfo.ensure(take.output));
  expect(s.requests).toHaveLength(1); expect(s.requests[0]!.url).toContain('audio/speech');
  value(await execute(s.engine, 'timeline.create', { projectId, id: 'cut', scriptRef: { id: 'script', revision: 1 }, title: 'Voiceover', settings }));
  const clip = { id: 'voice-clip', kind: 'audio', track: 'voice', media: take.output, sourceHash: probe.objectHash, sourceProbeId: probe.probeId, startTicks: 48000, sourceInTicks: 0, durationTicks: 96000, gainMilli: 1000, mute: false };
  const insert = (expectedRevision: number, media = take.output) => execute(s.engine, 'timeline.applyOps', { projectId, timelineId: 'cut', expectedRevision, operations: [{ kind: 'insert', clip: { ...clip, media } }] });
  expect(await insert(1)).toMatchObject({ ok: false, error: { code: 'VOICEOVER_REVIEW_REQUIRED' } });
  const context = value(s.query('audio.voiceoverContext', { projectId, takeId: take.id }));
  const reviewInput = { projectId, takeId: take.id, contextHash: context.contextHash, checks: { timbre: 'pass', accent: 'pass', dialogue: 'pass' }, notes: 'synthetic engineering review, not voice quality acceptance' };
  const cursor = value(s.engine.events.read({ libraryId: s.engine.identity.libraryId, connectionEpoch: 'fixture' })).cursor;
  const receipt = await execute(s.engine, 'audio.reviewVoiceover', reviewInput); expect(receipt.ok && isReceipt(receipt.value)).toBe(true); value(receipt);
  const events = value(s.engine.events.read({ libraryId: s.engine.identity.libraryId, connectionEpoch: 'fixture', cursor })).events;
  expect(events.every(isDomainEvent)).toBe(true); expect(events.some((event: any) => event.kind === 'audio.voiceoverReviewed')).toBe(true);
  value(await insert(1));
  value(await execute(s.engine, 'audio.reviewVoiceover', { ...reviewInput, checks: { ...reviewInput.checks, accent: 'needs-fix' } }));
  value(await execute(s.engine, 'timeline.applyOps', { projectId, timelineId: 'cut', expectedRevision: 2, operations: [{ kind: 'delete', clipId: clip.id }] }));
  expect(await execute(s.engine, 'timeline.restore', { projectId, timelineId: 'cut', expectedRevision: 3, sourceRevision: 2 })).toMatchObject({ ok: false, error: { code: 'VOICEOVER_REVIEW_REQUIRED' } });
  const alias = await s.importAudio(s.wav, 'alias.wav'); expect(await insert(3, alias)).toMatchObject({ ok: false, error: { code: 'VOICEOVER_REVIEW_REQUIRED' } });
  value(await s.engine.close()); s.engine = await s.open();
  expect(await insert(3)).toMatchObject({ ok: false, error: { code: 'VOICEOVER_REVIEW_REQUIRED' } });
  value(await execute(s.engine, 'dialogue.save', { projectId, id: 'dialogue', expectedRevision: 1, draft: { ...s.draft, turns: [{ ...s.draft.turns[0], text: 'changed' }] } }));
  expect(await execute(s.engine, 'audio.reviewVoiceover', reviewInput)).toMatchObject({ ok: false, error: { code: 'INPUT_CHANGED' } });
  expect(await execute(s.engine, 'audio.prepareSpeech', input)).toMatchObject({ ok: false, error: { code: 'INPUT_CHANGED' } });
  expect(s.requests).toHaveLength(1);
});

it('rejects all voiceover video production and forged dialogue-linked text before provider preparation', async () => {
  const s = await setup();
  expect(await execute(s.engine, 'dialogue.prepareProduction', { projectId: s.projectId, dialogueRefs: [{ id: 'dialogue', revision: 1 }], profileRef: s.profileRef, purpose: 'audition', auditionCase: 'calm', executionOwner: 'human', runId: 'no-video' })).toMatchObject({ ok: false, error: { code: 'VOICEOVER_AUDIO_ROUTE_REQUIRED' } });
  expect(await execute(s.engine, 'audio.saveVoiceLine', { ...s.line, text: 'forged' })).toMatchObject({ ok: false, error: { code: 'INPUT_CHANGED' } });
  expect(s.requests).toEqual([]);
});

it('does not let a retained sibling authorize fresh insertion or restoration after review revocation',async()=>{
 const s=await setup(),projectId=s.projectId;value(await execute(s.engine,'audio.saveVoiceLine',s.line));
 const plan=value(await execute(s.engine,'audio.prepareSpeech',{projectId,lines:[{lineId:'line',revision:1,profileRef:s.profileRef}],executionOwner:'human',runId:'siblings'}));s.response(s.wav);
 const batch=value(await execute(s.engine,'audio.approveSpeech',{planId:plan.planId,planHash:plan.planHash,executionOwner:'human',runId:'siblings',approval:s.approval}));value(await s.engine.scheduler.run(batch.tasks[0].attemptId));
 const take=value(s.engine.audio.read({projectId})).takes[0],probe=value(await s.engine.mediaInfo.ensure(take.output)),context=value(s.query('audio.voiceoverContext',{projectId,takeId:take.id}));
 const review={projectId,takeId:take.id,contextHash:context.contextHash,checks:{timbre:'pass',accent:'pass',dialogue:'pass'},notes:'fixture'};value(await execute(s.engine,'audio.reviewVoiceover',review));
 value(await execute(s.engine,'timeline.create',{projectId,id:'siblings',scriptRef:{id:'script',revision:1},title:'Siblings',settings}));
 const clip={id:'a',kind:'audio',track:'voice',media:take.output,sourceHash:probe.objectHash,sourceProbeId:probe.probeId,startTicks:0,sourceInTicks:0,durationTicks:96000,gainMilli:1000,mute:false},b={...clip,id:'b',startTicks:144000};
 const ops=(expectedRevision:number,operations:unknown[])=>execute(s.engine,'timeline.applyOps',{projectId,timelineId:'siblings',expectedRevision,operations});
 value(await ops(1,[{kind:'insert',clip},{kind:'insert',clip:b}]));value(await ops(2,[{kind:'delete',clipId:'b'}]));
 value(await execute(s.engine,'audio.reviewVoiceover',{...review,checks:{...review.checks,accent:'needs-fix'}}));
 const cursor=value(s.engine.events.read({libraryId:s.engine.identity.libraryId,connectionEpoch:'fixture'})).cursor;
 expect(await ops(3,[{kind:'insert',clip:b}])).toMatchObject({ok:false,error:{code:'VOICEOVER_REVIEW_REQUIRED'}});
 expect(await execute(s.engine,'timeline.restore',{projectId,timelineId:'siblings',expectedRevision:3,sourceRevision:2})).toMatchObject({ok:false,error:{code:'VOICEOVER_REVIEW_REQUIRED'}});
 expect(value(s.engine.timelines.read({projectId,timelineId:'siblings'})).revision).toBe(3);
 expect(value(s.engine.events.read({libraryId:s.engine.identity.libraryId,connectionEpoch:'fixture',cursor})).events).toEqual([]);
 value(await ops(3,[{kind:'split',clipId:'a',atTicks:48000,operationId:'existing-split'}]));
 value(await ops(4,[{kind:'move',clipId:timelineSegmentId('existing-split','a'),startTicks:96000},{kind:'trim',clipId:'a',sourceInTicks:0,durationTicks:48000}]));
 expect(value(s.engine.timelines.read({projectId,timelineId:'siblings',revision:2})).audioClips).toHaveLength(2);
});

it('restores ordinary trashed historical audio while rejecting fresh insertion and replacement',async()=>{
 const s=await setup(),projectId=s.projectId,media=await s.importAudio(fixtureWav(2),'ordinary.wav'),probe=value(await s.engine.mediaInfo.ensure(media));
 value(await execute(s.engine,'timeline.create',{projectId,id:'history',scriptRef:{id:'script',revision:1},title:'History',settings}));
 const clip={id:'ordinary',kind:'audio',track:'music',media,sourceHash:probe.objectHash,sourceProbeId:probe.probeId,startTicks:0,sourceInTicks:0,durationTicks:96000,gainMilli:1000,mute:false};
 const ops=(expectedRevision:number,operations:unknown[])=>execute(s.engine,'timeline.applyOps',{projectId,timelineId:'history',expectedRevision,operations});
 value(await ops(1,[{kind:'insert',clip}]));value(await ops(2,[{kind:'delete',clipId:clip.id}]));value(await execute(s.engine,'asset.trash',{assetId:media.assetId,expectedRevision:1}));
 const restored=value(await execute(s.engine,'timeline.restore',{projectId,timelineId:'history',expectedRevision:3,sourceRevision:2}));expect(restored.audioClips).toEqual([clip]);
 expect(await ops(4,[{kind:'insert',clip:{...clip,id:'fresh',startTicks:144000}}])).toMatchObject({ok:false,error:{code:'ASSET_TRASHED'}});
 expect(await ops(4,[{kind:'replaceMedia',clipId:clip.id,media,sourceHash:probe.objectHash,sourceProbeId:probe.probeId,sourceInTicks:0,durationTicks:96000}])).toMatchObject({ok:false,error:{code:'ASSET_TRASHED'}});
});
