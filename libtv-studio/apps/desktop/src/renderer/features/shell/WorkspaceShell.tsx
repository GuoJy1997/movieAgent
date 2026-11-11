import {useEffect,useState,type ReactNode} from 'react';
import {Brand} from '../../../../../../packages/ui/src/Brand.tsx';
import {Icon} from '../../../../../../packages/ui/src/icons.tsx';
import {Button} from '../../../../../../packages/ui/src/controls.tsx';
import {PillNav} from '../../../../../../packages/ui/src/pill-nav/PillNav.tsx';
import {pillArt} from '../../../../../../packages/ui/src/pill-nav/art.ts';
import {workspaces,workspaceFor,type WorkspaceView} from './workspace-navigation.ts';
export function WorkspaceShell({view,hasProject,online,taskCount,onNavigate,onBack,context,children}:{view:WorkspaceView;hasProject:boolean;online:boolean;taskCount:number;onNavigate(view:WorkspaceView):void;onBack():void;context:ReactNode;children:ReactNode}){
 const [manual,setManual]=useState<boolean|null>(()=>{try{const v=localStorage.getItem('yangfan.ui.v1.sidebar');return v===null?null:v==='compact';}catch{return null;}});
 const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width:1279px)').matches);
 useEffect(()=>{
  const query=window.matchMedia('(max-width:1279px)'),update=()=>setNarrow(query.matches);
  update();query.addEventListener('change',update);
  return()=>query.removeEventListener('change',update);
 },[]);
 const compact=manual??narrow,global=view==='tasks'||view==='settings';
 const section=workspaceFor(view);
 function toggle(){const next=!compact;setManual(next);try{localStorage.setItem('yangfan.ui.v1.sidebar',next?'compact':'expanded');}catch{/* session preference remains usable */}}
 return <div className={'studio-shell yangfan-shell'+(compact?' is-compact':'')}>
  <aside className="app-sidebar">
   <Brand compact={compact}/>
   <nav aria-label="工作区导航">{workspaces.map(w=><button key={w.id} title={w.label} aria-label={w.label} aria-current={!global&&w.id===section.id?'page':undefined} disabled={!hasProject&&!['projects','assets'].includes(w.id)} onClick={()=>onNavigate(w.views[0]!.id)}><Icon name={w.icon} size={24}/><span>{w.label}</span></button>)}</nav>
   <div className="yangfan-nav-bottom">
    <button aria-label="任务" title="任务" aria-current={view==='tasks'?'page':undefined} onClick={()=>onNavigate('tasks')}><Icon name="tasks" size={23}/><span>任务</span>{taskCount>0&&<b className="task-count">{taskCount}</b>}</button>
    <button aria-label="设置" title="设置" aria-current={view==='settings'?'page':undefined} onClick={()=>onNavigate('settings')}><Icon name="settings" size={23}/><span>设置</span></button>
    <button className="sidebar-toggle" aria-label={compact?'展开导航':'收起导航'} onClick={toggle}><Icon name="sidebar" size={18}/><span>收起导航</span></button>
    <small className="engine-status"><i className={online?'status-dot':'offline-dot'}/><span>{online?'本机引擎已连接':'引擎连接中断'}</span></small>
   </div>
  </aside>
  <main className="main-area">
   <header className="yangfan-context">{global&&<Button tone="quiet" aria-label="返回工作区" onClick={onBack}><Icon name="back"/>返回工作区</Button>}{context}</header>
   {!global&&<PillNav className="workspace-tabs" label={section.label+'视图'} value={view} onChange={onNavigate} panelId="workspace-content" items={section.views.map((v,index)=>({...v,art:[pillArt.sail,pillArt.film,pillArt.orbit][index],disabled:!hasProject&&!['project-home','media'].includes(v.id)}))}/>}
   <div id="workspace-content" role={!global&&view!=='project-home'?'tabpanel':undefined} aria-label={!global?section.views.find(v=>v.id===view)?.label:undefined} className={'page-container workspace-'+view}>{children}</div>
  </main>
 </div>;
}
