# Task 3 review — 450fdf6..dfb9217

## Spec Compliance

- ✅ Spec compliant for the reviewed implementation. Default/explicit launcher and explicit legacy routing, launcher-owned registration, read-only child admission, independent profiles, owned-engine identity binding, configuration import/status, fixed IPC surfaces, package resources, and no-overwrite local preparation are implemented. Evidence: `apps/desktop/src/main/index.ts:12–30`, `project-launcher.ts:35–55`, `workspace-bootstrap.ts:12–32`, `workbench.ts:49–62`, `scripts/start-local.cjs:12–15`.
- ✅ Initialization replay uses the manifest workspaceId as a persistent command identity, then checks the host library and queried project before writing the binding (`workspace-bootstrap.ts:21–31`). Reserved-path/registry validation runs again immediately before engine opening (`workbench.ts:70–75`). The real SQLite regression exercises receipt reuse and missing-bound-DB refusal (`tests/integration/workspace-bootstrap.test.ts:11–27`).
- ✅ Main startup retains credential references and imports configuration before provider activation; the existing live-check admission remains before this activation and durable replay (`workbench.ts:49–62`, `workbench.ts:145–160`). No startup configuration test request or generation command was added.
- ✅ The dedicated launcher bridge has eight fixed capabilities, and its policy verifies sender window, main frame and exact trusted URL before checking arguments (`launcher-ipc.ts:6–14`, `apps/desktop/src/preload/launcher.ts:3–13`). Workspace actions accept no renderer path input and reuse the existing sender policy (`ipc-policy.ts:17–33`). Both project creation entry points are blocked in directory mode (`ipc-policy.ts:32–35`).
- ✅ Actual-package fixture covers two independent libraries, repeat-open identity, persisted canvas reopen, dummy configuration import/reload, zero HTTP calls, preserved source files and surviving workspace after launcher exit (`tests/electron/directory-workspace.test.ts:21–84`). Dedicated real-frame/window policy coverage is present (`tests/electron/launcher-security.test.ts:9–24`).
- ⚠️ Not independently re-executed: the 243 integration tests, 40 Electron tests, typecheck/build/package verification, screenshot visual assessment, final package hashes, and retained visible PID 24232. Their supplied report/evidence were read; the controller already checked the screenshots. `task-3-local-launch.json` records visible=true, zero engine children and no launcher library. Product package corresponds to e0357da; dfb9217 only changes test output destinations/documentation. No installer or real model validation is inferred.

## Strengths

- Registry admission checks all retained identities rather than the 50 UI entries (`recent-projects.ts:59–65`); the launcher registers before spawning a child, uses argument arrays, coalesces in-flight opens, and returns bounded startup status (`project-launcher.ts:35–55`).
- Engine startup retains the existing provisional/published connection fencing and bounded owned-engine shutdown (`workbench.ts:76–135`). Project processes are detached and independently locked, so closing the launcher does not terminate them (`project-launcher.ts:16–20`, `workbench.ts:114–116`).
- Configuration results expose only the main-owned source, IDs, state and fixed error code (`workbench.ts:62–69`); package verification checks all three preload and HTML boundaries (`scripts/verify-package.mjs:11`, `scripts/verify-package.mjs:40–60`). Local config/example/command creation uses exclusive writes and never reads existing user contents (`scripts/start-local.cjs:12–15`).

## Issues

### Critical (Must Fix)

- None found.

### Important (Should Fix)

- None found.

### Minor (Nice to Have)

- `apps/desktop/src/renderer/App.tsx:93–94`: the folder and launcher buttons discard both returned failure results and rejected promises. A moved/unavailable project directory or a launcher spawn failure therefore produces no visible feedback in the current workbench, despite the main actions returning actionable failure codes. Surface these results through the existing error UI or a small action-status state.
- `docs/verification/directory-projects.md:78`: reported checks still contain SQLite experimental warnings and electron-builder fallback/toolchain notices. These are documented pre-existing verification noise, not evidence of a new product failure; keep the raw check status distinguishable from these warnings and address the toolchain noise separately.

## Bounded checks and limits

- Full supplied diff read in segments. Initial combined output truncated within the first 650 lines, so that affected beginning was reread; no changed-file implementation was independently reread to reconstruct already visible hunks.
- Named risk: `RecentProjects.open` might write registry state during child admission. Checked only its unchanged loader/open portion (`recent-projects.ts:16–42`); it reads/validates and constructs an instance without writing. Child `validate` itself only loads/checks.
- Named risk: repeated renderer reloads might race immutable revisions or leak an importer error. Checked `model-config-import.ts:39–133`; imports serialize per library, use retained protected credentials, and return bounded status/error results. No new test was warranted.
- Named risk: unavailable system protection might prevent blank editing or silently downgrade the import. Checked `credential-vault.ts:15–36` and importer protection guard (`model-config-import.ts:42–43`); opening the vault does not require protection availability, and active imports reject unavailable protection without plaintext fallback.
- No tests were rerun, no real model configuration contents were read, no real API was called, and no user application was closed or relaunched. Only this review report was written.

## Assessment

**Task quality: Approved.** The reviewed implementation meets the task's ownership, recovery, IPC and delivery requirements, with focused behavioral coverage and preserved lifecycle fences. The two minor findings do not undermine project isolation or local delivery.
