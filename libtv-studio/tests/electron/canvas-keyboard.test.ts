import { packageExecutable, isolatedModelConfig } from './support/product-launch.ts';
import { afterEach, expect, it } from 'vitest';
import { _electron, expect as uiExpect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication | undefined;
let root: string | undefined;
afterEach(async () => {
  if (app) await app.close();
  if (root) await rm(root, { recursive: true, force: true });
});

it('keeps the inspector when keyboard selection moves from B to an earlier node A, then clears it on Escape',async()=>{
  root=await mkdtemp(join(tmpdir(),'libtv-keyboard-batch-'));
  app=await _electron.launch({executablePath:packageExecutable,args:[await isolatedModelConfig(root),`--library-root=${join(root,'library')}`,`--user-data-dir=${join(root,'profile')}`]});
  const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900});
  await page.getByLabel('项目名称').fill('Keyboard batch');await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('button',{name:'打开 Keyboard batch',exact:true}).click();
  for(const text of ['Earlier A','Later B']){await page.getByRole('button',{name:'添加文本',exact:true}).click();await page.getByLabel('文本内容').fill(text);await page.getByRole('button',{name:'保存内容',exact:true}).click();await uiExpect(page.getByRole('button',{name:'保存内容',exact:true})).toBeDisabled();}
  await uiExpect(page.getByLabel('文本内容')).toHaveValue('Later B');
  const a=page.locator('.react-flow__node').first();await tabTo(page,a);await page.keyboard.press('Enter');await uiExpect(page.getByLabel('文本内容')).toHaveValue('Earlier A');await uiExpect(a).toHaveClass(/selected/);
  await page.keyboard.press('Escape');await uiExpect(page.getByText('选择一个节点',{exact:true})).toBeVisible();await uiExpect(a).not.toHaveClass(/selected/);
});

async function tabTo(page: Page, target: Locator) {
  await target.waitFor({ state: 'visible' });
  for (let count = 0; count < 40; count++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Target was not reachable with Tab');
}

it('reopened canvas supports keyboard selection, draft editing, Escape and persisted save', async () => {
  root = await mkdtemp(join(tmpdir(), 'libtv-canvas-keyboard-'));
  async function launch() {
    app = await _electron.launch({
      executablePath: packageExecutable,
      args: [await isolatedModelConfig(root!), `--library-root=${join(root!, 'library')}`, `--user-data-dir=${join(root!, 'profile')}`],
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    return page;
  }
  let page = await launch();
  await page.getByLabel('项目名称').fill('键盘编辑');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('button', { name: '打开 键盘编辑', exact: true }).click();
  await page.getByRole('button', { name: '添加文本', exact: true }).click();
  await page.getByLabel('文本内容').fill('重开前的文本');
  await page.getByRole('button', { name: '保存内容', exact: true }).click();
  await page.getByText('所有修改已保存', { exact: false }).waitFor();
  await app!.close();
  app = undefined;

  page = await launch();
  await page.getByRole('button', { name: '打开 键盘编辑', exact: true }).click();
  await page.getByText('选择一个节点', { exact: true }).waitFor();
  const node = page.locator('.react-flow__node').first();
  await tabTo(page, node);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.getByLabel('文本内容').count()).toBe(1);
  expect(await node.getAttribute('class')).toContain('selected');
  await tabTo(page, page.getByLabel('文本内容'));
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('完全通过键盘编辑的持久文本');

  // Deselecting must hide the inspector without discarding the unsaved draft.
  await tabTo(page, node);
  await page.keyboard.press('Escape');
  await page.getByText('选择一个节点', { exact: true }).waitFor();
  expect(await node.getAttribute('class')).not.toContain('selected');
  await tabTo(page, node);
  await page.keyboard.press('Space');
  await expect.poll(() => page.getByLabel('文本内容').inputValue()).toBe('完全通过键盘编辑的持久文本');
  await tabTo(page, page.getByRole('button', { name: '保存内容', exact: true }));
  await page.keyboard.press('Enter');
  await page.getByText('所有修改已保存', { exact: false }).waitFor();
  await tabTo(page, node);
  await page.keyboard.press('Escape');
  await page.getByText('选择一个节点', { exact: true }).waitFor();
  await app!.close();
  app = undefined;

  page = await launch();
  await page.getByRole('button', { name: '打开 键盘编辑', exact: true }).click();
  await tabTo(page, page.locator('.react-flow__node').first());
  await page.keyboard.press('Enter');
  await expect.poll(() => page.getByLabel('文本内容').inputValue()).toBe('完全通过键盘编辑的持久文本');
});
