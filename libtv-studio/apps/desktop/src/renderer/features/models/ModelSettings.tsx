import {Icon} from '../../../../../../packages/ui/src/icons.tsx';
import {McpSettings} from './McpSettings.tsx';
import type { ModelConfigStatus } from '../../../../../../packages/contracts/src/desktop.ts';
import type { PublicModelConfig, ModelConfigEditOutcome } from '../../../../../../packages/contracts/src/model-config-file.ts';
import type { Result } from '../../../../../../packages/contracts/src/result.ts';
import { useEffect, useState } from 'react';
import type {
  ModelDefinition,
  ModelProfile,
  ProviderConnection,
  RevisionRef,
} from '../../../../../../packages/contracts/src/models.ts';
import { Button, Badge, Empty, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { ConfigDialog } from './ConfigDialog.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';

const ref = (item: { libraryId: string; id: string; revision: number }): RevisionRef => ({
  libraryId: item.libraryId,
  id: item.id,
  revision: item.revision,
});
function latest<T extends { id: string; revision: number }>(items: T[] = []) {
  return items.filter(
    (item) => !items.some((other) => other.id === item.id && other.revision > item.revision),
  );
}
export type Editing =
  | { kind: 'connection'; item?: ProviderConnection }
  | { kind: 'model'; item?: ModelDefinition }
  | { kind: 'profile'; item?: ModelProfile };
export function ModelSettings({showMcp=true}:{showMcp?:boolean}={}) {
  const providers = useWorkspaceQuery('provider.list', {}),
    models = useWorkspaceQuery('model.list', {}),
    profiles = useWorkspaceQuery('profile.list', {});
  const runtime = useRuntime(),
    [editing, setEditing] = useState<Editing | null>(null),
    [credentialError, setCredentialError] = useState('');
  const [fileStatus, setFileStatus] = useState<ModelConfigStatus | null>(null);
  const [fileConfig, setFileConfig] = useState<PublicModelConfig | null>(null), [fileBusy, setFileBusy] = useState(false), [fileMessage, setFileMessage] = useState(''), [removing, setRemoving] = useState<string | null>(null);
  async function readFile() { const [info, config] = await Promise.all([window.studio.workspaceInfo(), window.studio.readModelConfig()]); if (info.ok) setFileStatus(info.value.modelConfig); if (config.ok) setFileConfig(config.value); else setFileMessage(config.error.message); }
  useEffect(() => { void readFile(); }, []);
  async function reloadFile() { setFileBusy(true); try { const result = await window.studio.reloadModelConfig(); if (result.ok) { setFileStatus(result.value); setFileMessage(result.value.state === 'error' ? '文件尚未载入当前项目，请修正配置后重试。' : '当前项目已载入文件配置。'); await Promise.all([readFile(), providers.refetch(), models.refetch(), profiles.refetch()]); } else setFileMessage(result.error.message); } finally { setFileBusy(false); } }
  async function fileOperation(action: () => Promise<Result<ModelConfigEditOutcome>>) {
    setFileBusy(true); setFileMessage('');
    try { const result = await action(); if (!result.ok) setFileMessage(result.error.message); else if (result.value.status === 'saved') setFileMessage(result.value.synchronization === 'imported' ? '文件已保存；当前项目已载入。' : '文件已保存；当前项目尚未载入，请点击重新载入配置重试。'); await Promise.all([readFile(), runtime.refresh()]); }
    catch { setFileMessage('操作未完成，请检查配置状态后重试。'); }
    finally { setFileBusy(false); setRemoving(null); }
  }
  const editFile = (providerId?: string) => fileConfig && fileOperation(() => window.studio.openModelConfigEditor({ ...(providerId ? { providerId } : {}), expectedVersion: fileConfig.version }));
  const managed = (kind: 'connections' | 'models' | 'profiles', id: string) => fileStatus?.managedIds?.[kind].includes(id) ?? false;
  const providerId = (id: string, suffix: string) => id.slice(5, -suffix.length);
  const synchronized = (id: string) => fileConfig?.providers.some(p => p.id === id) ?? false;
  const locked = !runtime.online || runtime.busy || runtime.pending || fileBusy;
  const connections = latest(providers.data?.connections),
    definitions = latest(models.data?.models),
    plans = latest(profiles.data?.profiles);
  async function credentials(connection: ProviderConnection) {
    setCredentialError('');
    try {
      const result = await window.studio.openCredentialEditor(ref(connection));
      if (!result.ok) {
        setCredentialError(result.error.message);
        return;
      }
      if (result.value.status !== 'cancelled') {
        const { libraryId: _library, revision, createdAt: _date, ...input } = connection;
        await runtime.command('provider.saveConnection', {
          ...input,
          expectedRevision: revision,
          credentialRef: result.value.credentialRef,
        });
      }
      await runtime.refresh();
    } catch {
      setCredentialError('凭据窗口未完成，请重新检查凭据状态。');
    }
  }
  return (
    <section className="page settings-page">{showMcp&&<McpSettings />}
      {fileStatus && <div className="section-head"><div><p>{fileStatus.source}</p><p>{fileStatus.state === 'ready' ? '已载入配置 · 可在编辑连接中测试，服务状态可能变化' : fileStatus.state === 'error' ? `配置需要修正：${fileStatus.errorCode}` : '尚未配置 · 可正常编辑项目'}</p></div><Button disabled={locked} onClick={() => void reloadFile()}>重新载入配置</Button></div>}
      <div className="settings-section"><div className="section-head"><div><h2>软件全局模型配置</h2><p>写入软件 config/models.json。项目预设与已受理任务保留各自固定版本。</p><p className="hint">声音参考选择 H3，固定配音修正选择 Sync；音色、格式、时长和画幅使用业务字段。配置有效仍需单独试听、审核与批次批准。</p></div><Button disabled={locked || !fileConfig} onClick={() => void editFile()}>新增全局模型</Button></div>
        {fileMessage && <p role="status" className="alert">{fileMessage}</p>}
        {fileConfig?.providers.map(p => <div className="config-row" key={p.id}><div className="grow"><h3>{p.name} <Badge>{p.hasKey ? '已有 Key' : '未配置 Key'}</Badge></h3><p>{p.adapterType} · {p.modelId || '未填写模型'} · {p.baseURL || '未填写地址'}</p></div><Button disabled={locked} onClick={() => void editFile(p.id)}>编辑全局配置</Button><Button disabled={locked} onClick={() => setRemoving(p.id)}>删除全局条目</Button>{removing === p.id && <div role="alert"><p>删除后停止此连接的新任务使用，保留项目历史与已受理任务。</p><Button disabled={locked} onClick={() => void fileOperation(() => window.studio.removeModelConfigProvider({providerId:p.id,expectedVersion:fileConfig.version}))}>确认删除</Button><Button onClick={() => setRemoving(null)}>取消</Button></div>}</div>)}
      </div>
      <header className="page-head">
        <div>
          <p className="eyebrow">CONFIGURATION</p>
          <h1>模型设置</h1>
          <p>连接、模型与参数方案，各自保存为不可变版本。</p>
        </div>
        <Badge>文本 · 图片 · 视频 · 配音 · 转写</Badge>
      </header>
      <QueryState loading={providers.isPending || models.isPending || profiles.isPending} error={providers.error || models.error || profiles.error} />
      {credentialError && (
        <p role="alert" className="alert">
          {credentialError}
        </p>
      )}
      <div className="settings-section">
        <div className="section-head">
          <div>
            <h2>
              01 <span>供应方连接</span>
            </h2>
            <p>凭据在独立安全窗口输入，工作台只显示状态。</p>
          </div>
          <Button disabled={locked} onClick={() => setEditing({ kind: 'connection' })}>
            新建连接
          </Button>
        </div>
        {providers.isSuccess && providers.data.connections.length === 0 && (
          <Empty title="连接你的生成服务">
            支持文本、文生图、参考图生成和 MiniMax 视频；配置保存不代表认证或生成已验证。
          </Empty>
        )}
        {connections.map((c) => {
          const credential = providers.data?.credentialStatuses.find(
            (s) => s.ref.id === c.credentialRef?.id && s.ref.version === c.credentialRef?.version,
          );
          return (
            <div className="config-row" key={c.id}>
              <Icon name="arrow"/>
              <div className="grow">
                <h3>
                  {c.name} <Badge>v{c.revision}</Badge>
                </h3>
                <p>{c.baseUrl}</p>
                <div className="metadata">
                  <span>
                    {credential?.state === 'protected'
                      ? '凭据已保护'
                      : credential?.state === 'session'
                        ? '凭据仅当前会话'
                        : credential?.state === 'revoked'
                          ? '凭据已撤销'
                          : '尚无可用凭据'}
                  </span>
                  <span>{c.networkPolicy.privateEndpoint ? '私有端点 · 已明确授权' : '公共 HTTPS'}</span>
                  <span>
                    超时 {c.timeoutMs / 1000}s · 并发 {c.concurrency}
                  </span>
                </div>
              </div>
              {managed('connections', c.id) && <Badge>{synchronized(providerId(c.id,'-connection')) ? '文件管理' : '历史配置 · 来源已移除'}</Badge>}
              <Button disabled={locked || managed('connections',c.id) && !synchronized(providerId(c.id,'-connection'))} onClick={() => managed('connections',c.id) ? void editFile(providerId(c.id,'-connection')) : void credentials(c)}>
                管理凭据
              </Button>
              <Button disabled={locked || managed('connections',c.id) && !synchronized(providerId(c.id,'-connection'))} onClick={() => managed('connections',c.id) ? void editFile(providerId(c.id,'-connection')) : setEditing({ kind: 'connection', item: c })}>
                编辑连接
              </Button>
            </div>
          );
        })}
      </div>
      <div className="settings-section">
        <div className="section-head">
          <div>
            <h2>
              02 <span>模型定义</span>
            </h2>
            <p>模型 ID 由你的服务提供。认证无免费权威探测，生成证据单独记录。</p>
          </div>
          <Button
            disabled={locked || !providers.data?.connections.length}
            onClick={() => setEditing({ kind: 'model' })}
          >
            新建模型
          </Button>
        </div>
        {definitions.map((m) => {
          const v = providers.data?.verification.find(
            (v) =>
              v.modelId === m.modelId &&
              v.connectionRef.id === m.connectionRef.id &&
              v.connectionRef.revision === m.connectionRef.revision,
          );
          return (
            <div className="config-row" key={m.id}>
              <Icon name="model"/>
              <div className="grow">
                <h3>
                  {m.name} <Badge>v{m.revision}</Badge>
                </h3>
                <p>
                  {m.modelId} · 连接 v{m.connectionRef.revision}
                </p>
                <div className="metadata">
                  <span>
                    配置：
                    {v?.configuration === 'invalid'
                      ? '无效'
                      : v?.configuration === 'valid'
                        ? '有效'
                        : '尚未检查'}
                  </span>
                  <span>
                    认证：
                    {v?.authentication === 'accepted'
                      ? '已接受'
                      : v?.authentication === 'rejected'
                        ? '已拒绝'
                        : '未知'}
                  </span>
                  <span>真实生成：{v?.generation === 'verified' ? '已验证' : '未验证'}</span>
                  {v?.fixtureGeneration && <Badge warning>仅 fixture 已验证</Badge>}
                </div>
              </div>
              <Badge warning={m.pricing.status === 'unknown'}>
                {m.pricing.status === 'unknown'
                  ? '计价未知'
                  : `${m.pricing.currency} ${'perThousandCharacters' in m.pricing ? m.pricing.perThousandCharacters + '/千计费字符' : 'perAudioSecond' in m.pricing ? m.pricing.perAudioSecond + '/音频秒' : 'perSecond' in m.pricing ? m.pricing.perSecond + '/秒' : m.pricing.perImage + '/张'}`}
              </Badge>
              {managed('models',m.id) && <Badge>{synchronized(providerId(m.id,'-model')) ? '文件管理' : '历史配置 · 来源已移除'}</Badge>}
              <Button disabled={locked || managed('models',m.id) && !synchronized(providerId(m.id,'-model'))} onClick={() => managed('models',m.id) ? void editFile(providerId(m.id,'-model')) : setEditing({ kind: 'model', item: m })}>
                编辑模型
              </Button>
            </div>
          );
        })}
      </div>
      <div className="settings-section">
        <div className="section-head">
          <div>
            <h2>
              03 <span>生成预设</span>
            </h2>
            <p>画布引用固定版本，旧方案不会随配置编辑而改变。</p>
          </div>
          <Button
            disabled={locked || !models.data?.models.length}
            onClick={() => setEditing({ kind: 'profile' })}
          >
            新建预设
          </Button>
        </div>
        {plans.map((p) => (
          <div className="config-row" key={p.id}>
            <Icon name="preferences"/>
            <div className="grow">
              <h3>
                {p.name} <Badge>v{p.revision}</Badge>
              </h3>
              <p>
                模型 v{p.modelRef.revision} ·{' '}
                {Object.entries(p.parameters)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ') || '服务默认参数'}
              </p>
            </div>
            {managed('profiles',p.id) && <Badge>{synchronized(providerId(p.id,'-profile')) ? '全局默认 · 可新建独立项目预设' : '历史默认 · 来源已移除'}</Badge>}
            <Button disabled={locked || managed('profiles',p.id) && !synchronized(providerId(p.id,'-profile'))} onClick={() => managed('profiles',p.id) ? void editFile(providerId(p.id,'-profile')) : setEditing({ kind: 'profile', item: p })}>
              编辑预设
            </Button>
          </div>
        ))}
      </div>
      <p className="footnote">
        支持文本、单张文生图、参考图生成与 MiniMax 视频；各协议支持的模式与参数不同。保存配置不会自动发起付费探测。
      </p>
      {editing && (
        <ConfigDialog
          editing={editing}
          connections={connections}
          models={definitions}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
