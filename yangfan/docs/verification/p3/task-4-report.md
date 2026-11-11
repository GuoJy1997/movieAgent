# Task 4 report — P3 desktop, export, local package

Status: implemented and scoped verification complete; awaiting controller independent review. Base `45938b0` on `codex/desktop-foundation`. Final implementation commit is appended after exact staging below.

## Public interfaces and integration

Only new desktop capability:

```ts
interface ExportCreationInput {
  projectId: string;
  scriptId: string;
  revision: number;
  format: 'json' | 'markdown';
}
interface ExportCreationResult {
  filename: string;
  relativePath: string;
  snapshotId: string;
  scriptRevision: number;
}
window.studio.exportCreation(input): Promise<Result<ExportCreationResult>>;
```

Preload channel `studio:creation:export` uses the existing authorized main-frame/window policy and an exact four-field input guard. WorkspaceActions has an optional narrow handler to retain harness compatibility. Main validates current directory registration/binding, library identity, project and exact script revision. Renderer cannot supply snapshot bytes, directory, basename or arbitrary paths. Canonical engine `creation.read` is a coherent synchronous current snapshot; additional `creation.history` reads only retrieve immutable, exact referenced entity revisions. Source query identity/epoch and output validators remain in force.

JSON snapshot schemaVersion1 contains export ID/time, snapshot event sequence, library/project, exact current script, ordered shots, fixed referenced entity revisions, output selections, and an honest parent-history notice. Markdown contains the same human-readable contents and fixed identities. Limit4MiB; destination is exactly `exports/creation`; IDs validated, export UUID main-generated; exclusive `wx` creation, ordinary directory/lstat/realpath checks per component, and no overwrite or following preexisting target aliases. Errors remain retryable; no-directory legacy state is explicit. Export never edits starter templates or database content.

GenerationApproval adds optional typed `onApprove(ApproveGenerationInput)` and readable `summary`; default standalone generation retains its original command. Agent supplies `agent.approveTurn`, never generic approval. The media UI uses `workflow.prepare → shots.attachWorkflow → WorkflowApproval` with matching production owner/run/nodes. It reopens prepared/attached workflow plans and exposes explicit production stop. Renderer mount only queries.

`engine-host.query` now uses parseQuery + shared per-query `queryOutputValidators`, replacing its obsolete P2-only success allowlist. The original launch/request, LocalConnection library/epoch, command receipt and malformed-output checks remain. The packaged RED exposed this missing prior integration; a focused mock transport regression now proves valid P3 queries, wrong-type rejection, foreign-launch ignoring and malformed-input rejection.

No additional engine commands, queries, event kinds, schema changes, dependencies, fonts, image assets, providers or privileged filesystem capabilities were introduced. Existing Task1–3 contracts are consumed. `isPreparedShotProduction` is narrowly strengthened for scene structure via exact captured script scene equality, shot/script/project/library relationships, nonnegative selection revision, valid step ownership and discriminated create/first-frame operations with valid step/node endpoints.

## Desktop behavior

- New Agent, script/shot, entity navigation entries; existing style/components retained. New pages own scroll containers (normal wheel verified at1100/1440), not hidden-overflow focus-only access. Navigation folder/launcher Result failures have visible dismissible feedback.
- Chinese entity and script/scene/shot forms cover specified fields and bounds, histories, fixed asset/entity versions and stale notices. Drafts are initialized on explicit selection, retain their expectedRevision during query/event refresh, and only reset after explicit reload or acknowledged save. Local editor identity remains stable across first save.
- Agent sessions/modes/templates/source text profiles, bounded output tokens, context targets and fixed selected assets. Budget cards show frozen context and actual parameters; full prompt is optional. Runs show durable status, tasks, failure/unknown/invalid/stop, readable proposals, subset/dependency selection, acceptance receipt and skipped keys. Conflict preserves proposal and manual content, requires explicit new turn.
- Production shows fixed parent/script/scene/shot/entity revisions, human profile names and Chinese parameter overrides, fixed IDs in details, capability failures, real workflow states/task links and collection diagnostics. Bound canvas content is read-only with jump to shot editing.
- Outputs show actual MediaPreview images/video, durable history and manual choice. Original revision is resolved by exact fixed media reference from production history, independent of the later choice revision. Unknown match is explicitly “输出来源修订未知”; it is never inferred current from selection.shotRevision.

## Exact validation evidence

Red-first evidence:
- creation-export suite initially failed module resolution before implementation; then3green, later expanded5green.
- DTO malformed cases initially failed (`expected true to be false`), then accepted existing valid production and rejected tested malformed cases.
- First packaged UI run failed after manual save because engine-host rejected P3 query DTOs; repeated once with diagnostic logging to identify source; fixed transport then full UI green.
- Output source-revision helper initially failed missing module; then2green including old-choice/new-shot and unknown/cross-library/asset-version identity.

Executed with `D:/nodejs/node.exe` (24.12.0):

- Full core suite once after initial integration: **36files / 493tests passed**, 23:13:27,38.38s; log `task-4-core.log`. Known SQLite experimental warning retained. Subsequent changes received affected checks only.
- creation-export + shot-production + agent-recovery: **3files /34tests passed** (includes unknown asset alias through actual Agent harvesting with no writes).
- engine-host-query + command-delivery: **2files /23tests passed**,16.20s.
- Final focused export/query/output-presentation checks: **3files /8tests passed**,23:37:50,0.933s.
- Final TypeScript: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json`, exit0.
- electron-vite build exit0. Final builder command from apps/desktop in native Windows PowerShell, PATH includes D:/nodejs and native PowerShell/System32:
  `node ../../node_modules/electron-builder/cli.js --win --x64 --config.directories.output=release-p3 --config.electronDist=D:/movieAgent/libtv-studio/node_modules/electron/dist`.
- `verify-package.mjs --dir apps/desktop/release-p3/win-unpacked` exit0; `task-4-package-final.json`: Electron45.0.0, ABI150, Node24.22.0, SQLite3.53.4, sharp PNG probe, all4isolated preloads exact allowlists and CSP entries.

Latest full packaged behavior run: `MOVIEAGENT_TEST_PACKAGE=D:/movieAgent/libtv-studio/apps/desktop/release-p3/win-unpacked node node_modules/vitest/vitest.mjs run --config vitest.electron.config.ts tests/electron/p3-creation.test.ts tests/electron/ipc-policy.test.ts`: **2files /3tests passed**,23:31:43,32.90s (`task-4-electron-final.log`).

It used real normal UI controls for directory new/open, entity/script/scene/shot saves, fixed entity selection, wheel scrolling, retained text draft across refresh, native text request and partial adoption, image→video production and financial approval, decoded video result, manual output choice, read-only canvas binding and edit jump, original standalone single-image approval, JSON+MD export, current-target conflict after manual shot edit, stop before request, malformed response without side effects, close/open existing project, preserved outputs/history/stale notice at1100px, and no mount/reopen POST. Read-only engine queries assert facts. The only media setup bypass stages the local repository MP4 into its existing fixture ArtifactSource before fixture video query completion. No normal creation/approval steps are replaced by engine writes.

HTTP POST totals:3text,2image (production+single-approval regression),1video; reopen did not increase them. IPC tests cover exact added preload key, rejected path input, explicit legacy export error, unauthorized window and child-frame policy.

**Artifact evidence distinction (updated after fix1):** the 3-test GUI/IPC run tested app.asar `8219ef2218d6eb10185d3272a892082dfe5390ca7c8582ff89fafa835f39f6ba`. The final fixed package additionally includes Chinese notice copy, original-output/unknown-provenance mapping, cross-script editor state, and existing-target proposal review UI. The output mapping has focused helper evidence; fix1 state/diff rendering has5focused tests; final typecheck/build/package verifier pass. No additional GUI run was required by scoped review. Preserve the earlier3GUI evidence as historical behavior evidence only, never claim the exact final archive ran those tests.

## Initial delivery package hashes (superseded by fix1 below)

- `D:\movieAgent\libtv-studio\apps\desktop\release-p3\MovieAgent-0.1.0-local-test-Setup.exe`
  - 129625214bytes; SHA256 `0b2b1cf64b74770f4fbd9a841dca20e46284a4b8a6c7e1a247d8a27d9cda97ac`
- `D:\movieAgent\libtv-studio\apps\desktop\release-p3\win-unpacked\MovieAgent.exe`
  - 249798144bytes; SHA256 `86644988b81feba44a7967bb4e87dee686c2814ba085680a73b023fc17320bdc`
- `D:\movieAgent\libtv-studio\apps\desktop\release-p3\win-unpacked\resources\app.asar`
  - 17918772bytes; SHA256 `98122efedf9f07f6fd3b58557ce0337745bb21266c7fbeef5ac13c3250f310be`

Hashes also in `task-4-hashes.json`. Package is unsigned; builder emits duplicate dependency references/default icon/unsigned warnings. An intermediate network re-download failed ECONNRESET before replacing the last tested asar; final successful build reused installed Electron45 distribution. No dependencies were installed or changed.

## Screenshots for independent visual review

All captured inside the successful isolated fixture session (not a separate demo). Root inspected the original4 and requested small label cleanup; latest files include cleanup and top overview:

- `D:/movieAgent/libtv-studio/test-results/p3-creation/01-manual-editor.png`
- `D:/movieAgent/libtv-studio/test-results/p3-creation/02-agent-proposal.png`
- `D:/movieAgent/libtv-studio/test-results/p3-creation/03-production-preview.png`
- `D:/movieAgent/libtv-studio/test-results/p3-creation/04-results-reopened-1100.png`
- `D:/movieAgent/libtv-studio/test-results/p3-creation/05-creation-overview.png`

## Files / self-review / remaining limits

Production: contracts creation-export/desktop/launcher/shot-production; main creation-export/engine-host/ipc-policy/workbench; preload index; renderer App/style, agent/AgentWorkspace, entities/EntityWorkspace, creation/CreationFields/CreationWorkspace/ShotProductionPanel/shot-output-presentation; canvas GenerationApproval/CanvasWorkspace; launcher copy; verify-package allowlist. Tests: creation-export, engine-host-query, shot-output-presentation, agent-recovery, shot-production, p3-creation, ipc-policy. Docs: product roadmap and docs/verification/p3-creation-agent.md.

Self-review checked snapshot ownership and historical entity semantics, path/alias/overwrite bounds, narrow approval routing, stop/reopen behavior, draft key/refresh preservation, DOM read-only binding, original-output provenance, transport exact-kind validation and staged-file scope. `git diff --check` clean. No test-only bypass is added to production. No nested agents spawned; controller will independently review.

Limitations: no real Kimi structured long-script or live image/reference-video chain/real billing acceptance; images/videos in Agent context are metadata only; no native tool_calls recursion/streaming; no P4 audio/timeline/MP4 or P5 remote. Export is current canonical script/shot snapshot with fixed entity revisions; historical parent context lives in production plans. No signed/clean-machine installer acceptance. No user configuration/keys/library/D:/rea accessed; original PID9268 was read-only confirmed still running old release-text-models package after tests. Outer launcher untouched. Prior releases and unrelated docs/prototypes/specs remain untracked and unchanged.

## Committed handoff

Implementation commit: 52d81dc5bf29f0894feb1af8e61e6367e82045ca (52d81dc), feat: deliver P3 creation desktop and bounded project exports. Exactly30 assigned source/test/doc files committed. git diff --cached --check passed before commit. Git emitted the existing LF-to-CRLF warnings for4new files; no source/test failure. Ignored SDD evidence and screenshots remain at the paths above; release-p3 and unrelated preexisting untracked files were not committed.



## Task4 fix round1 — Important1/2 (2026-10-27)

FIX_BASE `52d81dc`. Read task-4-review.md Important1/2 verbatim. No broad refactor, nested agents, provider calls, user config/library access or GUI launches.

I1: `creation-navigation.ts` adds the small typed atomic navigation reducer and `resolveShotEditor` ownership guard. Explicit script selection sets scriptId, dismisses bound-canvas focus, clears shot/script editors, clears selected production shots, and advances the editor key. An editor is only resolved for its own current script; its mount identity also includes current scriptId. Existing drafts still survive query/event refresh.

I2: formatted `ProposalDiff.tsx` builds read-only comparisons from captured originals + proposal + selection. Fields include script title/synopsis/body, scene title/location/time/description, entity kind/name/description/constraints/exact media references, shot text/timing/camera/dialogue/action/scene/exact entity revisions. Empty values display （空）. Needed entities are included even when not explicitly selected, with an explicit dependency notice. Scene merging mirrors the actual engine: preserve omitted old scenes, show retained/changed/unchanged/new and final order; partial scene adoption preserves captured prose. No removal operation is invented. Existing new-object cards stay simple. Actionable PROPOSED runs get the live comparison; accepted run checkbox scope uses receipt identities, with original proposal labeled and actual adoption attributed to its durable receipt (the action's includeScript flag does not reveal whether prose was explicitly selected, so it is not used to invent a retrospective comparison).

The renderer imports contracts DTOs/React only. The test imports engine `agentApplication` strictly as a reference for actual merge semantics; no engine/provider bundle enters renderer. AgentRunCard touched JSX is now formatted; remaining unrelated long-line forms are deferred Minor1, not silently claimed reformatted. Minor2 warning ledger remains.

### RED/GREEN and exact commands (before fix commit)

1. `D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/creation-review-presentation.test.ts`: initial RED missing new state module. After implementation, 2 of4 tests failed because the root Vitest JSX transform used classic React without a namespace; added explicit React namespace/type to the component. Added cleared-reference case.
2. Same focused command final GREEN: **1file /5tests**,01:13:08,0.504s. Tests cover canvas focus→active editor→script switch→no old editor; defense against foreign script object; new-shot scope; readable changed before/after fields and empty dialogue; exact asset/entity revisions; dependency-only entities; matching actual full/partial scene merge order/retained scenes/prose; no unchecked writes or new-object diff cards; cleared refs.
3. `D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json`: exit0 after changes.
4. From apps/desktop with native Windows PowerShell and D:/nodejs + native PowerShell/System32 PATH:
   - `D:/nodejs/node.exe ../../node_modules/electron-vite/bin/electron-vite.js build`: exit0,299 renderer modules.
   - `D:/nodejs/node.exe ../../node_modules/electron-builder/cli.js --win --x64 --config.directories.output=release-p3 --config.electronDist=D:/movieAgent/libtv-studio/node_modules/electron/dist`: exit0. No download/dependency changes.
5. `D:/nodejs/node.exe scripts/verify-package.mjs --dir apps/desktop/release-p3/win-unpacked`: exit0; saved `task-4-fix-1-package.json`, Electron45/ABI150/Node24.22.0 and native SQLite/sharp/preload/CSP checks unchanged and valid.
6. `git diff --check`: exit0. Scoped tests+typecheck accepted per review; no full493 rerun and no extra GUI/session. Earlier GUI hash8219ef and screenshots remain historical evidence only. Previous final98122e is superseded by the fixed artifact below.

### Fix1 final package identity

- `D:\movieAgent\libtv-studio\apps\desktop\release-p3\MovieAgent-0.1.0-local-test-Setup.exe` — 129627095bytes — SHA256 `9c6ef0d25451c992fbd9024bcd2be3815666db84da7254c0d90a20ed62691841`
- `D:\movieAgent\libtv-studio\apps\desktop\release-p3\win-unpacked\MovieAgent.exe` — 249798144bytes — SHA256 `efe545b445ae0cd3e4d65eeb89691565ef1ed1895ee94f99bba69e357c92099e`
- `D:\movieAgent\libtv-studio\apps\desktop\release-p3\win-unpacked\resources\app.asar` — 17929475bytes — SHA256 `35bf7bdc0c73b920b646d3735d0e7eb6892e0afc07ea4c38bede181b0ef7c146`


`task-4-fix-1-hashes.json` stores these identities. Only assigned renderer/test/verification-doc files will be staged. Current user runtime, older releases, outer launcher and unrelated untracked material remain untouched. No additional real-service acceptance claimed. Review should scope I1/I2 and these focused tests; report commit follows after exact staging.

Fix1 implementation commit: d4551a6011b18cef622aca671d0a4156145698f1. Exactly6assigned renderer/test/doc files committed; tracked working tree checked clean. Git emitted the existing LF-to-CRLF warning for new creation-navigation.ts. No GUI rerun or full-suite rerun performed.
