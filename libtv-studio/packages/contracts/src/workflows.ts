import { isRecord, ok, fail, type Result } from './result.ts';
import { isPreparedGeneration, isTaskRef, type PreparedGeneration, type TaskRef } from './generation.ts';
import { isMediaReference, type MediaReference, type MediaMetadata } from './assets.ts';
import { isCanvasEdge, type CanvasEdge, type CanvasGraphInputs } from './canvas.ts';
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const money = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 1e12;
export interface WorkflowPrepareInput {
    canvasId: string;
    mode: 'current' | 'upstream' | 'selection';
    nodeIds: string[];
    executionOwner: string;
    runId: string;
}
export type WorkflowInput = {
    kind: 'text';
    targetPort: 'prompt';
    text: string;
} | {
    kind: 'media';
    targetPort: Exclude<CanvasEdge['targetPort'],'voice_reference'>;
    ref: MediaReference;
} | {
    kind: 'stepOutput';
    targetPort: Exclude<CanvasEdge['targetPort'],'voice_reference'>;
    stepId: string;
};
export interface WorkflowObservation {
    nodeId: string;
    incarnation: string;
    semanticRevision: number;
    selectionRevision: number;
}
export interface WorkflowStep extends WorkflowObservation {
    stepId: string;
    template: PreparedGeneration;
    graphInputs: CanvasGraphInputs;
    inputs: WorkflowInput[];
}
export interface WorkflowExternalInput {
    nodeId: string;
    provenance: 'fixed' | 'current' | 'unknown';
    ref: MediaReference;
    metadata: MediaMetadata;
}
export interface PreparedWorkflow extends WorkflowPrepareInput {
    libraryId: string;
    planId: string;
    planHash: string;
    projectId: string;
    observedRevision: number;
    expiresAt: number;
    observations: WorkflowObservation[];
    externalInputs: WorkflowExternalInput[];
    steps: WorkflowStep[];
    currency: string | null;
    estimateMicros: number | null;
    limits: {
        steps: 32;
        dependencies: 128;
    };
}
export interface WorkflowApproveInput {
    planId: string;
    approvedPlanHash: string;
    currency: string;
    budgetLimitMicros: number;
    stepAllowances: Record<string, number>;
    acknowledgeUnknown: boolean;
    executionOwner: string;
    runId: string;
}
export type WorkflowState = 'prepared' | 'running' | 'stopping' | 'succeeded' | 'failed' | 'stopped' | 'needs_attention';
export type WorkflowStepState = 'waiting' | 'queued' | 'running' | 'succeeded' | 'blocked' | 'failed' | 'stopped' | 'needs_attention';
export interface WorkflowStepView {
    stepId: string;
    nodeId: string;
    state: WorkflowStepState;
    task: TaskRef | null;
    reservationMicros: number;
    errorCode: string | null;
}
export interface WorkflowView {
    libraryId: string;
    workflowId: string;
    canvasId: string;
    state: WorkflowState;
    plan: PreparedWorkflow;
    steps: WorkflowStepView[];
    reservationMicros: number;
}
export interface WorkflowSnapshot {
    workflows: WorkflowView[];
    snapshotSeq: number;
    streamId: string;
}
export function parseWorkflowPrepare(v: unknown): Result<WorkflowPrepareInput> {
    return isRecord(v) && exact(v, ['canvasId', 'mode', 'nodeIds', 'executionOwner', 'runId']) && id(v.canvasId) && ['current', 'upstream', 'selection'].includes(v.mode as string) && Array.isArray(v.nodeIds) && v.nodeIds.length > 0 && v.nodeIds.length <= (v.mode === 'selection' ? 160 : 32) && v.nodeIds.every(id) && new Set(v.nodeIds).size === v.nodeIds.length && (v.mode !== 'current' || v.nodeIds.length === 1) && id(v.executionOwner) && id(v.runId) ? ok(structuredClone(v) as unknown as WorkflowPrepareInput) : fail('INVALID_INPUT', '执行计划范围无效。');
}
export function parseWorkflowApprove(v: unknown): Result<WorkflowApproveInput> {
    return isRecord(v) && exact(v, ['planId', 'approvedPlanHash', 'currency', 'budgetLimitMicros', 'stepAllowances', 'acknowledgeUnknown', 'executionOwner', 'runId']) && id(v.planId) && typeof v.approvedPlanHash === 'string' && /^[a-f0-9]{64}$/.test(v.approvedPlanHash) && typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency) && money(v.budgetLimitMicros) && isRecord(v.stepAllowances) && Object.keys(v.stepAllowances).length <= 32 && Object.entries(v.stepAllowances).every(([k, n]) => id(k) && money(n)) && typeof v.acknowledgeUnknown === 'boolean' && id(v.executionOwner) && id(v.runId) ? ok(structuredClone(v) as unknown as WorkflowApproveInput) : fail('INVALID_INPUT', '批准需要每步有限额度、币种和执行身份。');
}
export function parseWorkflowId(v: unknown): Result<{
    workflowId: string;
}> { return isRecord(v) && exact(v, ['workflowId']) && id(v.workflowId) ? ok({ workflowId: v.workflowId }) : fail('INVALID_INPUT', '工作流身份无效。'); }
function observation(v: unknown): v is WorkflowObservation { return isRecord(v) && id(v.nodeId) && id(v.incarnation) && [v.semanticRevision, v.selectionRevision].every(n => Number.isSafeInteger(n) && (n as number) > 0); }
function input(v: unknown): v is WorkflowInput { return isRecord(v) && ['prompt', 'reference', 'first_frame', 'last_frame'].includes(v.targetPort as string) && (v.kind === 'text' && exact(v, ['kind', 'targetPort', 'text']) && v.targetPort === 'prompt' && typeof v.text === 'string' && v.text.length <= 16000 || v.kind === 'media' && exact(v, ['kind', 'targetPort', 'ref']) && isMediaReference(v.ref) || v.kind === 'stepOutput' && exact(v, ['kind', 'targetPort', 'stepId']) && id(v.stepId)); }
export function isPreparedWorkflow(v: unknown): v is PreparedWorkflow {
    if (!isRecord(v) || !exact(v, ['canvasId', 'mode', 'nodeIds', 'executionOwner', 'runId', 'libraryId', 'planId', 'planHash', 'projectId', 'observedRevision', 'expiresAt', 'observations', 'externalInputs', 'steps', 'currency', 'estimateMicros', 'limits']))
        return false;
    const { canvasId, mode, nodeIds, executionOwner, runId } = v;
    return parseWorkflowPrepare({ canvasId, mode, nodeIds, executionOwner, runId }).ok && id(v.libraryId) && id(v.planId) && id(v.projectId) && typeof v.planHash === 'string' && /^[a-f0-9]{64}$/.test(v.planHash) && Number.isSafeInteger(v.observedRevision) && Number.isSafeInteger(v.expiresAt) && Array.isArray(v.observations) && v.observations.length <= 160 && v.observations.every(observation) && Array.isArray(v.externalInputs) && v.externalInputs.length <= 128 && v.externalInputs.every(e => isRecord(e) && exact(e, ['nodeId', 'provenance', 'ref', 'metadata']) && id(e.nodeId) && ['fixed', 'current', 'unknown'].includes(e.provenance as string) && isMediaReference(e.ref) && e.ref.libraryId === v.libraryId && metadata(e.metadata)) && Array.isArray(v.steps) && v.steps.length > 0 && v.steps.length <= 32 && v.steps.every(s => observation(s) && isRecord(s) && exact(s, ['stepId', 'nodeId', 'incarnation', 'semanticRevision', 'selectionRevision', 'template', 'graphInputs', 'inputs']) && id(s.stepId) && isPreparedGeneration(s.template) && s.template.libraryId === v.libraryId && isRecord(s.graphInputs) && exact(s.graphInputs, ['edges', 'nodes']) && Array.isArray(s.graphInputs.edges) && s.graphInputs.edges.length <= 128 && s.graphInputs.edges.every(isCanvasEdge) && Array.isArray(s.graphInputs.nodes) && s.graphInputs.nodes.every(n => observation(n) && isRecord(n) && exact(n, ['nodeId', 'incarnation', 'semanticRevision', 'selectionRevision', 'selectedOutput']) && (n.selectedOutput === null || isMediaReference(n.selectedOutput) && n.selectedOutput.libraryId === v.libraryId)) && Array.isArray(s.inputs) && s.inputs.length <= 128 && s.inputs.every(input)) && (v.currency === null || typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency)) && (v.estimateMicros === null || Number.isSafeInteger(v.estimateMicros) && (v.estimateMicros as number) >= 0) && isRecord(v.limits) && exact(v.limits, ['steps', 'dependencies']) && v.limits.steps === 32 && v.limits.dependencies === 128;
}
export function isWorkflowView(v: unknown): v is WorkflowView { return isRecord(v) && exact(v, ['libraryId', 'workflowId', 'canvasId', 'state', 'plan', 'steps', 'reservationMicros']) && id(v.libraryId) && id(v.workflowId) && id(v.canvasId) && ['prepared', 'running', 'stopping', 'succeeded', 'failed', 'stopped', 'needs_attention'].includes(v.state as string) && isPreparedWorkflow(v.plan) && v.plan.libraryId === v.libraryId && v.plan.planId === v.workflowId && Array.isArray(v.steps) && v.steps.length === v.plan.steps.length && v.steps.every(s => isRecord(s) && exact(s, ['stepId', 'nodeId', 'state', 'task', 'reservationMicros', 'errorCode']) && id(s.stepId) && id(s.nodeId) && ['waiting', 'queued', 'running', 'succeeded', 'blocked', 'failed', 'stopped', 'needs_attention'].includes(s.state as string) && (s.task === null || isTaskRef(s.task) && s.task.libraryId === v.libraryId) && Number.isSafeInteger(s.reservationMicros) && (s.reservationMicros as number) >= 0 && (s.errorCode === null || typeof s.errorCode === 'string')) && Number.isSafeInteger(v.reservationMicros) && (v.reservationMicros as number) >= 0; }
export function isWorkflowSnapshot(v: unknown): v is WorkflowSnapshot { return isRecord(v) && exact(v, ['workflows', 'snapshotSeq', 'streamId']) && Array.isArray(v.workflows) && v.workflows.every(isWorkflowView) && Number.isSafeInteger(v.snapshotSeq) && (v.snapshotSeq as number) >= 0 && id(v.streamId); }
function metadata(v: unknown): v is MediaMetadata { return isRecord(v) && exact(v, ['hash', 'mime', 'byteLength', 'width', 'height']) && typeof v.hash === 'string' && /^[a-f0-9]{64}$/.test(v.hash) && ['text/plain', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4','audio/wav','audio/mpeg','audio/mp4'].includes(v.mime as string) && Number.isSafeInteger(v.byteLength) && (v.byteLength as number) > 0 && [v.width, v.height].every(n => Number.isSafeInteger(n) && (n as number) >= 0); }
