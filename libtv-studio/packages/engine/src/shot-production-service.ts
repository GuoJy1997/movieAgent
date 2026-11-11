import { createHash, randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { ModelDefinition, ModelProfile, ProviderConnection, RevisionRef, ParameterValue } from '../../contracts/src/models.ts';
import type { MediaReference } from '../../contracts/src/assets.ts';
import type { ShotRevision, EntityRevision, ShotOutputSelection } from '../../contracts/src/creation.ts';
import type { CanvasOperation } from '../../contracts/src/canvas.ts';
import type { WorkflowStepView } from '../../contracts/src/workflows.ts';
import type { PrepareShotProductionInput, ApplyShotProductionInput, StopShotProductionInput, AttachShotWorkflowInput, SelectShotProductionOutputInput, PreparedShotProduction, ShotProductionStep, ShotProductionSnapshot, ShotProductionView, ShotProductionHistory, ShotProductionIssuesView, ShotProductionOutput, ShotProductionCollectionIssue, ShotHarvestReport, ShotBinding } from '../../contracts/src/shot-production.ts';
import { isPreparedShotProduction, isShotProductionView } from '../../contracts/src/shot-production.ts';
import { freezeRunConfig, resolveModelParameters } from '../../domain/src/model-config.ts';
import { validateReferenceShape } from '../../domain/src/reference-inputs.ts';
import type { canvasFor } from './canvas-service.ts';
import type { creationFor } from './creation-service.ts';
import type { modelConfigFor } from './model-config-service.ts';
import type { assetsFor } from './asset-service.ts';
import type { workflowsFor } from './workflow-service.ts';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const refEqual = (a: RevisionRef, b: RevisionRef) => a.libraryId === b.libraryId && a.id === b.id && a.revision === b.revision;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Mutators join the command router's receipt transaction; harvesting opens a transaction per artifact. */
export function shotProductionFor(library: LibraryHandle, canvas: ReturnType<typeof canvasFor>, creation: ReturnType<typeof creationFor>, models: ReturnType<typeof modelConfigFor>, assets: ReturnType<typeof assetsFor>, workflows: ReturnType<typeof workflowsFor>) {
  const db = library.db;
  const row = (id: string) => db.prepare('SELECT * FROM shot_production WHERE production_id=?').get(id);
  const outputs = (id: string): ShotProductionOutput[] => db
    .prepare('SELECT data_json FROM shot_production_output WHERE production_id=? ORDER BY rowid')
    .all(id).map(item => JSON.parse(item.data_json as string) as ShotProductionOutput);
  const issues = (id: string): ShotProductionCollectionIssue[] => db
    .prepare('SELECT issue_id,production_id,node_id,task_id,error_code,created_at FROM shot_production_collection_issue WHERE production_id=? ORDER BY created_at,issue_id')
    .all(id).map(item => ({
      issueId: item.issue_id as string, productionId: item.production_id as string,
      nodeId: item.node_id as string | null, taskId: item.task_id as string | null,
      errorCode: item.error_code as string, createdAt: item.created_at as number,
    }));
  function read(productionId: string): Result<ShotProductionView> {
    const own = library.checkOwnership();
    if (!own.ok) return own;
    const stored = row(productionId);
    if (!stored) return fail('PRODUCTION_NOT_FOUND', '生产批次不存在。');
    const plan = JSON.parse(stored.plan_json as string) as PreparedShotProduction;
    const view: ShotProductionView = {
      libraryId: library.libraryId, productionId, projectId: stored.project_id as string,
      state: stored.state as ShotProductionView['state'], plan,
      workflowId: stored.workflow_id as string | null,
      outputs: outputs(productionId), collectionIssues: issues(productionId),
    };
    return isShotProductionView(view) ? ok(view) : fail('INVALID_STORED_DATA', '生产批次数据无效。');
  }
  function collectionIssues(productionId: string): Result<ShotProductionIssuesView> {
    const own = library.checkOwnership();
    if (!own.ok) return own;
    const stored = row(productionId);
    if (!stored) return fail('PRODUCTION_NOT_FOUND', '生产批次不存在。');
    return ok({
      libraryId: library.libraryId,
      projectId: stored.project_id as string,
      productionId,
      issues: issues(productionId),
    });
  }
  function history(projectId: string, shotId: string): Result<ShotProductionHistory> {
    const snapshot = creation.read({ projectId }); if (!snapshot.ok) return snapshot;
    if (!snapshot.value.shots.some(s => s.id === shotId)) return fail('SHOT_NOT_FOUND','镜头不存在于项目。');
    const rows = db.prepare('SELECT production_id,plan_json,state,workflow_id FROM shot_production WHERE project_id=? ORDER BY rowid').all(projectId);
    const productions = rows.flatMap(row => {
      const plan = JSON.parse(row.plan_json as string) as PreparedShotProduction;
      const frozen = plan.snapshots.find(item => item.shotId === shotId);
      return frozen ? [{
        productionId: row.production_id as string, shotRevision: frozen.shotRevision,
        scriptRevision: frozen.scriptRevision, state: row.state as ShotProductionView['state'],
        workflowId: row.workflow_id as string | null,
        nodeIds: plan.steps.filter(step => step.shotId === shotId).map(step => step.nodeId),
      }] : [];
    });
    const outputRows = db.prepare('SELECT o.data_json FROM shot_production_output o JOIN shot_production p ON p.production_id=o.production_id WHERE p.project_id=? ORDER BY o.rowid').all(projectId);
    const history = outputRows.map(row => JSON.parse(row.data_json as string) as ShotProductionOutput).filter(output => output.shotId === shotId);
    const nodeIds = new Set(productions.flatMap(entry => entry.nodeIds));
    const collectionIssues = productions.flatMap(entry => issues(entry.productionId))
      .filter(issue => issue.nodeId === null || nodeIds.has(issue.nodeId));
    return ok({ libraryId: library.libraryId, projectId, shotId, productions, outputs: history, collectionIssues });
  }
  function source(ref: RevisionRef, role: 'image' | 'video'): Result<{ profile: ModelProfile; model: ModelDefinition; connection: ProviderConnection }> {
    if (ref.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', 'Profile属于其他资料库。');
    const profiles = models.listProfiles().profiles;
    const profile = profiles.find(item => refEqual(item, ref));
    if (!profile) return fail('REVISION_NOT_FOUND', '固定Profile不存在。');
    const definitions = models.listModels().models;
    const model = definitions.find(item => refEqual(item, profile.modelRef));
    const connections = models.listConnections().connections;
    const connection = model && connections.find(item => refEqual(item, model.connectionRef));
    if (!model || !connection) return fail('REVISION_NOT_FOUND', '固定模型配置不存在。');
    const config = freezeRunConfig(connection, model, profile);
    if (!config.ok) return config;
    if (model.capabilities.outputKinds[0] !== role) return fail('UNSUPPORTED_CAPABILITY', 'Profile输出类型与镜头步骤不匹配。');
    const latestProfile = profiles.filter(item => item.id === ref.id).at(-1);
    const latestModel = definitions.filter(item => item.id === model.id).at(-1);
    const latestConnection = connections.filter(item => item.id === connection.id).at(-1);
    if (latestProfile?.revision !== ref.revision || latestModel?.revision !== model.revision || latestConnection?.revision !== connection.revision) {
      return fail('REVISION_CONFLICT', '源配置已有新修订，请重新预览。');
    }
    return ok({ profile, model, connection });
  }
  function profileFor(projectId: string, sourceRef: RevisionRef, sourceProfile: ModelProfile, model: ModelDefinition, overrides: Record<string, ParameterValue>): Result<RevisionRef> {
    if (!Object.keys(overrides).length) return ok(sourceRef);
    const parameters = { ...sourceProfile.parameters, ...overrides };
    const resolved = resolveModelParameters(model, parameters);
    if (!resolved.ok) return resolved;
    const id = `shot-profile-${digest([projectId, sourceRef, parameters]).slice(0, 48)}`;
    return ok({ libraryId: library.libraryId, id, revision: 1 });
  }
  function imageOverrides(shot: ShotRevision, model: ModelDefinition): Result<Record<string,ParameterValue>> {
    const size = model.parameters.size;
    if (!size) return ok({});
    if (size.type !== 'enum') return fail('INVALID_PARAMETERS', '图像尺寸描述无效。');
    const wanted = shot.aspectRatio === '1:1' ? '1024x1024' : ['16:9','4:3'].includes(shot.aspectRatio) ? '1536x1024' : '1024x1536';
    return size.values.includes(wanted) ? ok({ size: wanted }) : fail('UNSUPPORTED_RATIO', '图像模型不支持镜头画幅所需尺寸。');
  }
  function videoOverrides(shot: ShotRevision, model: ModelDefinition, adaptiveInput: boolean): Result<Record<string,ParameterValue>> {
    const duration = model.parameters.duration;
    const ratio = model.parameters.ratio;
    if (duration?.type !== 'integer' || ratio?.type !== 'enum' || shot.durationSeconds < duration.min || shot.durationSeconds > duration.max) {
      return fail('UNSUPPORTED_DURATION', '视频模型不支持镜头时长。');
    }
    const desired = adaptiveInput ? 'adaptive' : shot.aspectRatio;
    if (!ratio.values.includes(desired)) return fail('UNSUPPORTED_RATIO', '视频模型不支持镜头画幅。');
    return ok({ duration: shot.durationSeconds, ratio: desired });
  }
  function fixedEntity(ref: ShotRevision['entityRefs'][number]): Result<EntityRevision> {
    const history = creation.history({ projectId: ref.projectId, kind: 'entity', id: ref.entityId });
    if (!history.ok) return history;
    const entity = history.value.revisions.find(item => item.revision === ref.revision) as EntityRevision | undefined;
    return entity ? ok(entity) : fail('ENTITY_NOT_FOUND', '固定实体修订不存在。');
  }
  async function prepare(input: PrepareShotProductionInput): Promise<Result<PreparedShotProduction>> {
    const snapshot = creation.read({ projectId: input.projectId });
    if (!snapshot.ok) return snapshot;
    const graph = canvas.read(input.canvasId);
    if (!graph.ok) return graph;
    if (graph.value.projectId !== input.projectId) return fail('WRONG_PROJECT', '画布属于其他项目。');
    const script = snapshot.value.scripts.find(item => item.id === input.scriptId);
    if (!script) return fail('SCRIPT_NOT_FOUND', '剧本不存在于此项目。');
    const snapshots: ShotProductionSnapshot[] = [];
    for (const selected of input.shots) {
      const shot = snapshot.value.shots.find(item => item.id === selected.shotId);
      if (!shot || shot.scriptId !== input.scriptId) return fail('WRONG_PROJECT', '镜头不属于所选剧本。');
      if (shot.revision !== selected.revision) return fail('REVISION_CONFLICT', '镜头已有新修订。');
      const scene = script.scenes.find(item => item.id === shot.sceneId);
      if (!scene) return fail('SCENE_NOT_FOUND', '剧本场景不存在。');
      const entities: EntityRevision[] = [];
      for (const ref of shot.entityRefs) {
        const entity = fixedEntity(ref);
        if (!entity.ok) return entity;
        entities.push(entity.value);
      }
      const selection = snapshot.value.selections.find(item => item.shotId === shot.id);
      snapshots.push({
        shotId: shot.id, shotRevision: shot.revision, scriptRevision: script.revision,
        scene: structuredClone(scene), shot: structuredClone(shot), script: structuredClone(script),
        entities, selectionRevision: selection?.selectionRevision ?? 0,
      });
    }
    const productionId = randomUUID();
    const steps: ShotProductionStep[] = [];
    const operations: PreparedShotProduction['operations'] = [];
    for (const snap of snapshots) {
      const reused = input.reusedImages?.find(item => item.shotId === snap.shotId);
      // Entity revisions stay frozen, but a finished shot image replaces their image inputs.
      const refs = reused ? [] : snap.entities.flatMap(entity => entity.references);
      if (refs.length > 4) return fail('INVALID_REFERENCE', '镜头固定实体参考图最多4张。');
      for (const ref of refs) {
        const available = assets.assertSelectable(ref);
        if (!available.ok) return available;
        if (!available.value.mime.startsWith('image/')) return fail('INVALID_REFERENCE', '实体引用需要固定图片。');
      }
      if (reused) {
        const media = assets.assertSelectable(reused.ref);
        if (!media.ok) return media;
        if (!media.value.mime.startsWith('image/')) return fail('INVALID_REFERENCE', '复用分镜图必须是固定图片。');
        const original = await assets.readFixedOriginal(reused.ref, media.value);
        if (!original.ok) return original;
      }
      let imageNode: string | undefined;
      for (const role of ['image', 'video'] as const) {
        if (role === 'image' && reused) continue;
        const sourceRef = role === 'image' ? input.imageProfileRef : input.videoProfileRef;
        if (!sourceRef) continue;
        const sourceConfig = source(sourceRef, role);
        if (!sourceConfig.ok) return sourceConfig;
        const { profile, model, connection } = sourceConfig.value;
        const firstFrame = role === 'video' && (!!imageNode || reused?.role === 'first_frame');
        const overrideResult = role === 'image'
          ? imageOverrides(snap.shot, model)
          : videoOverrides(snap.shot, model, firstFrame || !!reused || refs.length > 0);
        if (!overrideResult.ok) return overrideResult;
        const overrides = overrideResult.value;
        const profileRef = profileFor(input.projectId, sourceRef, profile, model, overrides);
        if (!profileRef.ok) return profileRef;
        const config = freezeRunConfig(connection, model, { ...profile, parameters: { ...profile.parameters, ...overrides } });
        if (!config.ok) return config;
        const referenceImages = role === 'video' && reused ? [{role:reused.role,ref:reused.ref}] : role === 'image' || !imageNode
          ? refs.map(ref => ({ role: 'reference' as const, ref })) : [];
        const known = [];
        for (const reference of referenceImages) {
          const media = assets.assertSelectable(reference.ref);
          if (!media.ok) return media;
          known.push({ ...reference, ...media.value });
        }
        const roles = [...referenceImages.map(reference => reference.role), ...(imageNode && role === 'video' ? ['first_frame' as const] : [])];
        const shape = validateReferenceShape({ libraryId: library.libraryId, adapterId: connection.adapterType, config: config.value }, roles, known);
        if (!shape.ok) return shape;
        const nodeId = `shot-node-${digest([productionId, snap.shotId, role]).slice(0, 48)}`;
        const aspectNotice = role === 'image'
          ? overrides.size
            ? `图像尺寸 ${overrides.size}；分镜目标画幅 ${snap.shot.aspectRatio}。`
            : `图像模型未声明固定尺寸；分镜目标画幅 ${snap.shot.aspectRatio} 仅作为创作意图。`
          : firstFrame
            ? `视频 ratio=adaptive，输出画幅取决于图像首帧及模型；分镜目标画幅 ${snap.shot.aspectRatio}。`
            : refs.length || reused
              ? `参考图模式使用 ratio=adaptive，输出画幅取决于参考图及模型；分镜目标画幅 ${snap.shot.aspectRatio}。`
              : `视频固定画幅 ${snap.shot.aspectRatio}。`;
        const step: ShotProductionStep = {
          shotId: snap.shotId, shotRevision: snap.shotRevision, role, nodeId,
          profileRef: profileRef.value, sourceProfileRef: sourceRef, overrides,
          prompt: snap.shot.prompt, aspectNotice, referenceImages,
        };
        steps.push(step);
        operations.push({ kind: 'create', nodeId, stepIndex: steps.length - 1 });
        if (firstFrame && imageNode) operations.push({ kind: 'first_frame', sourceNodeId: imageNode, targetNodeId: nodeId });
        if (role === 'image') imageNode = nodeId;
      }
    }
    if (steps.length > 32 || operations.length > 100 || operations.filter(operation => operation.kind === 'first_frame').length > 128) {
      return fail('PRODUCTION_LIMIT', '镜头生成超出32步骤、100操作或128依赖，请分批。');
    }
    const base = {
      ...input, libraryId: library.libraryId, productionId, expiresAt: Date.now() + 600000,
      canvasRevision: graph.value.revision, snapshots, steps, operations,
      limits: { shots: 16 as const, steps: 32 as const, operations: 100 as const, dependencies: 128 as const },
    };
    const plan = { ...base, planHash: digest(base) };
    return isPreparedShotProduction(plan) ? ok(plan) : fail('INVALID_PRODUCTION', '镜头生产计划无效。');
  }
  function savePrepared(plan: PreparedShotProduction): Result<PreparedShotProduction> {
    const current = creation.read({ projectId: plan.projectId });
    if (!current.ok) return current;
    const graph = canvas.read(plan.canvasId);
    if (!graph.ok) return graph;
    if (graph.value.revision !== plan.canvasRevision) return fail('CANVAS_CONFLICT', '画布已改变，请重新预览。');
    for (const snap of plan.snapshots) {
      const shotRevision = current.value.shots.find(shot => shot.id === snap.shotId)?.revision;
      const scriptRevision = current.value.scripts.find(script => script.id === plan.scriptId)?.revision;
      const selectionRevision = current.value.selections.find(selection => selection.shotId === snap.shotId)?.selectionRevision ?? 0;
      if (shotRevision !== snap.shotRevision || scriptRevision !== snap.scriptRevision || selectionRevision !== snap.selectionRevision) {
        return fail('REVISION_CONFLICT', '镜头、剧本或输出选择已改变。');
      }
    }
    for (const step of plan.steps) {
      const valid = source(step.sourceProfileRef, step.role);
      if (!valid.ok) return valid;
    }
    db.prepare("INSERT INTO shot_production(production_id,project_id,canvas_id,plan_json,state) VALUES(?,?,?,?,'prepared')")
      .run(plan.productionId, plan.projectId, plan.canvasId, JSON.stringify(plan));
    return ok(plan);
  }
  function apply(input: ApplyShotProductionInput, commandId: string): Result<ShotProductionView> {
    const current = read(input.productionId);
    if (!current.ok) return current;
    const { plan } = current.value;
    if (plan.planHash !== input.approvedHash || plan.executionOwner !== input.executionOwner || plan.runId !== input.runId) {
      return fail('APPROVAL_MISMATCH', '批准范围与冻结计划不符。');
    }
    if (current.value.state === 'applied') return current;
    if (current.value.state !== 'prepared') return fail('PRODUCTION_STOPPED', '生产批次已停止。');
    if (plan.expiresAt <= Date.now()) return fail('APPROVAL_EXPIRED', '生产预览已过期。');
    if (plan.canvasRevision !== input.expectedCanvasRevision) return fail('CANVAS_CONFLICT', '画布基准版本不匹配。');

    const graph = canvas.read(plan.canvasId);
    if (!graph.ok) return graph;
    if (graph.value.revision !== plan.canvasRevision) return fail('CANVAS_CONFLICT', '画布已改变，请重新预览。');
    const creationSnapshot = creation.read({ projectId: plan.projectId });
    if (!creationSnapshot.ok) return creationSnapshot;
    for (const snap of plan.snapshots) {
      const shotRevision = creationSnapshot.value.shots.find(shot => shot.id === snap.shotId)?.revision;
      const scriptRevision = creationSnapshot.value.scripts.find(script => script.id === plan.scriptId)?.revision;
      const selectionRevision = creationSnapshot.value.selections.find(selection => selection.shotId === snap.shotId)?.selectionRevision ?? 0;
      if (shotRevision !== snap.shotRevision || scriptRevision !== snap.scriptRevision || selectionRevision !== snap.selectionRevision) {
        return fail('REVISION_CONFLICT', '冻结内容或选择已有新修订。');
      }
    }

    // All derived profiles and canvas operations share the router's one transaction.
    for (const step of plan.steps) {
      const checked = source(step.sourceProfileRef, step.role);
      if (!checked.ok) return checked;
      if (step.profileRef.id === step.sourceProfileRef.id) continue;
      const parameters = { ...checked.value.profile.parameters, ...step.overrides };
      const existing = models.listProfiles().profiles.find(profile => profile.id === step.profileRef.id);
      if (existing) {
        const resolved = resolveModelParameters(checked.value.model, parameters);
        if (!resolved.ok) return resolved;
        if (existing.revision !== 1 || !refEqual(existing.modelRef, checked.value.profile.modelRef) || !same(existing.parameters, resolved.value)) {
          return fail('IMMUTABLE_PROFILE', '派生Profile身份冲突。');
        }
      } else {
        const saved = models.saveProfile({
          id: step.profileRef.id, expectedRevision: 0, name: `Shot ${step.role} ${step.shotId}`,
          modelRef: checked.value.profile.modelRef, parameters,
        }, true);
        if (!saved.ok) return saved;
      }
    }

    const createOps: CanvasOperation[] = plan.steps.map((step, index) => ({
      kind: 'create', nodeId: step.nodeId,
      content: { type: 'generation', prompt: step.prompt, profileRef: step.profileRef, inputs: [],
        ...(step.referenceImages.length ? { referenceImages: step.referenceImages } : {}) },
      layout: { x: 80 + (index % 2) * 350, y: 80 + Math.floor(index / 2) * 220 },
    }));
    const created = canvas.apply({ canvasId: plan.canvasId, baseRevision: plan.canvasRevision, operations: createOps }, `${commandId}-nodes`);
    if (!created.ok) return created;
    canvas.notify(created.value);

    const edgeOps: CanvasOperation[] = [];
    for (const operation of plan.operations) {
      if (operation.kind !== 'first_frame') continue;
      const sourceNode = canvas.currentNode(plan.canvasId, operation.sourceNodeId);
      const targetNode = canvas.currentNode(plan.canvasId, operation.targetNodeId);
      if (!sourceNode || !targetNode) return fail('NODE_NOT_FOUND', '生成节点创建失败。');
      edgeOps.push({ kind: 'addEdge', edge: {
        id: `shot-edge-${digest([input.productionId, operation.sourceNodeId, operation.targetNodeId]).slice(0, 48)}`,
        sourceNodeId: sourceNode.nodeId, sourceIncarnation: sourceNode.incarnation,
        targetNodeId: targetNode.nodeId, targetIncarnation: targetNode.incarnation,
        sourcePort: 'output', targetPort: 'first_frame',
      } });
    }
    if (edgeOps.length) {
      const edged = canvas.apply({ canvasId: plan.canvasId, baseRevision: created.value.revision, operations: edgeOps }, `${commandId}-edges`);
      if (!edged.ok) return edged;
      canvas.notify(edged.value);
    }

    for (const step of plan.steps) {
      const snap = plan.snapshots.find(snapshot => snapshot.shotId === step.shotId)!;
      const binding: ShotBinding = {
        projectId: plan.projectId, scriptId: plan.scriptId, scriptRevision: snap.scriptRevision,
        shotId: snap.shotId, shotRevision: snap.shotRevision, sceneId: snap.scene.id,
        role: step.role, productionId: plan.productionId,
      };
      db.prepare('INSERT INTO shot_canvas_binding(canvas_id,node_id,production_id,shot_id,shot_revision,binding_json) VALUES(?,?,?,?,?,?)')
        .run(plan.canvasId, step.nodeId, plan.productionId, step.shotId, step.shotRevision, JSON.stringify(binding));
    }
    db.prepare("UPDATE shot_production SET state='applied' WHERE production_id=?").run(plan.productionId);
    return read(plan.productionId);
  }
  function attach(input: AttachShotWorkflowInput): Result<ShotProductionView> {
    const production = read(input.productionId);
    if (!production.ok) return production;
    const { plan } = production.value;
    if (production.value.state !== 'applied') return fail('PRODUCTION_STOPPED', '生产批次尚未布置或已停止。');
    if (plan.executionOwner !== input.executionOwner) return fail('WRONG_OWNER', '执行身份不匹配。');
    if (production.value.workflowId) {
      return production.value.workflowId === input.workflowId ? production : fail('APPROVAL_REUSED', '批次已关联其他工作流。');
    }
    const workflow = workflows.read(input.workflowId);
    if (!workflow.ok) return workflow;
    const plannedNodeIds = plan.steps.map(step => step.nodeId).sort();
    const workflowNodeIds = workflow.value.plan.steps.map(step => step.nodeId).sort();
    const selectedNodeIds = workflow.value.plan.nodeIds.slice().sort();
    if (workflow.value.plan.projectId !== plan.projectId || workflow.value.canvasId !== plan.canvasId ||
        workflow.value.plan.executionOwner !== plan.executionOwner || workflow.value.plan.runId !== plan.runId ||
        workflow.value.state !== 'prepared' || !same(workflowNodeIds, plannedNodeIds) || !same(selectedNodeIds, plannedNodeIds)) {
      return fail('WORKFLOW_MISMATCH', '工作流步骤与冻结生产批次不匹配。');
    }
    db.prepare('UPDATE shot_production SET workflow_id=? WHERE production_id=?').run(input.workflowId, input.productionId);
    return read(input.productionId);
  }
  function stop(input: StopShotProductionInput): Result<ShotProductionView> {
    const production = read(input.productionId);
    if (!production.ok) return production;
    if (production.value.plan.executionOwner !== input.executionOwner) return fail('WRONG_OWNER', '执行身份不匹配。');
    if (production.value.state === 'stopped') return production;

    // Keep the production gate closed even if a P2 cancel action needs a later retry.
    if (production.value.state !== 'stopping') {
      db.prepare("UPDATE shot_production SET state='stopping' WHERE production_id=?").run(input.productionId);
    }
    if (production.value.workflowId) {
      const stopped = workflows.stop(production.value.workflowId);
      if (!stopped.ok) return read(input.productionId);
    }
    db.prepare("UPDATE shot_production SET state='stopped' WHERE production_id=?").run(input.productionId);
    return read(input.productionId);
  }
  function selectOutput(input: SelectShotProductionOutputInput): Result<ShotOutputSelection> {
    return creation.selectOutput(input);
  }
  type CollectionFailure = ShotHarvestReport['failures'][number];
  type CollectionOutcome = { collected: boolean; failure?: CollectionFailure };
  function issueId(productionId: string, nodeId: string | null, taskId: string | null): string {
    return `shot-issue-${digest([productionId, nodeId, taskId]).slice(0, 48)}`;
  }
  function recordIssue(productionId: string, nodeId: string | null, taskId: string | null, errorCode: string): CollectionFailure {
    const issue: ShotProductionCollectionIssue = {
      issueId: issueId(productionId, nodeId, taskId), productionId,
      nodeId, taskId, errorCode, createdAt: Date.now(),
    };
    try {
      db.prepare('INSERT INTO shot_production_collection_issue(issue_id,production_id,node_id,task_id,error_code,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(issue_id) DO NOTHING')
        .run(issue.issueId, issue.productionId, issue.nodeId, issue.taskId, issue.errorCode, issue.createdAt);
      const saved = issues(productionId).find(item => item.issueId === issue.issueId);
      return { ...(saved ?? issue), persisted: !!saved };
    } catch {
      // The caller still receives the failure even if a damaged database cannot save diagnostics.
      return { ...issue, persisted: false };
    }
  }
  function clearReadIssue(productionId: string, errorCode: 'PRODUCTION_READ_FAILED' | 'WORKFLOW_READ_FAILED'): void {
    db.prepare('DELETE FROM shot_production_collection_issue WHERE production_id=? AND node_id IS NULL AND task_id IS NULL AND error_code=?')
      .run(productionId, errorCode);
  }
  function collectOutput(production: ShotProductionView, step: WorkflowStepView): CollectionOutcome {
    if (!step.task) return { collected: false };
    const taskRow = db.prepare('SELECT view_json FROM task_attempt WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(step.task.taskId);
    if (!taskRow) return { collected: false };
    const task = JSON.parse(taskRow.view_json as string) as { state: string; artifactRef: MediaReference | null };
    if (task.state !== 'SUCCEEDED' || !task.artifactRef) return { collected: false };
    const alreadyCollected = db.prepare('SELECT 1 FROM shot_production_output WHERE production_id=? AND node_id=? AND task_id=?')
      .get(production.productionId, step.nodeId, step.task.taskId);
    if (alreadyCollected) return { collected: false };
    const planned = production.plan.steps.find(candidate => candidate.nodeId === step.nodeId);
    if (!planned) return { collected: false, failure: recordIssue(production.productionId, step.nodeId, step.task.taskId, 'COLLECTION_STEP_MISMATCH') };
    const snap = production.plan.snapshots.find(candidate => candidate.shotId === planned.shotId)!;

    try {
      db.exec('BEGIN IMMEDIATE');
      const current = creation.read({ projectId: production.projectId });
      let selected = false;
      let errorCode: string | null = null;
      if (!current.ok) {
        errorCode = current.error.code;
      } else {
        const currentShot = current.value.shots.find(candidate => candidate.id === snap.shotId);
        const currentSelection = current.value.selections.find(candidate => candidate.shotId === snap.shotId);
        // Both roles share one selectionRevision. Count only successful writes by this production;
        // any human or other production write remains an intervening CAS conflict.
        const ownSelections = outputs(production.productionId).filter(output => output.shotId === snap.shotId && output.selected).length;
        const expectedSelection = snap.selectionRevision + ownSelections;
        if (production.state !== 'applied') {
          errorCode = 'PRODUCTION_STOPPED';
        } else if (currentShot?.revision !== snap.shotRevision) {
          errorCode = 'REVISION_CONFLICT';
        } else if ((currentSelection?.selectionRevision ?? 0) !== expectedSelection) {
          errorCode = 'SELECTION_CONFLICT';
        } else {
          const selectedOutput = creation.selectOutput({
            projectId: production.projectId, shotId: snap.shotId,
            expectedRevision: snap.shotRevision, expectedSelectionRevision: expectedSelection,
            role: planned.role, reference: task.artifactRef,
          });
          if (selectedOutput.ok) {
            selected = true;
            db.prepare('INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,?,?)')
              .run(library.libraryId, 'creation.outputSelected', JSON.stringify(selectedOutput.value));
          } else {
            errorCode = selectedOutput.error.code;
          }
        }
      }
      const output: ShotProductionOutput = {
        libraryId: library.libraryId, productionId: production.productionId,
        shotId: snap.shotId, shotRevision: snap.shotRevision,
        role: planned.role, nodeId: step.nodeId, workflowId: production.workflowId!,
        stepId: step.stepId, taskId: step.task.taskId, reference: task.artifactRef,
        selected, errorCode, createdAt: Date.now(),
      };
      db.prepare('INSERT INTO shot_production_output(production_id,node_id,task_id,data_json) VALUES(?,?,?,?)')
        .run(production.productionId, step.nodeId, step.task.taskId, JSON.stringify(output));
      db.prepare('DELETE FROM shot_production_collection_issue WHERE issue_id=?')
        .run(issueId(production.productionId, step.nodeId, step.task.taskId));
      db.prepare('INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,?,?)')
        .run(library.libraryId, 'shots.outputCollected', JSON.stringify(output));
      db.exec('COMMIT');
      return { collected: true };
    } catch {
      try { db.exec('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      return { collected: false, failure: recordIssue(production.productionId, step.nodeId, step.task.taskId, 'COLLECTION_WRITE_FAILED') };
    }
  }
  function harvest(): Result<ShotHarvestReport> {
    const report: ShotHarvestReport = { collected: 0, failures: [] };
    let pending: Record<string, unknown>[];
    try {
      pending = db.prepare("SELECT production_id FROM shot_production WHERE workflow_id IS NOT NULL AND state IN ('applied','stopping','stopped')").all();
    } catch {
      return fail('PRODUCTION_COLLECTION_FAILED', '无法读取待收存的镜头生产批次。');
    }
    for (const item of pending) {
      const productionId = item.production_id as string;
      try {
        const production = read(productionId);
        if (!production.ok) {
          report.failures.push(recordIssue(productionId, null, null, 'PRODUCTION_READ_FAILED'));
          continue;
        }
        clearReadIssue(productionId, 'PRODUCTION_READ_FAILED');
        if (!production.value.workflowId) continue;
        let workflow: ReturnType<typeof workflows.read>;
        try {
          workflow = workflows.read(production.value.workflowId);
        } catch {
          report.failures.push(recordIssue(productionId, null, null, 'WORKFLOW_READ_FAILED'));
          continue;
        }
        if (!workflow.ok) {
          report.failures.push(recordIssue(productionId, null, null, 'WORKFLOW_READ_FAILED'));
          continue;
        }
        clearReadIssue(productionId, 'WORKFLOW_READ_FAILED');
        for (const step of workflow.value.steps) {
          try {
            const outcome = collectOutput(production.value, step);
            if (outcome.collected) report.collected += 1;
            if (outcome.failure) report.failures.push(outcome.failure);
          } catch {
            report.failures.push(recordIssue(productionId, step.nodeId, step.task?.taskId ?? null, 'COLLECTION_READ_FAILED'));
          }
        }
      } catch {
        report.failures.push(recordIssue(productionId, null, null, 'PRODUCTION_READ_FAILED'));
      }
    }
    return ok(report);
  }
  let timer: NodeJS.Timeout | undefined;
  function start(): Result<ShotHarvestReport> {
    if (!timer) {
      timer = setInterval(() => { try { harvest(); } catch { /* Retry on the next tick. */ } }, 500);
      timer.unref();
    }
    return harvest();
  }
  function pause(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  return { prepare, savePrepared, apply, attach, stop, selectOutput, read, collectionIssues, history, harvest, start, pause, resume: start, close: pause };
}
