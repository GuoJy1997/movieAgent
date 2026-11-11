import { fail, ok, type Result } from '../../contracts/src/result.ts';
export interface VideoMetadata { mime: 'video/mp4'; width: number; height: number; durationSeconds: number }
interface Box { type: string; start: number; end: number }
/** Bounded ISO BMFF structural validation, not a claim that compressed samples fully decode.
 * Supports self-contained, non-fragmented avc1/H.264 MP4 with actual sample tables and mdat data.
 * Unknown/fragmented containers fail closed; no subprocess, URL fetch or external codec is used. */
export function inspectMp4(bytes: Uint8Array): Result<VideoMetadata> {
  try {
    if (bytes.byteLength > 64 * 1024 * 1024 || bytes.byteLength < 32) throw Error();
    const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let boxesRead = 0;
    function boxes(start: number, end: number): Box[] {
      const result: Box[] = [];
      while (start < end) {
        if (++boxesRead > 10000 || end - start < 8) throw Error();
        const short = b.readUInt32BE(start), type = b.toString('ascii', start + 4, start + 8);
        const header = short === 1 ? 16 : 8;
        if (start + header > end) throw Error();
        const size = short === 1 ? Number(b.readBigUInt64BE(start + 8)) : short === 0 ? end - start : short;
        if (!Number.isSafeInteger(size) || size < header || size > end - start) throw Error();
        result.push({ type, start: start + header, end: start + size }); start += size;
      }
      return result;
    }
    function one(list: Box[], type: string): Box { const found = list.filter(v => v.type === type); if (found.length !== 1) throw Error(); return found[0]!; }
    function length(box: Box, min: number) { if (box.end - box.start < min) throw Error(); }
    function table(box: Box, stride: number): number {
      length(box, 8); const count = b.readUInt32BE(box.start + 4);
      if (!count || count > 1000000 || box.end - box.start !== 8 + stride * count) throw Error();
      return count;
    }
    function header(box: Box, v0Length: number, v1Length: number): number {
      length(box, 4); const version = b[box.start]!;
      if (version !== 0 && version !== 1 || box.end - box.start !== (version === 1 ? v1Length : v0Length)) throw Error();
      return version;
    }
    function avcConfiguration(box: Box) {
      length(box, 7);
      const start = box.start, profile = b[start + 1]!;
      if (b[start] !== 1 || ![66,77,88,100,110,122,144].includes(profile) || (b[start + 2]! & 3) !== 0 || !b[start + 3] || (b[start + 4]! & 0xfc) !== 0xfc || (b[start + 4]! & 3) === 2 || (b[start + 5]! & 0xe0) !== 0xe0) throw Error();
      let cursor = start + 6;
      function nalUnits(count: number, type: number) {
        for (let i = 0; i < count; i++) {
          if (cursor + 2 > box.end) throw Error();
          const size = b.readUInt16BE(cursor); cursor += 2;
          if (size < (type === 7 ? 4 : 2) || size > box.end - cursor || (b[cursor]! & 0x80) !== 0 || (b[cursor]! & 31) !== type) throw Error();
          // The record's profile/compatibility/level describe the first SPS.
          if (type === 7 && i === 0 && (b[cursor + 1] !== profile || b[cursor + 2] !== b[start + 2] || b[cursor + 3] !== b[start + 3])) throw Error();
          cursor += size;
        }
      }
      const spsCount = b[start + 5]! & 31; if (!spsCount) throw Error(); nalUnits(spsCount, 7);
      if (cursor >= box.end) throw Error();
      const ppsCount = b[cursor++]!; if (!ppsCount) throw Error(); nalUnits(ppsCount, 8);
      // Older AVC records can end after PPS. If present, validate the entire high-profile extension.
      if (cursor < box.end) {
        if (![100,110,122,144].includes(profile) || box.end - cursor < 4 || (b[cursor]! & 0xfc) !== 0xfc || (b[cursor + 1]! & 0xf8) !== 0xf8 || (b[cursor + 2]! & 0xf8) !== 0xf8 || (b[cursor + 1]! & 7) > 6 || (b[cursor + 2]! & 7) > 6) throw Error();
        const extendedCount = b[cursor + 3]!; cursor += 4; nalUnits(extendedCount, 13);
      }
      if (cursor !== box.end) throw Error();
    }
    const root = boxes(0, b.length), ftyp = one(root, 'ftyp'); length(ftyp, 8);
    if ((ftyp.end - ftyp.start) % 4 || !['isom','iso2','iso3','iso4','iso5','iso6','mp41','mp42','avc1','M4V '].includes(b.toString('ascii', ftyp.start, ftyp.start + 4)) || root.some(v => v.type === 'moof')) throw Error();
    const data = root.filter(v => v.type === 'mdat' && v.end > v.start); if (!data.length) throw Error();
    const moov = one(root, 'moov'), movie = boxes(moov.start, moov.end), mvhd = one(movie, 'mvhd'), movieVersion = header(mvhd, 100, 112);
    const movieScale = b.readUInt32BE(mvhd.start + (movieVersion === 1 ? 20 : 12));
    const movieTicks = movieVersion === 1 ? Number(b.readBigUInt64BE(mvhd.start + 24)) : b.readUInt32BE(mvhd.start + 16);
    if ((b.readUInt32BE(mvhd.start) & 0xffffff) !== 0 || !movieScale || !Number.isSafeInteger(movieTicks) || movieTicks <= 0 || movieTicks / movieScale > 86400) throw Error();
    const tracks = movie.filter(v => v.type === 'trak'), trackIds = new Set<number>();
    if (!tracks.length || tracks.length > 32) throw Error();
    let video: VideoMetadata | undefined;
    for (const track of tracks) {
      const trackBoxes = boxes(track.start, track.end), tkhd = one(trackBoxes, 'tkhd'), trackVersion = header(tkhd, 84, 96);
      const trackId = b.readUInt32BE(tkhd.start + (trackVersion === 1 ? 20 : 12));
      if (!trackId || trackIds.has(trackId)) throw Error(); trackIds.add(trackId);
      const mdia = one(trackBoxes, 'mdia'), media = boxes(mdia.start, mdia.end), handler = one(media, 'hdlr'); length(handler, 24);
      if (b.toString('ascii', handler.start + 8, handler.start + 12) !== 'vide') continue;
      const mdhd = one(media, 'mdhd'); length(mdhd, 24);
      const version = b[mdhd.start]; if (version !== 0 && version !== 1) throw Error();
      length(mdhd, version === 1 ? 36 : 24);
      const timescale = b.readUInt32BE(mdhd.start + (version === 1 ? 20 : 12));
      const ticks = version === 1 ? Number(b.readBigUInt64BE(mdhd.start + 24)) : b.readUInt32BE(mdhd.start + 16);
      const durationSeconds = ticks / timescale;
      if (!Number.isSafeInteger(ticks) || !timescale || durationSeconds <= 0 || durationSeconds > 86400) throw Error();
      const minf = one(media, 'minf'), info = boxes(minf.start, minf.end), dinf = one(info, 'dinf');
      const dref = one(boxes(dinf.start, dinf.end), 'dref'); length(dref, 8);
      const references = boxes(dref.start + 8, dref.end);
      if (b.readUInt32BE(dref.start + 4) !== references.length || !references.length || references.some(r => r.type !== 'url ' || r.end - r.start !== 4 || b.readUInt32BE(r.start) !== 1)) throw Error();
      const stbl = one(info, 'stbl'), samples = boxes(stbl.start, stbl.end), stsd = one(samples, 'stsd'); length(stsd, 8);
      const descriptions = boxes(stsd.start + 8, stsd.end);
      if (descriptions.length !== 1 || b.readUInt32BE(stsd.start + 4) !== 1) throw Error();
      const entry = descriptions[0]!; length(entry, 78);
      if (entry.type !== 'avc1' || b.readUInt16BE(entry.start + 6) < 1 || b.readUInt16BE(entry.start + 6) > references.length) throw Error();
      const width = b.readUInt16BE(entry.start + 24), height = b.readUInt16BE(entry.start + 26);
      if (!width || !height || width * height > 40000000) throw Error();
      const codec = boxes(entry.start + 78, entry.end);
      avcConfiguration(one(codec, 'avcC'));
      const stsz = one(samples, 'stsz'); length(stsz, 12);
      const fixedSize = b.readUInt32BE(stsz.start + 4), count = b.readUInt32BE(stsz.start + 8);
      if (!count || count > 1000000 || stsz.end - stsz.start !== 12 + (fixedSize ? 0 : count * 4)) throw Error();
      const offsets = samples.filter(v => v.type === 'stco' || v.type === 'co64'); if (offsets.length !== 1) throw Error();
      const offset = offsets[0]!, offsetStride = offset.type === 'co64' ? 8 : 4, chunks = table(offset, offsetStride);
      const stsc = one(samples, 'stsc'), mappings = table(stsc, 12);
      const mapping: { first: number; count: number }[] = [];
      for (let i = 0; i < mappings; i++) {
        const pos = stsc.start + 8 + i * 12, first = b.readUInt32BE(pos), perChunk = b.readUInt32BE(pos + 4);
        if (!perChunk || first > chunks || (i === 0 ? first !== 1 : first <= mapping[i - 1]!.first) || b.readUInt32BE(pos + 8) !== 1) throw Error();
        mapping.push({ first, count: perChunk });
      }
      let index = 0, mappingIndex = 0;
      for (let chunk = 1; chunk <= chunks; chunk++) {
        if (mapping[mappingIndex + 1]?.first === chunk) mappingIndex++;
        const sampleCount = mapping[mappingIndex]!.count;
        if (sampleCount > count - index) throw Error();
        let size = 0;
        for (let i = 0; i < sampleCount; i++, index++) { const next = fixedSize || b.readUInt32BE(stsz.start + 12 + index * 4); if (!next) throw Error(); size += next; }
        const pos = offset.start + 8 + (chunk - 1) * offsetStride, start = offsetStride === 8 ? Number(b.readBigUInt64BE(pos)) : b.readUInt32BE(pos);
        if (!Number.isSafeInteger(start) || !data.some(d => start >= d.start && start <= d.end - size)) throw Error();
      }
      if (index !== count) throw Error();
      const stts = one(samples, 'stts'), timings = table(stts, 8); let timed = 0, duration = 0;
      for (let i = 0; i < timings; i++) { const pos = stts.start + 8 + i * 8, n = b.readUInt32BE(pos), delta = b.readUInt32BE(pos + 4); if (!n || !delta) throw Error(); timed += n; duration += n * delta; }
      if (timed !== count || !Number.isSafeInteger(duration) || duration !== ticks) throw Error();
      video ??= { mime: 'video/mp4', width, height, durationSeconds };
    }
    return video ? ok(video) : fail('INVALID_VIDEO', 'MP4 不包含有效视频轨道。');
  } catch { return fail('INVALID_VIDEO', 'MP4 结构不完整、超限或不受支持。'); }
}
