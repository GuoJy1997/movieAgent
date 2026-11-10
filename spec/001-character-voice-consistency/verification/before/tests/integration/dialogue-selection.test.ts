import { expect, it } from 'vitest';
import { audioFixture, audioValue, audioExecute, fixtureWav } from '../fixtures/audio-generation.ts';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stat, realpath } from 'node:fs/promises';

async function setup() {
  const s = await audioFixture('openai-speech-v1', { native: true }), projectId = s.projectId;
  audioValue(await audioExecute(s.engine, 'creation.saveEntity', { projectId, id: 'a', expectedRevision: 0, kind: 'character', name: 'A', description: '', constraints: '', references: [] }));
  audioValue(await audioExecute(s.engine, 'creation.saveScript', { projectId, id: 'script', expectedRevision: 0, title: 'Story', synopsis: '', body: '', scenes: [{ id: 'scene', title: 'Scene', location: '', time: '', description: '' }] }));
  audioValue(await audioExecute(s.engine, 'creation.saveShot', { projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0, title: 'Shot', durationSeconds: 1, shotSize: 'wide', cameraMovement: '', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
  const audio = await s.importAudio(fixtureWav(1));
  const probe = audioValue(await s.engine.mediaInfo.ensure(audio));
  audioValue(await audioExecute(s.engine, 'voice.save', { projectId, id: 'voice', expectedRevision: 0, draft: { entityRef: { id: 'a', revision: 1 }, name: 'A voice', dialect: '', performanceNotes: '', reference: { ref: audio, hash: probe.objectHash, probeId: probe.probeId, sourceInTicks: 0, durationTicks: 48000 } } }));
  audioValue(await audioExecute(s.engine, 'dialogue.save', { projectId, id: 'dialogue', expectedRevision: 0, draft: { shotRef: { id: 'shot', revision: 1 }, turns: [{ turnId: 'turn', characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, text: '你好', emotion: 'calm', startTicks: 0, durationTicks: 48000, mode: 'dubbed-lipsync' }] } }));
  const path = join(s.root, 'source.mp4');
  expect(spawnSync(s.runtime!.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=32x32:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { shell: false, windowsHide: true }).status).toBe(0);
  const info = await stat(path), grantId = crypto.randomUUID();
  audioValue(s.engine.assets.registerGrant({ grantId, importId: crypto.randomUUID(), libraryId: s.engine.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path, realPath: await realpath(path), allowedRoot: s.root, name: 'source.mp4', size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino }] }));
  const video = audioValue(await audioExecute(s.engine, 'asset.importGrantedFiles', { grantId })).versions[0];
  audioValue(await audioExecute(s.engine,'dialogue.confirmAudio',{projectId,dialogueRef:{id:'dialogue',revision:1},source:{kind:'imported-audio',media:audio},expectedRevision:1}));
  const alignment=audioValue(await audioExecute(s.engine,'dialogue.prepareAlignment',{projectId,dialogueRef:{id:'dialogue',revision:1},sourceVideo:video,confirmedAudioRef:audio,startTicks:0,executionOwner:'human',runId:'align'}));
  const job=audioValue(await audioExecute(s.engine,'media.enqueueDerived',{planId:alignment.planId,planHash:alignment.planHash,executionOwner:'human',runId:'align',diskBudgetBytes:alignment.requiredFreeBytes}));
  expect(s.engine.renders.claim()).toBe(job.jobId);await s.engine.renders.execute(job.jobId,new AbortController());
  const aligned=audioValue(s.engine.renders.read({projectId,jobId:job.jobId}));expect(aligned.state,JSON.stringify(aligned)).toBe('SUCCEEDED');
  const take = audioValue(await audioExecute(s.engine, 'dialogue.importRepair', { projectId, dialogueRef: { id: 'dialogue', revision: 1 }, sourceVideo: video, confirmedAudioRef: aligned.outputRef, repairedVideo: video }));
  return { ...s, projectId, take, video };
}

const selectionInput = (s: Awaited<ReturnType<typeof setup>>) => ({ projectId: s.projectId, shotId: 'shot', expectedShotRevision: 1, expectedSelectionRevision: 0, dialogueRef: { id: 'dialogue', revision: 1 }, takeId: s.take.id });

it('rejectUnreviewedSelection writes no shot or dialogue selection', async () => {
  const s = await setup();
  expect(await audioExecute(s.engine, 'dialogue.selectTake', selectionInput(s))).toMatchObject({ ok: false, error: { code: 'DIALOGUE_REVIEW_REQUIRED' } });
  expect(audioValue(s.engine.creation.read({ projectId: s.projectId })).selections).toEqual([]);
});

it('rejectNeedsFixSelection writes no shot or dialogue selection', async () => {
  const s = await setup();
  audioValue(await audioExecute(s.engine, 'dialogue.reviewTake', { projectId: s.projectId, takeId: s.take.id, expectedReviewRevision: 0, checks: { timbre: 'pass', accent: 'pass', dialogue: 'needs-fix', lipsync: 'pass' }, notes: '台词不符' }));
  expect(await audioExecute(s.engine, 'dialogue.selectTake', selectionInput(s))).toMatchObject({ ok: false, error: { code: 'DIALOGUE_QUALITY_NOT_PASSED' } });
  expect(audioValue(s.engine.creation.read({ projectId: s.projectId })).selections).toEqual([]);
});

import { DatabaseSync } from 'node:sqlite';

it('requires explicit current-context re-review after a voice revision and keeps the event stream readable',async()=>{
 const s=await setup(),input={projectId:s.projectId,takeId:s.take.id,expectedReviewRevision:0,checks:{timbre:'pass',accent:'pass',dialogue:'pass',lipsync:'pass'},notes:'review'};
 audioValue(await audioExecute(s.engine,'dialogue.reviewTake',input));
 const voice=audioValue(s.engine.voices.read({projectId:s.projectId,voiceRef:{id:'voice',revision:1}}));const {libraryId,projectId,id,revision,createdAt,production,...draft}=voice;
 audioValue(await audioExecute(s.engine,'voice.save',{projectId:s.projectId,id:'voice',expectedRevision:1,draft:{...draft,dialect:'new dialect'}}));
 expect(await audioExecute(s.engine,'dialogue.selectTake',selectionInput(s))).toMatchObject({ok:false,error:{code:'DIALOGUE_REVIEW_CONTEXT_CHANGED'}});
 expect(await audioExecute(s.engine,'dialogue.reviewTake',{...input,expectedReviewRevision:1})).toMatchObject({ok:false,error:{code:'DIALOGUE_REVIEW_CONTEXT_CHANGED'}});
 const context=audioValue(s.engine.commands.query({schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'test',queryId:'review-context',kind:'dialogue.reviewContext',payload:{projectId:s.projectId,takeId:s.take.id}}));expect(context).toMatchObject({stale:true,voiceRefs:[{id:'voice',revision:2}]});
 audioValue(await audioExecute(s.engine,'dialogue.reviewTake',{...input,expectedReviewRevision:1,reviewContextHash:context.contextHash}));
 audioValue(await audioExecute(s.engine,'dialogue.selectTake',selectionInput(s)));
 const initial=audioValue(s.engine.events.read({libraryId:s.engine.identity.libraryId,connectionEpoch:'test'}));
 const events=audioValue(s.engine.events.read({libraryId:s.engine.identity.libraryId,connectionEpoch:'test',cursor:{...initial.cursor,seq:0}}));expect(events.events.some((event:any)=>event.kind==='dialogue.audioConfirmed')).toBe(true);expect(events.events.at(-1).payload.takeId).toBe(s.take.id);
 const db=new DatabaseSync(join(s.root,'library.sqlite'));expect(db.prepare('SELECT COUNT(*) AS n FROM dialogue_review_context WHERE take_id=?').get(s.take.id)?.n).toBe(2);db.close();
});

it('allowVoiceoverWithoutLipCheck and preserves selection history after an ordinary reselection', async () => {
  const s = await setup(), take = { ...s.take, id: 'voiceover-take', route: 'voiceover' };
  const db = new DatabaseSync(join(s.root, 'library.sqlite'));
  db.prepare('INSERT INTO dialogue_take(id,project_id,shot_id,dialogue_id,dialogue_revision,origin_kind,task_id,data_json,review_revision) VALUES(?,?,?,?,?,?,?,?,0)').run(take.id, take.projectId, take.shotId, 'dialogue', 1, 'manual', null, JSON.stringify(take));
  db.close();
  audioValue(await audioExecute(s.engine, 'dialogue.reviewTake', { projectId: s.projectId, takeId: take.id, expectedReviewRevision: 0, checks: { timbre: 'pass', accent: 'pass', dialogue: 'pass', lipsync: 'not-applicable' }, notes: '画外音通过' }));
  const selected = audioValue(await audioExecute(s.engine, 'dialogue.selectTake', { ...selectionInput(s), takeId: take.id }));
  expect(selected).toMatchObject({ route: 'voiceover', selectionRevision: 1, reviewRevision: 1 });
  const assembly = audioValue(await audioExecute(s.engine, 'timeline.prepareAssembly',{ projectId: s.projectId, scriptRef: { id: 'script', revision: 1 }, shots: [{ id: 'shot', revision: 1, selectionRevision: 1 }], target: { id: 'timeline', expectedRevision: 0 }, allowImages: false, settings: { fps: { num: 30, den: 1 }, canvas: { width: 1920, height: 1080 } }, executionOwner: 'human', runId: 'assembly' }));
  expect(assembly.draft.videoClips[0]).toMatchObject({ mute: true, dialogueGroupId: assembly.draft.audioClips[0]?.dialogueGroupId });
  expect(assembly.draft.audioClips).toHaveLength(1);
  expect(assembly.draft.audioClips[0]).toMatchObject({ track: 'voice', mute: false, startTicks: 0, durationTicks: assembly.draft.videoClips[0].durationTicks });
  audioValue(await audioExecute(s.engine, 'timeline.applyAssembly', { planId: assembly.planId, planHash: assembly.planHash, executionOwner: 'human', runId: 'assembly' }));
  const unmute={kind:'setGain',clipId:assembly.draft.videoClips[0].id,gainMilli:1000,mute:false};
  expect(await audioExecute(s.engine,'timeline.applyOps',{projectId:s.projectId,timelineId:'timeline',expectedRevision:1,operations:[unmute]})).toMatchObject({ok:false});
  expect(await audioExecute(s.engine,'timeline.restore',{projectId:s.projectId,timelineId:'timeline',expectedRevision:1,sourceRevision:1,operations:[unmute]})).toMatchObject({ok:false});
  expect(audioValue(s.engine.timelines.read({projectId:s.projectId,timelineId:'timeline'})).revision).toBe(1);
  const connectionRef=audioValue(await audioExecute(s.engine,'provider.saveConnection',{id:'text',expectedRevision:0,name:'Local text fixture',adapterType:'openai-chat-v1',baseUrl:'http://127.0.0.1:12345/v1',credentialRef:null,headers:{},networkPolicy:{privateEndpoint:{hostname:'127.0.0.1',port:12345,purpose:'model-api'}},timeoutMs:1000,concurrency:1}));
  const modelRef=audioValue(await audioExecute(s.engine,'model.saveDefinition',{id:'text',expectedRevision:0,name:'Text',modelId:'fixture',connectionRef,capabilities:{taskTypes:['text_to_text'],inputKinds:['text'],outputKinds:['text'],maxBatch:1},parameters:{max_tokens:{type:'integer',min:1,max:8192,default:1024}},pricing:{status:'unknown'}}));
  const profileRef=audioValue(await audioExecute(s.engine,'profile.save',{id:'text',expectedRevision:0,name:'Text',modelRef,parameters:{}}));
  const session=audioValue(await audioExecute(s.engine,'agent.createSession',{projectId:s.projectId,title:'Rough',mode:'director',executionOwner:'human'}));
  const finish=audioValue(await audioExecute(s.engine,'finish.prepareTurn',{sessionId:session.sessionId,templateId:'finish-rough-cut',profileRef,message:'Arrange selected shot',targets:{kind:'rough-cut',timelineRef:{libraryId:s.engine.identity.libraryId,projectId:s.projectId,id:'timeline',revision:1},shots:[{id:'shot',revision:1,selectionRevision:1}],mediaRefs:[s.video]}}));
  expect(finish.targets.shots[0].dialogue.selection.takeId).toBe(take.id);
  const {finishApplication}=await import('../../packages/engine/src/finish-agent-service.ts');
  const application=audioValue(finishApplication(finish,{version:1,kind:'rough-cut',reply:'arranged',clips:[{key:'clip',mediaKey:'media-0',shotKey:'shot-0',sourceInTicks:0,startTicks:0,durationTicks:48000,fit:'contain'}]},['clip']));
  const arranged=audioValue(await audioExecute(s.engine,'timeline.applyOps',application.input));
  expect(arranged.videoClips[0].mute).toBe(true);expect(arranged.audioClips).toHaveLength(1);expect(arranged.audioClips[0]).toMatchObject({mute:false,media:take.audio,dialogueGroupId:arranged.videoClips[0].dialogueGroupId});
  const exportInput = { requestId: crypto.randomUUID(), projectId: s.projectId, timelineId: 'timeline', revision: 1, kind: 'csv' as const };
  const exported = audioValue(await s.engine.exports.prepareExport(exportInput));
  expect(exported.storyboard[0]?.voice).toMatchObject({ takeId: take.id, voiceRef: { id: 'voice', revision: 1 }, route: 'voiceover', reviewRevision: 1, sourceVideoHash: take.sourceVideoHash, audioHash: take.audioHash });
  const {timelineCsv}=await import('../../packages/domain/src/timeline-export-format.ts');const csv=Buffer.from(timelineCsv(exported.timeline,exported.storyboard),'utf8');
  for(const expected of ['structured_dialogue','dialogue_turns_json','你好',take.id,take.audioHash,take.sourceVideoHash,'voiceover'])expect(csv.toString('utf8')).toContain(expected);
  expect(csv.toString('utf8')).toContain('"dialogue_id","dialogue_revision","voice_id","voice_revision","take_id","review_revision"');
  audioValue(await audioExecute(s.engine, 'creation.selectOutput', { projectId: s.projectId, shotId: 'shot', expectedRevision: 1, expectedSelectionRevision: 1, role: 'video', reference: null }));
  expect(audioValue(await s.engine.exports.prepareExport(exportInput)).storyboard[0]?.voice).toMatchObject({ takeId: take.id, reviewRevision: 1 });
  const historyDb = new DatabaseSync(join(s.root, 'library.sqlite'));
  expect(historyDb.prepare('SELECT take_id FROM dialogue_selection WHERE shot_id=?').get('shot')).toBeUndefined();
  const historic = JSON.parse(historyDb.prepare('SELECT data_json FROM shot_output_selection_history WHERE shot_id=? AND selection_revision=1').get('shot')!.data_json as string);
  expect(historic.dialogue).toMatchObject({ takeId: take.id, reviewRevision: 1 });
  historyDb.close();
});
