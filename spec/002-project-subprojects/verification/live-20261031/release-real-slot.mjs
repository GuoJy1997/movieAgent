export async function run(c){
 const{data:d,query,save,log,page,wait,fs,path}=c;
 d.slotRecovery??={startedAt:new Date().toISOString(),priorTasks:(await query('task.list')).tasks.map(x=>({taskId:x.taskId,attemptId:x.attemptId,state:x.state})),original:await query('task.read',{taskId:'ddf98a18-42ef-4a42-9fd6-8cbd04b9ad6f'})};await save();
 let task=await query('task.read',{taskId:d.slotRecovery.original.taskId});
 const connection=(await query('provider.list')).connections.filter(x=>x.id===d.textModel.connectionRef.id).sort((a,b)=>b.revision-a.revision)[0];if(connection.concurrency!==1)throw Error('MUST_KEEP_CONCURRENCY_ONE');
 await page.getByLabel('当前子项目').selectOption(d.a.id);await page.getByRole('button',{name:'任务',exact:true}).click();
 if(!task.concurrencyReleasedAt){
  await page.locator('.task-row').filter({hasText:'STALE_LEASE'}).getByRole('button',{name:'查看任务',exact:true}).click();
  await page.getByRole('button',{name:'解除并发占用',exact:true}).click();
  if(!await page.getByRole('button',{name:'确认解除占用',exact:true}).isDisabled())throw Error('RISK_CONFIRMATION_MISSING');
  await page.getByRole('checkbox',{name:'我了解原请求可能继续执行并产生费用'}).check();
  await page.getByRole('button',{name:'确认解除占用',exact:true}).click();
  task=await wait('REAL_SLOT_RELEASE',()=>query('task.read',{taskId:task.taskId}),x=>!!x.concurrencyReleasedAt,15000);
 }
 if(task.providerState!=='unknown'||task.reservationMicros!==d.slotRecovery.original.reservationMicros)throw Error('UNKNOWN_OR_BUDGET_WAS_ERASED');
 d.slotRecovery.released=task;d.slotRecovery.connectionConcurrency=connection.concurrency;await save();
 const now=(await query('task.list')).tasks;if(now.length!==d.slotRecovery.priorTasks.length)throw Error('RELEASE_CREATED_PROVIDER_TASK');
 await page.screenshot({path:path.join(c.evidence,'../unknown-slot/released-real-task.png'),fullPage:true});
 log('REAL_UNKNOWN_SLOT_RELEASED',{taskId:task.taskId,releasedAt:task.concurrencyReleasedAt,providerState:task.providerState,reservationMicros:task.reservationMicros,concurrency:connection.concurrency,newProviderTasks:0});
}
