import {renderSegmentedMedia,DEFAULT_SEGMENT_BUDGET} from './render-segments.ts';
import { writeFile, stat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { MediaRuntime } from '../../../contracts/src/media-info.ts';
import type { RenderPlan } from '../../../contracts/src/render.ts';
import { fail, type Result } from '../../../contracts/src/result.ts';
import { subtitleDocument } from '../../../domain/src/subtitle-format.ts';
import { assertStagedFile, compileMediaProcess, runMediaProcess, type ProcessOutcome } from './process.ts';
import { audioFilters, pictureFilters } from './normalize.ts';
const filterPath = (value: string) => value.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''");
export function renderInputArguments(mime: string, relativePath: string): string[] {
    const demuxer = mime === 'video/mp4' || mime === 'audio/mp4' ? 'mov' : mime === 'audio/wav' ? 'wav' : mime === 'audio/mpeg' ? 'mp3' : mime === 'image/png' ? 'png_pipe' : mime === 'image/jpeg' ? 'jpeg_pipe' : mime === 'image/webp' ? 'webp_pipe' : undefined;
    if (!demuxer || !/^[a-zA-Z0-9_.-]+$/.test(relativePath))
        throw Error('INVALID_STAGING_PATH');
    return [
        '-threads', '4', '-protocol_whitelist', 'file', '-f', demuxer, '-max_streams', '4', ...(mime === 'video/mp4' ? ['-noautorotate'] : []), '-i', relativePath
    ];
}
export const renderCommandLength = (executable: string, args: readonly string[]) => executable.length + 3 + args.reduce((size, arg) => size + arg.length + 3, 0);
/** Privileged compiler: all inputs are copied fixed originals in this job's directory. */
export async function renderSingleMedia(plan: RenderPlan, runtime: MediaRuntime, stagingRoot: string, inputs: string[], output: string, signal: AbortSignal, onProgress?: (ticks: number) => void, mode?: 'pcm-segment'|'video-segment'): Promise<Result<ProcessOutcome>> {
    try {
        if (runtime.runtimeHash !== plan.manifest.runtimeHash || runtime.fontManifest.sha256 !== plan.manifest.fontHash || inputs.length !== plan.manifest.entries.length)
            return fail('RUNTIME_CHANGED', '固定运行时已改变。');
        const outputRelative = relative(stagingRoot, output);
        if (!isAbsolute(output) || outputRelative.startsWith('..') || isAbsolute(outputRelative) || (await realpath(dirname(output))).toLowerCase() !== dirname(output).toLowerCase())
            return fail('INVALID_STAGING_PATH', '输出目录无效。');
        for (const input of inputs)
            await assertStagedFile(stagingRoot, input);
        if (signal.aborted)
            return fail('MEDIA_CANCELLED', '本地渲染已取消。');
        const timeline = plan.timeline, duration = plan.durationTicks / 48000;
        const args = [
            '-hide_banner', '-nostdin', '-y', '-v', 'info', '-xerror', '-max_alloc', '67108864', '-filter_complex_threads', '4', '-copyts'
        ];
        for (let index = 0; index < inputs.length; index++) {
            const media = plan.manifest.entries[index]!;
            if (media.mime.startsWith('image/'))
                args.push('-loop', '1');
            args.push(...renderInputArguments(media.mime, relative(stagingRoot, inputs[index]!)));
        }
        const filters: string[] = ['anullsrc=r=48000:cl=stereo,atrim=duration=' + duration + '[silence]'];
        const audio = ['[silence]'];
        let video = 'base';
        if (plan.purpose !== 'wav') {
            filters.push('color=c=black:s=' + timeline.canvas.width + 'x' + timeline.canvas.height + ':r=' + timeline.fps.num + ':d=' + duration + ',format=yuv420p[base]');
        }
        const clips = [...timeline.videoClips, ...timeline.audioClips];
        for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
            const clip = clips[clipIndex]!;
            const index = plan.manifest.entries.findIndex(media => JSON.stringify(media.ref) === JSON.stringify(clip.media));
            const media = plan.manifest.entries[index]!;
            const origin = media.probe?.originSeconds ?? 0;
            if (clip.kind !== 'audio' && plan.purpose !== 'wav') {
                const label = 'picture' + clipIndex, next = 'composite' + clipIndex;
                const source = media.probe?.streams.find(stream => stream.kind === 'video')?.index ?? 0;
                filters.push('[' + index + ':' + source + ']setpts=PTS-' + origin + '/TB,trim=start=' + clip.sourceInTicks / 48000 + ':end=' + (clip.sourceInTicks + clip.durationTicks) / 48000 + ',' + pictureFilters(media.probe, timeline, clip.fit) + ',fps=' + timeline.fps.num + ',setpts=PTS-' + clip.sourceInTicks / 48000 + '/TB+' + clip.startTicks / 48000 + '/TB[' + label + ']');
                filters.push('[' + video + '][' + label + ']overlay=eof_action=pass:repeatlast=0:shortest=0:enable=\'gte(round(t*48000),' + clip.startTicks + ')*lt(round(t*48000),' + (clip.startTicks + clip.durationTicks) + ')\'[' + next + ']');
                video = next;
            }
            const audioStream = media.probe?.streams.find(stream => stream.kind === 'audio');
            if (!clip.mute && clip.gainMilli > 0 && clip.kind !== 'image' && audioStream) {
                const label = 'audio' + clipIndex;
                filters.push('[' + index + ':' + audioStream.index + ']' + audioFilters(origin, clip.sourceInTicks, clip.durationTicks, clip.startTicks, clip.gainMilli) + '[' + label + ']');
                audio.push('[' + label + ']');
            }
        }
        filters.push(audio.join('') + 'amix=inputs=' + audio.length + ':duration=longest:dropout_transition=0:normalize=0,' + (mode==='pcm-segment'?'':'alimiter=limit=0.95:level=0:latency=1,') + 'apad,atrim=end_sample=' + plan.durationTicks + ',asetpts=N/SR/TB[aout]');
        // Independent segments must share zero decode reordering, including a one-frame tail.
        // Otherwise concat stream-copy stretches the preceding packet DTS/duration.
        if (mode === 'video-segment') filters.push('[aout]anullsink');
        if (plan.purpose !== 'wav') {
            if (timeline.subtitleCues.length && plan.burnSubtitles!==false) {
                const ass = join(stagingRoot, 'captions.ass');
                await writeFile(ass, subtitleDocument(timeline), {
                    mode: 0o600
                });
                filters.push('[' + video + ']ass=filename=\'' + filterPath(ass) + '\':fontsdir=\'' + filterPath(dirname(runtime.ffmpegPath)) + '\'[subtitled]');
                video = 'subtitled';
            }
            args.push('-/filter_complex', 'filters.txt', '-map', '[' + video + ']', ...(mode === 'video-segment' ? ['-an'] : ['-map', '[aout]']), '-c:v', 'libx264', ...(mode === 'video-segment' ? ['-bf', '0'] : []), '-threads', '4', '-preset', 'veryfast', '-crf', plan.purpose === 'preview' ? '28' : '18', '-pix_fmt', 'yuv420p', '-r', String(timeline.fps.num), '-fps_mode', 'cfr', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-video_track_timescale','48000', '-f', 'mp4');
        }
        else
            args.push('-/filter_complex', 'filters.txt', '-map', '[aout]', '-vn', '-c:a', mode==='pcm-segment'?'pcm_f32le':'pcm_s16le', '-ar', '48000', '-ac', '2', '-f', mode==='pcm-segment'?'f32le':'wav');
        if (plan.purpose !== 'wav')
            args.push('-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709');
        await writeFile(join(stagingRoot, 'filters.txt'), filters.join(';'), {
            mode: 0o600
        });
        args.push('-t', String(duration), '-fs', String(plan.maxOutputBytes + 1), '-progress', 'pipe:1', '-nostats', output);
        if (renderCommandLength(runtime.ffmpegPath, args) > 30000)
            return fail('MEDIA_COMMAND_LIMIT', '本机暂存目录长度超出命令边界。');
        const result = await runMediaProcess(compileMediaProcess({
            tool: 'ffmpeg', runtime, stagingRoot, timeoutMs: 1800000, maxStdoutBytes: 1024 * 1024, args, ...(onProgress ? {
                onProgress
            } : {})
        }), signal);
        if (result.ok && (await stat(output)).size > plan.maxOutputBytes)
            return fail('OUTPUT_TOO_LARGE', '渲染产物超出上限。');
        if (result.ok && timeline.subtitleCues.length && plan.purpose !== 'wav' && plan.burnSubtitles!==false && (!/fontselect:.*NotoSansCJKsc-Regular/.test(result.value.stderr) || /Glyph .* not found/.test(result.value.stderr)))
            return fail('FONT_SELECTION_FAILED', '未核验到固定字幕字体。');
        return result;
    }
    catch {
        return fail('MEDIA_RENDER_FAILED', '本地渲染失败，原件保持不变。');
    }
}

/** Execution strategy only; never changes the frozen recipe or revision. */
export async function renderMedia(plan:RenderPlan,runtime:MediaRuntime,root:string,inputs:string[],output:string,signal:AbortSignal,onProgress?:(ticks:number)=>void,intermediateBudgetBytes=plan.intermediateBudgetBytes??DEFAULT_SEGMENT_BUDGET):Promise<Result<ProcessOutcome>>{
 const estimate=renderCommandLength(runtime.ffmpegPath,plan.manifest.entries.flatMap((m,i)=>renderInputArguments(m.mime,relative(root,inputs[i]!))));
 return inputs.length<=32&&estimate<28000
  ?renderSingleMedia(plan,runtime,root,inputs,output,signal,onProgress)
  :renderSegmentedMedia(plan,runtime,root,inputs,output,signal,renderSingleMedia,onProgress,intermediateBudgetBytes);
};
