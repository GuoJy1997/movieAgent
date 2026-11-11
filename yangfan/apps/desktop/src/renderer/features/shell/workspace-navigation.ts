import type {WorkScope} from '../../../../../../packages/contracts/src/subprojects.ts';
import type {IconName} from '../../../../../../packages/ui/src/icons.tsx';
export type WorkspaceView = 'project-home'|'episodes'|'memory'|'agent'|'canvas'|'script'|'shots'|'dialogue'|'media'|'entities'|'voices'|'asset-detail'|'timeline'|'deliverables'|'finish-assistant'|'tasks'|'settings';
export interface WorkspaceTarget {view:WorkspaceView;scope:WorkScope|null;canvasId?:string;sessionId?:string;shotId?:string;timelineId?:string}
export type LegacyPage='projects'|'subprojects'|'agent'|'canvas'|'creation'|'entities'|'assets'|'timeline'|'tasks'|'models';
export function mapLegacyPage(page:LegacyPage):WorkspaceView {
  return ({projects:'project-home',subprojects:'episodes',agent:'agent',canvas:'canvas',creation:'shots',entities:'entities',assets:'media',timeline:'timeline',tasks:'tasks',models:'settings'} as const)[page];
}
export const workspaces:{id:string;label:string;icon:IconName;views:{id:WorkspaceView;label:string}[]}[]=[
 {id:'projects',label:'项目',icon:'folder',views:[{id:'project-home',label:'总览'},{id:'episodes',label:'分集与分期'},{id:'memory',label:'项目记忆'}]},
 {id:'creative',label:'创作',icon:'agent',views:[{id:'agent',label:'对话'},{id:'canvas',label:'画布'}]},
 {id:'production',label:'制作',icon:'production',views:[{id:'script',label:'剧本'},{id:'shots',label:'镜头'},{id:'dialogue',label:'对白'}]},
 {id:'assets',label:'资产',icon:'folder',views:[{id:'media',label:'媒体'},{id:'entities',label:'角色与场景'},{id:'voices',label:'声音'}]},
 {id:'finish',label:'成片',icon:'finish',views:[{id:'timeline',label:'剪辑'},{id:'deliverables',label:'制品'},{id:'finish-assistant',label:'成片助手'}]},
];
export const workspaceFor=(view:WorkspaceView)=>workspaces.find(w=>w.views.some(v=>v.id===view))??workspaces[0]!;