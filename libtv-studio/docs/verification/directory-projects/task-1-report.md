# Task 1 report — directory project template and registry

Status: DONE; focused and affected verification passed; ready for controller review. Commit: 6029fd6 — feat: add directory project templates and recent registry. Exact 12-file commit; post-commit git status contains only the original unrelated untracked research/prototypes/specs.

## Implementation

- Added strict shared ProjectManifest/DirectoryProject/binding/recent types and validators. Fixed format/schema/template versions, lowercase UUID workspace identity, safe Windows-compatible names, exact allowed fields, valid ISO creation time, null-or-fixed binding. Manifest reads are UTF-8/BOM aware and bounded to 64 KiB even if the file grows while read.
- Added createDirectoryProject({mode,directory,name}), inspectDirectoryProject(root), bindDirectoryProject(root,binding), returning Result errors without filesystem exception details or user file values. New mode makes exactly one absent child under the selected parent; existing mode uses the selected root itself. Inspect is read-only.
- Added non-overwriting bundled TypeScript template and editable outline/episode/storyboard examples. Runtime does not use cwd, raw resource copying, or a developer path. Template source has all required empty directories; documents contain only editable titles / versioned empty shots.
- Validate reserved path ancestors with lstat, refusing junctions/symlinks/file-versus-directory conflicts before template writes. This includes fixed engine objects/previews/temp/exports/backups/logs directories, library/guard SQLite files and journal/WAL/SHM sidecars, and engine.lock, without traversing contents. Root canonicalization uses realpath; comparison is case-insensitive on Windows. Local absolute paths only; UNC/device/relative paths refused. Existing source bytes and manifest identity remain intact.
- Initial manifest and missing template file publication use fsynced sibling temps and exclusive hard-link publication; binding/index replacement uses fsynced sibling temps plus rename. Each operation cleans only its own temporary file. No user root is recursively deleted. Existing directories and files are retained on interruption/error. A published initial identity survives missing template items and repeated initialization.
- Binding compares workspaceId, is immutable once set, is idempotent for equal IDs, and requires existing ordinary .movieagent/library/library.sqlite. It opens no database and cannot establish actual engine library/project identity; that belongs to T3 under engine/profile ownership.
- Added RecentProjects.open/list/remember. Registry contains only workspaceId/name/root/pathCanonical/lastOpenedAt, validates/reloads each read/write, serializes within main, writes atomically, refuses copied identity while old root exists, and permits relocation only on old-root ENOENT. Forged caller manifests are re-inspected.
- Per controller clarification: registry retains up to 10,000 identity records / 4 MiB and list shows latest 50. Older identities are never evicted automatically. Capacity errors preserve original index bytes.

## TDD evidence and verification

All commands ran in D:/movieAgent/libtv-studio with command-local PATH prefix D:/nodejs;C:/Windows/System32/WindowsPowerShell/v1.0; the pre-existing checkout is codex/desktop-foundation, base 2c3a67d. No extra worktree, dependencies, API calls, real credentials, user library, D:/rea, or actual config/projects were used.

1. Wrote the real-filesystem test file before production implementation. The first import run failed because the new modules did not exist; treated as setup error. Added explicit NOT_IMPLEMENTED API stubs, then ran:

   npm test -- tests/integration/directory-projects.test.ts

   Accepted RED output: Test Files 1 failed (1); Tests 31 failed (31). Representative errors were NOT_IMPLEMENTED and expected INVALID_PROJECT_NAME versus received NOT_IMPLEMENTED. These failures were the intentionally missing behavior, not import errors.

2. Implemented from tests. First implementation run: 24 passed / 7 failed with INVALID_PROJECT_MANIFEST; self-corrected an incorrect allowed-key count (the specified manifest has seven fields). Initial GREEN: Test Files 1 passed (1); Tests 31 passed (31), exit 0.

3. Added self-review cases for casing, malformed/extra-field schemas, file-path junctions, simultaneous initialization, separate registry instances, capacity, and invalid oversized index. RED: Tests 3 failed | 34 passed (37): uppercase workspace UUID acceptance, record eviction at capacity, and a Windows fixture EPERM trying to create a file symlink. The first two exposed missing behavior. Changed the fixture to real junctions at reserved manifest/database paths because file symlinks require unavailable Windows privilege; no privilege escalation or skip was introduced. Rejected uppercase UUIDs and stopped identity eviction.

4. Controller refined capacity to 10,000 identities/4 MiB with visible latest 50. Added a real copied-project case with original identity hidden after 50 newer entries; it still rejects DUPLICATE_WORKSPACE and preserves 51 records. Updated focused GREEN: 38 passed (38), exit 0 (4.86s).

5. After controller authorized fixed known engine descendant preflight, added 15 real-filesystem junction/type collision cases before production changes. RED command: npm test -- tests/integration/directory-projects.test.ts -t 'engine path'. Output: Tests 15 failed | 38 skipped (53); expected PROJECT_PATH_CONFLICT versus received success. Added fixed descendant checks via the same reserved-ancestor boundary. No SQL or material traversal was added.

6. Final affected regression command:

   npm test -- tests/integration/directory-projects.test.ts tests/integration/project-reopen.test.ts tests/integration/engine-lifecycle.test.ts

   Final output: Test Files 3 passed (3); Tests 66 passed (66); Duration 11.44s; exit 0. Directory tests account for 53 of these. Existing SQLite tests emitted Node's standard ExperimentalWarning for node:sqlite. The directory-only run emitted no warnings.

7. Final npm run typecheck after fixed descendant checks: exit 0, no diagnostics. git diff --check: exit 0; only Git's LF-to-CRLF conversion notice. The controller explicitly scoped this task to focused/affected verification and owns the final frozen-source full suite and packaged app validation; no repeated broad suite was run here.

Coverage checks Chinese/spaced paths, empty templates/no business DB, byte/hash preservation, readonly inspection, occupied new path refusal, unsafe names/paths, malformed/future/extra-field/bounded manifests, junction/type collisions, missing bound database, stable identity after interruption, repeated/concurrent initialization, immutable/idempotent binding, registry reopen/atomic writes/orphan temp tolerance, caller revalidation, missing/invalid availability, Windows case aliases, copied-project refusal, old-root-missing relocation, 10,000-record limit, 4 MiB limit, and hidden identity retention.

## Shared interfaces and T3 handoff

Imports: types/validators from packages/contracts/src/directory-projects.ts (also contracts index); directory APIs from apps/desktop/src/main/project-directories.ts; RecentProjects from recent-projects.ts.

- createDirectoryProject(input: CreateDirectoryProjectInput): Promise<Result<DirectoryProject>>.
- inspectDirectoryProject(root: string): Promise<Result<DirectoryProject>>.
- bindDirectoryProject(root: string, {workspaceId,libraryId,projectId}): Promise<Result<DirectoryProject>>.
- DirectoryProject = {root,manifest,libraryRoot}; libraryRoot always root/.movieagent/library.
- RecentProjects.open(path: string): Promise<Result<RecentProjects>>; open/list do not create state.
- list(): Promise<Result<RecentProjectStatus[]>>; availability is available|missing|invalid; max 50 visible rows.
- remember(project: DirectoryProject): Promise<Result<RecentProject>>; a duplicate-existing-root check covers ALL retained identities, including hidden entries.
- canonicalPath/isLocalAbsolutePath helper exports are available for main-only launcher normalization if needed. No IPC routes were added in T1.

T3: only the global launcher writes registry. Project workspace processes read/verify; no multi-process JSON writer guarantee is claimed. Route normal CLI/project opens through launcher registration so duplicate checks happen before engine scheduling. Enforce launcher singleton and per-workspace profile/library guards. Main-process serialization covers concurrent calls/instances within that writer.

T3: an unbound valid manifest is structurally inspectable even if template filling was interrupted; call existing-mode create with the manifest name if missing documents should be filled. Use stable bootstrap commandId so a crash after DB commit/before bind does not create another project. Verify bound libraryId/projectId against actual engine results under ownership before starting normal work; T1 only checks DB existence and never opens SQL.

T3 boundary concern was resolved per controller authorization by expanding T1 reserved preflight to fixed engine-managed descendants. inspectDirectoryProject, createDirectoryProject and bindDirectoryProject now all reject static links/type collisions there. T3 must repeat inspectDirectoryProject immediately before actual engine opening and retain its engine/profile ownership guards and DB identity checks. This is static fixed-path preflight, not a claim of race-proof isolation against another OS process actively replacing paths between validation and open. No existing storage source was modified.

Initial exclusive hard-link publication is intentionally fail-closed on local filesystems without hard-link support; no fallback writes a partially initialized final manifest. Packaged runtime automatically bundles drama-template.ts once T3 imports these APIs. T3 owns packaged launcher/UI/IPC/config/engine startup and profile isolation.

## Files changed

- packages/contracts/src/directory-projects.ts (new), index.ts (export).
- apps/desktop/src/main/project-directories.ts, recent-projects.ts, drama-template.ts (new).
- templates/drama-project/README.md, scripts/outline.md, scripts/episodes/episode-001.md, storyboards/episode-001.json (new).
- tests/integration/directory-projects.test.ts (new).
- docs/verification/directory-projects.md (new).
- docs/superpowers/specs/2026-10-25-directory-projects-design.md (recent index retention/display/single-writer supplement per controller).
- This ignored report in the current plan workspace (not staged).

## Self-review

Reviewed implementation/test/schema/template/index interfaces against the brief/spec. Corrected the seven-field schema count, uppercase UUID ambiguity on Windows, and eviction weakening copy detection. Replaced a privileged test-only file symlink with junction fixtures; all junction tests ran successfully. Confirmed no engine/SQL/provider/vault imports, no filesystem content or exception interpolation in errors, no recursive production deletion, no raw cwd template lookup, no secrets in registry/manifest schema, and no unrelated changes. Original untracked research/prototypes remain untouched. Exact file staging only is required for commit.
