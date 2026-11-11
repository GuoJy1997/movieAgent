import { expect, it } from 'vitest';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture, value, execute } from '../fixtures/native-generation';
const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#234567' } }).png().toBuffer();
it('uploads fixed image[] multipart bytes and durably collects the edited image', async () => {
  const s = await nativeFixture('openai-image-edit-v1'), ref = await s.importFile(png); s.response({ data: [{ b64_json: png.toString('base64') }] });
  const { prepared, task } = await s.enqueue([{ role: 'reference', ref }]); expect(prepared.referenceImages[0]).toMatchObject({ hash: createHash('sha256').update(png).digest('hex'), mime: 'image/png', width: 256 });
  await writeFile(join(s.root, 'reference.png'), 'changed live external file');
  const done = value(await s.engine.scheduler.run(task.attemptId)); expect(done.state).toBe('SUCCEEDED'); expect(s.requests).toHaveLength(1); const req = s.requests[0]!;
  expect(req.url).toBe('/v1/images/edits'); expect(req.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/); expect(req.body.includes(png)).toBe(true); expect(req.body.toString()).toContain('name="image[]"'); expect(req.body.toString()).toContain('name="output_format"\r\n\r\npng');
  await s.engine.close(); const e = await s.open(); value(await e.scheduler.recover()); expect(s.requests).toHaveLength(1); expect(Buffer.from(value(await e.assets.read({ libraryId: ref.libraryId, ref: done.artifactRef, variant: 'original' })).bytes)).toEqual(png);
});
it.each([{ roles: ['first_frame'] }, { roles: ['first_frame','last_frame'] }, { roles: ['reference'] }])('submits exact native MiniMax roles %j with verified data URIs and never repeats an unknown POST', async ({ roles }) => {
  const s = await nativeFixture('minimax-video-v2'), ref = await s.importFile(png); s.cut(); const { task } = await s.enqueue(roles.map(role => ({ role, ref }))); value(await s.engine.scheduler.run(task.attemptId));
  expect(s.requests).toHaveLength(1); expect(s.requests[0]!.url).toBe('/v2/video_generation');
  const body = JSON.parse(s.requests[0]!.body.toString()); expect(body.ratio).toBe('adaptive'); expect(body.content).toEqual([{ type: 'text', text: 'A quiet lake' }, ...roles.map(role => ({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + png.toString('base64') }, role: role === 'reference' ? 'reference_image' : role }))]);
  await s.engine.close(); const e = await s.open(); value(await e.scheduler.recover()); expect(s.requests).toHaveLength(1);
});
it('rejects wrong-library refs and changed original digest before sending any credentialed request', async () => {
  const s = await nativeFixture('openai-image-edit-v1'), ref = await s.importFile(png);
  expect(await execute(s.engine, 'generation.prepare', s.prepareInput([{ role: 'reference', ref: { ...ref, libraryId: 'wrong' } }]))).toMatchObject({ ok: false });
  const { prepared, task } = await s.enqueue([{ role: 'reference', ref }]); const hash = prepared.referenceImages[0].hash;
  await writeFile(join(s.root, 'objects', hash.slice(0,2), hash), Buffer.alloc(png.length)); value(await s.engine.scheduler.run(task.attemptId)); expect(s.requests).toHaveLength(0);
});
it.each([{ roles: ['last_frame'] }, { roles: ['reference','first_frame'] }, { roles: ['first_frame','first_frame'] }, { roles: ['reference','reference','reference','reference','reference'] }])('rejects incompatible roles %j before submission', async ({ roles }) => {
  const s = await nativeFixture('minimax-video-v2'), ref = await s.importFile(png); expect(await execute(s.engine, 'generation.prepare', s.prepareInput(roles.map(role => ({ role, ref }))))).toMatchObject({ ok: false }); expect(s.requests).toHaveLength(0);
});
it('recovers a known native reference-video task by ID and publishes MP4 without another POST', async () => {
  const s = await nativeFixture('minimax-video-v2'), ref = await s.importFile(png); s.response({ task_id: 'native-ref-video' });
  const { task } = await s.enqueue([{ role: 'first_frame', ref }]); expect(value(await s.engine.scheduler.run(task.attemptId))).toMatchObject({ state: 'RUNNING', providerTaskId: 'native-ref-video' });
  const { readFile } = await import('node:fs/promises'), { ArtifactSource } = await import('../../packages/providers/src/artifact-source');
  const sample = await readFile(new URL('../fixtures/video-sample.mp4', import.meta.url)); value(await new ArtifactSource(s.root, undefined, 'video').stage(`${task.attemptId}-output`, sample));
  await s.engine.close(); s.response({ task: { id: 'native-ref-video', status: 'succeeded', content: { url: 'https://cdn.example/native.mp4' } } });
  const e = await s.open(); value(await e.scheduler.recover()); const done = value(e.generation.read(task.taskId)); expect(done.state).toBe('SUCCEEDED');
  expect(s.requests.map(r => r.url)).toEqual(['/v2/video_generation', '/v2/query/video_generation/native-ref-video']);
  expect(Buffer.from(value(await e.assets.read({ libraryId: ref.libraryId, ref: done.artifactRef, variant: 'original' })).bytes)).toEqual(sample);
});
it('retains the approved asset version after a newer version is saved and rejects unsupported dimensions and no-image adaptive', async () => {
  const s = await nativeFixture('openai-image-edit-v1'), ref = await s.importFile(png);
  const frozen = await s.enqueue([{ role: 'reference', ref }]);
  const other = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ff0000' } }).png().toBuffer();
  s.response({ data: [{ b64_json: other.toString('base64') }] }); const newer = await s.enqueue([{ role: 'reference', ref }]); const done = value(await s.engine.scheduler.run(newer.task.attemptId));
  const v2 = value(await execute(s.engine, 'asset.saveArtifact', { artifactRef: done.artifactRef, name: 'New version', assetId: ref.assetId, expectedVersion: 1 })); expect(v2.version).toBe(2);
  value(await s.engine.scheduler.run(frozen.task.attemptId)); expect(s.requests[1]!.body.includes(png)).toBe(true); expect(s.requests[1]!.body.includes(other)).toBe(false);
  const video = await nativeFixture('minimax-video-v2'); expect(await execute(video.engine, 'generation.prepare', video.prepareInput())).toMatchObject({ ok: false, error: { code: 'INVALID_REFERENCE_RATIO' } });
  const small = await sharp({ create: { width: 255, height: 256, channels: 3, background: '#234567' } }).png().toBuffer(), smallRef = await video.importFile(small);
  expect(await execute(video.engine, 'generation.prepare', video.prepareInput([{ role: 'first_frame', ref: smallRef }]))).toMatchObject({ ok: false, error: { code: 'REFERENCE_DIMENSIONS' } });
});
it('rechecks metadata and payload caps before credential access and never rePOSTs an uncertain edit', async () => {
  const s = await nativeFixture('openai-image-edit-v1'), ref = await s.importFile(png), { prepared, task } = await s.enqueue([{ role: 'reference', ref }]);
  const { createImageEditCapability } = await import('../../apps/desktop/src/main/provider-capability');
  const forbiddenVault = { withSecret: () => { throw Error('credential scope must not open'); } } as any;
  const credentialed = structuredClone(prepared); credentialed.config.connection.credentialRef = { libraryId: ref.libraryId, connectionId: prepared.config.connection.id, id: 'fixture-credential', version: 1 };
  const capability = createImageEditCapability(ref.libraryId, forbiddenVault), dispatch = { attemptId: 'bounded', outputStagingId: 'bounded-output', clientRequestId: 'bounded', requestHash: 'a'.repeat(64), retries: 0 as const };
  await expect(capability(credentialed, dispatch, [Buffer.alloc(png.length)])).rejects.toThrow('INVALID_IMAGE_EDIT_CAPABILITY');
  const big = { ...prepared.referenceImages[0], byteLength: 10 * 1024 * 1024 + 1 };
  await expect(capability({ ...credentialed, referenceImages: [big] }, dispatch, [png])).rejects.toThrow('INVALID_IMAGE_EDIT_CAPABILITY');
  const total = Array.from({ length: 4 }, () => ({ ...prepared.referenceImages[0], byteLength: 9 * 1024 * 1024 }));
  await expect(capability({ ...credentialed, referenceImages: total }, dispatch, [png,png,png,png])).rejects.toThrow('INVALID_IMAGE_EDIT_CAPABILITY'); expect(s.requests).toHaveLength(0);
  s.cut(); value(await s.engine.scheduler.run(task.attemptId)); await s.engine.close(); const e = await s.open(); value(await e.scheduler.recover()); expect(s.requests).toHaveLength(1);
});
it.each(['openai-image-edit-v1','minimax-video-v2'])('permits bounded native reference bodies above the legacy no-image limit for %s', async adapter => {
  const s = await nativeFixture(adapter), { randomBytes } = await import('node:crypto');
  const noise = await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
  expect(noise.length).toBeGreaterThan(128 * 1024); const ref = await s.importFile(noise);
  s.response(adapter === 'minimax-video-v2' ? { task_id: 'large-reference' } : { data: [{ b64_json: png.toString('base64') }] });
  const { task } = await s.enqueue([{ role: adapter === 'minimax-video-v2' ? 'first_frame' : 'reference', ref }]);
  expect(value(await s.engine.scheduler.run(task.attemptId)).providerState).toBe(adapter === 'minimax-video-v2' ? 'accepted' : 'completed');
  expect(s.requests).toHaveLength(1); expect(s.requests[0]!.body.length).toBeGreaterThan(128 * 1024);
});
it('validates canvas reference ownership and freezes its fixed input through canvas preparation', async () => {
  const s = await nativeFixture('openai-image-edit-v1'), ref = await s.importFile(png), input = s.prepareInput();
  const content = { type: 'generation', prompt: input.prompt, profileRef: input.profileRef, inputs: [], referenceImages: [{ role: 'reference', ref }] };
  const create = (c: unknown) => execute(s.engine, 'canvas.applyCommand', { canvasId: input.projectId, baseRevision: 0, operations: [{ kind: 'create', nodeId: 'reference-generation', content: c, layout: { x: 0, y: 0 } }] });
  expect(await create({ ...content, referenceImages: [{ role: 'reference', ref: { ...ref, libraryId: 'foreign' } }] })).toMatchObject({ ok: false, error: { code: 'MEDIA_NOT_FOUND' } });
  value(await create(content));
  const frozen = value(await execute(s.engine, 'generation.prepare', { projectId: input.projectId, canvasNode: { canvasId: input.projectId, nodeId: 'reference-generation' }, executionOwner: 'human', runId: 'canvas-reference' }));
  expect(frozen.referenceImages[0]).toMatchObject({ ref, hash: createHash('sha256').update(png).digest('hex') });
});
it('reopens a persisted legacy text-only video snapshot above the new submit limit and collects its original accepted ID without rePOST', async () => {
  const s = await nativeFixture('minimax-video-v2'), ref = await s.importFile(png); s.response({ task_id: 'legacy-accepted' });
  const { task, prepared } = await s.enqueue([{ role: 'first_frame', ref }]);
  expect(value(await s.engine.scheduler.run(task.attemptId))).toMatchObject({ state: 'RUNNING', providerTaskId: 'legacy-accepted' });
  const { readFile } = await import('node:fs/promises'), { ArtifactSource } = await import('../../packages/providers/src/artifact-source');
  const sample = await readFile(new URL('../fixtures/video-sample.mp4', import.meta.url)); value(await new ArtifactSource(s.root, undefined, 'video').stage(`${task.attemptId}-output`, sample));
  await s.engine.close();
  // Seed the exact old stored contract in this disposable fixture, including matching hashes.
  const legacy = structuredClone(prepared); delete legacy.referenceImages; legacy.prompt = '文'.repeat(16000);
  legacy.config.model.capabilities = { taskTypes: ['text_to_video'], inputKinds: ['text'], outputKinds: ['video'], maxBatch: 1 };
  legacy.config.model.parameters.ratio = { type: 'enum', values: ['9:16'], default: '9:16' };
  legacy.config.profile.parameters.ratio = '9:16'; legacy.config.parameters.ratio = '9:16';
  const { planHash: _old, ...plan } = legacy; legacy.planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(join(s.root, 'library.sqlite'));
  try {
    db.prepare('UPDATE generation_prepared SET plan_json=? WHERE prepared_id=?').run(JSON.stringify(legacy), legacy.preparedId);
    const row = db.prepare('SELECT intent_json FROM task_attempt WHERE attempt_id=?').get(task.attemptId)!;
    const intent = JSON.parse(row.intent_json as string); intent.requestHash = createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
    db.prepare('UPDATE task_attempt SET intent_json=? WHERE attempt_id=?').run(JSON.stringify(intent), task.attemptId);
  } finally { db.close(); }
  s.response({ task: { id: 'legacy-accepted', status: 'succeeded', content: { url: 'https://cdn.example/legacy.mp4' } } });
  const e = await s.open(); value(await e.scheduler.recover()); const done = value(e.generation.read(task.taskId));
  expect(done).toMatchObject({ state: 'SUCCEEDED', providerTaskId: 'legacy-accepted', collectionState: 'durable' });
  expect(s.requests.map(r => r.url)).toEqual(['/v2/video_generation', '/v2/query/video_generation/legacy-accepted']);
  expect(Buffer.from(value(await e.assets.read({ libraryId: e.identity.libraryId, ref: done.artifactRef, variant: 'original' })).bytes)).toEqual(sample);
});
