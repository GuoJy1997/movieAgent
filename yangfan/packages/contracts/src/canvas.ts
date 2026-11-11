import { isMediaReference, isArtifactRef, type MediaReference, type ArtifactRef } from './assets.ts';
import { isRevisionRef, type RevisionRef } from './models.ts';
import { fail, isRecord, ok, type Result } from './result.ts';
import { isReferenceImageInput,isVoiceBinding,type VoiceBinding, type ReferenceImageInput, type TaskState } from './generation.ts';
import type { ShotBinding } from './shot-production.ts';

const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 16000 && !/[\u0000\u007f]/.test(v);
export interface CanvasLayout { x: number; y: number }
/** A chosen text revision is immutable, including when the live source is edited or deleted. */
export interface FixedTextInput { nodeId: string; incarnation: string; semanticRevision: number }
export type CanvasContent =
  | { type: 'text'; text: string }
  | { type: 'image' | 'media'; media: MediaReference; voiceBinding?:VoiceBinding }
  | { type: 'generation'; prompt: string; profileRef: RevisionRef; inputs: FixedTextInput[]; referenceImages?: ReferenceImageInput[] };
export interface CanvasInputOwnership extends FixedTextInput { canvasId: string }
export interface CanvasNode {
  nodeId: string;
  incarnation: string;
  semanticRevision: number;
  layoutRevision: number;
  selectionRevision: number;
  content: CanvasContent;
  layout: CanvasLayout;
  selectedOutput: MediaReference | null;
  activeRunBindingId: string | null;
}
export type OutputFreshness = 'none' | 'current' | 'stale' | 'unknown';
export type SelectionReason = 'current' | 'deleted' | 'incarnation' | 'semantic' | 'run' | 'selection';
export interface CanvasNodeView extends CanvasNode {
  /** Null for text/image nodes; provenance uncertainty never forces another generation. */
  freshness: OutputFreshness | null;
  activeTask: { taskId: string; state: TaskState } | null;
  shotBinding?: ShotBinding | null;
}
export interface CanvasEdge { id: string; sourceNodeId: string; sourceIncarnation: string; targetNodeId: string; targetIncarnation: string; sourcePort: 'output'; targetPort: 'prompt' | 'reference' | 'first_frame' | 'last_frame'|'voice_reference' }
export interface CanvasGraphInputs {edges:CanvasEdge[];nodes:{nodeId:string;incarnation:string;semanticRevision:number;selectionRevision:number;selectedOutput:MediaReference|null}[]}
export type CanvasOperation =
  | { kind: 'addEdge'; edge: CanvasEdge }
  | { kind: 'removeEdge'; edgeId: string }
  | { kind: 'create'; nodeId: string; content: CanvasContent; layout: CanvasLayout }
  | { kind: 'setContent'; nodeId: string; incarnation: string; expectedRevision: number; content: CanvasContent }
  | { kind: 'setLayout'; nodeId: string; incarnation: string; expectedRevision: number; layout: CanvasLayout }
  | { kind: 'selectOutput'; nodeId: string; incarnation: string; expectedRevision: number; output: MediaReference | null }
  | { kind: 'delete'; nodeId: string; incarnation: string; expectedSemanticRevision: number; expectedLayoutRevision: number; expectedSelectionRevision: number; expectedRunBindingId: string | null };
export type CanvasCommand = { canvasId: string; baseRevision: number } & (
  { operations: CanvasOperation[]; undoCommandId?: never } | { undoCommandId: string; operations?: never });
export interface CanvasCommit { libraryId: string; canvasId: string; commandId: string; revision: number; changedNodeIds: string[]; skipped: string[] }
export interface RunBinding extends CanvasInputOwnership {
  libraryId: string;
  runBindingId: string;
  taskId: string;
  selectionRevision: number;
}
export interface CanvasOutput {
  runBindingId: string;
  taskId: string;
  nodeId: string;
  incarnation: string;
  semanticRevision: number;
  artifactRef: ArtifactRef;
  /** Records the original attachment decision; later manual selection does not rewrite history. */
  selection: 'selected' | 'history';
  reason: SelectionReason;
}
export interface CanvasSnapshot {
  libraryId: string;
  canvasId: string;
  projectId: string;
  revision: number;
  nodes: CanvasNodeView[];
  outputs: CanvasOutput[];
  edges: CanvasEdge[];
  snapshotSeq: number;
  streamId: string;
}
export const nodeManifests = {
  text: { typeId: 'text', schemaVersion: 1, editableFields: ['text'], inputPorts: [], outputPorts: ['output'], executor: null, graphExecution: false },
  image: { typeId: 'image', schemaVersion: 1, editableFields: ['media'], inputPorts: [], outputPorts: ['output'], executor: null, graphExecution: false },
  media: { typeId: 'media', schemaVersion: 1, editableFields: ['media'], inputPorts: [], outputPorts: ['output'], executor: null, graphExecution: false },
  generation: { typeId: 'generation', schemaVersion: 3, editableFields: ['prompt', 'profileRef', 'inputs', 'referenceImages'], inputPorts: ['prompt', 'reference', 'first_frame', 'last_frame','voice_reference'], outputPorts: ['output'], executor: 'generation', graphExecution: true },
} as const;
export function isCanvasLayout(v: unknown): v is CanvasLayout {
  return isRecord(v) && exact(v, ['x', 'y']) && [v.x, v.y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000000);
}
export function isFixedTextInput(v: unknown): v is FixedTextInput {
  return isRecord(v) && exact(v, ['nodeId', 'incarnation', 'semanticRevision']) && id(v.nodeId) && id(v.incarnation) && revision(v.semanticRevision);
}
export function isCanvasInputOwnership(v: unknown): v is CanvasInputOwnership {
  return isRecord(v) && exact(v, ['canvasId', 'nodeId', 'incarnation', 'semanticRevision']) && id(v.canvasId) && id(v.nodeId) && id(v.incarnation) && revision(v.semanticRevision);
}
export function isCanvasContent(v: unknown): v is CanvasContent {
  if (!isRecord(v)) return false;
  if (v.type === 'text') return exact(v, ['type', 'text']) && text(v.text);
  if (v.type === 'image' || v.type === 'media') return exact(v, ['type', 'media',...(v.voiceBinding===undefined?[]:['voiceBinding'])]) && isMediaReference(v.media)&&(v.voiceBinding===undefined||v.type==='media'&&isVoiceBinding(v.voiceBinding));
  return v.type === 'generation' && exact(v, ['type', 'prompt', 'profileRef', 'inputs', ...(v.referenceImages === undefined ? [] : ['referenceImages'])]) && (v.referenceImages === undefined || Array.isArray(v.referenceImages) && v.referenceImages.length <= 4 && v.referenceImages.every(isReferenceImageInput)) && text(v.prompt) && isRevisionRef(v.profileRef) && Array.isArray(v.inputs) && v.inputs.length <= 32 && v.inputs.every(isFixedTextInput);
}
export function isCanvasNode(v: unknown): v is CanvasNode {
  return isRecord(v) && exact(v, ['nodeId', 'incarnation', 'semanticRevision', 'layoutRevision', 'selectionRevision', 'content', 'layout', 'selectedOutput', 'activeRunBindingId']) && id(v.nodeId) && id(v.incarnation) && [v.semanticRevision, v.layoutRevision, v.selectionRevision].every(revision) && isCanvasContent(v.content) && isCanvasLayout(v.layout) && (v.selectedOutput === null || isMediaReference(v.selectedOutput)) && (v.activeRunBindingId === null || id(v.activeRunBindingId));
}
function isOperation(v: unknown): v is CanvasOperation {
  if (!isRecord(v)) return false;
  if (v.kind === 'addEdge') return exact(v, ['kind','edge']) && isCanvasEdge(v.edge);
  if (v.kind === 'removeEdge') return exact(v, ['kind','edgeId']) && id(v.edgeId);
  if (!id(v.nodeId)) return false;
  if (v.kind === 'create') return exact(v, ['kind', 'nodeId', 'content', 'layout']) && isCanvasContent(v.content) && isCanvasLayout(v.layout);
  if (!id(v.incarnation)) return false;
  if (v.kind === 'delete') return exact(v, ['kind', 'nodeId', 'incarnation', 'expectedSemanticRevision', 'expectedLayoutRevision', 'expectedSelectionRevision', 'expectedRunBindingId']) && [v.expectedSemanticRevision, v.expectedLayoutRevision, v.expectedSelectionRevision].every(revision) && (v.expectedRunBindingId === null || id(v.expectedRunBindingId));
  if (!revision(v.expectedRevision)) return false;
  if (v.kind === 'setContent') return exact(v, ['kind', 'nodeId', 'incarnation', 'expectedRevision', 'content']) && isCanvasContent(v.content);
  if (v.kind === 'setLayout') return exact(v, ['kind', 'nodeId', 'incarnation', 'expectedRevision', 'layout']) && isCanvasLayout(v.layout);
  return v.kind === 'selectOutput' && exact(v, ['kind', 'nodeId', 'incarnation', 'expectedRevision', 'output']) && (v.output === null || isMediaReference(v.output));
}
export function parseCanvasCommand(v: unknown): Result<CanvasCommand> {
  if (!isRecord(v) || !id(v.canvasId) || !Number.isSafeInteger(v.baseRevision) || (v.baseRevision as number) < 0) return fail('INVALID_INPUT', '画布命令需要明确身份与观察版本。');
  if (exact(v, ['canvasId', 'baseRevision', 'undoCommandId']) && id(v.undoCommandId)) return ok(structuredClone(v) as unknown as CanvasCommand);
  if (exact(v, ['canvasId', 'baseRevision', 'operations']) && Array.isArray(v.operations) && v.operations.length > 0 && v.operations.length <= 100 && v.operations.every(isOperation)) {
    const touched = new Map<string, Set<string>>();
    for (const operation of v.operations) {
      if (operation.kind === 'addEdge' || operation.kind === 'removeEdge') continue;
      const field = operation.kind === 'create' || operation.kind === 'delete' ? '*' : operation.kind;
      const fields = touched.get(operation.nodeId) ?? new Set<string>();
      if (fields.has(field) || fields.has('*') || field === '*' && fields.size > 0) return fail('INVALID_INPUT', '单个命令对每个节点字段只写一次；创建/删除节点不能混合其他字段操作。');
      fields.add(field);
      touched.set(operation.nodeId, fields);
    }
    return ok(structuredClone(v) as unknown as CanvasCommand);
  }
  return fail('INVALID_INPUT', '画布操作或字段前置条件无效。');
}
export function isCanvasCommit(v: unknown): v is CanvasCommit {
  return isRecord(v) && exact(v, ['libraryId', 'canvasId', 'commandId', 'revision', 'changedNodeIds', 'skipped']) && id(v.libraryId) && id(v.canvasId) && id(v.commandId) && revision(v.revision) && Array.isArray(v.changedNodeIds) && v.changedNodeIds.every(id) && Array.isArray(v.skipped) && v.skipped.every(x => typeof x === 'string');
}
export function isCanvasSnapshot(v: unknown): v is CanvasSnapshot {
  if (!isRecord(v) || !exact(v, ['libraryId', 'canvasId', 'projectId', 'revision', 'nodes', 'outputs', 'edges', 'snapshotSeq', 'streamId']) || !id(v.libraryId) || !id(v.canvasId) || !id(v.projectId) || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0 || !Number.isSafeInteger(v.snapshotSeq) || (v.snapshotSeq as number) < 0 || !id(v.streamId) || !Array.isArray(v.nodes) || !v.nodes.every(isCanvasNodeView) || !Array.isArray(v.edges) || !v.edges.every(isCanvasEdge) || !Array.isArray(v.outputs)) return false;
  return v.nodes.every(n => (!('media' in n.content) || n.content.media.libraryId === v.libraryId) && (n.content.type !== 'generation' || n.content.profileRef.libraryId === v.libraryId && (n.content.referenceImages ?? []).every(r => r.ref.libraryId === v.libraryId)) && (n.selectedOutput === null || n.selectedOutput.libraryId === v.libraryId)) && v.outputs.every(o => isRecord(o) && exact(o, ['runBindingId', 'taskId', 'nodeId', 'incarnation', 'semanticRevision', 'artifactRef', 'selection', 'reason']) && id(o.runBindingId) && id(o.taskId) && id(o.nodeId) && id(o.incarnation) && revision(o.semanticRevision) && isArtifactRef(o.artifactRef) && o.artifactRef.libraryId === v.libraryId && ['selected', 'history'].includes(o.selection as string) && ['current', 'deleted', 'incarnation', 'semantic', 'run', 'selection'].includes(o.reason as string));
}
function isCanvasNodeView(v: unknown): v is CanvasNodeView {
  if (!isRecord(v)) return false;
  const { freshness, activeTask, shotBinding, ...node } = v;
  return isCanvasNode(node) && (shotBinding === undefined || shotBinding === null || isRecord(shotBinding) && [shotBinding.projectId,shotBinding.scriptId,shotBinding.shotId,shotBinding.sceneId,shotBinding.productionId].every(id) && revision(shotBinding.scriptRevision) && revision(shotBinding.shotRevision) && ['image','video'].includes(shotBinding.role as string)) && (node.content.type === 'generation' ? ['none', 'current', 'stale', 'unknown'].includes(freshness as string) : freshness === null) && (activeTask === null || isRecord(activeTask) && exact(activeTask, ['taskId', 'state']) && id(activeTask.taskId) && ['QUEUED', 'SUBMITTING', 'RUNNING', 'SUBMISSION_UNKNOWN', 'RECONCILE_REQUIRED', 'COLLECTING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(activeTask.state as string));
}

export function isCanvasEdge(v: unknown): v is CanvasEdge { return isRecord(v) && exact(v,['id','sourceNodeId','sourceIncarnation','targetNodeId','targetIncarnation','sourcePort','targetPort']) && [v.id,v.sourceNodeId,v.sourceIncarnation,v.targetNodeId,v.targetIncarnation].every(id) && v.sourcePort === 'output' && ['prompt','reference','first_frame','last_frame','voice_reference'].includes(v.targetPort as string); }
