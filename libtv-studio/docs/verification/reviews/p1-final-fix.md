# MovieAgent P1 final review — combined repair wave

Date: 2026-10-25. Base `9af6ac7f9fffca1fadcff10e86a2a70a539c1062`, branch `codex/desktop-foundation`. No new worktree, agents, PR or push. Applied Superpowers implementer, systematic-debugging, TDD and verification-before-completion instructions. Node24.12/npm11.6.2 with required PATH. No real API, real key discovery, user library, paid script, D:/rea or previously blocked cleanup path accessed.

## Findings and implementation

- **I1:** `command-rejection.ts` documents a command-aware allowlist traced through the actual synchronous canvas/configuration/generation/asset/cancel handlers. `LocalConnection.execute` durably moves proven rejection to existing rejected_command evidence (full envelope, request hash, error code), before checking stale connection, just as valid receipts settle before staleness. Recovery uses the same classifier and proceeds to later commands. Receipt and accepted identity lookup precedence in engine is unchanged. Imports permit only the three grant errors proven to occur before accepted batch lookup; async task recovery, storage, malformed responses, transport failures and uncertain collection remain pending. No general error-string catch-all was added.
- **I2:** local draft scope is stable libraryId/canvasId, with existing nodeId/incarnation keys. Query/event/command identities remain epoch-scoped; RuntimeProvider also refuses to return a successful old-epoch result for a renderer draft ACK after an intervening refresh. Each field captures CAS when first edited and retains that baseline while dirty. Same-library reconnect retains selection/content/layout and dirty count. Changed saved fields show conflict without silent rebase. Deleted/restored incarnations expose old draft text/layout separately and allow explicit discard, never copy into the new incarnation. Existing Zustand memory store is used; no durable draft store/framework or guarantee across complete quit/renderer reload.
- **M1:** expanded the named HTTP DNS/socket/abort/download, synchronous image-outcome and artifact persistence blocks. Named URL/address/base64/content predicates make branches inspectable. Protocol, limits, redirects, abort cleanup, immutable manifest binding and paid output-loss classification are unchanged. Provider contract tests cover the preserved boundaries.
- **M2:** task/connection/asset empty views require successful query snapshots. Initial pending includes disabled/unconnected reads, errors remain distinct, asset count is unknown before data exists. Cached rows are still rendered during refresh error; package regression checks previously loaded connection remains visible.
- **M3:** ordinary startup test writes a timestamped test-results measurement only after its assertions, includes actual exe/asar SHA256, and verifies frozen documentation stayed byte-identical. Explicit `promote-performance.mjs --source ... --target ...` refuses non-success and changed package hashes before replacing chosen release evidence. Final evidence promotion follows complete successful package validation.
- **M4:** saved explicit fixed text inputs enable prepare with empty local prompt. The engine remains the combined-prompt validator, and no graph execution or new provider behavior was introduced. Engine control checks fixed text version remains authoritative even when live text becomes empty, and rejects a truly empty combined prompt without HTTP submission.

## Focused RED/GREEN

1. `npm test -- tests/integration/command-delivery.test.ts`: RED3 failed/19 passed,7.60s,exit1. Real v1→v2→stale-v1 delivery left pending row; restart recovery returned CANVAS_CONFLICT and stranded later command; real CREDENTIAL_UNAVAILABLE configuration left pending. GREEN22/22,7.43s,exit0 after classifier. Tests explicitly resolve with new ID, reopen engine/outbox, recover later project exactly once and inspect rejected envelope/hash/code. Existing accepted-import interruptions, cross-kind accepted identity, late ACK, uncertain transport and receipt controls still pass.
2. Packaged RED `npm run test:electron -- tests/electron/final-review-regressions.test.ts -t 'wake|failed first'`:4 failed/1 skipped,10.34s. Task/provider loading and asset initial error showed false empty. The first wake test failure was a test-authoring comparison of incidental ReactFlow visibility style (not claimed as product evidence). Corrected it to compare only transform and observe the new epoch canvas query before asserting drafts.
3. Corrected packaged RED `... -t 'wake|fixed text'`:2 failed/4 skipped,17.59s. After the new epoch canvas read, inspector count0 instead of1 (draft hidden); fixed-input-only prepare stayed disabled. These ran the original reviewed package.
4. Draft per-field baseline RED `npm test -- tests/integration/ui-canvas-draft.test.ts`:1 failed/3 passed,0.707s. First layout edit after newer saved layout retained revision1 instead of4. GREEN4/4,0.639s. Existing unrelated-field ACK, new incarnation/library isolation and text typed during in-flight save controls pass.
5. Promotion RED `npm test -- tests/integration/release-tools.test.ts -t promotes`:1 failed/11 skipped,1.01s because promotion script absent; successful selection could not promote. GREEN complete release-tools12/12,2.38s. Non-success and changed asar preserve frozen target.
6. `npm test -- tests/integration/image-provider-contract.test.ts tests/integration/ui-canvas-draft.test.ts`:50/50,8.45s,exit0 after named readability edits. `npm run typecheck`:exit0.

## Final verification (append actual results below)

- Complete `npm test`:13 files,178/178,17.48s,exit0. No repeated broad integration run. Last subsequent production edit only replaced raw detached-draft JSON display with readable text/layout; it was covered by final typecheck/build and packaged new-incarnation UI regression.
- Final `npm run typecheck`:exit0; `npm run build`:exit0, main58.16kB/engine129.62kB; all production code then frozen. Subsequent test-only correction uses production-supported delete→undo to create a new incarnation (same node ID cannot be created twice).
- Final NSIS / package probe / full Electron results: pending completion at report creation; do not treat this initial entry as a handoff claim.

## Self-review and limitations

Inspected all changed production boundaries together: allowlist only matches actual precommit handler paths; no ownership/storage code is discardable; identity reservations retain priority; request hash excludes transport epoch; stable local scope uses project library identity; incarnation lookup and detached visibility prevent copy; field baselines stay independent and ACK cannot rebase another field; query empty status excludes pending/error while cached mapping remains; provider formatting preserves ordering; promotion checks both measured identities; no paid branch or admission/approval fence was altered.

Existing SQLite ExperimentalWarning, builder package-manager/dedup/default-icon/signing and LF→CRLF notices are disclosed; output is not claimed pristine. No clean OS/installer execution, physical sleep, signing, real billing/CDN/API, full restore, graph/video/Agent/remote or broad performance certification. Sleep tests use actual packaged main powerMonitor events; utility reconnect terminates only that fixture's discovered engine PID. Ordinary owned Electron processes and fresh fixture roots are closed through test cleanup; previously blocked roots are never retried.

Final artifact identities, deliberate performance promotion, exact staging and commit are recorded below after verification completes.

## Completed final package and evidence

- Final sequential `npm run package:win`:exit0; full NSIS/unpacked package generated, signing skipped by configured local-test policy. No overlapping builder, installer execution or production/config edit afterward.
- `node scripts/verify-package.mjs | Tee-Object -FilePath docs/verification/task-10/package-probe.json`:exit0, packaged Electron45.0.0/Node24.22.0/ABI150/SQLite3.53.4, actual archive-resolved Sharp PNG2×3/96bytes/hash783cf58b9994058840e4c0ff7200389329302b6694e2392e3287fafa40655c26. Probe evidence was annotated with final exe/asar hashes and capture time from manifest after successful execution; raw runtime assertions are unchanged.
- Final full `npm run test:electron`:11files36/36,150.81s,exit0, started08:19:16 local. No failures and no broad retry. New tests verify packaged wake and utility crash/reconnect with content+layout drafts, old-field CAS conflict and explicit resolution, delete→undo incarnation isolation, loading/error/success empty states, cached connection visible after background failure, and fixed-text-only preparation. Existing full IPC/credential/media/provider/lifecycle/identity/admission regressions pass.
- `node test-results/capture-release.cjs`:exit0. Extended local evidence capture to compare **all11 final built outputs** byte-for-byte with actual app.asar, including renderer and main chunk, not just the four entry/preload files. All match; manifest records bytes and SHA256. Windows metadata/Get-AuthenticodeSignature confirms MovieAgent identities and NotSigned for exe/installer. No actual installer execution.
- Explicit promotion after suite success: `node scripts/promote-performance.mjs --source test-results/packaged-startup-1792887685815.json --target docs/verification/task-10/local-performance.json`:exit0, PERFORMANCE_EVIDENCE_PROMOTED. MeasuredAt2026-10-25T00:21:23.705Z, startup1091.4589ms; measured exe/asar match final manifest. Two five-process samples: CPU0→19.5343672766%, cumulative1.677641→2.407479s, working383.1992→460.0859MiB, summed lifetime peaks398.5547→460.7773MiB. Limitations unchanged. Task8 screenshot changes from ordinary regressions restored to original historical files. Historical Task10 section is explicitly labeled pre-final-review baseline.

| Absolute final path | Bytes | SHA256 |
| --- | ---: | --- |
| D:/movieAgent/libtv-studio/apps/desktop/release/MovieAgent-0.1.0-local-test-Setup.exe | 129459987 | 22f732eaa4848bf77ebdbf99199049aa670e5b39db6c8af227d93e4742e6e5ec |
| D:/movieAgent/libtv-studio/apps/desktop/release/win-unpacked/MovieAgent.exe | 249797632 | 02550f72731883597899e66f184b907af39a9949b6610f1e7df3e9ffae6d5b57 |
| D:/movieAgent/libtv-studio/apps/desktop/release/win-unpacked/resources/app.asar | 17373423 | 9724a68a430f5a3f4a56111d449655fd7bf2afc9bd43fafc1a5a10eabbd1e4c9 |

Main SHA25610a956735c679eb84d52e902ae6b2a7eb55295a6b6ae2a4c0a4c9b8894baf369; engine081aeada7a77c202b55fb4f60e09bf9b5b047891492fca4e019f70a080c7f41f; renderer5c3e187c1ebdb378a516a1c8fecab080becab74023a0865482cb71bbb5a9b1a9. This package contains the actual six repairs, not the review-base binary.

No remaining correctness concern identified in the bounded self-review. Physical sleep, live paid acceptance, clean OS/installer execution and full restore remain intentionally unverified. Exact final stage/commit follows.

## Exact staging and final status

Exactly24 intended files staged; cached whitespace check exit0, tracked unstaged diff empty, original untracked research/prototypes preserved. Final typecheck after test-only additions exit0. No owned MovieAgent process remained. Report is local ignored coordination evidence; durable verification/release documentation is in the commit.

Files:

- apps/desktop/src/main/command-rejection.ts
- apps/desktop/src/main/local-connection.ts
- apps/desktop/src/renderer/features/assets/AssetLibrary.tsx
- apps/desktop/src/renderer/features/canvas/CanvasWorkspace.tsx
- apps/desktop/src/renderer/features/models/ModelSettings.tsx
- apps/desktop/src/renderer/features/tasks/TaskPanel.tsx
- apps/desktop/src/renderer/services/runtime.tsx
- apps/desktop/src/renderer/state/canvas-draft.ts
- docs/development.md
- docs/verification/p1-image-workflow.md
- docs/verification/task-10/local-performance.json
- docs/verification/task-10/package-manifest.json
- docs/verification/task-10/package-probe.json
- docs/verification/task-10/windows-metadata.json
- packages/providers/src/artifact-source.ts
- packages/providers/src/http-transport.ts
- packages/providers/src/openai-images.ts
- scripts/promote-performance.mjs
- tests/electron/final-review-regressions.test.ts
- tests/electron/packaged-startup.test.ts
- tests/integration/canvas-result-binding.test.ts
- tests/integration/command-delivery.test.ts
- tests/integration/release-tools.test.ts
- tests/integration/ui-canvas-draft.test.ts

Commit: 7e228006f1cae4373f4ae257856ab073c660f571 — fix(desktop): preserve drafts and recover past rejected commands. Exactly24 files committed. Final tracked status empty. Status DONE; no bounded correctness concern identified, disclosed acceptance limits remain. No push/PR.
