# Task 3 report — shot production, canvas binding and workflow association

Status: implemented, self-reviewed, focused verification passed, committed as `0c7c1ec` (`feat: bind shot production to canvas workflows and history`). Base was `43a525d` on `codex/desktop-foundation`. Only the 20 exact Task 3 source/test files were staged. Existing release directories, unrelated untracked design files, user libraries, config and running PID 9268 were untouched. No GUI or live provider was launched, and no full core suite/package run was made (reserved for Task 4).

## Public interfaces and renderer handoff

All commands use the existing schemaVersion 1 `CommandEnvelope`, command receipts and event transaction. `packages/contracts/src/shot-production.ts` exports the parsers, DTOs and guards below. `RevisionRef` and `MediaReference` are existing P2 types.

```ts
type ShotProductionSelection = { shotId: string; revision: number };
type PrepareShotProductionInput = {
  projectId: string; scriptId: string; canvasId: string;
  shots: ShotProductionSelection[]; // unique, 1–16
  imageProfileRef?: RevisionRef; videoProfileRef?: RevisionRef; // at least one
  executionOwner: string; runId: string;
};
type ApplyShotProductionInput = {
  productionId: string; approvedHash: string; expectedCanvasRevision: number;
  executionOwner: string; runId: string;
};
type AttachShotWorkflowInput = { productionId: string; workflowId: string; executionOwner: string };
type StopShotProductionInput = { productionId: string; executionOwner: string };
type SelectShotProductionOutputInput = {
  projectId: string; shotId: string; expectedRevision: number;
  expectedSelectionRevision: number; role: 'image' | 'video'; reference: MediaReference | null;
};
```

Commands: `shots.prepareProduction` → `PreparedShotProduction`; `shots.applyProduction` → `ShotProductionView`; `shots.attachWorkflow` → `ShotProductionView`; `shots.stopProduction` → `ShotProductionView`; `shots.selectOutput` → existing `ShotOutputSelection` CAS behavior. Queries: `shots.production({productionId})` → `ShotProductionView`; `shots.history({projectId,shotId})` → `ShotProductionHistory`. Events advertised by desktop `describe()`: `shots.prepared`, `shots.changed`, `shots.outputCollected`; `shots.selectOutput` emits `creation.outputSelected`. All query/receipt/event output guards are registered.

`PreparedShotProduction` contains `libraryId`, `productionId`, `planHash`, `expiresAt`, `canvasRevision`, the exact request identity, `snapshots`, `steps`, `operations`, and limits `{shots:16,steps:32,operations:100,dependencies:128}`. Each snapshot freezes the **full ShotRevision and parent ScriptRevision**, `scriptRevision`, the used scene object, fixed EntityRevisions and captured `selectionRevision`; the hash includes all of these. It does not reconstruct history from current script prose. Each step has `shotId`, `shotRevision`, `role`, deterministic `nodeId`, `sourceProfileRef`, effective `profileRef`, exact `overrides`, fixed prompt, fixed `referenceImages`, and `aspectNotice` explaining exact or adaptive output ratio. Operations preview node creation and `first_frame` edges. The plan expires 10 minutes after preparation.

`ShotProductionView` contains `libraryId`, `productionId`, `projectId`, `state`, frozen `plan`, nullable `workflowId`, and collected `outputs`. States are `prepared`, `applied`, `stopping`, `stopped`; the linked P2 `workflow.read` supplies queued/running/succeeded/failed task states. `ShotProductionHistory` includes `productions` even when they yielded no output. Each production history entry has `productionId`, frozen shot/script revisions, state, nullable workflow ID and node IDs. Each output has `libraryId`, `productionId`, `shotId`, `shotRevision`, role, node/workflow/step/task IDs, fixed `MediaReference`, `selected`, nullable `errorCode` and timestamp. The renderer can query `shots.production` for a batch, `shots.history` for a shot, `workflow.read` for task details, and `canvas.read` for each generation card's optional engine-owned `shotBinding` (`projectId`, `scriptId`, `scriptRevision`, `shotId`, `shotRevision`, `sceneId`, role, `productionId`). Cards should link to the shot editor; bound prompt/config are read-only content.

Exact paid-media flow for Task 4:

1. Call `shots.prepareProduction` with fixed current shot revisions, selected Profile refs, project/canvas and owner/run identity. Display snapshots, node/edge count, fixed references, exact overrides, `aspectNotice`, hash and expiry.
2. Call `shots.applyProduction` with `productionId`, `approvedHash=planHash`, `expectedCanvasRevision=canvasRevision`, same owner/run. This commits derived project profiles, generation nodes, first-frame edges and bindings in **one router receipt transaction**. It submits no media task. Repeated apply returns the existing batch without new nodes.
3. Call existing `workflow.prepare` with `{canvasId,mode:'selection',nodeIds:plan.steps.map(s=>s.nodeId),executionOwner:plan.executionOwner,runId:plan.runId}`. The node set must match exactly. Display the P2 financial/workflow plan.
4. Call `shots.attachWorkflow` with the returned `planId` and same owner. It validates project, canvas, exact nodes, owner/run and `prepared` state; it is one-to-one. Then call existing `workflow.approveAndEnqueue` using the P2 plan hash, budget and step allowances. **Attach must precede approval.** The usual P2 approval is the only media submission authorization.
5. Rehydrate using `shots.production`, `shots.history`, `workflow.read` and `canvas.read`; never submit work on React mount. Call `shots.stopProduction` with owner to close new work and stop the linked P2 workflow. Call `shots.selectOutput` for a deliberate manual choice with both CAS revisions.

`generation.prepare`/`generation.approveAndEnqueue` reject bound nodes outside their approved associated workflow. `workflow.prepare` accepts bound nodes only as the exact production selection with matching owner/run while the production is applied; `workflow.approveAndEnqueue` requires the validated attachment and open production gate. Generic canvas `setContent`, `delete`, restore/undo and input edge changes are rejected on bound nodes. Layout and output selection remain available. Thus neither a stopped nor an unattached bound node can be used to submit an untracked task.

## Storage, profiles and collection

Schema 13 adds `shot_production` (immutable plan), `shot_canvas_binding` (engine-owned immutable binding) and `shot_production_output` (immutable per-task collected result) with project/shot indexes and triggers. Migration is in the existing staged backup path; the schema 10 populated fixture now checks all three tables after migration while preserving its preexisting task/config/workflow rows and original hash.

Preparation validates the current source Profile/model/connection and output capability. Apply checks their latest revisions again before any write, alongside canvas, shot, script and output-selection CAS. For video, duration must be inside the model's declared range; image/first-frame or reference-driven video uses an explicit `ratio:'adaptive'` override. Direct text video requires the requested ratio to be supported. Image size is overridden only when the model declares the matching size; otherwise `aspectNotice` says the target ratio remains an intent. Derived profiles have deterministic `shot-profile-<hash>` IDs, revision 1, and are project-local immutable engine-owned records; global file config and source profiles are untouched. Fixed entity image refs are validated for availability and capability. They are never silently removed from the intended generating step; unsupported combinations fail preparation. First-frame video uses the upstream image output, and the plan shows that edge.

The collector observes the linked P2 workflow's existing successful tasks and fixed artifacts. Each `(production,node,task)` is stored once in a per-artifact transaction. Auto-selection uses the frozen shot revision and the shared image/video `selectionRevision`; it advances the expected selection only by **this production's own recorded successful selections**. An intervening human or different production selection sends a late result to history with `SELECTION_CONFLICT`; a changed shot gives `REVISION_CONFLICT`; a stopped batch gives `PRODUCTION_STOPPED`. The result remains inspectable. Collection is isolated per artifact and per production; a failed or malformed item does not block other steps. The local 500 ms collector is started with the engine scheduler, pauses for maintenance and closes on quiesce. No new dispatcher or cloud request retry was added.

## TDD and verification

Observed RED before production code: `D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/shot-production.test.ts` failed the first prepare/apply test at missing `shots.prepareProduction` (1 failed). Further focused RED cases exposed a rejected production workflow (`SHOT_BOUND` from the standalone approval guard), video-only reference ratio, bound input edge mutation, stopped late-result reason and missing zero-output production history. Each was changed and rerun GREEN. The test file now covers immutable parent scene/shot context, stale script/selection/Profile, wrong capability/reference, 16-shot/32-step/48-operation batch and 17-shot rejection, derived duration/adaptive ratio, reference-video-only plan, repeated regeneration retaining prior nodes, generic mutation/admission/association/stop gates, real local HTTP image→video collection across reopen with both output roles selected (`selectionRevision:2`), intervening manual choice, independent step failure, stopped late history, and no duplicate POST.

Final fresh verification after the last changes:

```text
D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json
  exit 0
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/shot-production.test.ts tests/integration/migration-creation.test.ts tests/integration/creation.test.ts tests/integration/workflow-execution.test.ts tests/integration/canvas-graph.test.ts
  5 files, 65 tests passed; exit 0
git diff --cached --check
  exit 0
```

Expected Node experimental SQLite and Git LF/CRLF notices appeared; there were no TypeScript errors or test failures in the final run. The full core suite, desktop build/package and real providers were not run in Task 3 scope. Real MiniMax/OpenAI acceptance still needs separate product validation after Task 4 UI and packaging.

## Independent review fix round (I1/I2)

This section records the focused fixes after `0c7c1ec`; the original status and 65-test verification above describe the first Task 3 commit. The reviewed collector had swallowed per-item transaction, saved-production and workflow-read failures while reporting a successful empty harvest. It now returns `Result<ShotHarvestReport>` where `ShotHarvestReport = { collected: number; failures: (ShotProductionCollectionIssue & { persisted: boolean })[] }`. Each issue has stable `issueId`, `productionId`, nullable `nodeId` and `taskId`, an `errorCode`, and `createdAt`. The collector records `COLLECTION_WRITE_FAILED`, `COLLECTION_READ_FAILED`, `COLLECTION_STEP_MISMATCH`, `PRODUCTION_READ_FAILED`, or `WORKFLOW_READ_FAILED` as appropriate, then continues to other artifacts and productions. An issue uses a deterministic production/node/task key, so a failed retry returns the same `issueId` and original timestamp. If diagnostic persistence itself fails, the immediate harvest report still includes the failure with `persisted:false`. A successful output transaction deletes its matching issue atomically with output/history collection, so retry neither duplicates the output nor leaves a stale issue. A production read failure can be inspected even when its saved plan is malformed.

The first fix revision placed `shot_production_collection_issue` in schema 13; the additive migration correction below supersedes that placement. `ShotProductionView.collectionIssues` and `ShotProductionHistory.collectionIssues` expose saved diagnostics, with history filtered to the requested shot's bound nodes. New schemaVersion 1 query `shots.collectionIssues({productionId})` returns `ShotProductionIssuesView = { libraryId, projectId, productionId, issues }`; it reads issue rows without decoding the production plan, so it remains available when `shots.production` cannot parse damaged saved data. The renderer should show these codes as collection problems, retain the batch and task links for inspection, and re-query after retry or scheduler wake. On successful retry the issue disappears from both views. `shots.start()` no longer gates the unrelated base scheduler on a per-item collection failure; a top-level pending-list query failure is reported as `PRODUCTION_COLLECTION_FAILED` to direct `harvest()` callers.

The joined integration test now starts with a local HTTP text Agent run that reaches `PROPOSED`, calls `agent.acceptProposal`, and uses the returned accepted script/scene/shot fixed references in `shots.prepareProduction`. It applies the exact same plan twice using fresh command IDs and verifies stable canvas revision, node bindings, edges, derived profiles, and one production history entry. It then follows the renderer's actual `workflow.prepare` → `shots.attachWorkflow` → `workflow.approveAndEnqueue` order, runs local image and video fixtures, reopens the engine for video recovery, and checks the accepted shot's fixed script/shot revisions, image/video history, shared `selectionRevision:2`, and no duplicate provider request. This is joined evidence beyond the earlier manual-content and regeneration tests.

Focused RED/GREEN evidence for the fix round:

```text
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/shot-production.test.ts -t "reports one durable"
  RED: harvest returned undefined instead of a failure report; then GREEN after persisted per-item diagnostics.
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/shot-production.test.ts -t "takes an accepted Agent"
  Initial failure exposed a fixture budget below the Agent reservation; adjusted only the fixture cap, then GREEN.
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/shot-production.test.ts -t "exposes malformed saved"
  RED: independent issues query unavailable and immutable workflow trigger blocked deliberate corruption; after query implementation and fixture trigger drop, 2 passed.
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/shot-production.test.ts
  1 file, 15 tests passed; exit 0.
D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json
  exit 0.
git diff --check
  exit 0 (Git LF/CRLF notices only).
```

The failure injection uses a temporary fixture SQLite trigger to abort one output insert after two local image tasks succeed. It proves another shot collects in the same harvest, the issue survives engine reopen, and removing the trigger allows one successful retry without duplicate history, selection or provider POST. Separate fixture corruption of production and workflow plans verifies both error classes and the independent public issues query. No real user library, provider, desktop process or full suite was used in this fix round.

## Additive schema 14 and repaired-read cleanup (review fix round 2)

`CURRENT_SCHEMA_VERSION` is now 14. Migration 13 is restored byte-for-byte to its original Task 3 shape; new `0014-shot-collection-issues.ts` creates the diagnostic table and production index, then records migration 14 and updates `library.schema_version` and `PRAGMA user_version`. It runs through the existing staged database copy, integrity/foreign-key validation, backup, and atomic replacement in `openLibrary`. `IF NOT EXISTS` also preserves the table if a schema-13 library was created by the first fix revision. Existing original-shape schema-13 libraries now upgrade on reopen before any production/history/issues query can access diagnostics. No user library was opened during development.

The collector removes `PRODUCTION_READ_FAILED` only after that production reads successfully and `WORKFLOW_READ_FAILED` only after the linked workflow reads successfully. The delete is scoped to `(productionId, nodeId IS NULL, taskId IS NULL, errorCode)`, so active per-artifact issues remain. A repaired read is cleared on the next harvest even if there is no successful artifact to collect. Renderer rehydration remains `shots.production` plus `shots.history`; `shots.collectionIssues` is the independent fallback if a production plan is malformed. Once corrected, the next collector pass removes the read issue from all public views.

Focused test evidence:

```text
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/shot-production.test.ts -t "exposes malformed saved|upgrades a populated original schema 13"
  RED at FIX_BASE 389fdfb: 3 failed — two repaired reads retained stale issues; schema-13 reopen stayed version 13.
  GREEN after fixes: 3 passed, 13 skipped.
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/migration-creation.test.ts
  1 passed, exit 0; schema-10 backup migration reaches version 14 and has the diagnostic table.
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/shot-production.test.ts tests/integration/migration-creation.test.ts
  2 files, 17 tests passed, exit 0.
D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json
  exit 0.
git diff --check
  exit 0; Git LF/CRLF notices only.
```

The populated schema-13 fixture starts with an applied production attached to a prepared workflow, closes the engine, removes the diagnostic table to match the original schema-13 layout, and reopens through `openLibrary`. It verifies version 14, a schema-13 backup, and working production, shot-history, and independent issues reads. The repaired-read fixture temporarily corrupts saved production or workflow JSON, observes the stable issue, restores the saved JSON, and verifies the corresponding null-node/task issue disappears while a separate active per-item issue remains. These are local temporary libraries and local fixture workflows only.
