import { afterAll, beforeAll, expect, it } from 'vitest';
import { harness, mounted } from './p4-harness.ts';
import { dialogue, dialogueData, voice, openDialogue } from './voice-fixtures.ts';
import { expect as ui } from '@playwright/test';
let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();const page=await h.browser.newPage();await page.goto(h.address);await page.waitForFunction(()=>!!window.p4Fixture);await page.close();});afterAll(async()=>{await h?.browser.close();await h?.server.close();});
function data(){return {...dialogueData(),'dialogue.read':{current:{...dialogue,turns:dialogue.turns.map(turn=>({...turn,mode:'voiceover'}))},revisions:[],issues:[]},'voice.list':{voices:[{...voice,ttsProfileRef:{libraryId:'library',id:'tts',revision:1}}]},'voice.history':{voices:[{...voice,ttsProfileRef:{libraryId:'library',id:'tts',revision:1}}]}};}
it('routes saved voiceover through fixed VoiceLines and per-voice TTS, never offers video generation',async()=>{
 await mounted(h,async page=>{
  await openDialogue(page);
  await page.getByRole('button',{name:'独立旁白配音',exact:true}).click();
  expect(await page.getByRole('button',{name:'试镜与审核',exact:true}).count()).toBe(0);
  expect(await page.getByRole('button',{name:'配音与口型',exact:true}).count()).toBe(0);
  expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  await page.getByRole('button',{name:'固定台词并准备旁白批次',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.calls.length)).toBe(1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'audio.saveVoiceLine',payload:{text:'已保存台词',shotRef:{id:'shot',revision:1},entityRef:{id:'a',revision:1},dialogueSource:{dialogueRef:{id:'dialogue',revision:1},turnId:'turn',voiceRef:{id:'voice-a',revision:1}}}});
  await page.evaluate(()=>window.p4Fixture.resolve({id:'fixed-line',revision:1}));
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.calls.length)).toBe(2);
  expect(await page.evaluate(()=>window.p4Fixture.calls[1])).toMatchObject({kind:'audio.prepareSpeech',payload:{lines:[{lineId:'fixed-line',revision:1,profileRef:{id:'tts',revision:1}}]}});
 },data());
},20000);
it('ignores the fixed-line response after closing the voiceover panel',async()=>{
 await mounted(h,async page=>{await openDialogue(page);await page.getByRole('button',{name:'独立旁白配音',exact:true}).click();await page.getByRole('button',{name:'固定台词并准备旁白批次',exact:true}).click();await page.getByRole('button',{name:'独立旁白配音',exact:true}).click();await page.evaluate(()=>window.p4Fixture.resolve({id:'late',revision:1}));expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(1);},data());
});

function reviewData(consumer:'dialogue'|'audio'){
 const line={id:'line',revision:1,text:'独立旁白',dialogueSource:{dialogueRef:{id:'dialogue',revision:1},turnId:'turn',voiceRef:{id:'voice-a',revision:1}}};
 const take={id:'take',lineId:'line',lineRevision:1,profileRef:{id:'tts',revision:1},task:{taskId:'task'},output:{kind:'artifact',libraryId:'library',artifactId:'voice-take'}};
 return {...data(),__creation:consumer==='dialogue','audio.read':{voiceLines:[line],takes:[take],transcripts:[],diagnostics:[]},'audio.voiceoverContext':{libraryId:'library',projectId:'project',take,line,contextHash:'a'.repeat(64),outputHash:'b'.repeat(64),review:null}};
}
for(const consumer of ['dialogue','audio'] as const)it(`preserves ${consumer} voiceover review draft on close, navigation and save-A/edit-B`,async()=>{
 await mounted(h,async page=>{
  if(consumer==='dialogue'){await openDialogue(page);await page.getByRole('button',{name:'独立旁白配音',exact:true}).click();}else await page.getByRole('button',{name:'声音与字幕',exact:true}).click();
  for(const name of ['旁白音色','旁白口音','旁白台词'])await page.getByLabel(name,{exact:true}).selectOption('pass');await page.getByLabel('旁白审核备注').fill('审核 A');
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='setTimelineDraftState').at(-1)?.payload)).toMatchObject({dirty:true});expect(await page.evaluate(()=>window.p4Fixture.mayQuit())).toBe(false);
  const navigate=()=>consumer==='dialogue'?page.getByRole('button',{name:'独立旁白配音',exact:true}).click():page.getByLabel('当前时间线').selectOption('timeline-b');await navigate();await ui(page.getByRole('dialog',{name:'保存当前剪辑'})).toBeVisible();await page.getByRole('button',{name:'继续编辑',exact:true}).click();await ui(page.getByLabel('旁白审核备注')).toHaveValue('审核 A');
  await page.getByRole('button',{name:'保存旁白人工审核',exact:true}).click();await page.getByLabel('旁白审核备注').fill('审核 B');await page.evaluate(()=>{const c=window.p4Fixture.calls.at(-1)!;window.p4Fixture.resolve({...c.payload,libraryId:'library',outputHash:'b'.repeat(64),reviewedAt:'2026-10-29T00:00:00.000Z'});});
  await ui(page.getByLabel('旁白审核备注')).toHaveValue('审核 B');await navigate();await ui(page.getByRole('dialog',{name:'保存当前剪辑'})).toBeVisible();await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  await page.getByRole('button',{name:'保存旁白人工审核',exact:true}).click();
  await page.evaluate(()=>window.p4Fixture.update({'audio.voiceoverContext':{...window.p4Fixture.calls.at(-1)!.payload,take:{id:'take',profileRef:{id:'tts',revision:1},output:{kind:'artifact',libraryId:'library',artifactId:'voice-take'}},line:{text:'新依据',dialogueSource:{dialogueRef:{id:'dialogue',revision:2}}},contextHash:'c'.repeat(64),review:null}}));
  await page.evaluate(()=>{const c=window.p4Fixture.calls.at(-1)!;window.p4Fixture.resolve({...c.payload,libraryId:'library',outputHash:'b'.repeat(64),reviewedAt:'2026-10-29T00:00:01.000Z'});});
  await ui(page.getByLabel('旁白审核备注')).toHaveValue('');await ui(page.getByLabel('旁白音色',{exact:true})).toHaveValue('');
  expect(await page.evaluate(()=>window.p4Fixture.mayQuit())).toBe(true);
 },reviewData(consumer));
});
