import {validateReferenceShape} from '../../domain/src/reference-inputs.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { isPreparedWorkflow, type PreparedWorkflow, type WorkflowPrepareInput, type WorkflowApproveInput, type WorkflowView, type WorkflowSnapshot, type WorkflowInput, type WorkflowObservation, type WorkflowStepState } from '../../contracts/src/workflows.ts';
import { isFrozenReferenceImage, type FrozenReferenceImage, type PreparedGeneration } from '../../contracts/src/generation.ts';
import type { MediaReference } from '../../contracts/src/assets.ts';
import { freezeRunConfig } from '../../domain/src/model-config.ts';
import { estimateMicros } from '../../domain/src/approval.ts';
import { graphScope, validateGraph, graphInputSnapshot } from '../../domain/src/graph-plan.ts';
import type { canvasFor } from './canvas-service.ts';
import type { generationFor } from './generation-service.ts';
import type { modelConfigFor } from './model-config-service.ts';
import type { assetsFor } from './asset-service.ts';
import { workflowCoordinator } from './workflow-scheduler.ts';
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function workflowsFor(library: LibraryHandle, canvas: ReturnType<typeof canvasFor>, generation: ReturnType<typeof generationFor>, models: ReturnType<typeof modelConfigFor>, assets: ReturnType<typeof assetsFor>) {
    function atomic<T>(work: () => Result<T>): Result<T> {
        const own = library.checkOwnership();
        if (!own.ok)
            return own;
        try {
            library.db.exec('BEGIN IMMEDIATE');
            const result = work();
            library.db.exec(result.ok ? 'COMMIT' : 'ROLLBACK');
            return result;
        }
        catch {
            try {
                library.db.exec('ROLLBACK');
            }
            catch { }
            return fail('WORKFLOW_COMMIT_FAILED', '工作流事务未提交。');
        }
    }
    const stored = (id: string) => library.db.prepare('SELECT * FROM workflow WHERE plan_id=?').get(id);
    const rows = (id: string) => library.db.prepare('SELECT * FROM workflow_step WHERE workflow_id=? ORDER BY rowid').all(id);
    function read(workflowId: string): Result<WorkflowView> {
        const own = library.checkOwnership();
        if (!own.ok)
            return own;
        const row = stored(workflowId);
        if (!row)
            return fail('WORKFLOW_NOT_FOUND', '工作流不存在。');
        const plan = JSON.parse(row.plan_json as string) as PreparedWorkflow;
        const steps = rows(workflowId).map(r => { const task = r.task_id ? generation.read(r.task_id as string) : null; const t = task?.ok ? task.value : null; return { stepId: r.step_id as string, nodeId: plan.steps.find(s => s.stepId === r.step_id)!.nodeId, state: r.state as WorkflowStepState, task: t ? { libraryId: library.libraryId, taskId: t.taskId, attemptId: t.attemptId } : null, reservationMicros: Number(r.reservation_micros) + (t?.reservationMicros ?? 0), errorCode: r.error_code as string | null }; });
        return ok({ libraryId: library.libraryId, workflowId, canvasId: plan.canvasId, state: row.state as WorkflowView['state'], plan, steps, reservationMicros: steps.reduce((n, s) => n + s.reservationMicros, 0) });
    }
    function list(): WorkflowSnapshot { return { workflows: library.db.prepare('SELECT plan_id FROM workflow ORDER BY rowid').all().map(r => { const w = read(r.plan_id as string); if (!w.ok)
            throw Error(w.error.code); return w.value; }), snapshotSeq: Number(library.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM domain_event').get()!.seq), streamId: library.db.prepare('SELECT stream_id FROM event_stream WHERE singleton=1').get()!.stream_id as string }; }
    function notify(id: string) { const view = read(id); if (view.ok)
        library.db.prepare('INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,?,?)').run(library.libraryId, 'workflow.changed', JSON.stringify(view.value)); }
    function observationsCurrent(plan: PreparedWorkflow): Result<void> {
        for (const observed of plan.observations) {
            const node = canvas.currentNode(plan.canvasId, observed.nodeId);
            if (!node || node.incarnation !== observed.incarnation || node.semanticRevision !== observed.semanticRevision || node.selectionRevision !== observed.selectionRevision)
                return fail('INPUT_CHANGED', '计划的节点内容、连接或选择已变化，请重新准备。');
        }
        return ok(undefined);
    }
    async function text(ref: MediaReference, selectable: boolean): Promise<Result<string>> {
        const metadata = selectable ? assets.assertSelectable(ref) : assets.metadata(ref);
        if (!metadata.ok)
            return metadata;
        if (metadata.value.mime !== 'text/plain')
            return fail('GRAPH_TYPE_MISMATCH', '提示词依赖必须为文本。');
        const original = await assets.readFixedOriginal(ref, metadata.value);
        if (!original.ok)
            return original;
        const content = new TextDecoder('utf-8', { fatal: true }).decode(original.value.bytes);
        return content.length <= 16000 && !/[\u0000\u007f]/.test(content) ? ok(content) : fail('WORKFLOW_INPUT_LIMIT', '文本依赖超过目标提示词限制；未截断或替换。');
    }
    /** Async fixed-original preflight; savePrepared rechecks observations inside the receipt transaction. */
    async function prepare(input: WorkflowPrepareInput): Promise<Result<PreparedWorkflow>> {
        const snapshot = canvas.read(input.canvasId);
        if (!snapshot.ok)
            return snapshot;
        const graph = validateGraph(snapshot.value.nodes, snapshot.value.edges, canvas.typeOf);
        if (!graph.ok)
            return graph;
        const scope = graphScope(snapshot.value, input.mode, input.nodeIds);
        if (!scope.ok)
            return scope;
        const bound=scope.value.filter(node=>canvas.shotBinding(input.canvasId,node.nodeId));
        if(bound.length){
            const productionIds=new Set(bound.map(node=>canvas.shotBinding(input.canvasId,node.nodeId)!.productionId));
            if(productionIds.size!==1||input.mode!=='selection')return fail('SHOT_BOUND','镜头绑定节点须按完整生产批次准备工作流。');
            const production=library.db.prepare('SELECT plan_json,state FROM shot_production WHERE production_id=?').get([...productionIds][0]!);
            if(!production||production.state!=='applied')return fail('PRODUCTION_STOPPED','镜头生产批次已停止。');
            const shotPlan=JSON.parse(production.plan_json as string) as {executionOwner:string;runId:string;steps:{nodeId:string}[]};
            const planned=shotPlan.steps.map(step=>step.nodeId).sort(),selected=input.nodeIds.slice().sort();
            if(shotPlan.executionOwner!==input.executionOwner||shotPlan.runId!==input.runId||JSON.stringify(planned)!==JSON.stringify(selected))return fail('WORKFLOW_MISMATCH','工作流必须包含同一批次的全部镜头节点与执行身份。');
        }
        const planId = randomUUID(), expiresAt = generation.now() + 300000, steps: PreparedWorkflow['steps'] = [], externalInputs: PreparedWorkflow['externalInputs'] = [], observed = new Map<string, WorkflowObservation>();
        const observe = (node: WorkflowObservation) => observed.set(node.nodeId, { nodeId: node.nodeId, incarnation: node.incarnation, semanticRevision: node.semanticRevision, selectionRevision: node.selectionRevision });
        for (const node of scope.value) {
            if (node.content.type !== 'generation')
                continue;
            observe(node);
            const profileRef = node.content.profileRef;
            const profile = models.listProfiles().profiles.find(p => p.id === profileRef.id && p.revision === profileRef.revision);
            const model = profile && models.listModels().models.find(m => m.id === profile.modelRef.id && m.revision === profile.modelRef.revision);
            const connection = model && models.listConnections().connections.find(c => c.id === model.connectionRef.id && c.revision === model.connectionRef.revision);
            if (!profile || !model || !connection)
                return fail('REVISION_NOT_FOUND', '固定模型配置不存在。');
            const config = freezeRunConfig(connection, model, profile);
            if (!config.ok)
                return config;
            const estimate = estimateMicros(config.value);
            if (!estimate.ok)
                return estimate;
            const inputs: WorkflowInput[] = [];
            for (const old of node.content.inputs) {
                const fixed = canvas.fixedText(input.canvasId, old);
                if (fixed === null)
                    return fail('INPUT_NOT_FOUND', '固定文本版本不存在。');
                inputs.push({ kind: 'text', targetPort: 'prompt', text: fixed });
            }
            const references: FrozenReferenceImage[] = [];
            for (const reference of node.content.referenceImages ?? []) {
                const metadata = assets.assertSelectable(reference.ref);
                if (!metadata.ok)
                    return metadata;
                const frozen = { ...reference, ...metadata.value };
                if (!isFrozenReferenceImage(frozen))
                    return fail('INVALID_REFERENCE', '参考图不符合限制。');
                references.push(frozen);
            }
            for (const edge of snapshot.value.edges.filter(e => e.targetNodeId === node.nodeId).sort((a, b) => a.id.localeCompare(b.id))) {
                const source = snapshot.value.nodes.find(n => n.nodeId === edge.sourceNodeId)!;
                observe(source);
                if (scope.value.some(n => n.nodeId === source.nodeId)) {
                    inputs.push({ kind: 'stepOutput', targetPort: edge.targetPort, stepId: source.nodeId });
                    continue;
                }
                if (source.content.type === 'text') {
                    inputs.push({ kind: 'text', targetPort: 'prompt', text: source.content.text });
                    continue;
                }
                const ref = 'media' in source.content ? source.content.media : source.selectedOutput;
                if (!ref || source.content.type === 'generation' && source.freshness === 'stale')
                    return fail('WORKFLOW_INPUT_UNAVAILABLE', '范围外的上游缺少明确且有效的固定输出。');
                const metadata = assets.assertSelectable(ref);
                if (!metadata.ok)
                    return metadata;
                externalInputs.push({ nodeId: source.nodeId, provenance: source.content.type === 'generation' ? (source.freshness === 'current' ? 'current' : 'unknown') : 'fixed', ref, metadata: metadata.value });
                if (edge.targetPort === 'prompt') {
                    const fixed = await text(ref, true);
                    if (!fixed.ok)
                        return fixed;
                    inputs.push({ kind: 'text', targetPort: 'prompt', text: fixed.value });
                }
                else
                    inputs.push({ kind: 'media', targetPort: edge.targetPort, ref });
            }
            const base = { libraryId: library.libraryId, preparedId: `wf-${digest([planId, node.nodeId])}`, projectId: snapshot.value.projectId, inputVersion: `${node.incarnation}_${node.semanticRevision}`, executionOwner: input.executionOwner, runId: input.runId, prompt: node.content.prompt || ' ', expiresAt, config: config.value, adapterId: connection.adapterType, estimateMicros: estimate.value, currency: model.pricing.status === 'configured' ? model.pricing.currency : null, referenceImages: references, canvasInput: { canvasId: input.canvasId, nodeId: node.nodeId, incarnation: node.incarnation, semanticRevision: node.semanticRevision } };
            const template: PreparedGeneration = { ...base, planHash: digest(base) };
            const known=[...references];
            for(const input of inputs)if(input.kind==='media'&&input.targetPort!=='prompt'){
              const original=externalInputs.find(e=>JSON.stringify(e.ref)===JSON.stringify(input.ref))!;
              const frozen={role:input.targetPort,ref:input.ref,...original.metadata};
              if(!isFrozenReferenceImage(frozen))return fail('INVALID_REFERENCE','固定参考图不符合限制。');
              known.push(frozen);
            }
            const roles=[...references.map(r=>r.role),...inputs.flatMap(i=>i.targetPort==='prompt'?[]:[i.targetPort])];
            const shape=validateReferenceShape(template,roles,known);if(!shape.ok)return shape;
            const current = generation.checkCurrent(template);
            if (!current.ok)
                return current;
            steps.push({ stepId: node.nodeId, nodeId: node.nodeId, incarnation: node.incarnation, semanticRevision: node.semanticRevision, selectionRevision: node.selectionRevision, template, graphInputs: graphInputSnapshot(snapshot.value.nodes, snapshot.value.edges, node.nodeId), inputs });
        }
        const provenanceEdges=new Set(steps.flatMap(step=>step.graphInputs.edges.map(edge=>edge.id)));
        if(provenanceEdges.size>128)return fail('GRAPH_LIMIT','目标输入来源闭包超过128条依赖，请缩小执行范围或使用固定媒体节点。');
        for (const step of steps)
            for (const source of step.graphInputs.nodes)
                observe(source);
        const currencies = new Set(steps.map(s => s.template.currency).filter(c => c !== null));
        if (currencies.size > 1)
            return fail('WORKFLOW_MIXED_CURRENCY', '请先统一计划中模型报价币种。');
        if (steps.reduce((n, s) => n + s.inputs.length, 0) > 128)
            return fail('GRAPH_LIMIT', '计划最多128条依赖。');
        const base = { ...input, libraryId: library.libraryId, planId, projectId: snapshot.value.projectId, observedRevision: snapshot.value.revision, expiresAt, observations: [...observed.values()], externalInputs, steps, currency: [...currencies][0] ?? null, estimateMicros: steps.some(s => s.template.estimateMicros === null) ? null : steps.reduce((n, s) => n + s.template.estimateMicros!, 0), limits: { steps: 32 as const, dependencies: 128 as const } };
        const plan = { ...base, planHash: digest(base) };
        for(const step of steps)if(!step.inputs.some(i=>i.kind==='stepOutput')){
          const resolved=await resolve(plan,step.stepId);if(!resolved.ok)return resolved;
          const adapter=generation.adapterFor(step.template.adapterId);
          if(!adapter)return fail('PROVIDER_UNAVAILABLE','适配器不可用。');
          const valid=adapter.validate({...step.template,...resolved.value});if(!valid.ok)return valid;
        }
        return isPreparedWorkflow(plan) ? ok(plan) : fail('INVALID_WORKFLOW', '计划数据无效。');
    }
    function savePrepared(plan: PreparedWorkflow): Result<PreparedWorkflow> { const current = observationsCurrent(plan); if (!current.ok)
        return current; library.db.prepare("INSERT INTO workflow(plan_id,canvas_id,project_id,plan_json,state) VALUES(?,?,?,?,'prepared')").run(plan.planId, plan.canvasId, plan.projectId, JSON.stringify(plan)); for (const step of plan.steps)
        library.db.prepare("INSERT INTO workflow_step(workflow_id,step_id,command_id,state) VALUES(?,?,?,'waiting')").run(plan.planId, step.stepId, step.template.preparedId); return ok(plan); }
    function approve(input: WorkflowApproveInput): Result<WorkflowView> {
        const row = stored(input.planId);
        if (!row)
            return fail('WORKFLOW_NOT_FOUND', '计划不存在。');
        if (row.approval_json)
            return row.approval_json === JSON.stringify(input) ? read(input.planId) : fail('APPROVAL_REUSED', '批准范围已经消费。');
        if (row.state !== 'prepared')
            return fail('WORKFLOW_STOPPED', '已停止的计划不能重新批准。');
        const plan = JSON.parse(row.plan_json as string) as PreparedWorkflow;
        const bound=plan.steps.filter(step=>canvas.shotBinding(plan.canvasId,step.nodeId));
        if(bound.length){
            const productionIds=new Set(bound.map(step=>canvas.shotBinding(plan.canvasId,step.nodeId)!.productionId));
            const production=productionIds.size===1?library.db.prepare('SELECT workflow_id,state FROM shot_production WHERE production_id=?').get([...productionIds][0]!):undefined;
            if(!production||production.state!=='applied'||production.workflow_id!==plan.planId)return fail('SHOT_BOUND','须先将完整工作流关联到正在运行的镜头生产批次。');
        }
        if (plan.expiresAt <= generation.now())
            return fail('APPROVAL_EXPIRED', '计划已到期。');
        if (plan.planHash !== input.approvedPlanHash || plan.executionOwner !== input.executionOwner || plan.runId !== input.runId)
            return fail('APPROVAL_MISMATCH', '批准与冻结计划不符。');
        const current = observationsCurrent(plan);
        if (!current.ok)
            return current;
        for (const observation of plan.observations) {
            if (plan.steps.some(s => s.nodeId === observation.nodeId))
                continue;
            const node = canvas.currentNode(plan.canvasId, observation.nodeId)!;
            const ref = 'media' in node.content ? node.content.media : node.selectedOutput;
            if (ref) {
                const selected = assets.assertSelectable(ref);
                if (!selected.ok)
                    return selected;
            }
        }
        if (plan.currency !== null && plan.currency !== input.currency)
            return fail('CURRENCY_MISMATCH', '批准币种与报价不符。');
        if (Object.keys(input.stepAllowances).length !== plan.steps.length)
            return fail('APPROVAL_MISMATCH', '必须批准每个且仅计划内的步骤。');
        let total = 0;
        for (const step of plan.steps) {
            const allowance = input.stepAllowances[step.stepId];
            if (!Number.isSafeInteger(allowance) || !allowance || allowance < 1 || step.template.estimateMicros !== null && allowance < step.template.estimateMicros || step.template.estimateMicros === null && !input.acknowledgeUnknown)
                return fail('ALLOWANCE_REQUIRED', '每步需要充足有限额度，未知价格需要明确确认。');
            total += allowance;
            const fresh = generation.checkCurrent(step.template);
            if (!fresh.ok)
                return fresh;
            for (const ref of [...(step.template.referenceImages ?? []).map(r => r.ref), ...step.inputs.filter(i => i.kind === 'media').map(i => i.ref)]) {
                const selected = assets.assertSelectable(ref);
                if (!selected.ok)
                    return selected;
            }
        }
        const used = Number(library.db.prepare('SELECT COALESCE(SUM(reservation_micros),0) AS total FROM generation_task WHERE project_id=? AND currency=?').get(plan.projectId, input.currency)!.total) + generation.waitingReservations(plan.projectId, input.currency);
        if (!Number.isSafeInteger(total) || used > input.budgetLimitMicros - total)
            return fail('BUDGET_EXCEEDED', '项目预算不足；等待步骤与未知账单均占用额度。');
        library.db.prepare("UPDATE workflow SET approval_json=?,state='running' WHERE plan_id=?").run(JSON.stringify(input), input.planId);
        for (const step of plan.steps)
            library.db.prepare('UPDATE workflow_step SET reservation_micros=?,currency=? WHERE workflow_id=? AND step_id=?').run(input.stepAllowances[step.stepId]!, input.currency, input.planId, step.stepId);
        return read(input.planId);
    }
    function stop(workflowId: string): Result<WorkflowView> {
        const row = stored(workflowId);
        if (!row)
            return fail('WORKFLOW_NOT_FOUND', '工作流不存在。');
        if (['succeeded', 'failed', 'stopped'].includes(row.state as string))
            return read(workflowId);
        library.db.prepare("UPDATE workflow SET state='stopping' WHERE plan_id=?").run(workflowId);
        for (const step of rows(workflowId)) {
            if (step.task_id) {
                const cancelled = generation.cancel(step.task_id as string);
                if (!cancelled.ok)
                    return cancelled;
            }
            else
                library.db.prepare("UPDATE workflow_step SET state='stopped',reservation_micros=0 WHERE workflow_id=? AND step_id=?").run(workflowId, step.step_id as string);
        }
        refresh(workflowId);
        return read(workflowId);
    }
    function refresh(id: string) {
        const row = stored(id)!;
        for (const step of rows(id)) {
            if (!step.task_id)
                continue;
            const task = generation.read(step.task_id as string);
            if (!task.ok)
                continue;
            const t = task.value;
            const state: WorkflowStepState = t.state === 'SUCCEEDED' ? 'succeeded' : t.state === 'FAILED' || t.collectionState === 'unrecoverable' ? 'failed' : t.state === 'CANCELLED' ? 'stopped' : ['SUBMISSION_UNKNOWN', 'RECONCILE_REQUIRED'].includes(t.state) ? 'needs_attention' : t.state === 'QUEUED' ? 'queued' : 'running';
            library.db.prepare('UPDATE workflow_step SET state=?,error_code=? WHERE workflow_id=? AND step_id=?').run(state, t.errorCode, id, step.step_id as string);
        }
        const states = rows(id).map(s => s.state as string), pending = states.some(s => ['waiting', 'queued', 'running'].includes(s));
        const state = row.state === 'stopping' || row.state === 'stopped' ? (pending || states.includes('needs_attention') ? 'stopping' : 'stopped') : states.includes('needs_attention') ? 'needs_attention' : pending ? 'running' : states.every(s => s === 'succeeded') ? 'succeeded' : 'failed';
        library.db.prepare('UPDATE workflow SET state=? WHERE plan_id=?').run(state, id);
    }
    async function resolve(plan: PreparedWorkflow, stepId: string): Promise<Result<{
        prompt: string;
        referenceImages: FrozenReferenceImage[];
    }>> {
        const step = plan.steps.find(s => s.stepId === stepId)!, parts = [step.template.prompt], references = [...(step.template.referenceImages ?? [])];
        for (const input of step.inputs) {
            if (input.kind === 'text') {
                parts.push(input.text);
                continue;
            }
            let ref: MediaReference;
            if (input.kind === 'media')
                ref = input.ref;
            else {
                const source = rows(plan.planId).find(r => r.step_id === input.stepId);
                const task = source?.task_id ? generation.read(source.task_id as string) : null;
                if (!task?.ok || task.value.collectionState !== 'durable' || !task.value.artifactRef)
                    return fail('WORKFLOW_INPUT_UNAVAILABLE', '依赖产物尚未持久保存。');
                ref = task.value.artifactRef;
            }
            if (input.targetPort === 'prompt') {
                const fixed = await text(ref, false);
                if (!fixed.ok)
                    return fixed;
                parts.push(fixed.value);
            }
            else {
                const metadata = input.kind === 'media' ? ok(plan.externalInputs.find(e => JSON.stringify(e.ref) === JSON.stringify(ref))!.metadata) : assets.metadata(ref);
                if (!metadata.ok)
                    return metadata;
                const frozen = { role: input.targetPort, ref, ...metadata.value };
                if (!isFrozenReferenceImage(frozen))
                    return fail('INVALID_REFERENCE', '依赖图片不符合限制。');
                references.push(frozen);
            }
        }
        const prompt = parts.filter(p => p.trim()).join('\n\n');
        return prompt.length > 0 && prompt.length <= 16000 && references.length <= 4 ? ok({ prompt, referenceImages: references }) : fail('WORKFLOW_INPUT_LIMIT', '依赖超过目标提示词或参考图限制；未截断。');
    }
    async function tick(stopping: () => boolean): Promise<Result<void>> {
        const own = library.checkOwnership();
        if (!own.ok)
            return own;
        for (const row of library.db.prepare("SELECT plan_id FROM workflow WHERE approval_json IS NOT NULL AND state IN ('running','needs_attention','stopping') ORDER BY rowid").all()) {
            if (stopping())
                break;
            const id = row.plan_id as string, plan = JSON.parse(stored(id)!.plan_json as string) as PreparedWorkflow;
            const before=JSON.stringify(read(id));
            const refreshed = atomic(() => { refresh(id); return ok(undefined); });
            if (!refreshed.ok)
                return refreshed;
            for (const step of plan.steps) {
                if (stopping())
                    break;
                const all = rows(id), current = all.find(r => r.step_id === step.stepId)!;
                if (current.state !== 'waiting' || !['running', 'needs_attention'].includes(stored(id)!.state as string))
                    continue;
                const dependencies = step.inputs.filter(i => i.kind === 'stepOutput').map(i => all.find(r => r.step_id === i.stepId)!);
                if (dependencies.some(r => ['failed', 'blocked', 'stopped', 'needs_attention'].includes(r.state as string))) {
                    atomic(() => { library.db.prepare("UPDATE workflow_step SET state='blocked',reservation_micros=0,error_code='DEPENDENCY_FAILED' WHERE workflow_id=? AND step_id=? AND state='waiting'").run(id, step.stepId); return ok(undefined); });
                    continue;
                }
                if (dependencies.some(r => r.state !== 'succeeded'))
                    continue;
                const resolved = await resolve(plan, step.stepId);
                if (stopping())
                    break;
                // Stop and creation serialize here, after all asynchronous reads and before any child receipt.
                const admitted = atomic(() => { if (!['running', 'needs_attention'].includes(stored(id)!.state as string))
                    return ok(undefined); return resolved.ok ? generation.enqueueWorkflowStep(id, step.stepId, resolved.value) : resolved; });
                if (!admitted.ok && admitted.error.code === 'WORKFLOW_COMMIT_FAILED')
                    return admitted;
                if (!admitted.ok) {
                    const failed = atomic(() => { library.db.prepare("UPDATE workflow_step SET state='failed',reservation_micros=0,error_code=? WHERE workflow_id=? AND step_id=? AND state='waiting'").run(admitted.error.code, id, step.stepId); return ok(undefined); });
                    if (!failed.ok)
                        return failed;
                }
            }
            const done = atomic(() => { refresh(id); if(JSON.stringify(read(id))!==before)notify(id); return ok(undefined); });
            if (!done.ok)
                return done;
        }
        return ok(undefined);
    }
    const coordinator = workflowCoordinator(tick);
    return { prepare, savePrepared, approve, read, list, stop, ...coordinator };
}
