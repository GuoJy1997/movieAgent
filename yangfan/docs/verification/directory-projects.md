# Directory project verification

## Task 1 — directory templates and recent identities (2026-10-25)

Runtime APIs are in `apps/desktop/src/main/project-directories.ts` and `recent-projects.ts`; shared schema/types are exported by `packages/contracts/src/directory-projects.ts` and the contracts index. Main contains a bundled TypeScript template; editable document examples and the shared-interface explanation live in `templates/drama-project/`. No runtime template lookup uses cwd or an external developer path.

The manifest is bounded to 64 KiB, strict version 1, UTF-8 (BOM accepted), and contains only format/schemaVersion/templateVersion/workspaceId/name/createdAt/binding. New projects publish an exclusive, fsynced manifest before filling template items. Existing files are never overwritten. Reserved ancestors are checked with lstat before template writes; junctions and type collisions fail before template mutation. This includes fixed engine directories (objects/previews/temp/exports/backups/logs), SQLite/guard files and their known journal/WAL/SHM sidecars, and engine.lock; their contents are not traversed. Binding is fixed once and requires an existing ordinary `library.sqlite`, without opening SQL or starting the engine. Missing bound DBs fail instead of becoming empty projects.

The recent index is bounded to 4 MiB / 10,000 identity records, with only the latest 50 exposed by `list()`. Older identities remain active for copied-project rejection. Only an ENOENT result for the previous root permits relocation. Writes use a fsynced sibling temp plus atomic rename and serialize across instances in the same process. The global launcher is the sole registry writer; project workspaces only verify/read it. T3 must enforce that single-writer process ownership and route ordinary CLI open through launcher registration.

### TDD and executed evidence

- RED: `npm test -- tests/integration/directory-projects.test.ts` with explicit unimplemented API stubs: **31 failed / 31**, expected `NOT_IMPLEMENTED` failures. The earlier missing-module run was a setup error, not the accepted RED evidence.
- Initial GREEN: same command: **31 passed / 31**.
- Additional self-review RED: same command: **3 failed / 37**; uppercase workspace identity and identity eviction were detected. The third failure was Windows file-symlink privilege EPERM in the fixture; replaced that fixture with actual Windows junctions at the manifest/database paths, without requiring privilege changes.
- Updated GREEN: `npm test -- tests/integration/directory-projects.test.ts tests/integration/project-reopen.test.ts tests/integration/engine-lifecycle.test.ts`: **50 passed, 3 files**, exit 0. Existing SQLite tests emitted Node's standard experimental SQLite warning.
- After expanding retained identities to 10,000 and adding the hidden older-copy case: focused directory tests **38 passed / 38**, exit 0.
- Fixed engine descendant preflight RED: `npm test -- tests/integration/directory-projects.test.ts -t 'engine path'`: **15 failed, 38 skipped**, expected PROJECT_PATH_CONFLICT versus successful inspection/creation before adding checks.
- Final source verification: `npm test -- tests/integration/directory-projects.test.ts tests/integration/project-reopen.test.ts tests/integration/engine-lifecycle.test.ts`: **66 passed, 3 files**, exit 0 (duration 11.44s). Directory tests account for 53 of these.
- Final `npm run typecheck`: exit 0, no diagnostics. `git diff --check`: exit 0; Git reported only its existing LF/CRLF conversion notice.

Coverage includes Chinese/spaced paths; editable empty templates; binary source hash/byte preservation; readonly inspect; occupied new destination; unsafe names/nonlocal paths; malformed/future/oversized/extra-field manifests; reserved junction/type collisions; missing bound DB; immutable/repeated binding; interruption/repeated/concurrent initialization; registry reopen/atomic temp behavior; Windows path casing; copied identity refusal; missing-old-root relocation; forged caller objects; invalid and bounded registry state; retained identities outside the visible 50.

### T3 handoff

`createDirectoryProject({mode:'new', directory:parent, name})` creates one child; `mode:'existing'` initializes exactly the selected folder. `inspectDirectoryProject(root)` is read-only and can return an unbound project with incomplete templates after interruption. If filling missing template documents is desired, call `createDirectoryProject` in existing mode with the manifest name. Both return `Result<DirectoryProject>` where `libraryRoot` is fixed to `.movieagent/library`.

`bindDirectoryProject(root, {workspaceId,libraryId,projectId})` compares workspaceId, validates IDs, requires a regular database file, and atomically saves fixed binding. T3 must call `inspectDirectoryProject` again immediately before actual engine opening to repeat fixed-path preflight, initialize via stable commandId, and compare the actual engine library/project identities while holding its profile/library guard before binding. Task 1 deliberately performs no SQL and cannot prove database identity from file existence.

`RecentProjects.open(absolutePath)` returns `Promise<Result<RecentProjects>>`. `list()` returns `Result<RecentProjectStatus[]>` with availability `available|missing|invalid`. `remember(project)` re-inspects the project and returns `Result<RecentProject>`; persisted fields are workspaceId/name/root/pathCanonical/lastOpenedAt only. Root paths come from realpath, with case-insensitive canonical comparisons on Windows. No credential/config/provider data is accepted into the index.

First-file publication uses an exclusive hard link from a fsynced sibling temporary file, so a filesystem without hard-link support returns a write failure rather than risking an overwrite or a torn initial manifest. Only the operation's own temp is cleaned up; orphan temps are ignored. Native directory selection, renderer IPC grants, engine bootstrap, packaged application launch, actual config creation, and UI are Task 3 work.

## Task 2 — main-only model file import (2026-10-25)

`loadModelConfig(path)` reads at most 64 KiB (including BOM), decodes strict UTF-8, validates the entire strict schema and at most eight distinct image providers, and normalizes the existing exact host/port network policy. Partial configuration, unknown fields, unsupported model kinds, public HTTP, credential-bearing URLs and accidentally pasted keys in public fields return fixed errors without field values. The main-private result contains secrets; it must never be returned through IPC. The committed `configs/models.example.json` has blank URL/key/model values. No real `D:/movieAgent/config/models.json` was read, created or changed in this task.

`importModelConfig({host,vault,config})` revalidates a detached copy before mutation, serializes reloads by library, and returns only `Result<ModelConfigStatus>` with source/provider IDs/state/errorCode. Blank entries require no vault or engine changes. Configured entries require available OS protection before draft creation. Fixed IDs are `file-<providerId>-connection`, `file-<providerId>-model`, and `file-<providerId>-profile`; existing manual collisions are rejected by checking the initial normal command receipt before writes. Stable command IDs contain only hashes of secret-free inputs. An initial connection without a credential is a recoverable draft required by the existing credential authorization API; protected vault persistence and status synchronization precede its bound immutable revision. Models have only the existing single-image adapter capabilities, empty optional parameters, and unknown pricing. No test, generation or HTTP operation is performed by import.

Equal normalized configurations reuse existing revisions and protected credentials. `CredentialVault.findProtectedMatch` is a narrow main-only lookup returning a reference; it excludes session, revoked and other-owner envelopes and recovers a prior save interrupted before status registration. Removed/blank providers do not delete records or revoke credentials. Changing URL/key creates new revisions while old refs remain usable. Failures preserve intermediate state for a later reload; configuration import is not an all-provider SQL transaction.

### Executed evidence

All npm commands used a command-local `$env:PATH='D:/nodejs;' + $env:PATH` in `D:/movieAgent/libtv-studio`.

- Accepted initial RED: `npm test -- tests/integration/model-config-file.test.ts` with explicit `NOT_IMPLEMENTED` stubs: **6 failed / 6**. An earlier missing-module run was a setup error, not accepted RED evidence.
- Loader implemented, importer still stubbed: same command **2 passed / 4 failed**, proving import assertions still failed independently after setup succeeded.
- Initial implementation GREEN: same command **6 passed / 6**.
- Self-review RED: `npm test -- tests/integration/model-config-file.test.ts -t 'secrets pasted'`: **1 failed / 8 skipped** because JSON/URL escaping bypassed the public-field secret check. Replaced serialized comparison with original and normalized field-string comparisons.
- Final affected integration run: `npm test -- tests/integration/model-config-file.test.ts tests/integration/model-config.test.ts tests/integration/credential-vault.test.ts`: **18 passed, 3 files**, exit 0, 4.46s. New import tests account for 9; Node emitted its existing SQLite experimental warning.
- Final real Electron fixture: `npm run test:electron -- tests/electron/model-config-import.test.ts`: **1 passed / 1**, exit 0, 4.97s, no warnings. It builds production importer/vault/EngineHost plus the utility engine into a temp harness and uses actual Electron 45 `safeStorage`. Evidence: encryption available; repeat unchanged import; lost response after committed bound revision; host/vault close and reopen using retained refs; successful recovery; revisions connection `[1,2,3]`, model/profile `[1,2]`; exactly two encrypted envelopes; old/new secrets readable only as equality booleans; engine messages, database and vault envelopes do not contain dummy plaintext; zero pending tasks; loopback HTTP listener received **0 requests**.
- Final `npm run typecheck`: exit 0, no diagnostics. The first typecheck detected a test-only Buffer/Uint8Array mismatch, fixed with explicit Buffer construction before the successful runs.
- `git diff --check`: exit 0; only existing LF/CRLF conversion notices.

Additional focused coverage includes exact 64-KiB/eight-entry acceptance, oversize/nine-entry rejection, BOM/invalid UTF-8/JSON, duplicate and malformed IDs, missing files, private IPv4/IPv6 exact grants, blank/unavailable protection zero writes, preserved manual config, secret-free failures, orphan draft/envelope recovery, failed credential synchronization, concurrent reload idempotence, and revoked/session/foreign-owner credential exclusion.

### T3 model configuration handoff

1. Keep configuration path main-owned, outside manifests, passed explicitly from launcher to each workspace. Load privately; never send `LocalModelConfig` or its provider objects to renderer, logs, command outbox or utility host. Only `ModelConfigStatus` and fixed failures may cross the UI boundary. `ready` means configured/imported, not network compatibility or authentication verified. For failed loads/imports the UI can construct error status using the trusted configured source path, empty provider IDs, and the returned fixed error code.
2. After obtaining library ownership, use `host.credentialStatuses()` to get every retained reference before `CredentialVault.open(directory, safeStorage, retained.map(s => s.ref))`. Keep the existing retained-status synchronization/recovery behavior. Import before enabling ordinary provider/replay recovery as appropriate for the existing startup path; do not revoke old references when reloading or clearing file entries.
3. Preserve the special `--live-image-check-library` order: owner-held idle/outbox admission check **before vault opening, provider startup, or replay**. This importer does not perform or replace that admission check. Existing exact network authorization, approvals, receipts and immutable snapshots remain unchanged.
4. Add the narrow reload/status UI wiring and actual no-overwrite local config/script delivery in Task 3. The blank example is the only new configuration file committed here. Broad frozen-source regression and packaged startup remain Task 3 verification responsibilities.

### Task 2 review fix 1 — trailing-slash idempotence

Review found that the shared endpoint parser strips one trailing slash on each pass, so `https://images.example/v1/////` passed loader/import/command validation with different intermediate URLs and appended revisions on unchanged reloads. The file loader now removes all remaining trailing slashes after the existing endpoint/security validation, reaching a stable representation before any import. Shared parsing/network policy is unchanged.

- RED: `npm test -- tests/integration/model-config-file.test.ts -t 'trailing-slash endpoints'`: **1 failed, 9 skipped**, exit 1; second import added connection revision 3 and advanced snapshot sequence 5 to 8.
- GREEN: `npm test -- tests/integration/model-config-file.test.ts`: **10 passed, 1 file**, exit 0, 4.30s. Regression reuses the same loaded config object three more times and compares complete connection/model/profile snapshots and vault filenames against the first import.
- `npm run typecheck`: exit 0, no diagnostics. Existing Node SQLite experimental warning remains documented; no warning suppression or unrelated changes. Unaffected Electron/full suites were not rerun.

## Task 3 — launcher, directory workbench and actual local delivery (2026-10-25)

Implemented the default no-engine launcher, native directory flows/recent cards, independent workspace processes/profiles, stable owned-engine initialization/binding recovery, secret-free config import/reload status, fixed directory-project command guard, explicit legacy mode and all three package/preload boundaries. Existing shutdown/reconnect/live-check admission fences remain intact. No new production dependency, paid API request, video/Agent/timeline capability or installer claim.

Focused RED on the prior actual Electron default failed because `projectLauncher` was undefined; GREEN after implementation proved a dedicated launcher with no utility engine or default business DB. Real SQLite bootstrap tests passed 2/2 (interrupted initialization receipt reuse, identity/missing DB refusal, retained identity beyond visible50); launcher real-window/frame security passed1/1. The development end-to-end fixture passed after correcting its require/command syntax and replacing Playwright's descendant-waiting app.close with app.quit plus owned exitCode observation. That was fixture teardown, not a product workbench failure.

Frozen checks with command-local D:/nodejs PATH: `npm run typecheck` passed; `npm test` 16files/243tests passed (18.36s); `npm run build` passed; `npm run package:win -- --dir` passed; `npm run verify:package` verified:true (Electron45.0.0, ABI150, Node24.22.0, SQLite3.53.4, native sharp and three preload/CSP surfaces); final `npm run test:electron` 14files/40tests passed (167.87s). Existing SQLite experimental warnings remain; electron-builder's npm collector used its traversal fallback and final native/runtime verification passed. A bounded screenshot repair moved folder/launcher actions from clipped sidebar footer into the topbar; final build/package/Electron evidence includes it.

Actual package flow validates create/from-folder with original fixture content preserved, two independent library identities, repeat focus/no second owner, dummy-only config import/reload with equal snapshots and zero loopback HTTP requests, correct canvas save/reopen, malformed config status while editing remains available, no dummy key in exposed provider snapshot/business DB, and live child workbench after launcher exit. Final screenshot evidence (local ignored task workspace):

- `D:/movieAgent/libtv-studio/.superpowers/sdd/2026-10-25-directory-projects/task-3-launcher.png`
- `D:/movieAgent/libtv-studio/.superpowers/sdd/2026-10-25-directory-projects/task-3-workbench.png`

Actual local delivery: `node scripts/start-local.cjs --prepare-only` exclusively created previously absent `D:/movieAgent/config/models.json`, `models.example.json`, `D:/movieAgent/启动MovieAgent.cmd`, and ensured `D:/movieAgent/projects`; a second run returned preserved for all three files without reading their contents. Final normal visible package process was launched at 2026-10-25T14:04:47+08:00 with explicit config path, PID24232, title `MovieAgent · 项目启动器`, Win32 visible=true, handle3017422, engine utility children0, no launcher profile business DB. It remains open for the user. Evidence: `.superpowers/sdd/2026-10-25-directory-projects/task-3-local-launch.json`. This final display is only the launcher, not a fixture or legacy workspace; no model calls were performed. Config starts blank and remains user editable. The package is `apps/desktop/release/win-unpacked/MovieAgent.exe`; prior P1 installer/performance evidence was not overwritten or promoted.

Post-suite evidence repair: the existing image-workflow test regenerated tracked task-8 outputs. This run's 36 changed files were copied to `test-results/directory-projects-legacy`, then the clean-before-test historical files restored individually from HEAD. The test now writes to `test-results/image-workflow`; targeted `npm run test:electron -- tests/electron/image-workflow.test.ts` passed2/2 (25.36s). Product source/package remain the e0357da build; only test output destinations changed. Actual config/example/cmd existence and sizes confirmed (245/245/195bytes) without printing configuration contents. Package SHA256: MovieAgent.exe `5C35AAB8031CE6BC36A106614745D3C5BFAE29A5BBB3BD633D52B14613964C22`; app.asar `2D4AB7A4932C191262C27EE01920EB16A84500BE6E483DF90ED0B3EC854F0531`.

### Controller visual and delivery checks

Controller inspected the actual packaged fixture screenshots, now archived in docs/verification/directory-projects/launcher.png and workbench.png. Project actions, bound drama name, persisted canvas text and engine status were visible. Read-only process check found retained launcher PID24232 titled MovieAgent · 项目启动器 with nonzero HWND3017422. Existence-only checks confirmed models.json245 bytes, launch cmd195 bytes and packaged executable; real configuration contents were not printed. Implementation decisions and task review reports are archived beside the screenshots; final review is still pending.


Task3 independent review approved spec and quality; complete current-plan final review remains pending. Controller recomputed both delivered hashes and matched the worker evidence exactly. Minor folder/launcher action error-feedback and pre-existing tooling warnings are forwarded to final review.

### Final review and retained follow-up

The whole-plan review a990330..6bf6ce8 approved delivery with no Critical or Important findings. Source remains on the local codex/desktop-foundation branch. All three task gates and the final plan item are complete; no final product repair/rebuild was required. Final review and implementation reports are archived under docs/verification/directory-projects, together with the package screenshots, launch evidence and decisions.

One nonblocking P3 remains: failed “open project folder / launcher” actions currently lack visible workbench feedback. Successful actions and persistence are verified. Existing SQLite/toolchain warnings remain disclosed. Real provider authentication/generation, a new installer, other platforms, Agent/video/timeline/export, and automatic indexing of visible template folders are not claimed by this delivery.

Temporary coordination cleanup was rejected by automatic approval review with only blocked by policy. No alternative deletion was attempted; the closed plan workspace remains, while durable evidence is committed. This does not affect the application.
