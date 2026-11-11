import { afterAll, beforeAll, expect, it } from 'vitest';
import { harness, mounted, queries } from './p4-harness.ts';
import { dialogueData, openDialogue, voice, dialogue } from './voice-fixtures.ts';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.browser.close(); await h?.server.close(); });

it('binds dialogue to the exact character and voice revision among three characters', async () => {
  const entities = ['a', 'b', 'c'].map((id) => ({ id, revision: 1, kind: 'character', name: `角色 ${id.toUpperCase()}`, description: '', constraints: '', references: [] }));
  const data = {
    ...queries(), __creation: true,
    'creation.read': {
      scripts: [{ id: 'script', revision: 1, title: '剧本', scenes: [{ id: 'scene', title: '场景', location: '', time: '', description: '' }] }],
      shots: [{ id: 'shot', revision: 1, scriptId: 'script', sceneId: 'scene', order: 0, title: '开门', durationSeconds: 4, shotSize: '', cameraMovement: '', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }], selections: [], entities,
    },
    'voice.list': { voices: entities.map((entity) => ({ id: `voice-${entity.id}`, revision: 1, entityRef: { id: entity.id, revision: 1 }, name: `声音 ${entity.id}`, dialect: '', performanceNotes: '', production: { ready: true, reason: null }, reference: { ref: { kind: 'assetVersion', libraryId: 'library', assetId: 'shared-audio', version: 1 }, hash: 'a'.repeat(64), probeId: 'probe', sourceInTicks: 0, durationTicks: 96000 } })) },
    'dialogue.read': { current: null, revisions: [], issues: [] },
  };
  await mounted(h, async page => {
    await page.getByRole('button', { name: '编辑镜头 开门', exact: true }).click();
    await page.getByRole('button', { name: '对白制作', exact: true }).click();
    await page.getByLabel('角色声音 1', { exact: true }).selectOption('voice-b:1');
    await page.getByLabel('台词 1', { exact: true }).fill('轮到 B 说话');
    await page.getByRole('button', { name: '保存结构化对白', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'dialogue.save', payload: { id: expect.any(String), expectedRevision: 0, draft: { turns: [{ characterRef: { id: 'b', revision: 1 }, voiceRef: { id: 'voice-b', revision: 1 }, text: '轮到 B 说话', mode: 'native-reference' }] } } });
  }, data);
});

it('ignores the old project save receipt after a scope switch', async () => {
  const data = dialogueData();
  await mounted(h, async page => {
    await openDialogue(page);
    await page.getByLabel('台词 1', { exact: true }).fill('旧项目保存 A');
    await page.getByRole('button', { name: '保存结构化对白', exact: true }).click();
    await page.evaluate(async creation => { window.p4Fixture.update({ 'creation.read': { ...creation, projectId: 'project-b' } }); await window.p4Fixture.switchProject('project-b'); }, data['creation.read'] as Record<string, unknown>);
    await openDialogue(page);
    await page.getByLabel('台词 1', { exact: true }).fill('新项目编辑 B');
    await page.evaluate(value => window.p4Fixture.resolve({ ...value, revision: 2 }), dialogue);
    await expect.poll(() => page.getByLabel('台词 1', { exact: true }).inputValue()).toBe('新项目编辑 B');
    await page.getByRole('button', { name: '保存结构化对白', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[1])).toMatchObject({ kind: 'dialogue.save', payload: { projectId: 'project-b', expectedRevision: 1, draft: { turns: [{ text: '新项目编辑 B' }] } } });
  }, data);
});

it('preserves unsaved dialogue when the voice query refreshes', async () => {
  await mounted(h, async page => {
    await openDialogue(page);
    await page.getByLabel('台词 1', { exact: true }).fill('未保存的新台词');
    await page.evaluate(voice => window.p4Fixture.update({ 'voice.list': { voices: [voice, { ...voice, id: 'voice-b', name: '声音 B' }] } }), voice);
    await expect.poll(() => page.getByLabel('台词 1', { exact: true }).inputValue()).toBe('未保存的新台词');
  }, dialogueData());
});

it('recovers the scoped original batch after reopen without submitting and reconciles only on an explicit click', async () => {
  const data = dialogueData();
  data['dialogue.productions'] = { productions: [{ planId: 'recovered', state: 'approved', purpose: 'production', profileRef: { id: 'sync', revision: 1 }, executionOwner: 'original-owner', runId: 'original-run', expiresAt: Date.now(), tasks: [{ dialogueId: 'dialogue', task: { taskId: 'unknown-task' }, diagnostic: 'SUBMISSION_UNKNOWN' }] }], nextBeforePlanId: null };
  data['dialogue.production'] = { plan: { planId: 'recovered', items: [{ dialogue, prepared: { adapterId: 'sync-lipsync-v2' } }] }, tasks: [{ dialogueId: 'dialogue', task: { taskId: 'unknown-task' }, diagnostic: 'SUBMISSION_UNKNOWN' }], state: 'approved' };
  data['task.list'] = { tasks: [{ taskId: 'unknown-task', state: 'SUBMISSION_UNKNOWN', cancelStatus: 'unsupported' }] };
  await mounted(h, async page => {
    await openDialogue(page);
    await page.getByText('原批次历史与恢复', { exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls)).toEqual([]);
    await page.getByRole('button', { name: '查看批次 recovered', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls)).toEqual([]);
    await page.getByRole('button', { name: '核对原提交 unknown-task', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'dialogue.reconcileSubmission', payload: { projectId: 'project', taskId: 'unknown-task', executionOwner: 'original-owner' } });
  }, data);
});

it('acknowledges save A without overwriting edit B and saves B against the new revision', async () => {
  await mounted(h, async page => {
    await openDialogue(page);
    await page.getByLabel('台词 1', { exact: true }).fill('保存 A');
    await page.getByRole('button', { name: '保存结构化对白', exact: true }).click();
    await page.getByLabel('台词 1', { exact: true }).fill('继续编辑 B');
    await page.evaluate(value => window.p4Fixture.resolve({ ...value, revision: 2, turns: [{ ...value.turns[0], text: '保存 A' }] }), dialogue);
    await expect.poll(() => page.getByLabel('台词 1', { exact: true }).inputValue()).toBe('继续编辑 B');
    await page.getByRole('button', { name: '保存结构化对白', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[1])).toMatchObject({ kind: 'dialogue.save', payload: { expectedRevision: 2, draft: { turns: [{ text: '继续编辑 B' }] } } });
  }, dialogueData());
});
