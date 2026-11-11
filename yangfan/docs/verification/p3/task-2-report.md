# Task 2 report — durable creation Agent

Status: implemented, focused verification passed, committed; ready for controller's independent review. Commit: c52f967 (feat: add durable creation agent planning and proposal approval). Started from controller baseline 843a3e4 on codex/desktop-foundation. Only 24 exact implementation/test files were staged. Existing release directories, unrelated docs/prototypes/specs, user libraries and running app PID9268 were not touched. No GUI launch, real provider, raw configuration/key read, D:/rea access, full suite or packaging was performed.

## Public transport interfaces

All calls use the existing schemaVersion1 CommandEnvelope/QueryEnvelope and current library/epoch. Commands participate in existing receipt/event transactions:

- agent.createSession(AgentCreateSessionInput) -> AgentSessionView
- agent.prepareTurn(AgentPrepareTurnInput) -> PreparedAgentTurn (async fixed-source preflight, then synchronous transactional publication)
- agent.approveTurn(AgentApproveTurnInput) -> AgentRunView (contains original TaskRef)
- agent.acceptProposal(AgentAcceptProposalInput) -> AgentActionReceipt
- agent.stop(AgentStopInput) -> AgentRunView

Queries:

- agent.list({projectId:string}) -> AgentSessionList
- agent.read({sessionId:string}) -> AgentSessionView
- agent.run({runId:string}) -> AgentRunView
- agent.templates({}) -> AgentTemplateList

Events, all advertised in LocalConnection.describe(): agent.sessionCreated -> AgentSessionView; agent.prepared -> PreparedAgentTurn; agent.changed -> AgentRunView; agent.accepted -> AgentActionReceipt. Adopting also publishes creation.entitySaved/scriptSaved/shotSaved for actual committed revisions.

Parsers exported from contracts/agent.ts: parseAgentCreate, parseAgentPrepare, parseAgentApprove, parseAgentAccept, parseAgentStop. Public output guards: isPreparedAgentTurn, isAgentAction, isAgentRun, isAgentSession, isAgentList, isAgentTemplate, isAgentTemplates. Domain parseAgentProposal(text:string): Result<AgentProposalDraft> validates full model output.

Exact exported DTOs (imports reuse MediaReference/MediaMetadata, RevisionRef, PreparedGeneration, TaskRef, ApproveGenerationInput and Task1 creation types):

```ts
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
```

## Engine interfaces and lifecycle

EngineHandle.agents is ReturnType<typeof agentsFor>. Constructor:

```ts
agentsFor(library: LibraryHandle,
  generation: ReturnType<typeof generationFor>,
  models: ReturnType<typeof modelConfigFor>,
  creation: ReturnType<typeof creationFor>,
  assets: ReturnType<typeof assetsFor>)
```

Returns createSession(input):Result<AgentSessionView>; prepare(input):Promise<Result<Preflight>>; savePrepared(preflight):Result<PreparedAgentTurn>; approveTurn(input):Result<AgentRunView>; acceptProposal(input):Result<AgentActionReceipt>; stop(input):Result<AgentRunView>; read(sessionId):Result<AgentSessionView>; run(runId):Result<AgentRunView>; list(projectId):Result<AgentSessionList>; templates():AgentTemplateList; start/wake():Promise<Result<void>>, pause/close():Promise<void>, resume():void.

Preflight is engine-internal, containing validated input, captured SessionBase, template and successful agentContext result. Only router calls savePrepared inside its transaction; neither prepare nor coordinator creates a planning task. New task creation occurs only in approveTurn -> generation.approve. Mutating service handlers share the router transaction just like Task1; external callers should use commands, not bypass the router.

agent-context.ts exports captureAgentTargets(snapshot,input):Result<CapturedAgentTargets> and async agentContext(...):Promise<Result<{prompt,manifest,targets}>>. agent-application.ts exports agentDigest, AgentApplication {batch:CreationBatch;versions:{kind:CreationKind;id;revision}[];entityKeys;shotKeys;includeScript} and agentApplication(prepared,draft,selection):Result<AgentApplication>. This resolver does no writes.

Coordinator reuses workflowCoordinator lifecycle and performs only local durable-task reads and fixed artifact reads. scheduler.start starts Agent harvesting and P2 workflow/task scheduling. Maintenance pauses and drains Agent work with other coordinators; quiesce closes/drains it before library close. start/reopen/wake never creates a new planning task, never approves, never applies content and never retries the provider. Existing approved P2 task recovery remains P2-owned.

State transitions:

- prepareTurn -> PREPARED, one durable user message, frozen template/context/generation plan, no POST or creation write.
- approveTurn -> PLANNING with one P2 TaskRef; identical repeats preserve it. A different financial approval is rejected by P2 APPROVAL_REUSED.
- successful materialized output -> PROPOSED if there are drafts, otherwise REPLIED; stores one assistant reply and parsed proposal at most once.
- malformed/over-bound/injected/truncated structured output -> INVALID / INVALID_AGENT_OUTPUT, retains task/artifact for inspection.
- P2 FAILED or CANCELLED -> FAILED with its reason.
- P2 SUBMISSION_UNKNOWN or RECONCILE_REQUIRED -> UNKNOWN; retains TaskRef and continues local observation, no new POST.
- stop first commits stopped gate and P2 cancellation intent; state is STOPPED. A late already accepted result can be harvested historically, but remains STOPPED and adoption fails AGENT_STOPPED.
- accepted adoption -> ACCEPTED, one stable action receipt. Stopping an already accepted run preserves action history; it cannot undo committed content.

Schema12 adds agent_session, agent_run (immutable prepared_json and write-once proposal_json), agent_message and immutable agent_action. Proposal/action are persisted data, not renderer state. Prepared/task/proposal/action timestamps use epoch milliseconds; creation revisions retain Task1 ISO createdAt.

## Model protocol, template and context contract

Modes: all, script, director. Version1 template IDs: short-film, product-ad, character, continue-shots. Templates are frozen into each PreparedAgentTurn; short-film/product-ad permit script/entity/shot, character permits entity only, continue-shots permits entity/shot. Suggestions are 4/4/0/3 shots and 4096/4096/2048/4096 output tokens respectively. Complete output constraints are frozen in the generation prompt as well.

Strict protocol: exactly one complete JSON object, optionally wrapped by one complete json fence. Bare prose, prose surrounding JSON, multiple JSON documents, truncated JSON, unknown fields and malformed draft arrays are INVALID. Per controller confirmation an ordinary reply is {schemaVersion:1,reply:'...'} with no drafts; bare prose is not a fallback. Optional omitted script/entities/shots normalize to null/[]/[]; explicit null arrays are rejected. Hidden provider thinking is excluded by the existing text adapters.

Draft keys are local [a-zA-Z0-9_-]{1,64}; model output cannot supply project IDs, expected revisions, model changes, commands, paths, credentials or arbitrary fixed media refs. Draft bounds are the specified Task1 text bounds, max32 entity/shot drafts, max32 scenes, max8 entity aliases per shot, max4 asset aliases per entity, max8000 reply characters, total256KiB. Draft scene uses key instead of id; shot uses sceneKey/entityKeys; entity uses assetKeys. Other shot fields exactly match Task1. All cross-draft/captured aliases and template permissions are resolved before proposal publication.

Existing target aliases are engine-assigned in the explicit input order: shot-0 etc, entity-0 etc, scene-0 etc (from captured parent script scenes), asset-0 etc. Any other valid draft key creates a new deterministic engine-owned object ID: agent- + first48 hex of SHA256(JSON.stringify([runId,kind,key])). The script's local identity is the selected/captured script, or deterministic new script key 'script'. All selected shots must share one parent script. Selecting a shot automatically captures its parent ScriptRevision, even when targets.scriptId was omitted. Only explicitly selected entities are writable existing entity targets.

Selected assets are fixed MediaReference, max8. Text original bytes pass assets.readFixedOriginal; images/video contribute metadata only, with a visible notice. Context prioritizes schema, exact user request (max4000), source-version manifest, selected script summary/body excerpt, shots/entities, asset metadata/text excerpts, last8 messages, project canvas summary. Source chunks remain complete JSON; body excerpt max4000, asset text max3000, recent message text max1500 with omissions recorded. Unselected content/older conversation is omitted explicitly. Prompt remains <=16000 characters; an overlarge mandatory manifest returns AGENT_CONTEXT_LIMIT rather than truncating JSON. Source content is explicitly untrusted data, never command authority.

prepareTurn outputTokens optional integer1..8192; omission inherits selected Profile. An override creates/reuses a project-derived immutable agent-profile-<hash> revision1, preserves the model's max_completion_tokens or max_tokens field, and displays actual frozen config.parameters in PreparedAgentTurn.generation. It never mutates global files. SourceProfileRef is captured and checked for currentness at prepare and approve; generation preserves frozen connection/model/Profile and credential versions. Derived Profile namespace is reserved against ordinary profile.save (IMMUTABLE_PROFILE). prepareTurn and approveTurn enter main ensureCurrent new-admission gate; receipt replay bypass remains recovery. P2 generation.approve accepts an internal optional agentRunId; direct generic generation.approveAndEnqueue against an Agent prepared plan fails AGENT_AUTHORIZATION, so it cannot bypass stop or detach its task. Internal Agent approval/replay is tested.

## Adoption and Task3 handoff

ProposalHash binds runId, projectId, executionOwner, captured targets, complete normalized draft and expiresAt. Expiry is harvest-time +600000ms. acceptProposal never accepts a renderer-provided revision or batch. It resolves the stored draft/targets, checks owner/project/hash/expiry and applicable current revisions, then calls creation.applyBatch within the same router transaction as action and command receipt.

The first adoption selects selectedShotKeys, selectedEntityKeys and includeScript. Chosen shots automatically include required entity drafts and draft scenes. Captured entities can also be referenced unchanged. All unrelated draft entities/shots stay unadopted. With an existing script, selecting only shots and dependent scenes preserves its prior title/synopsis/body; includeScript:true explicitly adopts script prose and all draft scenes. Existing scenes are preserved/merged so unrelated shots never dangle. New script dependencies use the draft prose. CAS checks only modified/referenced content: selected existing shots, needed entities and parent script when shots/script are used. Unrelated selected entity edits do not invalidate adoption.

SelectionHash = SHA256(JSON.stringify({proposalHash,shots:sortedSelectedShotKeys,entities:sortedSelectedEntityKeys,script:includeScript})). Exactly one canonical adoption per run is allowed. Same hash returns saved action receipt and same IDs/revisions, including after expiry/stop/restart; different hash returns APPROVAL_REUSED. This includes explicit key selection, even when its dependency closure happens to be the same. Empty selection is rejected. Changing immutable draft content or adopting remaining ideas requires a new explicitly approved turn, per controller's agreed scope. Stable actionId is agent-action- + first48 hex SHA256(JSON.stringify(runId)). Receipt exposes accepted/skipped shot keys, accepted entity keys, effective includeScript, full CreationBatchResult and acceptedReferences.

Task3 should use action.acceptedReferences: {shotId,shotRevision,scriptId,scriptRevision,sceneId}[] plus action.result.shots/entities/scripts. Parent scriptRevision is the newly committed script revision when adopted or the frozen existing parent revision otherwise; do not infer it from current script state. Agent adoption does not authorize media generation.

## TDD and validation evidence

TDD RED observed before implementation:

1. D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/agent-planning.test.ts ->12 failed, all at missing agent.createSession command after valid real native fixture setup. After contract/service/router implementation:12 passed and typecheck exit0.
2. agent-recovery.test.ts ->2 failed/5 passed: generic generation bypassed stopped Agent; derived Profile could be rewritten. Added scoped admission and immutable namespace guards. Next run ->1 failed/6 passed, exposing stale source Profile derivation.
3. Added stale-after-prepare and empty-adoption cases ->3 failed/6 passed. Added current source Profile checks and nonempty adoption validation ->21 total Agent tests passed.
4. Partial scene-only adoption case ->1 failed/12 passed (model prose overwrote unselected manual prose); resolver now preserves existing prose for implicit scene dependencies ->23 total tests passed including actual held HTTP request stopped in flight.
5. acceptedReferences handoff test ->undefined assertion RED; added exact parent/shot refs ->GREEN.
6. Final strict null draft array regression ->true-vs-false RED; explicit null is now rejected ->25/25 Agent tests GREEN.

Broader affected regression, exit0:

```text
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/agent-planning.test.ts tests/integration/agent-recovery.test.ts tests/integration/migration-creation.test.ts tests/integration/text-generation.test.ts tests/integration/model-config.test.ts tests/integration/workflow-execution.test.ts tests/integration/command-delivery.test.ts
7 files, 91 tests passed (before final null-array-only regression)
```

Latest verification after final code change, exit0:

```text
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/agent-planning.test.ts tests/integration/agent-recovery.test.ts
2 files, 25 tests passed
D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json
no errors
git diff --check / git diff --cached --check
no whitespace errors
```

Expected existing Node experimental SQLite warnings appeared; Git reports configured LF->CRLF conversion warnings. No test failures remain. Schema10 fixture now includes explicit populated connection/model/profile, prepared/task/attempt/scheduler and workflow/step rows; migration compares every preexisting table row, fixed-original hash, foreign-key integrity and backup user_version10.

Self-review checked no provider POST or creation write before approval; one request per turn; strict bounds/authority filtering; parent CAS; dependency-only application; duplicate action/command receipts; stopped late result retention; restart/unknown behavior; main admission gate; coordinator drain; immutable profiles; source currentness; query/event integration. No broader P2 audit was performed.

## Remaining limitations / concerns

No known blocking concern. No UI, Task3 media/production or Task4 export implementation is included. Raw free-form replies are deliberately INVALID; valid no-proposal replies still require the versioned JSON envelope. One adoption subset per turn is intentional and must be explained by UI with skippedShotKeys. New semantic draft edits require a new turn; this task exposes no mutable proposal-edit endpoint. Full core suite, packaging and Electron end-to-end checks remain controller/final-integration work. Real Kimi/paid-provider long-form output quality and real media chains remain unverified; all model tests use local HTTP fixtures and explicit fixture config.

## Review fix round — Important 1 (2026-10-26)

FIX_BASE: c52f967ecf97ba6953bfb563d76df1f0f9a0de69. Fix commit: 43a525d56e85d3d5aaed2996599afdca77642349 (fix: isolate creation agent artifact harvest failures). Only packages/engine/src/agent-service.ts and tests/integration/agent-recovery.test.ts changed and were staged. No minor-finding triage or broader P2 audit was included.

Verified review finding: the first unsuccessful assets.readFixedOriginal Result previously returned from the ordered harvest loop before later runs or workflow/task startup could proceed. The amended branch now records that read error as a run-local state using the existing shared transaction/event publication path, then proceeds to independent runs. No bootstrap change was required: handled run-local read errors now yield a successful Agent start/tick, so existing workflow/base-scheduler startup proceeds. Actual ownership or state-commit failures retain their global failure semantics.

Public contract remains unchanged. A completed P2 task with an unreadable original now exposes Agent state FAILED (or STOPPED if the durable stop gate is closed), errorCode equal to the fixed-reader failure (fixture: OBJECT_INTEGRITY_FAILED), harvested:false, its original TaskRef, and no proposal. The underlying P2 task remains materialized/SUCCEEDED. Retaining harvested:false permits recovery of the same fixed artifact on a later wake/reopen after original restoration; it does not create a task, reapprove, resubmit, or modify content. The successful local recovery clears errorCode and sets harvested:true and REPLIED/PROPOSED, while STOPPED remains STOPPED. Both the stopping callback check immediately after awaited reading and transaction-time durable stop-gate reread remain in place. Repeated unchanged read failure emits no duplicate agent.changed event.

Focused real-fixture test (parameterized stopped=false/true):

1. Create and actually execute two independently approved Agent turns via the local HTTP text fixture, leaving their artifacts unharvested. Corrupt only the first original's bytes at its content-addressed path inside the temporary fixture library.
2. Queue one independent ordinary P2 generation task, close and reopen the engine, then call the actual scheduler.start wrapper.
3. Assert startup succeeds; first run has visible durable read error and original task; second run is REPLIED/harvested; independent queued task reaches SUCCEEDED; exactly two planning POSTs exist (three total POSTs including the independent task).
4. Wake again with the corrupted original and assert exactly one failure event was committed.
5. Restore the saved original bytes, wake, and assert the first task is recovered locally, assistant message recorded once, STOPPED preserved where applicable, task count unchanged at3, and POST count unchanged at3.

RED command and observed result before production change:

```text
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/agent-recovery.test.ts -t 'isolates an unreadable'
2 failed, 11 skipped; both failures were actual scheduler.start Result ok:false vs expected ok:true.
```

GREEN focused command after the read-error branch correction:

```text
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/agent-recovery.test.ts -t 'isolates an unreadable'
2 passed, 11 skipped; exit0.
```

Final directly affected validation:

```text
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/agent-recovery.test.ts tests/integration/engine-lifecycle.test.ts
2 files, 18 tests passed; exit0.
D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json
no errors; exit0.
git diff --check
git diff --cached --check
no whitespace errors; exit0.
```

Node's existing experimental SQLite warnings and Git LF-to-CRLF warnings remained visible and are not claimed as pristine output. No remaining known blocker in this fix. The earlier91-test set was not rerun, as directed. No GUI, real provider/user key/user library, release directory or live PID action was taken. Tracked worktree was clean after the fix commit.
