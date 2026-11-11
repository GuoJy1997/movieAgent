# Task 1 review — creation content and schema 11

**Verdict: APPROVE with a minor verification note. Critical: 0. Important: 0. Minor: 1.** No Task 1 runtime correction is required before Task 2 starts.

Scope: supplied `review-57d6a32..3194f59.diff` (17 files, +513/-9), Task 1 brief/report, relevant P3 content/history/migration requirements, and narrowly related transaction/media/maintenance code. The intervening `4a96a24` Agent budget documentation is understood as Task 2 planning, not Task 1 runtime scope. No source, index, HEAD, process, user library or configuration changes were made; only this review report was written.

## Findings

### Critical

None.

### Important

None.

### Minor

1. **Migration preservation coverage leaves task/config/workflow rows empty** — `tests/integration/migration-creation.test.ts:33`. The test seeds project, canvas and real fixed media rows, then compares every existing table; however, empty task/config/workflow tables cannot demonstrate preservation of populated records in those categories. The additive migration itself does not rewrite them, so this is a verification gap, not evidence of a migration defect. When extending the migration fixture for schema 12/13, seed representative task/config/workflow rows and retain the same before/after comparison. Do not describe the current evidence as a populated task/config migration test.

## Historical scene-context ruling

`packages/contracts/src/creation.ts:11` and `:19` store `scriptId`/`sceneId` without `scriptRevision`; `packages/engine/src/creation-service.ts:75` validates against the staged/current script. This matches the expressly enumerated ShotRevision model in `docs/superpowers/specs/2026-10-26-p3-creation-agent-design.md:26`, which requires fixed **entity** revisions but does not require a fixed parent script revision. It is not an Important Task 1 defect.

The limitation is real and should remain explicit: editing a scene's location/time/description while keeping its ID does not revise existing shots. A shot history DTO alone therefore cannot reconstruct the scene text at the shot's save time. The old ScriptRevision remains immutable and readable, but there is no explicit shot-to-parent-revision association. Current scene text must not be presented as proven historical scene context.

Handoff requirement, confirmed by the controller: Task 2 must capture the relevant script revision in context and applicable CAS checks; Task 3 must freeze script revision alongside shot/entity refs and used scene context in its production manifest/hash, and check relevant versions at application. Immutable shot prose/entity refs plus that production snapshot are sufficient for the specified production-history requirement, without resolving historical generation context through the latest script. This is consistent with the planned scene/entity-change tests. A later snapshot cannot retroactively establish the original save-time scene context of an unproduced shot. If that stronger editor-history guarantee becomes required, it needs an explicit model decision; it should not be silently inferred as an additional Task 1 feature now.

## Checks and evidence

- Strict DTO keys, IDs, safe revisions, UTF-8 serialized payload/batch limits, field/list bounds, actual fixed media resolution, and project/library isolation are present. The final-state shot count limit and scene-removal checks include untouched shots.
- `creation-service.ts:45–108`: all batch CAS, staged entities/scripts, dangling references and final-state checks occur before the first insert. `applyBatch` requires the caller transaction and revalidates; it does not begin/commit. SQL failures propagate so the caller must roll back. The normal router owns rollback, receipt and event publication; Task 2 must preserve that ownership.
- Immutable revision and selection-history triggers are installed. Current pointers do not rewrite old JSON. Output selection checks both current shot revision and independent selection revision, then appends history before updating the current selection in the same transaction.
- Commands, query parsers/output validators, receipt/event guards, actual router handlers, engine exposure and desktop advertised events are wired together. Audited semantic errors are final outbox rejections; uncertain commit/storage failures remain pending. No new background lifecycle work is introduced.
- Schema 11 is registered in the existing staged backup migration path. The migration only adds tables/indexes/triggers and advances metadata. Maintenance already consumes `library.schemaVersion` and snapshots the whole database; no hardcoded schema-10 maintenance correction was needed.
- Relied on `task-1-report.md:43–49`: six focused files / 76 passing tests and clean TypeScript check, both exit 0. Source reflects the reported corrected event cursor and `registerGrant` call. The nearby `task-1-green.log` and `task-1-typecheck.log` still contain earlier failed attempts, so they are not the final green evidence. No suites were rerun, as instructed.

## Declined scope

No Agent parser/UI implementation, production service implementation, GUI/package/live API work, user-library/process operations, broad P2/whole-branch audit, speculative schema additions, removal/refactor plan, or repeat full/focused suite execution. Task 3 selection-history consumption and production snapshots, and Task 4 historical display/export semantics, remain their assigned work.
