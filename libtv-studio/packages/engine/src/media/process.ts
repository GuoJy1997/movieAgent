import { spawn } from 'node:child_process';
import { realpath, lstat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import type { MediaRuntime } from '../../../contracts/src/media-info.ts';
import { fail, ok, type Result } from '../../../contracts/src/result.ts';
const issued = new WeakSet<object>();
export interface CompiledProcessRequest { readonly tool: 'ffmpeg' | 'ffprobe'; readonly runtime: MediaRuntime; readonly args: readonly string[]; readonly stagingRoot: string; readonly timeoutMs: number; readonly maxStdoutBytes: number; readonly onProgress?: (ticks: number) => void }
export interface ProcessOutcome { exitCode: number; stdout: string; stderr: string }
/** Only engine compilers call this. This object never crosses IPC or a public command boundary. */
export function compileMediaProcess(request: CompiledProcessRequest): CompiledProcessRequest {
  const runtime = Object.freeze({ ...request.runtime, fontManifest: Object.freeze({ ...request.runtime.fontManifest }) });
  const result = Object.freeze({ ...request, runtime, args: Object.freeze([...request.args]) }); issued.add(result); return result;
}
const inside = (root: string, path: string) => { const r = relative(root, path); return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
export async function assertStagedFile(root: string, path: string): Promise<void> {
  if (!isAbsolute(root) || !isAbsolute(path) || !inside(root, path) || (await realpath(path)).toLowerCase() !== path.toLowerCase() || !(await lstat(path)).isFile()) throw Error('INVALID_STAGING_PATH');
}
export async function runMediaProcess(request: CompiledProcessRequest, signal: AbortSignal): Promise<Result<ProcessOutcome>> {
  if (!issued.has(request) || !isAbsolute(request.stagingRoot) || !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 1800000 || !Number.isSafeInteger(request.maxStdoutBytes) || request.maxStdoutBytes < 1 || request.maxStdoutBytes > 1024 * 1024 || !/^[a-f0-9]{64}$/.test(request.runtime.runtimeHash)) return fail('MEDIA_PROCESS_DENIED', '媒体处理请求无效。');
  if (signal.aborted) return fail('MEDIA_CANCELLED', '本地媒体处理已取消。');
  const executable = request.tool === 'ffprobe' ? request.runtime.ffprobePath : request.runtime.ffmpegPath;
  try { if (!isAbsolute(executable) || !(await lstat(executable)).isFile() || (await realpath(executable)).toLowerCase() !== executable.toLowerCase()) throw Error('invalid'); }
  catch { return signal.aborted ? fail('MEDIA_CANCELLED', '本地媒体处理已取消。') : fail('MEDIA_RUNTIME_UNAVAILABLE', '固定媒体运行时不可用。'); }
  if (signal.aborted) return fail('MEDIA_CANCELLED', '本地媒体处理已取消。');
  return new Promise(resolve => {
    let done = false, reason: string | undefined, out = Buffer.alloc(0), err = Buffer.alloc(0), killTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(executable, [...request.args], { cwd: request.stagingRoot, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = (code: string) => { if (reason) return; reason = code; child.kill('SIGTERM'); killTimer = setTimeout(() => { if (!done) child.kill('SIGKILL'); }, 5000); };
    const cancel = () => stop('MEDIA_CANCELLED');
    const timeout = setTimeout(() => stop('MEDIA_PROCESS_TIMEOUT'), request.timeoutMs);
    const finish = (result: Result<ProcessOutcome>) => { if (done) return; done = true; clearTimeout(timeout); clearTimeout(killTimer); signal.removeEventListener('abort', cancel); resolve(result); };
    let progressBuffer = '';
    child.stdout.on('data', (bytes: Buffer) => {
      if (out.length + bytes.length > request.maxStdoutBytes) stop('MEDIA_PROCESS_OUTPUT_LIMIT');
      else out = Buffer.concat([out, bytes]);
      progressBuffer += bytes.toString('utf8');
      const lines = progressBuffer.split('\n');
      progressBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const match = /^out_time_us=(\d+)$/.exec(line.trim());
        if (match) {
          try { request.onProgress?.(Math.floor(Number(match[1]) * 48000 / 1000000)); }
          catch { stop('MEDIA_PROGRESS_FAILED'); }
        }
      }
    });
    child.stderr.on('data', (bytes: Buffer) => { err = Buffer.concat([err, bytes]).subarray(-256 * 1024); });
    child.on('error', () => finish(fail('MEDIA_PROCESS_FAILED', '本地媒体进程无法启动。')));
    child.on('close', code => finish(reason ? fail(reason, '本地媒体处理已停止。') : code !== 0 ? fail('INVALID_MEDIA', '媒体无法通过受限解码验证。') : ok({ exitCode: 0, stdout: out.toString('utf8'), stderr: err.toString('utf8') })));
    signal.addEventListener('abort', cancel, { once: true });
    // AbortSignal does not replay an event that arrived while validating or spawning.
    if (signal.aborted) cancel();
  });
}
