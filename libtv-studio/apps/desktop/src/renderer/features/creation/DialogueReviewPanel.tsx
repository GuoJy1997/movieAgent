import { useRef, useState } from 'react';
import type { DialogueCheck, DialogueTake, DialogueReview, DialogueReviewContext } from '../../../../../../packages/contracts/src/dialogue-production.ts';
import { Badge, Button, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { MediaPreview } from '../assets/MediaPreview.tsx';
import { useRevisionDraft } from './useRevisionDraft.ts';
import { useOwnedDraft } from '../../state/DraftNavigationGuard.tsx';

export function DialogueReviewPanel({ projectId, shotId, shotRevision, dialogueRef, selectionRevision }: { projectId: string; shotId: string; shotRevision: number; dialogueRef: { id: string; revision: number }; selectionRevision: number }) {
  const snapshot = useWorkspaceQuery('dialogue.takes', { projectId, shotId });
  return <section className="creation-card form-stack" aria-label="对白人工审核"><h3>逐镜头质量审核</h3><QueryState loading={snapshot.isLoading} error={snapshot.error} />{snapshot.data?.takes.map(take => <TakeReview key={`${projectId}/${take.id}`} take={take} reviews={snapshot.data?.reviews ?? []} selectionRevision={selectionRevision} shotRevision={shotRevision} dialogueRef={dialogueRef} />)}</section>;
}

function TakeReview({ take, reviews, selectionRevision, shotRevision, dialogueRef }: { take: DialogueTake; reviews: import('../../../../../../packages/contracts/src/dialogue-production.ts').DialogueReview[]; selectionRevision: number; shotRevision: number; dialogueRef: { id: string; revision: number } }) {
  const query = useWorkspaceQuery('dialogue.reviewContext', { projectId: take.projectId, takeId: take.id });
  const previous = useRef<string | null>(null), invalidated = useRef(false);
  const context = query.data;
  const foreign = context && (context.projectId !== take.projectId || context.takeId !== take.id || context.libraryId !== take.video.libraryId);
  if (query.error || !context || foreign) {
    if (previous.current) invalidated.current = true;
    return <article className="creation-reference form-stack"><p>take {take.id} · 原对白 v{take.dialogueRef.revision} · 原声音 {take.voiceRef.id} v{take.voiceRef.revision}</p>{(take.dialogueRef.id !== dialogueRef.id || take.dialogueRef.revision !== dialogueRef.revision) && <p role="alert">结果基于旧对白修订，只能查看历史，不能采用到当前对白。</p>}<p role="alert">当前审核依据不可用：{query.error?.message ?? (foreign ? '依据身份与当前项目或 take 不匹配，请重新读取。' : '正在读取当前镜头、声音及配置，尚不能审核或采用。')}</p><MediaPreview media={take.video} original />{take.audio && <MediaPreview media={take.audio} original />}</article>;
  }
  if (previous.current && previous.current !== context.contextHash) invalidated.current = true;
  previous.current = context.contextHash;
  return <ContextReview key={`${take.projectId}/${take.id}/${context.contextHash}`} take={take} reviews={reviews} selectionRevision={selectionRevision} shotRevision={shotRevision} dialogueRef={dialogueRef} context={context} needsReview={context.stale || invalidated.current} />;
}

function ContextReview({ take, reviews, selectionRevision, shotRevision, dialogueRef, context, needsReview }: { take:DialogueTake;reviews:DialogueReview[];selectionRevision:number;shotRevision:number;dialogueRef:{id:string;revision:number};context:DialogueReviewContext;needsReview:boolean }) {
  const runtime = useRuntime(), latest = reviews.filter(review => review.takeId === take.id).sort((a, b) => b.revision - a.revision)[0];
  const [saved, setSaved] = useState(needsReview ? undefined : latest), [busy, setBusy] = useState(false);
  const make = (review?: DialogueReview, restoreChecks = true) => ({ expectedRevision: review?.revision ?? take.reviewRevision, checks: restoreChecks && review ? review.checks as Record<string, DialogueCheck | ''> : { timbre: '', accent: '', dialogue: '', lipsync: take.route === 'voiceover' ? 'not-applicable' : '' } as Record<string, DialogueCheck | ''>, notes: review?.notes ?? '' });
  const draft = useRevisionDraft(() => make(latest, !needsReview)), { checks, notes } = draft.draft;
  const complete = Object.values(checks).every(Boolean), current = take.dialogueRef.id === dialogueRef.id && take.dialogueRef.revision === dialogueRef.revision;
  const superseded = !!latest && latest.revision > draft.draft.expectedRevision;
  const persist = () => complete && current && !superseded ? draft.save(value => runtime.command('dialogue.reviewTake', { projectId: take.projectId, takeId: take.id, expectedReviewRevision: value.expectedRevision, checks: value.checks as DialogueReview['checks'], notes: value.notes, reviewContextHash: context.contextHash }), make, setSaved) : Promise.resolve(false);
  useOwnedDraft({ dirty: draft.dirty || draft.saving || busy, save: persist, discard: () => draft.reload(make(saved, !!saved)) }, draft.draft);
  const labels: Record<string, string> = { timbre: '音色', accent: '口音', dialogue: '台词', lipsync: '口型' };
  return <article className="creation-reference form-stack"><Badge warning={!saved}> {saved ? `审核 v${saved.revision}` : '待人工审核'} </Badge><p>take {take.id} · 对白 v{take.dialogueRef.revision} · 原镜头 {take.shotId} v{shotRevision} · 原声音 {take.voiceRef.id} v{take.voiceRef.revision} · {take.route} · 视频 hash {take.sourceVideoHash} · 音频 hash {take.audioHash ?? '原生视频音轨'}</p>{!current && <p role="alert">结果基于旧对白修订，只能查看历史，不能采用到当前对白。</p>}
    <section aria-label="当前审核依据"><h4>本次人工复核的当前依据</h4><p>当前镜头 {context.shotRef.id} v{context.shotRef.revision}</p>{context.voiceRefs.map(ref => <p key={ref.id}>当前声音 {ref.id} v{ref.revision}</p>)}{([['预设',context.profileRef],['模型',context.modelRef],['连接',context.connectionRef]] as const).map(([label,ref]) => <p key={label}>当前{label} {ref ? `${ref.id} v${ref.revision}` : '无（手工结果）'}</p>)}<p className="hint">依据 hash {context.contextHash}</p>{needsReview && <p role="alert">审核依据已变化，旧选择不能作为当前质量通过；请重新逐项判断。保存期间依据变化会清除旧选择并忽略迟到回执。</p>}</section>
    <section aria-label="待审核结果"><h4>修正后 / 生成结果 · 待人工判断</h4><MediaPreview media={take.video} original />{take.audio && <MediaPreview media={take.audio} original />}</section>
    <div className="form-grid">{Object.entries(labels).map(([key, label]) => <Field label={label} key={key}><select value={checks[key]} onChange={event => draft.change({ checks: { ...checks, [key]: event.target.value as DialogueCheck } })}><option value="">待人工判断</option><option value="pass">通过</option><option value="needs-fix">需修正</option>{key === 'lipsync' && take.route === 'voiceover' && <option value="not-applicable">不适用</option>}</select></Field>)}</div><Field label="审核备注"><textarea maxLength={8000} value={notes} onChange={event => draft.change({ notes: event.target.value })} /></Field>
    {superseded && <p role="alert">审核已有新修订，当前选择不自动提交。<Button onClick={() => { draft.reload(make(latest, false)); setSaved(undefined); }}>读取最新审核基准</Button></p>}
    <Button disabled={!current || !complete || superseded || draft.saving || busy || runtime.busy || runtime.pending || !runtime.online} onClick={() => void persist()}>保存人工审核</Button>
    {saved && <Button disabled={!current || superseded || draft.dirty || draft.saving || busy || runtime.busy || runtime.pending || !runtime.online || Object.values(saved.checks).some(check => check === 'needs-fix')} onClick={async () => { setBusy(true); try { await runtime.command('dialogue.selectTake', { projectId: take.projectId, shotId: take.shotId, expectedShotRevision: context.shotRef.revision, expectedSelectionRevision: selectionRevision, dialogueRef, takeId: take.id }); } finally { setBusy(false); } }}>采用此 take</Button>}<p className="hint">机器任务完成不等于质量通过；采用仍复核当前审核、媒体 hash 和镜头修订。</p></article>;
}
