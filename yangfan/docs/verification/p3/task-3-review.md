# Task 3 review — 43a525d..0c7c1ec

## Spec Compliance

- ❌ Issues found. The production implementation substantially matches the requested scope, but the required text-proposal → accepted shots → image → video → shot-history fixture chain is absent from this task's tests. See Important I2.
- ❌ Code quality needs fixes: collection failures are silently swallowed and reported as successful harvesting. See Important I1.
- Scope checked against `task-3-brief.md` and `docs/superpowers/specs/2026-10-26-p3-creation-agent-design.md`. No Task 4 UI/export/build/package requirement is being charged to this task.

## Strengths

- `packages/engine/src/shot-production-service.ts:112` freezes the selected current shots, full parent script/scene, explicitly pinned entity revisions and independent output-selection revision. Entity revisions are resolved from history (`:107`), so later entity edits do not silently replace fixed references.
- `packages/engine/src/shot-production-service.ts:61` validates the profile/model/connection chain and current source revisions; `:90` and `:97` reject unsupported size/duration/ratio combinations. `:166`–`:178` validates fixed media references and first-frame capability instead of dropping unsupported input. Derived profile IDs incorporate project identity (`:87`), and the reserved prefix is protected by `packages/engine/src/model-config-service.ts:51`.
- `packages/engine/src/shot-production-service.ts:234` verifies approval identity, expiry and relevant canvas/content/selection revisions before applying. Profile creation, canvas mutations, bindings and state share the router receipt transaction (`packages/engine/src/command-router.ts:75`); the existing canvas helper does not independently commit (`packages/engine/src/canvas-service.ts:209`). Deterministic node IDs and the already-applied return path avoid duplicating nodes for repeated application.
- `packages/engine/src/canvas-service.ts:108`, `:116`, `:122` and `:163` block generic input-edge, restore, content and delete changes to bound nodes. The binding is stored separately and exposed through the read DTO, rather than accepted as renderer-authored node content.
- `packages/engine/src/workflow-service.ts:84` enforces exact batch scope and execution identity; `:205` requires the validated attachment before approval. `packages/engine/src/generation-service.ts:104` blocks standalone preparation of bound nodes. `packages/engine/src/shot-production-service.ts:346` closes the production gate before stopping the linked workflow.
- `packages/engine/src/shot-production-service.ts:391` advances the captured selection revision only by this production's own successful selections. The collector preserves conflicting or stopped results in history, and insertion/selection/event publication are one transaction with a unique production/node/task key (`packages/storage/src/migrations/0013-shot-production.ts:22`). This avoids the common mistake of accepting any current selection revision.
- `tests/integration/shot-production.test.ts:72` exercises the real local image/video HTTP fixture, a reopen between accepted video work and collection, both selected roles, unique history and exact request sequence. `:108`, `:181` and `:210` cover human-selection conflict, an independent failed step and stopped late results. The migration extension checks all three schema 13 tables while retaining the existing schema 10 preservation assertions (`tests/integration/migration-creation.test.ts:61`).

## Issues

### Critical (Must Fix)

- None found.

### Important (Should Fix)

**I1 — Collection failures have no observable failure path.** `packages/engine/src/shot-production-service.ts:426`–`:451` catches and discards transaction errors, invalid production/task data and workflow read failures; `harvest()` then always returns `ok(undefined)`. If history insertion fails, or a saved record is malformed, a successful task can remain absent from shot history indefinitely while startup/manual harvest reports success and the timer silently repeats. Isolation of other artifacts is good, but it must not erase the error. Return/aggregate per-item failures while continuing other items, and expose a stable diagnostic through an existing error/reporting surface (or persist an appropriate collection status). Add a focused failure-injection test proving that one bad item remains observable while another item still collects and retry does not duplicate history or selection.

**I2 — Required integrated acceptance chain and repeated-apply evidence are missing.** `tests/integration/shot-production.test.ts:8`–`:25` constructs the script and shot directly with `creation.saveScript`/`creation.saveShot`; the media/reopen case at `:72` starts from that helper. No test in this diff obtains a fixture text response, accepts its proposal, and feeds the resulting fixed IDs/revisions to production. The same-plan apply-idempotency branch (`packages/engine/src/shot-production-service.ts:241`) also has no repeated-apply assertion: the regeneration test creates a different production. Both were explicitly required by Task 3, so individual Task 2 and media tests are not the requested joined evidence. Add a local fixture backend chain through proposal acceptance and production/history, and repeat the same production application with a fresh command ID to assert stable nodes, edges, derived profiles and links. Keep this focused; do not rerun the full core suite.

### Minor (Nice to Have)

**M1 — The new plan output guard leaves advertised payload structures unchecked.** `packages/contracts/src/shot-production.ts:86` only checks that `scene` is a record, while `:109` accepts any operation elements as long as the array is short enough. Consequently `isPreparedShotProduction` can bless malformed scene/operation DTOs, including an operation without a kind or node IDs, when validating receipts or stored plans. Validate the operation discriminated union and scene fields, preferably also the shot/script/snapshot identity relationships. This is a boundary-hardening issue rather than evidence of a currently reachable renderer write bypass.

**M2 — Verification output was not pristine.** `.superpowers/sdd/2026-10-26-p3-creation-agent/task-3-report.md:68` records Node experimental SQLite warnings and Git LF/CRLF notices. These are disclosed environmental notices, not test failures. Preserve them in evidence and, where practical, configure the fixture runner/repository text settings to eliminate known noise without suppressing unexpected warnings; no suite rerun is requested solely for this item.

## Named Checks Outside the Diff

- **Atomicity risk:** inspected only the existing `canvas.apply` body at `packages/engine/src/canvas-service.ts:209`–`:248` because Task 3 calls it twice. It joins the outer transaction and does not open/commit a nested transaction, so the router can roll back both node and edge batches with profiles and links.
- **Stop/dispatch fencing risk:** inspected existing `workflow.stop`/`tick` at `packages/engine/src/workflow-service.ts:255`–`:288`, `:329`–`:373`, and the generation authorization/current/dispatch checks at `packages/engine/src/generation-service.ts:67`–`:94`, `:212`–`:248`. Normal stopping closes the workflow state gate and cancels queued tasks; the tick rechecks state after asynchronous resolution. No new submission path was introduced by the collector. This check did not broaden into a P2 audit.
- **Shared selection-revision risk:** inspected `packages/engine/src/creation-service.ts:113`–`:131`. Selection writes require the caller transaction, match both CAS values, and increment selectionRevision once even for an explicit null choice. That supports Task 3's own-success count calculation.
- Consulted only the public-interface portions of Task 1/2 reports to establish the preceding revision, selection and proposal-acceptance contracts. No public-contract rewrite was found.

## Cannot Verify / Validation Boundaries

- ⚠️ Reported TypeScript success and 65 passing focused tests are recorded in `task-3-report.md:57`–`:68`; this reviewer did not rerun tests/typecheck or regenerate that evidence. Static test inspection supports the covered media/reopen cases but does not supply the missing joined chain in I2.
- ⚠️ Actual Electron rendering, final full core suite, export/build/package and release-p3 behavior belong to Task 4. Live provider acceptance is intentionally unverified; no live calls or paid tests were made.
- ⚠️ This was a read-only code review of the supplied diff package, read in manageable sections. The initial combined read was output-truncated, so only the omitted early section was fetched again. No broad whole-file rereads, git commands, GUI launches, config/key/user-library reads, process operations, releases or `D:/rea` access occurred. The only created file is this requested review report.

## Assessment

**Task quality: Needs fixes.** Counts: 0 Critical, 2 Important, 2 Minor.

The transaction, immutable binding, workflow admission and selection-CAS design is coherent and largely satisfies the functional scope. Observable collection failures and the explicitly requested integrated/idempotency evidence should be completed before this task passes its gate; M1/M2 are nonblocking improvements.
