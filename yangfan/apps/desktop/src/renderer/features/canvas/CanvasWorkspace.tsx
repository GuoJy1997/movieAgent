import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, MiniMap, type ReactFlowInstance, type Connection, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  CanvasContent,
  CanvasNodeView,
  CanvasOperation,
} from '../../../../../../packages/contracts/src/canvas.ts';
import { CanvasCard, freshnessLabels, type StudioNode } from './CanvasCard.tsx';
import { WorkflowApproval } from './WorkflowApproval.tsx';
import { WorkflowPanel } from './WorkflowPanel.tsx';
import { GraphConnections } from './GraphConnections.tsx';
import { GenerationInputs } from './GenerationInputs.tsx';
import { NodeParameters } from './NodeParameters.tsx';
import type { PreparedWorkflow } from '../../../../../../packages/contracts/src/workflows.ts';
import type { PreparedGeneration } from '../../../../../../packages/contracts/src/generation.ts';
import type { ProjectRef } from '../../../../../../packages/contracts/src/projects.ts';
import { Badge, Button, Empty, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { nextCanvasLayout } from '../../state/canvas-layout.ts';
import { draftKey, useCanvasDraft } from '../../state/canvas-draft.ts';
import { MediaPreview } from '../assets/MediaPreview.tsx';
import { taskLabel } from '../tasks/task-labels.ts';
import { TaskDetail } from '../tasks/TaskDetail.tsx';
import { GenerationApproval } from './GenerationApproval.tsx';
import { outputSoundSourceLabel } from '../creation/shot-output-presentation.ts';
import { timelineNavigate } from '../../state/DraftNavigationGuard.tsx';

import {Dialog} from '../../../../../../packages/ui/src/overlays.tsx';
import {EntityEditor} from '../entities/EntityWorkspace.tsx';
import {AssetLibrary} from '../assets/AssetLibrary.tsx';
import {CanvasIcon} from './CanvasIcon.tsx';
import {CanvasStarter,CanvasToolsDialog} from './CanvasGuide.tsx';
import {CanvasViewport} from './CanvasViewport.tsx';
import {canvasProfiles} from './canvas-tools.ts';
import './canvas-guide.css';
const nodeTypes = { studio: CanvasCard };
export function CanvasWorkspace({ project,canvasId=project.id, onEditShot, onOpenDialogue, onConfigure }: { project: ProjectRef;canvasId?:string; onEditShot?(id:string):void; onOpenDialogue?(id: string): void; onConfigure?():void }) {
  const runtime = useRuntime(),
    query = useWorkspaceQuery('canvas.read', { canvasId }),
    voices = useWorkspaceQuery('voice.list',{projectId:project.id}),
    creation = useWorkspaceQuery('creation.read', { projectId: project.id }),
    profiles = useWorkspaceQuery('profile.list', {}),
    models = useWorkspaceQuery('model.list', {}),
    assets = useWorkspaceQuery('asset.search', {state:'active',latestOnly:false});
  // Local edits belong to stable library/canvas/node incarnations. Network
  // queries and commands remain scoped by connectionEpoch in RuntimeProvider.
  const scope = JSON.stringify([project.libraryId, project.id,canvasId]);
  const state = useCanvasDraft(),
    local = state.scopes[scope],
    drafts = local?.drafts;
  const [voiceChoice,setVoiceChoice]=useState('');
  const [selection,setSelection]=useState<string[]>([]),[plan,setPlan]=useState<PreparedWorkflow|null>(null);
  const [measurements,setMeasurements]=useState<Record<string,StudioNode['measured']>>({});
  const [prepared, setPrepared] = useState<PreparedGeneration | null>(null),
    [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<string[]>([]),
    [redo, setRedo] = useState<string[]>([]),
    [history, setHistory] = useState(false),[traceTask,setTraceTask]=useState<string|null>(null);
  const [dialog,setDialog]=useState<'add'|'tools'|'assets'|'voice'|'character'|'scene'|null>(null);
  const [showGuide,setShowGuide]=useState(false),[hideIntro,setHideIntro]=useState(false),[showWorkflow,setShowWorkflow]=useState(false);
  const [minimap,setMinimap]=useState(false),[showEdges,setShowEdges]=useState(true),[adding,setAdding]=useState(false);
  const [flow,setFlow]=useState<ReactFlowInstance<StudioNode>|null>(null),[newNodeId,setNewNodeId]=useState<string|null>(null);
  useEffect(()=>{if(flow&&newNodeId&&query.data?.nodes.some(n=>n.nodeId===newNodeId)){void flow.fitView({nodes:[{id:newNodeId}],padding:0.4,maxZoom:1});setNewNodeId(null);}},[flow,newNodeId,query.data]);
  const locked = adding || !runtime.online || runtime.busy || runtime.pending || !query.data;
  const savedNode = query.data?.nodes.find((n) => n.nodeId === local?.selected);
  const hasIncomingEdges = Boolean(savedNode && query.data?.edges.some(edge=>edge.targetNodeId===savedNode.nodeId));
  const draft = savedNode ? drafts?.[draftKey(savedNode)] : undefined;
  const content = draft?.content ?? savedNode?.content;
  const draftConflict = draft && savedNode && (
    Boolean(draft.content && draft.base.semanticRevision !== savedNode.semanticRevision) ||
    Boolean(draft.layout && draft.base.layoutRevision !== savedNode.layoutRevision)
  );
  const detachedDrafts = query.data ? Object.entries(drafts ?? {}).filter(([key]) => !query.data.nodes.some(n => draftKey(n) === key)) : [];
  const modelFor=(n:CanvasNodeView)=>{if(n.content.type!=='generation')return undefined;const ref=n.content.profileRef;const p=profiles.data?.profiles.find(p=>p.id===ref.id&&p.revision===ref.revision);return models.data?.models.find(m=>m.id===p?.modelRef.id&&m.revision===p?.modelRef.revision);};
  const labelFor=(n:CanvasNodeView)=>`${n.content.type==='generation'?(modelFor(n)?.name??'生成'):n.content.type==='text'?'文本输入':'固定媒体'} · ${query.data!.nodes.indexOf(n)+1}`;
  const nodes = useMemo<StudioNode[]>(
    () =>
      query.data?.nodes.map((n) => ({
        id: n.nodeId,
        type: 'studio',
        position: drafts?.[draftKey(n)]?.layout ?? n.layout,
        measured: measurements[n.nodeId],
        selected: selection.includes(n.nodeId),
        data: {
          node: { ...n, content: drafts?.[draftKey(n)]?.content ?? n.content },
          dirty: Boolean(drafts?.[draftKey(n)]),
          label: labelFor(n),
          outputKind: n.content.type==='text'?'text':modelFor(n)?.capabilities.outputKinds[0]??'固定媒体',
          soundSource: n.shotBinding?.role === 'video' && n.selectedOutput ? outputSoundSourceLabel(n.selectedOutput, creation.data?.selections.find(selection => selection.shotId === n.shotBinding!.shotId)) : undefined,
          onOpenDialogue: n.shotBinding?.role === 'video' ? () => timelineNavigate(() => (onOpenDialogue ?? onEditShot)?.(n.shotBinding!.shotId)) : undefined,
          inputPorts: n.content.type==='generation'&&(modelFor(n)?.capabilities.inputKinds as readonly string[]|undefined)?.includes('audio')?['prompt','reference','voice_reference']:n.content.type!=='generation'?[]:(modelFor(n)?.capabilities.inputKinds as readonly string[]|undefined)?.includes('image') ? modelFor(n)?.capabilities.outputKinds[0]==='video'?['prompt','reference','first_frame','last_frame']:['prompt','reference']:['prompt'],
        },
      })) ?? [],
    [query.data, drafts, local?.selected, selection, profiles.data, models.data, measurements, creation.data, onOpenDialogue, onEditShot],
  );
  async function apply(operations: CanvasOperation[]) {
    if (!query.data) return;
    const result = await runtime.command('canvas.applyCommand', {
      canvasId,
      baseRevision: query.data.revision,
      operations,
    });
    if (result) {
      setUndo((current) => [...current, result.commandId]);
      setRedo([]);
      for (const operation of operations) {
        const original = query.data.nodes.find((n) => n.nodeId === ('nodeId' in operation ? operation.nodeId : ''));
        if (original && (operation.kind === 'setContent' || operation.kind === 'setLayout'))
          state.ack(scope, original, operation.kind === 'setContent' ? 'content' : 'layout', operation.kind === 'setContent' ? operation.content : operation.layout);
      }
      setNotice(result.skipped.length ? `部分字段保留较新编辑：${result.skipped.join('、')}` : '');
    }
    return result;
  }
  async function createContent(content:CanvasContent) {
    if(locked||!query.data)return false;
    setAdding(true);
    const nodeId=crypto.randomUUID();
    try {const result=await apply([{kind:'create',nodeId,content,layout:nextCanvasLayout(query.data.nodes)}]);
      if(!result)return false;
      state.select(scope,nodeId);setSelection([nodeId]);setNewNodeId(nodeId);setShowGuide(false);setHideIntro(true);setHistory(false);setShowWorkflow(false);
      setNotice(content.type==='text'?'已添加文本。下一步：在右侧写下想法并保存。':'节点已创建。下一步：检查右侧提示词和参考，再准备生成。');return true;
    } finally {setAdding(false);}
  }
  async function add(type:'text'|'generation') {
    const profile=profiles.data?.profiles[0];
    if(type==='text')return createContent({type:'text',text:''});
    if(!profile)return false;
    return createContent({type:'generation',prompt:'',profileRef:{libraryId:profile.libraryId,id:profile.id,revision:profile.revision},inputs:[]});
  }
  async function addVisual(kind:'image'|'video') {
    const profile=canvasProfiles(profiles.data?.profiles??[],models.data?.models??[],kind,false)[0];if(!profile)return;
    if(await createContent({type:'generation',prompt:'',profileRef:{libraryId:profile.libraryId,id:profile.id,revision:profile.revision},inputs:[]}))setDialog(null);
  }
  function changes(changes: NodeChange<StudioNode>[]) {
    const dimensions=changes.filter(change=>change.type==='dimensions');
    if(dimensions.length)setMeasurements(current=>{
      let next=current;
      for(const change of dimensions)if(change.dimensions&&(current[change.id]?.width!==change.dimensions.width||current[change.id]?.height!==change.dimensions.height))next={...next,[change.id]:change.dimensions};
      return next;
    });
    for (const change of changes)
      if (change.type === 'position' && change.position) {
        const node = query.data?.nodes.find((n) => n.nodeId === change.id);
        if (node) state.edit(scope, node, { layout: change.position });
      } else if(change.type==='select') {
        setSelection(current=>change.selected?[...new Set([...current,change.id])]:current.filter(id=>id!==change.id));
        if(change.selected)state.select(scope,change.id);
        else if(useCanvasDraft.getState().scopes[scope]?.selected===change.id)state.select(scope,null);
      }
  }
  async function connect(connection: Connection) {
    const source=query.data?.nodes.find(n=>n.nodeId===connection.source),target=query.data?.nodes.find(n=>n.nodeId===connection.target);
    if(!source||!target)return;
    await apply([{kind:'addEdge',edge:{id:crypto.randomUUID(),sourceNodeId:source.nodeId,sourceIncarnation:source.incarnation,targetNodeId:target.nodeId,targetIncarnation:target.incarnation,sourcePort:'output',targetPort:(connection.targetHandle??'prompt') as 'prompt'|'reference'|'first_frame'|'last_frame'|'voice_reference'}}]);
  }
  async function prepareWorkflow(mode:'current'|'upstream'|'selection') {
    if(!savedNode)return;
    const p=await runtime.command('workflow.prepare',{canvasId,mode,nodeIds:mode==='selection'?selection:[savedNode.nodeId],executionOwner:'human',runId:crypto.randomUUID()});if(p)setPlan(p);
  }

  async function saveContent(useLatest = false) {
    if (!savedNode || !draft?.content) return;
    const base = useLatest ? savedNode : draft.base;
    await apply([
      {
        kind: 'setContent',
        nodeId: base.nodeId,
        incarnation: base.incarnation,
        expectedRevision: base.semanticRevision,
        content: draft.content,
      },
    ]);
  }
  async function saveLayout() {
    const operations: CanvasOperation[] = Object.values(drafts ?? {})
      .filter((d) => d.layout)
      .map((d) => ({
        kind: 'setLayout',
        nodeId: d.base.nodeId,
        incarnation: d.base.incarnation,
        expectedRevision: d.base.layoutRevision,
        layout: d.layout!,
      }));
    if (operations.length) await apply(operations);
  }
  async function invert(isRedo: boolean) {
    const stack = isRedo ? redo : undo,
      commandId = stack.at(-1);
    if (!query.data || !commandId) return;
    const result = await runtime.command('canvas.applyCommand', {
      canvasId,
      baseRevision: query.data.revision,
      undoCommandId: commandId,
    });
    if (result) {
      (isRedo ? setRedo : setUndo)((current) => current.slice(0, -1));
      (isRedo ? setUndo : setRedo)((current) => [...current, result.commandId]);
      setNotice(
        result.skipped.length
          ? `部分撤销：保留较新字段 ${result.skipped.join('、')}`
          : '已保存撤销操作；生成费用不受影响。',
      );
    }
  }
  const dirtyCount = Object.keys(drafts ?? {}).length;
  const candidateReference=savedNode&&('media' in savedNode.content?savedNode.content.media:savedNode.selectedOutput);
  const selectedReference=candidateReference&&(assets.data?.assets.some(a=>!a.deletedAt&&a.mime.startsWith('image/')&&JSON.stringify(a.ref)===JSON.stringify(candidateReference))||candidateReference.kind==='artifact'&&savedNode?.content.type==='generation'&&modelFor(savedNode)?.capabilities.outputKinds[0]==='image')?candidateReference:undefined;
  const guideOpen=!!query.data&&((!query.data.nodes.length&&!hideIntro)||showGuide);
  const entityStatus=creation.error?"角色与场景读取失败，请恢复连接后重试。":!creation.data?"正在读取角色与场景…":"";
  const toolReadiness=entityStatus||([{query:profiles,label:"模型预设"},{query:models,label:"模型能力"},{query:assets,label:"素材"}].map(({query,label})=>query.error?label+"读取失败，请恢复连接后重试。":!query.data?"正在读取"+label+"…":"").find(Boolean)??"");
  const closeDialog=()=>timelineNavigate(()=>setDialog(null));

  return (
    <section className="canvas-workspace canvas-guided">
      <div className="canvas-toolbar">
        <div className="document-title"><CanvasIcon name="layout-board"/><strong>{project.name}</strong><Badge>{query.data?query.data.nodes.length+' 个节点':'画布'}</Badge></div>
        <div className="toolbar-actions">
          <Button aria-label="撤销" title="撤销" disabled={locked||!undo.length||!!dirtyCount} onClick={()=>void invert(false)}><CanvasIcon name="arrow-back-up" size={18}/></Button>
          <Button aria-label="重做" title="重做" disabled={locked||!redo.length||!!dirtyCount} onClick={()=>void invert(true)}><CanvasIcon name="arrow-forward-up" size={18}/></Button>
          <Button disabled={locked||!Object.values(drafts??{}).some(d=>d.layout)} onClick={()=>void saveLayout()}><CanvasIcon name="device-floppy" size={16}/>保存布局</Button>
          <Button aria-pressed={history} onClick={()=>setHistory(!history)}><CanvasIcon name="history" size={16}/>输出历史</Button>
        </div>
      </div>
      <div className="canvas-body">
        <div className="canvas-stage">
          <QueryState loading={query.isLoading} error={query.error} />
          <ReactFlow<StudioNode>
            nodes={nodes}
            onInit={setFlow}
            onPaneContextMenu={event=>{event.preventDefault();setDialog('add');}}
            nodeTypes={nodeTypes}
            onNodesChange={changes}
            onPaneClick={event => {state.select(scope, null);setSelection([]);if(event.detail===2)setDialog('add');}}
            nodesDraggable={!locked}
            edges={(query.data?.edges??[]).map(e=>({id:e.id,hidden:!showEdges,source:e.sourceNodeId,target:e.targetNodeId,sourceHandle:'output',targetHandle:e.targetPort,label:({prompt:'提示词',reference:'参考图',first_frame:'首帧',last_frame:'尾帧',voice_reference:'声音参考'} as const)[e.targetPort],labelStyle:{fill:'#d3e8bb',fontSize:11},labelBgStyle:{fill:'#252d26',fillOpacity:0.95}}))}
            onConnect={c=>{if(!locked&&!dirtyCount)void connect(c);}}
            onNodeClick={(_e,n)=>state.select(scope,n.id)}
            fitView
            fitViewOptions={{padding:0.18,maxZoom:1}}
            selectionOnDrag
            multiSelectionKeyCode="Shift"
            nodesConnectable={!locked&&!dirtyCount}
            edgesFocusable
            deleteKeyCode={null}
            minZoom={0.25}
            maxZoom={1.8}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="#343a38" />
            {minimap&&<MiniMap position="top-right" pannable zoomable nodeColor="#326bff" maskColor="rgba(11,14,20,.7)"/>}
            <CanvasViewport minimap={minimap} showEdges={showEdges} onMinimap={()=>setMinimap(!minimap)} onEdges={()=>setShowEdges(!showEdges)}/>
          </ReactFlow>
          {guideOpen&&<CanvasStarter entities={creation.data?.entities} entityStatus={entityStatus} hasGenerated={!!query.data?.outputs.length} hasMedia={!!query.data?.nodes.some(n=>'media' in n.content||n.selectedOutput)} locked={locked} onEntity={setDialog} onAssets={()=>setDialog('assets')} onText={()=>void add('text')} onTools={()=>setDialog('tools')} onDismiss={()=>{setShowGuide(false);setHideIntro(true);}}/>}
          <div className="canvas-dock" role="toolbar" aria-label="画布工具">
            <button className="canvas-dock-add" aria-label="添加内容" title="添加文本、图片或视频节点" onClick={()=>setDialog('add')}><CanvasIcon name="plus"/><span>添加</span></button>
            <button aria-label="角色与场景" title="角色与场景" aria-pressed={guideOpen} onClick={()=>{if(guideOpen){setShowGuide(false);setHideIntro(true);}else setShowGuide(true);}}><CanvasIcon name="user"/><span>设定</span></button>
            <button aria-label="画布素材库" title="素材库与导入" onClick={()=>setDialog('assets')}><CanvasIcon name="folder"/><span>素材</span></button>
            <button aria-label="快捷工具" title="角色与场景快捷工具" onClick={()=>setDialog('tools')}><CanvasIcon name="wand"/><span>工具</span></button>
            <button aria-label="角色声音" title="添加角色声音卡片" onClick={()=>setDialog('voice')}><CanvasIcon name="volume"/><span>声音</span></button>
            <button aria-label="工作流" title="查看画布工作流" aria-pressed={showWorkflow} onClick={()=>setShowWorkflow(!showWorkflow)}><CanvasIcon name="hierarchy"/><span>工作流</span></button>
            <button aria-label="起步指引" title="重新打开起步指引" onClick={()=>setShowGuide(true)}><CanvasIcon name="help"/><span>指引</span></button>
          </div>
          <div className="canvas-save-state" role="status">
            <span className={dirtyCount ? 'dirty-dot' : 'status-dot'} />
            {dirtyCount ? `${dirtyCount} 个节点有未保存草稿` : !query.data ? query.error ? '无法确认画布保存状态' : '正在读取画布' : !runtime.online ? '离线 · 显示上次保存状态' : '所有修改已保存'}
            <span>修订 {query.data?.revision ?? '—'}</span>
          </div>
        </div>
        {(savedNode||history||showWorkflow||detachedDrafts.length>0)&&<aside className="inspector">
          <header>
            <h2>{history ? '输出历史' : '检查器'}</h2>
            <Button tone="quiet" aria-label="收起检查器" onClick={()=>{state.select(scope,null);setSelection([]);setHistory(false);setShowWorkflow(false);}}><CanvasIcon name="x" size={18}/></Button>
          </header>
          {detachedDrafts.map(([key, detached]) => (
            <div className="alert" key={key}>
              <p>原节点已删除或重建，草稿保留在原节点版本，不会覆盖当前节点。</p>
              {detached.content && <p>{detached.content.type === 'text' ? detached.content.text : detached.content.type === 'generation' ? detached.content.prompt : '固定媒体草稿'}</p>}
              {detached.layout && <p>草稿位置：{detached.layout.x}, {detached.layout.y}</p>}
              <Button tone="quiet" onClick={() => state.clear(scope, key)}>放弃旧节点草稿</Button>
            </div>
          ))}
          {savedNode&&!history&&<p className="canvas-next-step">{savedNode.content.type==='text'?'下一步：写下想法并保存，然后连接生成节点。':savedNode.content.type==='generation'?'下一步：确认提示词、参考与模型，再准备生成。':'下一步：打开快捷工具，把选中图片作为固定参考。'}</p>}
          <WorkflowPanel canvasId={canvasId} />
          {history ? (
            <div className="inspector-scroll">
              <p className="hint">历史保留原始绑定与选择原因。手动选择不会触发生成。</p>
              {query.data?.outputs.map((output) => (
                <div className="history-item" key={output.runBindingId}>
                  <div className="history-media">
                    <MediaPreview media={output.artifactRef} />
                  </div>
                  <p>
                    输入 v{output.semanticRevision} ·{' '}
                    {output.selection === 'selected' ? '最初自动选中' : '保留历史'}
                  </p>
                  <small>原因：{({current:'当前输入匹配',deleted:'原节点已删除',incarnation:'节点已重建',semantic:'输入内容已变化',run:'已有较新运行',selection:'人工选择已变化'} as const)[output.reason]}</small>
                  <details><summary>输入版本追溯</summary><p>语义 v{output.semanticRevision} · 节点 {output.nodeId} · incarnation {output.incarnation} · 运行 {output.runBindingId} · 任务 {output.taskId}</p><Button onClick={()=>setTraceTask(output.taskId)}>查看冻结输入与版本</Button></details>
                  <Button
                    disabled={locked || savedNode?.content.type !== 'generation'}
                    onClick={() =>
                      savedNode &&
                      void apply([
                        {
                          kind: 'selectOutput',
                          nodeId: savedNode.nodeId,
                          incarnation: savedNode.incarnation,
                          expectedRevision: savedNode.selectionRevision,
                          output: output.artifactRef,
                        },
                      ])
                    }
                  >
                    选择此输出
                  </Button>
                </div>
              ))}
              {!query.data?.outputs.length && (
                <Empty title="尚无生成输出">包括旧版本与已删除节点的完成结果。</Empty>
              )}
            </div>
          ) : !savedNode || !content ? (
            <Empty title="选择一个节点">编辑输入、查看版本，或选择生成结果。</Empty>
          ) : (
            <div className="inspector-scroll">
              <div className="inspector-section">
                <Badge>
                  {content.type === 'generation'
                    ? '媒体生成'
                    : content.type === 'text'
                      ? '文本输入'
                      : '固定媒体'}
                </Badge>

              </div>
              {savedNode.shotBinding&&<div className="inspector-section"><Badge>镜头绑定 · v{savedNode.shotBinding.shotRevision}</Badge><p>父剧本 v{savedNode.shotBinding.scriptRevision} · {savedNode.shotBinding.role==='image'?'图像':'视频'}</p>{(creation.data?.shots.find(s=>s.id===savedNode.shotBinding!.shotId)?.revision!==savedNode.shotBinding.shotRevision||creation.data?.scripts.find(s=>s.id===savedNode.shotBinding!.scriptId)?.revision!==savedNode.shotBinding.scriptRevision)&&<p className="warning-text">镜头或父剧本已变化，节点保留历史修订。</p>}<p>固定内容由镜头制作批次管理。</p><Button onClick={()=>onEditShot?.(savedNode.shotBinding!.shotId)}>编辑绑定镜头</Button></div>}
              {'voiceBinding' in content&&content.voiceBinding&&<section className="inspector-section"><h3>固定角色声音</h3><p>角色 {content.voiceBinding.characterRef.id} · 声音 {content.voiceBinding.voiceRef.id} v{content.voiceBinding.voiceRef.revision}</p><p>{query.data?.edges.some(e=>e.sourceNodeId===savedNode.nodeId&&e.targetPort==='voice_reference')?'已连到声音参考端口；实际绑定会在计划中显示。':'尚未连接，当前不会用于生成。请连接目标视频节点的声音参考端口。'}</p></section>}
              {content.type === 'text' && (
                <Field label="文本内容">
                  <textarea
                    rows={9}
                    maxLength={16000}
                    value={content.text}
                    onChange={(e) =>
                      state.edit(scope, savedNode, { content: { type: 'text', text: e.target.value } })
                    }
                  />
                </Field>
              )}
              {content.type === 'generation' && (
                <fieldset disabled={Boolean(savedNode.shotBinding)} style={{border:0,padding:0,minWidth:0}}>
                  <Field label="提示词">
                    <textarea
                      rows={7}
                      maxLength={16000}
                      placeholder="描述你希望生成的图片或视频…"
                      value={content.prompt}
                      onChange={(e) =>
                        state.edit(scope, savedNode, { content: { ...content, prompt: e.target.value } })
                      }
                    />
                  </Field>
                  <Field label="生成预设">
                    <select
                      value={`${content.profileRef.id}:${content.profileRef.revision}`}
                      onChange={(e) => {
                        const p = profiles.data?.profiles.find(
                          (p) => `${p.id}:${p.revision}` === e.target.value,
                        );
                        if (p)
                          state.edit(scope, savedNode, {
                            content: {
                              ...content,
                              profileRef: { id: p.id, libraryId: p.libraryId, revision: p.revision },
                            },
                          });
                      }}
                    >
                      {!profiles.data?.profiles.some(
                        (p) => p.id === content.profileRef.id && p.revision === content.profileRef.revision,
                      ) && (
                        <option value={`${content.profileRef.id}:${content.profileRef.revision}`}>
                          已选择的旧预设 v{content.profileRef.revision}
                        </option>
                      )}
                      {profiles.data?.profiles.map((p) => (
                        <option key={`${p.id}:${p.revision}`} value={`${p.id}:${p.revision}`}>
                          {p.name} · v{p.revision}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <NodeParameters key={`${savedNode.nodeId}:${content.profileRef.id}:${content.profileRef.revision}`} content={content} profiles={profiles.data?.profiles??[]} models={models.data?.models??[]} locked={locked} onChange={content=>state.edit(scope,savedNode,{content})} />
                  <GenerationInputs content={content} assets={assets.data?.assets??[]} locked={locked} onChange={content=>state.edit(scope,savedNode,{content})} />
                  <GraphConnections node={savedNode} nodes={query.data!.nodes} edges={query.data!.edges} labelFor={labelFor} disabled={locked||Boolean(dirtyCount)} onConnect={(source,targetPort)=>connect({source,target:savedNode.nodeId,sourceHandle:'output',targetHandle:targetPort})} onRemove={edgeId=>apply([{kind:'removeEdge',edgeId}])} />
                  <div className="inspector-section">
                    <h3>固定文本输入</h3>
                    <p className="hint">按选择顺序拼接。源文本修改不会改变已选版本。</p>
                    {query.data?.nodes
                      .filter((n) => n.content.type === 'text')
                      .map((n) => (
                        <label className="check" key={n.nodeId}>
                          <input
                            type="checkbox"
                            checked={content.inputs.some((i) => i.nodeId === n.nodeId)}
                            onChange={(e) =>
                              state.edit(scope, savedNode, {
                                content: {
                                  ...content,
                                  inputs: e.target.checked
                                    ? [
                                        ...content.inputs,
                                        {
                                          nodeId: n.nodeId,
                                          incarnation: n.incarnation,
                                          semanticRevision: n.semanticRevision,
                                        },
                                      ]
                                    : content.inputs.filter((i) => i.nodeId !== n.nodeId),
                                },
                              })
                            }
                          />
                          {n.content.type === 'text' ? n.content.text.slice(0, 45) || '空文本' : ''} · v
                          {content.inputs.find((i) => i.nodeId === n.nodeId)?.semanticRevision ??
                            n.semanticRevision}
                        </label>
                      ))}
                    {content.inputs.map((input, i) => (
                      <small className="fixed-input" key={`${input.nodeId}:${i}`}>
                        {i + 1}. 固定文本 v{input.semanticRevision}
                        <Button
                          tone="quiet"
                          aria-label={`移除固定输入 ${i + 1}`}
                          onClick={() =>
                            state.edit(scope, savedNode, {
                              content: {
                                ...content,
                                inputs: content.inputs.filter((_, index) => index !== i),
                              },
                            })
                          }
                        >
                          ×
                        </Button>
                      </small>
                    ))}
                  </div>
                </fieldset>
              )}
              {'media' in content && (
                <div className="inspector-media">
                  <MediaPreview media={content.media} original />
                </div>
              )}
              {content.type !== 'image' && (
                <Button
                  tone="primary"
                  disabled={locked || !draft?.content}
                  onClick={() => void saveContent()}
                >
                  保存内容
                </Button>
              )}
              {(draftConflict || runtime.error?.code === 'CANVAS_CONFLICT') && (
                <div className="alert">
                  <p>草稿与当前版本冲突。先刷新查看，再明确重试。</p>
                  {Object.entries(runtime.error?.fieldErrors ?? {}).map(([field, text]) => (
                    <p key={field}>
                      {field}: {text}
                    </p>
                  ))}
                  <Button onClick={() => void runtime.refresh()}>刷新当前版本</Button>
                  <Button disabled={locked || !draft?.content} onClick={() => void saveContent(true)}>
                    以最新版本重试我的草稿
                  </Button>
                </div>
              )}
              {draft && (
                <Button tone="quiet" onClick={() => state.clear(scope, draftKey(savedNode))}>
                  放弃此节点草稿
                </Button>
              )}
              {content.type === 'generation' && !savedNode.shotBinding && (
                <div className="inspector-section generation-actions">
                  <p>{freshnessLabels[savedNode.freshness ?? 'none']}</p>
                  {savedNode.freshness==='stale'&&<p className="hint">当前文本、连线、模型或固定输入版本已变化，历史输出保留。</p>}
                  <Button disabled={locked||Boolean(dirtyCount)} onClick={()=>void prepareWorkflow('current')}>运行当前节点</Button>
                  <Button disabled={locked||Boolean(dirtyCount)} onClick={()=>void prepareWorkflow('upstream')}>运行所需上游</Button>
                  <Button disabled={locked||Boolean(dirtyCount)||!selection.length} onClick={()=>void prepareWorkflow('selection')}>运行选定子图</Button>
                  <details><summary>执行选择 · {selection.length} 个节点</summary>{query.data?.nodes.map(n=><label className="check" key={n.nodeId}><input type="checkbox" aria-label={`选入执行 ${labelFor(n)}`} checked={selection.includes(n.nodeId)} onChange={e=>setSelection(current=>e.target.checked?[...new Set([...current,n.nodeId])]:current.filter(id=>id!==n.nodeId))}/>{labelFor(n)}</label>)}</details>
                  <p className="hint">Shift 多选 · 当前/选定范围外的生成输入必须先明确选择固定输出。所需上游会重新执行。</p>
                  {savedNode.activeTask && <Badge>{taskLabel[savedNode.activeTask.state]}</Badge>}
                  <Button
                    tone="primary"
                    disabled={locked || Boolean(draft) || hasIncomingEdges || (!content.prompt.trim() && !content.inputs.length)}
                    onClick={async () => {
                      if(hasIncomingEdges)return;
                      const p = await runtime.command('generation.prepare', {
                        projectId: project.id,
                        canvasNode: { canvasId, nodeId: savedNode.nodeId },
                        executionOwner: 'human',
                        runId: crypto.randomUUID(),
                      });
                      if (p) setPrepared(p);
                    }}
                  >
                    准备生成
                  </Button>
                  <p className="hint">{hasIncomingEdges?'连线输入请使用“运行当前节点”或工作流范围预览。':'下一步确认提示词、模型和费用后生成。'}</p>
                  <Field label="手动选择固定输出"><select disabled={locked} value="" onChange={e=>{if(e.target.value)void apply([{kind:'selectOutput',nodeId:savedNode.nodeId,incarnation:savedNode.incarnation,expectedRevision:savedNode.selectionRevision,output:JSON.parse(e.target.value)}]);}}><option value="">选择资产固定版本（不触发生成）</option>{assets.data?.assets.filter(a=>!a.deletedAt).map(a=><option key={`${a.ref.assetId}:${a.ref.version}`} value={JSON.stringify(a.ref)}>{a.name} · v{a.ref.version} · {a.mime}</option>)}</select></Field>
                  {savedNode.selectedOutput && (
                    <Button
                      disabled={locked}
                      onClick={() =>
                        void apply([
                          {
                            kind: 'selectOutput',
                            nodeId: savedNode.nodeId,
                            incarnation: savedNode.incarnation,
                            expectedRevision: savedNode.selectionRevision,
                            output: null,
                          },
                        ])
                      }
                    >
                      清除输出选择
                    </Button>
                  )}
                </div>
              )}
              <div className="inspector-section">
                <Button
                  tone="danger"
                  disabled={locked || Boolean(draft)}
                  onClick={async () => {
                    if (
                      await apply([
                        {
                          kind: 'delete',
                          nodeId: savedNode.nodeId,
                          incarnation: savedNode.incarnation,
                          expectedSemanticRevision: savedNode.semanticRevision,
                          expectedLayoutRevision: savedNode.layoutRevision,
                          expectedSelectionRevision: savedNode.selectionRevision,
                          expectedRunBindingId: savedNode.activeRunBindingId,
                        },
                      ])
                    )
                      state.select(scope, null);
                  }}
                >
                  删除节点
                </Button>
                <p className="hint">可撤销。删除节点不会取消供应方任务。</p>
              </div>
            </div>
          )}
        </aside>}
      </div>
      {notice && (
        <div className="canvas-notice" role="status">
          {notice}
        </div>
      )}
      {(dialog==='character'||dialog==='scene')&&<Dialog title={dialog==='character'?'创建角色':'创建场景'} onClose={closeDialog} wide><p className="canvas-tools-intro">先把设定保存到本集。需要形象图片时，再从快捷工具创建生成节点。</p><EntityEditor projectId={project.id} initial={null} initialKind={dialog} onSaved={entity=>{setDialog(null);setNotice('「'+entity.name+'」设定已保存。下一步：从快捷工具制作'+(entity.kind==='character'?'角色形象':'场景画面')+'。');}}/></Dialog>}
      {dialog==='assets'&&<Dialog title="画布素材库" onClose={closeDialog} wide><AssetLibrary canvasId={canvasId} onPlace={()=>{setDialog(null);setHideIntro(true);setShowGuide(false);setNotice('素材已放入画布。选择图片后，可使用快捷工具继续创作。');}}/></Dialog>}
      {dialog==='tools'&&<CanvasToolsDialog scope={scope} readiness={toolReadiness} profiles={profiles.data?.profiles??[]} models={models.data?.models??[]} assets={assets.data?.assets??[]} entities={creation.data?.entities??[]} selectedReference={selectedReference} locked={!!locked} onCreate={createContent} onClose={()=>setDialog(null)} onConfigure={onConfigure?()=>timelineNavigate(onConfigure):undefined}/>}
      {dialog==='add'&&<Dialog title="添加到画布" onClose={()=>setDialog(null)}><div className="canvas-add-options"><Button disabled={locked} onClick={async()=>{if(await add('text'))setDialog(null);}}><CanvasIcon name="text-size"/>添加文本<span>写想法、提示词或镜头说明</span></Button>{(['image','video'] as const).map(kind=>{const enabled=canvasProfiles(profiles.data?.profiles??[],models.data?.models??[],kind,false).length>0;return <Button key={kind} disabled={locked||!enabled} onClick={()=>void addVisual(kind)}><CanvasIcon name={kind==='image'?'photo':'video'}/>{kind==='image'?'添加图片生成':'添加视频生成'}<span>{enabled?'创建后填写要求，再确认生成':'先配置'+(kind==='image'?'文生图':'文生视频')+'预设'}</span></Button>;})}<Button disabled={locked||!profiles.data?.profiles.length} onClick={async()=>{if(await add('generation'))setDialog(null);}}><CanvasIcon name="layout-board"/>添加生成节点<span>使用现有预设，支持其他生成类型</span></Button>{onConfigure&&<Button tone="quiet" onClick={()=>timelineNavigate(onConfigure)}>配置生成模型</Button>}</div><p className="hint">也可以双击或右键空白处打开此面板。</p></Dialog>}
      {dialog==='voice'&&<Dialog title="角色声音" onClose={()=>setDialog(null)}><div className="form-stack"><p>选择已就绪的声音档案，放入画布后连接视频节点的声音参考端口。</p><Field label="选择角色声音卡片"><select value={voiceChoice} onChange={e=>setVoiceChoice(e.target.value)}><option value="">选择固定角色声音</option>{voices.data?.voices.filter(v=>v.production.ready&&!v.archived).map(v=><option key={v.id} value={v.id}>{v.name} · v{v.revision}</option>)}</select></Field>{!voices.data?.voices.some(v=>v.production.ready&&!v.archived)&&<p className="hint">暂时没有可用声音。请先在「资产 → 角色与场景」建立角色声音档案。</p>}<Button disabled={locked||!voiceChoice} onClick={async()=>{const voice=voices.data?.voices.find(v=>v.id===voiceChoice),reference=voice?.videoReference??voice?.reference;if(!voice||!reference)return;if(await createContent({type:'media',media:reference.ref,voiceBinding:{characterRef:{id:voice.entityRef.id,revision:creation.data?.entities.find(e=>e.id===voice.entityRef.id)?.revision??voice.entityRef.revision},voiceRef:{id:voice.id,revision:voice.revision}}}))setDialog(null);}}>添加角色声音卡片</Button></div></Dialog>}
      {traceTask&&<TaskDetail taskId={traceTask} onClose={()=>setTraceTask(null)}/>}
      {plan&&<WorkflowApproval plan={plan} onClose={()=>setPlan(null)}/>}
      {prepared && <GenerationApproval prepared={prepared} onClose={() => setPrepared(null)} />}
    </section>
  );
}
