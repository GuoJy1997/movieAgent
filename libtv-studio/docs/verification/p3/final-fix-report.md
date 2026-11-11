# Final grouped P3 fix wave — I1/I2 and adjacent minors

Date: 2026-10-27. FIX_BASE `d4551a6011b18cef622aca671d0a4156145698f1`; branch `codex/desktop-foundation`. Read final-review.md, task-4-report.md, delivery-decisions.md and the P3 spec/plan. Applied TDD and verification-before-completion. No nested agents, real models, user models config/keys/endpoints, user libraries, outer-launcher changes, or current runtime restart. PID9268 read-only checked still running `release-text-models/win-unpacked/MovieAgent.exe`.

## Changes

- **I1:** AgentWorkspace matches persisted assistant messages to each card by runId and role. Replies render independently of draft existence, including normal REPLIED and stopped late replies. A proposal reply is only used as fallback when there are no persisted assistant messages, avoiding duplicates. No render/mount/reopen command or HTTP request was added.
- **I2:** Added `useRevisionDraft`, used by the real entity/script/shot submit handlers. A save captures its submitted draft, local edit generation and editor scope. An acknowledged unchanged draft is replaced by the canonical result and marked saved. A draft edited during the await retains all current fields, advances only expectedRevision to the saved revision, and stays visibly dirty. Concurrent submit is locally guarded. Explicit reload advances scope; layout-effect cleanup invalidates unmounted editors before their async callbacks can navigate the parent. Parent editor mount keys already change on user selection, so the old callbacks cannot replace a new selection.
- Agent preparation captures session lifecycle scope and submitted message. It only opens its approval if still in that scope and only clears a message still equal to the submitted one. The adjacent create-session acknowledgement uses the same scope gate, preventing it from navigating away from a newer session choice. A stale prepared run remains in persisted history for explicit later reopening.
- **M1:** Shared `AGENT_MESSAGE_MAX_LENGTH = 4000` between textarea and existing request/PreparedTurn guards. The form displays the limit and current length; no backend budget change.
- **M2:** Formatted the touched EntityWorkspace, CreationWorkspace and AgentWorkspace handlers/forms. No component redesign. Untouched ShotProductionPanel long JSX remains an explicit nonblocking minor; existing builder/SQLite warnings remain disclosed.

## Test mechanism and RED

`tests/renderer/p3-acknowledgement.test.ts` mounts the actual three workspace components and their actual child forms in local headless Chromium through Vite. Only runtime command/query transport is replaced by a fixture boundary; commands use deferred promises, and tests exercise real React event handlers/state and unmounts. No state transition algorithm is copied into tests. Fixture JSON is local and has no user configuration. Every case checks renderer errors and HTTP POST absence. Reply tests additionally check zero commands on mount/reopen.

Initial setup attempts found the installed Playwright version expected Chromium1248, while local1243 was available, and Vite initially scanned unrelated HTML entry points. Those setup errors were corrected by an explicit local executable environment variable and restricting optimizer entries to the fixture. They are **not** treated as bug RED evidence.

`final-fix-red-clean.log` then recorded **10 failures / 10 tests** on the old implementation: all three saves replaced B with submitted A; entity stale callback switched parent latest-query identity, script stale callback navigated A, shot stale callback removed B's editor; Agent cleared next request and opened old-session approval; textarea accepted4001; reply-only answer was absent. `final-fix-create-red.log` separately records the stale create-session callback RED (1 failed /10 skipped), before that adjacent fix.

The first integrated GREEN was10/10, then combined15 and16 after the create-session case. The final file location/config was separated from the default core suite so ordinary core tests do not acquire a Chromium dependency.

## Final verification commands and evidence

All shell commands use native Windows PowerShell. Executable `D:/nodejs/node.exe` is Node24.12.0. Root is `D:/movieAgent/libtv-studio` unless specified.

```powershell
$env:MOVIEAGENT_TEST_CHROMIUM='C:/Users/1266/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run --config vitest.renderer.config.ts
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/creation-review-presentation.test.ts
D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json
```

- `final-fix-renderer.log`: **1file /11tests passed**, 01:49:46,10.45s, exit0. The three saves assert B survives, dirty indicator remains, actual second command sends B with expectedRevision2, then final unchanged acknowledgement shows saved. Switch cases assert entity latest-version ownership, script selection and shot scriptId; Agent cases include unchanged-request clearing, preserving next request, session switch and create-session stale response. Input bounds and REPLIED/STOPPED/PROPOSED messages are covered, including no duplicate answer and no commands on reopen.
- `final-fix-presentation.log`: **1file /5tests passed**, 01:49:57,0.719s, exit0. Existing scoped navigation/proposal-diff regression.
- `final-fix-typecheck.log`: empty output, exit0.

From `apps/desktop` with PATH prefixed `D:/nodejs;C:/Windows/System32;C:/Windows/System32/WindowsPowerShell/v1.0;`:

```powershell
D:/nodejs/node.exe ../../node_modules/electron-vite/bin/electron-vite.js build
D:/nodejs/node.exe ../../node_modules/electron-builder/cli.js --win --x64 --config.directories.output=release-p3 --config.electronDist=D:/movieAgent/libtv-studio/node_modules/electron/dist
```

- `final-fix-build.log`: exit0;300 renderer modules.
- `final-fix-package-build.log`: exit0, local installed Electron45 distribution, no download/dependency changes. Existing duplicate dependency/default icon/unsigned warnings retained.
- Root `D:/nodejs/node.exe scripts/verify-package.mjs --dir apps/desktop/release-p3/win-unpacked`: exit0. `final-fix-package.json` verified true; Electron45.0.0,ABI150,Node24.22.0,SQLite3.53.4,sharp2x3 PNG probe, four isolated preloads and CSP HTML entries.
- `git diff --check` passes; exact staged diff will be checked before commit. Git emits existing LF→CRLF working-copy normalization warnings; these are not test failures.

No repeat of full493 core suite or packaged Electron GUI. The historical GUI/IPC **2files/3tests** and screenshots belong to archive `8219ef2218d6eb10185d3272a892082dfe5390ca7c8582ff89fafa835f39f6ba`, not the package below. Headless mounted source-component tests are not represented as final-archive GUI evidence. Real Kimi quality, live image/reference-video chain/billing, signing/clean-machine install remain unaccepted.

## Final artifact identity

`final-fix-hashes.json` records:

| File in apps/desktop/release-p3 | Bytes | SHA256 |
| --- | ---: | --- |
| MovieAgent-0.1.0-local-test-Setup.exe | 129628069 | `82840a8c600fa372f2e0458c6550cf82f6a37907f4a101c115256df15e406bde` |
| win-unpacked/MovieAgent.exe | 249798144 | `b339ea9baedb388c51e6bdef2b43b2b6adec8434b573de150f105ee4bbfe53ea` |
| win-unpacked/resources/app.asar | 17933813 | `f9ece7b411147bc9f8f7deceeb690bb7e74c11f350596c701d2ccf3aac311728` |

This supersedes fix1 archive35bf7b and installer9c6ef0. Controller owns scoped independent review, final compiled-file/archive comparison, launcher and evidence delivery. No further rebuild is planned after these identities.

## Exact owned commit scope

1. apps/desktop/src/renderer/features/agent/AgentWorkspace.tsx
2. apps/desktop/src/renderer/features/creation/CreationWorkspace.tsx
3. apps/desktop/src/renderer/features/creation/useRevisionDraft.ts
4. apps/desktop/src/renderer/features/entities/EntityWorkspace.tsx
5. packages/contracts/src/agent.ts
6. tests/fixtures/p3-renderer/main.tsx
7. tests/fixtures/p3-renderer/runtime.ts
8. tests/renderer/p3-acknowledgement.test.ts
9. vitest.renderer.config.ts
10. docs/verification/p3-creation-agent.md

Scratch evidence remains ignored for controller archival. No binaries, older release directories, unrelated untracked materials, `docs/delivery`, or controller-owned `docs/verification/p3` are included in this commit.

Final fix commit: **`25513e9bb8fce30436036c9be82c153bb8f18272`** (`fix: preserve P3 drafts across delayed acknowledgements`). Exactly the 10 files above committed. `git diff --cached --check` passed before commit; post-commit tracked/index diffs are empty. The controller's untracked delivery/evidence files are preserved. Ready for the one scoped review and identity gate; no source or package changes remain planned.
