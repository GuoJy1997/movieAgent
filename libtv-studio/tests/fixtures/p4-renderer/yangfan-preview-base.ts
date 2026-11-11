export const timeline = { libraryId:'library',projectId:'project',id:'timeline-a',revision:1,scriptRef:{id:'script',revision:1},title:'剪辑 A',timebase:48000 as const,fps:{num:30 as const,den:1 as const},canvas:{width:1920 as const,height:1080 as const},videoClips:[{id:'clip-a',kind:'image' as const,media:{kind:'assetVersion' as const,libraryId:'library',assetId:'picture',version:1},sourceHash:'a'.repeat(64),sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:240000,fit:'contain' as const,gainMilli:1000,mute:true}],audioClips:[],subtitleCues:[],subtitleStyle:{fontId:'noto-sans-cjk-sc' as const,fontSize:48,color:'#ffffff',bottomMargin:60,outline:2},createdAt:'2026-10-27T00:00:00Z' };
export function queries() { return {
  'timeline.list':{libraryId:'library',projectId:'project',timelines:[timeline,{...timeline,id:'timeline-b',title:'剪辑 B'}]},
  'timeline.read:timeline-a':timeline,'timeline.read:timeline-b':{...timeline,id:'timeline-b',title:'剪辑 B'},
  'timeline.history':{revisions:[timeline]},'creation.read':{scripts:[{id:'script',revision:1,title:'剧本'}],shots:[],selections:[]},
  'asset.search':{assets:[]},'audio.read':{voiceLines:[],takes:[],transcripts:[],diagnostics:[]},'profile.list':{profiles:[]},'model.list':{models:[]},'task.list':{tasks:[]},'render.list':{jobs:[]},'timeline.exports':{exports:[]},
}; }

export const agentData=()=>{
 const session={libraryId:'library',projectId:'project',sessionId:'session-a',title:'出发前夜',mode:'all',executionOwner:'desktop-user',createdAt:1,runs:[],messages:[]};
 return {...queries(),__agent:true,
  'creation.read':{scripts:[],entities:[],shots:[],selections:[]},
  'agent.list':{sessions:[session]},'agent.read':session,
  'agent.templates':{templates:[{id:'short-film',revision:1,name:'短片',description:'规划短片镜头',allowed:['shot'],suggestedShots:1,suggestedOutputTokens:2048}]},
  'profile.list':{profiles:[{libraryId:'library',id:'profile',revision:1,name:'规划预设',modelRef:{libraryId:'library',id:'model',revision:1},parameters:{max_tokens:4096}}]},
  'model.list':{models:[{id:'model',revision:1,name:'文本模型',pricing:{status:'unknown'},connectionRef:{id:'connection',revision:1},capabilities:{outputKinds:['text'],taskTypes:['text_to_text'],parameters:[]}}]},
 };
};
export const shellData=()=>({...agentData(),__agent:false,__shell:true,
 'project.list':{projects:[{libraryId:'library',id:'project',name:'周末出逃',createdAt:'2026-11-07'}]},
 'subproject.list':{items:[{id:'ep03',projectId:'project',title:'EP03 出发前夜',primaryCanvasId:null,status:'producing'}]},
 'subproject.canvases':{items:[]},'project.tasks':{items:[]},'project.assets':{items:[]},
 'subproject.deliverables':{items:[]},'provider.list':{connections:[],credentialStatuses:[],verification:[]},'project.memory':{entries:[],completions:[],profileRef:null},
});