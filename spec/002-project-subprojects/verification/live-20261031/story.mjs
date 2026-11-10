export async function run(c){
 const {data:d,execute,query,scopeOf,save,log}=c,scope=scopeOf(d.a);
 if(!d.scriptA){
 const hero=await execute('creation.saveEntity',{projectId:d.projectId,id:'zhuqing',expectedRevision:0,kind:'character',name:'朱清',description:'19岁清瘦少年，黑发束起，素色冠巾，灰青交领右衽长袍、浅米灰内领、深黛腰带。',constraints:'右手全程捏半张皱邸报；原地不走位；面容、衣服、发型保持。',references:[]},scope);
 d.scriptA=await execute('creation.saveScript',{projectId:d.projectId,id:'episode1-script',expectedRevision:0,title:'邸报',synopsis:'朱清在梧桐下望向殿檐，邸报仍在右手。',body:'午后，旧朱红宫墙外。朱清站在梧桐下，右手捏着半张皱邸报，轻轻抬眼望向殿檐。微风吹动衣袖，他仍站在原处，邸报始终留在右手。全段无对白。',scenes:[{id:'scene-wutong',title:'梧桐下',location:'旧宫墙外梧桐道',time:'午后',description:'旧朱红墙、青砖路、梧桐日斑，真实自然斜阳。'}]},scope);
 d.shotA=await execute('creation.saveShot',{projectId:d.projectId,id:'shot-one',expectedRevision:0,scriptId:d.scriptA.id,sceneId:'scene-wutong',order:0,title:'抬眼',durationSeconds:4,shotSize:'中景',cameraMovement:'极缓推近',subject:'朱清',action:'右手捏皱邸报，原地轻轻抬眼望殿檐。',dialogue:'',sound:'蝉鸣、树叶声，无配乐。',aspectRatio:'9:16',prompt:'4秒单镜头：午后梧桐下，19岁少年朱清穿灰青交领右衽长袍与素色冠巾，右手全程捏半张皱邸报，原地轻轻抬眼望向朱红宫墙上方殿檐。极缓推近，自然光，低饱和电影实拍感。微风吹动衣袖。全程无对白、字幕、水印。',entityRefs:[{libraryId:d.libraryId,projectId:d.projectId,entityId:hero.id,revision:hero.revision}]},scope);
 d.entities=[hero];d.storyOrigin='人工验收剧本；真实 Kimi 创作请求结果未知，未重发';d.steps.push({step:'text-agent-blocked',passed:false,errorCode:'STALE_LEASE',providerOutcome:'unknown'});await save();
 }
 log('MANUAL_STORY_READY',{script:d.scriptA.title,shots:1,durationSeconds:4});
}
