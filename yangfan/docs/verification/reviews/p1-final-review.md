# MovieAgent P1 — final whole-branch review

Date: 2026-10-25. Reviewer: `/root/p1_final_review`.

Range: `1e10de8493c967805d2f0c319d2f56a52f67dfac..9af6ac7f9fffca1fadcff10e86a2a70a539c1062` on `codex/desktop-foundation`.

**Verdict: Needs fixes before the LOCAL TEST BETA handoff.** There are **0 Critical, 2 Important, and 4 Minor findings**. The two Important findings affect ordinary canvas editing and recovery, independently of a live provider. They should be handled in one combined repair wave. This verdict does not require live API acceptance, signing, or clean-OS installation, and does not declare full P1 complete.

## Review basis and method

Used the supplied `review-1e10de8..9af6ac7.diff` (28 commits) in focused passes, without regenerating the whole diff. Read the implementation plan, relevant binding design sections 9–11 and 15–21, roadmap boundaries, verification record, release manifests/probe/metadata, and selected actual UI screenshots. Inspected hand-written production code across command identity, outbox, engine lifecycle, vault/IPC, HTTP/download/spool, SQLite/migrations, collection, generation, canvas, renderer state and release scripts. Read focused existing test implementations around these boundaries, rather than accepting prior reviewers' rationales as code evidence or rereading every task history.

Dependency review checked the root/desktop manifests, selected lockfile engine/peer/license entries, build boundaries, native-module packaging and the actual package-probe evidence. The pinned Node 24 toolchain satisfies the inspected engine ranges; React/ReactDOM match; Vite 7 is within electron-vite 5 and Vitest 4 peer ranges. Packaged Electron 45 / Node 24.22 / ABI 150, built-in SQLite and Sharp have recorded execution evidence. No dependency incompatibility was found in this scope; this is not a vulnerability or license-compliance audit of every transitive dependency.

The review was read-only on product source, index, HEAD and existing evidence. No agents, real API requests, real-key discovery, user library access, external messages, installer execution or full-suite reruns were used. Two narrow diagnostic probes were run against fresh temporary libraries to resolve new cross-module doubts. They are described below. Temporary fixtures were closed and removed through their owned paths. HEAD was confirmed as the supplied commit, and the tracked tree remained unchanged before this report; pre-existing untracked research/prototype files were left alone.

## Strengths

- Command identity spans both committed receipts and accepted asynchronous work. The router checks the receipt plus import/generation reservations before admitting a new operation; domain changes, event and receipt commit together. Late ACK settlement is scoped to original library/ID/hash before the stale connection is rejected (`command-router.ts:42–69`, `local-connection.ts:31–44`).
- Generation approval freezes the plan, configuration, input ownership, quote and finite allowance. Approval consumption and project/currency reservation are atomic. Durable dispatch intent precedes HTTP; an existing intent goes to reconciliation, never another submit. Unknown billing stays reserved, and cancellation is not treated as a refund.
- Secrets stay in main's vault and bounded authenticated transport. The dedicated credential window has an independent preload/session, sender/frame checks and network denial. Model DNS is validated and pinned; model POST redirects are not followed; downloaded media uses a separate credential-free public-address path. This is a substantive boundary, not a renderer convention.
- Original bytes are synced and validated before artifact/asset publication. The journal and immutable hash binding support interrupted collection, while paid completion and private output descriptors remain distinct from collection success. The repaired spool path preserves valid manifests and refuses to replace a final identity.
- Task output, explicit asset membership and current canvas selection have separate owners. Output publication and run attachment share a transaction; incarnation, semantic revision, active run binding and manual selection revision guard late output. Existing tests exercise A→B→A, repeated runs, delete/undo, manual selection and publication rollback.
- OS-backed library ownership is independent of a PID manifest. Migration runs against a snapshot candidate and preserves an old-schema backup. Shutdown retains ownership through cleanup and distinguishes observed process exit from persistence. Main fences provisional recovery across wake/reconnect.
- Release evidence is candid: the installer is explicitly unsigned/local-test; the package probe executes the packaged runtime/native code; product display naming preserves the previous default user-data location and stable appId. The narrow live-check startup fence checks whole-library task idleness and all profile outbox rows after ownership and before provider activation/replay.
- The inspected 1100px canvas and approval screenshots show a usable image-independent workspace and explicit unknown-cost confirmation. The assets-loading screenshot shows a genuine loading surface. UI text distinguishes saved originals, asset membership and unsupported later capabilities.

## Issues

### Critical — none found

No new Critical defect was established in the reviewed local scope. This is not a proof that every possible fault or environment is safe.

### Important I1 — a normal canvas conflict can permanently block later outbox recovery

**Locations:** `apps/desktop/src/main/local-connection.ts:38–44,94–109`; `packages/domain/src/canvas-command.ts:6–7`; `packages/engine/src/command-router.ts:53–63`; related UI handling at `apps/desktop/src/renderer/services/runtime.tsx:129–136`.

`execute()` settles only successful receipts. A canvas conflict is a proven rollback, returned as `CANVAS_CONFLICT`; the renderer treats it as a definitive failure and lets the user resolve it with a new command. However, the original failed envelope remains pending. Recovery quarantines `REVISION_CONFLICT` but omits `CANVAS_CONFLICT`, so it returns at that row on every restart/reconnect and never reaches later pending commands. Resolving the conflict with a new command does not settle the original row. Other routine pre-commit rejections, such as `CREDENTIAL_UNAVAILABLE`, deserve the same explicit classification audit rather than an assumed catch-all.

**Concrete consequence:** after a user sees/resolves a legitimate canvas conflict, an unrelated later operation that was durably queued but interrupted before delivery can remain unrecovered indefinitely. Startup shows the same recovery error, and the future finite live-check correctly refuses the stale pending outbox. This is a persistence/recovery defect, not merely an extra error toast.

**New diagnostic evidence:** used real `startEngine`, `LocalConnection` and `CommandOutbox` with a fresh SQLite library. Created a project and text node; submitted a synthetic conflicting content revision, observing `CANVAS_CONFLICT`; durably enqueued a later project command; closed/reopened the engine; called recovery. It returned `CANVAS_CONFLICT`, pending IDs remained `["conflict", "later"]`, and the later project did not exist. The probe completed with exit 0 because it successfully observed this defect. It made no provider request.

**Repair:** represent/quarantine proven non-admission with durable envelope/hash/error evidence, both where appropriate on delivery and during replay. At minimum classify `CANVAS_CONFLICT` correctly and audit the ordinary synchronous handler rejection paths. Preserve accepted asynchronous identity and all uncertain writes; do not turn an arbitrary engine/storage/transport failure into permission to discard a command. A typed outcome or a command-aware, documented classification is safer than an unbounded list of guessed error strings.

**Focused regression:** actual stale content revision (read v1, commit v2, submit v1), resolution under a new command ID, restart with a later queued command; assert the conflict evidence remains inspectable, the later command commits once, and ambiguous/accepted import cases remain pending.

### Important I2 — reconnect hides unsaved canvas drafts and falsely reports all changes saved

**Locations:** `apps/desktop/src/renderer/features/canvas/CanvasWorkspace.tsx:69–80,190,259–262`; `apps/desktop/src/renderer/state/canvas-draft.ts:10–32`; epoch publication at `apps/desktop/src/renderer/services/runtime.tsx:61–64` and `apps/desktop/src/main/index.ts:79–84,193–194`.

The draft scope includes `connectionEpoch`. Same-library wake or engine reconnection creates a fresh epoch, so the mounted canvas immediately reads an empty scope. The old draft is still in the store under an unreachable old key, but there is no recovery/migration UI. Selection, dirty count and displayed content reset to the saved snapshot; the footer says all edits are saved. Closing the app then loses the hidden edit entirely.

**Concrete consequence:** unsaved text or layout disappears after an ordinary lifecycle recovery even when the library, project, node incarnation and engine instance are unchanged. This contradicts the product's explicit promise to preserve drafts while offline and the design's recoverable-edit semantics. Query/command epoch fencing does not justify hiding local edits.

**New packaged diagnostic evidence:** launched the actual `release/win-unpacked/MovieAgent.exe` with a fresh profile/library, created a project/text node through UI, typed `UNSAVED_REVIEW_DRAFT` without saving, emitted the existing main `powerMonitor` suspend/resume events, waited for a changed connection epoch, and reselected the node. Observed:

```json
{"before":"UNSAVED_REVIEW_DRAFT","after":"","sameLibrary":true,"sameInstance":true,"epochChanged":true,"saveStatus":"所有修改已保存\n修订 1"}
```

This is a production packaged UI/state probe of the lifecycle event path, not physical-sleep certification. The existing offline UI test ends while disconnected, and reconnect tests do not carry an unsaved draft across the epoch change; thus the recorded full-suite pass does not cover this combination. An initial attempt used an incorrect accessible button name and timed out before reaching the scenario; it was corrected, cleaned up, and is not counted as product-failure evidence.

**Repair:** keep queries, commands, ACKs and event responses fenced by epoch, while retaining/recovering local edits by stable library/canvas/node-incarnation identity. Preserve the original field-specific CAS baseline. If the current snapshot changed, display the draft and conflict/recovery state; never silently rebase it onto a new incarnation, another library or a newer field version. Do not show “all saved” while a recoverable draft exists.

**Focused regression:** packaged same-library suspend/resume and utility reconnect with unsaved content/layout; verify draft and dirty indicator survive, stale CAS still conflicts, and another library/new incarnation cannot inherit that draft.

### Minor M1 — security/recovery code is unnecessarily hard to audit

**Locations:** `packages/providers/src/http-transport.ts:22–47,50–66`; `packages/providers/src/artifact-source.ts:77–91`; similar compact outcome handling in `packages/providers/src/openai-images.ts:22–54`.

Multiple validations, side effects, state transitions and error paths are compressed into single lines in the DNS/socket boundary and durable-output recovery path. The issue is maintenance risk: future changes to abort cleanup, redirect policy, immutable binding or output-loss classification are harder to review and can conceal a missing branch. No additional exploit was established from formatting alone.

**Recommendation:** expand these specific blocks into conventional statements and named conditions, preserving behavior and existing tests. A bounded readability pass is sufficient; no broad architecture rewrite is requested. This carries forward and resolves the Task 6 minor triage.

### Minor M2 — successful-empty messages also appear when initial reads are pending or failed

**Locations:** `apps/desktop/src/renderer/features/tasks/TaskPanel.tsx:36–39`; `apps/desktop/src/renderer/features/models/ModelSettings.tsx:68,86–90`; `apps/desktop/src/renderer/features/assets/AssetLibrary.tsx:75–84`.

Tasks and connections test `!data?.items.length`, so missing data during initial loading/error is rendered as an empty library. Assets suppress active loading but still show the empty/no-match message after an initial read failure (or before an enabled query exists). A user can see “no tasks/assets/connections” alongside a failure even though their saved data has not been read.

**Recommendation:** show empty states only after a successful snapshot with zero matching results, and separately handle initial waiting/error. Continue displaying existing cached data honestly when a background refresh fails. This is the Task 8 minor, not a new requirement to redesign those pages.

### Minor M3 — routine startup tests overwrite frozen release performance evidence

**Location:** `tests/electron/packaged-startup.test.ts:50–61`; affected artifact `docs/verification/task-10/local-performance.json`.

Every ordinary packaged-startup run writes the tracked release measurement file. A later run, including one that fails afterward, can replace the timestamp/metrics while the frozen narrative, package manifest and reviewed artifact identities still describe the previous run. The measurement payload itself does not identify the tested binary/archive hash.

**Recommendation:** write routine output under `test-results/`, attach the tested package identity, and promote an explicitly selected successful measurement to release documentation. Preserve this release's frozen evidence until a deliberate new package verification. This is the Task 10 minor; it does not invalidate the currently recorded measurements by itself.

### Minor M4 — a valid fixed-text-only generation cannot be prepared in the UI

**Location:** `apps/desktop/src/renderer/features/canvas/CanvasWorkspace.tsx:469`; corresponding supported engine path `packages/engine/src/canvas-service.ts:204–212`.

The prepare button requires a nonblank node-local prompt even when the generation node has explicitly selected nonempty fixed text inputs. The engine correctly builds the prompt from the local prompt plus those immutable text versions and accepts a nonempty combined prompt. A user who writes their prompt in a text node and selects that input must unnecessarily duplicate/add text locally to enable the button.

**Recommendation:** allow preparation with a saved explicit text input and delegate final combined-prompt validation to the engine, or validate the actual frozen input content without relying on the live text node. Keep empty combined prompts rejected; no dependency-graph execution is requested. A small interaction check is sufficient.

## Evidence and verification limits

- Existing final record: typecheck/build/NSIS/package probe exit 0; integration **172/172**; Electron **30/30**. These are the supplied final Task 10 results, not suites rerun by this reviewer. The newly demonstrated combinations explain how those results coexist with I1/I2.
- Read the actual manifest, package-probe and Windows metadata artifacts. They record a 129,460,048-byte unsigned installer, SHA256 `7bda33f7d8b435b42a3323c375d5eba3e6bfc4a43f2e814eaf8d289078d86993`, and executable/asar identities. Task 10's reviewer already independently matched the three actual artifact hashes; this review did not repeat that hashing. The new draft probe executed the present packaged binary.
- Inspected selected lockfile compatibility metadata, not all generated lockfile lines. Runtime compatibility is supported by the packaged native probe and desktop execution; no clean-machine or global ecosystem claim is inferred.
- Directly viewed `task-8/canvas-1100.png`, `approval-1100.png` and `assets-loading-1100.png`. These support the stated viewport observations only, not all DPI, accessibility, responsiveness or sustained performance claims.
- The recorded 1,255.16ms startup and two process-metric snapshots are limited developer-machine measurements. Individual process lifetime peaks are not a simultaneous family peak. No 500-node/large-library performance claim is made.
- The review's only new execution was the two targeted probes above (plus the corrected selector attempt). No existing performance/screenshot evidence was overwritten and no new production/test source was added.

## Recommendations for the combined repair wave

Resolve I1 and I2 before presenting the current artifact as the final local-test beta. Include the small M2/M3/M4 fixes in the same wave if practical, and keep M1 to the named high-risk blocks. Add focused regressions for the new behavior rather than repeating existing race loops or whole task suites. Any changed production code must be rebuilt into the executable/installer and the affected package evidence updated deliberately; a source-only fix cannot repair the currently packaged behavior. Re-review the resulting combined diff and relevant new evidence once.

## Declined to judge

- Actual paid-provider success, billing accuracy, real credential setup and public-CDN acceptance: the user explicitly deferred live API work; fixture and transport tests do not establish it.
- Executing the installer on a clean Windows system, installation/upgrade/uninstall behavior without developer tools: no such environment or acceptance execution was supplied; generating NSIS and running unpacked code are narrower evidence.
- Signing, SmartScreen-free distribution and custom icon polish: the authorized artifact is explicitly unsigned local-test with the default icon; these are disclosed release limitations, not hidden acceptance claims.
- Physical sleep, hard power loss and instruction-level filesystem crash guarantees: reviewed software event/process fault behavior, but no physical-system experiment was performed. I2 is still in scope because the deterministic implemented reconnect path itself loses the draft view.
- Full backup restore, cross-machine takeover, object-copy/hash restore, project exchange, automatic retention/GC and remote deployment: roadmap P5/later work; the current maintenance snapshot/manifest is not treated as a completed restore feature.
- Agent, text-model orchestration, asynchronous video, reference images/masks/batch, executable dependency graphs, timeline/audio/export, entities, tags/recycle bin and collaborative/remote UI: explicitly mapped to P2–P5 or excluded from this single-image local beta.
- Daily/connection-wide policy administration and autonomous Agent budgets: the reviewed implemented allowance is manual per-attempt plus project/currency reservation; broader policy surfaces are not silently required for this approved batch.
- Compatibility with every purported OpenAI-compatible model/service, arbitrary headers/scripts, or undocumented query/reconcile mechanisms: the implementation deliberately supports one documented synchronous request subset, with unsupported capabilities withheld.
- Throughput at configured concurrency greater than one, large-library scaling, all display scales/platforms and published performance targets: neither the single-image beta evidence nor the two event-bound metric samples establish these workloads.
- Protection against a malicious process already controlling the same OS account or modifying owned library/vault files concurrently: not the stated renderer/network trust boundary, and safeStorage itself does not promise this threat model. No such protection claim is made here.
- Existing SQLite experimental, build/dedup/default-icon/signing and line-ending notices, plus earlier disclosed temporary-directory residue: disclosed operational limitations; no new correctness finding is inferred solely from warning text or residue. No cleanup bypass was attempted.

## Assessment

**Ready for LOCAL TEST BETA: With fixes; not ready at the reviewed HEAD.** The implementation has credible local safety and durability foundations and unusually explicit acceptance evidence. The two newly reproduced cross-module recovery defects can hide unsaved work or strand later durable commands, so they must be repaired before the final local-beta handoff. The four Minor findings do not independently invalidate the architecture. Full live P1 remains unaccepted for the separately disclosed reasons, even after these local fixes.
