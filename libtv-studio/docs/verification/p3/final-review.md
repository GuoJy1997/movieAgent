# P3 whole-feature final review — local delivery

Reviewed 2026-10-27. Base `ec0813b`; reviewed HEAD `d4551a6011b18cef622aca671d0a4156145698f1`. Authority: `docs/superpowers/specs/2026-10-26-p3-creation-agent-design.md`, implementation plan, active ledger and delivery decisions. Review uses the supplied saved diff, current source, task reports/appendices, relevant test source, recorded logs/package evidence, and existing screenshots. It was performed in passes: persistence/contracts, Agent authority and recovery, shot/workflow integration, desktop/export, then evidence and remaining minor triage.

Source, index, HEAD and branch remained unchanged. No tests, GUI sessions, package commands, provider requests or user-data operations were run. This report is the sole review output written. Read-only HEAD/status confirmed the requested commit and no tracked working-tree changes before report publication.

## Strengths

- Content writes validate the entire proposed final state before writing and join the router's event/receipt transaction. Independent content and output-selection revisions correctly separate edits from late production results. Fixed entity revisions remain fixed; production snapshots additionally freeze the full parent script and used scene, avoiding invented historical context.
- Agent authority stays bounded: complete-document JSON parsing, explicitly captured aliases, engine-owned deterministic new identities, template action restrictions, immutable preparation, matching approval owner/run/hash, expiry, one canonical adoption subset and atomic adoption receipts. Generic generation approval cannot bypass Agent admission. Adopting text content does not grant media spending authority.
- Production reuses P2 workflow execution and approval. Exact node sets, owner/run identity and one-to-one workflow attachment are checked, bound content/input edges cannot be edited through generic canvas commands, and standalone bound-node generation is refused. The collector stores each task output once and applies independent selection CAS; intervening manual selections and changed shots leave late outputs in history.
- Lifecycle integration starts local harvesting without replanning, pauses it for maintenance and closes it during quiesce. The previously identified unreadable-artifact isolation and production diagnostics have concrete recovery coverage. The additive schema14 migration correctly supports both original schema13 and the intermediate diagnostics-table shape, while schema10 migration preserves populated task/config/workflow records and original media hashes through the existing backup path.
- Export adds a narrow main-process capability with canonical engine reads, exact historical entity lookup, validated identity/version, fixed destination, exclusive creation and ordinary-directory/realpath checks. Renderer-supplied paths/content are not accepted. The host transport now selects validators by parsed query kind instead of retaining the obsolete P2-only response allowlist.
- Evidence is unusually explicit about limits. Recorded core results are 36 files/493 tests; recorded packaged UI/IPC results are 2 files/3 tests. The latter belongs to archive `8219ef2218d6eb10185d3272a892082dfe5390ca7c8582ff89fafa835f39f6ba`, not the reviewed fixed archive. Later output provenance/navigation/proposal-diff changes have focused evidence and build/package verification. The two inspected historical screenshots show usable overview and results layouts at the documented sizes; they do not verify the later proposal-diff UI.

## Issues

### Critical — 0

None found in the reviewed P3 paths.

### Important — 2

#### I1. Render persisted assistant messages for reply-only rounds

- **File:** `apps/desktop/src/renderer/features/agent/AgentWorkspace.tsx:59` (reply rendering at line 61; session-to-card mapping at line 18).
- **Problem:** The page renders `session.data.runs` but never renders `session.data.messages`. `AgentRunCard` obtains its answer only from `run.proposal?.draft` and puts the answer inside `{draft && ...}`. A valid `{ "schemaVersion": 1, "reply": "..." }` response is harvested as `REPLIED` with `proposal: null` (`packages/engine/src/agent-service.ts:315`), while its assistant text is stored separately in `agent_message` (line 361). Consequently, the normal conversation shows “已回复” and the user's request, but no assistant answer. The same omission affects a stopped late reply when it has no draft. Opening the original task is an indirect raw-artifact workaround, not the required conversation history.
- **Impact:** Ordinary questions/clarifications are an explicitly supported successful Agent outcome, yet their result is absent from the main interface, including after reopen. This is a cross-layer integration omission, not a provider-format issue.
- **Fix:** Associate persisted assistant messages with each run by `runId` and render their text independently of proposal existence. Keep the proposal display separate and avoid duplicating its reply. Preserve stopped/late status and ensure rendering or reopening never dispatches another request.
- **Focused validation:** Render a session containing a `REPLIED` run with `proposal: null` and an assistant message; assert the answer is visible. Cover a stopped late reply and a proposed round without duplicate answer text. Existing backend reply-only tests already establish the persisted shape; no paid call or full-suite repeat is needed.

#### I2. Acknowledge submitted drafts without discarding later edits

- **Files:** `apps/desktop/src/renderer/features/creation/CreationWorkspace.tsx:32` and `:36`; `apps/desktop/src/renderer/features/entities/EntityWorkspace.tsx:13`. The same response-clearing pattern occurs in `apps/desktop/src/renderer/features/agent/AgentWorkspace.tsx:18`.
- **Problem:** Entity/script/shot forms keep their inputs editable while awaiting `runtime.command(...)`, then unconditionally replace the current draft with the saved response (`setDraft(make(result))` / `setDraft(scriptDraft(...))`) and mark it saved. `runtime.command` also waits for query invalidation/refetch before returning (`apps/desktop/src/renderer/services/runtime.tsx:139`), so this window includes query latency. If the user clicks Save, continues typing, and then receives the acknowledgement, the newer unsaved text disappears. Agent preparation similarly clears `message` unconditionally after the await, erasing a next request typed during preparation. Explicitly switching editors/scripts during an outstanding save can also let its old `onSaved` callback reset the current parent selection.
- **Impact:** Ordinary continued typing can silently lose unsaved creative work and display a saved indicator for the wrong draft. The existing packaged draft check only edits after an acknowledged save and waits for passive refresh (`tests/electron/p3-creation.test.ts:27`); it does not exercise this acknowledgement race.
- **Fix:** Capture submitted draft/editor identity and a local edit generation. On acknowledgement, advance the saved baseline revision but preserve any subsequent edits and their dirty state; ignore navigation effects if the editor/selection has changed. Clear an Agent request only if the current request still matches the submitted one. Alternatively, consistently disable all editable controls and relevant selection/navigation for the save window, but disabling only the submit button is insufficient.
- **Focused validation:** Use a controlled/deferred command promise to save draft A, edit to B before resolving, and assert B survives with the correct new baseline and unsaved indication. Cover entity, script, shot and Agent request behavior, plus switching the active editor before the old acknowledgement. Test actual state/handler behavior, not only equality of a copied implementation helper.

### Minor — 2

#### M1. Align the creation-request input limit with the command contract

- **Files:** `apps/desktop/src/renderer/features/agent/AgentWorkspace.tsx:18`; `packages/contracts/src/agent.ts:205` and `:224`.
- The “创作需求” field permits 8000 characters, while both request parsing and the prepared-turn guard cap the user message at 4000. A 4001–8000-character request is accepted by the form but rejected with a generic `INVALID_INPUT` message, without identifying the length problem.
- Use the existing 4000-character bound in the form and expose it clearly, preferably sharing a contract constant. Increasing the backend limit would require reassessing the fixed prompt budget and is unnecessary for this local delivery.

#### M2. Remaining very long JSX lines hinder maintenance of stateful forms

- **Files:** `apps/desktop/src/renderer/features/creation/CreationWorkspace.tsx:28`, `:32`, `:36`; `apps/desktop/src/renderer/features/creation/ShotProductionPanel.tsx:27`; `apps/desktop/src/renderer/features/entities/EntityWorkspace.tsx:13`; `apps/desktop/src/renderer/features/agent/AgentWorkspace.tsx:18`.
- Several entire forms and their asynchronous handlers occupy one multi-thousand-character line. This makes identity, acknowledgement and disabled-state behavior harder to inspect and future changes harder to review. The extracted/formatted `AgentRunCard` and `ProposalDiff` are improvements, but do not address these remaining forms.
- Format the handlers/forms when applying the focused fixes; a broader component redesign is not required. This is the existing deferred minor, retained rather than promoted to a release blocker.

## Evidence assessment and recommendations

- I directly inspected the recorded final core and Electron log summaries and the fix1 package verifier JSON. The latter reports Electron45/ABI150/Node24.22.0, SQLite3.53.4, native sharp probe, four isolated preload allowlists and CSP entries. These are evidence supplied by the implementation run, not tests independently rerun by this reviewer.
- Current documented archive is `35bf7bdc0c73b920b646d3735d0e7eb6892e0afc07ea4c38bede181b0ef7c146`; installer is `9c6ef0d25451c992fbd9024bcd2be3815666db84da7254c0d90a20ed62691841`. Any final source repair supersedes those identities after rebuilding. The controller's independent hash and compiled-file/archive comparison remains the final artifact identity gate.
- Use the available grouped final fix wave for I1/I2. M1 is a small adjacent correction; M2 can stay explicitly deferred apart from touched code. Run only new affected renderer state/presentation checks, typecheck and necessary build/package verification. Nothing found here justifies repeating the unchanged 493-test suite or invoking real providers.
- Known Node SQLite experimental and builder duplicate-dependency/default-icon/unsigned warnings remain disclosed. They are not new P3 failures and do not warrant pretending that verification was warning-free.
- The previously deferred malicious unselected asset-alias assertion, production DTO guards and schema14 documentation filename have been addressed in the reviewed source/tests. They are not reopened as findings.

## Declined to judge

- Real Kimi long structured output quality, real image/reference-video results and actual billing: explicitly excluded from development authorization; only local HTTP fixtures were used, and prior text connectivity is not equivalent evidence.
- Native tool_calls, streaming, recursive autonomous planning and automatic retry: explicitly excluded by the accepted bounded one-request-per-turn design.
- Audio/TTS, subtitles, timeline, MP4 assembly/export and remote execution: later phases, not claimed as P3 functionality.
- In-place migration of the user's actual schema10 library and compatibility of that migrated library with an older binary: no live-library access is authorized; this review assesses additive migrations and temporary populated-fixture evidence, not an actual user upgrade or downgrade.
- Signed/public distribution, clean-machine installer acceptance and cross-platform support: this gate is for an unsigned local Windows delivery and does not establish those properties.
- Exhaustive backup/restore and unrelated older P2 subsystem behavior: outside this final P3 review unless a concrete P3 integration risk appears; the reviewed migration/maintenance hooks and affected regression evidence do not justify a general P2 audit.
- Renderer navigation after an intentional page change discards that page's unsaved local draft: no cross-page draft persistence was promised in this phase; this is distinct from I2's silent loss while continuing to edit during an acknowledged save.
- Resistance to a separate malicious local process racing directory replacement between export path checks and file creation: renderer/path/junction/overwrite boundaries were reviewed, but adversarial concurrent operating-system filesystem mutation is not established by this personal local-app test scope.
- Exact final-archive GUI behavior, launcher switchover and final compiled-file/hash identity: historical GUI evidence is explicitly tied to its tested archive; controller owns final identity recheck and launcher delivery after the review gate. No additional GUI run was performed or silently inferred.

## Assessment

**Ready for local delivery: No — fix I1 and I2 first.**

The persistence, authority, migration and media-production architecture is coherent and supported by meaningful fixture evidence. Two normal desktop interactions still violate the promised conversation/draft experience: successful reply-only answers are hidden, and late save acknowledgements can discard newer user input. Both are bounded renderer fixes suitable for the single grouped final fix wave; the two Minor items do not independently block local delivery. No merge, push or PR is requested or assessed.
