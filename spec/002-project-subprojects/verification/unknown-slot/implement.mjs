import fs from'node:fs';import path from'node:path';
const root='D:/movieAgent/libtv-studio',e='D:/movieAgent/spec/002-project-subprojects/verification/unknown-slot';
const files=['packages/contracts/src/generation.ts','packages/contracts/src/commands.ts','packages/contracts/src/schema.ts','packages/storage/src/database.ts','packages/engine/src/generation-service.ts','packages/engine/src/command-router.ts','apps/desktop/src/renderer/features/tasks/TaskDetail.tsx','apps/desktop/src/renderer/features/tasks/TaskPanel.tsx','tests/fixtures/p4-renderer/main.tsx','tests/integration/subproject-migration-fixture.ts'];
for(const f of files){const to=path.join(e,'before',f);fs.mkdirSync(path.dirname(to),{recursive:true});if(!fs.existsSync(to))fs.copyFileSync(path.join(root,f),to);}
function edit(file,fn){const p=path.join(root,file),old=fs.readFileSync(p,'utf8');const rep=(s,a,b)=>{if(!s.includes(a))throw Error(file+' MISSING '+a.slice(0,70));return s.replace(a,b)};fs.writeFileSync(p,fn(old,rep));}
edit('packages/contracts/src/schema.ts',s=>s.replace('CURRENT_SCHEMA_VERSION = 26','CURRENT_SCHEMA_VERSION = 27'));
edit('packages/storage/src/database.ts',(s,r)=>r(r(s,"import {migrateSubprojects} from './migrations/0026-subprojects.ts';","import {migrateSubprojects} from './migrations/0026-subprojects.ts';\nimport {migrateUnknownTaskRelease} from './migrations/0027-unknown-task-release.ts';"),'        migrateSubprojects(staged);','        migrateSubprojects(staged);\n        migrateUnknownTaskRelease(staged);'));
fs.writeFileSync(path.join(root,'packages/storage/src/migrations/0027-unknown-task-release.ts'),`import type {DatabaseSync} from 'node:sqlite';
/** A local scheduling decision, never a provider completion or billing fact. */
export function migrateUnknownTaskRelease(db:DatabaseSync):void{
 if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>=27)return;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('CREATE TABLE unknown_task_release(task_id TEXT PRIMARY KEY REFERENCES generation_task(task_id),attempt_id TEXT NOT NULL UNIQUE REFERENCES task_attempt(attempt_id),released_at INTEGER NOT NULL CHECK(released_at>0)) STRICT');
  db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(27,?)').run(new Date().toISOString());
  db.exec('UPDATE library SET schema_version=27; PRAGMA user_version=27; COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
`);
edit('packages/contracts/src/generation.ts',(s,r)=>{
 s=r(s,'export interface TaskView extends TaskRef {','export interface TaskView extends TaskRef { concurrencyReleasedAt?: number;');
 s=r(s,'export interface TaskInput { taskId: string }','export interface TaskInput { taskId: string }\nexport interface ReleaseUnknownTaskInput extends TaskInput { attemptId: string; acknowledgeRisk: true }\nexport function parseReleaseUnknownTask(v:unknown):Result<ReleaseUnknownTaskInput>{return isRecord(v)&&exact(v,[\'taskId\',\'attemptId\',\'acknowledgeRisk\'])&&id(v.taskId)&&id(v.attemptId)&&v.acknowledgeRisk===true?ok({taskId:v.taskId,attemptId:v.attemptId,acknowledgeRisk:true}):fail(\'UNKNOWN_RISK_NOT_ACKNOWLEDGED\',\'请确认原请求可能继续执行并产生费用；解除仅影响本机并发，不会退款或重新生成。\');}');
 s=r(s,"exact(v, ['libraryId','taskId','attemptId','state'","(v.concurrencyReleasedAt===undefined||Number.isSafeInteger(v.concurrencyReleasedAt)&&Number(v.concurrencyReleasedAt)>0) && exact(v, [...(v.concurrencyReleasedAt===undefined?[]:['concurrencyReleasedAt']),'libraryId','taskId','attemptId','state'");return s;
});
edit('packages/contracts/src/commands.ts',(s,r)=>{
 s=r(s,'parsePrepareGeneration, parseApproveGeneration, parseTaskInput,','parseReleaseUnknownTask, type ReleaseUnknownTaskInput, parsePrepareGeneration, parseApproveGeneration, parseTaskInput,');
 s=r(s,"  'task.reconcile': { input: TaskInput; output: TaskView };","  'task.releaseUnknownSlot': { input: ReleaseUnknownTaskInput; output: TaskView };\n  'task.reconcile': { input: TaskInput; output: TaskView };");
 s=r(s,"  'task.reconcile': { parse: parseTaskInput, isOutput: isTaskView },","  'task.releaseUnknownSlot': { parse: parseReleaseUnknownTask, isOutput: isTaskView },\n  'task.reconcile': { parse: parseTaskInput, isOutput: isTaskView },");return s;
});
edit('packages/engine/src/command-router.ts',(s,r)=>r(r(s,"    'task.reconcile': payload => generation.read","    'task.releaseUnknownSlot': payload => generation.releaseUnknownSlot(payload as CommandEnvelope<'task.releaseUnknownSlot'>['payload']),\n    'task.reconcile': payload => generation.read"),"'task.requestCancel': 'task.changed',","'task.releaseUnknownSlot':'task.changed', 'task.requestCancel': 'task.changed',"));
edit('packages/engine/src/generation-service.ts',(s,r)=>{
 s=r(s,'type ApproveGenerationInput, type DispatchPermit,','type ReleaseUnknownTaskInput, type ApproveGenerationInput, type DispatchPermit,');
 s=r(s,"    const task: unknown = JSON.parse(row.view_json as string); return isTaskView(task) && task.libraryId === library.libraryId ? ok(task) : fail('INVALID_STORED_DATA', '任务数据无效。');",`    const task: unknown = JSON.parse(row.view_json as string);
    if(!isTaskView(task)||task.libraryId!==library.libraryId)return fail('INVALID_STORED_DATA','任务数据无效。');
    const released=library.db.prepare('SELECT released_at FROM unknown_task_release WHERE task_id=? AND attempt_id=?').get(task.taskId,task.attemptId);
    const {concurrencyReleasedAt:_old,...base}=task;
    return ok({...base,...(released?{concurrencyReleasedAt:Number(released.released_at)}:{})});`);
 s=r(s,"SELECT view_json,plan_json FROM task_attempt JOIN generation_task USING(task_id) JOIN generation_prepared USING(prepared_id) WHERE attempt_id<>?","SELECT view_json,plan_json,released_at FROM task_attempt JOIN generation_task USING(task_id) JOIN generation_prepared USING(prepared_id) LEFT JOIN unknown_task_release USING(task_id) WHERE task_attempt.attempt_id<>?");
 s=r(s,"return plan.config.connection.id === connection.id && ['submitting','accepted','unknown'].includes(other.providerState);","return plan.config.connection.id === connection.id && ['submitting','accepted','unknown'].includes(other.providerState) && !(other.providerState==='unknown'&&r.released_at!==null);");
 s=r(s,'    checkCurrent: current, waitingReservations,',`    releaseUnknownSlot(input:ReleaseUnknownTaskInput):Result<TaskView>{
      const task=read(input.taskId);if(!task.ok)return task;
      if(input.acknowledgeRisk!==true)return fail('UNKNOWN_RISK_NOT_ACKNOWLEDGED','请确认原请求及费用仍未知。');
      if(task.value.attemptId!==input.attemptId)return fail('TASK_ATTEMPT_CHANGED','任务尝试已变化，请刷新后再处理。');
      if(task.value.providerState!=='unknown')return fail('TASK_NOT_UNKNOWN','只能解除结果未知任务的本机并发占用。');
      const lease=library.db.prepare('SELECT expires_at FROM task_lease WHERE attempt_id=?').get(input.attemptId);
      if(lease&&Number(lease.expires_at)>now())return fail('TASK_STILL_ACTIVE','仍有工作者处理原请求，请等待当前操作结束。');
      if(!task.value.concurrencyReleasedAt){
        library.db.prepare('INSERT INTO unknown_task_release(task_id,attempt_id,released_at) VALUES(?,?,?)').run(input.taskId,input.attemptId,now());
        const prepared=preparedFor(input.attemptId);if(!prepared.ok)return prepared;
        library.db.prepare("UPDATE scheduler_job SET next_run_at=? WHERE attempt_id IN (SELECT a.attempt_id FROM task_attempt a JOIN generation_task USING(task_id) JOIN generation_prepared USING(prepared_id) WHERE json_extract(a.view_json,'$.providerState')='unsubmitted' AND json_extract(plan_json,'$.config.connection.id')=?)").run(now(),prepared.value.config.connection.id);
      }
      return read(input.taskId);
    },
    checkCurrent: current, waitingReservations,`);
 s=r(s,"const tasks = library.db.prepare('SELECT view_json FROM task_attempt ORDER BY rowid').all().map(r => JSON.parse(r.view_json as string));","const tasks = library.db.prepare('SELECT task_id FROM task_attempt ORDER BY rowid').all().map(r => {const task=read(String(r.task_id));if(!task.ok)throw Error(task.error.code);return task.value;});");
 return s;
});
edit('tests/integration/subproject-migration-fixture.ts',(s,r)=>r(s,"['subproject_completion_head'","['unknown_task_release','subproject_completion_head'"));
console.log('Engine/contracts/migration changes written with individual backups');
