import {mascot} from '../../../../../../packages/ui/src/Brand.tsx';
import { AgentComposer } from './AgentComposer.tsx';
import { Icon } from '../../../../../../packages/ui/src/icons.tsx';
import { Dialog } from '../../../../../../packages/ui/src/overlays.tsx';
import { useAgentDraft, getAgentDraft, setAgentDraft, clearAgentDraft, getAgentSession, rememberAgentSession } from '../../state/agent-composer-draft.ts';
import { useOwnedDraft, timelineNavigate } from '../../state/DraftNavigationGuard.tsx';
import { buildProposalDiffs, ProposalDiff } from './ProposalDiff.tsx';
import { FinishPanel } from './FinishProposal.tsx';
import { useLayoutEffect, useRef, useState } from 'react';

import type { AgentMessage, AgentMode, AgentRunView, PreparedAgentTurn } from '../../../../../../packages/contracts/src/agent.ts';
import type { MediaReference } from '../../../../../../packages/contracts/src/assets.ts';
import { Badge, Button, Empty, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { GenerationApproval } from '../canvas/GenerationApproval.tsx';
import { TaskDetail } from '../tasks/TaskDetail.tsx';
import { AssetPicker, TextField } from '../creation/CreationFields.tsx';
import { profileKey, profileRef } from '../creation/ShotProductionPanel.tsx';
const modes: Record<AgentMode, string> = {
  all: '全能创作',
  script: '剧本创编',
  director: '导演分镜'
};
const stateNames: Record<string, string> = {
  PREPARED: '等待规划批准',
  PLANNING: '规划任务处理中',
  PROPOSED: '提案待审阅',
  REPLIED: '已回复',
  INVALID: '提案格式无效',
  FAILED: '任务或本地收存失败',
  UNKNOWN: '提交状态不明',
  STOPPED: '已停止',
  ACCEPTED: '已采用'
};
export function AgentWorkspace({
  projectId,
  onCreation, onOpenConversation,
  presentation = 'full'
}: {
  projectId: string;
  onCreation(): void; onOpenConversation?():void;
  presentation?: 'full'|'home'|'panel'|'finish';
}) {
  const runtime = useRuntime(),
    sessions = useWorkspaceQuery('agent.list', {
      projectId
    }),
    templates = useWorkspaceQuery('agent.templates', {}),
    creation = useWorkspaceQuery('creation.read', {
      projectId
    }),
    profiles = useWorkspaceQuery('profile.list', {}),
    models = useWorkspaceQuery('model.list', {});
  const sessionScope=JSON.stringify([runtime.descriptor?.libraryId??'legacy',projectId,runtime.scope?.subprojectId??'legacy']);
  const [sessionId,selectSession]=useState(()=>getAgentSession(sessionScope)),[title,setTitle]=useState('新的创作会话'),[mode,setMode]=useState<AgentMode>('all');
  const currentSession=sessionId||sessions.data?.sessions[0]?.sessionId||'';
  const draftKey=sessionScope+'/'+(presentation==='home'?'home':currentSession||'home'),draft=useAgentDraft(draftKey);
  const {message,profile,templateId,scriptId,shotIds,entityIds,assets,tokens}=draft;
  const setSessionId=(id:string)=>timelineNavigate(()=>{rememberAgentSession(sessionScope,id);selectSession(id);});
  const setMessage=(value:string|((old:string)=>string))=>setAgentDraft(draftKey,{message:typeof value==='function'?value(getAgentDraft(draftKey).message):value});
  const setProfile=(value:string)=>setAgentDraft(draftKey,{profile:value});
  const setTemplate=(value:string)=>setAgentDraft(draftKey,{templateId:value});
  const setScript=(value:string)=>setAgentDraft(draftKey,{scriptId:value});
  const setShots=(value:string[])=>setAgentDraft(draftKey,{shotIds:value});
  const setEntities=(value:string[])=>setAgentDraft(draftKey,{entityIds:value});
  const setAssets=(value:MediaReference[])=>setAgentDraft(draftKey,{assets:value});
  const setTokens=(value:string)=>setAgentDraft(draftKey,{tokens:value});
  const sessionList=useRef<HTMLDetailsElement>(null);
  const [approval,setApproval]=useState<PreparedAgentTurn|null>(null),[task,setTask]=useState<string|null>(null);
  const [option,setOption]=useState<'skills'|'models'|'preferences'|'references'|'mode'|'start'|null>(null);
  useOwnedDraft({dirty:!!message.trim(),ephemeral:true,save:async()=>true,discard:()=>clearAgentDraft(draftKey)},draft);
  const session = useWorkspaceQuery('agent.read', {
    sessionId: currentSession
  }, Boolean(currentSession));
  const textProfiles = (profiles.data?.profiles ?? []).filter(p => models.data?.models.some(m => m.id === p.modelRef.id && m.revision === p.modelRef.revision && m.capabilities.outputKinds.some(kind => kind === 'text')));
  const chosen = textProfiles.find(p => profileKey(p) === profile) ?? textProfiles[0];
  const tokenScope = JSON.stringify([sessionScope, currentSession, chosen ? profileKey(chosen) : '']);
  const inheritedTokens = chosen?.parameters?.max_completion_tokens ?? chosen?.parameters?.max_tokens;
  const validTokens = !tokens.trim() || Number.isInteger(Number(tokens)) && Number(tokens) >= 1 && Number(tokens) <= 8192;
  useLayoutEffect(() => { setTokens(''); setApproval(null); }, [tokenScope]);
  const navigationScope=useRef(0);useLayoutEffect(()=>{navigationScope.current++;return()=>{navigationScope.current++;};},[sessionScope]);
  const preparationScope = useRef(0);
  useLayoutEffect(() => {
    preparationScope.current++;
    return () => {
      preparationScope.current++;
    };
  }, [tokenScope]);
  const locked = runtime.busy || runtime.pending || !runtime.online;
  return <section className={"creation-page agent-workspace agent-"+presentation}>
    <div className="page-heading">
      <div>
        <p className="eyebrow">人来定稿 · 每轮单独批准</p>
        <h1>{presentation==='finish'?'成片助手':'创作 Agent'}</h1>
        <p>一次需求，一次有界文本规划。先审阅提案，再选择采用的镜头。</p>
      </div>
      <Button onClick={onCreation}>打开剧本与分镜</Button>
    </div>
    <div className="creation-layout">
      <details ref={sessionList} className="creation-list agent-session-list" open={!currentSession}><summary>会话与模式</summary>
        <h2>会话</h2>
        <QueryState loading={sessions.isLoading} error={sessions.error} />
        {sessions.data?.sessions.map(s => <Button key={s.sessionId} tone={s.sessionId === currentSession ? 'primary' : 'secondary'} onClick={() => setSessionId(s.sessionId)}>{s.title} · {modes[s.mode]}</Button>)}
        <form className="creation-card form-stack" onSubmit={async e => {
          e.preventDefault();
          const submittedScope = preparationScope.current;
          const result = await runtime.command('agent.createSession', {
            projectId,
            title,
            mode,
            executionOwner: 'desktop-user'
          });
          if (result && submittedScope === preparationScope.current) { if(!currentSession){setAgentDraft(sessionScope+'/'+result.sessionId,getAgentDraft(draftKey));clearAgentDraft(draftKey);} setSessionId(result.sessionId); }
        }}>
          <TextField label="新会话名称" value={title} max={200} required onChange={setTitle} />
          <Field label="创作模式">
            <select value={mode} onChange={e => setMode(e.target.value as AgentMode)}>
              {Object.entries(modes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Button type="submit" disabled={locked}>创建创作会话</Button>
        </form>
      </details>
      <div className="form-stack creation-main">
        <QueryState loading={session.isLoading && Boolean(currentSession)} error={session.error} />
        {session.data||presentation==='home' ? <>
          {presentation==='finish'&&<Button onClick={()=>setOption('models')}><Icon name="model"/>{chosen?.name??'选择规划模型'}</Button>}<h2>{session.data?.title} <Badge>{modes[session.data?.mode??mode]}</Badge></h2>
          {presentation!=='home'&&presentation!=='finish'&&session.data?.runs.map(run => <AgentRunCard key={run.runId} run={run} messages={session.data!.messages.filter(message => message.runId === run.runId && message.role === 'assistant')} onApprove={() => setApproval(run.prepared)} onTask={setTask} onCreation={onCreation} />)}
          {presentation!=='finish'&&<form className="agent-input-form" onSubmit={async e => {
            e.preventDefault();
            if(presentation==='home'){if(!locked&&message.trim())setOption('start');return;}
            if (locked || !chosen || !validTokens || !message.trim() || message.length>4000 || assets.length>8) return;
            const submittedScope = preparationScope.current;
            const submittedMessage = message;
            const prepared = await runtime.command('agent.prepareTurn', {
              sessionId: currentSession,
              message,
              profileRef: profileRef(chosen),
              templateId,
              targets: {
                ...(scriptId ? {
                  scriptId
                } : {}),
                shotIds,
                entityIds
              },
              selectedAssetRefs: assets,
              ...(tokens.trim() ? {
                outputTokens: Number(tokens)
              } : {})
            });
            if (prepared && submittedScope === preparationScope.current) {
              setApproval(prepared);
              setMessage(current => current === submittedMessage ? '' : current);
            }
          }}>
            <AgentComposer placeholder={presentation==="home"?"描述你的想法，或 @ 引用角色、场景、镜头…":undefined} value={message} onChange={setMessage} disabled={locked||!message.trim()||(presentation!=='home'&&(!chosen||!validTokens||assets.length>8))} submitLabel={presentation==='home'?'开始创作对话':undefined} onReference={()=>setOption('references')}
             references={(shotIds.length+entityIds.length+assets.length)>0?<button type="button" className="composer-reference-chip" onClick={()=>setOption('references')}>{shotIds.length} 镜头 · {entityIds.length} 实体 · {assets.length} 素材</button>:undefined}
             tools={<><Button tone="quiet" aria-label="添加参考素材" onClick={()=>setOption('references')}><Icon name="plus"/></Button><Button tone="quiet" aria-label="引用角色、场景和镜头" onClick={()=>setOption('references')}><Icon name="at"/></Button><Button tone="quiet" onClick={()=>setOption('mode')}><Icon name="agent"/>{modes[presentation==='home'?mode:session.data?.mode??mode]}<Icon name="down" size={12}/></Button><Button tone="quiet" aria-label="技能" onClick={()=>setOption('skills')}><Icon name="skills"/>技能<Icon name="down" size={12}/></Button><Button tone="quiet" aria-label="模型" onClick={()=>setOption('models')}><Icon name="model"/>{chosen?.name??'选择模型'}<Icon name="down" size={12}/></Button><Button tone="quiet" aria-label="偏好" onClick={()=>setOption('preferences')}><Icon name="preferences"/>偏好<Icon name="down" size={12}/></Button></>}/>
            <p className="composer-notice">{presentation==='home'?'先建立本集会话，再审阅规划与预算。':!chosen?'没有可用文本预设，请先配置文本模型。':!runtime.online?'引擎离线，草稿已保留。':runtime.pending?'原回执待核实，新提交已停用。':'准备只冻结上下文与预算；随后明确批准才会提交模型。'}</p>
          </form>}
          {presentation!=='home'&&<details className="finish-assistant-section" open={presentation==='finish'}><summary>成片助手 · 配音文案 / 字幕 / 粗剪</summary><FinishPanel sessionId={currentSession} projectId={projectId} profile={chosen ? profileRef(chosen) : null} /></details>}
        </> : <Empty title="建立创作会话">选择模式并创建会话，然后提交具体创作需求。</Empty>}
      </div>
    </div>
    {approval && <GenerationApproval prepared={approval.generation} onClose={() => setApproval(null)} onApprove={input => runtime.command('agent.approveTurn', {
      runId: approval.runId,
      approval: input
    })} summary={<div className="creation-card">
      <h3>{approval.template.name} · 规划上下文</h3>
      <p>{approval.message}</p>
      <p>{approval.context.notice}</p>{approval.targets.voices?.map(v=><p key={v.id}>固定角色声音：{v.name} · {v.id} v{v.revision} · 角色 {v.entityRef.id} · {v.dialect} · {v.performanceNotes}</p>)}
      <p>包含：{approval.context.included.join('；')}</p>
      <p>省略：{approval.context.omitted.join('；') || '无'}</p>
      <p>已冻结 {approval.context.promptCharacters} 字符。输出预算以以下参数为准。</p>
    </div>} />}
    {option==='start'&&<Dialog title="开始创作对话" onClose={()=>setOption(null)}><div className="form-stack"><p>这段想法会带入本集的新会话。后续准备与批准规划后才会提交模型。</p><TextField label="会话名称" value={title} max={200} required onChange={setTitle}/><Field label="新会话模式"><select value={mode} onChange={e=>setMode(e.target.value as AgentMode)}>{Object.entries(modes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field><Button tone="primary" disabled={locked||!title.trim()} onClick={async()=>{const submitted=preparationScope.current,submittedNavigation=navigationScope.current;const result=await runtime.command('agent.createSession',{projectId,title,mode,executionOwner:'desktop-user'});if(result&&submitted===preparationScope.current){setAgentDraft(sessionScope+'/'+result.sessionId,getAgentDraft(draftKey));clearAgentDraft(draftKey);rememberAgentSession(sessionScope,result.sessionId);selectSession(result.sessionId);setOption(null);requestAnimationFrame(()=>{if(submittedNavigation===navigationScope.current)onOpenConversation?.();});}}}>创建会话并继续</Button></div></Dialog>}
    {option==='skills'&&<Dialog title="创作技能" onClose={()=>setOption(null)}><div className="form-stack">
          <Field label="创作模板">
                <select value={templateId} onChange={e => setTemplate(e.target.value)}>
                  {templates.data?.templates.map(t => <option key={t.id} value={t.id}>{t.name} · v{t.revision}</option>)}
                </select>
              </Field>
    
<p className="hint">{templates.data?.templates.find(t=>t.id===templateId)?.description}</p></div></Dialog>}
    {option==='models'&&<Dialog title="规划模型" onClose={()=>setOption(null)}><div className="form-stack">
          <Field label="规划文本预设">
                <select value={chosen ? profileKey(chosen) : ''} onChange={e => setProfile(e.target.value)}>
                  <option value="">请选择文本模型</option>
                  {textProfiles.map(p => <option key={profileKey(p)} value={profileKey(p)}>{p.name} · v{p.revision}</option>)}
                </select>
              </Field>

<p className="hint">模型配置属于应用，当前会话使用固定版本的规划文本预设。</p></div></Dialog>}
    {option==='preferences'&&<Dialog title="创作偏好" onClose={()=>setOption(null)}><div className="form-stack">
            <Field label="输出 token 预算（留空沿用预设）">
              <input type="number" min={1} max={8192} step={1} placeholder="沿用模型预设" value={tokens} onChange={e => setTokens(e.target.value)} />
            </Field>
            <p className="hint">{tokens.trim() ? "本轮手动覆盖：" + tokens + " token" : typeof inheritedTokens === "number" ? "沿用模型预设：" + inheritedTokens + " token" : "未显式设置，使用适配器 / 服务默认值"}</p>
            <Button disabled={!tokens} onClick={() => setTokens("")}>恢复沿用预设</Button>

</div></Dialog>}
    {option==='references'&&<Dialog title="引用内容与修改目标" onClose={()=>setOption(null)} wide>
            <div>
              <h3>上下文与修改目标 · {shotIds.length} 镜头 / {entityIds.length} 实体 / {assets.length} 素材</h3>
              <div className="form-stack">
                <Field label="目标剧本">
                  <select value={scriptId} onChange={e => {
                    setScript(e.target.value);
                    setShots([]);
                  }}>
                    <option value="">不指定现有剧本</option>
                    {creation.data?.scripts.map(s => <option value={s.id} key={s.id}>{s.title} · v{s.revision}</option>)}
                  </select>
                </Field>
                {creation.data?.shots.filter(s => !scriptId || s.scriptId === scriptId).map(s => <label className="check" key={s.id}><input type="checkbox" checked={shotIds.includes(s.id)} onChange={e => setShots(e.target.checked ? [...shotIds, s.id] : shotIds.filter(id => id !== s.id))} />上下文镜头 {s.title} · v{s.revision}</label>)}
                {creation.data?.entities.map(e => <label className="check" key={e.id}><input type="checkbox" checked={entityIds.includes(e.id)} onChange={event => setEntities(event.target.checked ? [...entityIds, e.id] : entityIds.filter(id => id !== e.id))} />上下文实体 {e.name} · v{e.revision}</label>)}
                <AssetPicker value={assets} onChange={setAssets} max={8} />
                <p className="hint">文本原件按预算提取；图片和视频仅发送元数据。模型未读取画面。不同剧本镜头不能混选。</p>
              </div>
            </div>
</Dialog>}
    {option==='mode'&&<Dialog title="创作模式" onClose={()=>setOption(null)}><p>当前会话：{session.data?modes[session.data.mode]:modes[mode]}。模式在创建会话时固定，切换请新建会话，原会话保留。</p><Button onClick={()=>{setOption(null);if(sessionList.current)sessionList.current.open=true;requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('[aria-label="新会话名称"]')?.focus());}}>创建另一种模式的会话</Button></Dialog>}
    {task && <TaskDetail taskId={task} onClose={() => setTask(null)} />}
  </section>;
}
function AgentRunCard({
  run,
  messages,
  onApprove,
  onTask,
  onCreation
}: {
  run: AgentRunView;
  messages: AgentMessage[];
  onApprove(): void;
  onTask(id: string): void;
  onCreation(): void; onOpenConversation?():void;
}) {
  const runtime = useRuntime();
  const draft = run.proposal?.draft;
  const [shotKeys, setShots] = useState<string[] | null>(null);
  const [entityKeys, setEntities] = useState<string[] | null>(null);
  const [includeScript, setScript] = useState<boolean | null>(null);
  const selectedShots = run.action?.acceptedShotKeys ?? shotKeys ?? draft?.shots.map(shot => shot.key) ?? [];
  const selectedEntities = run.action?.acceptedEntityKeys ?? entityKeys ?? draft?.entities.map(entity => entity.key) ?? [];
  const withScript = run.action?.includeScript ?? includeScript ?? Boolean(draft?.script);
  const dependencies = draft?.shots.filter(shot => selectedShots.includes(shot.key));
  const locked = runtime.busy || runtime.pending || !runtime.online;
  const comparisons = draft && run.state === 'PROPOSED' ? buildProposalDiffs(run.prepared.targets, draft, {
    includeScript: withScript,
    selectedShotKeys: selectedShots,
    selectedEntityKeys: selectedEntities
  }) : [];
  return <article className="creation-card agent-run">
    <p className="agent-user-message">{run.prepared.message}</p>
    <div className="agent-author"><img src={mascot} alt=""/><strong>羊番</strong><Badge warning={['INVALID', 'FAILED', 'UNKNOWN'].includes(run.state)}>{stateNames[run.state]}</Badge></div>
    <p className="hint">{run.prepared.template.name} · {run.prepared.generation.config.model.name} · {new Date(run.prepared.createdAt).toLocaleString('zh-CN')}</p>
    {run.errorCode && <p role="alert" className="alert">
      {run.errorCode}。{run.state === 'INVALID' ? '原响应已保留，未修改创作内容。请调整需求后发起新轮次。' : !run.harvested ? '原任务保留。先检查原任务或本地原件；系统不会重发规划请求。' : '请查看原任务详情。'}
    </p>}
    {run.task && <Button tone="quiet" onClick={() => onTask(run.task!.taskId)}>查看规划原任务</Button>}
    {run.state === 'PREPARED' && <Button disabled={locked} onClick={onApprove}>继续批准规划</Button>}
    {!run.stopped && run.state !== 'ACCEPTED' && <Button tone="quiet" disabled={locked} onClick={() => void runtime.command('agent.stop', {
      runId: run.runId,
      executionOwner: run.prepared.executionOwner
    })}>停止本轮</Button>}
    {messages.length ? messages.map((message, index) => <p className="agent-reply" key={`${message.createdAt}:${index}`}>{message.text}</p>) : draft && <p className="agent-reply">{draft.reply}</p>}
    {draft && <>
      {run.action && <p className="hint">以下保留原提案，实际采用范围与修订以采用回执为准。</p>}
      {draft.script && <section className="proposal-script">
        <label className="check">
          <input type="checkbox" disabled={run.state !== 'PROPOSED'} checked={withScript} onChange={event => setScript(event.target.checked)} />
          采用剧本：{draft.script.title}
        </label>
        <p>{run.prepared.targets.script ? `更新 ${run.prepared.targets.script.title} v${run.prepared.targets.script.revision} → 新修订` : '新增剧本'}</p>
        <p>{draft.script.synopsis}</p>
        <details>
          <summary>剧本正文与场景</summary>
          <pre>{draft.script.body}</pre>
          {draft.script.scenes.map(scene => <p key={scene.key}>{scene.title} · {scene.location} · {scene.time} · {scene.description}</p>)}
        </details>
        <ProposalDiff comparison={comparisons.find(comparison => comparison.key === 'script')} />
      </section>}
      {draft.entities.map(entity => <section className="proposal-entity" key={entity.key}>
        <label className="check">
          <input type="checkbox" disabled={run.state !== 'PROPOSED'} checked={selectedEntities.includes(entity.key)} onChange={event => setEntities(event.target.checked ? [...selectedEntities, entity.key] : selectedEntities.filter(key => key !== entity.key))} />
          采用实体：{entity.name}
        </label>
        <p>{run.prepared.targets.entities.some(target => target.key === entity.key) ? `更新固定目标 v${run.prepared.targets.entities.find(target => target.key === entity.key)!.value.revision}` : '新增实体'} · {{
          character: '角色',
          scene: '场景设定',
          prop: '道具',
          style: '风格'
        }[entity.kind]}</p>
        <p>{entity.description}</p>
        <p>约束：{entity.constraints || '无'}</p>
        <p>固定素材：{entity.assetKeys.join('、') || '无'}</p>
        <ProposalDiff comparison={comparisons.find(comparison => comparison.key === `entity:${entity.key}`)} />
      </section>)}
      {draft.shots.map(shot => <section className="proposal-shot" key={shot.key}>
        <label className="check">
          <input type="checkbox" aria-label={`采用镜头 ${shot.title}`} disabled={run.state !== 'PROPOSED'} checked={selectedShots.includes(shot.key)} onChange={event => setShots(event.target.checked ? [...selectedShots, shot.key] : selectedShots.filter(key => key !== shot.key))} />
          <strong>{shot.title}</strong>
        </label>
        <p>{run.prepared.targets.shots.some(target => target.key === shot.key) ? `更新镜头 v${run.prepared.targets.shots.find(target => target.key === shot.key)!.value.revision}` : '新增镜头'} · {shot.durationSeconds}秒 · {shot.shotSize} · {shot.cameraMovement} · {shot.aspectRatio}</p>
        <p>{shot.subject} · {shot.action}</p>
        <p>台词：{shot.dialogue || '无'} · 声音：{shot.sound || '无'}</p>
        <details>
          <summary>提示词与依赖</summary>
          <pre>{shot.prompt}</pre>
          <p>场景 {shot.sceneKey} · 实体 {shot.entityKeys.join('、') || '无'}</p>
        </details>
        <ProposalDiff comparison={comparisons.find(comparison => comparison.key === `shot:${shot.key}`)} />
      </section>)}
      {run.state === 'PROPOSED' && <div className="form-stack">
        <p>选择 {selectedShots.length} 个镜头。必需场景：{[...new Set(dependencies?.map(shot => shot.sceneKey))].join('、') || '无'}；实体：{[...new Set(dependencies?.flatMap(shot => shot.entityKeys))].join('、') || '无'}。引擎会纳入所选镜头的必要依赖。</p>
        <p className="hint">采用有效期至 {new Date(run.proposal!.expiresAt).toLocaleTimeString('zh-CN')}。版本冲突时保留提案，不覆盖人工编辑；重新选择上下文并发起新轮次。</p>
        <Button tone="primary" disabled={locked || Date.now() > run.proposal!.expiresAt} onClick={() => void runtime.command('agent.acceptProposal', {
          runId: run.runId,
          projectId: run.projectId,
          executionOwner: run.prepared.executionOwner,
          proposalHash: run.proposal!.proposalHash,
          selectedShotKeys: selectedShots,
          selectedEntityKeys: selectedEntities,
          includeScript: withScript
        })}>采用所选提案</Button>
      </div>}
    </>}
    {run.action && <div className="approval-summary">
      <h3>采用已确认</h3>
      <p>{run.action.result.shots.length} 镜头 · {run.action.result.entities.length} 实体 · {run.action.result.scripts.length} 剧本修订</p>
      <p>本轮未采用镜头：{run.action.skippedShotKeys.join('、') || '无'}。每轮仅采用一次；剩余内容需新轮次。</p>
      <Button onClick={onCreation}>查看已采用内容</Button>
    </div>}
    <details>
      <summary>上下文版本清单</summary>
      <p>{run.prepared.context.notice}</p>
      {run.prepared.context.sources.map((source, index) => <p key={index}>{source.kind} · {source.id} v{source.revision} · {source.key}</p>)}
      <p>省略：{run.prepared.context.omitted.join('；') || '无'}</p>
    </details>
  </article>;
}
