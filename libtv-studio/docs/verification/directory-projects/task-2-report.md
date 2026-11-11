# Task 2 implementation report

Status: DONE. Base: 6029fd6, branch codex/desktop-foundation.

Commit: 19c4126 — feat: import local model configuration through protected vault (9 exact task paths). Post-commit tracked diff contains only the controller's plan-checkbox update; task implementation paths are clean.

## Implementation

- Added main-private bounded UTF-8/BOM configuration loading and full schema validation. At most 64 KiB/eight distinct providers; exact fields, existing supported single-image model syntax, empty-entry handling, partial-config errors and exact private host/port policy through the existing parser. Errors are fixed strings and never expose values. A cross-entry public-field check prevents accidentally pasted credentials escaping through metadata, including JSON/URL transformations.
- Added serialized importer using EngineHost query/execute/updateCredentialStatus only, never main business SQL or network. Stable file IDs and initial receipt provenance preserve manual configs. Normalized payload equality avoids revisions on identical reloads. Stable command identities plus immutable revision lookup recover uncertain outcomes. New connections first get a recoverable credential-free draft because existing status registration requires a connection; the protection gate precedes that draft.
- Added narrow CredentialVault.findProtectedMatch returning only owned protected refs. It excludes revoked/session/other-owner credentials and reuses an orphan envelope after interruption. Old retained refs remain valid; clearing/removing file entries never revokes or deletes.
- Added secret-free ModelConfigStatus contract and blank editable example. Actual D:/movieAgent/config/models.json was never read or written.
- Added actual Electron fixture bundling production EngineHost/utility engine/importer/vault and using real safeStorage, with dummy-only loopback configuration and a zero-request network counter.

## TDD and executed verification

All commands ran in D:/movieAgent/libtv-studio with command-local `$env:PATH='D:/nodejs;' + $env:PATH`.

1. Initial missing-module run failed during collection and is recorded only as setup, not valid RED.
2. RED: `npm test -- tests/integration/model-config-file.test.ts` with explicit NOT_IMPLEMENTED stubs: 6 failed/6 (expected absent loader/import behavior).
3. Loader GREEN/import RED: same command: 2 passed/4 failed; import assertions failed with NOT_IMPLEMENTED after loader setup worked.
4. Initial GREEN: same command: 6 passed/6, exit 0.
5. Added targeted recovery/credential-exclusion assertions and exact size/count acceptance; affected tests passed 17/17.
6. Self-review RED: `npm test -- tests/integration/model-config-file.test.ts -t 'secrets pasted'`: 1 failed/8 skipped, expected rejection but got success for a quoted key in a public field. Fixed by comparing original and normalized field strings rather than serialized JSON.
7. Final GREEN: `npm test -- tests/integration/model-config-file.test.ts tests/integration/model-config.test.ts tests/integration/credential-vault.test.ts`: 18 passed, 3 files, exit 0, 4.46s. Existing Node experimental SQLite warning only.
8. Actual Electron: `npm run test:electron -- tests/electron/model-config-import.test.ts`: 1 passed/1, exit 0, 4.97s, no warnings. System protection true; initial/same imports succeed; interrupted bound-connection response returns failure; host/vault reopen and retry succeed; connection revisions [1,2,3], model/profile [1,2], two encrypted envelopes, both old/new key equality reads true, engine wire/database/vault plaintext checks false, pendingTasks=0, HTTP requests=0.
9. `npm run typecheck`: final exit 0, no diagnostics. First run found test-only Uint8Array versus Buffer return typing; fixed explicit Buffer construction. A subsequent and final run both passed.
10. `git diff --check`: exit 0, only existing LF/CRLF notices.

Broad suite/package intentionally left to Task 3 per explicit controller scope; no real APIs or paid calls performed.

## Files

- apps/desktop/src/main/model-config-file.ts (new)
- apps/desktop/src/main/model-config-import.ts (new)
- apps/desktop/src/main/credential-vault.ts (narrow lookup)
- packages/contracts/src/desktop.ts (status type)
- configs/models.example.json (new, blank)
- tests/integration/model-config-file.test.ts (new)
- tests/electron/model-config-import.test.ts (new)
- tests/electron/fixtures/model-config-import-harness.ts (new fixture needed for real Electron utility-process path)
- docs/verification/directory-projects.md (append-only Task 2 evidence/handoff)
- This report is in the existing ignored .superpowers workspace and remains local.

## Self-review

Reviewed loader, importer, vault diff, test fixture and current Git changes. Resolved the escaped-public-field credential bug with RED/GREEN evidence above. No main business SQL, direct provider invocation, HTTP probe or renderer capability was added. All configured providers validate before mutations; OS protection failure occurs before draft creation. Every file-owned ID collision is checked before writes. Only controlled error constants are returned from arbitrary engine/filesystem failures. Retry preserves useful intermediate state and old credentials, including a vault save interrupted before registration. Blank files do not require protection and do not delete manually configured items.

No unresolved correctness concern. Import is deliberately resumable across multiple normal commands, not an all-provider atomic SQL transaction. The configured state does not assert authentication or service compatibility. The only working-tree change outside this task is the controller's plan-checkbox update plus pre-existing untracked research/prototypes; those are not staged by this task.

## Task 3 integration handoff

`loadModelConfig(path): Promise<Result<LocalModelConfig>>` is main-private and contains secrets; never return it or log it. `importModelConfig({host,vault,config}): Promise<Result<ModelConfigStatus>>` accepts existing EngineHost structurally (identity/query/execute/credentialStatuses/updateCredentialStatus). Status fields: source, providerIds, state (`ready|unconfigured|error`), errorCode (null on success). Importer returns failed Result on failure; Task 3 can produce UI error status from trusted path, empty IDs, returned fixed code. `ready` means file configured/imported only.

Keep source path main-owned and passed from launcher, never from a project manifest. Before vault opening, obtain all retained refs from host.credentialStatuses and supply them to CredentialVault.open; preserve existing per-reference synchronization for task recovery. For ordinary startup, import before enabling provider/replay if that is the existing controlled ordering. For `--live-image-check-library`, the owner-held idle/outbox admission check MUST remain before any vault opening/provider startup/replay. This task deliberately does not modify startup or admission.

Stable IDs are file-<id>-connection/model/profile. An interrupted credential-free draft may remain until the next reload, and is recovered via its normal initial receipt. Old refs remain untouched. T3 owns renderer validators/IPC handlers, reload/status UI, no-overwrite actual config/script delivery, broad frozen-source checks, and packaged visible launcher verification.

## Review fix round 1

Commit: 450fdf6 — fix: stabilize imported model endpoint normalization. `git diff --cached --check` passed before commit.

Confirmed Important P2 on base 19c4126: repeated trailing slashes lost one slash per shared parser pass, so unchanged reload comparisons differed from persisted command results. Narrow fix in model-config-file.ts strips every remaining trailing slash after existing security validation; no shared parser/network-policy changes. New real-engine regression imports the same loaded `https://images.example/v1/////` config four times, asserting complete connection/model/profile snapshots and vault filenames remain identical after the first import.

- RED: `$env:PATH='D:/nodejs;' + $env:PATH; npm test -- tests/integration/model-config-file.test.ts -t 'trailing-slash endpoints'` → exit 1, `Tests 1 failed | 9 skipped (10)`; actual connection revision 3 appeared and snapshotSeq rose 5→8.
- GREEN: `$env:PATH='D:/nodejs;' + $env:PATH; npm test -- tests/integration/model-config-file.test.ts` → exit 0, `Test Files 1 passed (1)`, `Tests 10 passed (10)`, duration 4.30s. Existing SQLite experimental warning only.
- `$env:PATH='D:/nodejs;' + $env:PATH; npm run typecheck` → exit 0, no diagnostics.
- Unaffected Electron/full suites intentionally not rerun. Controller plan-checkbox edit remains unstaged.
