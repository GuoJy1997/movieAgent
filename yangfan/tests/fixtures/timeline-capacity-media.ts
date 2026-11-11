import {mkdir,writeFile,stat,realpath} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {createDirectoryProject,bindDirectoryProject} from '../../apps/desktop/src/main/project-directories.ts';
import {loadMediaRuntime} from '../../packages/engine/src/media/manifest.ts';
import {startEngine} from '../../packages/engine/src/bootstrap.ts';
import {isRecord,type Result} from '../../packages/contracts/src/result.ts';
export function value<T>(r:Result<T>):T{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
export function wav(samples:number,freq:number,amplitude=4000):Buffer{
 const b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*freq*i/48000)*amplitude),44+i*2);return b;
}
export async function seedCapacityProject(root:string,count:number,clipTicks:number,voiceCount:number,runtimeDirectory=resolve('apps/desktop/resources/media-runtime/win32-x64')){
 await mkdir(root,{recursive:true});const folder=join(root,'中文 空格 短剧项目');await mkdir(folder);
 const project=value(await createDirectoryProject({mode:'existing',directory:folder,name:'SPEC003 '+count+'片段'}));
 const runtime=value(await loadMediaRuntime(runtimeDirectory)),engine=value(await startEngine({root:project.libraryRoot,runtime}));
 const cmd=async(kind:string,payload:unknown):Promise<any>=>{const r=value(await engine.commands.execute({schemaVersion:1,libraryId:engine.identity.libraryId,connectionEpoch:'seed',commandId:randomUUID(),kind,payload}));return isRecord(r)&&'result'in r?r.result:r;};
 try{
  const projectId=(await cmd('project.create',{name:project.manifest.name})).id;
  await cmd('creation.saveScript',{projectId,id:'script',expectedRevision:0,title:'密集剪辑',synopsis:'本地合成工程验收',body:'色板与提示音，不是真人样片。',scenes:[{id:'scene',title:'本地场景',location:'测试',time:'白天',description:''}]});
  const imported:any[]=[];
  async function take(path:string){const st=await stat(path),id=randomUUID();value(engine.assets.registerGrant({grantId:id,importId:id,libraryId:engine.identity.libraryId,expiresAt:Date.now()+120000,files:[{path,realPath:await realpath(path),allowedRoot:root,name:basename(path),size:st.size,mtimeMs:st.mtimeMs,dev:st.dev,ino:st.ino}]}));const ref=(await cmd('asset.importGrantedFiles',{grantId:id})).versions[0];const metadata=value(engine.assets.metadata(ref));const resolved=metadata.mime.startsWith('image/')?{...metadata,probe:null}:await cmd('media.inspect',{projectId,reference:ref});const entry={ref,...resolved};imported.push(entry);return entry;}
  const pictures:any[]=[];
  for(let i=0;i<count;i++){
   const path=join(root,'picture-'+i+(i===0?'.mp4':'.png'));
   if(i===0){const d=Math.max(2,clipTicks/48000);const r=spawnSync(runtime.ffmpegPath,['-v','error','-nostdin','-y','-f','lavfi','-i','color=0x405982:s=320x180:r=30:d='+d,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration='+d,'-c:v','libx264','-threads','2','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',path],{windowsHide:true,encoding:'utf8',timeout:30000});if(r.status!==0)throw Error(r.stderr);}
   else await writeFile(path,await sharp({create:{width:16,height:16,channels:3,background:{r:i%256,g:i*37%256,b:i*89%256}}}).png().toBuffer());
   const media=await take(path);pictures.push(media);
   await cmd('creation.saveShot',{projectId,id:'shot'+i,expectedRevision:0,scriptId:'script',sceneId:'scene',order:i,title:'镜头 '+i,durationSeconds:Math.max(1,clipTicks/48000),shotSize:'中景',cameraMovement:'固定',subject:'验收色板',action:'静止',dialogue:'',sound:'提示音',aspectRatio:'16:9',prompt:'local test',entityRefs:[]});
   await cmd('creation.selectOutput',{projectId,shotId:'shot'+i,expectedRevision:1,expectedSelectionRevision:0,role:i===0?'video':'image',reference:media.ref});
  }
  const settings={fps:{num:30,den:1},canvas:{width:1920,height:1080}};
  await cmd('timeline.create',{projectId,id:'cut',scriptRef:{id:'script',revision:1},title:'密集整集 '+count,settings});
  const assembly=await cmd('timeline.prepareAssembly',{projectId,scriptRef:{id:'script',revision:1},shots:pictures.map((_,i)=>({id:'shot'+i,revision:1,selectionRevision:1})),target:{id:'cut',expectedRevision:1},allowImages:true,settings,executionOwner:'capacity-test',runId:randomUUID()});
  let timeline=await cmd('timeline.applyAssembly',{planId:assembly.planId,planHash:assembly.planHash,executionOwner:assembly.executionOwner,runId:assembly.runId});
  if(clipTicks<48000){for(let start=0;start<count;start+=32){const operations=timeline.videoClips.slice(start,start+32).flatMap((c:any,j:number)=>[{kind:'trim',clipId:c.id,sourceInTicks:0,durationTicks:clipTicks},{kind:'move',clipId:c.id,startTicks:(start+j)*clipTicks}]);timeline=await cmd('timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:timeline.revision,operations});}}
  const totalTicks=count*clipTicks,audios:any[]=[];
  for(let i=0;i<voiceCount;i++){
   const ticks=voiceCount===count?clipTicks:Math.min(96000,totalTicks);
   const start=voiceCount===count?i*clipTicks:Math.min((i*30+29)*48000,totalTicks-ticks);
   const path=join(root,'voice-'+i+'.wav');await writeFile(path,wav(ticks,430+i*3));const m=await take(path);
   audios.push({id:'voice'+i,kind:'audio',track:'voice',media:m.ref,sourceHash:m.hash,sourceProbeId:m.probe.probeId,sourceInTicks:0,startTicks:start,durationTicks:ticks,gainMilli:1000,mute:false});
  }
  const musicPath=join(root,'music.wav');await writeFile(musicPath,wav(totalTicks,160,1000));const music=await take(musicPath);
  audios.push({id:'music',kind:'audio',track:'music',media:music.ref,sourceHash:music.hash,sourceProbeId:music.probe.probeId,sourceInTicks:0,startTicks:0,durationTicks:totalTicks,gainMilli:500,mute:false});
  for(let i=0;i<audios.length;i+=64)timeline=await cmd('timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:timeline.revision,operations:audios.slice(i,i+64).map(clip=>({kind:'insert',clip}))});
  const frame=1600,cueStart=totalTicks>31*48000?29*48000:15*frame,cueEnd=Math.min(totalTicks,cueStart+(totalTicks>31*48000?2*48000:12*frame));
  timeline=await cmd('timeline.applyOps',{projectId,timelineId:'cut',expectedRevision:timeline.revision,operations:[{kind:'setGain',clipId:timeline.videoClips[0].id,gainMilli:1000,mute:false},{kind:'setCue',cue:{id:'cross-segment',startTicks:cueStart,endTicks:cueEnd,text:'跨段字幕与固定声音验收'}}]});
  value(await bindDirectoryProject(project.root,{libraryId:engine.identity.libraryId,projectId,workspaceId:project.manifest.workspaceId}));
  const result={root:project.root,libraryRoot:project.libraryRoot,projectId,libraryId:engine.identity.libraryId,timelineId:'cut',revision:timeline.revision,count,voiceCount,durationTicks:totalTicks,references:imported.map(e=>e.ref),sourceHashes:imported.map(e=>e.hash)};
  await writeFile(join(root,'seed.json'),JSON.stringify(result,null,2));return result;
 }finally{value(await engine.close());}
}
