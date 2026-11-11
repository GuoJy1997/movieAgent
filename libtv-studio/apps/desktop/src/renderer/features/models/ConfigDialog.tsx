import { useRef, useState } from 'react';
import { adapterDefaults } from '../../../../../../packages/domain/src/model-config.ts';
import { ParameterFields } from './ParameterFields.tsx';
import type { ParameterValue, AdapterType, ModelDefinition, ProviderConnection, RevisionRef } from '../../../../../../packages/contracts/src/models.ts';
import { Button, Field } from '../../../../../../packages/ui/src/controls.tsx';
import { Dialog } from '../../../../../../packages/ui/src/overlays.tsx';
import { useRuntime } from '../../services/runtime.tsx';
import { RuntimeFeedback } from '../../services/RuntimeFeedback.tsx';
import type { Editing } from './ModelSettings.tsx';
const ref = (item: { libraryId: string; id: string; revision: number }): RevisionRef => ({ libraryId: item.libraryId, id: item.id, revision: item.revision });
export function ConfigDialog({
  editing,
  connections,
  models,
  onClose,
}: {
  editing: Editing;
  connections: ProviderConnection[];
  models: ModelDefinition[];
  onClose(): void;
}) {
  const runtime = useRuntime(),
    item = editing.item;
  const [name, setName] = useState(item?.name ?? ''),
    [url, setUrl] = useState(
      editing.kind === 'connection' ? (editing.item?.baseUrl ?? 'https://api.openai.com/v1') : '',
    );
  const [privateGrant, setPrivateGrant] = useState(
    editing.kind === 'connection' && Boolean(editing.item?.networkPolicy.privateEndpoint),
  );
  const [timeout, setTimeoutValue] = useState(
    editing.kind === 'connection' ? (editing.item?.timeoutMs ?? 120000) : 120000,
  );
  const [concurrency, setConcurrency] = useState(
    editing.kind === 'connection' ? (editing.item?.concurrency ?? 1) : 1,
  );
  const [adapterType, setAdapterType] = useState<AdapterType>(editing.kind === 'connection' ? editing.item?.adapterType ?? 'openai-image-v1' : 'openai-image-v1');
  const [parameters,setParameters]=useState<Record<string,ParameterValue>>(editing.kind==='profile'?editing.item?.parameters??{}:{});
  const [modelId, setModelId] = useState(editing.kind === 'model' ? (editing.item?.modelId ?? '') : '');
  const [selected, setSelected] = useState(
    editing.kind === 'model'
      ? (editing.item?.connectionRef.id ?? connections[0]?.id ?? '')
      : editing.kind === 'profile'
        ? (editing.item?.modelRef.id ?? models[0]?.id ?? '')
        : '',
  );
  const [price, setPrice] = useState(
    editing.kind === 'model' && editing.item?.pricing.status === 'configured'
      ? String('perSecond' in editing.item.pricing ? editing.item.pricing.perSecond : 'perThousandCharacters' in editing.item.pricing ? editing.item.pricing.perThousandCharacters : 'perAudioSecond' in editing.item.pricing ? editing.item.pricing.perAudioSecond : editing.item.pricing.perImage)
      : '',
  );
  const [currency, setCurrency] = useState(
    editing.kind === 'model' && editing.item?.pricing.status === 'configured'
      ? editing.item.pricing.currency
      : 'USD',
  );
  const [size, setSize] = useState(
    editing.kind === 'profile'
      ? String(editing.item?.parameters.size ?? '')
      : editing.kind === 'model' && editing.item?.parameters.size?.type === 'enum'
        ? editing.item.parameters.size.values.join(',')
        : '',
  );
  const selectedAdapter=editing.kind==='model'?connections.find(c=>c.id===selected)?.adapterType:undefined;
  const video=selectedAdapter==='minimax-video-v2'||selectedAdapter==='minimax-h3-v2',chat=selectedAdapter==='openai-chat-v1'||selectedAdapter==='anthropic-messages-v1';
  const lipSync = selectedAdapter === 'sync-lipsync-v2';
  const speech = selectedAdapter === 'openai-speech-v1' || selectedAdapter === 'minimax-speech-v1';
  const transcription = selectedAdapter === 'openai-transcription-v1' || selectedAdapter === 'minimax-transcription-v1';
  const [localError, setLocalError] = useState('');
  const label = editing.kind === 'connection' ? '连接' : editing.kind === 'model' ? '模型' : '预设';
  const fingerprint = JSON.stringify({ name, url, privateGrant, timeout, concurrency, modelId, selected, price, currency, size, adapterType, parameters });
  const initialFingerprint = useRef(fingerprint).current;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setLocalError('');
    const base = { id: item?.id ?? crypto.randomUUID(), expectedRevision: item?.revision ?? 0, name };
    let saved;
    if (editing.kind === 'connection') {
      let endpoint;
      try {
        endpoint = new URL(url);
      } catch {
        setLocalError('请输入完整 Base URL。');
        return;
      }
      saved = await runtime.command('provider.saveConnection', {
        ...base,
        adapterType,
        baseUrl: url,
        credentialRef: editing.item?.credentialRef ?? null,
        headers: editing.item?.headers ?? {},
        networkPolicy: {
          privateEndpoint: privateGrant
            ? {
                hostname: endpoint.hostname,
                port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)),
                purpose: 'model-api',
              }
            : null,
        },
        timeoutMs: timeout,
        concurrency,
      });
    } else if (editing.kind === 'model') {
      const connection = connections.find((c) => c.id === selected);
      if (!connection) return;
      const sizes = size
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      saved = await runtime.command('model.saveDefinition', {
        ...base,
        modelId,
        connectionRef: ref(connection),
        capabilities: editing.item?.connectionRef.id===connection.id ? editing.item.capabilities : adapterDefaults(connection.adapterType).capabilities,
        parameters: { ...(editing.item?.connectionRef.id===connection.id?editing.item.parameters:adapterDefaults(connection.adapterType).parameters), ...(!video&&!chat&&!speech&&!transcription&&!lipSync&&sizes.length?{size:{type:'enum' as const,values:sizes,default:sizes[0]!}}:{}) },
        pricing:
          chat || lipSync || price === ''
            ? { status: 'unknown' }
            : speech ? { status: 'configured', currency, perThousandCharacters: Number(price), version: crypto.randomUUID() } : transcription ? { status: 'configured', currency, perAudioSecond: Number(price), version: crypto.randomUUID() } : video ? { status: 'configured', currency, perSecond: Number(price), version: crypto.randomUUID() } : { status: 'configured', currency, perImage: Number(price), version: crypto.randomUUID() },
      });
    } else {
      const model = models.find((m) => m.id === selected);
      if (!model) return;
      saved = await runtime.command('profile.save', {
        ...base,
        modelRef: ref(model),
        parameters,
      });
    }
    if (saved) onClose();
  }
  return (
    <Dialog
      title={`${item ? '编辑' : '新建'}${label}`}
      onClose={onClose}
      dirty={fingerprint !== initialFingerprint}
    >
      <form className="form-stack" onSubmit={(event) => void save(event)}>
        <p className="hint">
          {item
            ? `将保存为 v${item.revision + 1}，保留既有版本。关联模型与预设需明确更新。`
            : '保存配置后仍需单独设置凭据与批准生成。'}
        </p>
        <Field label={`${label}名称`}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </Field>
        {editing.kind === 'connection' && (
          <>
            <Field label="适配协议">
              <select value={adapterType} onChange={e => setAdapterType(e.target.value as AdapterType)}>
                <option value="anthropic-messages-v1">Anthropic 文本 · anthropic-messages-v1</option>
                <option value="openai-chat-v1">OpenAI 文本 · openai-chat-v1</option>
                <option value="openai-image-edit-v1">OpenAI 参考图 · openai-image-edit-v1</option>
                <option value="openai-image-v1">OpenAI 图像 · openai-image-v1</option>
                <option value="minimax-video-v2">MiniMax 视频 · minimax-video-v2</option>
                <option value="minimax-h3-v2">MiniMax H3 声音参考 · minimax-h3-v2</option>
                <option value="sync-lipsync-v2">Sync 固定配音口型 · sync-lipsync-v2</option>
                <option value="minimax-speech-v1">MiniMax 配音 · minimax-speech-v1</option>
                <option value="openai-speech-v1">OpenAI 配音 · openai-speech-v1</option>
                <option value="minimax-transcription-v1">MiniMax 转写 · minimax-transcription-v1</option>
                <option value="openai-transcription-v1">OpenAI 转写 · openai-transcription-v1</option>
              </select>
            </Field>
            <Field label="Base URL">
              <input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPrivateGrant(false);
                }}
                required
              />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={privateGrant}
                onChange={(e) => setPrivateGrant(e.target.checked)}
              />
              允许此主机与端口访问私有网络
            </label>
            <p className="hint">授权仅绑定当前地址的精确主机与端口；修改地址会清除选择。</p>
            <div className="form-grid">
              <Field label="超时（毫秒）">
                <input
                  type="number"
                  min="1000"
                  max="300000"
                  value={timeout}
                  onChange={(e) => setTimeoutValue(Number(e.target.value))}
                />
              </Field>
              <Field label="并发任务上限">
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                />
              </Field>
            </div>
          </>
        )}
        {editing.kind === 'model' && (
          <>
            <Field label="供应方连接">
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {connections.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name} · v{c.revision}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="模型 ID">
              <input value={modelId} onChange={(e) => setModelId(e.target.value)} required />
            </Field>
            {!video&&!chat&&!speech&&!transcription&&!lipSync && <Field label="支持尺寸（逗号分隔，可留空）">
              <input
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="1024x1024,1536x1024"
              />
            </Field>}
            {video && <p className="hint">视频 · 4–15 秒 · 768P{selectedAdapter === 'minimax-h3-v2' ? ' · 最多3段固定标准声音参考，总计不超过15秒' : ' · 六种画面比例'}</p>}
            {lipSync && <p className="hint">单个可见讲话人物 · 固定 MP4＋WAV · 最长15秒 · 费用未知，需逐次确认。</p>}
            {chat || lipSync ? <p className="hint">费用未知；生成时需明确有限额度。</p>:<div className="form-grid">
              <Field label={speech ? '每千计费字符价格（留空为未知）' : transcription ? '每音频秒价格（留空为未知）' : video ? "每秒价格（留空为未知）" : "单张价格（留空为未知）"}>
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.000001"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
              <Field label="计价币种">
                <input
                  value={currency}
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </Field>
            </div>}
          </>
        )}
        {editing.kind === 'profile' && (
          <>
            <Field label="模型版本">
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setSize('');
                  setParameters({});
                }}
              >
                {models.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name} · v{m.revision}
                  </option>
                ))}
              </select>
            </Field>
            {models.find(m=>m.id===selected)&&<ParameterFields model={models.find(m=>m.id===selected)!} parameters={parameters} onChange={setParameters}/>}

          </>
        )}
        {localError && <p className="alert" role="alert">{localError}</p>}
        <RuntimeFeedback />
        <div className="dialog-actions">
          <Button onClick={event => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>取消</Button>
          <Button type="submit" tone="primary" disabled={!runtime.online || runtime.busy || runtime.pending}>
            保存
            {label}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
