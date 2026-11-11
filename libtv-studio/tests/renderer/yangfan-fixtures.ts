import {queries} from './p4-harness.ts';
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