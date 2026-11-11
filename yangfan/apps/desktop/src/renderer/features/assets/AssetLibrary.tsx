import {VoiceLibrary} from './VoiceLibrary.tsx';
import { useState } from 'react';
import type { AssetView, AssetVersionRef, AssetSearchInput } from '../../../../../../packages/contracts/src/assets.ts';
import { Button, Badge, Empty, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { Dialog } from '../../../../../../packages/ui/src/overlays.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { MediaPreview } from './MediaPreview.tsx';
import { RuntimeFeedback } from '../../services/RuntimeFeedback.tsx';
import { nextCanvasLayout } from '../../state/canvas-layout.ts';
import { AssetHistory } from './AssetHistory.tsx';
export function AssetLibrary({ canvasId, onPlace }: { canvasId: string | null; onPlace(): void }) {
  const [voicesOnly,setVoicesOnly]=useState(false);
  const [search, setSearch] = useState(''), [tag, setTag] = useState(''), [mediaType, setMediaType] = useState(''), [state, setState] = useState<'active' | 'trash'>('active');
  const query = useWorkspaceQuery('asset.search', { name: search, ...(tag.trim() ? { tag: tag.trim() } : {}), ...(mediaType ? { mediaType: mediaType as AssetSearchInput['mediaType'] } : {}), state, latestOnly: true }),
    canvas = useWorkspaceQuery('canvas.read', { canvasId: canvasId ?? '' }, Boolean(canvasId));
  const runtime = useRuntime(),
    [preview, setPreview] = useState<AssetView | null>(null),
    [error, setError] = useState('');
  const locked = !runtime.online || runtime.busy || runtime.pending;
  const assets =
    query.data?.assets ?? [];
  async function importFiles() {
    setError('');
    try {
      const result = await window.studio.selectImportFiles();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (result.value) await runtime.command('asset.importGrantedFiles', { grantId: result.value.grantId });
    } catch {
      setError('文件选择未完成，请重试。');
    }
  }
  async function place(media: AssetVersionRef) {
    if (!canvas.data) return;
    const result = await runtime.command('canvas.applyCommand', {
      canvasId: canvas.data.canvasId,
      baseRevision: canvas.data.revision,
      operations: [
        {
          kind: 'create',
          nodeId: crypto.randomUUID(),
          content: { type: 'media', media },
          layout: nextCanvasLayout(canvas.data.nodes),
        },
      ],
    });
    if (result) {
      setPreview(null);
      onPlace();
    }
  }
  return (
    <section className="page assets-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">MEDIA LIBRARY</p>
          <h1>资产</h1>
          <p>收藏生成原件，或导入图片、视频、TXT / MD。画布始终引用固定版本。</p>
        </div>
        <Button tone="primary" disabled={locked} onClick={() => void importFiles()}>
          导入素材
        </Button>
      </header>
      <div className="toolbar"><Button onClick={()=>setVoicesOnly(false)}>媒体素材</Button><Button disabled={!canvas.data} onClick={()=>setVoicesOnly(true)}>角色声音库</Button></div>
      {voicesOnly&&canvas.data?<VoiceLibrary projectId={canvas.data.projectId}/>:<>
      <div className="toolbar">
        <label className="search">
          <span>⌕</span>
          <input
            aria-label="搜索资产"
            placeholder="搜索资产名称"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <input aria-label="筛选标签" placeholder="按标签筛选" value={tag} onChange={event => setTag(event.target.value)} maxLength={32} />
        <select aria-label="素材类型" value={mediaType} onChange={event => setMediaType(event.target.value)}><option value="">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">声音</option><option value="text">文本</option></select>
        <select aria-label="资产状态" value={state} onChange={event => setState(event.target.value as 'active' | 'trash')}><option value="active">有效资产</option><option value="trash">回收站</option></select>
        <span>{query.data ? `${assets.length} 个资产` : '资产数待确认'}</span>
      </div>
      <QueryState loading={query.isPending} error={query.error} />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {query.isSuccess && !assets.length && (
        <Empty title={search ? '没有匹配的资产' : '为你的项目收集素材'}>
          {search ? '试试更短的名称，或清空搜索。' : '完成生成后，明确选择“加入资产库”，即可在这里找到原件。'}
        </Empty>
      )}
      <div className="asset-grid">
        {assets.map((a) => (
          <button
            className="asset-card"
            aria-label={`预览 ${a.name}`}
            key={`${a.ref.assetId}:${a.ref.version}`}
            onClick={() => setPreview(a)}
          >
            <div className="media-frame">
              <MediaPreview media={a.ref} thumbnail />
            </div>
            <div className="asset-caption">
              <h3>{a.name}</h3>
              <small>{(a.tags ?? []).join(' · ')}</small>
              {a.mime === 'video/mp4' && <small>视频 · 通用播放图标，非视频帧</small>}
              <p>
                {a.mime === 'text/plain' ? '文本' : `${a.width} × ${a.height}`} <span>v{a.ref.version}</span>
              </p>
            </div>
          </button>
        ))}
      </div>
      {preview && (
        <Dialog title={preview.name} onClose={() => setPreview(null)} wide>
          <div className="large-preview">
            <MediaPreview media={preview.ref} original />
          </div>
          <div className="preview-meta">
            <Badge>固定版本 v{preview.ref.version}</Badge>
            <span>
              {preview.mime === 'text/plain' ? '文本' : `${preview.width} × ${preview.height}`} · {(preview.byteLength / 1024).toFixed(1)} KB ·{' '}
              {preview.mime}
            </span>
          </div>
          <AssetHistory asset={preview} onSelect={setPreview} onClose={() => setPreview(null)} />
          <div className="dialog-actions">
            <p>{canvasId ? '放入当前项目，保留此版本。' : '先打开一个项目，再放入画布。'}</p>
            <Button tone="primary" disabled={locked || !canvas.data || state === 'trash'} onClick={() => void place(preview.ref)}>
              放入当前画布
            </Button>
          </div>
          <RuntimeFeedback />
        </Dialog>
      )}
      </>}
    </section>
  );
}
