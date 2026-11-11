import {expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,realpath,stat,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';
import {createDirectoryProject,bindDirectoryProject} from '../../apps/desktop/src/main/project-directories.ts';
import {createProjectBackup,restoreProjectBackup,inspectProjectBackup} from '../../packages/storage/src/project-backup.ts';
import {startEngine,type EngineHandle} from '../../packages/engine/src/bootstrap.ts';
import {audioValue as value,audioExecute as execute,fixtureWav} from '../fixtures/audio-generation.ts';
it('backs up and reopens every voice purpose and pinned historical default without remote requests or quality claims',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'spec001-voice-backup-'));let engine:EngineHandle|undefined;
 try{
 const project=value(await createDirectoryProject({mode:'new',directory,name:'Voice backup'}));
 engine=value(await startEngine({root:project.libraryRoot,assets:{inspectAudio:async()=>({ok:true,value:{mime:'audio/wav',width:0,height:0}})}}));
 const projectId=value(await execute(engine!,'project.create',{name:'Voice backup'})).id,libraryId=engine!.identity.libraryId;
 value(await bindDirectoryProject(project.root,{workspaceId:project.manifest.workspaceId,libraryId,projectId}));
 value(await execute(engine!,'creation.saveEntity',{projectId,id:'a',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));
 const refs=[];for(const seconds of [20,2,3]){const path=join(directory,'sample-'+seconds+'.wav');await writeFile(path,fixtureWav(seconds));const info=await stat(path),grantId=crypto.randomUUID();value(engine!.assets.registerGrant({grantId,importId:crypto.randomUUID(),libraryId,expiresAt:Date.now()+60000,files:[{path,realPath:await realpath(path),allowedRoot:directory,name:'sample.wav',size:info.size,mtimeMs:info.mtimeMs,dev:info.dev,ino:info.ino}]}));const ref=value(await execute(engine!,'asset.importGrantedFiles',{grantId})).versions[0],metadata=value(engine!.assets.metadata(ref));refs.push({ref,hash:metadata.hash,probeId:null,sourceInTicks:0,durationTicks:seconds*48000});}
 const draft={entityRef:{id:'a',revision:1},name:'Voice',dialect:'山东话',performanceNotes:'',sourceKind:'sample',reference:refs[1],sourceSample:refs[0],videoReference:refs[1],baselineAudio:refs[2]};
 value(await execute(engine!,'voice.save',{projectId,id:'voice',expectedRevision:0,draft}));value(await execute(engine!,'voice.bindDefault',{projectId,characterId:'a',voiceRef:{id:'voice',revision:1},expectedRevision:0}));value(await execute(engine!,'voice.save',{projectId,id:'voice',expectedRevision:1,draft:{...draft,name:'Renamed'}}));
 await engine!.close();engine=undefined;
 const destination=join(directory,'backup');value(await createProjectBackup({projectRoot:project.root,destination,appVersion:'0.2.0'}));const manifest=value(await inspectProjectBackup(destination));expect(manifest.files.some((f:{path:string})=>/models.json|vault|credentials/.test(f.path))).toBe(false);
 const restored=value(await restoreProjectBackup({backupRoot:destination,destination:join(directory,'restored')}));expect(restored.scheduling).toBe('paused');
 engine=value(await startEngine({root:join(restored.root,'.movieagent','library')}));
 expect(value(engine!.voices.history({projectId})).voices.map((v:any)=>v.revision)).toEqual([1,2]);expect(value(engine!.voices.list({projectId})).defaultBindings[0].voiceRef).toEqual({id:'voice',revision:1});expect(value(engine!.voices.read({projectId,voiceRef:{id:'voice',revision:1}})).production.ready).toBe(false);
 for(const [index,source] of refs.entries()){const lease=value(await engine!.assets.openMediaRead(source.ref,source.hash)),chunks=[];try{for(let offset=0;offset<lease.byteLength;){const chunk=value(await engine!.assets.readMediaRange({leaseId:lease.leaseId,offset,length:Math.min(65536,lease.byteLength-offset)}));chunks.push(Buffer.from(chunk.bytes));offset+=chunk.bytes.length;}}finally{await engine!.assets.closeMediaRead(lease.leaseId);}expect(Buffer.concat(chunks)).toEqual(fixtureWav([20,2,3][index]!));}
 expect(JSON.stringify(manifest)).not.toContain('apiKey');expect(await readFile(join(restored.root,'movieagent.project.json'),'utf8')).toContain(libraryId);
 }finally{await engine?.close();const absolute=resolve(directory),temp=resolve(tmpdir())+sep;if(!absolute.toLowerCase().startsWith(temp.toLowerCase()))throw Error('Unexpected cleanup scope');await rm(absolute,{recursive:true,force:true});}
},120000);
