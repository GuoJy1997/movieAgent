# Task 3 implementation report

Status: DONE. Base 450fdf6, branch codex/desktop-foundation.

## Implementation and interfaces

- Added a no-engine default launcher, native create/from-folder/open/recent actions, recent availability cards, fixed configuration-file opener/status and explicit legacy entry. Graphite tokens and existing controls are retained. Launcher has its own CSP HTML and sandboxed preload with exactly eight capabilities; production policy rejects other windows, subframes, unknown channels and path-shaped inputs.
- Main routes default/--project-launcher to the launcher; ordinary --project-root registers through it. Private workspace children validate all retained registry identities read-only, derive profile from workspaceId, reinspect reserved paths immediately before EngineHost startup, then validate/bind the owned library/project through normal engine commands. Stable directory-init-<workspaceId> receipts recover DB-commit-before-manifest interruption. Missing bound DB and mismatched business identity are refused. No main SQL added.
- Launcher remains the sole recent-registry/settings writer. Child processes use spawn argument arrays, detached normal visible app processes and independent profile/vault/outbox/engine ownership. The per-profile Electron lock focuses a repeat; launcher coalesces in-flight opens and waits for bounded, secret-free startup status. Errors surface in launcher/native dialog. Closing launcher leaves project processes alive.
- Extracted existing lifecycle to workbench.ts without changing provisional/published connection fencing, graceful owned utility shutdown or synchronous scheme registration. Owner-held live-check admission remains before vault/provider/replay. All retained credential refs still seed the vault; directory identity bootstrap, safe file import, provider activation and durable recovery occur in that order. File parse/import failures yield only trusted source/providerIds/state/errorCode and leave project editing available. Reload uses main-owned file path and immutable importer; no test request or generation command is issued.
- Workbench auto-selects the bound project, identifies its name, offers known folder/launcher actions, and exposes safe model status/reload. Both studio.createProject and generic execute(project.create) reject extra projects in directory mode; explicit legacy mode keeps old behavior. Folder/launcher actions moved into the topbar after screenshot inspection found the sidebar footer could clip them at the default height.
- Build/package verification now includes the third preload and HTML, plus exact updated bridge surface. scripts/start-local.cjs creates config/example/cmd only with exclusive writes; existing values are neither read nor overwritten. Actual creation and visible launch evidence follow below.

## Focused RED/GREEN and repairs

All npm commands use command-local `$env:PATH='D:/nodejs;' + $env:PATH` in D:/movieAgent/libtv-studio.

- RED: `npm run test:electron -- tests/electron/directory-workspace.test.ts` on original build: 1/1 failed, expected projectLauncher object, received undefined. This exercised actual old Electron default startup, not a missing-module setup failure.
- GREEN: same test after launcher build: 1/1 passed, 3.05s; no workspace bridge/utility engine/default DB. The enclosing diagnostic shell later had an unrelated invalid rg glob, while npm's test itself passed.
- `npm test -- tests/integration/workspace-bootstrap.test.ts`: 2/2 passed, 4.15s; real engine/SQLite initialization receipt replay, repeated same binding, foreign identity refusal, missing-bound-DB refusal, and child validation of a registered identity hidden beyond 50 recent cards.
- `npm run test:electron -- tests/electron/launcher-security.test.ts`: 1/1 passed, 2.62s; actual parent/child renderer frames and unauthorized BrowserWindow, invalid names/paths and unknown channel.
- Development flow: command-local `DIRECTORY_TEST_DEV=1`; `npm run test:electron -- tests/electron/directory-workspace.test.ts -t 'native launcher'`: final 1 passed/1 skipped, 9.75s. Real native dialog result injection, production launcher spawn, two independent real workbenches, preserved user fixture file, repeat identity, dummy config import/reload with zero loopback requests, saved canvas/reopen, and child survival after launcher exit.
- Fixture repairs before freeze: Playwright main evaluation has no require (use process.getBuiltinModule); command name corrected to canvas.applyCommand; Playwright app.close waited for detached descendants and timed out although workbench operations all passed. The final fixture requests app.quit and observes the owned launcher process exitCode, then asserts the child bridge remains online. Teardown closes only fixture pages/apps and removes only created temporary roots. No global process kill.
- Typecheck repaired test-only overloaded spawn typing, then passed. Source self-review removed a defensive type cast so even an unavailable vault cannot accidentally return a main-private loaded config. No actual user Key was read/printed; dummy-only test data.

## Frozen-source checks

- `npm run typecheck`: exit 0, no diagnostics (also repeated after the bounded topbar placement repair).
- `npm test`: 16 files / 243 tests passed, 18.36s, exit 0. Existing Node SQLite experimental warnings only.
- `npm run build`: exit 0; main engine/index plus shared lifecycle chunk, three preloads, three HTML entries and renderer assets generated.
- `npm run package:win -- --dir`: exit 0, unpacked Windows x64 package rebuilt. electron-builder used its documented traversal fallback after powershell.exe was unavailable for npm collection; final package ABI/runtime verification below passed. Existing optional non-Windows module/default-icon/unsigned notices were not changed.
- `npm run verify:package`: exit 0, verified:true; Electron45.0.0/ABI150/Node24.22.0/x64/Win32, SQLite3.53.4 and sharp 2x3 PNG native checks, all three bridge/CSP entry boundaries.
- `git diff --check`: exit 0; LF/CRLF notices only.

## Self-review and scope

Read route, launcher, IPC, bootstrap, workbench lifecycle/import order, renderer, verifier and fixture diffs. Preserved controller plan/spec edits and unrelated untracked research/prototypes; no D:/rea or old cleanup-denied directory touched. No dependencies or new product design exploration. Workbench extraction retains the prior long lifecycle implementation (approximately 240 lines); task-specific boundaries live in focused new modules. No unresolved product correctness issue found at this point; final Electron/package/visible delivery results will be appended. No installer, real paid service validation, video/Agent/timeline or automatic script editing claim.

## Final package and local delivery results

- `npm run test:electron`: final exit0, 14 files / 40 tests passed, 167.87s. Includes actual rebuilt package directory workflow, real legacy compatibility, existing reconnect/lifecycle/live-check admission/media/credentials/image/canvas suites and the new launcher security policy. No failures; SQLite experimental warnings only. The directory fixture uses a zero-request dummy loopback server and actual package-native create/open/from-folder/reopen processes.
- Final package screenshots (visually reviewed) are `D:/movieAgent/libtv-studio/.superpowers/sdd/2026-10-25-directory-projects/task-3-launcher.png` and `D:/movieAgent/libtv-studio/.superpowers/sdd/2026-10-25-directory-projects/task-3-workbench.png`. Launcher shows two fixture recent cards; workbench shows correct short-drama name, persisted text node, topbar folder/launcher actions and connected engine status. These are fixture screenshots, separate from the user's final retained launcher.
- `node scripts/start-local.cjs --prepare-only` first returned created for config/example/launcher; the second returned preserved for all. Before creation, Test-Path confirmed all three absent and default launcher profile absent. Actual paths: `D:/movieAgent/config/models.json`, `D:/movieAgent/config/models.example.json`, `D:/movieAgent/启动MovieAgent.cmd`, project parent `D:/movieAgent/projects`. Script never reads existing user file contents. Config/example were created from empty values; no actual user key inspected.
- Final executable `D:/movieAgent/libtv-studio/apps/desktop/release/win-unpacked/MovieAgent.exe` launched with `--project-launcher --model-config=D:/movieAgent/config/models.json` using an owned normal visible GUI process at 2026-10-25T14:04:47.5539076+08:00. PID24232, title MovieAgent · 项目启动器, Win32 IsWindowVisible=true, HWND3017422, engine utility children0, no launcher-profile library.sqlite. UserData C:/Users/1266/AppData/Roaming/MovieAgent/launcher. Evidence file `D:/movieAgent/libtv-studio/.superpowers/sdd/2026-10-25-directory-projects/task-3-local-launch.json`. It remains open; no workspace/model execution was started for the final display.
- Source implementation and exact test/docs paths are staged separately from controller-owned plan/spec edits and unrelated research. Final status DONE; no unresolved correctness concerns found in self-review. Unimplemented capabilities remain clearly marked planned. Existing unpublished/unsigned unpacked package is the local delivery; no rebuilt installer claim.


## Commit and final repository state

Commit e0357da — feat: add directory project launcher and local desktop delivery (29 exact task source/test/docs paths). Final staged diff check passed after removing a trailing blank line in the new fixture (whitespace only, no product rebuild required). Controller plan/spec changes and unrelated untracked research/prototypes remain untouched and unstaged. The local ignored report/evidence are not part of Git. User-visible launcher PID24232 is intentionally retained.

### Evidence-output repair after final suite

The full historical image-workflow test had regenerated tracked task-8 screenshots and display evidence. Their pre-test state was clean. The 36 changed outputs were first copied into `test-results/directory-projects-legacy`, then restored individually from HEAD; no unrelated work was restored. Changed only that test's output destinations to `test-results/image-workflow` (including explicit directory creation for its second standalone case). Targeted `npm run test:electron -- tests/electron/image-workflow.test.ts` passed 2/2,25.36s. Product source and unpacked package remain exactly the e0357da build; no broad rerun or rebuild was needed for the test destination repair.

Existence/size-only local delivery check: models.json245bytes, models.example.json245bytes, 启动MovieAgent.cmd195bytes; package launcher screenshot94067bytes and workbench screenshot63536bytes. Actual config contents were not printed. Delivered package hashes: MovieAgent.exe SHA256 `5C35AAB8031CE6BC36A106614745D3C5BFAE29A5BBB3BD633D52B14613964C22`; resources/app.asar SHA256 `2D4AB7A4932C191262C27EE01920EB16A84500BE6E483DF90ED0B3EC854F0531`.

Follow-up commit dfb9217 — test: keep runtime screenshots separate from historical evidence. Final tracked working tree contains only the controller's plan/spec changes; all task-8 historical outputs restored. Final user-visible launcher remains PID24232. Product/package corresponds to e0357da; dfb9217 changes only the test output path and verification note.
