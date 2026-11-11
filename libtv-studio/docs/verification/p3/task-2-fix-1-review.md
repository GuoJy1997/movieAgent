# Task 2 fix round 1 — scoped re-review

**Range:** `c52f967ecf97ba6953bfb563d76df1f0f9a0de69..43a525d56e85d3d5aaed2996599afdca77642349`
**Scope:** Original Important 1 finding and new breakage in `review-c52f967..43a525d.diff` only.

## Strengths and finding verdict

- **Important 1 — resolved.** `packages/engine/src/agent-service.ts:288-326` converts an unsuccessful fixed-original read into `FAILED` with the reader's error code, leaves `harvested=false`, and continues the ordered harvest loop. The transaction at `:353-365` retains `STOPPED` when its durable stop gate is closed, publishes the local error through `agent.changed`, and skips an unchanged error on later wakes. The `stopping()` check remains directly after the awaited read at `:289-290`; transaction-time stop reread remains at `:353-354`.
- **Recovery and startup — covered.** `tests/integration/agent-recovery.test.ts:255-299` runs both open and stopped cases: a corrupted first original, a healthy second completed Agent task, and an independent queued P2 task. It asserts successful scheduler startup, healthy harvest, visible first-run failure with original task reference, one failure event, recovery after restoring the same artifact, unchanged task count, and no extra planning POST. This matches the original finding's required regression.
- **No new breakage found in the fix diff.** The existing parse/proposal path is nested under a successful artifact read without changing its validation or publication behavior. Ownership/transaction failures still propagate as global failures, which is appropriate for those separate conditions.

## Issues

**Critical:** 0. **Important:** 0. **Minor:** 0 in this fix round.

## Declined to judge / out-of-scope observations

- The original review's two Minor findings (malicious-asset assertion and verification warnings) were not part of this fix and were not re-reviewed.
- Untouched Agent behavior, real desktop/provider execution, user configuration and data, releases, and process lifecycle were outside this scoped review.
- The implementer reported 18 directly affected tests passing and typecheck exit 0. I did not rerun them, per the review brief; `git diff --check` for this range produced no errors.

## Assessment

**Verdict: Ready to proceed for the Important 1 fix.** The failure is isolated to its run, later harvest and scheduler startup can continue, and the original materialized task can recover locally. Review of the specified fix found no new issue.
