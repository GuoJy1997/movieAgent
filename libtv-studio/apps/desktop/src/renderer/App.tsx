import {DeliverablesWorkspace} from './features/timeline/DeliverablesWorkspace.tsx';
import {CreativeWorkspace} from './features/creation/CreativeWorkspace.tsx';
import {draftRegistry} from './state/draft-registry.ts';
import {useEffect,useRef,useState} from 'react';
import type {ProjectRef} from '../../../../packages/contracts/src/projects.ts';
import type {WorkspaceInfo} from '../../../../packages/contracts/src/launcher.ts';
import {Button,Empty} from '../../../../packages/ui/src/controls.tsx';
import {ScopedRuntimeProvider,useWorkspaceQuery,useRuntime} from './services/runtime.tsx';
import {DraftNavigationGuard,timelineNavigate} from './state/DraftNavigationGuard.tsx';
import {WorkspaceShell} from './features/shell/WorkspaceShell.tsx';
import type {WorkspaceTarget,WorkspaceView} from './features/shell/workspace-navigation.ts';
import {ProjectHome} from './features/projects/ProjectHome.tsx';
import {SubprojectWorkspace,ProjectMemoryPanel} from './features/subprojects/SubprojectWorkspace.tsx';
import {ProjectAssetsPanel} from './features/subprojects/ProjectAssetsPanel.tsx';
import {ProjectTaskCenter} from './features/subprojects/ProjectTaskCenter.tsx';
import {AgentWorkspace} from './features/agent/AgentWorkspace.tsx';

import {ProductionWorkspace} from './features/creation/ProductionWorkspace.tsx';
import {EntityWorkspace} from './features/entities/EntityWorkspace.tsx';
import {AssetLibrary} from './features/assets/AssetLibrary.tsx';
import {VoiceLibrary} from './features/assets/VoiceLibrary.tsx';
import {TimelineWorkspace} from './features/timeline/TimelineWorkspace.tsx';
import {TaskPanel} from './features/tasks/TaskPanel.tsx';
import {SettingsWorkspace} from './features/models/SettingsWorkspace.tsx';

export function App(){
 const runtime=useRuntime(),[view,setView]=useState<WorkspaceView>('project-home'),[project,setProject]=useState<ProjectRef|null>(null);
 const [subprojectId,setSubprojectId]=useState(''),[chosenCanvas,setChosenCanvas]=useState(''),[workspace,setWorkspace]=useState<WorkspaceInfo|null>(null);
 const [actionError,setActionError]=useState(''),[focusShotId,setFocusShotId]=useState<string>();
 const [chosenTimeline,setChosenTimeline]=useState('');
 const back=useRef<WorkspaceView>('project-home');
 const subprojects=useWorkspaceQuery('subproject.list',{projectId:project?.id??''},!!project);
 const subproject=subprojects.data?.items.find(s=>s.id===subprojectId)??subprojects.data?.items.find(s=>s.status!=='archived')??subprojects.data?.items[0];
 const scope=project&&subproject?{projectId:project.id,subprojectId:subproject.id}:null;
 const canvases=useWorkspaceQuery('subproject.canvases',scope??{projectId:'none',subprojectId:'none'},!!scope);
 const canvasId=canvases.data?.items.some(c=>c.id===chosenCanvas)?chosenCanvas:subproject?.primaryCanvasId??canvases.data?.items[0]?.id??'';
 const projectTasks=useWorkspaceQuery('project.tasks',{projectId:project?.id??''},!!project);
 const taskCount=projectTasks.data?.items.filter(i=>['QUEUED','SUBMITTING','RUNNING','COLLECTING'].includes(i.task.state)).length??0;
 useEffect(()=>{let live=true;void window.studio.workspaceInfo().then(async info=>{
  if(!live||!info.ok)return;setWorkspace(info.value);
  if(info.value.project?.manifest.binding){const listed=await window.studio.listProjects();if(live&&listed.ok)setProject(listed.value.find(p=>p.id===info.value.project!.manifest.binding!.projectId)??null);}
 }).catch(()=>{if(live)setActionError('未能读取工作目录，请从项目启动器重新打开。');});return()=>{live=false;};},[]);
 function requestNavigation(target:WorkspaceTarget){
  if(target.scope&&target.scope.projectId!==project?.id){setActionError('目标不属于当前项目，请从项目启动器打开。');return;}
  if(target.scope&&subprojects.data&&!subprojects.data.items.some(s=>s.id===target.scope!.subprojectId)){setActionError('目标分集已不可用，请重新选择。');return;}
  const withinCreative=[view,target.view].every(v=>v==='agent'||v==='canvas')&&target.scope?.subprojectId===scope?.subprojectId;
  const guard=withinCreative&&draftRegistry.onlyEphemeral()?(action:()=>void)=>action():timelineNavigate;
  guard(()=>{
   setActionError('');
   if(['tasks','settings'].includes(target.view)&&!['tasks','settings'].includes(view))back.current=view;
   if(target.scope&&target.scope.subprojectId!==scope?.subprojectId){setSubprojectId(target.scope.subprojectId);setChosenCanvas(target.canvasId??'');setFocusShotId(undefined);setChosenTimeline('');}
   else if(target.canvasId!==undefined)setChosenCanvas(target.canvasId);
   if(target.timelineId!==undefined)setChosenTimeline(target.timelineId);
   if(target.shotId!==undefined)setFocusShotId(target.shotId);
   setView(target.view);
  });
 }
 const go=(next:WorkspaceView)=>requestNavigation({view:next,scope});
 async function localAction(action:()=>Promise<import('../../../../packages/contracts/src/result.ts').Result<void>>){try{const r=await action();if(!r.ok)setActionError(r.error.message);}catch{setActionError('操作未完成，请重试。');}}
 const openProject=(p:ProjectRef)=>timelineNavigate(()=>{setProject(p);setSubprojectId('');setChosenCanvas('');setFocusShotId(undefined);setChosenTimeline('');setView('episodes');});
 return <><DraftNavigationGuard/><WorkspaceShell view={view} hasProject={!!project} online={runtime.online} taskCount={taskCount} onNavigate={go} onBack={()=>go(back.current)} context={<>
  <strong className="context-project">{project?.name??'羊番TV'}</strong>
  {subproject&&<><span className="context-divider">/</span><select aria-label="当前子项目" value={subproject.id} onChange={e=>requestNavigation({view,scope:{projectId:project!.id,subprojectId:e.target.value}})}>{subprojects.data?.items.map(s=><option key={s.id} value={s.id}>{s.title}{s.status==='archived'?' · 已归档':''}</option>)}</select></>}
  {view==='canvas'&&scope&&<select aria-label="当前画布" value={canvasId} onChange={e=>requestNavigation({view,scope,canvasId:e.target.value})}>{canvases.data?.items.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select>}
  <div className="context-actions"><Button tone="quiet" onClick={()=>void localAction(()=>window.studio.openProjectLauncher())}>项目启动器</Button>{workspace?.project&&<Button tone="quiet" onClick={()=>void localAction(()=>window.studio.openProjectFolder())}>打开文件夹</Button>}</div>
 </>}>
  {runtime.descriptor?.schedulingPaused&&<div className="global-alert" role="status"><strong>恢复副本 · 任务执行已暂停</strong><p>请在项目启动器的维护中，确认原项目已停止后启用执行。</p></div>}
  {actionError&&<div className="global-alert" role="alert">{actionError}<Button onClick={()=>setActionError('')}>关闭操作提示</Button></div>}
  {runtime.error&&<div className="global-alert" role="alert"><strong>{runtime.error.code}</strong><p>{runtime.error.message}</p>{Object.entries(runtime.error.fieldErrors??{}).map(([k,v])=><p key={k}>{k}: {v}</p>)}{runtime.pending?<Button disabled={runtime.busy} onClick={()=>void runtime.recover()}>核实原回执</Button>:<Button onClick={runtime.clearError}>关闭提示</Button>}</div>}
  {view==='project-home'&&<ProjectHome directoryMode={!!workspace?.project} onConfigure={()=>go('settings')} onOpen={openProject} activeProject={project} scope={scope} subproject={subproject} onNavigate={requestNavigation} composer={scope&&project?<ScopedRuntimeProvider key={scope.projectId+'/'+scope.subprojectId} scope={scope} canvasId={canvasId}><AgentWorkspace projectId={project.id} presentation="home" onOpenConversation={()=>go("agent")} onCreation={()=>go('shots')}/></ScopedRuntimeProvider>:undefined}/>}
  {view==='settings'&&<SettingsWorkspace/>}
  {view==='episodes'&&project&&<SubprojectWorkspace projectId={project.id} selectedId={subproject?.id} onOpen={s=>requestNavigation({view:'canvas',scope:{projectId:project.id,subprojectId:s.id},canvasId:s.primaryCanvasId??''})}/>}
  {view==='memory'&&project&&<div className="page"><ProjectMemoryPanel projectId={project.id}/></div>}
  {view==='tasks'&&(scope?<ProjectTaskCenter projectId={scope.projectId} scope={scope} canvasId={canvasId} onOpen={(id,canvas)=>requestNavigation({view:'canvas',scope:{projectId:scope.projectId,subprojectId:id},canvasId:canvas??''})}/>:<TaskPanel/>)}
  {scope&&project&&<ScopedRuntimeProvider key={scope.projectId+'/'+scope.subprojectId} scope={scope} canvasId={canvasId}>
   {view==='media'&&<ProjectAssetsPanel scope={scope} canvasId={canvasId} onPlace={()=>go('canvas')} onReference={()=>go('agent')}/>}
   {view==='entities'&&<EntityWorkspace projectId={project.id}/>}
   {view==='voices'&&<VoiceLibrary projectId={project.id}/>}
   {['agent','canvas'].includes(view)&&<CreativeWorkspace project={project} target={{view,scope,canvasId}} onNavigate={requestNavigation}/>}
   {view==='finish-assistant'&&<AgentWorkspace projectId={project.id} presentation="finish" onCreation={()=>go('shots')}/>}
   {['script','shots','dialogue'].includes(view)&&<ProductionWorkspace projectId={project.id} directoryMode={!!workspace?.project} focusShotId={focusShotId} onShotChange={setFocusShotId} view={view as 'script'|'shots'|'dialogue'} onAssets={()=>go('entities')}/>}
   {view==='deliverables'&&<DeliverablesWorkspace scope={scope} onTimeline={id=>requestNavigation({view:'timeline',scope,...(id?{timelineId:id}:{})})}/>} 
   {view==='timeline'&&<TimelineWorkspace compactLayout key={scope.subprojectId} projectId={project.id} initialTimelineId={chosenTimeline} onTimelineChange={setChosenTimeline}/>}
  </ScopedRuntimeProvider>}
  {!scope&&view==='media'&&<AssetLibrary canvasId={null} onPlace={()=>go('canvas')}/>}
  {!scope&&!['project-home','episodes','memory','settings','tasks','media','deliverables'].includes(view)&&<Empty title="先选择一集"><Button onClick={()=>go('episodes')}>管理分集与分期</Button></Empty>}
 </WorkspaceShell></>;
}