import {useMemo,useState,type ReactNode} from 'react';
import type {ProjectRef} from '../../../../../../packages/contracts/src/projects.ts';
import type {WorkScope,Subproject} from '../../../../../../packages/contracts/src/subprojects.ts';
import {Button,Empty,Field,QueryState} from '../../../../../../packages/ui/src/controls.tsx';
import {Icon} from '../../../../../../packages/ui/src/icons.tsx';
import {PillNav} from '../../../../../../packages/ui/src/pill-nav/PillNav.tsx';
import {pillArt} from '../../../../../../packages/ui/src/pill-nav/art.ts';
import {Dialog} from '../../../../../../packages/ui/src/overlays.tsx';
import {useRuntime,useWorkspaceQuery} from '../../services/runtime.tsx';
import {ProjectGallery} from './ProjectGallery.tsx';
import {MediaPreview} from '../assets/MediaPreview.tsx';
import {taskLabel} from '../tasks/task-labels.ts';
import type {WorkspaceTarget,WorkspaceView} from '../shell/workspace-navigation.ts';
export function ProjectHome({onOpen,onConfigure,directoryMode=false,activeProject,scope=null,subproject,onNavigate,composer}:{onOpen(p:ProjectRef):void;onConfigure():void;directoryMode?:boolean;activeProject?:ProjectRef|null;scope?:WorkScope|null;subproject?:Subproject;onNavigate?(target:WorkspaceTarget):void;composer?:ReactNode}){
 const runtime=useRuntime(),projects=useWorkspaceQuery('project.list',{}),[preview,setPreview]=useState(''),[create,setCreate]=useState(false),[name,setName]=useState(''),[error,setError]=useState('');
 const active=activeProject??projects.data?.projects[0],projectId=active?.id??'';
 const episodes=useWorkspaceQuery('subproject.list',{projectId},!!active);
 const catalog=useWorkspaceQuery('project.assets',{...(scope??{projectId,subprojectId:'none'}),view:'all'},!!scope,scope??undefined);
 const creation=useWorkspaceQuery('creation.read',{projectId},!!scope,scope??undefined);
 const tasks=useWorkspaceQuery('project.tasks',{projectId},!!active);
 const running=tasks.data?.items.filter(i=>['QUEUED','SUBMITTING','RUNNING','COLLECTING'].includes(i.task.state))??[];
 const pictures=catalog.data?.items.filter(a=>a.mime.startsWith('image/'));
 const items=useMemo(()=>(projects.data?.projects??[]).map(p=>({id:p.id,title:p.name,cover:p.id===active?.id?(catalog.data?.items.find(a=>a.mime.startsWith('image/')&&a.name===p.name)??catalog.data?.items.find(a=>a.mime.startsWith('image/')))?.ref??null:null})),[projects.data,catalog.data,active?.id]);
 const previewId=items.some(i=>i.id===preview)?preview:items.find(i=>i.id===active?.id)?.id??items[0]?.id??'',previewProject=projects.data?.projects.find(p=>p.id===previewId);
 const episodeLabel=subproject?([subproject.number,subproject.title].filter(Boolean).join(' ')):'';
 function go(view:WorkspaceView){if(!activeProject&&active){onOpen(active);return;}if(onNavigate)onNavigate({view,scope});else if(active)onOpen(active);}
 async function newProject(){if(directoryMode){const r=await window.studio.openProjectLauncher();if(!r.ok)setError(r.error.message);}else setCreate(true);}
 return <section className="yangfan-home">
  <div className="home-heading"><div><h1>{active?'继续你的故事':'让故事，从这里起航'}<i aria-hidden="true"/></h1><p><span>{active?.name??'羊番TV'}</span>{subproject&&<><span>/</span><span>{episodeLabel}</span><span>/</span><button onClick={()=>go('canvas')}>主画布 <Icon name="down" size={15}/></button></>}</p></div><Button onClick={()=>void newProject()}><Icon name="plus"/>新建短剧</Button></div>
  <QueryState loading={projects.isPending} error={projects.error}/>{error&&<p role="alert">{error}</p>}
  {items.length>0?<><ProjectGallery items={items} previewId={previewId} onPreview={setPreview} onOpen={id=>{const p=projects.data?.projects.find(p=>p.id===id);if(p)onOpen(p);}}/>
   <div className="home-project-summary"><strong>{previewProject?.name}</strong>{previewId===active?.id&&<span>{creation.data?.shots.length??0}个镜头 · {running.length}进行中</span>}<Button tone="quiet" onClick={()=>{if(activeProject&&previewId===activeProject.id)go('canvas');else if(previewProject)onOpen(previewProject);}}>继续制作<Icon name="arrow"/></Button>{previewId===active?.id&&subproject&&<span className="home-resume-context">{episodeLabel}</span>}</div>
  </>:<Empty title="还没有短剧">新建或打开本机短剧目录，开始第一段故事。</Empty>}
  {active&&<><div className="home-composer-heading"><PillNav mode="navigation" label="创作入口" value="agent" onChange={go} items={[{id:'agent',label:'Agent 创作',art:pillArt.sail},{id:'canvas',label:'打开画布',art:pillArt.film}]}/><span>{active.name} · {subproject?.number??subproject?.title??'请先创建分集'} <Icon name="down" size={15}/></span></div>
   {composer??<div className="home-create-entry"><p>把一个想法，变成下一个镜头。</p><Button tone="primary" onClick={()=>go('agent')}>打开创作对话<Icon name="arrow"/></Button></div>}
   <div className="home-shortcuts"><button onClick={()=>go('agent')}>续写镜头 <Icon name="arrow" size={16}/></button><button onClick={()=>go('agent')}>生成分镜 <Icon name="arrow" size={16}/></button></div>
   <div className="home-section-heading"><h2>分集 <small>EPISODES</small></h2><div className="home-management"><Button tone="quiet" onClick={()=>go('memory')}>项目记忆</Button><Button tone="quiet" onClick={()=>go('episodes')}>管理分集与分期 <Icon name="arrow" size={16}/></Button></div></div>
   <div className="episode-strip">{[...(episodes.data?.items??[])].sort((a,b)=>(a.order??0)-(b.order??0)).map((episode,i)=>{const picture=pictures?.find(a=>a.sourceSubprojectId===episode.id&&!a.common);return <button key={episode.id} aria-pressed={episode.id===subproject?.id} onClick={()=>onNavigate?.({view:'project-home',scope:{projectId,subprojectId:episode.id}})}>{picture?<span className="episode-thumbnail"><MediaPreview media={picture.ref} thumbnail/></span>:<span className="episode-number">{episode.number||String(i+1).padStart(2,'0')}</span>}<span>{picture?(episode.number??'EP'+String(i+1).padStart(2,'0'))+' ':''}{episode.title}</span>{episode.id===subproject?.id&&<i/>}</button>;})}</div>
   {!episodes.data?.items.length&&<Button onClick={()=>go('episodes')}>创建第一集</Button>}
   <div className="home-work-grid"><section><h2>接着完成这一集</h2><button onClick={()=>go('shots')}><Icon name="production"/>剧本与镜头<Icon name="right" size={16}/></button><button onClick={()=>go('dialogue')}><Icon name="agent"/>对白与声音审核<Icon name="right" size={16}/></button><button onClick={()=>go('timeline')}><Icon name="finish"/>打开剪辑工作台<Icon name="right" size={16}/></button></section>
    <section><h2>正在进行 <small>· {running.length}</small></h2>{running.length?running.slice(0,3).map(item=><button key={item.task.taskId} onClick={()=>go('tasks')}><Icon name="tasks"/><span>{episodes.data?.items.find(e=>e.id===item.subprojectId)?.number??'项目任务'}<small>{taskLabel[item.task.state]}</small></span><progress aria-label={taskLabel[item.task.state]}/><small className="home-task-state">{taskLabel[item.task.state]}</small></button>):<p className="hint">当前没有进行中的任务。生成结果会保存在原来的分集。</p>}</section></div>
  </>}
  {!active&&<Button tone="quiet" onClick={onConfigure}>配置模型</Button>}
  {create&&<Dialog title="新建短剧" onClose={()=>setCreate(false)}><form onSubmit={async e=>{e.preventDefault();const result=await runtime.command('project.create',{name});if(result){setCreate(false);setName('');onOpen(result);}}}><Field label="项目名称"><input value={name} onChange={e=>setName(e.target.value)} required maxLength={200}/></Field><Button type="submit" tone="primary" disabled={!name.trim()||!runtime.online||runtime.busy||runtime.pending}>创建短剧</Button></form></Dialog>}
 </section>;
}
