import {afterAll,beforeAll,expect,it} from 'vitest';
import {harness,mounted} from './p4-harness.ts';
import {dialogueData,openDialogue,media,voice} from './voice-fixtures.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();});
afterAll(async()=>{await h?.browser.close();await h?.server.close();});
it('hands the first visible completed TTS assembly to the lip-sync alignment controls',async()=>{
 const data=dialogueData(),video={...media,assetId:'video'},assembled={kind:'artifact',libraryId:'library',artifactId:'assembled-voice'};
 data['asset.search']={assets:[{name:'讲话视频',ref:video,mime:'video/mp4'}]};
 data['audio.read']={voiceLines:[{id:'line',revision:1,dialogueSource:{dialogueRef:{id:'dialogue',revision:1},turnId:'turn'}}],takes:[{id:'take',lineId:'line',lineRevision:1,output:media,task:{taskId:'tts-task'}}],transcripts:[],diagnostics:[]};
 await mounted(h,async page=>{
  await openDialogue(page);await page.getByRole('button',{name:'配音与口型',exact:true}).click();
  await page.getByText('生成并审核固定台词配音',{exact:true}).click();
  const assembly=page.getByRole('region',{name:'逐句合成整段配音',exact:true}).first();
  await assembly.getByLabel('第 1 句配音结果',{exact:true}).selectOption('take');
  await assembly.getByRole('button',{name:'本地合成全部台词',exact:true}).click();
  await page.waitForFunction(()=>window.p4Fixture.calls.length===1);
  await page.evaluate(()=>window.p4Fixture.resolve({planId:'assembly',planHash:'a'.repeat(64),executionOwner:'desktop-user',runId:'run',requiredFreeBytes:1024}));
  await page.waitForFunction(()=>window.p4Fixture.calls.length===2);
  await page.evaluate(()=>window.p4Fixture.resolve({jobId:'assembly-job'}));
  await page.evaluate(outputRef=>window.p4Fixture.update({'render.read':{libraryId:'library',projectId:'project',jobId:'assembly-job',planId:'assembly',kind:'derived',state:'SUCCEEDED',outputRef}}),assembled);
  await assembly.getByRole('button',{name:'确认完整镜头配音',exact:true}).click();
  await page.waitForFunction(()=>window.p4Fixture.calls.length===3);
  await page.evaluate(ref=>window.p4Fixture.resolve({source:{kind:'audio-assembly',ref,hash:'b'.repeat(64),probeId:'probe',manifestHash:'c'.repeat(64)}}),assembled);
  await expect.poll(()=>page.getByLabel('配音来源',{exact:true}).inputValue()).toBe('audio-assembly');
  expect(await page.getByLabel('配音入点（秒）',{exact:true}).inputValue()).toBe('0');
  expect(await page.getByRole('button',{name:'本地补静音并对齐',exact:true}).isEnabled()).toBe(true);
  await page.getByRole('button',{name:'本地补静音并对齐',exact:true}).click();
  await page.waitForFunction(()=>window.p4Fixture.calls.length===4);
  expect(await page.evaluate(()=>window.p4Fixture.calls[3])).toMatchObject({kind:'dialogue.prepareAlignment',payload:{confirmedAudioRef:assembled,sourceVideo:video,startTicks:0}});
 },data);
});

it('approves nested dialogue TTS without submitting or revising the enclosing shot editor',async()=>{
 const data=dialogueData();
 data['voice.history']={voices:[{...voice,ttsProfileRef:{libraryId:'library',id:'tts',revision:1}}]};
 data['audio.read']={voiceLines:[{id:'line',revision:1,dialogueSource:{dialogueRef:{id:'dialogue',revision:1},turnId:'turn'}}],takes:[],transcripts:[],diagnostics:[]};
 await mounted(h,async page=>{
  await openDialogue(page);await page.getByRole('button',{name:'配音与口型',exact:true}).click();await page.getByText('生成并审核固定台词配音',{exact:true}).click();
  await page.getByRole('button',{name:'固定台词并准备旁白批次',exact:true}).click();await page.waitForFunction(()=>window.p4Fixture.calls.length===1);
  const prepared={preparedId:'speech',planHash:'a'.repeat(64),expiresAt:Date.now()+600000,currency:null,estimateMicros:null,executionOwner:'desktop-user',runId:'run',prompt:'固定台词',config:{model:{name:'TTS',modelId:'fixture',revision:1,capabilities:{outputKinds:['audio']}},profile:{id:'tts',revision:1,name:'Fixture TTS'},connection:{baseUrl:'http://127.0.0.1:1/v1'},parameters:{voice:'v'}}};
  await page.evaluate(prepared=>window.p4Fixture.resolve({planId:'batch',planHash:'b'.repeat(64),executionOwner:'desktop-user',runId:'run',currency:null,estimateMicros:null,items:[{lineId:'line',prepared}]}),prepared);
  await page.getByLabel('单次风险额度',{exact:true}).fill('1');await page.getByLabel('项目预算上限',{exact:true}).fill('100');await page.getByLabel('批准币种',{exact:true}).fill('CNY');await page.getByLabel('我理解费用未知，额度不能限制供应商实际账单',{exact:true}).check();
  await page.getByRole('button',{name:'批准旁白配音批次',exact:true}).click({noWaitAfter:true});
  expect(await page.evaluate(()=>window.p4Fixture.calls.map(c=>c.kind))).toEqual(['audio.prepareSpeech','audio.approveSpeech']);
  await page.evaluate(()=>window.p4Fixture.resolve({}));
  await expect.poll(()=>page.getByRole('dialog',{name:'确认这一次生成'}).count()).toBe(0);
  expect(page.url()).toBe(h.address);
 },data);
});
