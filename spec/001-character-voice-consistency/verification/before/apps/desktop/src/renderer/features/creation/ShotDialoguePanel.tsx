import { useState } from 'react';
import type { DialogueTurn, ShotDialogueRevision, CharacterVoiceRevision } from '../../../../../../packages/contracts/src/character-voice.ts';
import { Badge, Button, Empty, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { VoiceAuditionPanel } from './VoiceAuditionPanel.tsx';
import { DialogueRepairPanel } from './DialogueRepairPanel.tsx';
import { useRevisionDraft } from './useRevisionDraft.ts';
import { timelineNavigate, useOwnedDraft } from '../../state/DraftNavigationGuard.tsx';
import { DialogueBatchHistory } from './DialogueBatchHistory.tsx';
import { VoiceoverPanel } from '../audio/VoiceoverPanel.tsx';

export function ShotDialoguePanel({ projectId, shotId, shotRevision }: { projectId: string; shotId: string; shotRevision: number }) {
  const dialogue = useWorkspaceQuery('dialogue.read', { projectId, shotId }), voices = useWorkspaceQuery('voice.list', { projectId }), creation = useWorkspaceQuery('creation.read', { projectId });
  return <><QueryState loading={dialogue.isLoading || voices.isLoading} error={dialogue.error ?? voices.error} />{dialogue.data && voices.data && <DialogueEditor key={`${projectId}/${shotId}`} projectId={projectId} shotId={shotId} shotRevision={shotRevision} current={dialogue.data.current} voices={voices.data.voices} selectionRevision={creation.data?.selections.find(selection => selection.shotId === shotId)?.selectionRevision ?? 0} issues={dialogue.data.issues} />}</>;
}

function DialogueEditor({ projectId, shotId, shotRevision: latestShotRevision, current, voices, selectionRevision, issues }: { projectId: string; shotId: string; shotRevision: number; current: ShotDialogueRevision | null; voices: CharacterVoiceRevision[]; selectionRevision: number; issues: string[] }) {
  const [shotRevision] = useState(latestShotRevision);
  const runtime = useRuntime(), [saved, setSaved] = useState(current), [showAudition, setShowAudition] = useState(false), [showRepair, setShowRepair] = useState(false);
  const initialTurns = (): DialogueTurn[] => current?.turns.length ? structuredClone(current.turns) : voices[0] ? [{ turnId: crypto.randomUUID(), characterRef: voices[0].entityRef, voiceRef: { id: voices[0].id, revision: voices[0].revision }, text: '', emotion: 'calm', startTicks: 0, durationTicks: 48000, mode: 'native-reference' }] : [];
  const draft = useRevisionDraft(() => ({ id: current?.id ?? crypto.randomUUID(), expectedRevision: current?.revision ?? 0, turns: initialTurns() }));
  const { turns, expectedRevision: revision, id: dialogueId } = draft.draft;
  const setTurns = (change: (turns: DialogueTurn[]) => DialogueTurn[]) => draft.change({ turns: change(turns) });
  const locked = runtime.busy || runtime.pending || !runtime.online || draft.saving;
  const persist = () => draft.save(value => runtime.command('dialogue.save', { projectId, id: value.id, expectedRevision: value.expectedRevision, draft: { shotRef: { id: shotId, revision: shotRevision }, turns: value.turns } }), value => ({ id: value.id, expectedRevision: value.revision, turns: value.turns }), setSaved);
  useOwnedDraft({ dirty: draft.dirty || draft.saving, save: persist, discard: () => draft.reload({ id: saved?.id ?? dialogueId, expectedRevision: saved?.revision ?? 0, turns: saved?.turns ?? initialTurns() }) }, draft.draft);
  const update = (index: number, patch: Partial<DialogueTurn>) => setTurns(values => values.map((turn, i) => i === index ? { ...turn, ...patch } : turn));
  return <section className="creation-card form-stack" aria-label="结构化对白">
    <div className="toolbar"><h3>结构化对白</h3>{revision > 0 && <Badge>对白 v{revision}</Badge>}</div>
    {latestShotRevision !== shotRevision && <p role="alert">镜头已有新修订；对白草稿仍绑定镜头 v{shotRevision}，请重新打开核对。</p>}
    {issues.map(issue => <p role="alert" key={issue}>{issue} · 引用已过期，请明确更新声音修订。</p>)}
    {current && current.revision > revision && <p role="alert">对白已有新修订，当前草稿保留。<Button onClick={() => timelineNavigate(() => { draft.reload({ id: current.id, expectedRevision: current.revision, turns: structuredClone(current.turns) }); setSaved(current); })}>读取最新对白</Button></p>}
    {!voices.length && <Empty title="未绑定声音">请先在角色详情中保存声音档案，旧镜头文本不会被自动猜测为角色对白。</Empty>}
    {turns.map((turn, index) => <div className="dialogue-turn" key={turn.turnId}>
      <Field label={`角色声音 ${index + 1}`}><select value={`${turn.voiceRef.id}:${turn.voiceRef.revision}`} onChange={event => { const voice = voices.find(item => `${item.id}:${item.revision}` === event.target.value); if (voice) update(index, { characterRef: voice.entityRef, voiceRef: { id: voice.id, revision: voice.revision } }); }}>{!voices.some(voice => voice.id === turn.voiceRef.id && voice.revision === turn.voiceRef.revision) && <option value={`${turn.voiceRef.id}:${turn.voiceRef.revision}`}>已冻结 {turn.voiceRef.id} v{turn.voiceRef.revision} · 已过期</option>}{voices.map(voice => <option key={`${voice.id}:${voice.revision}`} value={`${voice.id}:${voice.revision}`}>{voice.name} · 角色 {voice.entityRef.id} · 声音 v{voice.revision}</option>)}</select></Field>
      <Field label={`情绪 ${index + 1}`}><select value={turn.emotion} onChange={event => update(index, { emotion: event.target.value as DialogueTurn['emotion'] })}><option value="calm">平静</option><option value="excited">激动</option><option value="quiet">低声</option><option value="exchange">轮流对白</option></select></Field>
      <Field label={`路线 ${index + 1}`}><select value={turn.mode} onChange={event => update(index, { mode: event.target.value as DialogueTurn['mode'] })}><option value="native-reference">原生参考声画</option><option value="dubbed-lipsync">固定配音＋口型</option><option value="voiceover">画外音</option></select></Field>
      <Field label={`起点 ${index + 1}（秒）`}><input type="number" min={0} step={0.1} value={turn.startTicks / 48000} onChange={event => update(index, { startTicks: Math.round(Number(event.target.value) * 48000) })} /></Field>
      <Field label={`时长 ${index + 1}（秒）`}><input type="number" min={0.1} step={0.1} value={turn.durationTicks / 48000} onChange={event => update(index, { durationTicks: Math.round(Number(event.target.value) * 48000) })} /></Field>
      <div className="dialogue-turn-text"><Field label={`台词 ${index + 1}`}><textarea maxLength={4000} value={turn.text} onChange={event => update(index, { text: event.target.value })} /></Field></div>
      <Button tone="quiet" disabled={turns.length <= 1} onClick={() => setTurns(values => values.filter((_, i) => i !== index))}>删除第 {index + 1} 句</Button>
    </div>)}
    <Button disabled={!voices.length || turns.length >= 16} onClick={() => { const voice = voices[0]; if (voice) setTurns(values => [...values, { turnId: crypto.randomUUID(), characterRef: voice.entityRef, voiceRef: { id: voice.id, revision: voice.revision }, text: '', emotion: 'calm', startTicks: values.at(-1) ? values.at(-1)!.startTicks + values.at(-1)!.durationTicks : 0, durationTicks: 48000, mode: values[0]?.mode ?? 'native-reference' }]); }}>添加一句</Button>
    <p className="hint">保存只冻结本地角色、台词、情绪、路线和修订，不自动试镜或付费生成。</p>
    <Button tone="primary" disabled={locked || !turns.length || turns.some(turn => !turn.text.trim())} onClick={() => void persist()}>保存结构化对白</Button>
    {draft.dirty && <p role="status">对白有未保存修改，制作使用上次已保存修订。</p>}
    {saved && <DialogueBatchHistory key={`${projectId}/${shotId}`} projectId={projectId} shotId={shotId} />}
    {saved && (saved.turns[0]?.mode==='voiceover' ? <><Button onClick={()=>timelineNavigate(()=>setShowAudition(value=>!value))}>独立旁白配音</Button>{showAudition&&<VoiceoverPanel key={`${projectId}/${saved.id}/${saved.revision}`} projectId={projectId} dialogue={saved}/>}</> : <><Button onClick={() => timelineNavigate(() => setShowAudition(value => !value))}>试镜与审核</Button>{showAudition && <VoiceAuditionPanel key={`${projectId}/${saved.id}/${saved.revision}`} projectId={projectId} dialogue={saved} />}<Button onClick={() => timelineNavigate(() => setShowRepair(value => !value))}>配音与口型</Button>{showRepair && <DialogueRepairPanel key={`${projectId}/${saved.id}/${saved.revision}`} projectId={projectId} dialogue={saved} selectionRevision={selectionRevision} />}</>)}
  </section>;
}
