import fs from'node:fs';import path from'node:path';
const base='D:/movieAgent/spec/002-project-subprojects',e=base+'/verification/live-20261031/long-request',config=JSON.parse(fs.readFileSync('D:/movieAgent/libtv-studio/config/models.json','utf8')),keys=config.providers.map(x=>x.apiKey).filter(Boolean);
const candidates=fs.readdirSync(e).map(n=>path.join(e,n)).filter(f=>fs.statSync(f).isFile()&&/\.(json|jsonl|txt|mjs)$/.test(f));
const leaked=candidates.filter(f=>keys.some(key=>fs.readFileSync(f,'utf8').includes(key)));
const r=JSON.parse(fs.readFileSync(e+'/result.json','utf8'));
for(const name of ['README.md','002-project-subprojects/spec.md','002-project-subprojects/implementation.md','002-project-subprojects/real-text-acceptance.md']){const p=path.join('D:/movieAgent/spec',name);if(!fs.existsSync(p))throw Error('MISSING_DOC');}
if(leaked.length)throw Error('KEY_PRESENT_IN_EVIDENCE');
if(!r.reopenVerified||r.newTasks.length!==3||!r.newTasks.every(x=>x.state==='SUCCEEDED')||!r.agent.accepted||r.memory.state!=='ready')throw Error('FINAL_PROOF_INCOMPLETE');
console.log(JSON.stringify({status:r.status,newTextRequests:r.realNewTextRequests,additionalVideoRequests:r.additionalVideoRequests,memoryState:r.memory.state,agentAccepted:r.agent.accepted,reopenVerified:r.reopenVerified,originalUnknown:r.originalUnknown.state,concurrency:r.settings.concurrency,outputTokens:r.settings.maxCompletionTokens,evidenceKeyScan:'passed',report:base+'/real-text-acceptance.md'},null,2));
