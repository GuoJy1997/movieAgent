import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{createRequire}from'node:module';
const root='D:/movieAgent/libtv-studio';const require=createRequire(path.join(root,'package.json'));const asar=require('@electron/asar');
const file=path.join(root,'apps/desktop/release-spec002/win-unpacked/resources/app.asar');
const list=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(dir,e.name)):[path.join(dir,e.name)]);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const results=list(path.join(root,'apps/desktop/out')).map(f=>{const entry=path.relative(path.join(root,'apps/desktop'),f).replaceAll('\\','/');let packaged;try{packaged=asar.extractFile(file,path.normalize(entry))}catch{}return {entry,sha256:hash(fs.readFileSync(f)),match:!!packaged&&hash(packaged)===hash(fs.readFileSync(f))};});
const result={verified:results.every(r=>r.match),count:results.length,files:results};fs.writeFileSync('D:/movieAgent/spec/002-project-subprojects/verification/frozen-package-hashes.json',JSON.stringify(result,null,2));console.log(JSON.stringify({verified:result.verified,count:result.count,mismatches:results.filter(r=>!r.match)}));if(!result.verified)process.exitCode=1;
