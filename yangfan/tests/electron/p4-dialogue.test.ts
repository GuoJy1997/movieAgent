import { afterEach, expect, it } from 'vitest';
import { _electron, chromium, expect as ui, type Browser, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, stat, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createDirectoryProject, bindDirectoryProject } from '../../apps/desktop/src/main/project-directories.ts';
import { startEngine, type EngineHandle } from '../../packages/engine/src/bootstrap.ts';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { packageExecutable, isolatedModelConfig } from './support/product-launch.ts';

// Task8 owns execution against the exact release-p4 package. This fixture proves
// engineering flow with self-created tones/colour plates, never voice/lip quality.
let root = '', launcher: ElectronApplication | undefined;
const browsers: Browser[] = [];
afterEach(async () => {
  for (const browser of browsers.splice(0)) { for (const page of browser.contexts().flatMap(context => context.pages())) await page.close().catch(() => {}); await browser.close().catch(() => {}); }
  await launcher?.close().catch(() => {}); launcher = undefined;
  if (root) { const path = resolve(root); if (!path.startsWith(resolve(tmpdir()) + sep) || !basename(path).startsWith('p4-dialogue-')) throw Error('UNSAFE_FIXTURE_CLEANUP'); await rm(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); root = ''; }
});
function result(value: any): any { if (!value.ok) throw Error(JSON.stringify(value.error)); return value.value?.result ?? value.value; }
const execute = (engine: EngineHandle, kind: string, payload: unknown) => engine.commands.execute({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'p4-fixture', commandId: crypto.randomUUID(), kind, payload });
async function ipc(page: Page, type: 'query' | 'execute', kind: string, payload: unknown): Promise<any> {
  return page.evaluate(async ({ type, kind, payload }) => {
    const identity = await window.studio.describe(); if (!identity.ok) throw Error('DESCRIBE_FAILED');
    const base = { schemaVersion: 1, libraryId: identity.value.libraryId, connectionEpoch: identity.value.connectionEpoch, kind, payload };
    return type === 'query' ? window.studio.query({ ...base, queryId: crypto.randomUUID() } as any) : window.studio.execute({ ...base, commandId: crypto.randomUUID() } as any);
  }, { type, kind, payload });
}

it.skipIf(!process.env.MOVIEAGENT_TEST_PACKAGE)('uses two characters, three emotions, imported redub, explicit review, CAS conflict and reopen in a 30-second local cut', async () => {
  expect(resolve(process.env.MOVIEAGENT_TEST_PACKAGE!)).toContain('release-p4');
  root = await mkdtemp(join(tmpdir(), 'p4-dialogue-'));
  const projectFolder = join(root, 'project'); await mkdir(projectFolder);
  const project = result(await createDirectoryProject({ mode: 'existing', directory: projectFolder, name: 'P4 对白验收' }));
  const runtime = result(await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64')));
  const sourcePath = join(root, 'original.mp4'), fixedPath = join(root, 'fixed.mp4'), audioPath = join(root, 'recording.wav');
  for (const [path, colour] of [[sourcePath, 'red'], [fixedPath, 'blue']]) expect(spawnSync(runtime.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=${colour}:s=320x180:r=30:d=5`, '-threads', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path!], { shell: false, windowsHide: true }).status).toBe(0);
  expect(spawnSync(runtime.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-ac', '1', '-c:a', 'pcm_s16le', audioPath], { shell: false, windowsHide: true }).status).toBe(0);
  const engine = result(await startEngine({ root: project.libraryRoot, runtime })) as EngineHandle;
  let projectId = '', audio: any, original: any, fixed: any;
  try {
    projectId = result(await execute(engine, 'project.create', { name: project.manifest.name })).id;
    async function importOwnFile(path: string) {
      const info = await stat(path), grantId = crypto.randomUUID();
      result(engine.assets.registerGrant({ grantId, importId: crypto.randomUUID(), libraryId: engine.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path, realPath: await realpath(path), allowedRoot: root, name: basename(path), size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino }] }));
      return result(await execute(engine, 'asset.importGrantedFiles', { grantId })).versions[0];
    }
    audio = await importOwnFile(audioPath); original = await importOwnFile(sourcePath); fixed = await importOwnFile(fixedPath);
    const probe = result(await engine.mediaInfo.ensure(audio));
    for (const id of ['a', 'b']) {
      result(await execute(engine, 'creation.saveEntity', { projectId, id, expectedRevision: 0, kind: 'character', name: `角色 ${id}`, description: '', constraints: '', references: [] }));
      result(await execute(engine, 'voice.save', { projectId, id: `voice-${id}`, expectedRevision: 0, draft: { entityRef: { id, revision: 1 }, name: `声音 ${id}`, dialect: 'fixture 未验口音', performanceNotes: '自有测试音，不表示人声音色', reference: { ref: audio, hash: probe.objectHash, probeId: probe.probeId, sourceInTicks: 0, durationTicks: 96000 } } }));
    }
    result(await execute(engine, 'creation.saveScript', { projectId, id: 'script', expectedRevision: 0, title: '30秒对白工程验收', synopsis: '', body: '', scenes: [{ id: 'scene', title: '轮流对话', location: '', time: '', description: '' }] }));
    for (let index = 0; index < 6; index++) {
      const shotId = `shot-${index}`, speaker = index % 2 ? 'b' : 'a';
      result(await execute(engine, 'creation.saveShot', { projectId, id: shotId, expectedRevision: 0, scriptId: 'script', sceneId: 'scene', order: index, title: `镜头${index + 1}`, durationSeconds: 5, shotSize: '中景', cameraMovement: '', subject: speaker, action: '', dialogue: '', sound: '', aspectRatio: '16:9', prompt: '', entityRefs: [] }));
      result(await execute(engine, 'dialogue.save', { projectId, id: `dialogue-${index}`, expectedRevision: 0, draft: { shotRef: { id: shotId, revision: 1 }, turns: [{ turnId: `turn-${index}`, characterRef: { id: speaker, revision: 1 }, voiceRef: { id: `voice-${speaker}`, revision: 1 }, text: `第${index + 1}句工程测试`, emotion: ['calm', 'excited', 'quiet'][Math.floor(index / 2)], startTicks: 0, durationTicks: 48000, mode: 'dubbed-lipsync' }] } }));
      if (index < 5) {
        result(await execute(engine, 'dialogue.confirmAudio', { projectId, dialogueRef: { id: `dialogue-${index}`, revision: 1 }, expectedRevision: 1, source: { kind: 'imported-audio', media: audio } }));
        const take = result(await execute(engine, 'dialogue.importRepair', { projectId, dialogueRef: { id: `dialogue-${index}`, revision: 1 }, sourceVideo: original, confirmedAudioRef: audio, repairedVideo: fixed }));
        result(await execute(engine, 'dialogue.reviewTake', { projectId, takeId: take.id, expectedReviewRevision: 0, checks: { timbre: 'pass', accent: 'pass', dialogue: 'pass', lipsync: 'pass' }, notes: 'fixture 工程标记，未作真实质量验收' }));
        result(await execute(engine, 'dialogue.selectTake', { projectId, shotId, expectedShotRevision: 1, expectedSelectionRevision: 0, dialogueRef: { id: `dialogue-${index}`, revision: 1 }, takeId: take.id }));
      } else result(await execute(engine, 'creation.selectOutput', { projectId, shotId, expectedRevision: 1, expectedSelectionRevision: 0, role: 'video', reference: original }));
    }
    result(await bindDirectoryProject(project.root, { libraryId: engine.identity.libraryId, projectId, workspaceId: project.manifest.workspaceId }));
  } finally { result(await engine.close()); }
  const configArgument = await isolatedModelConfig(root), debugPorts: number[] = [];
  for (let index = 0; index < 2; index++) { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); debugPorts.push((server.address() as { port: number }).port); await new Promise<void>(resolve => server.close(() => resolve())); }
  launcher = await _electron.launch({ executablePath: packageExecutable, args: [configArgument, `--user-data-dir=${join(root, 'launcher')}`] });
  const launchPage = await launcher.firstWindow();
  await launcher.evaluate(({ dialog }, data) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [data.folder] });
    const cp: any = process.getBuiltinModule('child_process'), spawn = cp.spawn; (globalThis as any).p4Children = [];
    cp.spawn = (exe: string, args: string[], options: any) => { const child = spawn(exe, [...args, `--remote-debugging-port=${data.ports.shift()}`], options); (globalThis as any).p4Children.push(child); return child; };
  }, { folder: project.root, ports: [...debugPorts] });
  const posts: string[] = [], errors: string[] = [];
  async function connect(index: number) { const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPorts[index]}`); browsers.push(browser); const page = browser.contexts()[0]!.pages()[0]!; page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); }); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => Boolean(window.studio)); await ui(page.getByText('本地引擎已连接', { exact: true })).toBeVisible(); await page.setViewportSize({ width: 1100, height: 900 }); return page; }
  await launchPage.getByRole('button', { name: '打开项目', exact: true }).click();
  let page = await connect(0);
  await page.getByRole('button', { name: '剧本分镜', exact: true }).click(); await page.getByRole('button', { name: '编辑镜头 镜头6', exact: true }).click(); await page.getByRole('button', { name: '对白制作', exact: true }).click(); await page.getByRole('button', { name: '配音与口型', exact: true }).click();
  await page.getByLabel('固定配音', { exact: true }).selectOption(`${audio.assetId}:${audio.version}`); await page.getByRole('button', { name: '确认固定配音', exact: true }).click();
  await page.getByLabel('源视频').selectOption(`${original.assetId}:${original.version}`); await page.getByRole('button', { name: '本地补静音并对齐', exact: true }).click();
  await ui(page.getByText(/对齐作业：SUCCEEDED/)).toBeVisible({ timeout: 60000 });
  await page.getByLabel('外部修正版（可选）').selectOption(`${fixed.assetId}:${fixed.version}`); await page.getByRole('button', { name: '导入手工修正版', exact: true }).click();
  const review = page.getByRole('region', { name: '对白人工审核' }); await ui(review.getByRole('button', { name: '保存人工审核' })).toBeDisabled();
  for (const label of ['音色', '口音', '台词', '口型']) await review.getByLabel(label, { exact: true }).selectOption('pass');
  await review.getByLabel('审核备注').fill('fixture 工程标记；真实音色、方言、口型未验'); await review.getByRole('button', { name: '保存人工审核' }).click();
  const take = result(await ipc(page, 'query', 'dialogue.takes', { projectId, shotId: 'shot-5' })).takes[0];
  result(await ipc(page, 'execute', 'creation.selectOutput', { projectId, shotId: 'shot-5', expectedRevision: 1, expectedSelectionRevision: 1, role: 'video', reference: original }));
  expect(await ipc(page, 'execute', 'dialogue.selectTake', { projectId, shotId: 'shot-5', expectedShotRevision: 1, expectedSelectionRevision: 1, dialogueRef: { id: 'dialogue-5', revision: 1 }, takeId: take.id })).toMatchObject({ ok: false, error: { code: 'SELECTION_CONFLICT' } });
  await review.getByRole('button', { name: '采用此 take' }).click();
  await expect.poll(async () => result(await ipc(page, 'query', 'creation.read', { projectId })).selections.filter((selection: any) => selection.dialogue).length).toBe(6);
  await page.getByRole('button', { name: '剪辑成片', exact: true }).click(); await page.getByLabel('新时间线名称').fill('P4 30秒样片'); await page.getByRole('button', { name: '新建空时间线', exact: true }).click();
  await page.getByRole('button', { name: '从当前镜头生成粗剪', exact: true }).click(); await page.getByRole('button', { name: '分析固定来源与实际长度', exact: true }).click(); await ui(page.getByText('固定版本 · 实际总长 30秒', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '采用这一固定粗剪', exact: true }).click();
  await page.getByRole('button', { name: '导出', exact: true }).click(); await page.getByRole('button', { name: '准备 MP4 本机渲染', exact: true }).click(); await page.getByLabel('确认磁盘占用与固定版本').check(); await page.getByRole('button', { name: '批准本机处理', exact: true }).click();
  await expect.poll(async () => result(await ipc(page, 'query', 'render.list', { projectId })).jobs.some((job: any) => job.kind === 'render' && job.state === 'SUCCEEDED'), { timeout: 120000 }).toBe(true);
  const timeline = result(await ipc(page, 'query', 'timeline.list', { projectId })).timelines[0];
  const output = result(await ipc(page, 'query', 'render.list', { projectId })).jobs.find((job: any) => job.kind === 'render' && job.state === 'SUCCEEDED');
  expect(result(await ipc(page, 'execute', 'media.inspect', { projectId, reference: output.outputRef })).probe.durationTicks).toBe(30 * 48000);
  const evidence = resolve('test-results/p4-dialogue'); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, '30-second-cut.png') });
  await writeFile(join(evidence, 'engineering-result.json'), JSON.stringify({ packageExecutable, projectId, timeline, output, quality: 'unverified-synthetic-fixture' }, null, 2));
  await page.close(); await expect.poll(() => launcher!.evaluate(() => (globalThis as any).p4Children[0].exitCode), { timeout: 20000 }).toBe(0);
  await launchPage.getByRole('button', { name: '打开项目', exact: true }).click(); page = await connect(1); await page.getByRole('button', { name: '剪辑成片', exact: true }).click();
  await ui(page.getByLabel('当前时间线')).toContainText('P4 30秒样片');
  const reopened = result(await ipc(page, 'query', 'timeline.read', { projectId, timelineId: timeline.id }));
  expect(reopened.videoClips).toHaveLength(6); expect(reopened.audioClips).toHaveLength(6); expect(reopened.videoClips.every((clip: any) => clip.mute)).toBe(true); expect(reopened.audioClips.every((clip: any) => !clip.mute)).toBe(true);
  expect(posts).toEqual([]); expect(errors).toEqual([]);
}, 240000);
