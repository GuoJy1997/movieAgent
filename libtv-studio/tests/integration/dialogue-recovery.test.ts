import { expect, it } from 'vitest';
import { setup } from './dialogue-production.test.ts';
import { value, execute } from '../fixtures/native-generation.ts';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const approval = { currency: 'CNY', allowanceMicros: 100000000, budgetLimitMicros: 2000000000, acknowledgeUnknown: true };

it('stops without new submissions and accumulates three human audition reviews across reopen', async () => {
  const s = await setup();
  const stoppedPlan = value(await execute(s.engine, 'dialogue.prepareProduction', { projectId: s.projectId, dialogueRefs: s.dialogueRefs, profileRef: s.profileRef, purpose: 'audition', auditionCase: 'calm', executionOwner: 'human', runId: 'stopped' }));
  value(await execute(s.engine, 'dialogue.stopProduction', { projectId: s.projectId, planId: stoppedPlan.planId, executionOwner: 'human' }));
  value(await s.engine.close());
  const reopened = await s.open();
  expect(await execute(reopened, 'dialogue.approveProduction', { planId: stoppedPlan.planId, approvedHash: stoppedPlan.approvedHash, executionOwner: 'human', runId: 'stopped', approval })).toMatchObject({ ok: false, error: { code: 'DIALOGUE_PRODUCTION_STOPPED' } });
  expect(s.requests).toHaveLength(0);

  // Native-reference audition requires applicable lipsync review. This storage
  // recovery fixture is separate from the genuine packaged media journey.
  const checks = { timbre: 'pass', accent: 'pass', dialogue: 'pass', lipsync: 'pass' } as const;
  for (const [index, emotion] of ['calm', 'excited', 'quiet'].entries()) {
    const plan = value(await execute(reopened, 'dialogue.prepareProduction', { projectId: s.projectId, dialogueRefs: s.dialogueRefs, profileRef: s.profileRef, purpose: 'audition', auditionCase: emotion, executionOwner: 'human', runId: `audition-${emotion}` }));
    const approved = value(await execute(reopened, 'dialogue.approveProduction', { planId: plan.planId, approvedHash: plan.approvedHash, executionOwner: 'human', runId: `audition-${emotion}`, approval }));
    const task = approved.tasks[0], item = plan.items[0], take = { libraryId: reopened.identity.libraryId, projectId: s.projectId, id: `take-${emotion}`, shotId: item.dialogue.shotRef.id, dialogueRef: { id: item.dialogue.id, revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, route: 'native-reference', origin: { kind: 'provider', task }, video: item.prepared.referenceAudio[0].ref, audio: null, sourceVideoHash: item.prepared.referenceAudio[0].hash, audioHash: null, reviewRevision: 0, createdAt: new Date().toISOString() };
    const fixtureDb = new DatabaseSync(join(s.root, 'library.sqlite'));
    fixtureDb.prepare("INSERT INTO dialogue_take(id,project_id,shot_id,dialogue_id,dialogue_revision,origin_kind,task_id,data_json,review_revision) VALUES(?,?,?,?,?,?,?,?,0)").run(take.id, take.projectId, take.shotId, item.dialogue.id, 1, 'provider', task.taskId, JSON.stringify(take));
    fixtureDb.close();
    const reviewResult = reopened.dialogueProduction.reviewTake({ projectId: s.projectId, takeId: take.id, expectedReviewRevision: 0, checks, notes: '人工确认' });
    expect(reviewResult, JSON.stringify(reviewResult)).toMatchObject({ ok: true });
    const review = value(reviewResult);
    expect(review.revision).toBe(1);
    const status = value(reopened.dialogueProduction.auditionStatus({ projectId: s.projectId, voiceRef: { id: 'voice', revision: 1 }, profileRef: s.profileRef, route: 'native-reference' }));
    expect(status.fingerprint).toBe(plan.items[0]!.auditionFingerprint);
    const evidenceDb = new DatabaseSync(join(s.root, 'library.sqlite'));
    expect(evidenceDb.prepare('SELECT count(*) n FROM voice_audition').get()?.n).toBe(index + 1);
    evidenceDb.close();
    expect(status.missing).toHaveLength(2 - index);
  }
  expect(value(reopened.dialogueProduction.auditionStatus({ projectId: s.projectId, voiceRef: { id: 'voice', revision: 1 }, profileRef: s.profileRef, route: 'native-reference' }))).toMatchObject({ allowed: true, missing: [] });
  expect(value(reopened.dialogueProduction.takes({ projectId: s.projectId, shotId: 'shot-0' })).reviews).toHaveLength(3);
});
