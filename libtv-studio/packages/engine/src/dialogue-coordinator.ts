import { randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { generationFor } from './generation-service.ts';
import type { assetsFor } from './asset-service.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { DialogueProductionPlan, DialogueTake } from '../../contracts/src/dialogue-production.ts';
import type { MediaRuntime } from '../../contracts/src/media-info.ts';
import { workflowCoordinator } from './workflow-scheduler.ts';
import {dialogueMediaVerifier} from './dialogue-media-verifier.ts';
import {mediaWorkQueue} from './media/work-queue.ts';

export function dialogueCoordinatorFor(library: LibraryHandle, generation: ReturnType<typeof generationFor>, assets: ReturnType<typeof assetsFor>, runtime?: MediaRuntime, sharedVerifier?:ReturnType<typeof dialogueMediaVerifier>) {
  const db = library.db;
  const ownedQueue=sharedVerifier?undefined:mediaWorkQueue(),verifyRepair=sharedVerifier??dialogueMediaVerifier(library,assets,ownedQueue!,runtime);
  async function harvest(stopping: () => boolean): Promise<Result<void>> {
    const owner = library.checkOwnership(); if (!owner.ok) return owner;
    const rows = db.prepare('SELECT i.*,p.plan_json FROM dialogue_production_item i JOIN dialogue_production_plan p ON p.plan_id=i.plan_id WHERE i.task_id IS NOT NULL ORDER BY i.rowid').all();
    for (const row of rows) {
      if (stopping()) break;
      if (db.prepare('SELECT 1 FROM dialogue_take WHERE task_id=?').get(row.task_id as string)) continue;
      const task = generation.read(row.task_id as string); if (!task.ok) { db.prepare('UPDATE dialogue_production_item SET diagnostic=? WHERE plan_id=? AND dialogue_id=?').run(task.error.code, row.plan_id as string, row.dialogue_id as string); continue; }
      if (task.value.state === 'FAILED' || task.value.state === 'CANCELLED' || task.value.state === 'SUBMISSION_UNKNOWN') { db.prepare('UPDATE dialogue_production_item SET diagnostic=? WHERE plan_id=? AND dialogue_id=?').run(task.value.errorCode ?? task.value.state, row.plan_id as string, row.dialogue_id as string); continue; }
      if (task.value.state !== 'SUCCEEDED' || !task.value.artifactRef) continue;
      const plan = JSON.parse(row.plan_json as string) as DialogueProductionPlan;
      const item = plan.items.find(value => value.dialogue.id === row.dialogue_id as string); if (!item) { db.prepare('UPDATE dialogue_production_item SET diagnostic=? WHERE plan_id=? AND dialogue_id=?').run('DIALOGUE_PLAN_ITEM_MISSING', row.plan_id as string, row.dialogue_id as string); continue; }
      const metadata = assets.metadata(task.value.artifactRef);
      if (!metadata.ok) { db.prepare('UPDATE dialogue_production_item SET diagnostic=? WHERE plan_id=? AND dialogue_id=?').run(metadata.error.code, row.plan_id as string, row.dialogue_id as string); continue; }
      {
        const target=item.prepared.lipSyncVideo;
        const verified = await verifyRepair(task.value.artifactRef, metadata.value.hash, target?.durationTicks??Number(item.prepared.config.parameters.duration)*48000,!target,target?{probeId:target.probeId,hash:target.hash}:undefined);
        if (!verified.ok) { db.prepare('UPDATE dialogue_production_item SET diagnostic=? WHERE plan_id=? AND dialogue_id=?').run(verified.error.code, row.plan_id as string, row.dialogue_id as string); continue; }
      }
      if(stopping())break;
      const take: DialogueTake = { libraryId: library.libraryId, projectId: plan.projectId, id: randomUUID(), shotId: item.dialogue.shotRef.id, dialogueRef: { id: item.dialogue.id, revision: item.dialogue.revision }, voiceRef: item.dialogue.turns[0]!.voiceRef, route: plan.route, origin: { kind: 'provider', task: { libraryId: library.libraryId, taskId: task.value.taskId, attemptId: task.value.attemptId } }, video: task.value.artifactRef, audio: item.prepared.lipSyncAudio?.ref ?? null, sourceVideoHash: item.prepared.lipSyncVideo?.hash ?? metadata.value.hash, audioHash: item.prepared.lipSyncAudio?.hash ?? null, reviewRevision: 0, createdAt: new Date().toISOString() };
      try {
        db.exec('BEGIN IMMEDIATE');
        db.prepare('INSERT INTO dialogue_take(id,project_id,shot_id,dialogue_id,dialogue_revision,origin_kind,task_id,data_json,review_revision) VALUES(?,?,?,?,?,?,?,?,0)').run(take.id, take.projectId, take.shotId, item.dialogue.id, item.dialogue.revision, 'provider', task.value.taskId, JSON.stringify(take));
        db.prepare("INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,'dialogueProduction.changed',?)").run(library.libraryId, JSON.stringify(take));
        db.exec('COMMIT');
      } catch { if (db.isTransaction) db.exec('ROLLBACK'); return fail('DIALOGUE_TAKE_PUBLISH_FAILED', '对白产物尚未收存，请重试现有任务收存。'); }
    }
    return ok(undefined);
  }
  const coordinator=workflowCoordinator(harvest);
  return {...coordinator,async close(){const closed=ownedQueue?.close();await coordinator.close();await closed;}};
}
