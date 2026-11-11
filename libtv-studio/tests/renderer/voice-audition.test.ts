import { afterAll, beforeAll, expect, it } from 'vitest';
import { harness, mounted, queries } from './p4-harness.ts';
import { dialogue, dialogueData, openDialogue } from './voice-fixtures.ts';
import { resolve } from 'node:path';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.browser.close(); await h?.server.close(); });

const voice = { id: 'voice-a', revision: 1, entityRef: { id: 'a', revision: 1 }, name: '声音 A', dialect: '', performanceNotes: '', production: { ready: true, reason: null }, reference: { ref: { kind: 'assetVersion', libraryId: 'library', assetId: 'audio', version: 1 }, hash: 'a'.repeat(64), probeId: 'probe', sourceInTicks: 0, durationTicks: 96000 } };
const profile = { libraryId: 'library', id: 'h3', revision: 2, name: 'H3', modelRef: { libraryId: 'library', id: 'h3', revision: 2 }, parameters: {} };
const approvalPlan = (planId:string,currency:string,estimateMicros:number) => ({ purpose:'audition',route:'native-reference',auditionCase:'calm',planId,approvedHash:planId==='A'?'a'.repeat(64):'b'.repeat(64),expiresAt:Date.now()+600000,executionOwner:'desktop-user',runId:planId,estimateMicros,currency,profileRef:{id:'h3',revision:2},items:[{dialogue,prepared:{config:{model:{name:'H3 fixture',revision:2}}}}] });
function auditionData() { return {...dialogueData(),'profile.list':{profiles:[profile]},'model.list':{models:[{id:'h3',revision:2,capabilities:{taskTypes:['text_to_video'],inputKinds:['audio'],outputKinds:['video']}}]},'voice.auditionStatus':{allowed:true,missing:[],fingerprint:'a'.repeat(64)}}; }

for(const currency of ['CNY','USD']) it(`resets acknowledgement and monetary state for replacement ${currency} plan B`,async()=>{
  await mounted(h,async page=>{
    await openDialogue(page);await page.getByRole('button',{name:'试镜与审核',exact:true}).click();
    await page.getByRole('button',{name:'准备平静试镜',exact:true}).click();await page.evaluate(plan=>window.p4Fixture.resolve(plan),approvalPlan('A','CNY',100000));
    await page.getByLabel('本批风险额度（CNY）').fill('3');await page.getByLabel('项目预算上限（CNY）').fill('9');await page.getByLabel('我理解未知费用及云端不能取消的计费风险').check();
    await page.getByLabel('试镜情绪').selectOption('excited');await page.getByRole('button',{name:'准备激动试镜',exact:true}).click();await page.evaluate(plan=>window.p4Fixture.resolve(plan),approvalPlan('B',currency,2500000));
    await expect.poll(()=>page.getByLabel(`本批风险额度（${currency}）`).inputValue()).toBe('2.5');
    expect(await page.getByLabel(`项目预算上限（${currency}）`).inputValue()).toBe('25');
    expect(await page.getByLabel('我理解未知费用及云端不能取消的计费风险').isChecked()).toBe(false);
    expect(await page.getByRole('button',{name:'批准此试镜批次',exact:true}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>window.p4Fixture.calls)).toHaveLength(2);
  },auditionData());
});

it('ignores a preparation response after the selected audition intent changes',async()=>{
  await mounted(h,async page=>{
    await openDialogue(page);await page.getByRole('button',{name:'试镜与审核',exact:true}).click();
    await page.getByRole('button',{name:'准备平静试镜',exact:true}).click();
    await page.getByLabel('试镜情绪').selectOption('quiet');
    await page.evaluate(plan=>window.p4Fixture.resolve(plan),approvalPlan('A','CNY',100000));
    await expect.poll(()=>page.getByRole('button',{name:'准备低声试镜',exact:true}).isDisabled()).toBe(false);
    expect(await page.locator('.approval-summary').count()).toBe(0);
  },auditionData());
});

it('shows three-emotion evidence and an exact unapproved audition batch summary', async () => {
  const data = {
    ...queries(), __creation: true,
    'creation.read': { scripts: [{ id: 'script', revision: 1, title: '剧本', scenes: [{ id: 'scene', title: '场景', location: '', time: '', description: '' }] }], shots: [{ id: 'shot', revision: 1, scriptId: 'script', sceneId: 'scene', order: 0, title: '开门', durationSeconds: 4, shotSize: '', cameraMovement: '', subject: '', action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }], selections: [], entities: [] },
    'voice.list': { voices: [voice] }, 'profile.list': { profiles: [profile] }, 'model.list': { models: [{ id: 'h3', revision: 2, capabilities: { taskTypes: ['text_to_video', 'image_to_video'], inputKinds: ['text', 'image', 'audio'], outputKinds: ['video'] } }] },
    'dialogue.read': { current: { id: 'dialogue', revision: 1, shotRef: { id: 'shot', revision: 1 }, turns: [{ turnId: 'turn', characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice-a', revision: 1 }, text: '你好', emotion: 'calm', startTicks: 0, durationTicks: 48000, mode: 'native-reference' }] }, revisions: [], issues: [] },
    'voice.auditionStatus': { allowed: false, missing: ['calm', 'excited', 'quiet'], fingerprint: 'a'.repeat(64) },
  };
  await mounted(h, async page => {
    await page.getByRole('button', { name: '编辑镜头 开门', exact: true }).click();
    await page.getByRole('button', { name: '对白制作', exact: true }).click();
    await page.getByRole('button', { name: '试镜与审核', exact: true }).click();
    await page.getByText('待试镜：平静、激动、低声', { exact: true }).waitFor();
    await page.getByRole('button', { name: '准备平静试镜', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'dialogue.prepareProduction', payload: { purpose: 'audition', auditionCase: 'calm', dialogueRefs: [{ id: 'dialogue', revision: 1 }], profileRef: { id: 'h3', revision: 2 } } });
    await page.evaluate(() => window.p4Fixture.resolve({ purpose: 'audition', route: 'native-reference', auditionCase: 'calm', planId: 'plan', approvedHash: 'a'.repeat(64), expiresAt: Date.now() + 600000, executionOwner: 'desktop-user', runId: 'run', estimateMicros: 100000, currency: 'CNY', profileRef: { id: 'h3', revision: 2 }, items: [{ dialogue: { id: 'dialogue', revision: 1, shotRef: { id: 'shot', revision: 1 }, turns: [{ characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice-a', revision: 1 }, emotion: 'calm', mode: 'native-reference', text: '你好' }] }, prepared: { config: { model: { name: 'H3 fixture', revision: 2 } }, referenceAudio: [{ ref: { kind: 'assetVersion', libraryId: 'library', assetId: 'audio', version: 1 }, hash: 'a'.repeat(64), byteLength: 192044, durationTicks: 96000 }] } }] }));
    await page.getByText('本批 1 镜头 · 总估价 CNY 0.10 · 尚未批准', { exact: true }).waitFor();
    expect(await page.getByLabel('本批风险额度（CNY）').inputValue()).toBe('0.1');
    await page.getByLabel('本批风险额度（CNY）').fill('0.0000001');
    await page.getByLabel('我理解未知费用及云端不能取消的计费风险').check();
    expect(await page.getByRole('button', { name: '批准此试镜批次', exact: true }).isDisabled()).toBe(true);
    await page.getByLabel('本批风险额度（CNY）').fill('0.123456');
    await page.getByLabel('项目预算上限（CNY）').fill('2.5');
    await page.getByLabel('我理解未知费用及云端不能取消的计费风险').uncheck();
    await page.locator('.approval-summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve('.superpowers/sdd/2026-10-27-p4-audio-timeline/task-v6-approval-1100.png') });
    expect(await page.evaluate(() => window.p4Fixture.calls)).toHaveLength(1);
    await page.getByLabel('我理解未知费用及云端不能取消的计费风险').check();
    await page.evaluate(() => window.p4Fixture.update({ 'profile.list': { profiles: [] } }));
    expect(await page.getByRole('button', { name: '批准此试镜批次', exact: true }).isDisabled()).toBe(true);
    await page.getByText('配置已失效，请取消并重新准备。', { exact: true }).waitFor();
  }, data);
});

it('prepares formal production only with the explicitly selected capable profile and fixed dialogue revision', async () => {
  const data = dialogueData();
  data['profile.list'] = { profiles: [profile, { ...profile, id: 'second', name: 'Second H3' }] };
  data['model.list'] = { models: [{ id: 'h3', revision: 2, capabilities: { taskTypes: ['text_to_video'], inputKinds: ['text', 'image', 'audio'], outputKinds: ['video'] } }] };
  data['voice.auditionStatus'] = { allowed: true, missing: [], fingerprint: 'a'.repeat(64) };
  await mounted(h, async page => {
    await openDialogue(page);
    await page.getByRole('button', { name: '试镜与审核', exact: true }).click();
    await page.getByLabel('试镜预设').selectOption('second:2');
    await page.getByRole('button', { name: '准备正式对白制作', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'dialogue.prepareProduction', payload: { purpose: 'production', profileRef: { id: 'second', revision: 2 }, dialogueRefs: [{ id: 'dialogue', revision: 1 }] } });
    await page.evaluate(() => window.p4Fixture.resolve({ purpose: 'production', route: 'native-reference', planId: 'formal-plan', approvedHash: 'b'.repeat(64), expiresAt: Date.now() + 600000, executionOwner: 'desktop-user', runId: 'formal-run', estimateMicros: null, currency: null, profileRef: { id: 'second', revision: 2 }, items: [] }));
    await page.getByLabel('批准币种').fill('USD');
    await page.getByLabel('本批风险额度（USD）').fill('0.123456');
    await page.getByLabel('项目预算上限（USD）').fill('2.5');
    expect(await page.getByRole('button', { name: '批准此正式批次', exact: true }).isDisabled()).toBe(true);
    await page.getByLabel('我理解未知费用及云端不能取消的计费风险').check();
    await page.getByRole('button', { name: '批准此正式批次', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[1])).toMatchObject({ kind: 'dialogue.approveProduction', payload: { approval: { currency: 'USD', allowanceMicros: 123456, budgetLimitMicros: 2500000, acknowledgeUnknown: true } } });
  }, data);
});
