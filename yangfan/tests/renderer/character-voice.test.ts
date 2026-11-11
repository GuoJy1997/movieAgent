import { afterAll, beforeAll, expect, it } from 'vitest';
import { harness, mounted, queries } from './p4-harness.ts';
import { voice, media } from './voice-fixtures.ts';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.browser.close(); await h?.server.close(); });

it('opens an empty character voice panel without paid calls and disables saving without fixed audio', async () => {
  const data = {
    ...queries(), __entity: true,
    'creation.read': { scripts: [], shots: [], selections: [], entities: [{ id: 'a', revision: 1, kind: 'character', name: '角色 A', description: '', constraints: '', references: [] }] },
    'voice.list': { voices: [] },
  };
  await mounted(h, async page => {
    await page.getByRole('button', { name: '编辑 角色 A', exact: true }).click();
    await page.getByRole('button', { name: '声音档案', exact: true }).click();
    await page.getByText('尚未绑定标准声音', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: '保存声音档案', exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.p4Fixture.calls)).toEqual([]);
  }, data);
});

it('preserves voice edit B across query refresh and the delayed save A acknowledgement', async () => {
  const entity = { id: 'a', revision: 1, kind: 'character', name: '角色 A', description: '', constraints: '', references: [] };
  await mounted(h, async page => {
    await page.getByRole('button', { name: '编辑 角色 A', exact: true }).click(); await page.getByRole('button', { name: '声音档案', exact: true }).click();
    await page.getByLabel('现有声音修订').selectOption('voice-a');
    await page.getByLabel('声音名称').fill('保存 A'); await page.getByRole('button', { name: '保存声音档案', exact: true }).click();
    await page.getByLabel('声音名称').fill('后续 B');
    await page.evaluate(voice => { window.p4Fixture.update({ 'voice.list': { voices: [{ ...voice, revision: 2, name: '外部修订' }] } }); window.p4Fixture.resolve({ ...voice, revision: 2, name: '保存 A' }); }, voice);
    await expect.poll(() => page.getByLabel('声音名称').inputValue()).toBe('后续 B');
    await page.getByRole('button', { name: '保存声音档案', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[1])).toMatchObject({ kind: 'voice.save', payload: { id: 'voice-a', expectedRevision: 2, draft: { name: '后续 B' } } });
  }, { ...queries(), __entity: true, __localMedia: [media], 'creation.read': { entities: [entity], shots: [], scripts: [], selections: [] }, 'voice.list': { voices: [voice] } });
});

it('distinguishes same-name audio by fixed asset/version and auditions only local media', async () => {
  const other = { ...media, assetId: 'audio-two', version: 3 };
  await mounted(h, async page => {
    await page.getByRole('button', { name: '编辑 角色 A', exact: true }).click(); await page.getByRole('button', { name: '声音档案', exact: true }).click();
    await page.getByLabel('固定音频', { exact: true }).selectOption('audio-two:3');
    await page.evaluate(ref => window.p4Fixture.resolve({ ref, hash: 'b'.repeat(64), probe: { probeId: 'other-probe', durationTicks: 96000 } }), other);
    await page.getByLabel('声音名称').fill('同名文件的第二个声音');
    await expect.poll(() => page.getByLabel('固定版本音频预览').count()).toBe(1);
    expect(await page.evaluate(() => window.p4Fixture.calls)).toHaveLength(1);
    await page.getByRole('button', { name: '保存声音档案', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[1])).toMatchObject({ kind: 'voice.save', payload: { draft: { reference: { ref: other } } } });
  }, { ...queries(), __entity: true, __localMedia: [other], 'creation.read': { entities: [{ id: 'a', revision: 1, kind: 'character', name: '角色 A', description: '', constraints: '', references: [] }], shots: [], scripts: [], selections: [] }, 'voice.list': { voices: [] }, 'asset.search': { assets: [{ ref: media, name: '同名.wav', mime: 'audio/wav' }, { ref: other, name: '同名.wav', mime: 'audio/wav' }] } });
});

it('auditions the selected crop and clamps native audio seeking to its start/end', async () => {
  await mounted(h, async page => {
    const wave = Buffer.alloc(44 + 480000); wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(48000, 24); wave.writeUInt32LE(96000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(480000, 40);
    await page.route('**/fixture-proxy.wav?*', route => {
      const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      if (!range) return route.fulfill({ contentType: 'audio/wav', body: wave, headers: { 'Accept-Ranges': 'bytes' } });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), wave.length - 1) : wave.length - 1;
      return route.fulfill({ status: 206, contentType: 'audio/wav', body: wave.subarray(start, end + 1), headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wave.length}` } });
    });
    await page.getByRole('button', { name: '编辑 角色 A', exact: true }).click(); await page.getByRole('button', { name: '声音档案', exact: true }).click(); await page.getByLabel('现有声音修订').selectOption('voice-a');
    const player = page.getByLabel('固定版本音频预览');
    await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThan(0);
    await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.seekable.length ? audio.seekable.end(0) : 0)).toBe(5);
    await player.evaluate(async (audio: HTMLAudioElement) => { await audio.play(); });
    await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(1);
    await player.evaluate((audio: HTMLAudioElement) => { audio.currentTime = 0; audio.dispatchEvent(new Event('timeupdate')); });
    await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(1);
    await player.evaluate(async (audio: HTMLAudioElement) => { await audio.play(); audio.currentTime = 3; audio.dispatchEvent(new Event('timeupdate')); });
    expect(await player.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    expect(await page.evaluate(() => window.p4Fixture.calls)).toEqual([]);
  }, { ...queries(), __entity: true, __localMedia: [media], 'creation.read': { entities: [{ id: 'a', revision: 1, kind: 'character', name: '角色 A', description: '', constraints: '', references: [] }], shots: [], scripts: [], selections: [] }, 'voice.list': { voices: [{ ...voice, reference: { ...voice.reference, sourceInTicks: 48000, durationTicks: 96000 } }] } });
});

it('prepares a standard reference locally then explicitly saves the derived fixed audio as a new voice revision', async () => {
  await mounted(h, async page => {
    await page.getByRole('button', { name: '编辑 角色 A', exact: true }).click();
    await page.getByRole('button', { name: '声音档案', exact: true }).click();
    await page.getByLabel('现有声音修订').selectOption('voice-a');
    await page.getByRole('button', { name: '准备标准声音参考', exact: true }).click();
    expect(await page.evaluate(() => window.p4Fixture.calls[0])).toMatchObject({ kind: 'voice.prepareReference', payload: { voiceRef: { id: 'voice-a', revision: 1 } } });
    await page.evaluate(() => window.p4Fixture.resolve({ planId: 'local-plan', planHash: 'a'.repeat(64), executionOwner: 'desktop-user', runId: 'run', requiredFreeBytes: 100 }));
    await page.waitForFunction(() => window.p4Fixture.calls.length === 2);
    expect(await page.evaluate(() => window.p4Fixture.calls[1])).toMatchObject({ kind: 'media.enqueueDerived', payload: { planId: 'local-plan' } });
    await page.evaluate(() => window.p4Fixture.resolve({ jobId: 'local-job' }));
    await page.evaluate(() => window.p4Fixture.update({ 'render.read': { state: 'SUCCEEDED', outputRef: { kind: 'artifact', libraryId: 'library', artifactId: 'standard' } } }));
    await page.getByRole('button', { name: '将标准参考保存为新修订', exact: true }).click();
    await page.evaluate(() => window.p4Fixture.resolve({ ref: { kind: 'artifact', libraryId: 'library', artifactId: 'standard' }, hash: 'b'.repeat(64), probe: { probeId: 'standard-probe', durationTicks: 96000 } }));
    await page.waitForFunction(() => window.p4Fixture.calls.length === 4);
    expect(await page.evaluate(() => window.p4Fixture.calls[3])).toMatchObject({ kind: 'voice.save', payload: { id: 'voice-a', expectedRevision: 1, draft: { reference: { ref: { artifactId: 'standard' }, hash: 'b'.repeat(64), probeId: 'standard-probe', sourceInTicks: 0, durationTicks: 96000 } } } });
  }, { ...queries(), __entity: true, 'creation.read': { entities: [{ id: 'a', revision: 1, kind: 'character', name: '角色 A', description: '', constraints: '', references: [] }], shots: [], scripts: [], selections: [] }, 'voice.list': { voices: [{ ...voice, production: { ready: false, reason: 'REFERENCE_PREPARATION_REQUIRED' } }] }, 'asset.search': { assets: [{ name: '同名.wav', mime: 'audio/wav', ref: media }] } });
});
