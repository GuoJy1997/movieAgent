# Task 3 fix round 2 re-review — 389fdfb..4c010f9

## Finding verdicts

- **Existing schema 13 libraries do not receive the diagnostics table — ADDRESSED.** `packages/contracts/src/schema.ts:2` advances the current version to 14; `packages/storage/src/database.ts:71-86` sends a version-13 library through the staged backup migration path and invokes the new migration. `packages/storage/src/migrations/0014-shot-collection-issues.ts:3-20` creates the table/index, records version 14, and commits both version fields. Migration 13 has its original shape again (`packages/storage/src/migrations/0013-shot-production.ts:21-28`). The populated original-shape schema-13 fixture at `tests/integration/shot-production.test.ts:349-369` checks a schema-13 backup and successful production, history, and issues reads after reopen. The `IF NOT EXISTS` DDL also accommodates a schema-13 library created by the first fix revision.
- **Recovered production/workflow reads leave permanent stale issues — ADDRESSED.** `packages/engine/src/shot-production-service.ts:409-412` deletes only the requested read error for the production with both node and task null. Harvest invokes it after a successful production read at `:497` and after a successful workflow read at `:510`; failures still follow their existing reporting paths. The repaired-read cases at `tests/integration/shot-production.test.ts:317-346` restore each corrupted plan and verify the read issue disappears while an independent node/task issue remains.

## New breakage in the fix diff

- **Minor — The updated plan names a migration file that does not exist.** `docs/superpowers/plans/2026-10-26-p3-creation-agent.md:53` says `0014-shot-production-diagnostics.ts`; the committed file is `packages/storage/src/migrations/0014-shot-collection-issues.ts:1`. Correct the plan path so its file list matches the implementation. This does not affect the migration or tests.

## Out-of-scope observations

- None. I2 was addressed in round 1 and was not re-reviewed; untouched P2 and other Task 3 paths were not audited.

## Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** New breakage: 0 Critical, 0 Important, 1 Minor. The report appendix at `.superpowers/sdd/2026-10-26-p3-creation-agent/task-3-report.md:103-116` names the focused schema-13/repaired-read tests and records 17 passing tests plus typecheck. Those commands were not rerun in this read-only re-review.
