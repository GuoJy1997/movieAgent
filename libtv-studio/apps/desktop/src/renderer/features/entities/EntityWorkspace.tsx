import { useState } from 'react';
import { useRevisionDraft } from '../creation/useRevisionDraft.ts';
import type { EntityRevision, SaveEntityInput } from '../../../../../../packages/contracts/src/creation.ts';
import { Button, Badge, Field, Empty, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { AssetPicker, CreationHistoryDialog, TextField } from '../creation/CreationFields.tsx';
import { CharacterVoicePanel } from './CharacterVoicePanel.tsx';
import { useOwnedDraft,timelineNavigate } from '../../state/DraftNavigationGuard.tsx';
const kinds = {
  character: '角色',
  scene: '场景设定',
  prop: '道具',
  style: '风格'
};
export function EntityWorkspace({
  projectId
}: {
  projectId: string;
}) {
  const query = useWorkspaceQuery('creation.read', {
    projectId
  });
  const [editorKey, setEditorKey] = useState(0);
  const [editing, setEditing] = useState<EntityRevision | 'new' | null>(null),
    [history, setHistory] = useState<string | null>(null);
  return <section className="creation-page">
    <div className="page-heading">
      <div>
        <p className="eyebrow">项目设定</p>
        <h1>角色与场景</h1>
        <p>实体按修订保存。已有镜头继续使用当时选定的版本。</p>
      </div>
      <Button tone="primary" onClick={() => timelineNavigate(() => {
        setEditorKey(k => k + 1);
        setEditing('new');
      })}>新建实体</Button>
    </div>
    <QueryState loading={query.isLoading} error={query.error} />
    <div className="creation-layout">
      <div className="creation-list">
        {query.data?.entities.map(e => <article className="creation-card" key={e.id}>
          <Badge>{kinds[e.kind]} · v{e.revision}</Badge>
          <h3>{e.name}</h3>
          <p>{e.description}</p>
          <Button onClick={() => timelineNavigate(() => {
            setEditorKey(k => k + 1);
            setEditing(e);
          })}>编辑 {e.name}</Button>
          <Button tone="quiet" onClick={() => setHistory(e.id)}>实体历史</Button>
        </article>)}
        {query.data?.entities.length === 0 && <Empty title="建立人物与世界">保存角色、场景、道具或风格，再在镜头里选择固定修订。</Empty>}
      </div>
      {editing && <EntityEditor key={`${projectId}/${editorKey}`} projectId={projectId} initial={editing === 'new' ? null : editing} latest={query.data?.entities.find(e => editing !== 'new' && e.id === editing.id)} onSaved={setEditing} />}
    </div>
    {history && <CreationHistoryDialog projectId={projectId} kind="entity" id={history} onClose={() => setHistory(null)} />}
  </section>;
}
export function EntityEditor({
  projectId,
  initial,
  initialKind = 'character',
  latest,
  onSaved
}: {
  projectId: string;
  initial: EntityRevision | null;
  initialKind?: SaveEntityInput['kind'];
  latest?: EntityRevision;
  onSaved(e: EntityRevision): void;
}) {
  const runtime = useRuntime(), [showVoice, setShowVoice] = useState(false);
  const make = (e: EntityRevision | null): SaveEntityInput => e ? {
    projectId,
    id: e.id,
    expectedRevision: e.revision,
    kind: e.kind,
    name: e.name,
    description: e.description,
    constraints: e.constraints,
    references: e.references
  } : {
    projectId,
    id: crypto.randomUUID(),
    expectedRevision: 0,
    kind: initialKind,
    name: '',
    description: '',
    constraints: '',
    references: []
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
  useOwnedDraft({dirty:dirty||saving,save:()=>save(value=>runtime.command('creation.saveEntity',value),make,onSaved),discard:()=>reload(make(initial))},draft);
  return <form className="creation-editor form-stack" onSubmit={async e => {
    e.preventDefault();
    await save(value => runtime.command('creation.saveEntity', value), make, onSaved);
  }}>
    <h2>{draft.expectedRevision ? '编辑实体' : '新建实体'}</h2>
    <Badge>编辑基准 v{draft.expectedRevision}</Badge>
    {latest && latest.revision !== draft.expectedRevision && <div className="alert" role="alert">
      实体已有 v
      {latest.revision}
      ，当前草稿保留。
      <Button onClick={() => reload(make(latest))}>放弃草稿并读取最新实体</Button>
    </div>}
    <Field label="实体类型">
      <select value={draft.kind} onChange={e => change({
        kind: e.target.value as SaveEntityInput['kind']
      })}>
        {Object.entries(kinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select>
    </Field>
    <TextField label="实体名称" max={200} required value={draft.name} onChange={name => change({
      name
    })} />
    <TextField label="实体描述" max={8000} large value={draft.description} onChange={description => change({
      description
    })} />
    <TextField label="一致性约束" max={8000} large value={draft.constraints} onChange={constraints => change({
      constraints
    })} />
    <AssetPicker value={draft.references} onChange={references => change({
      references
    })} />
    <p className="hint">保存新修订不会重写镜头。请在受影响的镜头中主动更新引用。</p>
    {draft.kind === 'character' && draft.expectedRevision > 0 && <><Button onClick={() => timelineNavigate(() => setShowVoice(value => !value))}>声音档案</Button>{showVoice && <CharacterVoicePanel projectId={projectId} entityRef={{ id: draft.id, revision: draft.expectedRevision }} />}</>}
    <Button type="submit" tone="primary" disabled={saving || runtime.busy || runtime.pending || !runtime.online}>保存实体</Button>
    {dirty && <p role="status">有未保存的修改</p>}
    {saved && <p role="status">实体已保存</p>}
  </form>;
}
