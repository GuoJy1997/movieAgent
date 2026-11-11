import { afterEach, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { probeMediaFile } from '../../packages/engine/src/media/probe.ts';
import { checkFontCoverage } from '../../packages/engine/src/media/font.ts';
import { compileMediaProcess, runMediaProcess } from '../../packages/engine/src/media/process.ts';
import { startEngine } from '../../packages/engine/src/bootstrap.ts';
import type { MediaRuntime } from '../../packages/contracts/src/media-info.ts';
let runtime: MediaRuntime; const roots: string[] = [];
beforeAll(async () => { const loaded = await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64')); if (!loaded.ok) throw Error(loaded.error.code); runtime = loaded.value; });
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'p4-real-media-')); roots.push(root); return root; }
function ffmpeg(args: string[]) { const r = spawnSync(runtime.ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }); expect(r.status, r.stderr.slice(-1000)).toBe(0); return r.stderr; }
it('provides the pinned CPU codecs, muxers, subtitle filters and exact CJK font coverage', async () => {
  for (const [flag, words] of [['-encoders', ['libx264', 'aac', 'pcm_s16le']], ['-muxers', ['mp4', 'wav', 'null']], ['-filters', ['subtitles', 'ass', 'fps', 'atrim', 'asetpts', 'amix', 'alimiter', 'scale', 'setsar']]] as const) {
    const r = spawnSync(runtime.ffmpegPath, [flag], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 30000 }); expect(r.status).toBe(0); for (const word of words) expect(r.stdout).toMatch(new RegExp(`\\b${word}\\b`));
  }
  expect(await checkFontCoverage(runtime, '字幕测试 Hello 123')).toMatchObject({ ok: true, value: { family: 'Noto Sans CJK SC', missing: [] } });
  expect(await checkFontCoverage(runtime, '未\u{10ffff}')).toMatchObject({ ok: true, value: { missing: ['\u{10ffff}'] } });
});
it('probes real 44.1k WAV, imports with zero dimensions, and persists one probe identity', async () => {
  const root = await directory(), path = join(root, 'sample.wav'); ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1', '-c:a', 'pcm_s16le', path]);
  const opened = await startEngine({ root: join(root, 'library'), runtime }); if (!opened.ok) throw Error('engine'); const engine = opened.value;
  try {
    const s = await stat(path); engine.assets.registerGrant({ grantId: 'wav', importId: 'wav-import', libraryId: engine.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path, realPath: path, allowedRoot: root, name: 'sample.wav', size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino }] });
    const imported = await engine.commands.execute({ schemaVersion: 1, libraryId: engine.identity.libraryId, connectionEpoch: 'test', commandId: 'wav-import', kind: 'asset.importGrantedFiles', payload: { grantId: 'wav' } }); expect(imported).toMatchObject({ ok: true });
    const asset = engine.assets.search().assets[0]!; expect(asset).toMatchObject({ mime: 'audio/wav', width: 0, height: 0 });
    expect(engine.mediaInfo.read(asset.ref)).toEqual({ ok: true, value: null });
    const probe = await engine.mediaInfo.ensure(asset.ref); expect(probe, JSON.stringify(probe)).toMatchObject({ ok: true, value: { durationTicks: 48000, streams: [{ sampleRate: 44100, startPts: 0 }] } }); expect(await engine.mediaInfo.ensure(asset.ref)).toEqual(probe); expect(engine.mediaInfo.read(asset.ref)).toEqual(probe);
    expect(await engine.mediaInfo.ensure({ ...asset.ref, libraryId: 'foreign' })).toMatchObject({ ok: false, error: { code: 'WRONG_LIBRARY' } });
    const metadata = engine.assets.metadata(asset.ref); if (!metadata.ok) throw Error('metadata');
    await writeFile(join(root, 'library', 'objects', metadata.value.hash.slice(0, 2), metadata.value.hash), 'changed');
    expect(await engine.mediaInfo.ensure(asset.ref)).toMatchObject({ ok: false, error: { code: 'OBJECT_INTEGRITY_FAILED' } });
  } finally { await engine.close(); }
});
it('preserves real rotated/nonzero/VFR stream facts and rejects a disguised playlist or HDR', async () => {
  const root = await directory(), base = join(root, 'base.mp4'), rotated = join(root, 'rotated.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'color=blue:size=64x32:rate=30:duration=1', '-vf', "select='not(eq(mod(n,3),1))',setpts=PTS+2/TB", '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '4', '-pix_fmt', 'yuv420p', base]);
  ffmpeg(['-copyts', '-display_rotation:v:0', '90', '-i', base, '-c', 'copy', rotated]);
  const probe = await probeMediaFile(runtime, rotated, root, 'a'.repeat(64)); expect(probe).toMatchObject({ ok: true, value: { hasAudio: false, originSeconds: 2, streams: [{ rotation: 90, variableFrameRate: true }] } });
  const playlist = join(root, 'disguised.wav'); await writeFile(playlist, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://example.invalid/private\n'); expect(await probeMediaFile(runtime, playlist, root, 'b'.repeat(64))).toMatchObject({ ok: false });
  const hdr = join(root, 'hdr.mp4'); ffmpeg(['-f', 'lavfi', '-i', 'color=black:size=64x32:duration=0.1', '-c:v', 'libx264', '-threads', '4', '-x264-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc', hdr]); expect(await probeMediaFile(runtime, hdr, root, 'c'.repeat(64))).toMatchObject({ ok: false, error: { code: 'HDR_UNSUPPORTED' } });
});
it('does not execute a structurally forged process request', async () => {
  const root = await directory(); expect(await runMediaProcess({ tool: 'ffmpeg', runtime, stagingRoot: root, timeoutMs: 100, maxStdoutBytes: 1024, args: ['-version'] }, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'MEDIA_PROCESS_DENIED' } });
});
it('bounds native work with a timeout and respects cancellation of its own process', async () => {
  const root = await directory();
  const request = compileMediaProcess({ tool: 'ffmpeg', runtime, stagingRoot: root, timeoutMs: 100, maxStdoutBytes: 1024, args: ['-nostdin', '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-threads', '4', '-f', 'null', '-'] });
  expect(await runMediaProcess(request, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'MEDIA_PROCESS_TIMEOUT' } });
  const cancel = new AbortController(); cancel.abort(); expect(await runMediaProcess(request, cancel.signal)).toMatchObject({ ok: false, error: { code: 'MEDIA_CANCELLED' } });
});
it('selects the pinned CJK font in the real subtitle rasterizer', async () => {
  const root = await directory(), ass = join(root, 'captions.ass');
  await writeFile(ass, '[Script Info]\nScriptType: v4.00+\nPlayResX: 64\nPlayResY: 32\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans CJK SC,12,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,0,0,0,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:00.10,Default,,0,0,0,,字幕\n');
  const escaped = (p: string) => p.replaceAll('\\', '/').replaceAll(':', '\\:');
  const log = ffmpeg(['-f', 'lavfi', '-i', 'color=black:size=64x32:duration=0.1', '-vf', `ass=filename='${escaped(ass)}':fontsdir='${escaped(dirname(runtime.ffmpegPath))}'`, '-frames:v', '1', '-threads', '4', '-f', 'null', '-']);
  expect(log).toMatch(/fontselect:.*NotoSansCJKsc-Regular/); expect(log).not.toMatch(/Glyph .* not found/);
});
