import { expect, it } from 'vitest';
import { parseFinishProposal } from '../../packages/domain/src/finish-proposals.ts';
import { finishApplication } from '../../packages/engine/src/finish-agent-service.ts';

const voiceDraft = {
  version: 1 as const,
  kind: 'voice-lines' as const,
  reply: '文案已修订',
  lines: [{ key: 'line-0', text: '新的台词', shotKey: 'shot-0', role: 'a', emotion: 'calm' as const, route: 'native-reference' as const }],
};
const subtitleDraft = {
  version: 1 as const,
  kind: 'subtitle-edits' as const,
  reply: '字幕已修订',
  edits: [{ key: 'cue-0', text: '修订字幕', startTicks: 0, endTicks: 48000 }],
};
const roughDraft = {
  version: 1 as const,
  kind: 'rough-cut' as const,
  reply: '粗剪已排列',
  clips: [{ key: 'clip-0', mediaKey: 'media-0', shotKey: 'shot-0', sourceInTicks: 0, startTicks: 0, durationTicks: 48000, fit: 'contain' as const }],
};

it('parses only the three bounded finish protocols and rejects extra authority', () => {
  expect(parseFinishProposal(JSON.stringify(voiceDraft))).toMatchObject({ ok: true });
  expect(parseFinishProposal(JSON.stringify(subtitleDraft))).toMatchObject({ ok: true });
  expect(parseFinishProposal(JSON.stringify(roughDraft))).toMatchObject({ ok: true });
  for (const invalid of [
    { ...voiceDraft, schemaVersion: 1 },
    { ...voiceDraft, path: 'C:/outside' },
    { ...voiceDraft, command: 'ffmpeg' },
    { ...voiceDraft, lines: Array.from({ length: 17 }, (_, i) => ({ key: `line-${i}`, text: 'x' })) },
    { ...subtitleDraft, edits: Array.from({ length: 101 }, (_, i) => ({ key: `cue-${i}`, text: 'x' })) },
    { ...roughDraft, clips: Array.from({ length: 33 }, (_, i) => ({ ...roughDraft.clips[0], key: `clip-${i}` })) },
    { ...subtitleDraft, edits: [{ key: 'cue-0', text: 'x', startTicks: -1, endTicks: 0 }] },
  ]) expect(parseFinishProposal(JSON.stringify(invalid)).ok).toBe(false);
});

it('rejects unselected voice and subtitle aliases before producing writes', () => {
  const prepared = {
    projectId: 'project', runId: 'run', template: { kind: 'voice-lines' },
    targets: { kind: 'voice-lines', script: { id: 'script', revision: 1 }, shots: [{ key: 'shot-0', value: { id: 'shot', revision: 1 } }], voiceLines: [{ key: 'line-0', value: { id: 'line', revision: 1 } }] },
  } as any;
  expect(finishApplication(prepared, voiceDraft, ['missing']).ok).toBe(false);
  expect(finishApplication(prepared, { ...voiceDraft, lines: [{ key: 'line-0', text: 'x', shotKey: 'missing' }] }, ['line-0']).ok).toBe(false);
  expect(finishApplication({ ...prepared, template: { kind: 'subtitle-edits' } }, voiceDraft, ['line-0']).ok).toBe(false);
});

it('builds CAS-protected voice-line, subtitle and rough-cut applications without media jobs', () => {
  const voice = {
    projectId: 'project', libraryId: 'library', runId: 'run', template: { kind: 'voice-lines' },
    targets: { kind: 'voice-lines', script: { id: 'script', revision: 1 }, shots: [{ key: 'shot-0', value: { id: 'shot', revision: 1 } }], voiceLines: [{ key: 'line-0', value: { id: 'line', revision: 1 } }], voices: [{ id: 'voice-a', revision: 1, entityRef: { id: 'a', revision: 1 } }], dialogues: [] },
  } as any;
  const voiceResult = finishApplication(voice, voiceDraft, ['line-0']);
  expect(voiceResult).toMatchObject({ ok: true, value: { kind: 'voice-lines', lines: [], voiceLines:[{id:'line',expectedRevision:1,text:'新的台词'}] } });
  const multiple=finishApplication(voice,{...voiceDraft,lines:[{...voiceDraft.lines[0]!,key:'new-a',role:'voice:voice-a',startTicks:0,durationTicks:48000},{...voiceDraft.lines[0]!,key:'new-b',role:'voice:voice-a',startTicks:48000,durationTicks:48000}]},['new-a','new-b']);
  expect(multiple).toMatchObject({ok:true,value:{lines:[{draft:{turns:[{startTicks:0},{startTicks:48000}]}}]}});

  const timeline = {
    libraryId: 'library', projectId: 'project', id: 'cut', revision: 3, scriptRef: { id: 'script', revision: 1 }, title: 'Cut', fps: { num: 30, den: 1 }, timebase: 48000,
    canvas: { width: 1920, height: 1080 }, videoClips: [], audioClips: [], subtitleCues: [{ id: 'cue', startTicks: 48000, endTicks: 96000, text: '旧字幕' }],
    subtitleStyle: { fontId: 'noto', fontSize: 64, color: '#ffffff', bottomMargin: 80, outline: 2 }, createdAt: new Date().toISOString(),
  } as any;
  const subtitle = { projectId: 'project', libraryId: 'library', runId: 'run', template: { kind: 'subtitle-edits' }, targets: { kind: 'subtitle-edits', timeline, cues: [{ key: 'cue-0', value: timeline.subtitleCues[0] }] } } as any;
  expect(finishApplication(subtitle, subtitleDraft, ['cue-0'])).toMatchObject({ ok: true, value: { kind: 'subtitle-edits', input: { timelineId: 'cut', expectedRevision: 3, operations: [{ kind: 'setCue', cue: { id: 'cue', text: '修订字幕', startTicks: 0, endTicks: 48000 } }] } } });

  const media = { kind: 'assetVersion', libraryId: 'library', assetId: 'asset', version: 1 } as const;
  const rough = { projectId: 'project', libraryId: 'library', runId: 'run', template: { kind: 'rough-cut' }, targets: { kind: 'rough-cut', timeline: { ...timeline, videoClips: [{ id: 'old', kind: 'image', media, sourceHash: 'a'.repeat(64), sourceProbeId: null, sourceInTicks: 0, startTicks: 0, durationTicks: 48000, fit: 'contain', gainMilli: 1000, mute: true }] }, shots: [{ key: 'shot-0', value: { id: 'shot', revision: 1 }, selectionRevision: 2 }], media: [{ key: 'media-0', ref: media, metadata: { hash: 'a'.repeat(64), mime: 'image/png' } }] } } as any;
  const roughResult = finishApplication(rough, roughDraft, ['clip-0']);
  expect(roughResult).toMatchObject({ ok: true, value: { kind: 'rough-cut', input: { expectedRevision: 3, operations: [{ kind: 'delete', clipId: 'old' }, { kind: 'insert', clip: { kind: 'image', media, durationTicks: 48000 } }] } } });
  expect(finishApplication(rough, { ...roughDraft, clips: [{ ...roughDraft.clips[0]!, mediaKey: 'missing' }] }, ['clip-0']).ok).toBe(false);
});

import { nativeFixture, value, execute } from '../fixtures/native-generation.ts';
import { finishPrepared, finishCompleted, finishApprove, finishAcceptance } from '../fixtures/finish-agent.ts';
import sharp from 'sharp';
import { fixtureWav } from '../fixtures/audio-generation.ts';

async function scriptAndShot(s: Awaited<ReturnType<typeof nativeFixture>>, withVoice = false) {
  const projectId = s.prepareInput().projectId;
  value(await execute(s.engine, 'creation.saveScript', { projectId, id: 'script', expectedRevision: 0, title: 'Story', synopsis: '', body: '', scenes: [{ id: 'scene', title: 'Scene', location: '', time: '', description: '' }] }));
  value(await execute(s.engine, 'creation.saveShot', { projectId, id: 'shot', expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: 0, title: 'Shot', durationSeconds: 5, shotSize: 'wide', cameraMovement: '', subject: '', action: '', dialogue: 'old', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
  if (withVoice) {
    value(await execute(s.engine, 'creation.saveEntity', { projectId, id: 'a', expectedRevision: 0, kind: 'character', name: 'A', description: '', constraints: '', references: [] }));
    const audioRef = await s.importFile(fixtureWav(2), 'voice.wav'), metadata = value(s.engine.assets.metadata(audioRef));
    value(await execute(s.engine, 'voice.save', { projectId, id: 'voice-a', expectedRevision: 0, draft: { entityRef: { id: 'a', revision: 1 }, name: 'A voice', dialect: '', performanceNotes: '', reference: { ref: audioRef, hash: metadata.hash, probeId: 'voice-probe', sourceInTicks: 0, durationTicks: 96000 } } }));
  }
  return projectId;
}

it('runs one approved voice-line turn and adopts only local revisions without audio or render jobs', async () => {
  const s = await nativeFixture('openai-chat-v1', 'max_completion_tokens', undefined, true);
  const projectId = await scriptAndShot(s, true);
  value(await execute(s.engine, 'audio.saveVoiceLine', { projectId, id: 'line', expectedRevision: 0, text: 'old line', shotRef: { libraryId: s.engine.identity.libraryId, id: 'shot', revision: 1 } }));
  const targets = { kind: 'voice-lines', scriptRef: { id: 'script', revision: 1 }, shotRefs: [{ id: 'shot', revision: 1 }], voiceLineRefs: [{ id: 'line', revision: 1 }] };
  const prepared = await finishPrepared(s, 'finish-voice-lines', targets, { outputTokens: 4096 });
  expect(s.requests).toHaveLength(0);
  expect(prepared.turn.protocol).toEqual({ name: 'finish', version: 1, parser: 'finish-proposal-v1' });
  expect(prepared.turn.generation.config.parameters).toEqual({ max_completion_tokens: 4096 });
  s.response({ choices: [{ message: { content: JSON.stringify(voiceDraft) }, finish_reason: 'stop' }] });
  const approved = value(await execute(s.engine, 'finish.approveTurn', finishApprove(prepared.turn)));
  value(await s.engine.scheduler.run(approved.task.attemptId));
  value(await s.engine.finish.wake());
  const run = value(s.engine.finish.run(prepared.turn.runId));
  expect(run).toMatchObject({ state: 'PROPOSED', task: approved.task });
  expect(value(s.engine.audio.read({ projectId })).voiceLines[0].text).toBe('old line');
  const action = value(await execute(s.engine, 'finish.acceptProposal', finishAcceptance(run, ['line-0'])));
  expect(action.result.voiceLines[0]).toMatchObject({id:'line',revision:2,text:'新的台词'});
  expect(value(await execute(s.engine, 'finish.acceptProposal', finishAcceptance(run, ['line-0'])))).toEqual(action);
  expect(await execute(s.engine, 'finish.acceptProposal', { ...finishAcceptance(run, ['line-0']), selectedKeys: [] })).toMatchObject({ ok: false });
  expect(value(s.engine.audio.read({ projectId })).takes).toEqual([]);
  expect(value(s.engine.renders.list({ projectId })).jobs).toEqual([]);
  expect(s.requests).toHaveLength(1);
});

it('adopts subtitle edits with CAS and rejects manual changes without partial writes', async () => {
  const s = await nativeFixture();
  const projectId = await scriptAndShot(s);
  value(await execute(s.engine, 'timeline.create', { projectId, id: 'cut', scriptRef: { id: 'script', revision: 1 }, title: 'Cut', settings: { fps: { num: 30, den: 1 }, canvas: { width: 1920, height: 1080 } } }));
  value(await execute(s.engine, 'timeline.applyOps', { projectId, timelineId: 'cut', expectedRevision: 1, operations: [{ kind: 'setCue', cue: { id: 'cue', startTicks: 48000, endTicks: 96000, text: 'old' } }] }));
  const targets = { kind: 'subtitle-edits', timelineRef: { libraryId: s.engine.identity.libraryId, projectId, id: 'cut', revision: 2 }, cueIds: ['cue'] };
  const { run } = await finishCompleted(s, 'finish-subtitle-edits', targets, subtitleDraft);
  value(await execute(s.engine, 'timeline.applyOps', { projectId, timelineId: 'cut', expectedRevision: 2, operations: [{ kind: 'setCue', cue: { id: 'cue', startTicks: 48000, endTicks: 96000, text: 'manual' } }] }));
  expect(await execute(s.engine, 'finish.acceptProposal', finishAcceptance(run, ['cue-0']))).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  expect(value(s.engine.timelines.read({ projectId, timelineId: 'cut' })).subtitleCues[0].text).toBe('manual');
});

it('adopts a fixed-media rough cut without enqueuing local media work', async () => {
  const s = await nativeFixture();
  const projectId = await scriptAndShot(s);
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer();
  const ref = await s.importFile(bytes, 'rough.png');
  value(await execute(s.engine, 'creation.selectOutput', { projectId, shotId: 'shot', expectedRevision: 1, expectedSelectionRevision: 0, role: 'image', reference: ref }));
  value(await execute(s.engine, 'timeline.create', { projectId, id: 'cut', scriptRef: { id: 'script', revision: 1 }, title: 'Cut', settings: { fps: { num: 30, den: 1 }, canvas: { width: 1920, height: 1080 } } }));
  const targets = { kind: 'rough-cut', timelineRef: { libraryId: s.engine.identity.libraryId, projectId, id: 'cut', revision: 1 }, shots: [{ id: 'shot', revision: 1, selectionRevision: 1 }], mediaRefs: [ref] };
  const { run } = await finishCompleted(s, 'finish-rough-cut', targets, roughDraft);
  const action = value(await execute(s.engine, 'finish.acceptProposal', finishAcceptance(run, ['clip-0'])));
  expect(action.result.timeline.videoClips).toHaveLength(1);
  expect(action.result.timeline.videoClips[0]).toMatchObject({ kind: 'image', media: ref, durationTicks: 48000, provenance: { shotId: 'shot', shotRevision: 1, selectionRevision: 1 } });
  expect(value(s.engine.renders.list({ projectId })).jobs).toEqual([]);
});

it('adopts Agent dialogue with the captured current appearance and an unchanged historical voice',async()=>{
 const s=await nativeFixture('openai-chat-v1','max_completion_tokens',undefined,true),projectId=await scriptAndShot(s,true);
 value(await execute(s.engine,'creation.saveEntity',{projectId,id:'a',expectedRevision:1,kind:'character',name:'A renamed',description:'',constraints:'',references:[]}));
 const targets={kind:'voice-lines',scriptRef:{id:'script',revision:1},shotRefs:[{id:'shot',revision:1}],voiceLineRefs:[]};
 const {run}=await finishCompleted(s,'finish-voice-lines',targets,voiceDraft);
 expect(run.prepared.targets.characters).toMatchObject([{id:'a',revision:2}]);
 const action=value(await execute(s.engine,'finish.acceptProposal',finishAcceptance(run,['line-0'])));
 expect(action.result.dialogues[0].turns[0]).toMatchObject({characterRef:{id:'a',revision:2},voiceRef:{id:'voice-a',revision:1}});
 expect(s.requests).toHaveLength(1);expect(value(s.engine.audio.read({projectId})).takes).toEqual([]);
});
