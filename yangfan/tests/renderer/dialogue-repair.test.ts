import { afterAll, beforeAll, expect, it } from 'vitest';
import { harness, mounted, queries } from './p4-harness.ts';
import { dialogueData, openDialogue, media, reviewContext } from './voice-fixtures.ts';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.browser.close(); await h?.server.close(); });

it('confirms fixed audio against the dialogue revision and submits explicit human review checks', async () => {
  const media = { kind: 'assetVersion', libraryId: 'library', assetId: 'audio', version: 1 };
  const take = { id: 'take', shotId: 'shot', dialogueRef: { id: 'dialogue', revision: 1 }, voiceRef: { id: 'voice-a', revision: 1 }, route: 'dubbed-lipsync', origin: { kind: 'manual', receiptId: 'receipt', repairedVideo: media, confirmedAudioRef: media }, video: media, audio: media, sourceVideoHash: 'a'.repeat(64), audioHash: 'b'.repeat(64), reviewRevision: 0, createdAt: new Date().toISOString() };
  const data = {
    ...queries(), __creation: true,
    'creation.read': { scripts: [{ id: 'script', revision: 1, title: '剧本', scenes: [{ id: 'scene', title: '场景', location: '', time: '', description: '' }] }], shots: [{ id: 'shot', revision: 1, scriptId: 'script', sceneId: 'scene', order: 0, title: '开门', durationSeconds: 4, shotSize: '', cameraMovement: '', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }], selections: [], entities: [] },
    'voice.list': { voices: [] }, 'dialogue.read': { current: { id: 'dialogue', revision: 1, shotRef: { id: 'shot', revision: 1 }, turns: [{ turnId: 'turn', characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice-a', revision: 1 }, text: '你好', emotion: 'calm', startTicks: 0, durationTicks: 48000, mode: 'dubbed-lipsync' }] }, revisions: [], issues: [] },
    'dialogue.takes': { takes: [{ ...take, projectId: 'project' }], reviews: [] }, 'dialogue.reviewContext':reviewContext, 'asset.search': { assets: [{ name: '固定配音', ref: media, mime: 'audio/wav' }] },
  };
  await mounted(h, async page => {
    await page.getByRole('button', { name: '编辑镜头 开门', exact: true }).click();
    await page.getByRole('button', { name: '对白制作', exact: true }).click();
    await page.getByRole('button', { name: '配音与口型', exact: true }).click();
    await page.getByText('待人工审核', { exact: true }).waitFor();
    await page.getByRole('button', { name: '确认固定配音', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'dialogue.confirmAudio', payload: { dialogueRef: { id: 'dialogue', revision: 1 }, expectedRevision: 1, source: { kind: 'imported-audio', media } } });
    expect(await page.getByRole('button', { name: '保存人工审核', exact: true }).isDisabled()).toBe(true);
    for (const label of ['音色', '口音', '台词', '口型']) await page.getByRole('region', { name: '对白人工审核', exact: true }).getByLabel(label, { exact: true }).selectOption('pass');
    await page.getByRole('button', { name: '保存人工审核', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[1])).toMatchObject({ kind: 'dialogue.reviewTake', payload: { takeId: 'take', expectedReviewRevision: 0, checks: { timbre: 'pass', accent: 'pass', dialogue: 'pass', lipsync: 'pass' } } });
  }, data);
});

it('confirms a genuine speech take by its take identity without inventing a task or imported source', async () => {
  const data = dialogueData();
  data['audio.read'] = { voiceLines: [], takes: [{ id: 'tts-take', lineId: 'line', lineRevision: 2, output: { kind: 'artifact', libraryId: 'library', artifactId: 'tts-audio' }, task: { libraryId: 'library', taskId: 'genuine-task', attemptId: 'genuine-attempt' } }], transcripts: [], diagnostics: [] };
  await mounted(h, async page => {
    await openDialogue(page); await page.getByRole('button', { name: '配音与口型', exact: true }).click();
    await page.getByLabel('配音来源').selectOption('audio-take');
    await page.getByRole('button', { name: '确认固定配音', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'dialogue.confirmAudio', payload: { source: { kind: 'audio-take', takeId: 'tts-take' } } });
  }, data);
});

it('uses the selected Sync profile and the video frozen by alignment', async () => {
  const data = dialogueData(), video = { ...media, assetId: 'video' }, aligned = { ...media, assetId:'aligned',version:2 };
  const profile = (id: string) => ({ libraryId: 'library', id, revision: 1, name: id, modelRef: { libraryId: 'library', id: 'sync-model', revision: 1 }, parameters: {} });
  data['asset.search'] = { assets: [{ name: '配音', ref: media, mime: 'audio/wav' }, { name: '源视频', ref: video, mime: 'video/mp4' }] };
  data['profile.list'] = { profiles: [profile('sync-one'), profile('sync-two')] };
  data['model.list'] = { models: [{ id: 'sync-model', revision: 1, capabilities: { taskTypes: ['lip_sync'], inputKinds: ['video', 'audio'], outputKinds: ['video'] } }] };
  await mounted(h, async page => {
    await openDialogue(page); await page.getByRole('button', { name: '配音与口型', exact: true }).click();
    await page.getByRole('button', { name: '确认固定配音', exact: true }).click();
    await page.evaluate(media => window.p4Fixture.resolve({ source: { kind: 'imported-audio', ref: media, hash: 'a'.repeat(64), probeId: 'probe' } }), media);
    await page.getByRole('button', { name: '本地补静音并对齐', exact: true }).click();
    await page.evaluate(() => window.p4Fixture.resolve({ planId: 'alignment', planHash: 'a'.repeat(64), requiredFreeBytes: 100, executionOwner: 'desktop-user', runId: 'run' }));
    await page.waitForFunction(() => window.p4Fixture.calls.length === 3);
    await page.evaluate(() => window.p4Fixture.resolve({ jobId: 'job' }));
    await page.evaluate(aligned => window.p4Fixture.update({ 'render.read': { libraryId:'library',projectId:'project',jobId:'job',planId:'alignment',kind:'derived',state: 'SUCCEEDED', outputRef: aligned } }), aligned);
    await page.getByLabel('口型预设').selectOption('sync-two:1');
    await page.getByRole('button', { name: '准备口型修正', exact: true }).click();
    await page.evaluate(aligned => window.p4Fixture.resolve({ ref: aligned, hash: 'b'.repeat(64), probe: { durationTicks: 192000 } }), aligned);
    await page.waitForFunction(() => window.p4Fixture.calls.length === 5);
    await page.evaluate(video => window.p4Fixture.resolve({ ref: video, hash: 'c'.repeat(64) }), video);
    await page.waitForFunction(() => window.p4Fixture.calls.length === 6);
    expect(await page.evaluate(() => window.p4Fixture.calls[5])).toMatchObject({ kind: 'dialogue.prepareRepair', payload: { profileRef: { id: 'sync-two', revision: 1 }, alignedInput: { videoRef: video, audioRef: aligned } } });
  }, data);
});

const originalVideo={...media,assetId:'original'},fixedVideo={...media,assetId:'fixed'},alignedAudio={...media,assetId:'aligned-audio',version:2};
function manualData(){return {...dialogueData(),'asset.search':{assets:[{name:'录音',ref:media,mime:'audio/wav'},{name:'原视频',ref:originalVideo,mime:'video/mp4'},{name:'修正版',ref:fixedVideo,mime:'video/mp4'}]}};}
async function confirmAndQueue(page:import('@playwright/test').Page){
  await openDialogue(page);await page.getByRole('button',{name:'配音与口型',exact:true}).click();
  await page.getByRole('button',{name:'确认固定配音',exact:true}).click();await page.evaluate(media=>window.p4Fixture.resolve({source:{kind:'imported-audio',ref:media,hash:'a'.repeat(64),probeId:'probe'}}),media);
  await page.getByLabel('外部修正版（可选）').selectOption('fixed:1');
  await page.getByRole('button',{name:'本地补静音并对齐',exact:true}).click();await page.evaluate(()=>window.p4Fixture.resolve({planId:'alignment',planHash:'a'.repeat(64),requiredFreeBytes:100,executionOwner:'desktop-user',runId:'run'}));
  await page.waitForFunction(()=>window.p4Fixture.calls.length===3);await page.evaluate(()=>window.p4Fixture.resolve({jobId:'alignment-job'}));
}
const alignedJob={libraryId:'library',projectId:'project',jobId:'alignment-job',planId:'alignment',kind:'derived',state:'SUCCEEDED',outputRef:alignedAudio};

it('imports the successful aligned audio version with its captured video, never the raw confirmed recording',async()=>{
  await mounted(h,async page=>{
    await confirmAndQueue(page);await page.evaluate(job=>window.p4Fixture.update({'render.read':job}),alignedJob);
    await page.getByRole('button',{name:'导入手工修正版',exact:true}).click();
    expect(await page.evaluate(()=>window.p4Fixture.calls[3])).toMatchObject({kind:'dialogue.importRepair',payload:{sourceVideo:originalVideo,confirmedAudioRef:alignedAudio,repairedVideo:fixedVideo}});
  },manualData());
});

it('rejects pending, failed and mismatched alignment jobs and invalidates old output after input changes',async()=>{
  await mounted(h,async page=>{
    await confirmAndQueue(page);
    for(const override of [{state:'RUNNING'},{state:'FAILED'},{jobId:'other-job'},{planId:'other-plan'},{projectId:'other-project'}]){
      await page.evaluate(job=>window.p4Fixture.update({'render.read':job}),{...alignedJob,...override});
      expect(await page.getByRole('button',{name:'导入手工修正版',exact:true}).isDisabled()).toBe(true);
    }
    await page.evaluate(job=>window.p4Fixture.update({'render.read':job}),alignedJob);
    expect(await page.getByRole('button',{name:'导入手工修正版',exact:true}).isDisabled()).toBe(false);
    await page.getByLabel('配音入点（秒）').fill('0.5');await page.evaluate(job=>window.p4Fixture.update({'render.read':job}),alignedJob);
    expect(await page.getByRole('button',{name:'导入手工修正版',exact:true}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>window.p4Fixture.calls)).toHaveLength(3);
  },manualData());
});

it('cannot adopt an old completed alignment after the source video changes',async()=>{
  await mounted(h,async page=>{
    await confirmAndQueue(page);await page.getByLabel('源视频').selectOption('fixed:1');await page.evaluate(job=>window.p4Fixture.update({'render.read':job}),alignedJob);
    expect(await page.getByRole('button',{name:'导入手工修正版',exact:true}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>window.p4Fixture.calls)).toHaveLength(3);
  },manualData());
});

it('adopts against the current shot selection revision', async () => {
  const data = dialogueData();
  data['dialogue.reviewContext'] = reviewContext;
  data['dialogue.takes'] = { takes: [{ id: 'take', projectId: 'project', shotId: 'shot', dialogueRef: { id: 'dialogue', revision: 1 }, voiceRef: { id: 'voice-a', revision: 1 }, route: 'dubbed-lipsync', video: media, audio: media, reviewRevision: 1 }], reviews: [{ takeId: 'take', revision: 1, checks: { timbre: 'pass', accent: 'pass', dialogue: 'pass', lipsync: 'pass' }, notes: '' }] };
  await mounted(h, async page => {
    await openDialogue(page);
    await page.getByRole('button', { name: '配音与口型', exact: true }).click();
    await page.getByRole('button', { name: '采用此 take', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'dialogue.selectTake', payload: { expectedSelectionRevision: 3 } });
  }, data);
});
