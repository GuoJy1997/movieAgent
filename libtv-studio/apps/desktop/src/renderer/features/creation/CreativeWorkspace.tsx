import {useState} from 'react';
import type {ProjectRef} from '../../../../../../packages/contracts/src/projects.ts';
import {Button,Empty} from '../../../../../../packages/ui/src/controls.tsx';
import type {WorkspaceTarget} from '../shell/workspace-navigation.ts';
import {AgentWorkspace} from '../agent/AgentWorkspace.tsx';
import {CanvasWorkspace} from '../canvas/CanvasWorkspace.tsx';
export function CreativeWorkspace({project,target,onNavigate}:{project:ProjectRef;target:WorkspaceTarget;onNavigate(target:WorkspaceTarget):void}){
 const canvas=target.view==='canvas';const [panel,setPanel]=useState('canvas');
 return <div data-panel={panel} className={canvas?'creative-workspace with-canvas':'creative-workspace conversation-only'}>
  {canvas&&<div className="narrow-panel-tabs"><Button onClick={()=>setPanel("canvas")}>画布</Button><Button onClick={()=>setPanel("agent")}>创作助手</Button></div>}
  {canvas&&<div className="creative-canvas" key="canvas">{target.canvasId?<CanvasWorkspace key={target.canvasId} project={project} canvasId={target.canvasId} onConfigure={()=>onNavigate({...target,view:'settings'})} onEditShot={id=>onNavigate({...target,view:'shots',shotId:id})} onOpenDialogue={id=>onNavigate({...target,view:'dialogue',shotId:id})}/>:<Empty title="这集还没有画布"><Button onClick={()=>onNavigate({...target,view:'episodes'})}>创建画布</Button></Empty>}</div>}
  <aside className="creative-agent" key="agent" aria-label={canvas?'画布创作助手':'创作对话'}><AgentWorkspace projectId={project.id} presentation={canvas?'panel':'full'} onCreation={()=>onNavigate({...target,view:'shots'})}/></aside>
 </div>;
}