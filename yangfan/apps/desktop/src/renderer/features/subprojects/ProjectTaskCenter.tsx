import {useState} from 'react';
import type {WorkScope} from '../../../../../../packages/contracts/src/subprojects.ts';
import {Button,Field,QueryState} from '../../../../../../packages/ui/src/controls.tsx';
import {ScopedRuntimeProvider,useWorkspaceQuery} from '../../services/runtime.tsx';
import {TaskPanel} from '../tasks/TaskPanel.tsx';
import {TaskDetail} from '../tasks/TaskDetail.tsx';
import {taskLabel} from '../tasks/task-labels.ts';
export function ProjectTaskCenter({projectId,scope,canvasId,onOpen}:{projectId:string;scope:WorkScope;canvasId:string;onOpen:(subprojectId:string,canvasId:string|null)=>void}){
 const [view,setView]=useState<'current'|'all'>('current'),[selected,setSelected]=useState('');
 const tasks=useWorkspaceQuery('project.tasks',{projectId},view==='all'),children=useWorkspaceQuery('subproject.list',{projectId});
 const picked=tasks.data?.items.find(i=>i.task.taskId===selected);
 return <div><div className="project-task-filter"><Field label="任务范围"><select value={view} onChange={e=>{setView(e.target.value as typeof view);setSelected('');}}><option value="current">当前子项目</option><option value="all">全部子项目任务</option></select></Field></div>{view==='current'?<ScopedRuntimeProvider scope={scope} canvasId={canvasId}><TaskPanel/></ScopedRuntimeProvider>:<section className="page"><header className="page-head"><div><p className="eyebrow">PROJECT ACTIVITY</p><h1>项目任务</h1><p>各集任务继续在原来的画布和修订中执行。</p></div></header><QueryState loading={tasks.isPending} error={tasks.error}/>{tasks.data?.items.map(item=><article className="task-row" key={item.task.taskId}><div className="grow"><h3>{children.data?.items.find(s=>s.id===item.subprojectId)?.title??'历史未分类'}</h3><p>{taskLabel[item.task.state]} · {item.task.taskId}</p></div><Button onClick={()=>setSelected(item.task.taskId)}>查看任务</Button>{item.subprojectId&&<Button onClick={()=>{onOpen(item.subprojectId!,item.canvasId);setSelected('');setView('current');}}>打开来源子项目</Button>}</article>)}{!tasks.data?.items.length&&<p>项目中暂无任务。</p>}{picked&&picked.subprojectId&&<ScopedRuntimeProvider scope={{projectId,subprojectId:picked.subprojectId}} canvasId={picked.canvasId??''}><TaskDetail taskId={picked.task.taskId} onClose={()=>setSelected('')}/></ScopedRuntimeProvider>}</section>}</div>;
}
