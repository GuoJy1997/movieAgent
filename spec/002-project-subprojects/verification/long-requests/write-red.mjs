import fs from'node:fs';import path from'node:path';const root='D:/movieAgent/libtv-studio',base='D:/movieAgent/spec/002-project-subprojects/verification/long-requests';fs.mkdirSync(base,{recursive:true});
const write=(p,s)=>{const f=path.join(root,p),back=path.join(base,'before',p);if(fs.existsSync(f)&&!fs.existsSync(back)){fs.mkdirSync(path.dirname(back),{recursive:true});fs.copyFileSync(f,back)}fs.writeFileSync(f,s)};
let s=fs.readFileSync(path.join(root,'tests/integration/generation-recovery.test.ts'),'utf8').replace("afterEach, expect, it }","afterEach, expect, it, vi }");
s+=`
it('keeps a ten-minute lease alive across a long submit without duplicate POSTs',async()=>{
 const s=await setup(),start=Date.now();s.setNow(start);const task=await s.enqueue();s.server.hold();s.server.setMode('completed');
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 const pending=s.engine.scheduler.run(task.attemptId);let result;
 try{
  await expect.poll(()=>s.server.posts).toBe(1);
  for(let elapsed=30000;elapsed<=720000;elapsed+=30000){s.setNow(start+elapsed);await vi.advanceTimersByTimeAsync(30000);}
 }finally{s.server.release();result=await pending;vi.useRealTimers();}
 expect(result).toMatchObject({ok:true,value:{state:'SUCCEEDED',collectionState:'durable'}});
 expect(s.server.posts).toBe(1);
});
it('keeps the original accepted job lease alive across a long reconcile GET',async()=>{
 const s=await setup(),start=Date.now();s.setNow(start);const task=await s.enqueue();value(await s.engine.scheduler.run(task.attemptId));s.supportReconcile();s.server.hold();s.server.setMode('completed');
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 const pending=s.engine.generation.reconcile(task.taskId);let result;
 try{await expect.poll(()=>s.server.gets).toBe(1);for(let elapsed=30000;elapsed<=720000;elapsed+=30000){s.setNow(start+elapsed);await vi.advanceTimersByTimeAsync(30000);}}
 finally{s.server.release();result=await pending;vi.useRealTimers();}
 expect(result).toMatchObject({ok:true,value:{state:'SUCCEEDED'}});expect(s.server.posts).toBe(1);expect(s.server.gets).toBe(1);
});
it('does not renew or publish after a different worker fences a long submit',async()=>{
 const s=await setup(),start=Date.now();s.setNow(start);const task=await s.enqueue();s.server.hold();s.server.setMode('completed');
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});const pending=s.engine.scheduler.run(task.attemptId);const db=new DatabaseSync(join(s.root,'library.sqlite'));let result;
 try{await expect.poll(()=>s.server.posts).toBe(1);db.prepare("UPDATE task_lease SET token=token+1,owner='new-worker',expires_at=? WHERE attempt_id=?").run(start+900000,task.attemptId);s.setNow(start+30000);await vi.advanceTimersByTimeAsync(30000);}
 finally{s.server.release();result=await pending;vi.useRealTimers();}
 try{expect(result).toMatchObject({ok:false,error:{code:'STALE_LEASE'}});expect(db.prepare('SELECT owner,expires_at FROM task_lease WHERE attempt_id=?').get(task.attemptId)).toMatchObject({owner:'new-worker',expires_at:start+900000});expect(db.prepare('SELECT applied FROM generation_fact WHERE attempt_id=?').get(task.attemptId)).toMatchObject({applied:0});expect(s.server.posts).toBe(1);}finally{db.close();}
});
it('grants ten minutes initially but never revives an expired worker lease',async()=>{
 const s=await setup(),start=Date.now();s.setNow(start);const task=await s.enqueue(),lease=value(s.engine.generation.claim(task.attemptId));
 const db=new DatabaseSync(join(s.root,'library.sqlite'));try{expect(db.prepare('SELECT expires_at FROM task_lease WHERE attempt_id=?').get(task.attemptId)).toMatchObject({expires_at:start+600000});}finally{db.close();}
 s.setNow(start+600001);expect(s.engine.generation.renewLease(task.attemptId,lease.leaseToken)).toMatchObject({ok:false,error:{code:'STALE_LEASE'}});
});
`;write('tests/integration/generation-recovery.test.ts',s);
s=fs.readFileSync(path.join(root,'tests/integration/model-config-file.test.ts'),'utf8');
s+=`
it('imports and upgrades text connections to a five-minute timeout without rewriting older snapshots',async()=>{
 const s=await setup(),loaded=await file(join(s.path,'models.json'),[{...provider,id:'text-long',kind:'text',modelId:'text-model'}]);if(!loaded.ok)throw Error('fixture config');
 expect((await importModelConfig({...s,config:loaded.value})).ok).toBe(true);
 const current=()=>{const r=s.engine.commands.query({schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'fixture',queryId:'long-timeout',kind:'provider.list',payload:{}});if(!r.ok)throw Error('connections');return r.value.connections.filter(x=>x.id==='file-text-long-connection');};
 const imported=current().at(-1)!;expect(imported.timeoutMs).toBe(300000);
 const {libraryId,createdAt,revision,...fields}=imported;
 expect((await s.engine.commands.execute({schemaVersion:1,libraryId,connectionEpoch:'fixture',commandId:'legacy-short-timeout',kind:'provider.saveConnection',payload:{...fields,timeoutMs:60000,expectedRevision:revision}})).ok).toBe(true);
 expect((await importModelConfig({...s,config:loaded.value})).ok).toBe(true);
 expect(current().at(-1)!.timeoutMs).toBe(300000);expect(current().find(x=>x.revision===revision+1)!.timeoutMs).toBe(60000);
 const count=current().length;expect((await importModelConfig({...s,config:loaded.value})).ok).toBe(true);expect(current()).toHaveLength(count);expect(s.engine.generation.list().tasks).toHaveLength(0);
});
`;write('tests/integration/model-config-file.test.ts',s);console.log('Five regression cases saved before production changes.');

