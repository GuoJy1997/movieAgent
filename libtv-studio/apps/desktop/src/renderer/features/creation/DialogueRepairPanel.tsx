import {DialogueAssemblyPanel} from './DialogueAssemblyPanel.tsx';
import {VoiceoverPanel} from '../audio/VoiceoverPanel.tsx';
import { useEffect, useRef, useState } from 'react';
import type { ShotDialogueRevision } from '../../../../../../packages/contracts/src/character-voice.ts';
import type { MediaReference } from '../../../../../../packages/contracts/src/assets.ts';
import type { ConfirmedDialogueAudio, DialogueProductionPlan } from '../../../../../../packages/contracts/src/dialogue-production.ts';
import { Button, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { DialogueReviewPanel } from './DialogueReviewPanel.tsx';
import { DialogueApproval } from './VoiceAuditionPanel.tsx';
import { profileKey, profileRef } from './ShotProductionPanel.tsx';
import { MediaPreview } from '../assets/MediaPreview.tsx';
import { useOwnedDraft } from '../../state/DraftNavigationGuard.tsx';

const mediaKey = (ref: MediaReference) => ref.kind === 'artifact' ? `artifact:${ref.artifactId}` : `${ref.assetId}:${ref.version}`;
const fixedKey = (ref:MediaReference | null | undefined) => ref ? `${ref.libraryId}/${mediaKey(ref)}` : '';

export function DialogueRepairPanel({ projectId, dialogue, selectionRevision }: { projectId: string; dialogue: ShotDialogueRevision; selectionRevision: number }) {
  const runtime = useRuntime(), assets = useWorkspaceQuery('asset.search', { state: 'active', latestOnly: true }), profiles = useWorkspaceQuery('profile.list', {}), models = useWorkspaceQuery('model.list', {}), tasks = useWorkspaceQuery('task.list', {}), speech = useWorkspaceQuery('audio.read', { projectId });
  const [audio, setAudio] = useState<MediaReference | null>(null), [video, setVideo] = useState<MediaReference | null>(null), [repaired, setRepaired] = useState<MediaReference | null>(null), [sourceKind, setSourceKind] = useState<'imported-audio' | 'audio-take'|'audio-assembly'>('imported-audio'), [takeId, setTakeId] = useState(''), [profileId, setProfileId] = useState('');
  const [confirmed, setConfirmed] = useState<ConfirmedDialogueAudio | null>(null), [alignment, setAlignment] = useState<{jobId:string;planId:string;inputKey:string;video:MediaReference} | null>(null), [startTicks, setStartTicks] = useState(dialogue.turns[0]?.startTicks ?? 0), [plan, setPlan] = useState<DialogueProductionPlan | null>(null), [productionId, setProductionId] = useState(''), [busy, setBusy] = useState(false), [modified, setModified] = useState(false);
  const alive = useRef(true), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const valid = (token: number) => alive.current && token === generation.current;
  const job = useWorkspaceQuery('render.read', { projectId, jobId:alignment?.jobId ?? '' }, Boolean(alignment)), production = useWorkspaceQuery('dialogue.production', { projectId, planId: productionId }, Boolean(productionId));
  const locked = runtime.busy || runtime.pending || !runtime.online || busy;
  const mediaOptions = (assets.data?.assets ?? []).filter(asset => asset.mime.startsWith('audio/') || asset.mime === 'video/mp4');
  const syncProfiles = (profiles.data?.profiles ?? []).filter(profile => models.data?.models.some(model => model.id === profile.modelRef.id && model.revision === profile.modelRef.revision && model.capabilities.taskTypes.some(task => task === 'lip_sync')));
  const profile = profileId ? syncProfiles.find(value => profileKey(value) === profileId) : syncProfiles[0];
  const audioRef = audio ?? mediaOptions.find(asset => asset.mime.startsWith('audio/'))?.ref ?? null, videoRef = video ?? mediaOptions.find(asset => asset.mime === 'video/mp4')?.ref ?? null;
  const take = takeId ? speech.data?.takes.find(value => value.id === takeId) : speech.data?.takes[0];
  const chosenAudio = sourceKind === 'audio-assembly'?confirmed?.source.ref:sourceKind === 'audio-take' ? take?.output : audioRef;
  const [coverageConfirmed,setCoverageConfirmed]=useState(false);
  const dialogueRef = { id: dialogue.id, revision: dialogue.revision };
  const inputKey = JSON.stringify([projectId, dialogueRef.id, dialogueRef.revision, fixedKey(chosenAudio), fixedKey(confirmed?.source.ref), fixedKey(videoRef), startTicks]), currentInputs = useRef(inputKey);
  currentInputs.current = inputKey;
  useEffect(() => { setAlignment(value => value && value.inputKey !== inputKey ? null : value); }, [inputKey]);
  const confirmationMatches = !!confirmed && !!chosenAudio && fixedKey(confirmed.source.ref) === fixedKey(chosenAudio);
  const alignedJob = alignment && alignment.inputKey === inputKey && !job.error && job.data?.state === 'SUCCEEDED' && job.data.kind === 'derived' && job.data.jobId === alignment.jobId && job.data.planId === alignment.planId && job.data.projectId === projectId && job.data.libraryId === dialogue.libraryId && job.data.outputRef?.libraryId === dialogue.libraryId ? job.data : null;
  function change() { generation.current++; setModified(true); setPlan(null); }
  function resetAudio() { change(); setConfirmed(null); setAlignment(null); }
  useOwnedDraft({ dirty: modified || busy || !!plan, save: async () => false, discard: () => { generation.current++; setModified(false); setPlan(null); setConfirmed(null); setAlignment(null); } }, `${generation.current}/${plan?.planId ?? ''}`);
  return <section className="creation-card form-stack" aria-label="固定配音与口型修正">
    <h3>固定配音与口型修正</h3><QueryState loading={assets.isLoading} error={assets.error} />
    <p>固定对白 {dialogue.id} v{dialogue.revision} · 镜头 {dialogue.shotRef.id} v{dialogue.shotRef.revision}</p>
    <details><summary>生成并审核固定台词配音</summary><VoiceoverPanel projectId={projectId} dialogue={dialogue} showAssembly={false}/></details>
    <DialogueAssemblyPanel projectId={projectId} dialogue={dialogue} onChange={()=>{if(sourceKind==='audio-assembly')resetAudio();}} onConfirmed={value=>{change();setSourceKind('audio-assembly');setConfirmed(value);setStartTicks(0);setAlignment(null);setModified(false);}}/>
    <Field label="配音来源"><select value={sourceKind} onChange={event => { resetAudio(); setSourceKind(event.target.value as typeof sourceKind); }}><option value="imported-audio">导入录音</option><option value="audio-take" disabled={dialogue.turns.length!==1}>已生成的单句 TTS take</option><option value="audio-assembly">已合成整段配音</option></select></Field>
    {sourceKind === 'imported-audio' ? <Field label="固定配音"><select value={audioRef ? mediaKey(audioRef) : ''} onChange={event => { resetAudio(); setAudio(mediaOptions.find(asset => mediaKey(asset.ref) === event.target.value)?.ref ?? null); }}><option value="">选择固定音频</option>{mediaOptions.filter(asset => asset.mime.startsWith('audio/')).map(asset => <option key={mediaKey(asset.ref)} value={mediaKey(asset.ref)}>{asset.name} · {asset.ref.assetId} · v{asset.ref.version}</option>)}</select></Field> : sourceKind==='audio-take'? <Field label="生成配音 take"><select value={take?.id ?? ''} onChange={event => { resetAudio(); setTakeId(event.target.value); }}>{speech.data?.takes.map(value => <option key={value.id} value={value.id}>take {value.id} · 文案 {value.lineId} v{value.lineRevision} · 原任务 {value.task.taskId}</option>)}</select></Field>:null}
    {sourceKind==='imported-audio'&&dialogue.turns.length>1&&<Field label="确认导入音频覆盖全部角色和台词"><input type="checkbox" checked={coverageConfirmed} onChange={e=>{resetAudio();setCoverageConfirmed(e.target.checked);}}/></Field>}
    {chosenAudio && <MediaPreview media={chosenAudio} original />}
    <Button disabled={locked || !chosenAudio || sourceKind==='audio-assembly'||sourceKind==='imported-audio'&&dialogue.turns.length>1&&!coverageConfirmed} onClick={async () => { if (!chosenAudio) return; const token = ++generation.current; setAlignment(null); setBusy(true); try { const value = await runtime.command('dialogue.confirmAudio', { projectId, dialogueRef, source: sourceKind === 'audio-take' ? { kind: 'audio-take', takeId: take!.id } : { kind: 'imported-audio', media: chosenAudio,coverageConfirmed }, expectedRevision: dialogue.revision }); if (value && valid(token)) { setConfirmed(value); setModified(false); } } finally { if (alive.current) setBusy(false); } }}>确认固定配音</Button>
    {confirmed && <p>已确认 {confirmed.source.kind} · {mediaKey(confirmed.source.ref)} · hash {confirmed.source.hash}</p>}
    <Field label="源视频"><select value={videoRef ? mediaKey(videoRef) : ''} onChange={event => { change(); setVideo(mediaOptions.find(asset => mediaKey(asset.ref) === event.target.value)?.ref ?? null); setAlignment(null); }}><option value="">选择讲话视频</option>{mediaOptions.filter(asset => asset.mime === 'video/mp4').map(asset => <option key={mediaKey(asset.ref)} value={mediaKey(asset.ref)}>{asset.name} · {asset.ref.assetId} · v{asset.ref.version}</option>)}</select></Field>
    {videoRef && <section aria-label="修正前原视频"><h4>修正前 · 原视频</h4><MediaPreview media={videoRef} original /></section>}
    {confirmed && <><Field label="配音入点（秒）"><input type="number" disabled={confirmed.source.kind==='audio-assembly'} min={0} step={0.1} value={startTicks / 48000} onChange={event => { change(); setStartTicks(Math.round(Number(event.target.value) * 48000)); setAlignment(null); }} /></Field><Button disabled={locked || !confirmationMatches || !videoRef || !Number.isSafeInteger(startTicks) || startTicks < 0} onClick={async () => {
      if (!videoRef || !confirmationMatches) return; const token = ++generation.current, capturedVideo = videoRef, capturedInput = inputKey; setAlignment(null); setBusy(true);
      try { const value = await runtime.command('dialogue.prepareAlignment', { projectId, dialogueRef, sourceVideo: capturedVideo, confirmedAudioRef: confirmed.source.ref, startTicks, executionOwner: 'desktop-user', runId: crypto.randomUUID() }); if (!value || !valid(token) || currentInputs.current !== capturedInput) return;
        const queued = await runtime.command('media.enqueueDerived', { planId: value.planId, planHash: value.planHash, executionOwner: value.executionOwner, runId: value.runId, diskBudgetBytes: value.requiredFreeBytes }); if (queued && valid(token) && currentInputs.current === capturedInput) { setAlignment({jobId:queued.jobId,planId:value.planId,inputKey:capturedInput,video:capturedVideo}); setModified(false); }
      } finally { if (alive.current) setBusy(false); }
    }}>本地补静音并对齐</Button></>}
    {job.data && <p>对齐作业：{job.data.state} {job.data.errorCode ?? ''}</p>}
    {alignedJob?.outputRef && alignment && <><MediaPreview media={alignedJob.outputRef} original /><Field label="口型预设"><select value={profile ? profileKey(profile) : ''} onChange={event => { change(); setProfileId(event.target.value); }}>{syncProfiles.map(item => <option key={profileKey(item)} value={profileKey(item)}>{item.name} · v{item.revision}</option>)}</select></Field>{!profile && <p role="alert">能力不支持或口型预设已过期。请选择支持 lip_sync 的配置。</p>}<Button disabled={locked || !profile} onClick={async () => {
      if (!profile) return; const token = ++generation.current, audioRef = alignedJob.outputRef!, videoRef = alignment.video; setBusy(true);
      try { const aligned = await runtime.command('media.inspect', { projectId, reference: audioRef }); if (!aligned || !valid(token)) return;
        const source = await runtime.command('media.inspect', { projectId, reference: videoRef }); if (!source || !valid(token)) return;
        const value = await runtime.command('dialogue.prepareRepair', { projectId, dialogueRef, alignedInput: { videoRef, audioRef, durationTicks: aligned.probe?.durationTicks ?? 0, videoHash: source.hash, audioHash: aligned.hash }, profileRef: profileRef(profile), executionOwner: 'desktop-user', runId: crypto.randomUUID() }); if (value && valid(token)) { setPlan(value); setModified(false); }
      } finally { if (alive.current) setBusy(false); }
    }}>准备口型修正</Button></>}
    {plan && <DialogueApproval key={plan.planId} plan={plan} onClose={() => setPlan(null)} onApproved={setProductionId} />}
    {production.data && <><p>口型批次：{production.data.state}。运行中服务不支持取消时，本地停止不保证停费。</p><Button disabled={locked || production.data.state === 'stopped'} onClick={() => void runtime.command('dialogue.stopProduction', { projectId, planId: production.data!.plan.planId, executionOwner: production.data!.plan.executionOwner })}>停止口型后续处理</Button></>}
    {(tasks.data?.tasks ?? []).filter(task => production.data?.tasks.some(item => item.task?.taskId === task.taskId) && ['SUBMISSION_UNKNOWN', 'RECONCILE_REQUIRED'].includes(task.state)).map(task => <div key={task.taskId}><p>未知提交：禁止换键重发，核对仅限已验证原提交且不超过7天。</p><Button disabled={locked} onClick={() => void runtime.command('dialogue.reconcileSubmission', { projectId, taskId: task.taskId, executionOwner: 'desktop-user' })}>核对原提交 {task.taskId}</Button></div>)}
    <Field label="外部修正版（可选）"><select value={repaired ? mediaKey(repaired) : ''} onChange={event => { change(); setRepaired(mediaOptions.find(asset => mediaKey(asset.ref) === event.target.value)?.ref ?? null); }}><option value="">选择已导入修正视频</option>{mediaOptions.filter(asset => asset.mime === 'video/mp4').map(asset => <option key={mediaKey(asset.ref)} value={mediaKey(asset.ref)}>{asset.name} · {asset.ref.assetId} · v{asset.ref.version}</option>)}</select></Field>
    {repaired && <section aria-label="修正后视频"><h4>修正后 · 待人工审核</h4><MediaPreview media={repaired} original /></section>}
    {confirmed && repaired && videoRef && <><Button disabled={locked || !alignedJob?.outputRef || !alignment} onClick={async () => { if (!alignedJob?.outputRef || !alignment) return; const token = ++generation.current; setBusy(true); try { const value = await runtime.command('dialogue.importRepair', { projectId, dialogueRef, sourceVideo: alignment.video, confirmedAudioRef: alignedJob.outputRef, repairedVideo: repaired }); if (value && valid(token)) setModified(false); } finally { if (alive.current) setBusy(false); } }}>导入手工修正版</Button>{!alignedJob && <p role="status">对齐尚未成功、作业身份不匹配或输入已改变；需完成当前固定来源的本地对齐后再导入。{job.error?.message}</p>}</>}
    <DialogueReviewPanel projectId={projectId} shotId={dialogue.shotRef.id} shotRevision={dialogue.shotRef.revision} dialogueRef={dialogueRef} selectionRevision={selectionRevision} />
  </section>;
}
