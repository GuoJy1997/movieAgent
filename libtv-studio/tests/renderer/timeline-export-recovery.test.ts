import{afterAll,beforeAll,expect,it}from'vitest';
import{harness,mounted,queries}from'./p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();});afterAll(async()=>{await h?.browser.close();await h?.server.close();});
it('shows uncertain export acknowledgements and retries only the same request',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'导出',exact:true}).click();
  await page.getByLabel('导出格式').selectOption('sources');
  await page.evaluate(()=>window.p4Fixture.setExport({ok:false,error:{code:'ENGINE_REQUEST_TIMEOUT',message:'引擎响应超时'}}));
  await page.getByRole('button',{name:'复制到短剧目录',exact:true}).click();
  await page.getByText('结果待核对',{exact:false}).waitFor();
  const first=await page.evaluate(()=>window.p4Fixture.bridgeCalls.find(c=>c.kind==='exportTimeline')!.payload);
  await page.getByRole('button',{name:'仅重试复制',exact:true}).click();
  const all=await page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='exportTimeline'));
  expect(all).toHaveLength(2);expect(all[1]!.payload).toEqual(first);
  expect(await page.evaluate(()=>window.p4Fixture.calls.filter(c=>c.kind==='render.enqueue'||c.kind==='generation.submit'))).toEqual([]);
 });
});

it('reopens an uncertain verified receipt and reconciles the original request without new rendering',async()=>{
 const receipt={requestId:'old-request',projectId:'project',timelineId:'timeline-a',revision:1,kind:'srt',state:'verified',byteLength:25,relativePath:'exports/subtitles/fixed.srt'};
 await mounted(h,async page=>{
  await page.evaluate(receipt=>window.p4Fixture.setExport({ok:true,value:{...receipt,state:'completed'}}),receipt);
  await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'核对并继续原导出',exact:true}).click();
  await page.getByText('导出完成',{exact:false}).waitFor();const calls=await page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='exportTimeline'));
  expect(calls).toHaveLength(1);expect(calls[0]!.payload).toEqual({requestId:receipt.requestId,projectId:receipt.projectId,timelineId:receipt.timelineId,revision:receipt.revision,kind:receipt.kind});expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
 },{...queries(),'timeline.exports':{exports:[receipt]}});
});
