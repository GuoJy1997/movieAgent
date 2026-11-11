import { packageExecutable, isolatedModelConfig } from './support/product-launch.ts';
import { afterEach, expect, it } from 'vitest';
import { _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication | undefined;
let root: string | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; if (root) await rm(root, { recursive: true, force: true }); root = undefined; });
async function launch() {
  root = await mkdtemp(join(tmpdir(), 'movieagent-final-review-'));
  app = await _electron.launch({ executablePath: packageExecutable, args: [await isolatedModelConfig(root), `--library-root=${join(root, 'library')}`, `--user-data-dir=${join(root, 'profile')}`] });
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); return page;
}
it.each(['wake', 'utility reconnect'] as const)('retains content/layout drafts and original CAS across same-library %s', async action => {
  const page = await launch();
  await page.getByLabel('项目名称').fill('Draft recovery');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('button', { name: '打开 Draft recovery', exact: true }).click();
  await page.getByRole('button', { name: '添加文本', exact: true }).click();
  await page.getByLabel('文本内容').fill('UNSAVED_CONTENT');
  const node = page.locator('.react-flow__node').first();
  const box = await node.boundingBox(); if (!box) throw Error('node box');
  await page.mouse.move(box.x + 40, box.y + 18); await page.mouse.down();
  await page.mouse.move(box.x + 95, box.y + 60, { steps: 5 }); await page.mouse.up();
  const position = await node.evaluate(el => (el as HTMLElement).style.transform);
  const before = await page.evaluate(() => window.studio.describe()); if (!before.ok) throw Error('descriptor');
  await app!.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('studio:query');
    ipcMain.removeHandler('studio:query');
    ipcMain.handle('studio:query', async (event, input) => {
      const result = await original(event, input);
      if (input.kind === 'canvas.read' && result.ok) (globalThis as any).canvasEpoch = input.connectionEpoch;
      return result;
    });
  });
  // A second writer commits a newer field while the renderer retains its old CAS.
  expect(await page.evaluate(async () => {
    const d = await window.studio.describe(); const p = await window.studio.listProjects(); if (!d.ok || !p.ok) throw Error('identity');
    const s = await window.studio.query({ schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, queryId: 'canvas-before', kind: 'canvas.read', payload: { canvasId: p.value[0]!.id } }); if (!s.ok) throw Error('snapshot');
    const n = s.value.nodes[0]!;
    return window.studio.execute({ schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, commandId: 'other-writer', kind: 'canvas.applyCommand', payload: { canvasId: s.value.canvasId, baseRevision: s.value.revision, operations: [{ kind: 'setContent', nodeId: n.nodeId, incarnation: n.incarnation, expectedRevision: n.semanticRevision, content: { type: 'text', text: 'SERVER_V2' } }] } });
  })).toMatchObject({ ok: true });
  if (action === 'wake') await app!.evaluate(({ powerMonitor }) => { powerMonitor.emit('suspend'); powerMonitor.emit('resume'); });
  else {
    const pid = await app!.evaluate(({ app }) => app.getAppMetrics().find(m => m.type === 'Utility' && m.name === 'MovieAgent Library Engine')?.pid);
    if (!pid) throw Error('owned utility missing'); process.kill(pid);
  }
  await expect.poll(async () => { const d = await page.evaluate(() => window.studio.describe()); return d.ok && d.value.connectionEpoch !== before.value.connectionEpoch && d.value.libraryId === before.value.libraryId; }, { timeout: 15000 }).toBe(true);
  const after = await page.evaluate(() => window.studio.describe()); if (!after.ok) throw Error('new descriptor');
  await expect.poll(() => app!.evaluate(() => (globalThis as any).canvasEpoch), { timeout: 10000 }).toBe(after.value.connectionEpoch);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.poll(async () => page.getByLabel('文本内容').count(), { timeout: 10000 }).toBe(1);
  await expect.poll(() => page.getByLabel('文本内容').inputValue()).toBe('UNSAVED_CONTENT');
  expect(await node.evaluate(el => (el as HTMLElement).style.transform)).toBe(position);
  await page.getByText('1 个节点有未保存草稿', { exact: false }).waitFor();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect.poll(() => page.getByRole('button', { name: '保存布局', exact: true }).isEnabled()).toBe(false);
  expect(await page.getByLabel('文本内容').inputValue()).toBe('UNSAVED_CONTENT');
  await page.getByRole('button', { name: '保存内容', exact: true }).click();
  await page.getByText('草稿与当前版本冲突。先刷新查看，再明确重试。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '以最新版本重试我的草稿', exact: true }).click();
  await page.getByText('所有修改已保存', { exact: false }).waitFor();
  await page.getByLabel('文本内容').fill('ORIGINAL_INCARNATION_DRAFT');
  expect(await page.evaluate(async () => {
    const d = await window.studio.describe(); const p = await window.studio.listProjects(); if (!d.ok || !p.ok) throw Error('identity');
    const s = await window.studio.query({ schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, queryId: 'incarnation-before', kind: 'canvas.read', payload: { canvasId: p.value[0]!.id } }); if (!s.ok) throw Error('snapshot');
    const n = s.value.nodes[0]!;
    const removed = await window.studio.execute({ schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, commandId: 'delete-for-restore', kind: 'canvas.applyCommand', payload: { canvasId: s.value.canvasId, baseRevision: s.value.revision, operations: [
      { kind: 'delete', nodeId: n.nodeId, incarnation: n.incarnation, expectedSemanticRevision: n.semanticRevision, expectedLayoutRevision: n.layoutRevision, expectedSelectionRevision: n.selectionRevision, expectedRunBindingId: n.activeRunBindingId },
    ] } });
    if (!removed.ok) throw Error(removed.error.code);
    return window.studio.execute({ schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, commandId: 'restore-incarnation', kind: 'canvas.applyCommand', payload: { canvasId: s.value.canvasId, baseRevision: removed.value.result.revision, undoCommandId: 'delete-for-restore' } });
  })).toMatchObject({ ok: true });
  await expect.poll(() => page.getByLabel('文本内容').inputValue()).toBe('UNSAVED_CONTENT');
  await page.getByText('原节点已删除或重建，草稿保留在原节点版本，不会覆盖当前节点。', { exact: true }).waitFor();
  await page.getByText('ORIGINAL_INCARNATION_DRAFT', { exact: true }).waitFor();
  await page.getByText('1 个节点有未保存草稿', { exact: false }).waitFor();
});

it('prepares from saved fixed text alone and leaves empty combined prompt validation in the engine', async () => {
  const page = await launch();
  await page.getByLabel('项目名称').fill('Fixed input');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('button', { name: '打开 Fixed input', exact: true }).click();
  await page.evaluate(async () => {
    const d = await window.studio.describe(); if (!d.ok) throw Error('descriptor');
    const execute = async (kind: any, payload: any) => { const r = await window.studio.execute({ schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, commandId: crypto.randomUUID(), kind, payload }); if (!r.ok) throw Error(r.error.code); };
    await execute('provider.saveConnection', { id: 'c', expectedRevision: 0, name: 'No network fixture', adapterType: 'openai-image-v1', baseUrl: 'https://example.com/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 1000, concurrency: 1 });
    await execute('model.saveDefinition', { id: 'm', expectedRevision: 0, name: 'Fixture', modelId: 'dummy', connectionRef: { libraryId: d.value.libraryId, id: 'c', revision: 1 }, capabilities: { taskTypes: ['text_to_image'], inputKinds: ['text'], outputKinds: ['image'], maxBatch: 1 }, parameters: {}, pricing: { status: 'unknown' } });
    await execute('profile.save', { id: 'p', expectedRevision: 0, name: 'Fixture', modelRef: { libraryId: d.value.libraryId, id: 'm', revision: 1 }, parameters: {} });
  });
  await page.getByRole('button', { name: '添加文本', exact: true }).click();
  await page.getByLabel('文本内容').fill('FROZEN_ONLY_PROMPT');
  await page.getByRole('button', { name: '保存内容', exact: true }).click();
  await page.getByText('所有修改已保存', { exact: false }).waitFor();
  await page.getByRole('button', { name: '添加生成节点', exact: true }).click();
  expect(await page.getByRole('button', { name: '准备生成', exact: true }).isEnabled()).toBe(false);
  await page.getByRole('checkbox', { name: /FROZEN_ONLY_PROMPT/ }).check();
  await page.getByRole('button', { name: '保存内容', exact: true }).click();
  await page.getByText('所有修改已保存', { exact: false }).waitFor();
  expect(await page.getByRole('button', { name: '准备生成', exact: true }).isEnabled()).toBe(true);
  await page.getByRole('button', { name: '准备生成', exact: true }).click();
  await page.getByRole('dialog').getByText('FROZEN_ONLY_PROMPT', { exact: true }).waitFor();
});

it.each([
  ['任务', 'task.list', '还没有生成任务'],
  ['模型设置', 'provider.list', '连接你的生成服务'],
  ['资产', 'asset.search', '为你的项目收集素材'],
])('does not claim %s is empty during a failed first read', async (tab, kind, empty) => {
  const page = await launch();
  await app!.evaluate(({ ipcMain }, kind) => {
    const original = (ipcMain as any)._invokeHandlers.get('studio:query');
    (globalThis as any).readPhase = 'loading';
    (globalThis as any).readWaiters = [];
    ipcMain.removeHandler('studio:query');
    ipcMain.handle('studio:query', async (event, input) => {
      if (input.kind !== kind) return original(event, input);
      if ((globalThis as any).readPhase === 'loading') await new Promise(resolve => (globalThis as any).readWaiters.push(resolve));
      if ((globalThis as any).readPhase === 'error') return { ok: false, error: { code: 'FIXTURE_READ_FAILED', message: 'fixture read failed' } };
      return original(event, input);
    });
  }, kind);
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.getByText('正在读取资料库…', { exact: true }).waitFor();
  expect(await page.getByText(empty, { exact: true }).count()).toBe(0);
  await app!.evaluate(() => { (globalThis as any).readPhase = 'error'; for (const release of (globalThis as any).readWaiters) release(); });
  await page.getByText('FIXTURE_READ_FAILED · fixture read failed', { exact: true }).waitFor();
  expect(await page.getByText(empty, { exact: true }).count()).toBe(0);
  await app!.evaluate(() => { (globalThis as any).readPhase = 'success'; });
  await page.getByText(empty, { exact: true }).waitFor();
  if (kind === 'provider.list') {
    expect(await page.evaluate(async () => {
      const d = await window.studio.describe(); if (!d.ok) throw Error('descriptor');
      return window.studio.execute({ schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, commandId: 'cached-connection', kind: 'provider.saveConnection', payload: { id: 'cached', expectedRevision: 0, name: 'Previously loaded connection', adapterType: 'openai-image-v1', baseUrl: 'https://example.com/v1', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 1000, concurrency: 1 } });
    })).toMatchObject({ ok: true });
    await page.getByText('Previously loaded connection', { exact: false }).waitFor();
    await app!.evaluate(() => { (globalThis as any).readPhase = 'error'; });
    await page.getByText('FIXTURE_READ_FAILED · fixture read failed', { exact: true }).waitFor();
    expect(await page.getByText('Previously loaded connection', { exact: false }).count()).toBe(1);
    expect(await page.getByText(empty, { exact: true }).count()).toBe(0);
  }
});
