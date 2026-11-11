### Spec Compliance

- ❌ Issues found: identical accepted configurations can create new immutable revisions on every reload. The comparison in `apps/desktop/src/main/model-config-import.ts:53` compares a once-parsed desired connection against a connection that the engine parses again; multiple trailing URL slashes expose the mismatch. See Important finding below.
- ✅ The remaining Task 2 requirements are represented: whole-file validation and fixed errors (`apps/desktop/src/main/model-config-file.ts:17`, `:47`, `:57`); protected-vault gating and upfront collision checks (`apps/desktop/src/main/model-config-import.ts:43`, `:65`); immutable normal commands and resumable receipts (`:52`, `:72`); blank entries without mutations (`:42`); blank example (`configs/models.example.json:1`); secret-free status contract (`packages/contracts/src/desktop.ts:12`); real Electron fixture (`tests/electron/model-config-import.test.ts:11`).
- ⚠️ Cannot verify from this diff: production startup retained-reference collection, import/provider/replay ordering, live-check admission ordering, IPC status validation, reload UI, real no-overwrite configuration/script delivery, and packaged launcher behavior belong to Task 3. The fixture exercises retained references, but production integration remains unverified (`tests/electron/fixtures/model-config-import-harness.ts:25`; `docs/verification/directory-projects.md:57`).

### Strengths

- Secret-bearing types remain main-private; engine payloads contain credential references, errors use fixed messages, and checks include cross-entry public-field leakage (`apps/desktop/src/main/model-config-file.ts:6`, `:40`; `apps/desktop/src/main/model-config-import.ts:108`).
- Collision provenance is checked for all active connection/model/profile IDs before writes, rather than treating an ID prefix as ownership (`apps/desktop/src/main/model-config-import.ts:65–75`).
- Protected matching excludes revoked, session-only, and foreign-owner envelopes, and uses the existing guarded secret-access method; old envelopes are not revoked during import (`apps/desktop/src/main/credential-vault.ts:92–99`; `tests/integration/model-config-file.test.ts:132`).
- Tests exercise real temporary engines and actual Electron safeStorage/utility-host recovery, including lost responses, preserved old credentials, plaintext absence, and zero loopback requests (`tests/integration/model-config-file.test.ts:103`; `tests/electron/model-config-import.test.ts:11–24`).

### Issues

#### Critical (Must Fix)

- None found.

#### Important (Should Fix)

- **P2 — Repeated import is not idempotent for accepted endpoints with multiple trailing slashes.** `apps/desktop/src/main/model-config-import.ts:53` and `:96–97` compare the result of local `parseSaveConnection` with stored data, but the normal engine command parses that payload once more. The existing endpoint parser removes one trailing slash per call (`packages/contracts/src/models.ts:57`), so the compared payload differs from the persisted payload. A focused real temporary-library probe using `https://images.example/v1/////`, one dummy key, and the *same loaded config object* produced: first import success with connection revisions `[1,2]`, model/profile counts `1/1`; second import success with `[1,2,3]`, counts `2/2`; third import success with `[1,2,3,4]`, counts `3/3`. Every stored connection URL was the identical `https://images.example/v1/`. This directly violates the unchanged-config no-new-revisions requirement and grows all three revision chains on every reload. Make endpoint normalization/comparison stable across loader, importer, and normal command parsing, or reject unsupported repeated trailing separators before mutations; add a focused regression asserting repeated imports preserve revisions. No broader URL/network-policy redesign is required.

#### Minor (Nice to Have)

- Reported verification output is not pristine: the final affected integration run retained the existing Node SQLite experimental warning (`docs/verification/directory-projects.md:50`). This is pre-existing runtime noise, not a new importer defect; document or narrowly handle it in the test harness without suppressing unrelated warnings.

### Checks and Scope

- Reviewed the supplied `6029fd6..19c4126` diff once. The tool truncated its middle; retrieved only the missing importer continuation and example/docs/contracts/fixture section. No source edits or git-state operations were performed.
- Named risk — late command-parser rejection or normalization mismatch after upfront validation: inspected the existing model parsers and their command mapping (`packages/contracts/src/models.ts:1–88`; `packages/contracts/src/commands.ts:37`), plus the existing model service's persistence/credential authorization (`packages/engine/src/model-config-service.ts:35–78`). Field constraints otherwise align; the normalization mismatch above was confirmed.
- Named risk — orphan encrypted envelopes and retained credential versions after reopen: the vault diff cut off the existing access method, so inspected its continuation and existing open/status/put methods (`apps/desktop/src/main/credential-vault.ts:15–88`). Existing open loads protected orphan envelopes, retained refs set version floors, and guarded access rejects revoked/unavailable entries.
- Ran only the focused new idempotence probe described above, using Node transform-types, real engine/importer/vault, a disposable temporary directory, dummy secret, and no network. Exit 0; temporary files removed after resolving/checking their absolute location. Probe emitted Node transform-types, module-type, and SQLite warnings. Did not rerun the implementer's suites, Electron fixture, or typecheck; their reported results remain evidence from the implementer.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The implementation has a narrow secret boundary and sensible receipt/vault recovery structure, but an accepted unchanged configuration demonstrably appends revisions on each reload. Fix and regression-test that idempotence path before accepting Task 2; startup/UI checks remain assigned to Task 3.
