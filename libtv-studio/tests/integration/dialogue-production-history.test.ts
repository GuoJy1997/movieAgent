import { expect, it, onTestFinished } from 'vitest';
import { nativeFixture, value, execute } from '../fixtures/native-generation.ts';
import { parseDialogueProductionList, isDialogueProductionList } from '../../packages/contracts/src/dialogue-production.ts';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

it('strictly bounds history input and excludes full plans or foreign task references from summaries', () => {
  expect(parseDialogueProductionList({ projectId: 'p', shotId: 's', limit: 21 }).ok).toBe(false);
  expect(parseDialogueProductionList({ projectId: 'p', shotId: 's', plan: {} }).ok).toBe(false);
  expect(parseDialogueProductionList({ projectId: 'p', shotId: 's' }).ok).toBe(true);
  expect(isDialogueProductionList({ libraryId: 'l', projectId: 'p', shotId: 's', productions: [], nextBeforePlanId: null })).toBe(true);
  expect(isDialogueProductionList({ libraryId: 'l', projectId: 'p', shotId: 's', productions: [], nextBeforePlanId: null, plan: {} })).toBe(false);
  const summary = { planId: 'plan', state: 'prepared', purpose: 'audition', profileRef: { libraryId: 'l', id: 'profile', revision: 1 }, executionOwner: 'owner', runId: 'run', expiresAt: 1, tasks: [{ dialogueId: 'd', task: { libraryId: 'foreign', taskId: 't', attemptId: 'a' }, diagnostic: null }] };
  expect(isDialogueProductionList({ libraryId: 'l', projectId: 'p', shotId: 's', productions: [summary], nextBeforePlanId: null })).toBe(false);
});

it('pages only the project and shot matching the cursor, survives reopen, and does not write or submit', async () => {
  const s = await nativeFixture(), projectId = s.prepareInput().projectId, otherProject = value(await execute(s.engine, 'project.create', { name: 'Other' })).id;
  // Persisted plan fixtures exercise the public read boundary without a generation POST.
  const profileRef = s.prepareInput().profileRef;
  const prepared = value(await execute(s.engine, 'generation.prepare', s.prepareInput()));
  const fixtureDb = new DatabaseSync(join(s.root, 'library.sqlite'));
  onTestFinished(() => { try { fixtureDb.close(); } catch {} });
  const make = (planId: string, shotId: string, project = projectId) => ({ libraryId: s.engine.identity.libraryId, projectId: project, planId, approvedHash: 'a'.repeat(64), expiresAt: Date.now() + 600000, route: 'native-reference', profileRef, purpose: 'audition', auditionCase: 'calm', exception: null, executionOwner: 'original-owner', runId: planId, items: [{ dialogue: { libraryId: s.engine.identity.libraryId, projectId: project, id: `d-${shotId}`, revision: 1, createdAt: new Date().toISOString(), shotRef: { id: shotId, revision: 1 }, turns: [{ turnId: 't', characterRef: { id: 'c', revision: 1 }, voiceRef: { id: 'v', revision: 1 }, text: '测试', emotion: 'calm', startTicks: 0, durationTicks: 48000, mode: 'native-reference' }] }, prepared, auditionFingerprint: 'b'.repeat(64), pairKey: null }], estimateMicros: null, currency: null });
  for (const [id, shot, project] of [['one', 'shot', projectId], ['two', 'shot', projectId], ['other-shot', 'different', projectId], ['foreign', 'shot', otherProject]]) {
    const plan = make(id!, shot!, project!);
    fixtureDb.prepare('INSERT INTO dialogue_production_plan VALUES(?,?,?,?,?,?,?,?)').run(id!, project!, plan.approvedHash, plan.executionOwner, plan.runId, plan.expiresAt, 'prepared', JSON.stringify(plan));
  }
  const query = (engine: typeof s.engine, payload: unknown) => engine.commands.query({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'test', queryId: crypto.randomUUID(), kind: 'dialogue.productions', payload });
  const before = fixtureDb.prepare('PRAGMA data_version').get()!.data_version;
  const first = value(await query(s.engine, { projectId, shotId: 'shot', limit: 1 }));
  expect(first.productions.map((item: { planId: string }) => item.planId)).toEqual(['two']);
  expect(first.productions[0]).toMatchObject({ executionOwner: 'original-owner', runId: 'two' });
  expect(first.productions[0]).not.toHaveProperty('plan');
  expect(value(await query(s.engine, { projectId, shotId: 'shot', limit: 1, beforePlanId: first.nextBeforePlanId })).productions[0].planId).toBe('one');
  expect(await query(s.engine, { projectId, shotId: 'shot', beforePlanId: 'foreign' })).toMatchObject({ ok: false, error: { code: 'INVALID_CURSOR' } });
  expect(await query(s.engine, { projectId, shotId: 'shot', beforePlanId: 'other-shot' })).toMatchObject({ ok: false, error: { code: 'INVALID_CURSOR' } });
  expect(value(await query(s.engine, { projectId: otherProject, shotId: 'shot' })).productions.map((item: { planId: string }) => item.planId)).toEqual(['foreign']);
  expect(fixtureDb.prepare('PRAGMA data_version').get()!.data_version).toBe(before);
  fixtureDb.close();
  await s.engine.close(); const reopened = await s.open();
  expect(value(await query(reopened, { projectId, shotId: 'shot', limit: 1 })).productions[0].planId).toBe('two');
  expect(s.requests).toHaveLength(0);
});
