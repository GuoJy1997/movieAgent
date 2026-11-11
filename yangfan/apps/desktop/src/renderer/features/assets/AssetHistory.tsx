import { useState } from 'react';
import type { AssetView } from '../../../../../../packages/contracts/src/assets.ts';
import { Button, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';

export function AssetHistory({ asset, onSelect, onClose, showVersions=true }: { showVersions?:boolean; asset: AssetView; onSelect(asset: AssetView): void; onClose(): void }) {
  const runtime = useRuntime(), history = useWorkspaceQuery('asset.history', { assetId: asset.ref.assetId });
  const [name, setName] = useState(asset.name), [tags, setTags] = useState((asset.tags ?? []).join(', ')), [error, setError] = useState('');
  const [expectedRevision, setExpectedRevision] = useState(asset.metadataRevision ?? 1);
  const latest = history.data?.versions.at(-1), metadata = latest ?? asset;
  const locked = !runtime.online || runtime.busy || runtime.pending, trashed = metadata.deletedAt != null;
  async function append() {
    if (!latest) return;
    setError('');
    try {
      const grant = await window.studio.selectImportFiles(); if (!grant.ok) { setError(grant.error.message); return; }
      if (!grant.value) return;
      if (grant.value.fileCount !== 1) { setError('新增版本每次只选择一个文件。'); return; }
      const result = await runtime.command('asset.importGrantedFiles', { grantId: grant.value.grantId, assetId: asset.ref.assetId, expectedVersion: latest.ref.version });
      if (!result) setError('版本未保存。若版本冲突，请刷新历史并重新选择。');
    } catch { setError('文件选择未完成，请重试。'); }
  }
  return <section className="asset-management" aria-label="资产版本管理">
    <form className="asset-metadata-form" onSubmit={async event => {
      event.preventDefault();
      const result = await runtime.command('asset.updateMetadata', { assetId: asset.ref.assetId, expectedRevision, name, tags: tags.trim() ? tags.split(/[,，]/) : [] });
      if (result) { setExpectedRevision(result.metadataRevision); setName(result.name); setTags(result.tags.join(', ')); onSelect({ ...asset, ...result }); }
    }}>
      <Field label="资产名称"><input value={name} onChange={event => setName(event.target.value)} maxLength={200} required /></Field>
      <Field label="标签（逗号分隔）"><input value={tags} onChange={event => setTags(event.target.value)} /></Field>
      <Button type="submit" disabled={locked}>保存名称和标签</Button>
      <Button type="button" disabled={locked || !latest} onClick={() => { setName(metadata.name); setTags((metadata.tags ?? []).join(', ')); setExpectedRevision(metadata.metadataRevision ?? 1); }}>重新读取名称和标签</Button>
    </form>
    <QueryState loading={history.isPending} error={history.error} />
    {showVersions&&<div className="asset-version-list" aria-label="固定版本历史">{history.data?.versions.map(version => <div key={version.ref.version}>
      <Button aria-pressed={version.ref.version === asset.ref.version} onClick={() => onSelect(version)} aria-label={`选择固定版本 v${version.ref.version}`}>v{version.ref.version}</Button>
      <span>{version.sourceArtifactRef ? '生成产物' : '文件导入'} · {version.createdAt} · {version.mime}</span>
    </div>)}</div>}
    <div className="dialog-actions">
      {!trashed && <Button disabled={locked || !latest} onClick={() => void append()}>导入为新版本（基于 v{latest?.ref.version ?? asset.ref.version}）</Button>}
      <Button disabled={locked} onClick={async () => {
        const result = await runtime.command(trashed ? 'asset.restore' : 'asset.trash', { assetId: asset.ref.assetId, expectedRevision: metadata.metadataRevision ?? 1 });
        if (result) onClose();
      }}>{trashed ? '恢复资产' : '移入回收站'}</Button>
    </div>
    {error && <p role="alert" className="alert">{error}</p>}
  </section>;
}
