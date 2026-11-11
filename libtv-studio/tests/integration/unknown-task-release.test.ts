import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {nativeFixture,value,execute} from '../fixtures/native-generation.ts';
import {snapshotDatabase} from '../../packages/storage/src/maintenance.ts';
const release=(s:any,t:any,extra={})=>execute(s.engine,'task.releaseUnknownSlot',{taskId:t.taskId,attemptId:t.attemptId,acknowledgeRisk:true,...extra});
async function unknown(){const s=await nativeFixture();s.cut();const{task}=await s.enqueue();value(await s.engine.scheduler.run(task.attemptId));expect(value(s.engine.generation.read(task.taskId))).toMatchObject({providerState:'unknown',reservationMicros:1000000});return{s,task};}
// Counting every unknown forever must not prevent unrelated, explicitly approved new work after manual release.
it('releases only the local slot, retains risk and original intent, lets new work run at concurrency one, and survives reopen',async()=>{
 const{s,task}=await unknown(),second=await s.enqueue();
 expect(await s.engine.scheduler.run(second.task.attemptId)).toMatchObject({ok:false,error:{code:'CONCURRENCY_LIMIT'}});
 expect(await release(s,task,{acknowledgeRisk:false})).toMatchObject({ok:false});
 const out=value(await release(s,task));expect(out).toMatchObject({providerState:'unknown',reservationMicros:1000000,settlementStatus:'unknown',reportedActualMicros:null});expect(out.concurrencyReleasedAt).toBeGreaterThan(0);
 expect(value(await release(s,task)).concurrencyReleasedAt).toBe(out.concurrencyReleasedAt);
 s.resume();s.response({choices:[{message:{role:'assistant',content:'new request completed'},finish_reason:'stop'}]});
 expect(value(await s.engine.scheduler.run(second.task.attemptId)).state).toBe('SUCCEEDED');expect(s.requests).toHaveLength(2);
 value(await execute(s.engine,'task.reconcile',{taskId:task.taskId}));expect(s.requests).toHaveLength(2);
 await s.engine.close();const reopened=await s.open();expect(value(reopened.generation.read(task.taskId))).toMatchObject({providerState:'unknown',concurrencyReleasedAt:out.concurrencyReleasedAt,reservationMicros:1000000});
 value(await reopened.scheduler.recover());expect(s.requests).toHaveLength(2);
 const db=new DatabaseSync(join(s.root,'library.sqlite'));expect(db.prepare('SELECT COUNT(*) n FROM unknown_task_release').get()?.n).toBe(1);
 const backup=join(s.root,'release-backup.sqlite');snapshotDatabase(db,backup);db.close();const copy=new DatabaseSync(backup,{readOnly:true});expect(copy.prepare('SELECT attempt_id FROM unknown_task_release').get()?.attempt_id).toBe(task.attemptId);copy.close();
},30000);
it('rejects a different attempt and non-unknown or actively leased tasks',async()=>{
 const{s,task}=await unknown();expect(await release(s,task,{attemptId:'different'})).toMatchObject({ok:false,error:{code:'TASK_ATTEMPT_CHANGED'}});
 const queued=await s.enqueue();expect(await release(s,queued.task)).toMatchObject({ok:false,error:{code:'TASK_NOT_UNKNOWN'}});
 const lease=value(s.engine.generation.claim(task.attemptId));expect(await release(s,task)).toMatchObject({ok:false,error:{code:'TASK_STILL_ACTIVE'}});s.engine.generation.release(task.attemptId,lease.leaseToken);
 value(await release(s,task));
});
it('counts a released unknown again when a late fact establishes that the provider accepted it',async()=>{
 const{s,task}=await unknown();value(await release(s,task));
 const lease=value(s.engine.generation.claim(task.attemptId));value(s.engine.generation.recordOutcome(task.attemptId,lease.leaseToken,{kind:'accepted',providerTaskId:'late-original'},'openai-chat-v1'));s.engine.generation.release(task.attemptId,lease.leaseToken);
 const next=await s.enqueue();expect(await s.engine.scheduler.run(next.task.attemptId)).toMatchObject({ok:false,error:{code:'CONCURRENCY_LIMIT'}});expect(s.requests).toHaveLength(1);
 expect(await release(s,task)).toMatchObject({ok:false,error:{code:'TASK_NOT_UNKNOWN'}});
});
it('rejects release from a sibling subproject scope',async()=>{
 const{s,task}=await unknown(),p=s.prepareInput().projectId,b=value(await execute(s.engine,'subproject.create',{projectId:p,title:'Sibling'}));
 expect(await s.engine.commands.execute({schemaVersion:1,libraryId:s.engine.identity.libraryId,connectionEpoch:'test',commandId:crypto.randomUUID(),kind:'task.releaseUnknownSlot',payload:{taskId:task.taskId,attemptId:task.attemptId,acknowledgeRisk:true},scope:{projectId:p,subprojectId:b.id}})).toMatchObject({ok:false,error:{code:'WRONG_SUBPROJECT'}});
});
it('migrates a schema26 unknown task without rewriting its frozen plan or current task JSON',async()=>{
 const{s,task}=await unknown();await s.engine.close();const db=new DatabaseSync(join(s.root,'library.sqlite'));
 db.exec('DROP TABLE IF EXISTS unknown_task_release; DELETE FROM migration_log WHERE version>=27; UPDATE library SET schema_version=26; PRAGMA user_version=26');
 const before=db.prepare('SELECT view_json FROM task_attempt WHERE task_id=?').get(task.taskId)?.view_json;db.close();const reopened=await s.open();
 expect(value(reopened.generation.read(task.taskId))).toMatchObject({providerState:'unknown'});
 const after=new DatabaseSync(join(s.root,'library.sqlite'));expect(after.prepare('SELECT view_json FROM task_attempt WHERE task_id=?').get(task.taskId)?.view_json).toBe(before);expect(after.prepare('SELECT COUNT(*) n FROM unknown_task_release').get()?.n).toBe(0);expect(after.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);after.close();expect(s.requests).toHaveLength(1);
});
