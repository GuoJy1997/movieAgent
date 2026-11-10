import { isMediaReference, type MediaReference, type MediaMetadata } from './assets.ts';
import { isRevisionRef, type RevisionRef } from './models.ts';
import { isPreparedGeneration, isTaskRef, parseApproveGeneration, type PreparedGeneration, type TaskRef, type ApproveGenerationInput } from './generation.ts';
import { isEntityRevision, isScriptRevision, isShotRevision, type EntityKind, type EntityRevision, type ScriptRevision, type ShotRevision, type CreationBatchResult, type SaveShotInput } from './creation.ts';
import { fail, isRecord, ok, type Result } from './result.ts';
export const AGENT_MESSAGE_MAX_LENGTH = 4000;
export type AgentMode = 'all' | 'script' | 'director';
export interface AgentTemplate {
    id: string;
    revision: number;
    name: string;
    description: string;
    instructions: string;
    allowed: ('script' | 'entity' | 'shot')[];
    suggestedShots: number;
    suggestedOutputTokens: number;
}
export interface AgentCreateSessionInput {
    projectId: string;
    title: string;
    mode: AgentMode;
    executionOwner: string;
}
export interface AgentTargets {
    scriptId?: string;
    shotIds: string[];
    entityIds: string[];
}
export interface AgentPrepareTurnInput {
    sessionId: string;
    message: string;
    profileRef: RevisionRef;
    templateId: string;
    targets: AgentTargets;
    selectedAssetRefs?: MediaReference[];
    outputTokens?: number;
}
export interface AgentApproveTurnInput {
    runId: string;
    approval: ApproveGenerationInput;
}
export interface AgentAcceptProposalInput {
    runId: string;
    projectId: string;
    executionOwner: string;
    proposalHash: string;
    selectedShotKeys: string[];
    selectedEntityKeys: string[];
    includeScript: boolean;
}
export interface AgentStopInput {
    runId: string;
    executionOwner: string;
}
export interface AgentEntityDraft {
    key: string;
    kind: EntityKind;
    name: string;
    description: string;
    constraints: string;
    assetKeys: string[];
}
export interface AgentScriptDraft {
    title: string;
    synopsis: string;
    body: string;
    scenes: {
        key: string;
        title: string;
        location: string;
        time: string;
        description: string;
    }[];
}
export interface AgentShotDraft extends Omit<SaveShotInput, 'projectId' | 'id' | 'expectedRevision' | 'scriptId' | 'sceneId' | 'entityRefs'> {
    key: string;
    sceneKey: string;
    entityKeys: string[];
}
export interface AgentProposalDraft {
    schemaVersion: 1;
    reply: string;
    script: AgentScriptDraft | null;
    entities: AgentEntityDraft[];
    shots: AgentShotDraft[];
}
export interface CapturedAgentTargets {
    script: ScriptRevision | null;
    shots: {
        key: string;
        value: ShotRevision;
    }[];
    entities: {
        key: string;
        value: EntityRevision;
    }[];
    assets: {
        key: string;
        ref: MediaReference;
        metadata: MediaMetadata;
    }[];
}
export interface AgentContextManifest {
    projectId: string;
    sources: {
        kind: string;
        key: string;
        id: string;
        revision: number;
    }[];
    included: string[];
    omitted: string[];
    promptCharacters: number;
    notice: string;
}
export interface PreparedAgentTurn {
    libraryId: string;
    sessionId: string;
    runId: string;
    projectId: string;
    executionOwner: string;
    mode: AgentMode;
    message: string;
    template: AgentTemplate;
    targets: CapturedAgentTargets;
    context: AgentContextManifest;
    generation: PreparedGeneration;
    sourceProfileRef: RevisionRef;
    createdAt: number;
}
export interface AgentProposal {
    proposalHash: string;
    expiresAt: number;
    draft: AgentProposalDraft;
}
export interface AgentActionReceipt {
    libraryId: string;
    runId: string;
    projectId: string;
    actionId: string;
    selectionHash: string;
    proposalHash: string;
    acceptedReferences: {
        shotId: string;
        shotRevision: number;
        scriptId: string;
        scriptRevision: number;
        sceneId: string;
    }[];
    acceptedShotKeys: string[];
    skippedShotKeys: string[];
    acceptedEntityKeys: string[];
    includeScript: boolean;
    result: CreationBatchResult;
    createdAt: number;
}
export type AgentRunState = 'PREPARED' | 'PLANNING' | 'PROPOSED' | 'REPLIED' | 'INVALID' | 'FAILED' | 'UNKNOWN' | 'STOPPED' | 'ACCEPTED';
export interface AgentRunView {
    libraryId: string;
    sessionId: string;
    runId: string;
    projectId: string;
    state: AgentRunState;
    stopped: boolean;
    prepared: PreparedAgentTurn;
    task: TaskRef | null;
    proposal: AgentProposal | null;
    action: AgentActionReceipt | null;
    errorCode: string | null;
    harvested: boolean;
}
export interface AgentMessage {
    runId: string;
    role: 'user' | 'assistant';
    text: string;
    createdAt: number;
}
export interface AgentSessionView {
    libraryId: string;
    sessionId: string;
    projectId: string;
    title: string;
    mode: AgentMode;
    executionOwner: string;
    createdAt: number;
    messages: AgentMessage[];
    runs: AgentRunView[];
}
export interface AgentSessionList {
    libraryId: string;
    projectId: string;
    sessions: Omit<AgentSessionView, 'messages' | 'runs'>[];
}
export interface AgentTemplateList {
    templates: AgentTemplate[];
}
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const ids = (v: unknown, max = 32): v is string[] => Array.isArray(v) && v.length <= max && v.every(id) && new Set(v).size === v.length;
const txt = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000\u007f]/.test(v);
export function parseAgentCreate(v: unknown): Result<AgentCreateSessionInput> {
    return isRecord(v) && exact(v, ['projectId', 'title', 'mode', 'executionOwner']) && id(v.projectId) && id(v.executionOwner) && txt(v.title, 200) && ['all', 'script', 'director'].includes(v.mode as string) ? ok(structuredClone(v) as unknown as AgentCreateSessionInput) : fail('INVALID_INPUT', '会话参数无效。');
}
export function parseAgentPrepare(v: unknown): Result<AgentPrepareTurnInput> {
    return isRecord(v) && exact(v, ['sessionId', 'message', 'profileRef', 'templateId', 'targets'], ['selectedAssetRefs', 'outputTokens']) && id(v.sessionId) && txt(v.message, AGENT_MESSAGE_MAX_LENGTH) && isRevisionRef(v.profileRef) && id(v.templateId) && isRecord(v.targets) && exact(v.targets, ['shotIds', 'entityIds'], ['scriptId']) && (v.targets.scriptId === undefined || id(v.targets.scriptId)) && ids(v.targets.shotIds) && ids(v.targets.entityIds) && (v.outputTokens === undefined || Number.isSafeInteger(v.outputTokens) && (v.outputTokens as number) >= 1 && (v.outputTokens as number) <= 8192) && (v.selectedAssetRefs === undefined || Array.isArray(v.selectedAssetRefs) && v.selectedAssetRefs.length <= 8 && v.selectedAssetRefs.every(r => isMediaReference(r) && Object.keys(r).length === (r.kind === 'artifact' ? 3 : 4))) ? ok(structuredClone(v) as unknown as AgentPrepareTurnInput) : fail('INVALID_INPUT', '请选择有限的上下文、需求与输出预算。');
}
export function parseAgentApprove(v: unknown): Result<AgentApproveTurnInput> {
    if (!isRecord(v) || !exact(v, ['runId', 'approval']) || !id(v.runId))
        return fail('INVALID_INPUT', '轮次审批无效。');
    const a = parseApproveGeneration(v.approval);
    return a.ok ? ok({
        runId: v.runId, approval: a.value
    }) : a;
}
export function parseAgentAccept(v: unknown): Result<AgentAcceptProposalInput> {
    return isRecord(v) && exact(v, ['runId', 'projectId', 'executionOwner', 'proposalHash', 'selectedShotKeys', 'selectedEntityKeys', 'includeScript']) && id(v.runId) && id(v.projectId) && id(v.executionOwner) && hash(v.proposalHash) && ids(v.selectedShotKeys) && ids(v.selectedEntityKeys) && typeof v.includeScript === 'boolean' ? ok(structuredClone(v) as unknown as AgentAcceptProposalInput) : fail('INVALID_INPUT', '提案批准范围无效。');
}
export function parseAgentStop(v: unknown): Result<AgentStopInput> {
    return isRecord(v) && exact(v, ['runId', 'executionOwner']) && id(v.runId) && id(v.executionOwner) ? ok({
        runId: v.runId, executionOwner: v.executionOwner
    }) : fail('INVALID_INPUT', '停止身份无效。');
}
export function isPreparedAgentTurn(v: unknown): v is PreparedAgentTurn {
    return isRecord(v) && id(v.libraryId) && id(v.sessionId) && id(v.runId) && id(v.projectId) && id(v.executionOwner) && ['all', 'script', 'director'].includes(v.mode as string) && txt(v.message, AGENT_MESSAGE_MAX_LENGTH) && isAgentTemplate(v.template) && isRecord(v.targets) && (v.targets.script === null || isScriptRevision(v.targets.script)) && Array.isArray(v.targets.shots) && v.targets.shots.every(x => isRecord(x) && id(x.key) && isShotRevision(x.value)) && Array.isArray(v.targets.entities) && v.targets.entities.every(x => isRecord(x) && id(x.key) && isEntityRevision(x.value)) && Array.isArray(v.targets.assets) && v.targets.assets.every(x => isRecord(x) && id(x.key) && isMediaReference(x.ref) && isRecord(x.metadata)) && isRecord(v.context) && Array.isArray(v.context.sources) && Array.isArray(v.context.included) && Array.isArray(v.context.omitted) && isRevisionRef(v.sourceProfileRef) && isPreparedGeneration(v.generation) && v.generation.libraryId === v.libraryId && v.generation.runId === v.runId && Number.isSafeInteger(v.createdAt);
}
export function isAgentAction(v: unknown): v is AgentActionReceipt {
    return isRecord(v) && id(v.libraryId) && id(v.runId) && id(v.projectId) && id(v.actionId) && hash(v.selectionHash) && hash(v.proposalHash) && Array.isArray(v.acceptedReferences) && v.acceptedReferences.every(r => isRecord(r) && id(r.shotId) && id(r.scriptId) && id(r.sceneId) && Number.isSafeInteger(r.shotRevision) && (r.shotRevision as number) > 0 && Number.isSafeInteger(r.scriptRevision) && (r.scriptRevision as number) > 0) && ids(v.acceptedShotKeys) && ids(v.skippedShotKeys) && ids(v.acceptedEntityKeys) && typeof v.includeScript === 'boolean' && isRecord(v.result) && v.result.libraryId === v.libraryId && v.result.projectId === v.projectId && Array.isArray(v.result.entities) && v.result.entities.every(isEntityRevision) && Array.isArray(v.result.scripts) && v.result.scripts.every(isScriptRevision) && Array.isArray(v.result.shots) && v.result.shots.every(isShotRevision) && Number.isSafeInteger(v.createdAt);
}
export function isAgentRun(v: unknown): v is AgentRunView {
    return isRecord(v) && id(v.libraryId) && id(v.sessionId) && id(v.runId) && id(v.projectId) && ['PREPARED', 'PLANNING', 'PROPOSED', 'REPLIED', 'INVALID', 'FAILED', 'UNKNOWN', 'STOPPED', 'ACCEPTED'].includes(v.state as string) && typeof v.stopped === 'boolean' && typeof v.harvested === 'boolean' && isPreparedAgentTurn(v.prepared) && (v.task === null || isTaskRef(v.task)) && (v.proposal === null || isRecord(v.proposal) && hash(v.proposal.proposalHash) && Number.isSafeInteger(v.proposal.expiresAt) && isRecord(v.proposal.draft)) && (v.action === null || isAgentAction(v.action)) && (v.errorCode === null || typeof v.errorCode === 'string');
}
const sessionBase = (v: unknown) => isRecord(v) && id(v.libraryId) && id(v.sessionId) && id(v.projectId) && txt(v.title, 200) && ['all', 'script', 'director'].includes(v.mode as string) && id(v.executionOwner) && Number.isSafeInteger(v.createdAt);
export function isAgentSession(v: unknown): v is AgentSessionView {
    return sessionBase(v) && isRecord(v) && Array.isArray(v.messages) && v.messages.every(m => isRecord(m) && id(m.runId) && ['user', 'assistant'].includes(m.role as string) && typeof m.text === 'string' && m.text.length <= 8000 && Number.isSafeInteger(m.createdAt)) && Array.isArray(v.runs) && v.runs.every(isAgentRun);
}
export function isAgentList(v: unknown): v is AgentSessionList {
    return isRecord(v) && id(v.libraryId) && id(v.projectId) && Array.isArray(v.sessions) && v.sessions.every(sessionBase);
}
export function isAgentTemplate(v: unknown): v is AgentTemplate {
    return isRecord(v) && id(v.id) && Number.isSafeInteger(v.revision) && typeof v.name === 'string' && typeof v.description === 'string' && typeof v.instructions === 'string' && Array.isArray(v.allowed) && v.allowed.every(x => ['script', 'entity', 'shot'].includes(x)) && Number.isSafeInteger(v.suggestedShots) && Number.isSafeInteger(v.suggestedOutputTokens);
}
export function isAgentTemplates(v: unknown): v is AgentTemplateList {
    return isRecord(v) && Array.isArray(v.templates) && v.templates.every(isAgentTemplate);
}
