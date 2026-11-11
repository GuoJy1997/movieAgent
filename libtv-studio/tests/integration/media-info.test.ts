import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startEngine } from '../../packages/engine/src/bootstrap.ts';

// Removing duration/PTS/color validation must fail these independently authored fixtures.
const audio = { format: { format_name: 'wav', duration: '1' }, streams: [{ index: 0, codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '48000', channels: 1, time_base: '1/48000', start_pts: 0, duration_ts: 48000 }] };
async function parser() { return import('../../packages/engine/src/media/probe.ts').catch(() => null); }
it('derives audio duration in ticks without inventing picture dimensions', async () => {
  const module = await parser(); expect(module).not.toBeNull(); if (!module) return;
  expect(module.parseMediaProbe(audio, 'a'.repeat(64), 'b'.repeat(64))).toMatchObject({ ok: true, value: { durationTicks: 48000, width: 0, height: 0, hasAudio: true, originSeconds: 0 } });
});
it('rejects unknown duration, excessive audio, malformed PTS, playlists and HDR facts', async () => {
  const module = await parser(); expect(module).not.toBeNull(); if (!module) return;
  for (const fixture of [
    { ...audio, format: { format_name: 'wav' } },
    { ...audio, format: { format_name: 'wav', duration: '601' } },
    { ...audio, streams: [{ ...audio.streams[0], start_pts: 'NaN' }] },
    { ...audio, format: { format_name: 'hls', duration: '1' } },
    { format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '1' }, streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 64, height: 64, time_base: '1/12800', start_pts: 0, duration_ts: 12800, color_transfer: 'smpte2084' }] },
  ]) expect(module.parseMediaProbe(fixture, 'a'.repeat(64), 'b'.repeat(64))).toMatchObject({ ok: false });
});
it('preserves common origin, rotation, VFR and missing audio rather than guessing frames', async () => {
  const module = await parser(); expect(module).not.toBeNull(); if (!module) return;
  const parsed = module.parseMediaProbe({ format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '3' }, streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 120, height: 80, time_base: '1/1000', start_pts: 2000, duration_ts: 1000, avg_frame_rate: '20/1', r_frame_rate: '30/1', side_data_list: [{ rotation: 90 }], color_space: 'bt709' }] }, 'a'.repeat(64), 'b'.repeat(64));
  expect(parsed).toMatchObject({ ok: true, value: { originSeconds: 2, durationTicks: 48000, hasAudio: false, streams: [{ startPts: 2000, endPts: 3000, rotation: 90, variableFrameRate: true }] } });
});

it('publishes audio import with zero dimensions and exposes only bounded original leases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p4-audio-import-'));
  const engine = await startEngine({ root: join(root, 'library'), assets: { inspectAudio: async () => ({ ok: true, value: { mime: 'audio/wav', width: 0, height: 0 } }) } });
  if (!engine.ok) throw Error('engine');
  try {
    const path = join(root, 'sample.wav'); await writeFile(path, Buffer.from('RIFF0000WAVEfmt ')); const s = await stat(path);
    expect(engine.value.assets.registerGrant({ grantId: 'audio', importId: 'audio-import', libraryId: engine.value.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path, realPath: path, allowedRoot: root, name: 'sample.wav', size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino }] })).toMatchObject({ ok: true });
    const result = await engine.value.commands.execute({ schemaVersion: 1, libraryId: engine.value.identity.libraryId, connectionEpoch: 'test', commandId: 'audio-import-command', kind: 'asset.importGrantedFiles', payload: { grantId: 'audio' } });
    expect(result).toMatchObject({ ok: true });
    const snapshot = engine.value.assets.search(); expect(snapshot.assets).toMatchObject([{ mime: 'audio/wav', width: 0, height: 0 }]);
    expect(engine.value.assets).toHaveProperty('openMediaRead');
  } finally { await engine.value.close(); await rm(root, { recursive: true, force: true }); }
});
