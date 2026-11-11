import { useEffect, useState } from 'react';
import { Button, Field } from '../../../../packages/ui/src/controls.tsx';
import type { MaintenanceInfo } from '../../../../packages/contracts/src/project-maintenance.ts';
import type { Result } from '../../../../packages/contracts/src/result.ts';
export function ProjectMaintenance({ busy, run }: { busy: boolean; run(operation: () => Promise<Result<unknown>>, describe?: (value: any) => string): Promise<void> }) {
  const [info, setInfo] = useState<MaintenanceInfo | null>(null), [name, setName] = useState('');
  useEffect(() => { void window.projectLauncher.maintenanceInfo().then(result => { if (result.ok) setInfo(result.value); }); }, []);
  return <details className="project-maintenance" style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
    <summary style={{ cursor: 'pointer', fontSize: 20, fontWeight: 600 }}>项目维护</summary>
    <p className="muted">先关闭需要维护的项目工作台，再选择目录。备份和迁移期间请保持应用开启，等待完成提示。</p>
    <div className="section-head"><h3>完整备份</h3><Button disabled={busy} onClick={() => void run(() => window.projectLauncher.backupProject(), value => `备份完成：${value.root}（${value.fileCount} 个文件）。请保留整个目录。`)}>备份项目</Button></div>
    <p>包含数据库、素材原件、配音、剧本、分镜、画布及用户文件。临时文件、缓存、日志与模型密钥不随备份复制；换机后需重新配置模型密钥。建议将备份另存到其他磁盘。</p>
    <Field label="恢复 / 迁移的目标项目名称"><input value={name} maxLength={200} placeholder="例如：我的短剧·恢复版" onChange={event => setName(event.target.value)} /></Field>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
      <Button disabled={busy || !name.trim()} onClick={() => void run(() => window.projectLauncher.restoreProject(name.trim()), value => value.scheduling === 'active' ? `目标项目已存在且已启用执行：${value.root}。此次未覆盖文件，也未暂停执行。` : `恢复完成：${value.root}。任务执行已暂停；可先打开检查，关闭后再启用执行。`)}>从备份恢复</Button>
      <Button disabled={busy || !name.trim()} onClick={() => void run(() => window.projectLauncher.migrateProject(name.trim()), value => `迁移完成：${value.root}。原目录已停用，原文件与相邻的迁移备份已保留。`)}>迁移到新目录</Button>
      <Button disabled={busy} onClick={() => void run(() => window.projectLauncher.activateRestoredProject(), value => `已启用执行：${value.root}。下次打开后恢复任务对账与调度。`)}>启用恢复项目执行</Button>
    </div>
    <p className="muted">恢复和迁移均创建新目录，不覆盖已有文件夹。迁移保留源目录及一份完整迁移备份，需要额外磁盘空间。恢复副本默认暂停，确认原项目已停止后才能启用。</p>
    <div className="section-head"><h3>手动升级与回退</h3><span className="local-label">{info ? `MovieAgent ${info.appVersion} · 数据库 ${info.databaseSchema} · 备份格式 ${info.backupFormat}` : '读取版本信息…'}</span></div>
    <ol><li>关闭项目，先做完整备份，并另行保留模型配置文件。</li><li>退出 MovieAgent，运行你选择的新版安装包。安装程序不删除短剧目录。</li><li>重新打开原项目；数据库升级前会自动保存旧版数据库，升级失败时保留原库。</li></ol>
    <p>需要回退时，使用支持该备份版本的应用，把升级前的完整备份恢复到新目录；不要用旧版应用强行打开新版数据库。素材和数据库需要成套恢复。</p>
    <Button disabled={busy} onClick={() => void run(() => window.projectLauncher.revealUpgradeInstaller())}>定位本地安装包</Button>
    <p className="muted">此操作仅在文件管理器中定位已下载的安装包，由你自行运行。</p>
  </details>;
}
