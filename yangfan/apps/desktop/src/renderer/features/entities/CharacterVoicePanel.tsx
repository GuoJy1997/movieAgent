import {VoiceUsagePanel} from './VoiceUsagePanel.tsx';
import {VoiceIdentityAuditions} from './VoiceIdentityAuditions.tsx';
import {VoiceClonePanel} from './VoiceClonePanel.tsx';
import { useEffect, useRef, useState } from 'react';
import type { CreationRef } from '../../../../../../packages/contracts/src/creation.ts';
import type { CharacterVoiceRevision, VoiceReference, VoiceTTSBinding } from '../../../../../../packages/contracts/src/character-voice.ts';
import { Badge, Button, Empty, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { MediaPreview } from '../assets/MediaPreview.tsx';
import { useRevisionDraft } from '../creation/useRevisionDraft.ts';
import { timelineNavigate, useOwnedDraft } from '../../state/DraftNavigationGuard.tsx';

export function CharacterVoicePanel({ projectId, entityRef }: { projectId: string; entityRef: CreationRef }) {
  const voices = useWorkspaceQuery('voice.list', { projectId, entityId: entityRef.id });
  const runtime=useRuntime(),history=useWorkspaceQuery('voice.history',{projectId,entityId:entityRef.id});
  const [voiceId, setVoiceId] = useState('');
  return <section className="creation-card form-stack" aria-label="角色声音档案"><h3>声音档案</h3><QueryState loading={voices.isLoading} error={voices.error} />
    <Field label="现有声音修订"><select value={voiceId} onChange={event => { const id = event.target.value; timelineNavigate(() => setVoiceId(id)); }}><option value="">新声音档案</option>{voices.data?.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · v{voice.revision}{voice.production.ready ? ' · 标准参考已准备' : ' · 待准备'}</option>)}</select></Field>
    <p>默认声音：{voices.data?.defaultBindings?.find(b=>b.characterId===entityRef.id)?.voiceRef.id??'尚未选择'} · 默认绑定仅影响后续选择，历史对白保持原版本。</p>
    {voiceId&&voices.data?.voices.find(v=>v.id===voiceId)&&<Button disabled={runtime.busy||runtime.pending||!runtime.online} onClick={()=>{const voice=voices.data!.voices.find(v=>v.id===voiceId)!,binding=voices.data!.defaultBindings?.find(b=>b.characterId===entityRef.id);void runtime.command('voice.bindDefault',{projectId,characterId:entityRef.id,voiceRef:{id:voice.id,revision:voice.revision},expectedRevision:binding?.revision??0});}}>设为角色默认声音</Button>}
    {voiceId&&voices.data?.voices.find(v=>v.id===voiceId)&&<VoiceUsagePanel key={voiceId} projectId={projectId} voice={voices.data.voices.find(v=>v.id===voiceId)!} dialogues={voices.data.dialogues??[]}/>}
    <details><summary>声音历史版本</summary>{history.data?.voices.map(v=><p key={v.id+':'+v.revision}>{v.name} · {v.id} v{v.revision} · {v.archived?'已归档':'保留'}</p>)}</details>
    {voices.data && <VoiceEditor key={`${projectId}/${entityRef.id}/${voiceId}`} projectId={projectId} entityRef={entityRef} initial={voices.data.voices.find(voice => voice.id === voiceId) ?? null} />}
  </section>;
}

function VoiceEditor({ projectId, entityRef: latestEntityRef, initial }: { projectId: string; entityRef: CreationRef; initial: CharacterVoiceRevision | null }) {
  const [entityRef] = useState(latestEntityRef);
  const runtime = useRuntime(), assets = useWorkspaceQuery('asset.search', { mediaType: 'audio', state: 'active', latestOnly: true }), profiles=useWorkspaceQuery('profile.list',{}), models=useWorkspaceQuery('model.list',{});
  const speechProfiles=profiles.data?.profiles.filter(p=>models.data?.models.some(m=>m.id===p.modelRef.id&&m.revision===p.modelRef.revision&&m.capabilities.taskTypes.some(type=>type==='text_to_speech')))??[];
  const make = (voice: CharacterVoiceRevision | null) => ({ id: voice?.id ?? crypto.randomUUID(), expectedRevision: voice?.revision ?? 0, name: voice?.name ?? '', dialect: voice?.dialect ?? '', notes: voice?.performanceNotes ?? '', reference: voice?.reference ?? null as VoiceReference | null, ttsProfileRef:voice?.ttsBinding?.profileRef??voice?.ttsProfileRef??null,sourceKind:voice?.sourceKind??'sample' as 'sample'|'provider-voice'|'cloned-voice',providerVoiceId:voice?.ttsBinding?.providerVoiceId??'',language:voice?.language??'',timbre:voice?.timbreDescription??'',sourceSample:voice?.sourceSample??voice?.reference??null,videoReference:voice?.videoReference??null,baselineAudio:voice?.baselineAudio??null,archived:voice?.archived??false });
  const draft = useRevisionDraft(() => make(initial)), [saved, setSaved] = useState(initial), [busy, setBusy] = useState(false), [jobId, setJobId] = useState(''), [preparing, setPreparing] = useState<CharacterVoiceRevision | null>(null);
  const job = useWorkspaceQuery('render.read', { projectId, jobId }, Boolean(jobId));
  const alive = useRef(true), operation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current++; }; }, []);
  const value = draft.draft, reference = value.reference;
  const locked = runtime.busy || runtime.pending || !runtime.online || busy || draft.saving;
  const selectedProfile=speechProfiles.find(p=>p.id===value.ttsProfileRef?.id&&p.revision===value.ttsProfileRef.revision),selectedModel=models.data?.models.find(m=>m.id===selectedProfile?.modelRef.id&&m.revision===selectedProfile.modelRef.revision);
  const catalog=useWorkspaceQuery('voice.catalog',{projectId,profileRef:value.ttsProfileRef??{libraryId:'none',id:'none',revision:1}},!!value.ttsProfileRef);
  const binding:VoiceTTSBinding|undefined=value.providerVoiceId.trim()&&selectedProfile&&selectedModel?{providerVoiceId:value.providerVoiceId,profileRef:{libraryId:selectedProfile.libraryId,id:selectedProfile.id,revision:selectedProfile.revision},modelRef:selectedProfile.modelRef,connectionRef:selectedModel.connectionRef,voiceOrigin:saved?.ttsBinding?.voiceOrigin??'custom',...(saved?.ttsBinding?.cloneJobId?{cloneJobId:saved.ttsBinding.cloneJobId}:{})}:undefined;
  const valid = !!value.name.trim() && (!!reference||!!binding);
  const voiceDraft=(input:typeof value)=>({entityRef,name:input.name,dialect:input.dialect,performanceNotes:input.notes,reference:input.reference,sourceKind:input.sourceKind,language:input.language,timbreDescription:input.timbre,...(input.sourceSample?{sourceSample:input.sourceSample}:{}),...(input.videoReference?{videoReference:input.videoReference}:{}),...(input.baselineAudio?{baselineAudio:input.baselineAudio}:{}),archived:input.archived,...(input.ttsProfileRef?{ttsProfileRef:input.ttsProfileRef}:{}),...(binding?{ttsBinding:binding}:{})});
  async function persist() {
    if (!valid) return false;
    return draft.save(input => runtime.command('voice.save', { projectId, id: input.id, expectedRevision: input.expectedRevision, draft: voiceDraft(input) }), make, setSaved);
  }
  useOwnedDraft({ dirty: draft.dirty || draft.saving || busy, save: async () => busy ? false : persist(), discard: () => { operation.current++; draft.reload(make(saved)); } }, draft.draft);
  return <div className="form-stack">
    {latestEntityRef.revision !== entityRef.revision && <p role="alert">角色已有新修订；当前声音草稿仍绑定角色 v{entityRef.revision}，请关闭后重新打开并核对。</p>}
    {saved && <Badge>声音 v{value.expectedRevision} · {saved.production.ready ? '标准参考已准备' : `待准备：${saved.production.reason ?? '未分析'}`}</Badge>}
    {initial && initial.revision > value.expectedRevision && <p role="alert">声音已有新修订，当前草稿保留。<Button onClick={() => timelineNavigate(() => { draft.reload(make(initial)); setSaved(initial); })}>读取最新声音</Button></p>}
    <Field label="声音来源"><select value={value.sourceKind} onChange={e=>draft.change({sourceKind:e.target.value as typeof value.sourceKind})}><option value="sample">本地声音样本</option><option value="provider-voice">服务已有音色</option><option value="cloned-voice">已克隆音色</option></select></Field>
    <p>材料：{reference?'本地参考已绑定':'未上传参考'} · 服务：{saved?.ttsBinding?'已绑定 ID，需核对试听':'未绑定固定音色'} · 人工质量：以逐条试听审核为准</p>
    {!reference && <Empty title="尚未绑定标准声音">可选择本地音频；使用服务已有音色时无需上传样本。</Empty>}
    <Field label="固定音频"><select value={reference?.ref.kind === 'assetVersion' ? `${reference.ref.assetId}:${reference.ref.version}` : ''} onChange={async event => {
      const asset = assets.data?.assets.find(item => `${item.ref.assetId}:${item.ref.version}` === event.target.value), token = ++operation.current;
      if (!asset) { draft.change({ reference: null, sourceSample:null,videoReference:null }); return; }
      setBusy(true); try { const resolved = await runtime.command('media.inspect', { projectId, reference: asset.ref }); if (resolved && alive.current && token === operation.current) draft.change({ videoReference:null, sourceSample: {ref:resolved.ref,hash:resolved.hash,probeId:resolved.probe?.probeId??null,sourceInTicks:0,durationTicks:resolved.probe?.durationTicks??0}, reference: { ref: resolved.ref, hash: resolved.hash, probeId: resolved.probe?.probeId ?? null, sourceInTicks: 0, durationTicks: Math.min(resolved.probe?.durationTicks ?? 0,720000) } }); } finally { if (alive.current) setBusy(false); }
    }}><option value="">选择音频原件</option>{assets.data?.assets.map(asset => <option key={`${asset.ref.assetId}:${asset.ref.version}`} value={`${asset.ref.assetId}:${asset.ref.version}`}>{asset.name} · {asset.ref.assetId} · v{asset.ref.version}</option>)}</select></Field>
    {reference && <><MediaPreview media={reference.ref} original previewRange={{ startTicks: reference.sourceInTicks, durationTicks: reference.durationTicks }} /><p className="hint">固定 hash {reference.hash} · {reference.ref.kind === 'artifact' ? reference.ref.artifactId : `${reference.ref.assetId} v${reference.ref.version}`}</p><div className="form-grid"><Field label="裁切起点（秒）"><input type="number" min={0} step={0.1} value={reference.sourceInTicks / 48000} onChange={event => draft.change({ videoReference:null, reference: { ...reference, sourceInTicks: Math.round(Number(event.target.value) * 48000) } })} /></Field><Field label="裁切时长（秒）"><input type="number" min={2} max={15} step={0.1} value={reference.durationTicks / 48000} onChange={event => draft.change({ videoReference:null, reference: { ...reference, durationTicks: Math.round(Number(event.target.value) * 48000) } })} /></Field></div></>}
    <Field label="声音名称"><input maxLength={200} value={value.name} onChange={event => draft.change({ name: event.target.value })} /></Field>
    <Field label="语言"><input maxLength={200} value={value.language} onChange={e=>draft.change({language:e.target.value})}/></Field><Field label="声线说明"><input maxLength={2000} value={value.timbre} onChange={e=>draft.change({timbre:e.target.value})}/></Field>
    <Field label="地域 / 口音"><input maxLength={200} value={value.dialect} onChange={event => draft.change({ dialect: event.target.value })} /></Field>
    <Field label="表演说明"><textarea maxLength={8000} value={value.notes} onChange={event => draft.change({ notes: event.target.value })} /></Field>
    <Field label="旁白 TTS 预设"><select value={value.ttsProfileRef?`${value.ttsProfileRef.id}:${value.ttsProfileRef.revision}`:''} onChange={event=>{const profile=speechProfiles.find(p=>`${p.id}:${p.revision}`===event.target.value);draft.change({ttsProfileRef:profile?{libraryId:profile.libraryId,id:profile.id,revision:profile.revision}:null,providerVoiceId:''});}}><option value="">未指定独立旁白预设</option>{speechProfiles.map(p=><option key={`${p.id}:${p.revision}`} value={`${p.id}:${p.revision}`}>{p.name} v{p.revision} · voice {String(p.parameters.voice??'默认')}</option>)}</select></Field>
    {value.ttsProfileRef&&<><Button disabled={locked} onClick={()=>void runtime.command('voice.refreshCatalog',{projectId,profileRef:value.ttsProfileRef!})}>刷新服务音色目录</Button>
      <p>{catalog.data?.stale?'目录为缓存或不可用，可手填 ID':'服务目录已更新'} · {catalog.data?.diagnostic??''} · {catalog.data?.fetchedAt??'尚未拉取'}</p>
      <Field label="服务音色候选"><select value={catalog.data?.voices.some(v=>v.id===value.providerVoiceId)?value.providerVoiceId:''} onChange={e=>draft.change({providerVoiceId:e.target.value})}><option value="">选择候选或手填</option>{catalog.data?.voices.map(v=><option key={v.id} value={v.id}>{v.name} · {v.id}</option>)}</select></Field>
      <Field label="服务 voice ID"><input maxLength={256} value={value.providerVoiceId} onChange={e=>draft.change({providerVoiceId:e.target.value})}/></Field></>}
    <Field label="归档此声音"><input type="checkbox" checked={value.archived} onChange={e=>draft.change({archived:e.target.checked})}/></Field>
    <p className="hint">试听只读取本地固定媒体；保存声音不会调用模型，也不会自动通过音色或口音验收。</p>
    <Button tone="primary" disabled={locked || !valid} onClick={() => void persist()}>保存声音档案</Button>
    {draft.dirty && <p role="status">声音档案有未保存修改</p>}
    {saved && <><Button disabled={locked || draft.dirty || !saved.reference&&!saved.videoReference} onClick={async () => {
      const token = ++operation.current, captured = saved; setBusy(true);
      try { const plan = await runtime.command('voice.prepareReference', { projectId, voiceRef: { id: captured.id, revision: captured.revision }, executionOwner: 'desktop-user', runId: crypto.randomUUID() }); if (!plan || !alive.current || token !== operation.current) return;
        const queued = await runtime.command('media.enqueueDerived', { planId: plan.planId, planHash: plan.planHash, executionOwner: plan.executionOwner, runId: plan.runId, diskBudgetBytes: plan.requiredFreeBytes });
        if (queued && alive.current && token === operation.current) { setPreparing(captured); setJobId(queued.jobId); }
      } finally { if (alive.current) setBusy(false); }
    }}>准备标准声音参考</Button><p className="hint">本地裁切为 48kHz / 单声道 / PCM s16 WAV；完成后需明确保存新声音修订。</p><Button disabled={locked} onClick={() => void window.studio.exportVoice({ projectId, voiceRef: { id: saved.id, revision: saved.revision }, requestId: crypto.randomUUID() })}>导出声音快照</Button></>}
    {saved&&!draft.dirty&&<><VoiceIdentityAuditions projectId={projectId} voice={saved}/><VoiceClonePanel projectId={projectId} entityRef={entityRef} source={saved.sourceSample??saved.reference} profileRef={saved.ttsBinding?.profileRef??saved.ttsProfileRef??null} name={saved.name} dialect={saved.dialect} performanceNotes={saved.performanceNotes}/></>}
    {job.data && <p>标准参考作业：{job.data.state} {job.data.errorCode ?? ''}</p>}
    {job.data?.outputRef && preparing && <><MediaPreview media={job.data.outputRef} original /><Button disabled={locked || draft.dirty || value.expectedRevision !== preparing.revision} onClick={async () => {
      const outputRef = job.data!.outputRef!, token = ++operation.current; setBusy(true);
      try {
        await draft.save(async input => {
          const resolved = await runtime.command('media.inspect', { projectId, reference: outputRef }); if (!resolved?.probe || !alive.current || token !== operation.current) return;
          return runtime.command('voice.save', { projectId, id: input.id, expectedRevision: preparing.revision, draft: {...voiceDraft(input),reference:{ref:resolved.ref,hash:resolved.hash,probeId:resolved.probe.probeId,sourceInTicks:0,durationTicks:resolved.probe.durationTicks},videoReference:{ref:resolved.ref,hash:resolved.hash,probeId:resolved.probe.probeId,sourceInTicks:0,durationTicks:resolved.probe.durationTicks}} });
        }, make, voice => { setSaved(voice); setJobId(''); setPreparing(null); });
      } finally { if (alive.current) setBusy(false); }
    }}>将标准参考保存为新修订</Button></>}
  </div>;
}
