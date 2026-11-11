import {shellData} from './yangfan-preview-base.ts';
const base={libraryId:'library',projectId:'project',revision:1,createdAt:'2026-11-07'};
const media=(id:string,version=1)=>({kind:'assetVersion',libraryId:'library',assetId:id,version});
const script={...base,id:'script',title:'出发前夜',synopsis:'四个朋友临时决定离开城市，沿着海岸公路寻找夏天。',body:'林夏扣好头盔，回头看向同伴。\n“走吧，海还在前面等我们。”',scenes:[{id:'scene-a',title:'海滨公路',location:'沿海公路',time:'日',description:'晴朗的蓝天，沿海公路通向白墙红瓦的小镇。'}]};
const shot={...base,id:'shot-07',scriptId:'script',sceneId:'scene-a',order:7,title:'镜头07 · 出发',durationSeconds:4,shotSize:'中景',cameraMovement:'从人物侧前方缓慢推进，保持视线高度。',subject:'林夏',action:'扣好头盔，回头看向同伴，骑上机车驶向海滨公路。',dialogue:'走吧，海还在前面等我们。',sound:'海风，摩托车引擎声',aspectRatio:'16:9',prompt:'旅行电影，晴天海岸',entityRefs:[]};
const asset=(id:string,name:string)=>({ref:media(id),name,mime:'image/png',sourceSubprojectId:'ep03',common:false,width:1920,height:1080,byteLength:1024,state:'active',tags:[],size:1024,createdAt:'2026-11-07',metadata:{},source:'import'});
const session=shellData()['agent.read'];
export const previewData={...shellData(),'agent.read':{...session,runs:[{runId:'reply',state:'REPLIED',stopped:true,prepared:{context:{notice:'本次只生成文本运镜建议，未生成媒体。',sources:[],omitted:[]},message:'镜头07的推进太急了，给我三个更自然的运镜方案。',template:{name:'导演规划'},generation:{config:{model:{name:'文本规划模型'}}},createdAt:'2026-11-07'}}],messages:[{runId:'reply',role:'assistant',createdAt:'2026-11-07',text:'可以保留人物和场景，调整推进的速度与镜头停留。'+String.fromCharCode(10,10)+'A · 缓慢推进'+String.fromCharCode(10)+'从中景缓慢靠近，先留一秒让人物回望，再进入近景。'+String.fromCharCode(10,10)+'B · 侧向跟拍'+String.fromCharCode(10)+'与机车保持同速，镜头平稳跟随，让风和背景带出前进感。'+String.fromCharCode(10,10)+'C · 固定远景'+String.fromCharCode(10)+'让人物从画面一侧驶入，保留完整海岸线，把节奏交给人物运动。'}]},
 'creation.read':{...base,scripts:[script],shots:[shot],entities:[{...base,id:'linxia',kind:'character',name:'林夏 · 主角',description:'女 · 青年 · 领航骑行',constraints:'保持角色外貌一致',references:[media('linxia')]},{...base,id:'coast',kind:'scene',name:'海滨公路',description:'外景 · 海岸 · 公路',constraints:'',references:[media('coast')]}],selections:[{shotId:'shot-07',selectionRevision:1,image:media('scooter'),video:null}]},
 'project.assets':{items:[asset('scooter','周末出逃'),asset('coast','海滨公路'),asset('linxia','林夏')]},
 'asset.search':{assets:[]},'asset.history':{versions:[1,2,3].map(v=>({...asset('coast','海滨公路'),ref:media('coast',v),metadataRevision:1,sourceArtifactRef:null}))},
 'subproject.list':{items:['初遇海岸','临时计划','出发前夜','海边公路'].map((title,i)=>({...base,id:'ep0'+(i+1),title,number:'EP0'+(i+1),order:i,status:'producing',primaryCanvasId:null,primaryTimelineId:'timeline-a'}))},
 'shots.history':{outputs:[],productions:[],collectionIssues:[]},'workflow.list':{workflows:[]},
 'finish.templates':{templates:[]},'finish.list':{runs:[]},'voice.list':{voices:[]},
 __mediaUrls:{picture:'/qa-media/coast.png',scooter:'/qa-media/scooter.png',linxia:'/qa-media/linxia.png',coast:'/qa-media/coast.png'},
};
/** Four independent demo projects for visual comparison; never added to a user library. */
const galleryProjects=[
 {id:'sea',name:'向晚的海'},
 {id:'city',name:'城市留声'},
 {id:'project',name:'周末出逃'},
 {id:'wind',name:'逆风而行'},
].map(p=>({...base,...p}));
const episodeImages=[
 {...asset('episode-sunset','初遇海岸'),sourceSubprojectId:'ep01'},
 {...asset('episode-plan','临时计划'),sourceSubprojectId:'ep02'},
 {...asset('linxia','林夏'),sourceSubprojectId:'ep03'},
 {...asset('coast','海滨公路'),sourceSubprojectId:'ep04'},
 {...asset('poster-weekend','周末出逃'),common:true,width:1774,height:887},
 asset('scooter','机车出发'),
];
const demoTask=(id:string)=>({libraryId:'library',taskId:id,attemptId:id+'-attempt',state:'RUNNING',providerState:'accepted',collectionState:'pending',providerTaskId:null,clientRequestId:null,cancelRequested:false,cancelStatus:'none',reconcileStatus:'none',estimateMicros:null,reportedActualMicros:null,reservationMicros:0,currency:'USD',settlementStatus:'unknown',artifactRef:null,errorCode:null});
Object.assign(previewData,{
 'project.list':{projects:galleryProjects},
 'project.assets':{libraryId:'library',projectId:'project',items:episodeImages},
 'subproject.list':{items:[previewData['subproject.list'].items[2],...previewData['subproject.list'].items.filter((_,i)=>i!==2)]},
 'project.tasks':{libraryId:'library',projectId:'project',items:[{task:demoTask('shot05-demo'),subprojectId:'ep03',canvasId:null},{task:demoTask('coast-demo'),subprojectId:'ep03',canvasId:null}]},
 __mediaUrls:{...previewData.__mediaUrls,'poster-weekend':'/qa-posters/poster-weekend-v2.png','poster-sea':'/qa-posters/poster-sea-v2.png','poster-city':'/qa-posters/poster-city-v2.png','poster-wind':'/qa-posters/poster-wind.png','episode-sunset':'/qa-media/episode-sunset.png','episode-plan':'/qa-media/episode-plan.png'},
 ...Object.fromEntries(galleryProjects.filter(p=>p.id!=='project').flatMap(p=>[
  ['subproject.list:'+p.id,{items:[{...base,projectId:p.id,id:p.id+'-episode',title:'第一集',status:'producing'}]}],
  ['project.assets:'+p.id,{libraryId:'library',projectId:p.id,items:[{...asset('poster-'+p.id,p.name),width:1774,height:887}]}],
 ])),
});
