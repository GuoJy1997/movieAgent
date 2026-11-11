import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
export function lifecycleChild(root: string, endpoint: string, fault: string, action = 'crash') {
  const child = fork(resolve('tests/fixtures/lifecycle-child.ts'), [root, endpoint, fault, action], { execArgv: ['--experimental-strip-types'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const messages: any[] = []; let stderr = ''; child.stderr?.on('data', chunk => { stderr += String(chunk); }); child.stdout?.on('data', () => {});
  child.on('message', message => { messages.push(message); });
  return { child, async phase(phase: string): Promise<any> {
    const saved = messages.find(m => m.phase === phase); if (saved) return saved;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error(`Missing ${phase}: ${stderr}`)); }, 7000);
      const receive = (m: any) => { if (m.phase === phase) { cleanup(); resolve(m); } };
      const exit = (code: number | null) => { cleanup(); reject(Error(`Exit ${code} before ${phase}: ${stderr}`)); };
      function cleanup() { clearTimeout(timer); child.off('message', receive); child.off('exit', exit); }
      child.on('message', receive); child.on('exit', exit);
    });
  } };
}
export async function stopChild(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null) return; const stopped = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await stopped; }
