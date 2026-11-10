import { useRevisionDraft } from './useRevisionDraft.ts';
import { creationNavigation, resolveShotEditor } from './creation-navigation.ts';
import { useReducer, useState } from 'react';
import type { CreationSnapshot, ScriptRevision, SaveScriptInput, ShotRevision, SaveShotInput } from '../../../../../../packages/contracts/src/creation.ts';
import { Badge, Button, Empty, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { CreationHistoryDialog, EntityPicker, TextField } from './CreationFields.tsx';
import { ShotProductionPanel } from './ShotProductionPanel.tsx';
import { ShotDialoguePanel } from './ShotDialoguePanel.tsx';
import { timelineNavigate } from '../../state/DraftNavigationGuard.tsx';
const scriptDraft = (projectId: string, s: ScriptRevision | null): SaveScriptInput => s ? {
  projectId,
  id: s.id,
  expectedRevision: s.revision,
  title: s.title,
  synopsis: s.synopsis,
  body: s.body,
  scenes: s.scenes
} : {
  projectId,
  id: crypto.randomUUID(),
  expectedRevision: 0,
  title: '',
  synopsis: '',
  body: '',
  scenes: [{
    id: crypto.randomUUID(),
    title: '第一场',
    location: '',
    time: '',
    description: ''
  }]
};
export function CreationWorkspace({
  projectId,
  directoryMode,
  focusShotId,
  openDialogue = false
}: {
  projectId: string;
  directoryMode: boolean;
  focusShotId?: string;
  openDialogue?: boolean;
}) {
  const q = useWorkspaceQuery('creation.read', {
    projectId
  });
  const [navigation, navigate] = useReducer(creationNavigation, {
    scriptId: '',
    focusDismissed: false,
    shot: null,
    editing: null
  });
  const {
    scriptId,
    editing
  } = navigation;
  const setScriptId = (value: string) => navigate({
    type: 'patch',
    patch: {
      scriptId: value
    }
  });
  const setFocusDismissed = (value: boolean) => navigate({
    type: 'patch',
    patch: {
      focusDismissed: value
    }
  });
  const setShot = (value: ShotRevision | 'new' | null) => navigate({
    type: 'patch',
    patch: {
      shot: value
    }
  });
  const setEditing = (value: ScriptRevision | 'new' | null) => navigate({
    type: 'patch',
    patch: {
      editing: value
    }
  });
  const [scriptEditorKey, setScriptEditorKey] = useState(0),
    [shotEditorKey, setShotEditorKey] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [history, setHistory] = useState<{
      id: string;
      kind: 'script' | 'shot';
    } | null>(null),
    [exportStatus, setExportStatus] = useState(''),
    [exporting, setExporting] = useState(false), [dialogueOpen, setDialogueOpen] = useState(openDialogue);
  const current = q.data?.scripts.find(s => s.id === (scriptId || q.data?.shots.find(s => s.id === focusShotId)?.scriptId)) ?? q.data?.scripts[0];
  const shots = q.data?.shots.filter(s => s.scriptId === current?.id).sort((a, b) => a.order - b.order) ?? [];
  const focused = resolveShotEditor(navigation, focusShotId, current?.id, q.data?.shots ?? []);
  function selectScript(id: string) {
    navigate({
      type: 'selectScript',
      scriptId: id
    });
    setSelected([]);
    setShotEditorKey(key => key + 1);
  }
  async function exportFile(format: 'json' | 'markdown') {
    if (!current) return;
    setExporting(true);
    setExportStatus('');
    try {
      const result = await window.studio.exportCreation({
        projectId,
        scriptId: current.id,
        revision: current.revision,
        format
      });
      setExportStatus(result.ok ? `已导出：${result.value.relativePath}` : `${result.error.code} · ${result.error.message}`);
    } catch {
      setExportStatus('导出连接中断，请重试。');
    } finally {
      setExporting(false);
    }
  }
  return <section className="creation-page">
    <div className="page-heading">
      <div>
        <p className="eyebrow">创作事实源 · 固定修订</p>
        <h1>剧本与分镜</h1>
        <p>编辑内容、选择镜头，再单独批准媒体制作。</p>
      </div>
      <Button tone="primary" onClick={() => timelineNavigate(() => {
        setScriptEditorKey(k => k + 1);
        setEditing('new');
      })}>新建剧本</Button>
    </div>
    <QueryState loading={q.isLoading} error={q.error} />
    {current && <div className="creation-toolbar">
      <Field label="当前剧本">
        <select value={current.id} onChange={e => { const id = e.target.value; timelineNavigate(() => selectScript(id)); }}>
          {q.data?.scripts.map(s => <option value={s.id} key={s.id}>{s.title} · v{s.revision}</option>)}
        </select>
      </Field>
      <Button onClick={() => timelineNavigate(() => {
        setScriptEditorKey(k => k + 1);
        setEditing(current);
      })}>编辑剧本与场景</Button>
      <Button onClick={() => setHistory({
        id: current.id,
        kind: 'script'
      })}>剧本历史</Button>
      <Button disabled={exporting || !directoryMode} onClick={() => void exportFile('json')}>导出 JSON</Button>
      <Button disabled={exporting || !directoryMode} onClick={() => void exportFile('markdown')}>导出 Markdown</Button>
    </div>}
    {!directoryMode && <p className="hint">旧版资料库没有短剧目录。导出需从项目启动器打开目录项目。</p>}
    {exportStatus && <p role="status" className="creation-export-status">{exportStatus}</p>}
    {editing && <ScriptEditor key={scriptEditorKey} projectId={projectId} initial={editing === 'new' ? null : editing} latest={q.data?.scripts.find(s => editing !== 'new' && s.id === editing.id)} onSaved={s => {
      setScriptId(s.id);
      setEditing(s);
    }} onClose={() => setEditing(null)} />}
    {!current && !editing && <Empty title="从第一场开始">新建剧本和场景，或让创作 Agent 提交可审阅的草稿。</Empty>}
    {current && q.data && <>
      <article className="creation-card">
        <Badge>剧本 v{current.revision}</Badge>
        <h2>{current.title}</h2>
        <p>{current.synopsis || '尚未填写梗概'}</p>
        <details>
          <summary>正文与场景 · {current.scenes.length} 场</summary>
          <pre>{current.body}</pre>
          {current.scenes.map(s => <p key={s.id}><strong>{s.title}</strong> · {s.location} · {s.time} — {s.description}</p>)}
        </details>
      </article>
      <div className="creation-toolbar">
        <h2>镜头表 · {shots.length}</h2>
        <Button disabled={current.scenes.length === 0} onClick={() => timelineNavigate(() => {
          setShotEditorKey(k => k + 1);
          setShot('new');
        })}>新建镜头</Button>
        <Button onClick={() => setSelected(shots.slice(0, 16).map(s => s.id))}>选取前 16 镜头</Button>
        <Button tone="quiet" onClick={() => setSelected([])}>清空选择</Button>
      </div>
      <div className="creation-layout">
        <div className="creation-list">
          {shots.map(s => <article className="creation-card" key={s.id}>
            <label className="check"><input type="checkbox" aria-label={`生产选择 ${s.title}`} checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} /><strong>{s.order + 1}. {s.title}</strong></label>
            <p>{s.durationSeconds}秒 · {s.shotSize || '景别待定'} · {s.cameraMovement || '运镜待定'} · {s.aspectRatio} · v{s.revision}</p>
            <p>{s.subject} · {s.action}</p>
            {s.entityRefs.some(r => (q.data!.entities.find(e => e.id === r.entityId)?.revision ?? r.revision) > r.revision) && <p className="warning-text">引用实体有新修订；此镜头仍使用固定旧版本。</p>}
            <Button onClick={() => timelineNavigate(() => {
              setShotEditorKey(k => k + 1);
              setShot(s);
            })}>编辑镜头 {s.title}</Button>
            <Button tone="quiet" onClick={() => setHistory({
              id: s.id,
              kind: 'shot'
            })}>镜头历史</Button>
          </article>)}
          {shots.length === 0 && <Empty title="还没有镜头">先保存场景，再添加第一个镜头。</Empty>}
        </div>
        {focused && <ShotEditor key={`${projectId}/${current.id}:${shotEditorKey}`} snapshot={q.data} script={current} initial={focused === 'new' ? null : focused} openDialogue={dialogueOpen} onSaved={setShot} onClose={() => timelineNavigate(() => {
          setShot(null);
          setFocusDismissed(true);
        })} />}
      </div>
      <ShotProductionPanel snapshot={q.data} script={current} selected={selected} onOpenDialogue={shot => timelineNavigate(() => { setShot(shot); setShotEditorKey(key => key + 1); setDialogueOpen(true); })} />
    </>}
    {history && <CreationHistoryDialog projectId={projectId} {...history} onClose={() => setHistory(null)} />}
  </section>;
}
function ScriptEditor({
  projectId,
  initial,
  latest,
  onSaved,
  onClose
}: {
  projectId: string;
  initial: ScriptRevision | null;
  latest?: ScriptRevision;
  onSaved(s: ScriptRevision): void;
  onClose(): void;
}) {
  const runtime = useRuntime();
  const {
    draft,
    saved,
    dirty,
    saving,
    change,
    reload,
    save
  } = useRevisionDraft(() => scriptDraft(projectId, initial));
  return <form className="creation-editor form-stack" onSubmit={async e => {
    e.preventDefault();
    await save(value => runtime.command('creation.saveScript', value), result => scriptDraft(projectId, result), onSaved);
  }}>
    <h2>剧本编辑 · 基准 v{draft.expectedRevision}</h2>
    {latest && latest.revision !== draft.expectedRevision && <p role="alert" className="alert">剧本有新版本，草稿保留。<Button onClick={() => reload(scriptDraft(projectId, latest))}>放弃草稿并读取最新剧本</Button></p>}
    <TextField label="剧本标题" max={200} required value={draft.title} onChange={title => change({
      title
    })} />
    <TextField label="故事梗概" max={4000} large value={draft.synopsis} onChange={synopsis => change({
      synopsis
    })} />
    <TextField label="剧本正文" max={64000} large value={draft.body} onChange={body => change({
      body
    })} />
    <h3>场景清单</h3>
    {draft.scenes.map((s, i) => <div className="creation-card form-grid" key={s.id}>
      {(['title', 'location', 'time', 'description'] as const).map(key => <TextField key={key} label={`场景 ${i + 1} ${{
        title: '标题',
        location: '地点',
        time: '时间',
        description: '描述'
      }[key]}`} value={s[key]} max={key === 'title' ? 200 : 2000} required={key === 'title'} onChange={value => change({
        scenes: draft.scenes.map(scene => scene.id === s.id ? {
          ...scene,
          [key]: value
        } : scene)
      })} />)}
      <Button tone="quiet" onClick={() => change({
        scenes: draft.scenes.filter(scene => scene.id !== s.id)
      })}>移除场景 {i + 1}</Button>
    </div>)}
    <p className="hint">场景修改只提示受影响镜头；被镜头引用的场景不能直接移除。</p>
    <Button disabled={draft.scenes.length >= 32} onClick={() => change({
      scenes: [...draft.scenes, {
        id: crypto.randomUUID(),
        title: `第 ${draft.scenes.length + 1} 场`,
        location: '',
        time: '',
        description: ''
      }]
    })}>添加场景</Button>
    <div className="dialog-actions">
      <Button onClick={onClose}>关闭编辑</Button>
      <Button tone="primary" type="submit" disabled={saving || runtime.busy || runtime.pending || !runtime.online}>保存剧本</Button>
    </div>
    {dirty && <p role="status">有未保存的修改</p>}
    {saved && <p role="status">剧本已保存</p>}
  </form>;
}
function ShotEditor({
  snapshot,
  script,
  initial,
  openDialogue = false,
  onSaved,
  onClose
}: {
  snapshot: CreationSnapshot;
  script: ScriptRevision;
  initial: ShotRevision | null;
  openDialogue?: boolean;
  onSaved(s: ShotRevision): void;
  onClose(): void;
}) {
  const runtime = useRuntime(), [showDialogue, setShowDialogue] = useState(openDialogue);
  const make = (s: ShotRevision | null): SaveShotInput => s ? {
    projectId: s.projectId,
    id: s.id,
    expectedRevision: s.revision,
    scriptId: s.scriptId,
    sceneId: s.sceneId,
    order: s.order,
    title: s.title,
    durationSeconds: s.durationSeconds,
    shotSize: s.shotSize,
    cameraMovement: s.cameraMovement,
    subject: s.subject,
    action: s.action,
    dialogue: s.dialogue,
    sound: s.sound,
    aspectRatio: s.aspectRatio,
    prompt: s.prompt,
    entityRefs: s.entityRefs
  } : {
    projectId: snapshot.projectId,
    id: crypto.randomUUID(),
    expectedRevision: 0,
    scriptId: script.id,
    sceneId: script.scenes[0]?.id ?? '',
    order: snapshot.shots.filter(s => s.scriptId === script.id).length,
    title: '',
    durationSeconds: 5,
    shotSize: '中景',
    cameraMovement: '固定',
    subject: '',
    action: '',
    dialogue: '',
    sound: '',
    aspectRatio: '16:9',
    prompt: '',
    entityRefs: []
  };
  const {
    draft,
    saved,
    dirty,
    saving,
    change,
    reload,
    save
  } = useRevisionDraft(() => make(initial));
  const latest = snapshot.shots.find(s => s.id === draft.id);
  return <form className="creation-editor form-stack" onSubmit={async e => {
    e.preventDefault();
    await save(value => runtime.command('creation.saveShot', value), make, onSaved);
  }}>
    <h2>镜头编辑 · 基准 v{draft.expectedRevision}</h2>
    {latest && latest.revision !== draft.expectedRevision && <p className="alert" role="alert">镜头已有新修订，当前草稿保留。<Button onClick={() => reload(make(latest))}>放弃草稿并读取最新镜头</Button></p>}
    <TextField label="镜头标题" max={200} required value={draft.title} onChange={title => change({
      title
    })} />
    <div className="form-grid">
      <Field label="镜头场景">
        <select value={draft.sceneId} onChange={e => change({
          sceneId: e.target.value
        })}>
          {script.scenes.map(s => <option value={s.id} key={s.id}>{s.title}</option>)}
        </select>
      </Field>
      <Field label="镜头排序（从0开始）">
        <input type="number" min={0} step={1} value={draft.order} onChange={e => change({
          order: Number(e.target.value)
        })} />
      </Field>
      <Field label="镜头时长（秒）">
        <input type="number" min={1} max={120} step={1} required value={draft.durationSeconds} onChange={e => change({
          durationSeconds: Number(e.target.value)
        })} />
      </Field>
      <Field label="镜头画幅">
        <select value={draft.aspectRatio} onChange={e => change({
          aspectRatio: e.target.value as SaveShotInput['aspectRatio']
        })}>
          {['16:9', '9:16', '1:1', '4:3'].map(r => <option key={r}>{r}</option>)}
        </select>
      </Field>
      {(['shotSize', 'cameraMovement', 'subject', 'action', 'dialogue', 'sound'] as const).map(key => <TextField key={key} label={{
        shotSize: '景别',
        cameraMovement: '运镜',
        subject: '主体',
        action: '动作',
        dialogue: '台词',
        sound: '声音描述'
      }[key]} value={draft[key]} onChange={value => change({
        [key]: value
      })} />)}
    </div>
    <TextField label="镜头生成提示词" max={8000} large value={draft.prompt} onChange={prompt => change({
      prompt
    })} />
    <EntityPicker entities={snapshot.entities} value={draft.entityRefs} onChange={entityRefs => change({
      entityRefs
    })} />
    {draft.expectedRevision > 0 && <><Button onClick={() => timelineNavigate(() => setShowDialogue(value => !value))}>对白制作</Button>{showDialogue && <ShotDialoguePanel projectId={snapshot.projectId} shotId={draft.id} shotRevision={draft.expectedRevision} />}</>}
    <div className="dialog-actions">
      <Button onClick={onClose}>关闭镜头编辑</Button>
      <Button type="submit" tone="primary" disabled={saving || runtime.busy || runtime.pending || !runtime.online}>保存镜头</Button>
    </div>
    {dirty && <p role="status">有未保存的修改</p>}
    {saved && <p role="status">镜头已保存</p>}
  </form>;
}
