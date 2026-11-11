import {memoryContext} from './project-memory-context.ts';
import {contentScopesFor} from './content-scope.ts';
import {voiceInputResolver} from './voice-input-resolver.ts';
import { randomUUID } from 'node:crypto';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { generationFor } from './generation-service.ts';
import type { modelConfigFor } from './model-config-service.ts';
import type { creationFor } from './creation-service.ts';
import type { assetsFor } from './asset-service.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { isAgentRun, isAgentSession, type AgentCreateSessionInput, type AgentPrepareTurnInput, type AgentApproveTurnInput, type AgentAcceptProposalInput, type AgentStopInput, type AgentSessionView, type AgentRunView, type AgentActionReceipt, type PreparedAgentTurn, type AgentProposal } from '../../contracts/src/agent.ts';
import { agentTemplates } from '../../domain/src/agent-templates.ts';
import { parseAgentProposal } from '../../domain/src/agent-proposals.ts';
import { agentContext, captureAgentTargets } from './agent-context.ts';
import { agentApplication, agentDigest } from './agent-application.ts';
import { workflowCoordinator } from './workflow-scheduler.ts';
type SessionBase = Omit<AgentSessionView, 'messages' | 'runs'>;
type Preflight = {
    input: AgentPrepareTurnInput;
    session: SessionBase;
    context: Awaited<ReturnType<typeof agentContext>> & {
        ok: true;
    };
    template: PreparedAgentTurn['template'];
};
/** Router owns all admission/adoption transactions. Coordinator performs local harvesting only. */
export function agentsFor(library: LibraryHandle, generation: ReturnType<typeof generationFor>, models: ReturnType<typeof modelConfigFor>, creation: ReturnType<typeof creationFor>, assets: ReturnType<typeof assetsFor>) {
    const db = library.db;
    function sessionBase(sessionId: string): Result<SessionBase> {
        const owner = library.checkOwnership();
        if (!owner.ok)
            return owner;
        const row = db.prepare('SELECT data_json FROM agent_session WHERE session_id=?').get(sessionId);
        if (!row)
            return fail('AGENT_SESSION_NOT_FOUND', '会话不存在。');
        return ok(JSON.parse(row.data_json as string) as SessionBase);
    }
    function run(runId: string): Result<AgentRunView> {
        const owner = library.checkOwnership();
        if (!owner.ok)
            return owner;
        const row = db.prepare('SELECT * FROM agent_run WHERE run_id=?').get(runId);
        if (!row)
            return fail('AGENT_RUN_NOT_FOUND', '轮次不存在。');
        const prepared: PreparedAgentTurn = JSON.parse(row.prepared_json as string);
        const action = db.prepare('SELECT data_json FROM agent_action WHERE run_id=?').get(runId);
        const view: AgentRunView = {
            libraryId: library.libraryId, sessionId: row.session_id as string, runId, projectId: prepared.projectId, prepared, state: row.state as AgentRunView['state'], stopped: row.stopped === 1, task: row.task_json ? JSON.parse(row.task_json as string) : null, proposal: row.proposal_json ? JSON.parse(row.proposal_json as string) : null, action: action ? JSON.parse(action.data_json as string) : null, errorCode: row.error_code as string | null, harvested: row.harvested === 1
        };
        return isAgentRun(view) ? ok(view) : fail('INVALID_STORED_DATA', '轮次记录无效。');
    }
    function read(sessionId: string): Result<AgentSessionView> {
        const base = sessionBase(sessionId);
        if (!base.ok)
            return base;
        const runs: AgentRunView[] = [];
        for (const row of db.prepare('SELECT run_id FROM agent_run WHERE session_id=? ORDER BY rowid').all(sessionId)) {
            const r = run(row.run_id as string);
            if (!r.ok)
                return r;
            runs.push(r.value);
        }
        const messages = db.prepare('SELECT m.* FROM agent_message m JOIN agent_run r USING(run_id) WHERE r.session_id=? ORDER BY m.rowid').all(sessionId).map(m => ({
            runId: m.run_id as string, role: m.role as 'user' | 'assistant', text: m.text as string, createdAt: m.created_at as number
        }));
        const view = {
            ...base.value, messages, runs
        };
        return isAgentSession(view) ? ok(view) : fail('INVALID_STORED_DATA', '会话记录无效。');
    }
    function createSession(input: AgentCreateSessionInput): Result<AgentSessionView> {
        const project = creation.read({
            projectId: input.projectId
        });
        if (!project.ok)
            return project;
        const base: SessionBase = {
            ...input, libraryId: library.libraryId, sessionId: randomUUID(), createdAt: Date.now()
        };
        db.prepare('INSERT INTO agent_session VALUES(?,?,?)').run(base.sessionId, base.projectId, JSON.stringify(base));
        return ok({
            ...base, messages: [], runs: []
        });
    }
    async function prepare(input: AgentPrepareTurnInput): Promise<Result<Preflight>> {
        const session = read(input.sessionId);
        if (!session.ok)
            return session;
        const template = agentTemplates.find(t => t.id === input.templateId);
        if (!template)
            return fail('AGENT_TEMPLATE_NOT_FOUND', '模板不存在。');
        const snapshot = creation.read({
            projectId: session.value.projectId
        });
        if (!snapshot.ok)
            return snapshot;
        const targets = captureAgentTargets(snapshot.value, input);
        if (!targets.ok)
            return targets;
        const selectedCharacters=new Set([...targets.value.entities.filter(e=>e.value.kind==='character').map(e=>e.value.id),...targets.value.shots.flatMap(s=>s.value.entityRefs.map(e=>e.entityId))]);
        const bindings=db.prepare('SELECT data_json FROM character_voice_binding b WHERE project_id=? AND revision=(SELECT MAX(revision) FROM character_voice_binding WHERE project_id=b.project_id AND character_id=b.character_id)').all(session.value.projectId).map(r=>JSON.parse(r.data_json as string));
        targets.value.voices=[];for(const binding of bindings.filter(b=>selectedCharacters.has(b.characterId))){const voice=voiceInputResolver(library).read(session.value.projectId,binding.voiceRef);if(!voice.ok)return voice;if(!voice.value.archived)targets.value.voices.push(voice.value);}
        const scope=contentScopesFor(library).inferred('session',input.sessionId);
        const primary=scope?.subprojectId?db.prepare('SELECT primary_canvas_id FROM subproject WHERE id=?').get(scope.subprojectId)?.primary_canvas_id:null;
        const canvas = primary?db.prepare('SELECT id,revision,(SELECT COUNT(*) FROM canvas_node n WHERE n.canvas_id=c.id AND n.deleted=0) AS nodeCount FROM canvas c WHERE id=?').get(String(primary)):null;
        const memory=scope?.subprojectId?memoryContext(library,{projectId:scope.projectId,subprojectId:scope.subprojectId}):[];
        const context = await agentContext(input, session.value.projectId, session.value.mode, template, targets.value, session.value.messages, assets, canvas ?? null,memory);
        if (!context.ok)
            return context;
        const { messages: _messages, runs: _runs, ...base } = session.value;
        return ok({
            input, session: base, context, template: structuredClone(template)
        });
    }
    function checkVersions(projectId: string, versions: {
        kind: string;
        id: string;
        revision: number;
    }[]): Result<void> {
        for (const version of versions) {
            const current = db.prepare('SELECT revision,project_id FROM creation_current WHERE kind=? AND id=?').get(version.kind, version.id);
            if (!current || current.project_id !== projectId || current.revision !== version.revision)
                return fail('REVISION_CONFLICT', '所选内容已有新修订，请刷新并重新准备。');
        }
        return ok(undefined);
    }
    function checkPreparedTargets(prepared: Pick<PreparedAgentTurn, 'targets' | 'projectId'>): Result<void> {
        const t = prepared.targets;
        const checked = checkVersions(prepared.projectId, [...(t.script ? [{
                    kind: 'script', id: t.script.id, revision: t.script.revision
                }] : []), ...t.shots.map(x => ({
                kind: 'shot', id: x.value.id, revision: x.value.revision
            })), ...t.entities.map(x => ({
                kind: 'entity', id: x.value.id, revision: x.value.revision
            }))]);
        if (!checked.ok)
            return checked;
        for(const captured of t.voices??[]){const voice=voiceInputResolver(library).read(prepared.projectId,{id:captured.id,revision:captured.revision});if(!voice.ok)return voice;if(agentDigest(voice.value)!==agentDigest(captured))return fail('REFERENCE_CHANGED','Agent 固定声音已改变。');}
        for (const asset of t.assets) {
            const current = assets.assertSelectable(asset.ref);
            if (!current.ok)
                return current;
            if (JSON.stringify(current.value) !== JSON.stringify(asset.metadata))
                return fail('REFERENCE_CHANGED', '固定资产已变化。');
        }
        return ok(undefined);
    }
    function savePrepared(flight: Preflight): Result<PreparedAgentTurn> {
        const { input, session, context, template } = flight;
        const fresh = checkPreparedTargets({
            projectId: session.projectId, targets: context.value.targets
        });
        if (!fresh.ok)
            return fresh;
        if (input.profileRef.libraryId !== library.libraryId)
            return fail('WRONG_LIBRARY', 'Profile 属于其他资料库。');
        const profile = models.listProfiles().profiles.find(p => p.id === input.profileRef.id && p.revision === input.profileRef.revision);
        const model = profile && models.listModels().models.find(m => m.id === profile.modelRef.id && m.revision === profile.modelRef.revision);
        if (!profile || !model)
            return fail('REVISION_NOT_FOUND', '固定文本 Profile 不存在。');
        const currentSource = db.prepare('SELECT MAX(revision) AS revision FROM profile_revision WHERE id=? AND library_id=?').get(profile.id, library.libraryId);
        if (currentSource?.revision !== profile.revision)
            return fail('CONFIG_CHANGED', '所选 Profile 已有新修订。');
        if (!model.capabilities.taskTypes.includes('text_to_text' as never))
            return fail('CONFIG_MISMATCH', '创作规划需要文本模型。');
        let profileRef = input.profileRef;
        if (input.outputTokens !== undefined) {
            // Preserve the chosen protocol's token parameter; derive once, never mutate a global profile.
            const field = Object.hasOwn(model.parameters, 'max_completion_tokens') ? 'max_completion_tokens' : 'max_tokens';
            if (!Object.hasOwn(model.parameters, field))
                return fail('UNSUPPORTED_PARAMETERS', '模型未声明输出 token 参数。');
            const id = `agent-profile-${agentDigest([session.projectId, profile, field, input.outputTokens]).slice(0, 48)}`;
            const existing = models.listProfiles().profiles.find(p => p.id === id);
            if (existing)
                profileRef = {
                    libraryId: library.libraryId, id, revision: existing.revision
                };
            else {
                const saved = models.saveProfile({
                    id, expectedRevision: 0, name: 'Agent output budget', modelRef: profile.modelRef, parameters: {
                        ...profile.parameters, [field]: input.outputTokens
                    }
                }, true);
                if (!saved.ok)
                    return saved;
                profileRef = saved.value;
            }
        }
        const runId = randomUUID();
        const generationPlan = generation.prepare({
            projectId: session.projectId, profileRef, prompt: context.value.prompt, inputVersion: agentDigest([context.value.targets, context.value.prompt]), executionOwner: session.executionOwner, runId
        });
        if (!generationPlan.ok)
            return generationPlan;
        const prepared: PreparedAgentTurn = {
            libraryId: library.libraryId, sessionId: session.sessionId, runId, projectId: session.projectId, executionOwner: session.executionOwner, mode: session.mode, message: input.message, template, targets: context.value.targets, context: context.value.manifest, generation: generationPlan.value, sourceProfileRef: input.profileRef, createdAt: Date.now()
        };
        db.prepare("INSERT INTO agent_run(run_id,session_id,prepared_json,state) VALUES(?,?,?,'PREPARED')").run(runId, session.sessionId, JSON.stringify(prepared));
        db.prepare("INSERT INTO agent_message VALUES(?,'user',?,?)").run(runId, input.message, prepared.createdAt);
        return ok(prepared);
    }
    function approveTurn(input: AgentApproveTurnInput): Result<AgentRunView> {
        const found = run(input.runId);
        if (!found.ok)
            return found;
        const r = found.value, p = r.prepared;
        if (input.approval.preparedId !== p.generation.preparedId || input.approval.runId !== r.runId || input.approval.executionOwner !== p.executionOwner)
            return fail('APPROVAL_MISMATCH', '审批不属于此轮次。');
        if (r.task) {
            const replay = generation.approve(input.approval, r.runId);
            return replay.ok ? found : replay;
        }
        if (r.stopped)
            return fail('AGENT_STOPPED', '轮次已停止。');
        const currentSource = db.prepare('SELECT MAX(revision) AS revision FROM profile_revision WHERE id=? AND library_id=?').get(p.sourceProfileRef.id, library.libraryId);
        if (currentSource?.revision !== p.sourceProfileRef.revision)
            return fail('CONFIG_CHANGED', '所选 Profile 已有新修订。');
        const fresh = checkPreparedTargets(p);
        if (!fresh.ok)
            return fresh;
        const task = generation.approve(input.approval, r.runId);
        if (!task.ok)
            return task;
        db.prepare("UPDATE agent_run SET task_json=?,state='PLANNING' WHERE run_id=?").run(JSON.stringify(task.value), r.runId);
        return run(r.runId);
    }
    function stop(input: AgentStopInput): Result<AgentRunView> {
        const found = run(input.runId);
        if (!found.ok)
            return found;
        if (found.value.prepared.executionOwner !== input.executionOwner)
            return fail('APPROVAL_MISMATCH', '执行身份不符。');
        // The gate and cancellation intent commit together before any async work can observe them.
        db.prepare("UPDATE agent_run SET stopped=1,state='STOPPED' WHERE run_id=?").run(input.runId);
        if (found.value.task) {
            const cancel = generation.cancel(found.value.task.taskId);
            if (!cancel.ok)
                return cancel;
        }
        return run(input.runId);
    }
    function acceptProposal(input: AgentAcceptProposalInput): Result<AgentActionReceipt> {
        const found = run(input.runId);
        if (!found.ok)
            return found;
        const r = found.value;
        if (r.projectId !== input.projectId || r.prepared.executionOwner !== input.executionOwner || r.proposal?.proposalHash !== input.proposalHash)
            return fail('APPROVAL_MISMATCH', '提案哈希、项目或执行身份不符。');
        const selectionHash = agentDigest({
            proposalHash: input.proposalHash, shots: [...input.selectedShotKeys].sort(), entities: [...input.selectedEntityKeys].sort(), script: input.includeScript
        });
        if (r.action)
            return r.action.selectionHash === selectionHash ? ok(r.action) : fail('APPROVAL_REUSED', '此轮次已采用不同的选择，请开始新轮次。');
        if (r.stopped)
            return fail('AGENT_STOPPED', '轮次已停止，迟到提案仅供查看。');
        if (!r.proposal || r.state !== 'PROPOSED')
            return fail('AGENT_PROPOSAL_NOT_READY', '提案尚不可采用。');
        if (r.proposal.expiresAt <= Date.now())
            return fail('APPROVAL_EXPIRED', '提案批准已到期，请开始新轮次。');
        if (!input.includeScript && !input.selectedShotKeys.length && !input.selectedEntityKeys.length)
            return fail('INVALID_INPUT', '请选择至少一个提案内容。');
        const application = agentApplication(r.prepared, r.proposal.draft, input);
        if (!application.ok)
            return application;
        const fresh = checkVersions(r.projectId, application.value.versions);
        if (!fresh.ok)
            return fresh;
        const result = creation.applyBatch(application.value.batch);
        if (!result.ok)
            return result;
        const receipt: AgentActionReceipt = {
            libraryId: library.libraryId, runId: r.runId, projectId: r.projectId, actionId: `agent-action-${agentDigest(r.runId).slice(0, 48)}`, proposalHash: input.proposalHash, selectionHash, acceptedReferences: result.value.shots.map(s => ({
                shotId: s.id, shotRevision: s.revision, scriptId: s.scriptId, scriptRevision: result.value.scripts.find(parent => parent.id === s.scriptId)?.revision ?? r.prepared.targets.script!.revision, sceneId: s.sceneId
            })), acceptedShotKeys: application.value.shotKeys, skippedShotKeys: r.proposal.draft.shots.filter(s => !input.selectedShotKeys.includes(s.key)).map(s => s.key).sort(), acceptedEntityKeys: application.value.entityKeys, includeScript: application.value.includeScript, result: result.value, createdAt: Date.now()
        };
        db.prepare('INSERT INTO agent_action VALUES(?,?,?,?)').run(r.runId, receipt.actionId, selectionHash, JSON.stringify(receipt));
        db.prepare("UPDATE agent_run SET state='ACCEPTED' WHERE run_id=?").run(r.runId);
        for (const [kind, values] of [['creation.entitySaved', result.value.entities], ['creation.scriptSaved', result.value.scripts], ['creation.shotSaved', result.value.shots]] as const)
            for (const value of values)
                db.prepare('INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,?,?)').run(library.libraryId, kind, JSON.stringify(value));
        return ok(receipt);
    }
    async function harvest(stopping: () => boolean): Promise<Result<void>> {
        const owner = library.checkOwnership();
        if (!owner.ok)
            return owner;
        for (const row of db.prepare('SELECT run_id FROM agent_run WHERE task_json IS NOT NULL AND harvested=0 ORDER BY rowid').all()) {
            if (stopping())
                break;
            const found = run(row.run_id as string);
            if (!found.ok)
                return found;
            const r = found.value, task = generation.read(r.task!.taskId);
            if (!task.ok)
                return task;
            let state: AgentRunView['state'] = 'PLANNING', error: string | null = null, proposal: AgentProposal | null = null, reply: string | null = null, harvested = false;
            if (task.value.state === 'SUCCEEDED' && task.value.artifactRef) {
                const original = await assets.readFixedOriginal(task.value.artifactRef);
                if (stopping())
                    break;
                if (!original.ok) {
                    // A missing/corrupt original belongs to this run, not the scheduler.
                    // Leave harvested false so the same materialized task can recover locally.
                    state = 'FAILED';
                    error = original.error.code;
                }
                else {
                    const parsed = parseAgentProposal(new TextDecoder().decode(original.value.bytes));
                    harvested = true;
                    if (!parsed.ok) {
                        state = 'INVALID';
                        error = parsed.error.code;
                    }
                    else {
                        const draft = parsed.value;
                        const valid = agentApplication(r.prepared, draft, {
                            selectedShotKeys: draft.shots.map(s => s.key), selectedEntityKeys: draft.entities.map(e => e.key), includeScript: !!draft.script
                        });
                        if (!valid.ok) {
                            state = 'INVALID';
                            error = valid.error.code;
                        }
                        else {
                            reply = draft.reply;
                            state = draft.script || draft.entities.length || draft.shots.length ? 'PROPOSED' : 'REPLIED';
                            if (state === 'PROPOSED') {
                                const expiresAt = Date.now() + 600000;
                                proposal = {
                                    draft, expiresAt, proposalHash: agentDigest({
                                        runId: r.runId, projectId: r.projectId, executionOwner: r.prepared.executionOwner, targets: r.prepared.targets, draft, expiresAt
                                    })
                                };
                            }
                        }
                    }
                }
            }
            else if (['SUBMISSION_UNKNOWN', 'RECONCILE_REQUIRED'].includes(task.value.state)) {
                state = 'UNKNOWN';
                error = task.value.errorCode ?? task.value.state;
            }
            else if (['FAILED', 'CANCELLED'].includes(task.value.state)) {
                state = 'FAILED';
                error = task.value.errorCode ?? task.value.state;
                harvested = true;
            }
            else
                continue;
            const ownership = library.checkOwnership();
            if (!ownership.ok)
                return ownership;
            try {
                db.exec('BEGIN IMMEDIATE');
                const current = run(r.runId);
                if (!current.ok) {
                    db.exec('ROLLBACK');
                    return current;
                }
                if (current.value.harvested) {
                    db.exec('ROLLBACK');
                    continue;
                }
                if (current.value.stopped)
                    state = 'STOPPED';
                if (!harvested && current.value.state === state && current.value.errorCode === error) {
                    db.exec('ROLLBACK');
                    continue;
                }
                db.prepare('UPDATE agent_run SET state=?,error_code=?,harvested=?,proposal_json=? WHERE run_id=?').run(state, error, harvested ? 1 : 0, proposal ? JSON.stringify(proposal) : null, r.runId);
                if (reply !== null)
                    db.prepare("INSERT INTO agent_message VALUES(?,'assistant',?,?)").run(r.runId, reply, Date.now());
                const changed = run(r.runId);
                if (!changed.ok)
                    throw Error('INVALID_STORED_DATA');
                db.prepare("INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,'agent.changed',?)").run(library.libraryId, JSON.stringify(changed.value));
                db.exec('COMMIT');
            }
            catch {
                if (db.isTransaction)
                    db.exec('ROLLBACK');
                return fail('AGENT_HARVEST_FAILED', '规划结果尚未收存，下次会核对现有任务。');
            }
        }
        return ok(undefined);
    }
    const coordinator = workflowCoordinator(harvest);
    return {
        createSession, prepare, savePrepared, approveTurn, acceptProposal, stop, read, run, list(projectId: string) {
            const checked = creation.read({
                projectId
            });
            if (!checked.ok)
                return checked;
            return ok({
                libraryId: library.libraryId, projectId, sessions: db.prepare('SELECT data_json FROM agent_session WHERE project_id=? ORDER BY rowid').all(projectId).map(r => JSON.parse(r.data_json as string) as SessionBase)
            });
        }, templates: () => ({
            templates: structuredClone(agentTemplates)
        }), ...coordinator
    };
}
