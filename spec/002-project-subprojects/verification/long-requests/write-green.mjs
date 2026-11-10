import fs from'node:fs';import path from'node:path';const root='D:/movieAgent/libtv-studio',base='D:/movieAgent/spec/002-project-subprojects/verification/long-requests';
const write=(p,s)=>{const f=path.join(root,p),back=path.join(base,'before',p);if(!fs.existsSync(back)){fs.mkdirSync(path.dirname(back),{recursive:true});fs.copyFileSync(f,back)}fs.writeFileSync(f,s)};
const replace=(s,a,b)=>{if(!s.includes(a))throw Error('anchor missing: '+a.slice(0,65));return s.replace(a,b)};
let s=fs.readFileSync(path.join(root,'packages/engine/src/generation-service.ts'),'utf8');
s=replace(s,'export interface GenerationOptions {','const GENERATION_LEASE_MS = 10 * 60_000;\nconst LEASE_RENEW_INTERVAL_MS = 30_000;\n\nexport interface GenerationOptions {');
s=replace(s,'now() + 30000);','now() + GENERATION_LEASE_MS);');
const addition=`  function renewLease(attemptId: string, token: number): Result<void> {
    return atomic(() => {
      // Do not resurrect an expired worker or renew a different worker's token.
      if (!liveLease(attemptId, token)) return fail('STALE_LEASE', '工作者租约已失效。');
      library.db.prepare('UPDATE task_lease SET expires_at=? WHERE attempt_id=? AND token=? AND owner=?').run(now() + GENERATION_LEASE_MS, attemptId, token, library.instanceId);
      return ok(undefined);
    });
  }
  function keepLeaseAlive(attemptId: string, token: number): () => void {
    const timer = setInterval(() => {
      try { if (!renewLease(attemptId, token).ok) clearInterval(timer); }
      catch { clearInterval(timer); }
    }, LEASE_RENEW_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }
`;
s=replace(s,'  async function acquireDispatch(',addition+'  async function acquireDispatch(');
const start=s.indexOf('  async function reconcile(taskId:');const end=s.indexOf('  function release(',start);
let fn=s.slice(start,end);
fn=replace(fn,"    const prepared = preparedFor(task.value.attemptId);","    const stopRenewing = keepLeaseAlive(task.value.attemptId, lease.value.leaseToken);\n    try {\n    const prepared = preparedFor(task.value.attemptId);");
fn=fn.replaceAll('release(task.value.attemptId, lease.value.leaseToken);','');
const last=fn.lastIndexOf('\n  }');fn=fn.slice(0,last)+'\n    } finally { stopRenewing(); release(task.value.attemptId, lease.value.leaseToken); }'+fn.slice(last);
s=s.slice(0,start)+fn+s.slice(end);
s=replace(s,'read, claim, release, acquireDispatch','read, claim, renewLease, keepLeaseAlive, release, acquireDispatch');write('packages/engine/src/generation-service.ts',s);
s=fs.readFileSync(path.join(root,'packages/engine/src/scheduler.ts'),'utf8');
s=replace(s,'    const lease = generation.claim(attemptId); if (!lease.ok) return lease;\n    try {','    const lease = generation.claim(attemptId); if (!lease.ok) return lease;\n    const stopRenewing = generation.keepLeaseAlive(attemptId, lease.value.leaseToken);\n    try {');
s=replace(s,'} finally { generation.release(attemptId, lease.value.leaseToken); }','} finally { stopRenewing(); generation.release(attemptId, lease.value.leaseToken); }');write('packages/engine/src/scheduler.ts',s);
s=fs.readFileSync(path.join(root,'apps/desktop/src/main/model-config-import.ts'),'utf8');s=replace(s,'timeoutMs: 60000, concurrency: 1','timeoutMs: p.kind === \'text\' ? 300000 : 60000, concurrency: 1');write('apps/desktop/src/main/model-config-import.ts',s);
console.log('Long-request handling updated in three production files.');

