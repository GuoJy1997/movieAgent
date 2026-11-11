# Text model onboarding implementation

**Spec:** docs/superpowers/specs/2026-10-26-text-model-onboarding.md
**Goal:** Add verified OpenAI/Anthropic text configuration and real Anthropic text execution.
**Architecture:** Existing protected Electron configuration window, main-owned credential access and pinned HTTP transport; shared text protocol encoding/parsing; no generic renderer HTTP API.

## Global constraints
- Work in D:/movieAgent/libtv-studio on existing codex/desktop-foundation; base 1c02e2da76f4c490b9712443dc15f26401e027e1. Preserve unrelated files and config/models.json. Never touch D:/rea, issue live API calls, broadly kill processes, or modify the existing running package.
- Node D:/nodejs/node.exe. Use local fixtures and explicit --model-config for every Electron test. New package output apps/desktop/release-text-models. Keep tests focused; one core-suite run after changes settle, no canvas visual work.
- No nested subagents. Commit only exact task files. Report real test evidence, not inferred success.

### Task 1: Implement verified text onboarding end to end

**Files:** contracts models/model-config-file, domain/model-config, providers openai-chat/http-transport plus focused new text-protocol/anthropic adapter helpers, engine bootstrap/adapter registration, desktop main provider-capability/model-config-editor and a focused onboarding service, preload/model-config, model-config HTML/form/styles, affected renderer adapter labels, package verifier, relevant unit/integration/Electron tests. Avoid unrelated refactors.

**Interfaces:** Keep existing public store read/save contract. Extend only the protected window bridge with listModels and test methods. Their payloads carry expectedVersion and the draft. Submit also carries an opaque test receipt checked against a main-owned fingerprint. Do not persist receipts or secrets in renderer state beyond the existing password input. No new generic utility-process route is needed: provider.text can dispatch by adapter type.

1. Read the spec and current code. Add failing tests for Anthropic production request/output and onboarding gating (unverified save, changed key/model/protocol/params, stale completion, retained key, conflict, removal/clear exception). Add real local HTTP fixture coverage for list failures/manual fallback, both protocols/auth/paths and wrong-key/invalid-body/redirect/timeouts; no raw secret/error leaks.
2. Add anthropic-messages-v1 throughout adapter contracts, strict config parsing/defaults, registry and text materialization. Share request-body encoding and text extraction with probes. Add optional max_completion_tokens as an alternative to existing max_tokens for OpenAI, exactly one selected; persist choice through import/profile execution. Preserve old max_tokens files.
3. Implement bounded list/test service in main using pinned transport and existing endpoint/secret rules. Resolve retained secrets only against expected config revision. Generate expiring window-local receipts (10 minutes), fingerprint all effective relevant settings and revision; check again at submission. Reject missing/replayed/wrong draft receipts. Cancellation prevents stale success. Error messages are bounded and sanitized.
4. Update protected form: text protocol selector, fetch list and selection, manual ID, test button/progress/result, disabled save until matching success. Editing relevant values invalidates result. Provide clear unsupported-list/manual entry copy and precise failures. Keep image/video save behavior. Update allowed preload methods in package verifier.
5. Run focused tests while implementing, then npm run typecheck and npm test once. Build and package into release-text-models; verify package. Run focused packaged onboarding/model-config regression tests with fixture-only configs. Test direct IPC bypass and wrong sender/frame if feasible. Preserve prior runtime. Do not repeatedly test unchanged canvas flows.
6. Self-review, exact git add/commit, report changes, commands/results, limitations and package path to assigned report. Controller performs one independent review of the complete change, scoped fixes if needed, then updates the launcher.

## Review focus
- UI-only gating bypass or retained secret/config revision mismatch.
- Probe supports Anthropic but production adapter/materialization does not.
- URL prefix/auth handling and secrets leaked through upstream errors/list data.
- OpenAI token parameter selected in test differs from saved execution.
- Late response or close unlocks stale draft; explicit removal accidentally blocked.
