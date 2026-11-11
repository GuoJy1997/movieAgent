# Final whole-plan review — a990330..6bf6ce8

Reviewed the supplied complete feature-range diff, directory-project design and implementation plan, SDD rulings, task reviews/fix review, and verification evidence. HEAD was confirmed as `6bf6ce8a3110219373a3e6fe75feb563a74208a9`. This review does not reopen the separately closed P1 batch. Only this requested report was written; source, index, HEAD, real configuration, user data, and retained launcher PID 24232 were not changed.

## Strengths

- Directory creation has a coherent non-overwrite and recovery boundary: bounded strict manifests, exclusive first publication, preflight of reserved ancestors and known engine paths, preserved existing template bytes, and immutable binding (`apps/desktop/src/main/project-directories.ts:56`, `:78`, `:139`, `:176`). The bundled runtime template avoids development-directory dependencies. Real filesystem tests cover collisions, junctions, interrupted filling and byte preservation.
- The Task 1/Task 3 ownership handoff is closed. The launcher registers before spawning; children only validate the full retained registry; project profiles derive from workspace identity; inspection repeats before engine opening (`project-launcher.ts:35`, `recent-projects.ts:59`, `index.ts:16`, `workbench.ts:70`). Stable bootstrap command identity survives DB-commit/manifest-bind interruption, and actual library/project equality is checked under the owned engine before binding (`workspace-bootstrap.ts:18–32`). Missing bound databases are refused, and hidden recent identities still protect against copied-project admission.
- The Task 2/Task 3 credential handoff is closed. File validation precedes mutation, secret-bearing objects remain in main, collisions require importer provenance, and protected matching excludes revoked/session/foreign-owner envelopes (`model-config-file.ts:17–58`, `model-config-import.ts:39–123`, `credential-vault.ts:92–99`). Production startup loads retained references, synchronizes statuses, imports configuration, then activates providers. The existing live-check admission still precedes credential/provider activation and outbox replay (`workbench.ts:49–62`, `:145–160`). Blank or malformed configuration permits ordinary project editing with a secret-free status.
- The earlier endpoint-idempotence defect is addressed at normalization, with a regression comparing all three revision chains and vault filenames over repeated use of the same loaded configuration (`model-config-file.ts:40`, `tests/integration/model-config-file.test.ts:96–109`). Import interruption preserves normal receipts and old protected references rather than replacing live task configuration.
- Default startup is an engine-free launcher; explicit legacy entry preserves the prior profile, ownership, reconnect and shutdown behavior. Detached workbench processes retain their own locks and survive launcher exit. Launcher IPC, workbench IPC and credential input retain separate bounded capabilities (`index.ts:10–30`, `launcher-ipc.ts:5–17`, `ipc-policy.ts:15–35`, `workbench.ts:114–135`).
- Delivery is concrete: all three preload/HTML surfaces are included in package verification; exclusive local preparation preserves existing config/script bytes (`scripts/verify-package.mjs:11`, `:40–60`, `scripts/start-local.cjs:12–15`). The actual-package fixture checks independent libraries, repeat focus, persisted canvas reopening, dummy configuration reload, preserved existing files, zero loopback requests and a surviving child after launcher exit. Archived screenshots visibly show the bound drama, saved canvas text, engine status and accessible project actions.

## Issues

### Critical (Must Fix)

- None found in the reviewed feature range.

### Important (Should Fix)

- None found in the reviewed feature range.

### Minor (Nice to Have)

1. **P3 — Workbench project-action failures have no visible feedback.** `apps/desktop/src/renderer/App.tsx:93–94` discards both `Result` failures and promise rejections from opening the launcher/folder. Main already returns actionable errors when a project path is unavailable or spawning fails (`workbench.ts:201–202`), but the user's click can appear inert. Handle these results with the existing alert mechanism or a small action-status state, including a rejection fallback. This is the deferred Task 3 finding, confirmed and retained as nonblocking: it affects error feedback, not project ownership, persisted data or the successful navigation path.

## Deferred-minor triage and recommendations

- **Accept the App.tsx item as P3 follow-up.** It is a real usability defect with a concrete trigger, but does not justify repeating package/full-suite checks or withholding this local delivery. A future fix should verify returned-error and rejected-promise feedback.
- **SQLite/toolchain warning noise is not a new product defect.** `docs/verification/directory-projects.md:78` distinguishes existing SQLite experimental warnings and electron-builder's collector fallback from passing runtime/native verification. Retain that disclosure; handle centralized toolchain cleanup separately. Do not suppress unrelated warnings or describe the logs as warning-free.
- Close the final plan/ledger documentation after recording this verdict. The last unchecked plan item explicitly includes this final review; it is not missing implementation.

## Evidence and review limits

- Read the supplied diff in bounded sections, including implementation, tests, packaging, local preparation and documentation. Initial oversized outputs were followed by focused reads of affected sections. Focused surrounding reads were limited to model command parsing and vault retention/access semantics needed to assess validation, idempotence and recovery.
- Read the task reviews and scoped trailing-slash fix review; their downstream handoffs were checked against final production integration rather than assumed complete from task-level approval.
- Viewed both archived package screenshots. Read `task-3-local-launch.json`, the final verification record, and the controller's hash/process/file checks. The final product package is the `e0357da` source build; `dfb9217` changes test output destinations and subsequent commits are documentation. No later product-source divergence is present in the supplied range.
- The reported 243 integration tests, 40 Electron tests, typecheck, build, package and package verification are accepted as supplied execution evidence, not independently rerun here. The two targeted image-workflow tests cover the later output-location-only change. No concrete unanswered runtime risk remained to justify rerunning these checks.
- This review did not read the real models.json, call any model API, create/alter user data, interact with or terminate PID 24232, or claim a fresh live-process measurement. Current delivery-process/hash observations remain controller evidence. Git status showed unrelated untracked research/prototype material, which was left untouched.

## Declined to judge

- Real provider authentication, compatibility, paid generation and billing: intentionally deferred until the user fills configuration and authorizes finite real-service verification; dummy fixtures establish import behavior, not service compatibility.
- A new installer, cross-machine migration of OS-protected credentials, and platforms other than this Windows local delivery: no such release or credential-portability claim is made by this plan.
- LibTV server storage internals, Agent/video/timeline/export functionality: explicitly outside this feature and visibly identified as unsupported; the documented directory template is this application's design.
- Re-auditing the already closed P1 implementation outside the integration surfaces changed here: outside the exact review range; lifecycle ordering and the supplied P1 regression evidence were assessed where this feature touches them.
- An actively hostile local process replacing filesystem components between checks: the recorded ruling establishes static reserved-path/junction preflight plus owned engine/profile exclusion, not atomic filesystem protection against a concurrent adversarial writer. Static collisions, normal relocation and interrupted initialization were judged within scope.

## Assessment

**Ready to merge? Yes.**

The complete directory/configuration/launcher plan is implemented with consistent identity ownership, protected and recoverable configuration import, preserved legacy lifecycle, and credible actual-package/local-delivery evidence. No Critical or Important finding remains; one confirmed P3 error-feedback item and disclosed pre-existing tooling noise can remain deferred without blocking the requested local use.
