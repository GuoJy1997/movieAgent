import { useState } from 'react';
import type { FinishRunView, PreparedFinishTurn, FinishTargets } from '../../../../../../packages/contracts/src/finish-agent.ts';
import type { RevisionRef } from '../../../../../../packages/contracts/src/models.ts';
import type { MediaReference } from '../../../../../../packages/contracts/src/assets.ts';
import { Badge, Button, Field } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { GenerationApproval } from '../canvas/GenerationApproval.tsx';
import { AssetPicker, TextField } from '../creation/CreationFields.tsx';
import { AGENT_MESSAGE_MAX_LENGTH } from '../../../../../../packages/contracts/src/agent.ts';

const stateNames: Record<string, string> = { PREPARED: '等待规划批准', PLANNING: '规划处理中', PROPOSED: '提案待审阅', REPLIED: '已回复', INVALID: '提案无效', FAILED: '任务失败', UNKNOWN: '提交状态不明', STOPPED: '已停止', ACCEPTED: '已采用' };
const keysFor = (run: FinishRunView) => {
  const draft = run.proposal?.draft;
  return draft?.kind === 'voice-lines' ? draft.lines.map(line => line.key) : draft?.kind === 'subtitle-edits' ? draft.edits.map(edit => edit.key) : draft?.kind === 'rough-cut' ? draft.clips.map(clip => clip.key) : [];
};

export function FinishProposal({ run }: { run: FinishRunView }) {
  const runtime = useRuntime();
  const draft = run.proposal?.draft;
  const targets = run.prepared.targets;
  const [chosen, setChosen] = useState<string[] | null>(null);
  const selected = run.action?.selectedKeys ?? chosen ?? keysFor(run);
  const skipped = keysFor(run).filter(key => !selected.includes(key));
  const locked = runtime.busy || runtime.pending || !runtime.online;
  const toggle = (key: string, checked: boolean) => setChosen(checked ? [...selected, key] : selected.filter(value => value !== key));
  return <article className="creation-card agent-run">
    <Badge warning={['INVALID', 'FAILED', 'UNKNOWN'].includes(run.state)}>{stateNames[run.state] ?? run.state}</Badge>
    <p className="agent-user-message">{run.prepared.message}</p>
    <p className="hint">{run.prepared.template.name} · {run.prepared.generation.config.model.name} · 独立成片协议 v1</p>
    {run.errorCode && <p role="alert" className="alert">{run.errorCode}。原任务与本地内容保留，不会自动重发或采用。</p>}
    {run.messages.filter(message => message.role === 'assistant').map((message, index) => <p className="agent-reply" key={`${message.createdAt}:${index}`}>{message.text}</p>)}
    {draft?.kind === 'voice-lines' && targets.kind === 'voice-lines' && draft.lines.map(line => {
      const old = targets.voiceLines.find(target => target.key === line.key)?.value;
      const shot = line.shotKey === undefined ? undefined : targets.shots.find(target => target.key === line.shotKey)?.value;
      return <section className="proposal-shot" key={line.key}>
        <label className="check"><input type="checkbox" aria-label={`采用文案 ${line.key}`} disabled={run.state !== 'PROPOSED'} checked={selected.includes(line.key)} onChange={event => toggle(line.key, event.target.checked)} />采用文案 {line.key}</label>
        {shot && <p>{shot.title} · 镜头 r{shot.revision}</p>}
        <p>角色别名 {line.role ?? '未指定'} · 情绪 {line.emotion ?? 'calm'} · 路线 {line.route ?? 'native-reference'}</p>
        {targets.voices?.filter(voice => [voice.id, voice.entityRef.id, `voice:${voice.id}`].includes(line.role ?? '')).map(voice => <p key={voice.id}>{voice.name} · 角色 {voice.entityRef.id} v{voice.entityRef.revision} · 声音 v{voice.revision} · {voice.dialect || '口音未标注'}</p>)}
        <div className="form-grid"><div><small>{old ? `采用前 · 捕获版本 v${old.revision}` : '新增文案'}</small><pre>{old?.text ?? '（无）'}</pre></div><div><small>采用后</small><pre>{line.text}</pre></div></div>
      </section>;
    })}
    {draft?.kind === 'subtitle-edits' && targets.kind === 'subtitle-edits' && draft.edits.map(edit => {
      const old = targets.cues.find(target => target.key === edit.key)!.value;
      return <section className="proposal-shot" key={edit.key}>
        <label className="check"><input type="checkbox" aria-label={`采用字幕 ${edit.key}`} disabled={run.state !== 'PROPOSED'} checked={selected.includes(edit.key)} onChange={event => toggle(edit.key, event.target.checked)} />采用字幕 {edit.key}</label>
        <p>时间线 {targets.timeline.title} · 捕获 r{targets.timeline.revision}</p>
        <div className="form-grid"><div><small>采用前</small><pre>{old.text}</pre><small>{old.startTicks}–{old.endTicks} ticks</small></div><div><small>采用后</small><pre>{edit.text}</pre><small>{edit.startTicks ?? old.startTicks}–{edit.endTicks ?? old.endTicks} ticks</small></div></div>
      </section>;
    })}
    {draft?.kind === 'rough-cut' && targets.kind === 'rough-cut' && draft.clips.map(clip => {
      const media = targets.media.find(target => target.key === clip.mediaKey)!;
      const shot = clip.shotKey === undefined ? undefined : targets.shots.find(target => target.key === clip.shotKey)?.value;
      return <section className="proposal-shot" key={clip.key}>
        <label className="check"><input type="checkbox" aria-label={`采用粗剪 ${clip.key}`} disabled={run.state !== 'PROPOSED'} checked={selected.includes(clip.key)} onChange={event => toggle(clip.key, event.target.checked)} />采用粗剪 {clip.key}</label>
        <p>{shot ? `${shot.title} · 镜头 r${shot.revision} · ` : ''}{media.metadata.mime} · 固定 {media.ref.kind === 'artifact' ? media.ref.artifactId : `${media.ref.assetId} v${media.ref.version}`}</p>
        <p>源入点 {clip.sourceInTicks} · 时间线 {clip.startTicks} · 时长 {clip.durationTicks} ticks · {clip.fit}</p>
      </section>;
    })}
    {draft && run.state === 'PROPOSED' && <div className="form-stack">
      <p>已选择 {selected.length} 项。{skipped.length ? `本次不采用：${skipped.join('、')}` : '本次采用提案全部内容。'}</p>
      <p className="hint">采用只修改本地文案、字幕或时间线，不自动配音、识别或渲染。版本冲突不会覆盖人工编辑。</p>
      <Button tone="primary" disabled={locked || !selected.length || Date.now() > run.proposal!.expiresAt} onClick={() => void runtime.command('finish.acceptProposal', { projectId: run.projectId, runId: run.runId, proposalHash: run.proposal!.proposalHash, selectedKeys: selected, executionOwner: run.prepared.executionOwner })}>采用所选成片提案</Button>
    </div>}
    {run.action && <div className="approval-summary"><h3>采用已确认</h3>
      {run.action.result.kind === 'voice-lines' ? run.action.result.dialogues ? run.action.result.dialogues.map(line => <p key={line.id}>对白 {line.id} · 新修订 r{line.revision} · 镜头 {line.shotRef.id} 的已有输出需重新核对</p>) : run.action.result.voiceLines.map(line => <p key={line.id}>文案 {line.id} · 新修订 r{line.revision}</p>) : <p>时间线 {run.action.result.timeline.title} · 新修订 r{run.action.result.timeline.revision}</p>}
      <p>未采用：{run.action.skippedKeys.join('、') || '无'}。每轮仅采用一次，剩余内容需新轮次。</p>
    </div>}
    <details><summary>上下文版本与省略说明</summary>{run.prepared.context.sources.map((source, index) => <p key={index}>{source.kind} · {source.id} r{source.revision} · {source.key}</p>)}<p>省略：{run.prepared.context.omitted.join('；') || '无'}</p></details>
  </article>;
}

export function FinishPanel({ sessionId, projectId, profile }: { sessionId: string; projectId: string; profile: RevisionRef | null }) {
  const runtime = useRuntime();
  const templates = useWorkspaceQuery('finish.templates', {});
  const runs = useWorkspaceQuery('finish.list', { sessionId }, Boolean(sessionId));
  const creation = useWorkspaceQuery('creation.read', { projectId }, Boolean(projectId));
  const audio = useWorkspaceQuery('audio.read', { projectId }, Boolean(projectId));
  const voices = useWorkspaceQuery('voice.list', { projectId }, Boolean(projectId));
  const timelines = useWorkspaceQuery('timeline.list', { projectId }, Boolean(projectId));
  const [templateId, setTemplate] = useState('finish-voice-lines');
  const [message, setMessage] = useState(''), [tokens, setTokens] = useState('4096');
  const [scriptId, setScript] = useState(''), [shotIds, setShots] = useState<string[]>([]), [lineIds, setLines] = useState<string[]>([]);
  const [timelineId, setTimeline] = useState(''), [cueIds, setCues] = useState<string[]>([]), [assets, setAssets] = useState<MediaReference[]>([]);
  const [approval, setApproval] = useState<PreparedFinishTurn | null>(null);
  const timeline = useWorkspaceQuery('timeline.read', { projectId, timelineId: timelineId || timelines.data?.timelines[0]?.id || '' }, Boolean(projectId && (timelineId || timelines.data?.timelines[0]?.id)));
  const kind = templates.data?.templates.find(template => template.id === templateId)?.kind ?? 'voice-lines';
  const locked = runtime.busy || runtime.pending || !runtime.online;
  const toggle = (values: string[], value: string, checked: boolean) => checked ? [...values, value] : values.filter(item => item !== value);
  const currentTimeline = timelines.data?.timelines.find(item => item.id === timelineId) ?? timelines.data?.timelines[0];
  const currentTimelineId = timelineId || currentTimeline?.id || '';
  const currentScriptId = scriptId || creation.data?.scripts[0]?.id || '';
  async function prepare() {
    if (!profile || !creation.data) return;
    const submitted = message;
    let targets: FinishTargets;
    if (kind === 'voice-lines') {
      const script = creation.data.scripts.find(item => item.id === currentScriptId);
      if (!script) return;
      targets = { kind, scriptRef: { id: script.id, revision: script.revision }, shotRefs: creation.data.shots.filter(shot => shotIds.includes(shot.id)).map(shot => ({ id: shot.id, revision: shot.revision })), voiceLineRefs: (audio.data?.voiceLines ?? []).filter(line => lineIds.includes(line.id)).map(line => ({ id: line.id, revision: line.revision })) };
    } else {
      const fixed = timelines.data?.timelines.find(item => item.id === currentTimelineId);
      if (!fixed) return;
      const timelineRef = { libraryId: fixed.libraryId, projectId: fixed.projectId, id: fixed.id, revision: fixed.revision };
      if (kind === 'subtitle-edits') targets = { kind, timelineRef, cueIds };
      else targets = { kind, timelineRef, shots: creation.data.shots.filter(shot => shotIds.includes(shot.id)).map(shot => ({ id: shot.id, revision: shot.revision, selectionRevision: creation.data!.selections.find(selection => selection.shotId === shot.id)?.selectionRevision ?? 0 })), mediaRefs: assets };
    }
    const prepared = await runtime.command('finish.prepareTurn', { sessionId, templateId, targets, profileRef: profile, message, ...(tokens ? { outputTokens: Number(tokens) } : {}) });
    if (prepared) { setApproval(prepared); setMessage(current => current === submitted ? '' : current); }
  }
  return <section className="creation-editor form-stack"><h2>成片助手</h2><p className="hint">三种独立提案协议。只采用本地修改，不自动发起媒体任务。</p>
    {runs.data?.runs.map(run => <FinishProposal key={run.runId} run={run}/>)}
    <form className="form-stack" onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <div className="form-grid"><Field label="成片模板"><select value={templateId} onChange={event => setTemplate(event.target.value)}>{templates.data?.templates.map(template => <option key={template.id} value={template.id}>{template.name} · v{template.revision}</option>)}</select></Field><Field label="输出 token 预算"><input type="number" min={1} max={8192} value={tokens} onChange={event => setTokens(event.target.value)}/></Field></div>
      {kind === 'voice-lines' && <details open><summary>配音文案上下文</summary><Field label="所属剧本"><select value={currentScriptId} onChange={event => { setScript(event.target.value); setShots([]); }}>{creation.data?.scripts.map(script => <option key={script.id} value={script.id}>{script.title} · r{script.revision}</option>)}</select></Field>{creation.data?.shots.filter(shot => shot.scriptId === currentScriptId).map(shot => <label className="check" key={shot.id}><input type="checkbox" checked={shotIds.includes(shot.id)} onChange={event => setShots(toggle(shotIds, shot.id, event.target.checked))}/>镜头 {shot.title} · r{shot.revision}</label>)}{audio.data?.voiceLines.map(line => <label className="check" key={line.id}><input type="checkbox" checked={lineIds.includes(line.id)} onChange={event => setLines(toggle(lineIds, line.id, event.target.checked))}/>文案 {line.id} · r{line.revision} · {line.text}</label>)}</details>}
      {(kind === 'subtitle-edits' || kind === 'rough-cut') && <details open><summary>固定时间线与素材</summary><Field label="目标时间线"><select value={currentTimelineId} onChange={event => { setTimeline(event.target.value); setCues([]); }}>{timelines.data?.timelines.map(item => <option key={item.id} value={item.id}>{item.title} · r{item.revision}</option>)}</select></Field>{kind === 'subtitle-edits' && timeline.data?.subtitleCues.map(cue => <label className="check" key={cue.id}><input type="checkbox" checked={cueIds.includes(cue.id)} onChange={event => setCues(toggle(cueIds, cue.id, event.target.checked))}/>字幕 {cue.id} · {cue.text}</label>)}{kind === 'rough-cut' && <>{creation.data?.shots.map(shot => <label className="check" key={shot.id}><input type="checkbox" checked={shotIds.includes(shot.id)} onChange={event => setShots(toggle(shotIds, shot.id, event.target.checked))}/>镜头 {shot.title} · r{shot.revision}</label>)}<AssetPicker value={assets} onChange={setAssets} max={32}/></>}</details>}
      <TextField label="成片修改需求" value={message} onChange={setMessage} max={AGENT_MESSAGE_MAX_LENGTH} large required/>
      {kind === 'voice-lines' && <details><summary>可用角色、情绪与路线别名</summary>{voices.data?.voices.map(voice => <p key={voice.id}>voice:{voice.id} → {voice.name} · 角色 {voice.entityRef.id} v{voice.entityRef.revision} · 声音 v{voice.revision}</p>)}<p>情绪 calm（平静）、excited（激动）、quiet（低声）、exchange（轮流对白）。路线 native-reference（原生参考）、dubbed-lipsync（配音口型）、voiceover（画外音）。</p><p className="hint">提案采用仅保存本地结构化对白并标记受影响镜头；不会创建模型 voice_id、质量通过或生成批准。</p></details>}
      <Button type="submit" tone="primary" disabled={locked || !profile || !message.trim() || kind === 'voice-lines' && !currentScriptId || kind !== 'voice-lines' && !currentTimelineId || kind === 'subtitle-edits' && !cueIds.length || kind === 'rough-cut' && (!shotIds.length || !assets.length)}>准备成片规划</Button>
    </form>
    {approval && <GenerationApproval prepared={approval.generation} onClose={() => setApproval(null)} onApprove={input => runtime.command('finish.approveTurn', { runId: approval.runId, approval: input })} summary={<div className="creation-card"><h3>{approval.template.name}</h3><p>{approval.message}</p><p>{approval.context.notice}</p><p>省略：{approval.context.omitted.join('；') || '无'}</p></div>}/>} 
  </section>;
}
