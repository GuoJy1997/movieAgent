import { afterEach, expect, it } from 'vitest';
import { _electron, chromium, expect as ui, type Browser, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectDirectoryProject } from '../../apps/desktop/src/main/project-directories.ts';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { ArtifactSource } from '../../packages/providers/src/artifact-source.ts';
import { packageExecutable } from './support/product-launch.ts';

let launcher: ElectronApplication | undefined, browser: Browser | undefined, server: Server | undefined;
let persist: (() => Promise<void>) | undefined;
const evidence = resolve('test-results/p4-final-fix');
afterEach(async () => {
  await persist?.();
  if (browser) { for (const page of browser.contexts().flatMap(c => c.pages())) await page.close().catch(() => {}); await browser.close().catch(() => {}); browser = undefined; }
  if (launcher) {
    let graceful = false;
    try { await expect.poll(() => launcher!.evaluate(() => ((globalThis as any).p4Children ?? []).every((c: any) => c.exitCode !== null)), { timeout: 20000 }).toBe(true); graceful = true; }
    finally { const forced = await launcher.evaluate(() => { let count = 0; for (const c of (globalThis as any).p4Children ?? []) if (c.exitCode === null) { c.kill(); count++; } return count; }); await writeFile(join(evidence, 'teardown.json'), JSON.stringify({ graceful, forced }, null, 2)); await launcher.close(); launcher = undefined; }
  }
  server?.closeAllConnections(); await new Promise<void>(done => server ? server.close(() => done()) : done()); server = undefined;
});
function value(r: any): any { if (!r.ok) throw Error(JSON.stringify(r.error)); return r.value?.result ?? r.value; }
async function ipc(page: Page, type: 'query' | 'execute', kind: string, payload: unknown) {
  return page.evaluate(async ({ type, kind, payload }) => { const d = await window.studio.describe(); if (!d.ok) throw Error('DESCRIBE'); const e = { schemaVersion: 1, libraryId: d.value.libraryId, connectionEpoch: d.value.connectionEpoch, kind, payload }; return type === 'query' ? window.studio.query({ ...e, queryId: crypto.randomUUID() } as any) : window.studio.execute({ ...e, commandId: crypto.randomUUID() } as any); }, { type, kind, payload });
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
it.skipIf(!process.env.MOVIEAGENT_P4_FINAL_FIX)('publishes H3 and Sync and freshly renders the retained composition on the repaired exact package', async () => {
  const root = resolve(process.env.MOVIEAGENT_P4_FINAL_FIX!);
  expect(root).toBe(resolve('C:/Users/1266/AppData/Local/Temp/movieagent-p4-owned-KXdXbW'));
  expect(resolve(process.env.MOVIEAGENT_TEST_PACKAGE!)).toBe(resolve('apps/desktop/release-p4/win-unpacked'));
  await mkdir(evidence, { recursive: true });
  const project = value(await inspectDirectoryProject(join(root, '自有验收项目'))), projectId = project.manifest.binding.projectId, libraryId = project.manifest.binding.libraryId;
  expect(projectId).toBe('b732c6bf-a6ef-4006-a15a-46fa76439094'); expect(libraryId).toBe('810fe7c1-a0f8-4179-9dfa-23ee94365f5c');
  const asar = resolve('apps/desktop/release-p4/win-unpacked/resources/app.asar'), packageHash = hash(await readFile(asar));
  const runtime = value(await loadMediaRuntime(resolve('apps/desktop/release-p4/win-unpacked/resources/media-runtime/win32-x64')));
  const native = (args: string[]) => { const r = spawnSync(runtime.ffmpegPath, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); expect(r.status, r.stderr).toBe(0); return r; };
  const resume = process.env.MOVIEAGENT_P4_FINAL_FIX_RESUME === '1';
  const configuration = JSON.parse(await readFile(join(root, 'fixture-models.json'), 'utf8')), port = Number(new URL(configuration.providers[0].baseURL).port);
  const config = join(root, resume ? 'final-fix-fixture-models.json' : 'fixture-models.json');
  if (resume) { const sync = configuration.providers.find((p: any) => p.id === 'sync'); configuration.providers.push({ ...sync, id: 'final-sync', name: 'Final bounded Sync fixture' }); await writeFile(config, JSON.stringify(configuration)); }
  const checkpoint = resume ? JSON.parse(await readFile(join(evidence, 'attempt-1-publications.json'), 'utf8')) : undefined;
  if (checkpoint) expect(checkpoint.packageHash).toBe(packageHash);
  const blocked = resume ? JSON.parse(await readFile(join(evidence, 'blocked-sync.json'), 'utf8')) : undefined;
  const requests: any[] = resume ? JSON.parse(await readFile(join(evidence, 'attempt-1-requests.json'), 'utf8')) : [], ready = new Map<string, string>(), served = new Map<string, string>(); let counter = requests.filter(r => r.method === 'POST').length;
  persist = () => writeFile(join(evidence, 'requests.json'), JSON.stringify(requests, null, 2));
  server = createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const bytes = Buffer.concat(chunks), url = req.url ?? '', method = req.method ?? ''; requests.push({ method, url, headers: { authorization: req.headers.authorization, 'x-api-key': req.headers['x-api-key'], 'idempotency-key': req.headers['idempotency-key'], 'x-client-request-id': req.headers['x-client-request-id'] }, hash: hash(bytes) });
    res.setHeader('content-type', 'application/json');
    if (method === 'POST' && url === '/v2/video_generation') { res.end(JSON.stringify({ task_id: `final-h3-${++counter}` })); return; }
    if (method === 'POST' && url === '/v2/generate') { res.statusCode = 201; res.end(JSON.stringify({ id: `final-sync-${++counter}` })); return; }
    const id = url.split('/').at(-1)!; if (ready.has(id)) served.set(id, ready.get(id)!);
    if (url.startsWith('/v2/query/video_generation/')) { res.end(JSON.stringify({ task: { status: ready.has(id) ? 'succeeded' : 'running', content: ready.has(id) ? { url: 'https://fixture.invalid/owned-output.mp4', sha256: ready.get(id) } : {} } })); return; }
    if (url.startsWith('/v2/generate/')) { res.end(JSON.stringify({ id, status: ready.has(id) ? 'COMPLETED' : 'PROCESSING', output: ready.has(id) ? { url: 'https://fixture.invalid/owned-output.mp4', sha256: ready.get(id) } : {} })); return; }
    res.statusCode = 404; res.end('{}');
  }); }); await new Promise<void>(done => server!.listen(port, '127.0.0.1', done));
  const listener = createServer(); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done)); const cdpPort = (listener.address() as { port: number }).port; await new Promise<void>(done => listener.close(() => done()));
  launcher = await _electron.launch({ executablePath: packageExecutable, args: [`--model-config=${config}`, `--user-data-dir=${join(root, 'launcher')}`] }); const launchPage = await launcher.firstWindow();
  await launcher.evaluate(({ dialog }, data) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [data.folder] }); const cp: any = process.getBuiltinModule('child_process'), original = cp.spawn; (globalThis as any).p4Children = []; cp.spawn = (exe: string, args: string[], options: any) => { const child = original(exe, [...args, '--provider-evidence=fixture', `--remote-debugging-port=${data.port}`], options); (globalThis as any).p4Children.push(child); return child; }; }, { folder: project.root, port: cdpPort });
  await launchPage.getByRole('button', { name: '打开项目', exact: true }).click();
  await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const ownedPages = () => browser!.contexts().flatMap(c => c.pages()); await expect.poll(() => ownedPages().length, { timeout: 30000 }).toBeGreaterThan(0);
  const page = ownedPages()[0]!; await page.waitForFunction(() => !!window.studio); await ui(page.getByText('本地引擎已连接', { exact: true })).toBeVisible({ timeout: 30000 }); await page.setViewportSize({ width: 1440, height: 960 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const query = async (kind: string, payload: unknown) => value(await ipc(page, 'query', kind, payload)), cmd = async (kind: string, payload: unknown) => value(await ipc(page, 'execute', kind, payload));
  expect(value(await page.evaluate(() => window.studio.describe())).libraryId).toBe(libraryId);
  const timeline = await query('timeline.read', { projectId, timelineId: '3446a72c-f02c-4d1f-bba5-b37905a97c8a' }); expect(timeline.revision).toBe(7); expect(timeline.videoClips).toHaveLength(4);
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(resume ? 1 : 0);
  if (blocked) {
    expect(await query('task.read', { taskId: blocked.unknown.taskId })).toEqual(blocked.unknown);
    const waiting = await query('task.read', { taskId: blocked.view.taskId }); expect(waiting).toMatchObject({ state: 'QUEUED', providerState: 'unsubmitted', providerTaskId: null, clientRequestId: null, errorCode: 'CONCURRENCY_LIMIT' });
    await cmd('dialogue.stopProduction', { projectId, planId: blocked.plan.planId, executionOwner: blocked.plan.executionOwner });
    expect((await query('task.read', { taskId: blocked.view.taskId })).cancelRequested).toBe(true);
  }
  const profiles = (await query('profile.list', {})).profiles, h3 = profiles.find((p: any) => p.id === 'file-h3-profile');
  const spool = new ArtifactSource(project.libraryRoot, undefined, 'video'), publications: any[] = checkpoint?.publications ?? [];
  async function publish(plan: any, colour: string, shotId: string) {
    const batch = await cmd('dialogue.approveProduction', { planId: plan.planId, approvedHash: plan.approvedHash, executionOwner: plan.executionOwner, runId: plan.runId, approval: { currency: 'CNY', allowanceMicros: 10000000, budgetLimitMicros: 2000000000, acknowledgeUnknown: true } });
    const task = batch.tasks[0], bytes = await readFile(join(root, `${colour}.mp4`)), expectedHash = hash(bytes); value(await spool.stage(`${task.attemptId}-output`, bytes));
    await expect.poll(async () => (await query('task.read', { taskId: task.taskId })).providerTaskId, { timeout: 30000 }).toBeTruthy(); const providerId = (await query('task.read', { taskId: task.taskId })).providerTaskId; ready.set(providerId, expectedHash);
    await expect.poll(async () => (await query('task.read', { taskId: task.taskId })).state, { timeout: 60000 }).toBe('SUCCEEDED'); expect(served.get(providerId)).toBe(expectedHash);
    const findTake = async () => (await query('dialogue.takes', { projectId, shotId })).takes.find((t: any) => t.origin.kind === 'provider' && t.origin.task.taskId === task.taskId);
    await expect.poll(findTake, { timeout: 10000 }).toBeTruthy(); const take = await findTake(), inspected = await cmd('media.inspect', { projectId, reference: take.video }); expect(inspected.hash).toBe(expectedHash);
    publications.push({ plan, task: await query('task.read', { taskId: task.taskId }), take, inspected, expectedHash, servedHash: served.get(providerId) }); await writeFile(join(evidence, 'publications.json'), JSON.stringify({ packageHash, publications }, null, 2)); await persist!(); console.log('published', providerId, task.taskId, take.id, expectedHash);
  }
  if (resume) { const saved = publications[0]; expect(await query('task.read', { taskId: saved.task.taskId })).toEqual(saved.task); expect((await query('dialogue.takes', { projectId, shotId: 'cut-0' })).takes).toContainEqual(saved.take); expect((await cmd('media.inspect', { projectId, reference: saved.take.video })).hash).toBe(saved.expectedHash); }
  else { const h3Plan = await cmd('dialogue.prepareProduction', { projectId, dialogueRefs: [{ id: 'd-cut-0', revision: 1 }], profileRef: { libraryId: h3.libraryId, id: h3.id, revision: h3.revision }, purpose: 'production', executionOwner: 'desktop-user', runId: crypto.randomUUID() }); await publish(h3Plan, 'red', 'cut-0'); }
  const summaries = (await query('dialogue.productions', { projectId, shotId: 'cut-2' })).productions, prior = await query('dialogue.production', { projectId, planId: summaries.find((p: any) => p.runId === 'sync-repair').planId }), p = prior.plan.items[0].prepared;
  const fixtureSync = profiles.find((profile: any) => profile.id === 'file-final-sync-profile');
  const syncPlan = await cmd('dialogue.prepareRepair', { projectId, dialogueRef: { id: 'd-cut-2', revision: 1 }, alignedInput: { videoRef: p.lipSyncVideo.ref, audioRef: p.lipSyncAudio.ref, durationTicks: p.lipSyncVideo.durationTicks, videoHash: p.lipSyncVideo.hash, audioHash: p.lipSyncAudio.hash }, profileRef: resume ? { libraryId: fixtureSync.libraryId, id: fixtureSync.id, revision: fixtureSync.revision } : prior.plan.profileRef, executionOwner: 'desktop-user', runId: crypto.randomUUID() }); await publish(syncPlan, 'blue', 'cut-2');
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(2); expect(requests.find(r => r.method === 'POST' && r.url === '/v2/video_generation').headers.authorization).toBe('Bearer dummy-p4-only'); expect(requests.find(r => r.method === 'POST' && r.url === '/v2/generate').headers['x-api-key']).toBe('dummy-p4-only');
  const renderPlan = await cmd('render.prepare', { timelineRef: { libraryId, projectId, id: timeline.id, revision: timeline.revision }, purpose: 'mp4', executionOwner: 'desktop-user', runId: crypto.randomUUID(), burnSubtitles: true });
  const enqueued = await cmd('render.enqueue', { planId: renderPlan.planId, planHash: renderPlan.planHash, executionOwner: renderPlan.executionOwner, runId: renderPlan.runId, diskBudgetBytes: renderPlan.requiredFreeBytes });
  await writeFile(join(evidence, 'render-start.json'), JSON.stringify({ packageHash, timeline, renderPlan, enqueued, startedAt: new Date().toISOString() }, null, 2));
  await expect.poll(async () => (await query('render.read', { projectId, jobId: enqueued.jobId })).state, { timeout: 180000 }).toBe('SUCCEEDED');
  const job = await query('render.read', { projectId, jobId: enqueued.jobId }), output = await cmd('media.inspect', { projectId, reference: job.outputRef }), movie = join(evidence, 'final-composition.mp4'); await copyFile(join(project.libraryRoot, 'objects', output.hash.slice(0, 2), output.hash), movie); expect(hash(await readFile(movie))).toBe(output.hash);
  native(['-v', 'error', '-i', movie, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  const probe = spawnSync(runtime.ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', movie], { windowsHide: true, encoding: 'utf8' }); expect(probe.status, probe.stderr).toBe(0); const facts = JSON.parse(probe.stdout); expect(facts.streams.find((s: any) => s.codec_type === 'video')).toMatchObject({ width: 1920, height: 1080, r_frame_rate: '30/1', nb_frames: '900' }); expect(Number(facts.format.duration)).toBe(30);
  for (const [i, time] of [2, 12, 22].entries()) native(['-v', 'error', '-y', '-ss', String(time), '-i', movie, '-frames:v', '1', join(evidence, `cut-${i + 1}.png`)]);
  await page.getByRole('button', { name: '剪辑成片', exact: true }).click(); await ui(page.getByLabel('当前时间线')).toContainText('P4 三十秒成片'); await page.screenshot({ path: join(evidence, 'final-workbench.png') });
  expect(await query('timeline.read', { projectId, timelineId: timeline.id })).toEqual(timeline); expect(errors).toEqual([]); expect(hash(await readFile(asar))).toBe(packageHash);
  if (blocked) expect(await query('task.read', { taskId: blocked.unknown.taskId })).toEqual(blocked.unknown);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), packageHash, packageExecutable, root, projectId, libraryId, publications, timeline, renderPlan, job, output, media: facts, requests: { posts: 2, h3: 1, sync: 1 }, continuation: resume ? 'H3 retained from attempt1; blocked unsubmitted Sync publicly stopped; new independent dummy Sync connection preserves original UNKNOWN reservation' : null, boundary: 'New final-package engine publication and render; deterministic owned spool replaces remote CDN download only. Prior audition context reused, no new human-quality claim or selection. Prior exports/UNKNOWN/reopen belong to earlier packages.' }, null, 2));
}, 360000);
