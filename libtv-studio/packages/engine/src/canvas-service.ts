import {voiceInputResolver} from './voice-input-resolver.ts';
import { validateGraph, graphInputSnapshot, type GraphType } from '../../domain/src/graph-plan.ts';
import type { ModelDefinition, ModelProfile, ProviderConnection } from '../../contracts/src/models.ts';
import type { assetsFor } from './asset-service.ts';
import { randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import { isCanvasSnapshot, type CanvasEdge, type CanvasCommand, type CanvasCommit, type CanvasContent, type CanvasInputOwnership, type CanvasNode, type CanvasOperation, type CanvasOutput, type CanvasSnapshot, type RunBinding } from '../../contracts/src/canvas.ts';
import type { MediaReference } from '../../contracts/src/assets.ts';
import type { PreparedGeneration, PrepareCanvasGenerationInput, PrepareInlineGenerationInput, TaskRef, TaskView } from '../../contracts/src/generation.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { canvasConflict, checkCanvasOperation, type CanvasInverse } from '../../domain/src/canvas-command.ts';
import { outputFreshness } from '../../domain/src/run-binding.ts';
import type { ShotBinding } from '../../contracts/src/shot-production.ts';

/** All mutation helpers are synchronous and join the caller's receipt/publication transaction. */
export function canvasFor(library: LibraryHandle, assets?: ReturnType<typeof assetsFor>) {
  function canvas(canvasId: string) {
    return library.db.prepare('SELECT * FROM canvas WHERE id=? AND library_id=?').get(canvasId, library.libraryId);
  }
  function row(canvasId: string, nodeId: string) {
    return library.db.prepare('SELECT * FROM canvas_node WHERE canvas_id=? AND node_id=?').get(canvasId, nodeId);
  }
  function currentNode(canvasId: string, nodeId: string): CanvasNode | null {
    const found = row(canvasId, nodeId);
    return found && found.deleted === 0 ? JSON.parse(found.node_json as string) as CanvasNode : null;
  }
  function shotBinding(canvasId: string, nodeId: string): ShotBinding | null {
    const stored=library.db.prepare('SELECT binding_json FROM shot_canvas_binding WHERE canvas_id=? AND node_id=?').get(canvasId,nodeId);
    return stored ? JSON.parse(stored.binding_json as string) as ShotBinding : null;
  }
  function writeNode(canvasId: string, node: CanvasNode, deleted = false) {
    library.db.prepare(`INSERT INTO canvas_node(canvas_id,node_id,incarnation,deleted,node_json) VALUES(?,?,?,?,?)
      ON CONFLICT(canvas_id,node_id) DO UPDATE SET incarnation=excluded.incarnation,deleted=excluded.deleted,node_json=excluded.node_json`)
      .run(canvasId, node.nodeId, node.incarnation, deleted ? 1 : 0, JSON.stringify(node));
    library.db.prepare('INSERT INTO canvas_node_revision(canvas_id,node_id,incarnation,semantic_revision,content_json) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING')
      .run(canvasId, node.nodeId, node.incarnation, node.semanticRevision, JSON.stringify(node.content));
  }
  function nodes(canvasId: string): CanvasNode[] { return library.db.prepare('SELECT node_json FROM canvas_node WHERE canvas_id=? AND deleted=0').all(canvasId).map(r => JSON.parse(r.node_json as string)); }
  function edges(canvasId: string): CanvasEdge[] { return library.db.prepare('SELECT edge_json FROM canvas_edge WHERE canvas_id=? ORDER BY id').all(canvasId).map(r => JSON.parse(r.edge_json as string)); }
  function typeOf(node: CanvasNode): Result<GraphType> {
    if (node.content.type === 'text') return ok({output:'text',inputs:[],adapter:null});
    if ('media' in node.content) {
      const metadata = assets?.metadata(node.content.media); if (!metadata?.ok) return fail('MEDIA_NOT_FOUND','固定原件不存在。');
      const output = metadata.value.mime === 'text/plain' ? 'text' : metadata.value.mime === 'video/mp4' ? 'video' : metadata.value.mime.startsWith('audio/')?'audio':'image';
      return ok({output,inputs:[],adapter:null});
    }
    const ref=node.content.profileRef;
    const profileRow=library.db.prepare('SELECT data_json FROM profile_revision WHERE id=? AND revision=?').get(ref.id,ref.revision);
    if (!profileRow) return fail('REVISION_NOT_FOUND','Profile不存在。');
    const profile=JSON.parse(profileRow.data_json as string) as ModelProfile;
    const model=JSON.parse(library.db.prepare('SELECT data_json FROM model_revision WHERE id=? AND revision=?').get(profile.modelRef.id,profile.modelRef.revision)!.data_json as string) as ModelDefinition;
    const connection=JSON.parse(library.db.prepare('SELECT data_json FROM connection_revision WHERE id=? AND revision=?').get(model.connectionRef.id,model.connectionRef.revision)!.data_json as string) as ProviderConnection;
    if (model.capabilities.taskTypes[0] === 'text_to_speech' || model.capabilities.taskTypes[0] === 'speech_to_text') return fail('UNSUPPORTED_CAPABILITY', '音频任务请使用配音或转写入口。');
    const output = model.capabilities.outputKinds[0];
    if (output === 'audio' || model.capabilities.inputKinds[0] === 'audio') return fail('UNSUPPORTED_CAPABILITY', '音频任务请使用配音或转写入口。');
    return ok({output,inputs:model.capabilities.inputKinds,adapter:connection.adapterType});
  }
  function dirty(canvasId: string, sources: string[], include = false): Set<string> {
    const seen = new Set<string>(), affected = new Set<string>(), graph = edges(canvasId);
    function visit(id: string, mark: boolean) { if (seen.has(id)) return; seen.add(id); if(mark)affected.add(id); for(const edge of graph.filter(e=>e.sourceNodeId===id))visit(edge.targetNodeId,true); }
    for(const source of sources)visit(source,include);
    return affected;
  }
  function graphSignature(canvasId: string,nodeId: string): string {return JSON.stringify(graphInputSnapshot(nodes(canvasId),edges(canvasId),nodeId));}
  function bindingInputsCurrent(binding: RunBinding): boolean {
    const stored=library.db.prepare('SELECT signature FROM run_graph_input WHERE run_binding_id=?').get(binding.runBindingId);
    return stored ? stored.signature===graphSignature(binding.canvasId,binding.nodeId) : edges(binding.canvasId).every(e=>e.targetNodeId!==binding.nodeId);
  }
  function mediaExists(ref: MediaReference): boolean {
    if (ref.libraryId !== library.libraryId) return false;
    return ref.kind === 'artifact'
      ? !!library.db.prepare('SELECT 1 FROM artifact WHERE id=? AND library_id=?').get(ref.artifactId, library.libraryId)
      : !!library.db.prepare('SELECT 1 FROM asset_version WHERE asset_id=? AND version=? AND library_id=?').get(ref.assetId, ref.version, library.libraryId);
  }
  function fixedText(canvasId: string, input: { nodeId: string; incarnation: string; semanticRevision: number }): string | null {
    const stored = library.db.prepare('SELECT content_json FROM canvas_node_revision WHERE canvas_id=? AND node_id=? AND incarnation=? AND semantic_revision=?')
      .get(canvasId, input.nodeId, input.incarnation, input.semanticRevision);
    if (!stored) return null;
    const content = JSON.parse(stored.content_json as string) as CanvasContent;
    return content.type === 'text' ? content.text : null;
  }
  function validateContent(canvasId: string, content: CanvasContent, trustedUndo = false): Result<void> {
    if (('media' in content) && !mediaExists(content.media)) return fail('MEDIA_NOT_FOUND', '请选择当前资料库中固定的媒体版本。');
    if (('media' in content) && assets) { const selected = trustedUndo ? assets.metadata(content.media) : assets.assertSelectable(content.media); if (!selected.ok) return selected; }
    if('voiceBinding' in content&&content.voiceBinding){
      const row=canvas(canvasId);if(!row)return fail('CANVAS_NOT_FOUND','画布不存在。');const binding=content.voiceBinding,voice=voiceInputResolver(library).usable(row.project_id as string,binding.voiceRef);if(!voice.ok)return voice;
      const ref=voice.value.videoReference??voice.value.reference;
      if(voice.value.archived||voice.value.entityRef.id!==binding.characterRef.id||!ref||JSON.stringify(ref.ref)!==JSON.stringify(content.media))return fail('VOICE_MAPPING_CONFLICT','音频必须是该角色固定声音版本的参考，不可绑定其他素材。');
    }
    if (content.type === 'generation') {
      if (content.referenceImages?.some(image => !mediaExists(image.ref))) return fail('MEDIA_NOT_FOUND', '请选择当前资料库中固定的参考图版本。');
      if (assets) for (const image of content.referenceImages ?? []) { const selected = trustedUndo ? assets.metadata(image.ref) : assets.assertSelectable(image.ref); if (!selected.ok) return selected; }
      const ref = content.profileRef;
      if (ref.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', 'Profile 属于其他资料库。');
      if (!library.db.prepare('SELECT 1 FROM profile_revision WHERE id=? AND revision=? AND library_id=?').get(ref.id, ref.revision, library.libraryId)) return fail('REVISION_NOT_FOUND', '固定 Profile 版本不存在。');
      if (content.inputs.some(input => fixedText(canvasId, input) === null)) return fail('INPUT_NOT_FOUND', '明确选定的固定文本版本不存在；P1 仅支持文本生图。');
    }
    return ok(undefined);
  }
  function publishChange(canvasId: string, commandId: string, changedNodeIds: string[], skipped: string[] = []): CanvasCommit {
    library.db.prepare('UPDATE canvas SET revision=revision+1 WHERE id=?').run(canvasId);
    return {
      libraryId: library.libraryId,
      canvasId,
      commandId,
      revision: canvas(canvasId)!.revision as number,
      changedNodeIds: [...new Set(changedNodeIds)],
      skipped,
    };
  }
  function notify(commit: CanvasCommit) {
    library.db.prepare('INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,?,?)').run(library.libraryId, 'canvas.changed', JSON.stringify(commit));
  }
  function applyOne(canvasId: string, operation: CanvasOperation | CanvasInverse, trustedUndo: boolean, effects: {dirty:Set<string>;restores:CanvasEdge[];incarnations:Map<string,{from:string;to:string}>}): Result<CanvasInverse> {
    const markDirty=(sources:string[],include=false)=>{for(const id of dirty(canvasId,sources,include))effects.dirty.add(id);};
    if (operation.kind === 'addEdge') {
      if (shotBinding(canvasId,operation.edge.targetNodeId)) return fail('SHOT_BOUND','镜头绑定节点的输入连接由生产批次固定。');
      if (edges(canvasId).some(e => e.id === operation.edge.id)) return fail('GRAPH_DUPLICATE', '连线身份已使用。');
      const valid = validateGraph(nodes(canvasId), [...edges(canvasId), operation.edge], typeOf); if (!valid.ok) return valid;
      library.db.prepare('INSERT INTO canvas_edge(canvas_id,id,edge_json) VALUES(?,?,?)').run(canvasId,operation.edge.id,JSON.stringify(operation.edge));
      markDirty([operation.edge.targetNodeId],true);
      return ok({kind:'removeEdge',edgeId:operation.edge.id});
    }
    if (operation.kind === 'removeEdge') {
      const edge = edges(canvasId).find(e => e.id === operation.edgeId); if (!edge) return canvasConflict('edge',operation.edgeId,null);
      if (shotBinding(canvasId,edge.targetNodeId)) return fail('SHOT_BOUND','镜头绑定节点的输入连接由生产批次固定。');
      library.db.prepare('DELETE FROM canvas_edge WHERE canvas_id=? AND id=?').run(canvasId,operation.edgeId);
      markDirty([edge.targetNodeId],true);
      return ok({kind:'addEdge',edge});
    }
    if (operation.kind === 'restore') {
      if (shotBinding(canvasId,operation.node.nodeId)) return fail('SHOT_BOUND','镜头绑定节点不能通过通用命令恢复内容。');
      const stored = row(canvasId, operation.node.nodeId);
      if (!stored || stored.deleted !== 1 || stored.incarnation !== operation.node.incarnation) return canvasConflict(`${operation.node.nodeId}.incarnation`, operation.node.incarnation, stored?.incarnation ?? null);
      const node: CanvasNode = {
        ...operation.node,
        incarnation: randomUUID(),
        semanticRevision: 1,
        layoutRevision: 1,
        selectionRevision: 1,
        activeRunBindingId: null,
      };
      const valid = validateContent(canvasId,node.content,trustedUndo); if (!valid.ok) return valid;
      writeNode(canvasId, node);
      effects.restores.push(...(operation.edges??[]));
      effects.incarnations.set(node.nodeId,{from:operation.node.incarnation,to:node.incarnation});
      markDirty([node.nodeId]);
      return ok(deleteInverse(node));
    }
    if (operation.kind === 'create') {
      if (row(canvasId, operation.nodeId)) return canvasConflict(`${operation.nodeId}.identity`, null, 'already used');
      const valid = validateContent(canvasId, operation.content, trustedUndo);
      if (!valid.ok) return valid;
      const node: CanvasNode = {
        nodeId: operation.nodeId,
        incarnation: randomUUID(),
        semanticRevision: 1,
        layoutRevision: 1,
        selectionRevision: 1,
        content: operation.content,
        layout: operation.layout,
        selectedOutput: null,
        activeRunBindingId: null,
      };
      writeNode(canvasId, node);
      return ok(deleteInverse(node));
    }
    const node = currentNode(canvasId, operation.nodeId);
    const checked = checkCanvasOperation(node, operation);
    if (!checked.ok) return checked;
    if (!node) return fail('NODE_NOT_FOUND', '节点不存在。');
    if ((operation.kind === 'setContent' || operation.kind === 'delete') && shotBinding(canvasId,node.nodeId)) return fail('SHOT_BOUND','镜头绑定节点的内容由镜头生产批次固定；请新建批次。');
    if (operation.kind === 'delete') {
      const removed = edges(canvasId).filter(e => e.sourceNodeId === node.nodeId || e.targetNodeId === node.nodeId);
      markDirty([node.nodeId]);
      for (const e of removed) library.db.prepare('DELETE FROM canvas_edge WHERE canvas_id=? AND id=?').run(canvasId,e.id);
      writeNode(canvasId, node, true);
      return ok({ kind: 'restore', node, edges: removed });
    }
    if (operation.kind === 'setContent') {
      if (operation.content.type !== node.content.type) return fail('NODE_TYPE_CHANGED', '节点类型固定，请创建新节点。');
      const valid = validateContent(canvasId, operation.content, trustedUndo);
      if (!valid.ok) return valid;
      const next = { ...node, content: operation.content, semanticRevision: node.semanticRevision + 1 };
      const graph = validateGraph(nodes(canvasId).map(n => n.nodeId === next.nodeId ? next : n),edges(canvasId),typeOf); if (!graph.ok) return graph;
      writeNode(canvasId, next); markDirty([node.nodeId]);
      return ok({ ...operation, expectedRevision: next.semanticRevision, content: node.content });
    }
    if (operation.kind === 'setLayout') {
      const next = { ...node, layout: operation.layout, layoutRevision: node.layoutRevision + 1 };
      writeNode(canvasId, next);
      return ok({ ...operation, expectedRevision: next.layoutRevision, layout: node.layout });
    }
    if (operation.output && assets) { const selected = trustedUndo ? assets.metadata(operation.output) : assets.assertSelectable(operation.output); if (!selected.ok) return selected; }
    if (operation.output && !mediaExists(operation.output)) return fail('MEDIA_NOT_FOUND', '输出固定版本不存在。');
    if(operation.output && assets && edges(canvasId).some(e=>e.sourceNodeId===node.nodeId)) {
      const metadata=assets.metadata(operation.output), declared=typeOf(node);
      if(!metadata.ok)return metadata;if(!declared.ok)return declared;
      const kind=metadata.value.mime==='text/plain'?'text':metadata.value.mime==='video/mp4'?'video':'image';
      if(kind!==declared.value.output)return fail('GRAPH_TYPE_MISMATCH','输出类型与连接不兼容，请先断开连接。');
    }
    const next = { ...node, selectedOutput: operation.output, selectionRevision: node.selectionRevision + 1 };
    const graph = validateGraph(nodes(canvasId).map(n => n.nodeId === next.nodeId ? next : n),edges(canvasId),typeOf); if (!graph.ok) return graph;
    writeNode(canvasId, next); markDirty([node.nodeId]);
    return ok({ ...operation, expectedRevision: next.selectionRevision, output: node.selectedOutput });
  }
  function deleteInverse(node: CanvasNode): CanvasOperation {
    return {
      kind: 'delete',
      nodeId: node.nodeId,
      incarnation: node.incarnation,
      expectedSemanticRevision: node.semanticRevision,
      expectedLayoutRevision: node.layoutRevision,
      expectedSelectionRevision: node.selectionRevision,
      expectedRunBindingId: node.activeRunBindingId,
    };
  }
  function apply(input: CanvasCommand, commandId: string): Result<CanvasCommit> {
    const own = library.checkOwnership();
    if (!own.ok) return own;
    const stored = canvas(input.canvasId);
    if (!stored) return fail('CANVAS_NOT_FOUND', '画布不存在。');
    if (input.baseRevision > (stored.revision as number)) return canvasConflict('canvas.revision', input.baseRevision, stored.revision);
    let operations: CanvasInverse[], trustedUndo = false;
    if (input.undoCommandId !== undefined) {
      const original = library.db.prepare('SELECT inverse_json FROM canvas_command WHERE canvas_id=? AND command_id=?').get(input.canvasId, input.undoCommandId);
      if (!original) return fail('UNDO_NOT_FOUND', '此画布没有可撤销的命令。');
      operations = JSON.parse(original.inverse_json as string) as CanvasInverse[];
      // Only a stored inverse restores a historical choice; no command flag can enable this mode.
      trustedUndo = true;
    } else operations = input.operations;
    if (operations.some(o => o.kind === 'addEdge' || o.kind === 'removeEdge') && input.baseRevision !== stored.revision) return canvasConflict('canvas.revision',input.baseRevision,stored.revision);
    const before=new Map(nodes(input.canvasId).map(n=>[n.nodeId,n]));
    const effects={dirty:new Set<string>(),restores:[] as CanvasEdge[],incarnations:new Map<string,{from:string;to:string}>()};
    const inverse: CanvasInverse[] = [];
    const changed: string[] = [];
    const skipped: string[] = [];
    for (const operation of operations) {
      const applied = applyOne(input.canvasId, operation, trustedUndo,effects);
      if (!applied.ok) {
        if (input.undoCommandId !== undefined && applied.error.code === 'CANVAS_CONFLICT') {
          skipped.push(...Object.keys(applied.error.fieldErrors ?? {}));
          continue;
        }
        return applied;
      }
      inverse.unshift(applied.value);
      changed.push(...(operation.kind === 'addEdge' ? [operation.edge.targetNodeId] : operation.kind === 'removeEdge' ? [] : [operation.kind === 'restore' ? operation.node.nodeId : operation.nodeId]));
    }
    // Restore a deleted subgraph as one unit; only inverses restored by this command may receive new incarnations.
    const restored=effects.restores.map(edge=>{const source=effects.incarnations.get(edge.sourceNodeId),target=effects.incarnations.get(edge.targetNodeId);return {...edge,sourceIncarnation:source?.from===edge.sourceIncarnation?source.to:edge.sourceIncarnation,targetIncarnation:target?.from===edge.targetIncarnation?target.to:edge.targetIncarnation};});
    if(restored.length){const graph=validateGraph(nodes(input.canvasId),[...edges(input.canvasId),...restored],typeOf);if(!graph.ok)return graph;for(const edge of restored)library.db.prepare('INSERT INTO canvas_edge(canvas_id,id,edge_json) VALUES(?,?,?)').run(input.canvasId,edge.id,JSON.stringify(edge));for(const edge of restored)for(const id of dirty(input.canvasId,[edge.targetNodeId],true))effects.dirty.add(id);}
    // Derived staleness is applied after explicit batch preconditions, once per node.
    for(const id of effects.dirty){const node=currentNode(input.canvasId,id),previous=before.get(id);if(node&&previous&&node.incarnation===previous.incarnation&&node.semanticRevision===previous.semanticRevision)writeNode(input.canvasId,{...node,semanticRevision:node.semanticRevision+1});if(node)changed.push(id);}
    const commit = publishChange(input.canvasId, commandId, changed, skipped);
    library.db.prepare('INSERT INTO canvas_command(command_id,canvas_id,revision,inverse_json) VALUES(?,?,?,?)').run(commandId, input.canvasId, commit.revision, JSON.stringify(inverse));
    return ok(commit);
  }
  function read(canvasId: string): Result<CanvasSnapshot> {
    const own = library.checkOwnership();
    if (!own.ok) return own;
    const found = canvas(canvasId);
    if (!found) return fail('CANVAS_NOT_FOUND', '画布不存在。');
    const outputs: CanvasOutput[] = library.db.prepare(`
      SELECT output_json FROM canvas_output
      JOIN run_binding ON run_binding.id=canvas_output.run_binding_id
      WHERE canvas_id=? ORDER BY canvas_output.rowid
    `).all(canvasId).map(r => JSON.parse(r.output_json as string));
    const storedNodes = library.db.prepare('SELECT node_json FROM canvas_node WHERE canvas_id=? AND deleted=0 ORDER BY rowid').all(canvasId);
    const nodes = storedNodes.map(r => {
      const node = JSON.parse(r.node_json as string) as CanvasNode;
      const active = node.activeRunBindingId ? library.db.prepare('SELECT view_json FROM run_binding JOIN task_attempt USING(task_id) WHERE run_binding.id=? AND canvas_id=? AND node_id=?').get(node.activeRunBindingId, canvasId, node.nodeId) : undefined;
      const task = active ? JSON.parse(active.view_json as string) as TaskView : null;
      let freshness=outputFreshness(node,outputs);
      const selected=node.selectedOutput;
      const output=selected?.kind==='artifact'?outputs.find(o=>o.nodeId===node.nodeId&&o.artifactRef.artifactId===selected.artifactId):undefined;
      if(freshness==='current'&&output){const binding=library.db.prepare('SELECT binding_json FROM run_binding WHERE id=?').get(output.runBindingId);if(binding&&!bindingInputsCurrent(JSON.parse(binding.binding_json as string)))freshness='stale';}
      return {
        ...node,
        shotBinding: shotBinding(canvasId,node.nodeId),
        freshness,
        activeTask: task ? { taskId: task.taskId, state: task.state } : null,
      };
    });
    const snapshot: CanvasSnapshot = {
      libraryId: library.libraryId,
      canvasId,
      projectId: found.project_id as string,
      revision: found.revision as number,
      nodes,
      outputs,
      edges: edges(canvasId),
      snapshotSeq: library.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM domain_event').get()!.seq as number,
      streamId: library.db.prepare('SELECT stream_id FROM event_stream WHERE singleton=1').get()!.stream_id as string,
    };
    return isCanvasSnapshot(snapshot) ? ok(snapshot) : fail('INVALID_STORED_DATA', '画布数据无效。');
  }
  function inputCurrent(input: CanvasInputOwnership): boolean {
    const node = currentNode(input.canvasId, input.nodeId);
    return !!node && node.content.type === 'generation' && node.incarnation === input.incarnation && node.semanticRevision === input.semanticRevision;
  }
  function resolveGeneration(input: PrepareCanvasGenerationInput): Result<{ input: PrepareInlineGenerationInput; ownership: CanvasInputOwnership }> {
    const found = canvas(input.canvasNode.canvasId);
    if (!found || found.project_id !== input.projectId) return fail('CANVAS_NOT_FOUND', '画布不属于本项目。');
    const node = currentNode(input.canvasNode.canvasId, input.canvasNode.nodeId);
    if (!node || node.content.type !== 'generation') return fail('GENERATION_NODE_NOT_FOUND', '请选择图像生成节点。');
    const valid = validateContent(input.canvasNode.canvasId, node.content);
    if (!valid.ok) return valid;
    const prompt = [node.content.prompt, ...node.content.inputs.map(ref => fixedText(input.canvasNode.canvasId, ref)!)].filter(part => part.length > 0).join('\n\n');
    if (!prompt.trim() || prompt.length > 16000) return fail('INVALID_INPUT', '合并后的文本提示词必须为 1–16000 字符。');
    const referenceAudio=edges(input.canvasNode.canvasId).filter(e=>e.targetNodeId===node.nodeId&&e.targetPort==='voice_reference').sort((a,b)=>a.id.localeCompare(b.id)).map(e=>{const source=currentNode(input.canvasNode.canvasId,e.sourceNodeId)!;if(!('voiceBinding' in source.content)||!source.content.voiceBinding||!('media' in source.content))throw Error('VOICE_BINDING_REQUIRED');return {...source.content.voiceBinding,ref:source.content.media};});
    return ok({
      input: {
        projectId: input.projectId,
        prompt,
        profileRef: node.content.profileRef,
        ...(node.content.referenceImages === undefined ? {} : { referenceImages: structuredClone(node.content.referenceImages) }),
        ...(referenceAudio.length?{referenceAudio}:{}),
        inputVersion: `${node.incarnation}_${node.semanticRevision}`,
        executionOwner: input.executionOwner,
        runId: input.runId,
      },
      ownership: {
        canvasId: input.canvasNode.canvasId,
        nodeId: node.nodeId,
        incarnation: node.incarnation,
        semanticRevision: node.semanticRevision,
      },
    });
  }
  function bind(prepared: PreparedGeneration, task: TaskRef): Result<void> {
    const ownership = prepared.canvasInput;
    if (!ownership) return ok(undefined);
    if (!inputCurrent(ownership)) return fail('INPUT_CHANGED', '画布输入已变化。');
    const node = currentNode(ownership.canvasId, ownership.nodeId)!;
    const binding: RunBinding = {
      ...ownership,
      libraryId: library.libraryId,
      runBindingId: randomUUID(),
      taskId: task.taskId,
      selectionRevision: node.selectionRevision,
    };
    library.db.prepare('INSERT INTO run_binding(id,canvas_id,node_id,task_id,binding_json) VALUES(?,?,?,?,?)').run(binding.runBindingId, binding.canvasId, binding.nodeId, binding.taskId, JSON.stringify(binding));
    library.db.prepare('INSERT INTO run_graph_input(run_binding_id,signature) VALUES(?,?)').run(binding.runBindingId,graphSignature(binding.canvasId,binding.nodeId));
    writeNode(binding.canvasId, { ...node, activeRunBindingId: binding.runBindingId });
    notify(publishChange(binding.canvasId, binding.runBindingId, [binding.nodeId]));
    return ok(undefined);
  }
  function bindApproved(prepared: PreparedGeneration, task: TaskRef, selectionRevision: number, expectedInputSignature: string): Result<void> {
    const ownership=prepared.canvasInput; if (!ownership) return fail('WORKFLOW_BINDING','缺少冻结节点身份。');
    const node=currentNode(ownership.canvasId,ownership.nodeId);
    const binding: RunBinding={...ownership,libraryId:library.libraryId,runBindingId:randomUUID(),taskId:task.taskId,selectionRevision};
    library.db.prepare('INSERT INTO run_binding(id,canvas_id,node_id,task_id,binding_json) VALUES(?,?,?,?,?)').run(binding.runBindingId,binding.canvasId,binding.nodeId,binding.taskId,JSON.stringify(binding));
    library.db.prepare('INSERT INTO run_graph_input(run_binding_id,signature) VALUES(?,?)').run(binding.runBindingId,expectedInputSignature);
    if (node && node.incarnation===binding.incarnation && node.semanticRevision===binding.semanticRevision && node.selectionRevision===selectionRevision && graphSignature(binding.canvasId,binding.nodeId)===expectedInputSignature) writeNode(binding.canvasId,{...node,activeRunBindingId:binding.runBindingId});
    notify(publishChange(binding.canvasId,binding.runBindingId,[binding.nodeId])); return ok(undefined);
  }
  return { bindingInputsCurrent, bindApproved, edges, typeOf, fixedText, apply, read, resolveGeneration, inputCurrent, bind, currentNode, writeNode, publishChange, notify, shotBinding };
}
