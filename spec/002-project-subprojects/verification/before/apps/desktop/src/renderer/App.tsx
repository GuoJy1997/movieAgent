import { AgentWorkspace } from './features/agent/AgentWorkspace.tsx';
import { CreationWorkspace } from './features/creation/CreationWorkspace.tsx';
import { EntityWorkspace } from './features/entities/EntityWorkspace.tsx';
import type { WorkspaceInfo } from '../../../../packages/contracts/src/launcher.ts';
import { useEffect, useState } from 'react';
import type { ProjectRef } from '../../../../packages/contracts/src/projects.ts';
import { Button } from '../../../../packages/ui/src/controls.tsx';
import { Icon, type IconName } from '../../../../packages/ui/src/icons.tsx';
import { useRuntime } from './services/runtime.tsx';
import { ProjectHome } from './features/projects/ProjectHome.tsx';
import { ModelSettings } from './features/models/ModelSettings.tsx';
import { AssetLibrary } from './features/assets/AssetLibrary.tsx';
import { CanvasWorkspace } from './features/canvas/CanvasWorkspace.tsx';
import { TaskPanel } from './features/tasks/TaskPanel.tsx';
import { TimelineWorkspace, timelineNavigate } from './features/timeline/TimelineWorkspace.tsx';
import { DraftNavigationGuard } from './state/DraftNavigationGuard.tsx';
type Page = 'timeline' | 'agent' | 'creation' | 'entities' | 'projects' | 'canvas' | 'assets' | 'tasks' | 'models';
const navigation: { id: Page; label: string; icon: IconName }[] = [
  { id: 'projects', label: '项目', icon: 'folder' },
  { id: 'canvas', label: '画布', icon: 'canvas' },
  { id: 'agent', label: '创作 Agent', icon: 'arrow' },
  { id: 'creation', label: '剧本分镜', icon: 'folder' },
  { id: 'timeline', label: '剪辑成片', icon: 'clock' },
  { id: 'entities', label: '角色场景', icon: 'image' },
  { id: 'assets', label: '资产', icon: 'image' },
  { id: 'tasks', label: '任务', icon: 'clock' },
  { id: 'models', label: '模型设置', icon: 'settings' },
];
export function App() {
  const [page, setPage] = useState<Page>('projects'),
    [project, setProject] = useState<ProjectRef | null>(null),
    runtime = useRuntime();
  const [actionError,setActionError]=useState(''),[focusShotId,setFocusShotId]=useState<string|undefined>(), [focusDialogue, setFocusDialogue] = useState(false);
  async function navigationAction(action:()=>Promise<import('../../../../packages/contracts/src/result.ts').Result<void>>) {setActionError('');try{const result=await action();if(!result.ok)setActionError(`${result.error.code} · ${result.error.message}`);}catch{setActionError('操作失败，请稍后重试。');}}
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  useEffect(() => { void window.studio.workspaceInfo().then(async result => {
    if (!result.ok) return; setWorkspace(result.value);
    if (result.value.project?.manifest.binding) {
      const listed = await window.studio.listProjects();
      if (listed.ok) { const selected = listed.value.find(p => p.id === result.value.project!.manifest.binding!.projectId); if (selected) { setProject(selected); setPage('canvas'); } }
    }
  }); }, []);
  return (
    <div className="studio-shell">
      <DraftNavigationGuard />
      <aside className="app-sidebar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            MovieAgent <span>STUDIO</span>
          </div>
        </div>
        <div className="library-label">
          {workspace?.project?.manifest.name ?? '个人资料库'} <span>LOCAL</span>
        </div>
        <nav aria-label="工作区导航">
          <span
            className="nav-indicator"
            style={{ transform: `translateY(${navigation.findIndex((n) => n.id === page) * 44}px)` }}
          />
          {navigation.map((n) => (
            <button
              key={n.id}
              aria-current={page === n.id ? 'page' : undefined}
              disabled={['canvas','agent','creation','entities','timeline'].includes(n.id) && !project}
              onClick={() => timelineNavigate(() => setPage(n.id))}
            >
              <Icon name={n.icon} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">

          <div>
            <span className={runtime.online ? 'status-dot' : 'offline-dot'} />
            <strong>
              {runtime.online ? '本地引擎已连接' : runtime.descriptor ? '引擎连接已中断' : '正在连接资料库'}
            </strong>
          </div>
          <p>{runtime.online ? '本机资料库 · 自动收存原件' : '新提交停用 · 保留未保存草稿'}</p>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <span>
            工作空间 <span className="breadcrumb">/ {navigation.find((n) => n.id === page)?.label}</span>
          </span>
          <div>
          <Button tone="quiet" onClick={() => void navigationAction(()=>window.studio.openProjectLauncher())}>项目启动器</Button>
          {workspace?.project && <Button tone="quiet" onClick={() => void navigationAction(()=>window.studio.openProjectFolder())}>打开短剧文件夹</Button>}
            {project && (
              <button className="open-project-tab" onClick={() => timelineNavigate(() => setPage('canvas'))}>
                ◇ {project.name}
              </button>
            )}
            <span className="local-label">本地优先</span>
          </div>
        </header>
        {runtime.descriptor?.schedulingPaused && <div className="global-alert" role="status"><div><strong>恢复副本 · 任务执行已暂停</strong><p>可检查项目内容。需要继续制作时，请先关闭此项目，在“项目启动器 → 项目维护”确认原项目已停止，再启用执行。</p></div></div>}
        {actionError&&<div className="global-alert" role="alert"><p>{actionError}</p><Button onClick={()=>setActionError('')}>关闭操作提示</Button></div>}
        {runtime.error && (
          <div className="global-alert" role="alert">
            <div>
              <strong>{runtime.error.code}</strong>
              <p>{runtime.error.message}</p>
              {Object.entries(runtime.error.fieldErrors ?? {}).map(([key, value]) => (
                <p key={key}>
                  {key}: {value}
                </p>
              ))}
            </div>
            {runtime.pending ? (
              <Button disabled={runtime.busy} onClick={() => void runtime.recover()}>
                核实原回执
              </Button>
            ) : (
              <Button tone="quiet" onClick={runtime.clearError}>
                关闭提示
              </Button>
            )}
          </div>
        )}
        <div className="page-container" key={page}>
          {page === 'projects' && (
            <ProjectHome
              directoryMode={Boolean(workspace?.project)}
              onConfigure={() => setPage('models')}
              onOpen={(p) => {
                setProject(p);
                setPage('canvas');
              }}
            />
          )}
          {page === 'models' && <ModelSettings />}
          {page === 'assets' && (
            <AssetLibrary canvasId={project?.id ?? null} onPlace={() => setPage('canvas')} />
          )}
          {page === 'tasks' && <TaskPanel />}
          {page === 'canvas' && project && <CanvasWorkspace key={project.id} project={project} onEditShot={id=>{setFocusShotId(id);setFocusDialogue(false);setPage('creation');}} onOpenDialogue={id => { setFocusShotId(id); setFocusDialogue(true); setPage('creation'); }} />}
          {page === 'agent' && project && <AgentWorkspace projectId={project.id} onCreation={()=>{setFocusShotId(undefined);setPage('creation');}} />}
          {page === 'creation' && project && <CreationWorkspace projectId={project.id} directoryMode={Boolean(workspace?.project)} focusShotId={focusShotId} openDialogue={focusDialogue} />}
          {page === 'entities' && project && <EntityWorkspace projectId={project.id} />}
          {page === 'timeline' && project && <TimelineWorkspace key={project.id} projectId={project.id} />}
        </div>
      </main>
    </div>
  );
}
