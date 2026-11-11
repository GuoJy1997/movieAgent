import {afterAll,beforeAll,expect,it}from'vitest';
import{harness,mounted,calls,queries}from'./p4-harness.ts';
const task={libraryId:'library',taskId:'unknown-task',attemptId:'original-attempt',state:'RECONCILE_REQUIRED',providerState:'unknown',collectionState:'pending',providerTaskId:null,clientRequestId:'original-client',cancelRequested:false,cancelStatus:'none',reconcileStatus:'unsupported',estimateMicros:null,reportedActualMicros:null,reservationMicros:1000000,currency:'CNY',settlementStatus:'unknown',artifactRef:null,errorCode:null};
let h:Awaited<ReturnType<typeof harness>>;beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h?.browser.close();await h?.server.close();});
const data=(t:unknown=task)=>({...queries(),__taskDetail:true,'task.read':t,'workflow.list':{workflows:[]}});
it('requires risk acknowledgement before releasing the exact original attempt and then shows that billing remains unknown',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'解除并发占用',exact:true}).click();
  const confirm=page.getByRole('button',{name:'确认解除占用',exact:true});expect(await confirm.isDisabled()).toBe(true);expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
  await page.getByRole('checkbox',{name:'我了解原请求可能继续执行并产生费用'}).check();await confirm.click();await calls(page,1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toEqual({kind:'task.releaseUnknownSlot',payload:{taskId:'unknown-task',attemptId:'original-attempt',acknowledgeRisk:true}});
  await page.evaluate(task=>{window.p4Fixture.update({'task.read':{...task,concurrencyReleasedAt:1793449999000}});window.p4Fixture.resolve({...task,concurrencyReleasedAt:1793449999000});},task);
  await expect.poll(()=>page.getByText('已手动解除；原请求及账单仍待核实', {exact:true}).count()).toBe(1);
  expect(await page.getByRole('button',{name:'解除并发占用',exact:true}).count()).toBe(0);
 },data());
});
it('does not offer release for accepted work or an already released unknown',async()=>{
 for(const t of [{...task,providerState:'accepted',state:'RUNNING'},{...task,concurrencyReleasedAt:1793449999000}])await mounted(h,async page=>{expect(await page.getByRole('button',{name:'解除并发占用',exact:true}).count()).toBe(0);},data(t));
});

it('shows restored capacity occupancy when an accepted fact arrives after manual release',async()=>{
 await mounted(h,async page=>{
  await expect.poll(()=>page.getByText('原请求已获进展，重新计入并发；此前解除记录保留',{exact:true}).count()).toBe(1);
 },data({...task,providerState:'accepted',state:'RUNNING',concurrencyReleasedAt:1793449999000}));
});
