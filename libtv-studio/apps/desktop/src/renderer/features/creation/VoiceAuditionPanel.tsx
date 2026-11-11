import { useEffect, useRef, useState } from 'react';
import type { DialogueEmotion, ShotDialogueRevision } from '../../../../../../packages/contracts/src/character-voice.ts';
import type { DialogueProductionPlan } from '../../../../../../packages/contracts/src/dialogue-production.ts';
import { Badge, Button, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { profileKey, profileRef } from './ShotProductionPanel.tsx';
import { useOwnedDraft } from '../../state/DraftNavigationGuard.tsx';

const emotionNames: Record<string, string> = { calm: '平静', excited: '激动', quiet: '低声', exchange: '轮流对白' };

function amountMicros(amount: string) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount);
  if (!match) return NaN;
  const value = Number(match[1]) * 1000000 + Number((match[2] ?? '').padEnd(6, '0'));
  return Number.isSafeInteger(value) && value > 0 && value <= 1000000000000 ? value : NaN;
}

export function VoiceAuditionPanel({ projectId, dialogue }: { projectId: string; dialogue: ShotDialogueRevision }) {
  const runtime = useRuntime(), profiles = useWorkspaceQuery('profile.list', {}), models = useWorkspaceQuery('model.list', {});
  const available = (profiles.data?.profiles ?? []).filter(profile => models.data?.models.some(model => model.id === profile.modelRef.id && model.revision === profile.modelRef.revision && model.capabilities.taskTypes.some(task => task === 'text_to_video') && model.capabilities.inputKinds.some(input => input === 'audio')));
  const [profileId, setProfileId] = useState(''), [emotion, setEmotion] = useState<DialogueEmotion>('calm'), [plan, setPlan] = useState<DialogueProductionPlan | null>(null), [productionId, setProductionId] = useState(''), [busy, setBusy] = useState(false);
  const profile = profileId ? available.find(item => profileKey(item) === profileId) : available[0], voiceRef = dialogue.turns[0]?.voiceRef, route = dialogue.turns[0]?.mode;
  const [exception, setException] = useState(''), [selected, setSelected] = useState([{ id: dialogue.id, revision: dialogue.revision }]);
  const creation = useWorkspaceQuery('creation.read', { projectId });
  const alive = useRef(true);
  const preparation = useRef(0), intent = JSON.stringify([projectId, dialogue.id, dialogue.revision, profile, emotion, selected, exception]), currentIntent = useRef(intent);
  currentIntent.current = intent;
  useEffect(() => { alive.current = true; return () => { alive.current = false; preparation.current++; }; }, []);
  useOwnedDraft({ dirty: !!plan || busy || !!exception.trim(), save: async () => false, discard: () => { preparation.current++; setBusy(false); setPlan(null); setException(''); } }, plan ?? exception);
  async function prepare(purpose: 'audition' | 'production') {
    if (!profile) return;
    const token = ++preparation.current, captured = currentIntent.current;
    setBusy(true);
    try {
      const value = await runtime.command('dialogue.prepareProduction', { projectId, dialogueRefs: purpose === 'audition' ? [{ id: dialogue.id, revision: dialogue.revision }] : selected, profileRef: profileRef(profile), purpose, ...(purpose === 'audition' ? { auditionCase: emotion } : exception.trim() ? { exception: { reason: exception.trim() } } : {}), executionOwner: 'desktop-user', runId: crypto.randomUUID() });
      if (value && alive.current && token === preparation.current && captured === currentIntent.current) setPlan(value);
    } finally { if (alive.current && token === preparation.current) setBusy(false); }
  }
  const status = useWorkspaceQuery('voice.auditionStatus', { projectId, voiceRef: voiceRef!, profileRef: profile ? profileRef(profile) : { libraryId: '', id: '', revision: 0 }, route: route! }, Boolean(profile && voiceRef && route));
  const voiceRefs = [...new Map(dialogue.turns.map(turn => [`${turn.voiceRef.id}:${turn.voiceRef.revision}`, turn.voiceRef])).values()];
  const [evidence, setEvidence] = useState<Record<string, boolean>>({});
  const evidenceKey = (ref: { id: string; revision: number }) => `${profile ? profileKey(profile) : ''}/${ref.id}:${ref.revision}`;
  const allReady = voiceRefs.every(ref => evidence[evidenceKey(ref)] === true);
  const production = useWorkspaceQuery('dialogue.production', { projectId, planId: productionId }, Boolean(productionId));
  const locked = runtime.busy || runtime.pending || !runtime.online || busy;
  return <section className="creation-card form-stack" aria-label="声音试镜">
    <div className="toolbar"><h3>三情绪与组合试镜</h3>{status.data && <Badge warning={!allReady}>{allReady ? '角色三情绪审核证据齐全' : '待试听 / 待试镜'}</Badge>}</div>
    <QueryState loading={status.isLoading} error={status.error} />
    {status.data && !status.data.allowed && <p>待试镜：{status.data.missing.map(value => emotionNames[value]).join('、')}</p>}
    {profile && route && voiceRefs.map(ref => <VoiceEvidence key={evidenceKey(ref)} projectId={projectId} voiceRef={ref} profile={profileRef(profile)} route={route} onStatus={allowed => setEvidence(values => values[evidenceKey(ref)] === allowed ? values : { ...values, [evidenceKey(ref)]: allowed })} />)}
    {new Set(dialogue.turns.map(turn => turn.characterRef.id)).size > 1 && <p role="status">当前角色组合需要轮流对白试镜；正式计划将再次检查该组合的人工审核，单人三情绪不能替代。</p>}
    <div className="form-grid"><Field label="试镜预设"><select value={profile ? profileKey(profile) : ''} onChange={event => setProfileId(event.target.value)}>{available.map(item => <option key={profileKey(item)} value={profileKey(item)}>{item.name} · v{item.revision}</option>)}</select></Field><Field label="试镜情绪"><select value={emotion} onChange={event => setEmotion(event.target.value as DialogueEmotion)}>{Object.entries(emotionNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
    <Button disabled={locked || !profile || !voiceRef} onClick={() => void prepare('audition')}>准备{emotionNames[emotion]}试镜</Button>
    {(!available.length || !profile) && <p role="alert">能力不支持或预设已过期：需要支持固定声音参考的视频模型。请在受保护模型设置中配置并重新选择。</p>}
    <p className="hint">平静、激动、低声各需人工审核；新角色组合需轮流对白试镜。协议成功不会自动产生质量通过。</p>
    <details><summary>正式批次镜头（最多16镜头）</summary>{creation.data?.shots.map(shot => <BatchChoice key={shot.id} projectId={projectId} shotId={shot.id} title={shot.title} selected={selected} onChange={setSelected} />)}</details>
    <Field label="仅本批次试镜例外原因（可选）"><textarea maxLength={2000} value={exception} onChange={event => setException(event.target.value)} /></Field>
    <Button disabled={locked || !profile || !selected.length || selected.length > 16 || !allReady && !exception.trim()} onClick={() => void prepare('production')}>准备正式对白制作</Button>
    {plan && <DialogueApproval plan={plan} onClose={() => { preparation.current++; setBusy(false); setPlan(null); }} onApproved={setProductionId} />}
    {production.data && <section className="creation-reference"><p>批次状态：{production.data.state}</p>{production.data.tasks.map(item => <p key={item.dialogueId}>{item.dialogueId} · {item.task?.taskId ?? '未入队'} {item.diagnostic ?? ''}</p>)}{production.data.state !== 'stopped' && <Button tone="danger" disabled={locked} onClick={() => void runtime.command('dialogue.stopProduction', { projectId, planId: production.data!.plan.planId, executionOwner: production.data!.plan.executionOwner })}>停止本地后续处理</Button>}<p className="hint">云端任务可能继续计费；迟到结果只进入历史，不自动采用。</p></section>}
  </section>;
}

function VoiceEvidence({ projectId, voiceRef, profile, route, onStatus }: { projectId: string; voiceRef: { id: string; revision: number }; profile: import('../../../../../../packages/contracts/src/models.ts').RevisionRef; route: import('../../../../../../packages/contracts/src/character-voice.ts').DialogueRoute; onStatus(allowed: boolean): void }) {
  const status = useWorkspaceQuery('voice.auditionStatus', { projectId, voiceRef, profileRef: profile, route });
  useEffect(() => { onStatus(status.data?.allowed === true); }, [status.data?.allowed, onStatus]);
  return <p>声音 {voiceRef.id} v{voiceRef.revision} · {status.error ? '证据不可用 / 已失效' : status.data?.allowed ? '三情绪已有人工审核' : `待试镜：${status.data?.missing.map(value => emotionNames[value]).join('、') ?? '证据未知'}`}</p>;
}

function BatchChoice({ projectId, shotId, title, selected, onChange }: { projectId: string; shotId: string; title: string; selected: { id: string; revision: number }[]; onChange(value: { id: string; revision: number }[]): void }) {
  const query = useWorkspaceQuery('dialogue.read', { projectId, shotId }), current = query.data?.current;
  if (!current) return <p>{title} · 未保存结构化对白</p>;
  const captured = selected.find(ref => ref.id === current.id);
  return <label className="check"><input type="checkbox" checked={!!captured} disabled={!captured && selected.length >= 16} onChange={event => onChange(event.target.checked ? [...selected, { id: current.id, revision: current.revision }] : selected.filter(ref => ref.id !== current.id))} />{title} · 对白 v{captured?.revision ?? current.revision}{captured && captured.revision !== current.revision ? ' · 已过期，请取消后重新勾选' : ''}</label>;
}

export function DialogueApproval(props: { plan: DialogueProductionPlan; onClose(): void; onApproved(id: string): void }) {
  return <DialogueApprovalEditor key={`${props.plan.libraryId}/${props.plan.projectId}/${props.plan.planId}/${props.plan.approvedHash}`} {...props} />;
}

function DialogueApprovalEditor({ plan, onClose, onApproved }: { plan: DialogueProductionPlan; onClose(): void; onApproved(id: string): void }) {
  const runtime = useRuntime(), profiles = useWorkspaceQuery('profile.list', {}), [allowance, setAllowance] = useState(String((plan.estimateMicros ?? 1000000) / 1000000)), [budget, setBudget] = useState(String((plan.estimateMicros ?? 1000000) / 100000)), [busy, setBusy] = useState(false), [acknowledge, setAcknowledge] = useState(false), [currency, setCurrency] = useState(plan.currency ?? 'CNY'), [now, setNow] = useState(Date.now());
  const allowanceMicros = amountMicros(allowance), budgetLimitMicros = amountMicros(budget);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; const timer = setInterval(() => setNow(Date.now()), 1000); return () => { alive.current = false; clearInterval(timer); }; }, []);
  const stale = !profiles.data?.profiles.some(profile => profile.id === plan.profileRef.id && profile.revision === plan.profileRef.revision), expired = now >= plan.expiresAt;
  return <section className="approval-summary form-stack"><h3>{plan.purpose === 'audition' ? '试镜批次确认' : '正式对白批次确认'}</h3><p>本批 {plan.items.length} 镜头 · 总估价 {plan.currency ?? '未知'} {plan.estimateMicros === null ? '未知' : (plan.estimateMicros / 1000000).toFixed(2)} · 尚未批准</p><p>预设 {plan.profileRef.id} v{plan.profileRef.revision} · {plan.purpose === 'audition' ? `情绪 ${emotionNames[plan.auditionCase ?? 'calm']}` : '正式制作'} · 路线 {plan.route}</p>
    <p>总计 {plan.items.reduce((count, item) => count + item.dialogue.turns.length, 0)} 句 · 明确批准额度覆盖本批全部任务</p>
    {plan.items.map((item, index) => <article className="creation-reference" key={item.dialogue.id ?? index}><p>镜头 {item.dialogue.shotRef?.id} v{item.dialogue.shotRef?.revision} · 对白 {item.dialogue.id} v{item.dialogue.revision} · {item.dialogue.turns.length} 句</p>{item.dialogue.turns.map((turn, i) => <p key={turn.turnId ?? i}>角色 {turn.characterRef?.id} v{turn.characterRef?.revision} · 声音 {turn.voiceRef.id} v{turn.voiceRef.revision} · {emotionNames[turn.emotion]} · {turn.mode}<br />{turn.text}</p>)}<p>模型 {item.prepared?.config.model.name} · v{item.prepared?.config.model.revision}</p>{(item.prepared?.referenceAudio ?? []).map(audio => <p key={audio.hash}>固定声音 {audio.ref.kind === 'artifact' ? audio.ref.artifactId : `${audio.ref.assetId} v${audio.ref.version}`} · hash {audio.hash} · {audio.byteLength}字节 · {audio.durationTicks / 48000}秒</p>)}{(item.prepared?.referenceImages ?? []).map(image => <p key={image.hash}>固定图像 {image.ref.kind === 'artifact' ? image.ref.artifactId : `${image.ref.assetId} v${image.ref.version}`} · hash {image.hash}</p>)}{item.prepared?.lipSyncVideo && <p>原视频 hash {item.prepared.lipSyncVideo.hash} · 配音 hash {item.prepared.lipSyncAudio?.hash}</p>}</article>)}
    {plan.exception && <p role="alert">仅本批次例外：{plan.exception.reason}。不表示音色或口音已通过。</p>}{(stale || expired) && <p role="alert">{expired ? '确认计划已过期，请取消后重新准备。' : '配置已失效，请取消并重新准备。'}</p>}
    <div className="form-grid"><Field label={`本批风险额度（${currency}）`}><input type="text" inputMode="decimal" placeholder="例如 1.00" value={allowance} onChange={event => setAllowance(event.target.value)} /></Field><Field label={`项目预算上限（${currency}）`}><input type="text" inputMode="decimal" placeholder="例如 5.00" value={budget} onChange={event => setBudget(event.target.value)} /></Field></div>
    {plan.currency === null && <Field label="批准币种"><input maxLength={3} value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} /></Field>}
    <p>本次批准总额度 {currency} {Number.isSafeInteger(allowanceMicros) ? allowance : '待填写'} · 项目上限 {Number.isSafeInteger(budgetLimitMicros) ? budget : '待填写'}</p><p className="hint">金额最多保留六位小数。本地额度控制提交，不限制供应商实际账单。</p>
    <label className="check"><input type="checkbox" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)} />我理解未知费用及云端不能取消的计费风险</label><div className="dialog-actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button tone="primary" disabled={busy || runtime.busy || runtime.pending || !runtime.online || expired || stale || !acknowledge || !Number.isSafeInteger(allowanceMicros) || !Number.isSafeInteger(budgetLimitMicros) || budgetLimitMicros < allowanceMicros || !/^[A-Z]{3}$/.test(currency)} onClick={async () => { setBusy(true); try { const value = await runtime.command('dialogue.approveProduction', { planId: plan.planId, approvedHash: plan.approvedHash, executionOwner: plan.executionOwner, runId: plan.runId, approval: { currency, allowanceMicros, budgetLimitMicros, acknowledgeUnknown: acknowledge } }); if (value && alive.current) { onApproved(plan.planId); onClose(); } } finally { if (alive.current) setBusy(false); } }}>{plan.purpose === 'audition' ? '批准此试镜批次' : '批准此正式批次'}</Button></div></section>;
}
