import { afterAll,beforeAll,expect,it } from 'vitest';
import { harness,mounted,queries } from './p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();});afterAll(async()=>{await h?.browser.close();await h?.server.close();});
it('opens ordinary audio controls without paid submission or auto track insertion',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'声音与字幕',exact:true}).click();
  await page.getByLabel('配音文案',{exact:true}).fill('测试台词');
  expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  await page.getByText('云端生成 · 明确批准后提交',{exact:true}).waitFor();
 });
});
it('retains unsaved voice text across panels and guards timeline navigation',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'声音与字幕',exact:true}).click();await page.getByLabel('配音文案',{exact:true}).fill('未保存文案');
  await page.getByRole('button',{name:'镜头与素材',exact:true}).click();await page.getByRole('button',{name:'声音与字幕',exact:true}).click();
  expect(await page.getByLabel('配音文案',{exact:true}).inputValue()).toBe('未保存文案');
  await page.getByLabel('当前时间线',{exact:true}).selectOption('timeline-b');await page.getByRole('dialog',{name:'保存当前剪辑',exact:true}).waitFor();
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();expect(await page.getByLabel('当前时间线',{exact:true}).inputValue()).toBe('timeline-a');
 });
});
it('text-only ASR remains pending timing and cannot silently become cues',async()=>{
 const data=queries();
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'声音与字幕',exact:true}).click();
  await page.getByRole('button',{name:'编辑转写 transcript r1',exact:true}).click();
  await page.getByText('待校时：没有可靠时间戳',{exact:true}).waitFor();
  expect(await page.getByRole('button',{name:'采用为字幕',exact:true}).isDisabled()).toBe(true);
  expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  await page.getByLabel('转写全文',{exact:true}).fill('待保存转写');
  await expect.poll(()=>page.evaluate(()=>{const calls=window.p4Fixture.bridgeCalls.filter(c=>c.kind==='setTimelineDraftState');return (calls.at(-1)?.payload as {dirty:boolean})?.dirty;})).toBe(true);
 },{...data,'audio.read':{voiceLines:[],takes:[],diagnostics:[],transcripts:[{id:'transcript',revision:1,text:'无时间戳文本',timing:'none',segments:[],source:null,sourceDurationTicks:null}]}});
});
it('plays a generated fixed audio take as audio, then requires explicit analysis before insertion',async()=>{
 const take={id:'take',lineId:'line',lineRevision:1,task:{taskId:'task'},output:{kind:'artifact',libraryId:'library',artifactId:'voice-take'}};
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'声音与字幕',exact:true}).click();
  await page.getByRole('button',{name:'分析并选择插入配音轨',exact:true}).waitFor();
  await expect.poll(()=>page.locator('.audio-workspace audio').count()).toBe(1);
  expect(await page.locator('.audio-workspace img').count()).toBe(0);
  expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  await page.getByRole('button',{name:'分析并选择插入配音轨',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.calls[0]?.kind)).toBe('media.inspect');
 },{...queries(),'audio.read':{voiceLines:[],takes:[take],transcripts:[],diagnostics:[]}});
});
