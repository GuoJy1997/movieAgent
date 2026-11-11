import {useState} from 'react';
import {Button} from '../../../../../../packages/ui/src/controls.tsx';
import {PillNav} from '../../../../../../packages/ui/src/pill-nav/PillNav.tsx';
import {pillArt} from '../../../../../../packages/ui/src/pill-nav/art.ts';
import {timelineNavigate} from '../../state/DraftNavigationGuard.tsx';
import {ModelSettings} from './ModelSettings.tsx';
import {McpSettings} from './McpSettings.tsx';
export function SettingsWorkspace(){
 const [tab,setTab]=useState<'models'|'mcp'|'local'>('models'),[error,setError]=useState('');
 return <section className="settings-workspace"><header className="page-head"><div><p className="eyebrow">PREFERENCES</p><h1>设置</h1><p>应用配置统一管理，各部短剧保持独立工作目录。</p></div></header>
 <PillNav className="workspace-tabs" label="设置分类" value={tab} onChange={next=>timelineNavigate(()=>setTab(next))} panelId="settings-content" items={[{id:'models',label:'模型与预设',art:pillArt.sail},{id:'mcp',label:'MCP 接入',art:pillArt.orbit},{id:'local',label:'本机维护',art:pillArt.film}]}/>
 <div id="settings-content" role="tabpanel" aria-label={{models:'模型与预设',mcp:'MCP 接入',local:'本机维护'}[tab]}>
 {tab==='models'&&<ModelSettings showMcp={false}/>}
 {tab==='mcp'&&<McpSettings/>}
 {tab==='local'&&<section className="settings-section"><h2>项目与本机维护</h2><p>在项目启动器中管理工作目录、备份恢复与本机安装包。</p><Button onClick={async()=>{try{const r=await window.studio.openProjectLauncher();if(!r.ok)setError(r.error.message);}catch{setError('未能打开项目启动器，请重试。');}}}>打开项目维护</Button>{error&&<p role="alert">{error}</p>}</section>}
 </div></section>;
}
