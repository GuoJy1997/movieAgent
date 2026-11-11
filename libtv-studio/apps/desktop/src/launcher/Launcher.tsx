import {Brand} from '../../../../packages/ui/src/Brand.tsx';
import { useEffect, useState } from 'react';
import type { RecentProjectStatus } from '../../../../packages/contracts/src/directory-projects.ts';
import type { ModelConfigStatus } from '../../../../packages/contracts/src/desktop.ts';
import type { Result } from '../../../../packages/contracts/src/result.ts';
import { Button, Field } from '../../../../packages/ui/src/controls.tsx';
import { ProjectMaintenance } from './ProjectMaintenance.tsx';
export function Launcher() {
  const [recent, setRecent] = useState<RecentProjectStatus[]>([]), [name, setName] = useState(''), [config, setConfig] = useState<ModelConfigStatus | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function refresh() { const [list, status] = await Promise.all([window.projectLauncher.listRecent(), window.projectLauncher.configInfo()]); if (list.ok) setRecent(list.value); else setMessage(list.error.message); if (status.ok) setConfig(status.value); }
  useEffect(() => { void refresh(); }, []);
  async function action(operation: () => Promise<Result<unknown>>, describe?: (value: any) => string) { setBusy(true); setMessage(''); try { const result = await operation(); if (!result.ok) setMessage(`${result.error.code} · ${result.error.message}`); else { await refresh(); if (result.value != null && describe) setMessage(describe(result.value)); } } catch { setMessage('操作未完成，请重试。'); } finally { setBusy(false); } }
  return <main className="page home-page" style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 40px' }}>
    <Brand/><header className="page-head"><div><p className="eyebrow">YANGFAN / LOCAL STUDIO</p><h1>你的短剧，从这里开始</h1><p>一部短剧，一个文件夹。剧本、分镜与创作素材保存在本机。</p></div><span className="folio">PROJECTS</span></header>
    <div className="project-create"><Field label="短剧名称"><input value={name} maxLength={200} placeholder="输入短剧名称" onChange={event => setName(event.target.value)} /></Field><Button tone="primary" disabled={busy || !name.trim()} onClick={() => void action(() => window.projectLauncher.createNew(name.trim()))}>新建短剧</Button><Button disabled={busy || !name.trim()} onClick={() => void action(() => window.projectLauncher.fromFolder(name.trim()))}>从已有文件夹创建</Button><Button disabled={busy} onClick={() => void action(() => window.projectLauncher.openExisting())}>打开项目</Button></div>
    <p className="muted">新建时选择父目录；从已有文件夹创建只补齐模板，保留原有内容。</p>
    {busy && <p role="status">操作进行中，请等待完成…</p>}
    {message && <p role="status" style={{ overflowWrap: 'anywhere' }}>{message}</p>}
    <div className="section-head"><h2>最近项目 <span>{recent.length}</span></h2><Button tone="quiet" disabled={busy} onClick={() => void refresh()}>刷新</Button></div>
    <div className="project-list">{recent.length === 0 && <p>还没有最近项目。新建短剧，或打开带有 movieagent.project.json 的文件夹。</p>}{recent.map((project, i) => <button className="project-row" key={project.workspaceId} disabled={busy || project.availability !== 'available'} onClick={() => void action(() => window.projectLauncher.openRecent(project.workspaceId))}><span className="project-index">{String(i + 1).padStart(2, '0')}</span><div><h3>{project.name}</h3><p>{project.root}</p></div><span className="row-action">{project.availability === 'available' ? '打开工作台 ↗' : project.availability === 'missing' ? '目录已搬移 · 用打开项目重新定位' : '目录需要检查'}</span></button>)}</div>
    <section style={{ marginTop: 36 }}><div className="section-head"><h2>模型配置</h2><Button disabled={busy} onClick={() => void action(() => window.projectLauncher.openConfig())}>打开配置文件</Button></div><p>{config?.state === 'ready' ? '配置格式有效 · 进入工作台后载入，尚未验证服务' : config?.state === 'error' ? `配置需要修正：${config.errorCode}` : '尚未配置 · 可正常创建和编辑项目'}</p><p style={{ overflowWrap: 'anywhere' }}>{config?.source}</p><p>支持 OpenAI / Anthropic 兼容文本、OpenAI 图片和 MiniMax 视频。进入工作台 → 模型设置 → 新增全局模型，可选择文本协议并测试连接。启动与载入配置不会发起模型测试。</p></section>
    <ProjectMaintenance busy={busy} run={action} />
    <footer style={{ marginTop: 32 }}><Button tone="quiet" disabled={busy} onClick={() => void action(() => window.projectLauncher.openLegacy())}>打开旧版资料库</Button><span className="local-label">支持剧本分镜、创作 Agent、角色声音档案、图片/视频制作、对白、音频时间线与 MP4 导出。</span></footer>
  </main>;
}
