# P2 typed canvas and durable workflow API

The source schema is 10: asset metadata (8), typed graph edges and input provenance (9), durable workflows (10). Task 5 owns the complete graph UI and packaged Electron verification. This change makes no paid requests and reads no user model-config file during development.

## Canvas

`canvas.read({canvasId})` now returns `edges: CanvasEdge[]` (empty for migrated canvases). `CanvasContent` retains `text`, legacy `image`, and `generation`, and adds `media` with the same fixed `media: MediaReference` field. Determine fixed media type from its original MIME. Determine generation output/input types from declared model capabilities, not the model name.

A `canvas.applyCommand` batch accepts these additional operations:

```ts
{ kind: 'addEdge', edge: {
  id, sourceNodeId, sourceIncarnation, targetNodeId, targetIncarnation,
  sourcePort: 'output', targetPort: 'prompt' // or reference / first_frame / last_frame
} }
{ kind: 'removeEdge', edgeId }
```

Supply the current observed `baseRevision` for edge edits, including edge undo. Prompt takes text; the image ports take image. First/last frame requires the declared MiniMax adapter. Connection-compatible edits are validated again when existing media/model selections change. Incompatible edits require disconnecting first. Delete removes incident edges; undo restores fresh node incarnations and remaps only the restored subgraph's edges. Derived semantic changes run after batch field checks.

Layout changes do not invalidate generation. Manual content, edge, and selection changes invalidate downstream semantics. Automatic upstream output changes are tracked separately through frozen transitive input provenance, so a normal approved chain binds but old dependent outputs become stale. A child consuming approved B cannot bind as current for a subsequently selected C. Only actual StepOutput execution paths substitute produced artifacts into binding provenance. An external fixed input keeps its approved ancestry as an observation, even when an ancestor is independently selected for execution: that ancestor’s missing/failed task does not block the fixed-input consumer. Later live ancestry changes still make its result historical-only, including when one producer participates in both a dynamic input path and a fixed external path.

## Public workflow commands

Use the usual schemaVersion/libraryId/connectionEpoch/commandId command envelope. Each fresh command needs a unique commandId; replay an unconfirmed command with its original ID and payload.

```ts
const previewReceipt = await connection.execute({ ...envelope, kind: 'workflow.prepare', payload: {
  canvasId, mode: 'upstream', nodeIds: [targetNodeId],
  executionOwner: ownerId, runId,
} });
// On success, previewReceipt.value.result is PreparedWorkflow.
const plan = previewReceipt.value.result;
const approved = await connection.execute({ ...nextEnvelope, kind: 'workflow.approveAndEnqueue', payload: {
  planId: plan.planId, approvedPlanHash: plan.planHash,
  currency: 'CNY', budgetLimitMicros,
  stepAllowances: Object.fromEntries(plan.steps.map(step => [step.stepId, chosenAllowance[step.stepId]])),
  acknowledgeUnknown, executionOwner: plan.executionOwner, runId: plan.runId,
} });
// Output is WorkflowView; workflowId equals planId.
await connection.execute({ ...stopEnvelope, kind: 'workflow.stop', payload: { workflowId: plan.planId } });
```

Modes are deliberately different:

- `current`: exactly one generation node. Never creates an upstream task. Each external generation input needs an explicit fixed selection; missing/stale selections fail. A deliberate fixed selection with unknown lineage is accepted after ownership/MIME/existence/trash validation, frozen exactly, and still labelled `unknown` in `externalInputs`.
- `upstream`: one or more generation targets and their required ancestors. It does not reuse generated output as a cache: selected generation steps run again under this approval.
- `selection`: selected nodes only. Fixed text/media nodes may be selected; only generation nodes become steps. It never expands to external generation nodes. External inputs need the same fixed selection checks as `current`. A fixed-only selection has no executable steps and is rejected.

Canvas editing and reading have no 128-edge global ceiling: unrelated components do not consume a small plan’s scope. The actual input-provenance closure of a plan is bounded at 128 edges and rejected explicitly if oversized, never truncated. At most 32 generation steps and 128 plan dependencies; selection admission allows at most 160 selected IDs (32 steps plus up to 128 fixed inputs). Prompt and reference protocols remain distinct: text→prompt, image→reference/first_frame/last_frame, no video input. Text generation uses bounded max_tokens; image generation and image-edit retain their declared protocols; MiniMax retains duration/resolution/ratio and first/last/reference rules. Known impossible role/mode combinations are rejected in preview. Pending outputs are checked again against the destination's prompt/dimension/byte limits before any downstream POST; no truncation or silent substitutions.

`PreparedWorkflow` contains scope, planId/hash/expiry, library/project/canvas identity, observed revision, semantic/selection/incarnation observations, frozen external refs+metadata+provenance, and steps. Each step has a stable `stepId` (node ID scoped to this plan), a frozen `PreparedGeneration` template, `inputs` (`text`, `media`, or `stepOutput`), and frozen `graphInputs`. A template is preview data, never an arbitrary renderer-dispatch capability. Price is in each template's `estimateMicros`/`currency`, plus aggregate plan estimates and limits. Layout alone does not invalidate approval.

Approval covers every step exactly once. Amounts are positive integer currency millionths, bounded at 1e12. Unknown prices need explicit acknowledgement. Mixed configured currencies fail. Waiting steps reserve project budget alongside ordinary tasks; their child tasks receive those reservations by atomic transfer. An already-reserved transfer does not request new quota. Successful/accepted/unknown provider work retains risk reservations because success is not billing settlement.

## Refresh and lifecycle

Queries: `workflow.read({workflowId}) -> WorkflowView`; `workflow.list({}) -> WorkflowSnapshot` with `workflows`, `snapshotSeq`, `streamId`. Query through the existing connection; the renderer never calls engine-internal frozen-step APIs.

Subscribe to `workflow.prepared`, `workflow.changed`, `task.changed`, and `canvas.changed`. Refresh the relevant workflow/task/canvas snapshots on those events and on reconnection; do not derive dependent task creation in the UI. Main/utility/renderer output validators and LocalConnection capability descriptors include the new DTOs. Definitive plan/graph errors settle the outbox; commit/transport uncertainty remains pending for receipt replay. New workflow preview/approval uses the same main-side global-config synchronization gate as ordinary generation.

Workflow states: prepared, running, stopping, succeeded, failed, stopped, needs_attention. Step states: waiting, queued, running, succeeded, blocked, failed, stopped, needs_attention. Unknown submit blocks dependents and retains risk while independent branches remain eligible. Blocked dependents release unsubmitted quota; they need a new plan/approval to run later. Stop prevents new child creation, cancels queued children with no dispatch intent, and releases only proved-unsubmitted allowance. Already intended/accepted/unknown work can still reconcile and collect; stopping with unknown cloud work may persist indefinitely until its original task is resolved.

Engine-internal factory: `workflowsFor(library, canvas, generation, models, assets)`. `prepare` performs read-only async fixed-input preflight; `savePrepared` commits its result in the command receipt transaction after rechecking observations. `approve` and `stop` are synchronous transaction handlers; `read/list` are snapshots. `wake/start/pause/resume/close` coordinate only durable ready steps; the existing scheduler owns all provider I/O. Engine maintenance/quiesce closes coordinator admission first and immediately closes task admission before awaiting either drain. Never expose `savePrepared` or `generation.enqueueWorkflowStep` on IPC.

## Evidence and boundaries

Integration fixtures exercise real SQLite and local native HTTP for text→image→MiniMax first-frame video; accepted video recovery queries the exact original ID. The bounded MP4 fixture is staged as an already durable provider spool before query recovery, rather than using a live provider/CDN. Real child processes exit before, during, and after child-task linking to verify rollback/replay and reservation transfer. Other tests cover unknown submissions, loss of ACK, stop/readiness races, maintenance drain, profile changes, credential revocation, external fixed input admission, graph typing/undo, and historical-only late results.

Full pre-hardening integration run: 29 files / 367 tests passed. Later targeted hardening results and exact commands are recorded in the task report. No provider acceptance, graphical UI completion, or packaged Electron workflow verification is claimed by these fixtures.
