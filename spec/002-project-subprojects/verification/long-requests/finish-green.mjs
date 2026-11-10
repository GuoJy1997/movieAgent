import fs from'node:fs';import path from'node:path';const root='D:/movieAgent/libtv-studio',base='D:/movieAgent/spec/002-project-subprojects/verification/long-requests';
function write(p,s){const f=path.join(root,p),b=path.join(base,'before',p);if(!fs.existsSync(b)){fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(f,b)}fs.writeFileSync(f,s)}
let p='packages/engine/src/scheduler.ts',s=fs.readFileSync(path.join(root,p),'utf8').replaceAll('\r\n','\n');
const anchor='    const lease = generation.claim(attemptId); if (!lease.ok) return lease;\n    try {';if(!s.includes(anchor))throw Error('scheduler anchor');s=s.replace(anchor,'    const lease = generation.claim(attemptId); if (!lease.ok) return lease;\n    const stopRenewing = generation.keepLeaseAlive(attemptId, lease.value.leaseToken);\n    try {').replace('} finally { generation.release(attemptId, lease.value.leaseToken); }','} finally { stopRenewing(); generation.release(attemptId, lease.value.leaseToken); }');write(p,s);
p='apps/desktop/src/main/model-config-import.ts';s=fs.readFileSync(path.join(root,p),'utf8').replace('timeoutMs: 60000, concurrency: 1',"timeoutMs: p.kind === 'text' ? 300000 : 60000, concurrency: 1");write(p,s);
p='packages/engine/src/generation-service.ts';s=fs.readFileSync(path.join(root,p),'utf8').replaceAll('\r\n','\n');
const start=s.indexOf('    const stopRenewing = keepLeaseAlive',s.indexOf('  async function reconcile(')),end=s.indexOf('    } finally { stopRenewing(); release(',start);
let chunk=s.slice(start,end);const t=chunk.indexOf('    try {\n');let body=chunk.slice(t+'    try {\n'.length).replaceAll('release(task.value.attemptId,lease.value.leaseToken);','').replaceAll('{  return','{ return');body=body.split('\n').map(l=>l?'  '+l:l).join('\n');chunk=chunk.slice(0,t+'    try {\n'.length)+body;s=s.slice(0,start)+chunk+s.slice(end);write(p,s);
console.log('All three production edits applied.');

