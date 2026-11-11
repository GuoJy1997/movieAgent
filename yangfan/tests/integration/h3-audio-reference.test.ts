import { expect, it, vi } from 'vitest';
import { buildH3Request, h3RequestBytes } from '../../packages/providers/src/minimax-h3.ts';
import { videoRequestBody } from '../../packages/providers/src/minimax-video.ts';
import { createHash } from 'node:crypto';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const imageA = Uint8Array.from([1, 2, 3]), imageB = Uint8Array.from([4, 5, 6]);
const audioA = Uint8Array.from([7, 8, 9]), audioB = Uint8Array.from([10, 11, 12]);
const ref = (kind: 'image' | 'audio', id: string) => kind === 'image' ? { kind: 'assetVersion', libraryId: 'library', assetId: id, version: 1 } as const : { kind: 'artifact', libraryId: 'library', artifactId: id } as const;
const prepared = {
  libraryId: 'library', preparedId: 'prepared', planHash: 'a'.repeat(64), expiresAt: Date.now() + 600000, projectId: 'project', inputVersion: 'v1', executionOwner: 'human', runId: 'run', estimateMicros: null, currency: null, adapterId: 'minimax-h3-v2', prompt: '两个角色轮流说话',
  config: {
    schemaVersion: 1,
    connection: { libraryId: 'library', id: 'connection', revision: 1, createdAt: new Date().toISOString(), name: 'H3', adapterType: 'minimax-h3-v2', baseUrl: 'https://api.minimax.cn', credentialRef: null, headers: {}, networkPolicy: { privateEndpoint: null }, timeoutMs: 1000, concurrency: 1 },
    model: { libraryId: 'library', id: 'model', revision: 1, createdAt: new Date().toISOString(), name: 'H3', modelId: 'MiniMax-H3', connectionRef: { libraryId: 'library', id: 'connection', revision: 1 }, capabilities: { taskTypes: ['text_to_video', 'image_to_video'], inputKinds: ['text', 'image', 'audio'], outputKinds: ['video'], maxBatch: 1 }, parameters: { duration: { type: 'integer', min: 4, max: 15, default: 6 }, resolution: { type: 'enum', values: ['768P'], default: '768P' }, ratio: { type: 'enum', values: ['16:9'], default: '16:9' } }, pricing: { status: 'unknown' } },
    profile: { libraryId: 'library', id: 'profile', revision: 1, createdAt: new Date().toISOString(), name: 'H3', modelRef: { libraryId: 'library', id: 'model', revision: 1 }, parameters: {} },
    parameters: { duration: 6, resolution: '768P', ratio: '16:9' }, pricing: { status: 'unknown' },
  },
  referenceImages: [
    { role: 'reference', ref: ref('image', 'a'), hash: hash(imageA), mime: 'image/png', byteLength: 3, width: 256, height: 256 },
    { role: 'reference', ref: ref('image', 'b'), hash: hash(imageB), mime: 'image/png', byteLength: 3, width: 256, height: 256 },
  ],
  referenceAudio: [
    { characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice-a', revision: 2 }, ref: ref('audio', 'voice-a'), hash: hash(audioA), mime: 'audio/wav', byteLength: 3, durationTicks: 96000, probeId: 'probe-a' },
    { characterRef: { id: 'b', revision: 1 }, voiceRef: { id: 'voice-b', revision: 2 }, ref: ref('audio', 'voice-b'), hash: hash(audioB), mime: 'audio/wav', byteLength: 3, durationTicks: 96000, probeId: 'probe-b' },
  ],
  voiceBindings: [{ characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice-a', revision: 2 } }, { characterRef: { id: 'b', revision: 1 }, voiceRef: { id: 'voice-b', revision: 2 } }],
} as any;
const media = { images: [imageA, imageB], audio: [audioA, audioB] };

it('diagnoses an unrecognized H3 task state instead of polling indefinitely',async()=>{
 const {MiniMaxH3Adapter}=await import('../../packages/providers/src/minimax-h3.ts');const adapter=new MiniMaxH3Adapter({} as any);
 const outcome=await adapter.reconcile({clientRequestId:'client',providerTaskId:'task',request:prepared},{queryVideo:async()=>({status:200,bytes:Buffer.from('{"task":{"status":"future-unknown"}}')})});
 expect(outcome).toEqual({kind:'unsupported'});
});

it('binds two images and two voices in explicit order with verified WAV data URIs', () => {
  const result = buildH3Request(prepared, media);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) return;
  expect(result.value.content).toHaveLength(5);
  expect(result.value.content[1]).toMatchObject({ type: 'image_url', role: 'reference_image' });
  expect(result.value.content[3]).toMatchObject({ type: 'audio_url', role: 'reference_audio' });
  const audioContent = result.value.content[3]!;
  if (audioContent.type !== 'audio_url') return;
  const encoded = audioContent.audio_url.url;
  expect(Buffer.from(encoded.split(',')[1]!, 'base64')).toEqual(Buffer.from(audioA));
  expect(hash(Buffer.from(encoded.split(',')[1]!, 'base64'))).toBe(hash(audioA));
  const bytes = h3RequestBytes(prepared, media);
  expect(bytes.ok && bytes.value.length).toBeLessThan(48000000);
});

it('rejects frame conflicts, count/duration/prompt/body limits and changed bytes before any POST', () => {
  for (const value of [
    { ...prepared, referenceImages: [{ ...prepared.referenceImages[0], role: 'first_frame' }] },
    { ...prepared, referenceImages: Array(5).fill(prepared.referenceImages[0]) },
    { ...prepared, referenceAudio: Array(4).fill(prepared.referenceAudio[0]) },
    { ...prepared, referenceAudio: [{ ...prepared.referenceAudio[0], durationTicks: 15 * 48000 + 1 }] },
    { ...prepared, prompt: 'x'.repeat(7001) },
  ]) expect(buildH3Request(value, media).ok).toBe(false);
  expect(buildH3Request(prepared, { images: media.images, audio: [Uint8Array.from([0, 0, 0]), audioB] }).ok).toBe(false);
  expect(h3RequestBytes({ ...prepared, prompt: 'x'.repeat(7000) }, { images: [new Uint8Array(33 * 1024 * 1024), imageB], audio: media.audio }).ok).toBe(false);
});

it('keeps the legacy MiniMax video request byte shape unchanged', () => {
  const {referenceAudio,voiceBindings,...base}=prepared;
  const legacy = { ...base, adapterId: 'minimax-video-v2', config: { ...prepared.config, connection: { ...prepared.config.connection, adapterType: 'minimax-video-v2' } } };
  const first = videoRequestBody(legacy, media.images);expect(first.ok).toBe(true);if(!first.ok)return;
  expect(first.value.toString()).toBe(JSON.stringify({model:'MiniMax-H3',content:[{type:'text',text:prepared.prompt},...prepared.referenceImages.map((ref:any,i:number)=>({type:'image_url',image_url:{url:`data:${ref.mime};base64,${Buffer.from(media.images[i]!).toString('base64')}`},role:'reference_image'}))],duration:6,resolution:'768P',ratio:'16:9'}));
});

import { nativeFixture, value, execute } from '../fixtures/native-generation.ts';
import { audioFixture, audioValue, audioExecute, fixtureWav } from '../fixtures/audio-generation.ts';
import sharp from 'sharp';

it('submits verified H3 audio through the real adapter and reconciles the original task', async () => {
  const s = await nativeFixture('minimax-h3-v2');
  const projectId = s.prepareInput().projectId;
  const profileRef = value(await execute(s.engine, 'profile.save', { id: 'native', expectedRevision: 1, name: 'H3 landscape', modelRef: s.prepareInput().profileRef, parameters: { ratio: '16:9' } }));
  const image = await s.importFile(await sharp({ create: { width: 256, height: 256, channels: 3, background: '#123456' } }).png().toBuffer(), 'character.png');
  const audio = await s.importFile(fixtureWav(2), 'voice.wav');
  value(await s.engine.mediaInfo.ensure(audio));
  value(await execute(s.engine,'creation.saveEntity',{projectId,id:'a',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[image]}));
  const audioProbe=value(s.engine.mediaInfo.read(audio));
  value(await execute(s.engine,'voice.save',{projectId,id:'voice',expectedRevision:0,draft:{entityRef:{id:'a',revision:1},name:'A',dialect:'',performanceNotes:'',reference:{ref:audio,hash:audioProbe.objectHash,probeId:audioProbe.probeId,sourceInTicks:0,durationTicks:96000}}}));
  expect(await execute(s.engine,'generation.prepare',{projectId,profileRef,prompt:'bound voice',inputVersion:'binding',executionOwner:'human',runId:'bad-binding',referenceAudio:[{characterRef:{id:'other',revision:1},voiceRef:{id:'voice',revision:1},ref:audio}]})).toMatchObject({ok:false,error:{code:'REFERENCE_PREPARATION_REQUIRED'}});
  const prepared = value(await execute(s.engine, 'generation.prepare', { projectId, profileRef, prompt: '角色说话', inputVersion: 'v1', executionOwner: 'human', runId: 'run', referenceImages: [{ role: 'reference', ref: image }], referenceAudio: [{ characterRef: { id: 'a', revision: 1 }, voiceRef: { id: 'voice', revision: 1 }, ref: audio }] }));
  const h3 = await import('../../packages/providers/src/minimax-h3.ts');
  expect(h3.validateH3Request(prepared)).toMatchObject({ ok: true });
  const originalImage = value(await s.engine.assets.readFixedOriginal(image));
  const lease = value(await s.engine.assets.openMediaRead(audio));
  const originalAudio = value(await s.engine.assets.readMediaRange({ leaseId: lease.leaseId, offset: 0, length: lease.byteLength })).bytes;
  await s.engine.assets.closeMediaRead(lease.leaseId);
  expect(hash(originalImage.bytes)).toBe(prepared.referenceImages[0].hash);
  expect(hash(originalAudio)).toBe(prepared.referenceAudio[0].hash);
  expect(originalImage.bytes.byteLength).toBe(prepared.referenceImages[0].byteLength);
  expect(originalAudio.byteLength).toBe(prepared.referenceAudio[0].byteLength);
  const request = h3.h3RequestBytes(prepared, { images: [originalImage.bytes], audio: [originalAudio] });
  expect(request, JSON.stringify(request)).toMatchObject({ ok: true });
  s.response({ task_id: 'h3-task' });
  const task = value(await execute(s.engine, 'generation.approveAndEnqueue', { preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, currency: 'CNY', allowanceMicros: 1000000, budgetLimitMicros: 100000000, acknowledgeUnknown: true, executionOwner: 'human', runId: 'run' }));
  const pending = s.engine.scheduler.run(task.attemptId);
  await vi.waitFor(() => expect(s.requests).toHaveLength(1));
  s.response({ task: { id: 'h3-task', status: 'succeeded', content: {} } });
  value(await pending);
  value(await s.engine.scheduler.run(task.attemptId));
  expect(s.requests, JSON.stringify(value(s.engine.generation.read(task.taskId)))).toHaveLength(2);
  const body = JSON.parse(s.requests[0]!.body.toString());
  expect(body.content.some((item: any) => item.type === 'audio_url' && item.role === 'reference_audio' && item.audio_url.url.startsWith('data:audio/wav;base64,'))).toBe(true);
  expect(value(s.engine.generation.read(task.taskId)).providerTaskId).toBe('h3-task');
});

it('publishes prepared voice references as durable selectable media', async () => {
  const s = await audioFixture('openai-speech-v1', { native: true });
  const projectId = s.projectId;
  audioValue(await audioExecute(s.engine, 'creation.saveEntity', { projectId, id: 'a', expectedRevision: 0, kind: 'character', name: 'A', description: '', constraints: '', references: [] }));
  const ref = await s.importAudio(fixtureWav(3));
  const probe = audioValue(await s.engine.mediaInfo.ensure(ref));
  const voiceDraft = { entityRef: { id: 'a', revision: 1 }, name: 'A', dialect: '', performanceNotes: '', reference: { ref, hash: probe.objectHash, probeId: probe.probeId, sourceInTicks: 48000, durationTicks: 96000 } };
  const croppedVoice=audioValue(await audioExecute(s.engine, 'voice.save', { projectId, id: 'voice', expectedRevision: 0, draft: voiceDraft }));
  expect(croppedVoice.production).toEqual({ready:false,reason:'REFERENCE_PREPARATION_REQUIRED'});
  const plan = audioValue(await audioExecute(s.engine, 'voice.prepareReference', { projectId, voiceRef: { id: 'voice', revision: 1 }, executionOwner: 'human', runId: 'prepare-voice' }));
  expect(plan.voiceInput).toMatchObject({ sourceInTicks: 48000, durationTicks: 96000 });
  const job = audioValue(s.engine.renders.enqueueDerived({ planId: plan.planId, planHash: plan.planHash, executionOwner: 'human', runId: 'prepare-voice', diskBudgetBytes: plan.requiredFreeBytes }));
  expect(s.engine.renders.claim()).toBe(job.jobId);
  await s.engine.renders.execute(job.jobId, new AbortController());
  const completed = audioValue(s.engine.renders.read({ projectId, jobId: job.jobId }));
  expect(completed.outputRef, JSON.stringify(completed)).not.toBeNull();
  const preparedProbe = audioValue(await s.engine.mediaInfo.ensure(completed.outputRef));
  const metadata = audioValue(s.engine.assets.metadata(completed.outputRef));
  const production = audioValue(await audioExecute(s.engine, 'voice.save', { projectId, id: 'voice', expectedRevision: 1, draft: { ...voiceDraft, reference: { ref: completed.outputRef, hash: metadata.hash, probeId: preparedProbe.probeId, sourceInTicks: 0, durationTicks: 96000 } } }));
  expect(production.production).toEqual({ ready: true, reason: null });
});
