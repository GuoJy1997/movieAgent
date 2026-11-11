import { fail, isRecord, ok, type Result } from './result.ts';
import { isRevisionRef, type RevisionRef, type ParameterValue } from './models.ts';
import { isShotRevision, isScriptRevision, isEntityRevision, type ShotRevision, type ScriptRevision, type ScriptScene, type EntityRevision } from './creation.ts';
import { isMediaReference, type MediaReference } from './assets.ts';

const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export interface ShotProductionSelection { shotId: string; revision: number }
export interface ReusedShotImage { shotId: string; ref: MediaReference; role: 'first_frame' | 'reference' }
export interface PrepareShotProductionInput {
  projectId: string; scriptId: string; canvasId: string; shots: ShotProductionSelection[];
  imageProfileRef?: RevisionRef; videoProfileRef?: RevisionRef; reusedImages?: ReusedShotImage[];
  executionOwner: string; runId: string;
}
export interface ApplyShotProductionInput { productionId: string; approvedHash: string; expectedCanvasRevision: number; executionOwner: string; runId: string }
export interface StopShotProductionInput { productionId: string; executionOwner: string }
export interface AttachShotWorkflowInput { productionId: string; workflowId: string; executionOwner: string }
export interface SelectShotProductionOutputInput { projectId: string; shotId: string; expectedRevision: number; expectedSelectionRevision: number; role: 'image' | 'video'; reference: MediaReference | null }
export interface ShotProductionSnapshot {
  shotId: string; shotRevision: number; scriptRevision: number; scene: ScriptScene;
  shot: ShotRevision; script: ScriptRevision; entities: EntityRevision[]; selectionRevision: number;
}
export interface ShotProductionStep {
  shotId: string; shotRevision: number; role: 'image' | 'video'; nodeId: string;
  profileRef: RevisionRef; sourceProfileRef: RevisionRef; overrides: Record<string, ParameterValue>;
  prompt: string; aspectNotice: string; referenceImages: { role: 'reference' | 'first_frame'; ref: MediaReference }[];
}
export type ShotProductionOperation = { kind: 'create'; nodeId: string; stepIndex: number } | { kind: 'first_frame'; sourceNodeId: string; targetNodeId: string };
export interface PreparedShotProduction extends PrepareShotProductionInput {
  libraryId: string; productionId: string; planHash: string; expiresAt: number; canvasRevision: number;
  snapshots: ShotProductionSnapshot[]; steps: ShotProductionStep[]; operations: ShotProductionOperation[];
  limits: { shots: 16; steps: 32; operations: 100; dependencies: 128 };
}
export type ShotProductionState = 'prepared' | 'applied' | 'stopping' | 'stopped';
export interface ShotProductionOutput {
  libraryId: string; productionId: string; shotId: string; shotRevision: number; role: 'image' | 'video'; nodeId: string;
  workflowId: string; stepId: string; taskId: string; reference: MediaReference;
  selected: boolean; errorCode: string | null; createdAt: number;
}
export interface ShotProductionCollectionIssue {
  issueId: string; productionId: string; nodeId: string | null; taskId: string | null;
  errorCode: string; createdAt: number;
}
export interface ShotProductionIssuesView {
  libraryId: string; projectId: string; productionId: string;
  issues: ShotProductionCollectionIssue[];
}
export interface ShotHarvestReport { collected: number; failures: (ShotProductionCollectionIssue & { persisted: boolean })[] }
export interface ShotProductionView { libraryId: string; productionId: string; projectId: string; state: ShotProductionState; plan: PreparedShotProduction; workflowId: string | null; outputs: ShotProductionOutput[]; collectionIssues: ShotProductionCollectionIssue[] }
export interface ShotProductionHistoryEntry { productionId: string; shotRevision: number; scriptRevision: number; state: ShotProductionState; workflowId: string | null; nodeIds: string[] }
export interface ShotProductionHistory { libraryId: string; projectId: string; shotId: string; productions: ShotProductionHistoryEntry[]; outputs: ShotProductionOutput[]; collectionIssues: ShotProductionCollectionIssue[] }
export interface ShotBinding { projectId: string; scriptId: string; scriptRevision: number; shotId: string; shotRevision: number; sceneId: string; role: 'image' | 'video'; productionId: string }

export function parsePrepareShotProduction(value: unknown): Result<PrepareShotProductionInput> {
  if (!isRecord(value)) return fail('INVALID_INPUT', '请选择1–16个固定镜头及图像或视频配置。');
  const allowed = ['projectId','scriptId','canvasId','shots','imageProfileRef','videoProfileRef','executionOwner','runId','reusedImages'];
  const identityValid = [value.projectId,value.scriptId,value.canvasId,value.executionOwner,value.runId].every(id);
  const shotsValid = Array.isArray(value.shots) && value.shots.length >= 1 && value.shots.length <= 16 &&
    value.shots.every(shot => isRecord(shot) && exact(shot,['shotId','revision']) && id(shot.shotId) && revision(shot.revision));
  const uniqueShots = shotsValid && Array.isArray(value.shots) &&
    new Set((value.shots as ShotProductionSelection[]).map(shot => shot.shotId)).size === value.shots.length;
  const profilesValid = (value.imageProfileRef !== undefined || value.videoProfileRef !== undefined) &&
    (value.imageProfileRef === undefined || isRevisionRef(value.imageProfileRef)) &&
    (value.videoProfileRef === undefined || isRevisionRef(value.videoProfileRef));
  const reuseValid = value.reusedImages === undefined || Array.isArray(value.reusedImages) && value.reusedImages.length <= 16
    && value.videoProfileRef !== undefined && value.reusedImages.every(row => isRecord(row) && exact(row,['shotId','ref','role'])
      && id(row.shotId) && isMediaReference(row.ref) && ['first_frame','reference'].includes(String(row.role))
      && Array.isArray(value.shots) && value.shots.some(shot => isRecord(shot) && shot.shotId === row.shotId))
    && new Set(value.reusedImages.map(row => row.shotId)).size === value.reusedImages.length;
  if (Object.keys(value).some(key => !allowed.includes(key)) || !identityValid || !uniqueShots || !profilesValid || !reuseValid) {
    return fail('INVALID_INPUT', '请选择1–16个固定镜头及图像或视频配置。');
  }
  return ok(structuredClone(value) as unknown as PrepareShotProductionInput);
}
export function parseApplyShotProduction(value: unknown): Result<ApplyShotProductionInput> {
  return isRecord(value) && exact(value,['productionId','approvedHash','expectedCanvasRevision','executionOwner','runId']) &&
    id(value.productionId) && hash(value.approvedHash) && Number.isSafeInteger(value.expectedCanvasRevision) &&
    (value.expectedCanvasRevision as number) >= 0 && id(value.executionOwner) && id(value.runId)
    ? ok(value as unknown as ApplyShotProductionInput) : fail('INVALID_INPUT','生产批准参数无效。');
}
export function parseStopShotProduction(value: unknown): Result<StopShotProductionInput> {
  return isRecord(value) && exact(value,['productionId','executionOwner']) && id(value.productionId) && id(value.executionOwner)
    ? ok(value as unknown as StopShotProductionInput) : fail('INVALID_INPUT','停止参数无效。');
}
export function parseAttachShotWorkflow(value: unknown): Result<AttachShotWorkflowInput> {
  return isRecord(value) && exact(value,['productionId','workflowId','executionOwner']) &&
    id(value.productionId) && id(value.workflowId) && id(value.executionOwner)
    ? ok(value as unknown as AttachShotWorkflowInput) : fail('INVALID_INPUT','工作流关联无效。');
}
export function parseSelectShotProductionOutput(value: unknown): Result<SelectShotProductionOutputInput> {
  return isRecord(value) && exact(value,['projectId','shotId','expectedRevision','expectedSelectionRevision','role','reference']) &&
    id(value.projectId) && id(value.shotId) && revision(value.expectedRevision) &&
    Number.isSafeInteger(value.expectedSelectionRevision) && (value.expectedSelectionRevision as number) >= 0 &&
    (value.role === 'image' || value.role === 'video') && (value.reference === null || isMediaReference(value.reference))
    ? ok(value as unknown as SelectShotProductionOutputInput) : fail('INVALID_INPUT','镜头输出选择无效。');
}
const productionState = (value: unknown): value is ShotProductionState => ['prepared','applied','stopping','stopped'].includes(value as string);
function isSnapshot(value: unknown): value is ShotProductionSnapshot {
  return isRecord(value) && id(value.shotId) && revision(value.shotRevision) && revision(value.scriptRevision) &&
    isRecord(value.scene) && isShotRevision(value.shot) && isScriptRevision(value.script) &&
    value.shot.id===value.shotId && value.shot.revision===value.shotRevision && value.script.revision===value.scriptRevision &&
    value.shot.scriptId===value.script.id && value.shot.projectId===value.script.projectId && value.shot.libraryId===value.script.libraryId &&
    value.shot.sceneId===value.scene.id && value.script.scenes.some(scene=>JSON.stringify(scene)===JSON.stringify(value.scene)) &&
    Array.isArray(value.entities) && value.entities.every(entity=>isEntityRevision(entity)&&entity.projectId===(value.shot as ShotRevision).projectId&&entity.libraryId===(value.shot as ShotRevision).libraryId) && Number.isSafeInteger(value.selectionRevision) && (value.selectionRevision as number)>=0;
}
function isStep(value: unknown): value is ShotProductionStep {
  return isRecord(value) && id(value.shotId) && revision(value.shotRevision) &&
    (value.role === 'image' || value.role === 'video') && id(value.nodeId) &&
    isRevisionRef(value.profileRef) && isRevisionRef(value.sourceProfileRef) && isRecord(value.overrides) &&
    typeof value.prompt === 'string' && typeof value.aspectNotice === 'string' && value.aspectNotice.length <= 400 &&
    Array.isArray(value.referenceImages) && value.referenceImages.every(reference =>
      isRecord(reference) && (reference.role === 'reference' || reference.role === 'first_frame') && isMediaReference(reference.ref));
}
export function isPreparedShotProduction(value: unknown): value is PreparedShotProduction {
  if (!isRecord(value)) return false;
  const { libraryId: _libraryId, productionId: _productionId, planHash: _planHash,
    expiresAt: _expiresAt, canvasRevision: _canvasRevision, snapshots: _snapshots,
    steps: _steps, operations: _operations, limits: _limits, ...input } = value;
  return id(value.libraryId) && id(value.productionId) && hash(value.planHash) &&
    Number.isSafeInteger(value.expiresAt) && Number.isSafeInteger(value.canvasRevision) &&
    parsePrepareShotProduction(input).ok && Array.isArray(value.snapshots) && Array.isArray(value.shots) &&
    value.snapshots.length === value.shots.length && value.snapshots.every((snapshot,i)=>isSnapshot(snapshot)&&snapshot.shot.projectId===value.projectId&&snapshot.shot.libraryId===value.libraryId&&snapshot.script.id===value.scriptId&&snapshot.shotId===(value.shots as ShotProductionSelection[])[i]!.shotId&&snapshot.shotRevision===(value.shots as ShotProductionSelection[])[i]!.revision) &&
    Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= 32 && value.steps.every(step=>isStep(step)&&step.profileRef.libraryId===value.libraryId&&step.sourceProfileRef.libraryId===value.libraryId&&(value.snapshots as ShotProductionSnapshot[]).some(s=>s.shotId===step.shotId&&s.shotRevision===step.shotRevision)) &&
    Array.isArray(value.operations) && value.operations.length <= 100 &&
    value.operations.every(operation=>isRecord(operation)&&(
      operation.kind==='create'&&exact(operation,['kind','nodeId','stepIndex'])&&Number.isSafeInteger(operation.stepIndex)&&(operation.stepIndex as number)>=0&&isRecord((value.steps as ShotProductionStep[])[operation.stepIndex as number])&&(value.steps as ShotProductionStep[])[operation.stepIndex as number]!.nodeId===operation.nodeId ||
      operation.kind==='first_frame'&&exact(operation,['kind','sourceNodeId','targetNodeId'])&&(value.steps as ShotProductionStep[]).some(source=>source.nodeId===operation.sourceNodeId&&source.role==='image'&&(value.steps as ShotProductionStep[]).some(target=>target.nodeId===operation.targetNodeId&&target.role==='video'&&target.shotId===source.shotId))
    )) &&
    value.operations.filter(operation=>operation.kind==='create').length===value.steps.length &&
    new Set(value.steps.map(step=>step.nodeId)).size===value.steps.length &&
    isRecord(value.limits) && value.limits.shots === 16 && value.limits.steps === 32 &&
    value.limits.operations === 100 && value.limits.dependencies === 128;
}
export function isShotProductionOutput(value: unknown): value is ShotProductionOutput {
  return isRecord(value) && id(value.libraryId) && id(value.productionId) && id(value.shotId) &&
    revision(value.shotRevision) && (value.role === 'image' || value.role === 'video') &&
    id(value.nodeId) && id(value.workflowId) && id(value.stepId) && id(value.taskId) &&
    isMediaReference(value.reference) && value.reference.libraryId === value.libraryId &&
    typeof value.selected === 'boolean' && (value.errorCode === null || typeof value.errorCode === 'string') &&
    Number.isSafeInteger(value.createdAt);
}
export function isShotProductionView(value: unknown): value is ShotProductionView {
  return isRecord(value) && id(value.libraryId) && id(value.productionId) && id(value.projectId) &&
    productionState(value.state) && isPreparedShotProduction(value.plan) &&
    value.plan.productionId === value.productionId && value.plan.projectId === value.projectId &&
    value.plan.libraryId === value.libraryId && (value.workflowId === null || id(value.workflowId)) &&
    Array.isArray(value.outputs) && value.outputs.every(output =>
      isShotProductionOutput(output) && output.libraryId === value.libraryId && output.productionId === value.productionId) &&
    Array.isArray(value.collectionIssues) && value.collectionIssues.every(issue =>
      isShotProductionCollectionIssue(issue) && issue.productionId === value.productionId);
}
export function isShotProductionCollectionIssue(value: unknown): value is ShotProductionCollectionIssue {
  return isRecord(value) && id(value.issueId) && id(value.productionId) &&
    (value.nodeId === null || id(value.nodeId)) && (value.taskId === null || id(value.taskId)) &&
    typeof value.errorCode === 'string' && /^[A-Z_]{3,64}$/.test(value.errorCode) &&
    Number.isSafeInteger(value.createdAt) && (value.createdAt as number) > 0;
}
export function isShotProductionIssuesView(value: unknown): value is ShotProductionIssuesView {
  return isRecord(value) && id(value.libraryId) && id(value.projectId) && id(value.productionId) &&
    Array.isArray(value.issues) && value.issues.every(issue =>
      isShotProductionCollectionIssue(issue) && issue.productionId === value.productionId);
}
export function isShotProductionHistory(value: unknown): value is ShotProductionHistory {
  if (!isRecord(value) || !Array.isArray(value.productions)) return false;
  const productionIds = new Set(value.productions.filter(isRecord).map(entry => entry.productionId));
  return id(value.libraryId) && id(value.projectId) && id(value.shotId) &&
    value.productions.every(entry =>
      isRecord(entry) && id(entry.productionId) && revision(entry.shotRevision) && revision(entry.scriptRevision) &&
      productionState(entry.state) && (entry.workflowId === null || id(entry.workflowId)) &&
      Array.isArray(entry.nodeIds) && entry.nodeIds.every(id)) &&
    Array.isArray(value.outputs) && value.outputs.every(output =>
      isShotProductionOutput(output) && output.libraryId === value.libraryId && output.shotId === value.shotId) &&
    Array.isArray(value.collectionIssues) && value.collectionIssues.every(issue =>
      isShotProductionCollectionIssue(issue) && productionIds.has(issue.productionId));
}
