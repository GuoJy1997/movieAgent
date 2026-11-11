import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { MediaRuntime, MediaProbe } from '../../../contracts/src/media-info.ts';
import type { RenderPlan } from '../../../contracts/src/render.ts';
import { fail, ok, type Result } from '../../../contracts/src/result.ts';
import { assertStagedFile, compileMediaProcess, runMediaProcess } from './process.ts';
import { probeMediaFile } from './probe.ts';
export interface VerifiedRenderOutput {
    hash: string;
    byteLength: number;
    mime: string;
    width: number;
    height: number;
    probe: MediaProbe;
}
export async function hashMediaFile(path: string, maxBytes: number, signal: AbortSignal): Promise<Result<{
    hash: string;
    byteLength: number;
    identity: string;
}>> {
    const file = await open(path, 'r');
    try {
        const before = await file.stat({
            bigint: true
        });
        const identity = (value: typeof before) => [value.size, value.dev, value.ino, value.mtimeNs, value.ctimeNs].join(':');
        if (!before.isFile() || before.size < 1n || before.size > BigInt(maxBytes))
            return fail('OUTPUT_TOO_LARGE', '产物大小不符合上限。');
        const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
        let total = 0;
        for (;;) {
            if (signal.aborted)
                return fail('MEDIA_CANCELLED', '本地校验已取消。');
            const { bytesRead } = await file.read(buffer);
            if (!bytesRead)
                break;
            total += bytesRead;
            if (total > maxBytes)
                return fail('OUTPUT_TOO_LARGE', '产物超出上限。');
            hash.update(buffer.subarray(0, bytesRead));
        }
        const after = await file.stat({
            bigint: true
        });
        if (BigInt(total) !== before.size || identity(before) !== identity(after))
            return fail('OBJECT_INTEGRITY_FAILED', '校验期间文件发生改变。');
        return ok({
            hash: hash.digest('hex'), byteLength: total, identity: identity(after)
        });
    }
    finally {
        await file.close();
    }
}
export async function verifyRenderOutput(plan: RenderPlan, runtime: MediaRuntime, stagingRoot: string, path: string, signal: AbortSignal): Promise<Result<VerifiedRenderOutput>> {
    try {
        await assertStagedFile(stagingRoot, path);
        const hashed = await hashMediaFile(path, plan.maxOutputBytes, signal);
        if (!hashed.ok)
            return hashed;
        const probe = await probeMediaFile(runtime, path, stagingRoot, hashed.value.hash, signal);
        if (!probe.ok)
            return probe;
        const audio = probe.value.streams.filter(stream => stream.kind === 'audio');
        const video = probe.value.streams.filter(stream => stream.kind === 'video');
        const tolerance = 48000 / plan.timeline.fps.num;
        if (Math.abs(probe.value.durationTicks - plan.durationTicks) > tolerance || audio.length !== 1 || audio[0]!.sampleRate !== 48000 || audio[0]!.channels !== 2 || Math.abs(audio[0]!.durationTicks - plan.durationTicks) > tolerance)
            return fail('OUTPUT_SPEC_MISMATCH', '音频或总长不符合冻结计划。');
        if (plan.purpose === 'wav' ? video.length !== 0 || audio[0]!.codec !== 'pcm_s16le' : video.length !== 1 || video[0]!.codec !== 'h264' || audio[0]!.codec !== 'aac' || video[0]!.width !== plan.timeline.canvas.width || video[0]!.height !== plan.timeline.canvas.height || video[0]!.averageFrameRate !== plan.timeline.fps.num + '/1' || video[0]!.sampleAspectRatio !== '1:1' || video[0]!.colorSpace !== 'bt709' || video[0]!.colorTransfer !== 'bt709' || video[0]!.colorPrimaries !== 'bt709')
            return fail('OUTPUT_SPEC_MISMATCH', '视频规格不符合冻结计划。');
        const decoded = await runMediaProcess(compileMediaProcess({
            tool: 'ffmpeg', runtime, stagingRoot, timeoutMs: 1800000, maxStdoutBytes: 4096, args: [
                '-v', 'error', '-nostdin', '-xerror', '-threads', '4', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'wav,mov', '-max_streams', '2', '-i', path, '-map', '0:a:0', ...(plan.purpose === 'wav' ? [] : ['-map', '0:v:0']), '-sn', '-dn', '-threads', '4', '-f', 'null', '-'
            ]
        }), signal);
        if (!decoded.ok)
            return decoded;
        const rehashed = await hashMediaFile(path, plan.maxOutputBytes, signal);
        if (!rehashed.ok)
            return rehashed;
        if (rehashed.value.hash !== hashed.value.hash)
            return fail('OBJECT_INTEGRITY_FAILED', '解码期间产物已改变。');
        return ok({
            ...hashed.value, mime: plan.purpose === 'wav' ? 'audio/wav' : 'video/mp4', width: probe.value.width, height: probe.value.height, probe: probe.value
        });
    }
    catch {
        return fail('OUTPUT_VERIFICATION_FAILED', '产物未通过完整校验。');
    }
}
