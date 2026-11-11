import { afterEach, expect, it } from 'vitest';
import { readFile, mkdtemp, rm, writeFile, stat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { inspectMp4 } from '../../packages/storage/src/mp4';
import { objectStoreFor } from '../../packages/storage/src/object-store';
import { collectionJournalFor } from '../../packages/storage/src/collection-journal';
import { openLibrary, type LibraryHandle } from '../../packages/storage/src/database';
import { ArtifactSource } from '../../packages/providers/src/artifact-source';
import { createHttpTransport } from '../../packages/providers/src/http-transport';
const sample = await readFile(new URL('../fixtures/video-sample.mp4', import.meta.url));
const roots: string[] = [], libraries: LibraryHandle[] = [];
afterEach(async () => { for (const l of libraries.splice(0)) await l.close(); for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
it('reads real H264 MP4 dimensions/duration and rejects incomplete boxes, no video track and broken sample offsets', () => {
  expect(inspectMp4(sample)).toMatchObject({ ok: true, value: { mime: 'video/mp4', width: 64, height: 48, durationSeconds: 1 } });
  for (const invalid of [sample.subarray(0, 10), sample.subarray(0, sample.length - 1), Buffer.from('not a video')]) expect(inspectMp4(invalid).ok).toBe(false);
  const audio = Buffer.from(sample); audio.write('soun', audio.indexOf('vide')); expect(inspectMp4(audio).ok).toBe(false);
  const badOffset = Buffer.from(sample); const stco = badOffset.indexOf('stco'); badOffset.writeUInt32BE(1, stco + 12); expect(inspectMp4(badOffset).ok).toBe(false);
  const oversizedBox = Buffer.from(sample); oversizedBox.writeUInt32BE(0xffffffff, 0); expect(inspectMp4(oversizedBox).ok).toBe(false);
  expect(inspectMp4(Buffer.alloc(64 * 1024 * 1024 + 1)).ok).toBe(false);
});
// Preserve every box extent/sample offset: each mutation isolates a codec/header defect.
it.each(['zero config','unsupported version','missing SPS','overrunning SPS','overrunning PPS','invalid NAL type','truncated extension','overrunning extension','unsupported codec','missing mvhd','missing tkhd','invalid mvhd version','invalid tkhd version','truncated mvhd','truncated tkhd'])('rejects structurally malformed video: %s', mutation => {
  const changed = Buffer.from(sample), avcc = changed.indexOf('avcC'), start = avcc + 4, end = avcc - 4 + changed.readUInt32BE(avcc - 4);
  const ppsCount = start + 8 + changed.readUInt16BE(start + 6);
  if (mutation === 'zero config') changed.fill(0, start, end);
  if (mutation === 'unsupported version') changed[start] = 2;
  if (mutation === 'missing SPS') changed[start + 5] = 0xe0;
  if (mutation === 'overrunning SPS') changed.writeUInt16BE(65535, start + 6);
  if (mutation === 'overrunning PPS') changed.writeUInt16BE(65535, ppsCount + 1);
  if (mutation === 'invalid NAL type') changed[start + 8] = 0x68;
  if (mutation === 'truncated extension') {
    // Shorten only the four-byte high-profile extension; grow the next sibling into the gap.
    const siblingSize = changed.readUInt32BE(end);
    changed.writeUInt32BE(changed.readUInt32BE(avcc - 4) - 2, avcc - 4); changed.writeUInt32BE(siblingSize + 2, end - 2); changed.write('free', end + 2);
  }
  if (mutation === 'overrunning extension') changed[end - 1] = 1;
  if (mutation === 'unsupported codec') changed.write('avc3', changed.indexOf('avc1', changed.indexOf('stsd')));
  if (mutation === 'missing mvhd' || mutation === 'missing tkhd') changed.write('free', changed.indexOf(mutation.slice(-4)));
  if (mutation === 'invalid mvhd version') changed[changed.indexOf('mvhd') + 4] = 2;
  if (mutation === 'invalid tkhd version') changed[changed.indexOf('tkhd') + 4] = 2;
  if (mutation === 'truncated mvhd' || mutation === 'truncated tkhd') {
    const pos = changed.indexOf(mutation.slice(-4)), size = changed.readUInt32BE(pos - 4);
    changed.writeUInt32BE(12, pos - 4); changed.writeUInt32BE(size - 12, pos + 8); changed.write('free', pos + 12);
  }
  expect(inspectMp4(changed)).toMatchObject({ ok: false, error: { code: 'INVALID_VIDEO' } });
});
it('rejects a four-byte codec config even when remaining bytes form valid sibling boxes', () => {
  const changed = Buffer.from(sample), avcc = changed.indexOf('avcC'), size = changed.readUInt32BE(avcc - 4);
  changed.writeUInt32BE(12, avcc - 4); changed.writeUInt32BE(size - 12, avcc + 8); changed.write('free', avcc + 12);
  expect(inspectMp4(changed).ok).toBe(false);
});
it('publishes video through existing journals, recreates a generic PNG poster and reopens the durable original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'video-store-')); roots.push(root);
  const opened = await openLibrary({ root }); if (!opened.ok) throw Error('library'); libraries.push(opened.value);
  const path = join(root, 'input.mp4'); await writeFile(path, sample); const info = await stat(path);
  const sourceRef = { path, realPath: await realpath(path), allowedRoot: root, name: 'input.mp4', size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino };
  const journal = collectionJournalFor(opened.value); journal.create('video', sourceRef);
  const store = objectStoreFor(opened.value); const collected = await store.collect({ collectionId: 'video', sourceRef }); expect(collected.ok).toBe(true); if (!collected.ok) return;
  expect(collected.value).toMatchObject({ mime: 'video/mp4', width: 64, height: 48, byteLength: sample.length });
  const preview = await store.preview(collected.value); expect(preview.ok).toBe(true); if (preview.ok) expect(await sharp(preview.value).metadata()).toMatchObject({ format: 'png', width: 320, height: 180 });
  await opened.value.close(); const reopened = await openLibrary({ root }); if (!reopened.ok) throw Error('reopen'); libraries.push(reopened.value);
  const original = await objectStoreFor(reopened.value).read({ libraryId: reopened.value.libraryId, receipt: collected.value }); expect(original.ok).toBe(true);
  if (original.ok) { const chunks: Buffer[] = []; for await (const chunk of original.value.stream) chunks.push(chunk); expect(Buffer.concat(chunks)).toEqual(sample); }
});

it('bounds video spool at 64 MiB while retaining the 32 MiB image cap and distinct immutable identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'video-spool-')); roots.push(root);
  const medium = Buffer.alloc(32 * 1024 * 1024 + 1);
  const image = new ArtifactSource(root), video = new ArtifactSource(root, createHttpTransport(), 'video');
  expect(await image.stage('same-output', medium)).toMatchObject({ ok: false, error: { code: 'OUTPUT_LIMIT' } });
  expect(await video.stage('same-output', medium)).toMatchObject({ ok: true, value: { name: 'same-output.mp4', size: 33554433 } });
  expect((await image.recover('same-output')).ok).toBe(false);
  expect((await new ArtifactSource(root, createHttpTransport(), 'video').recover('same-output')).ok).toBe(true);
  expect(await video.stage('large-output', Buffer.alloc(64 * 1024 * 1024 + 1))).toMatchObject({ ok: false, error: { code: 'OUTPUT_LIMIT' } });
  let requestedLimit = 0;
  const downloading = new ArtifactSource(root, { ...createHttpTransport(), download: async (_url, _signal, limit) => { requestedLimit = limit!; return sample; } }, 'video');
  expect((await downloading.materialize({ kind: 'url', url: 'https://cdn.example/video' }, 'download-output')).ok).toBe(true);
  expect(requestedLimit).toBe(67108864);
});
