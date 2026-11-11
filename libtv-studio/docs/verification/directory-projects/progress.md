# SDD ledger — plan: docs/superpowers/plans/2026-10-25-directory-projects.md

User request: run locally, editable baseURL/apiKey config, one drama per directory, new/from-existing/open/recent projects, built-in project structure. LibTV backend layout unknown; do not claim verified reverse engineering. Prior P1 local batch closed; do not reopen its tasks or cleanup-denied paths.
Base before this plan: a990330 (prior source7e22800 verified178integration/36Electron, subsequent docs-only). Current repo D:/movieAgent/libtv-studio, codex/desktop-foundation, no remote integration. Preserve unrelated untracked research/prototypes; no D:/rea or revoked unrelated AGENTS. New plan owns only this SDD directory.
Ruling: continue in the user's explicitly selected existing project on its dedicated codex branch without an extra worktree, preserving prior in-place preference; execute sequentially with no concurrent source editors — cost if wrong: later simultaneous work requires isolation. User has directly requested these implementation outcomes; routine directory/launcher choices are documented as implementation choices, not a new approval claim.

Builder check /root/directory_builder_check: no important unanswered question; no user clarification required. Design and plan document the directory template, independent engine processes, config confidentiality and existing-library compatibility. RealAPI still deferred; only dummy fixtures/network isolation in tests.

## Preflight table
| Pair/task | Producer/consumer or self-check | Result |
| T1/T2 | Distinct directory/registry vs config/vault modules, append sameverification sequentially | No contract conflict |
| T1/T3 | DirectoryProject/root/manifest/binding, registry used by native launcher and workspace bootstrap | T1 no business SQL; T3 binds only under owned engine; ready missingDB refuses |
| T2/T3 | load/import public sanitizedstatus, main vault+host commands | Import beforeprovideractivation, live-check admission preserved, blank config usable |
| T1 | Template tests vs nonoverwrite/canonicalpath/read-only inspect | Covers collisions,links,versions,copy/move |
| T2 | Strictschema+idempotentversionedimport vs secretboundaries | Dummykeys, noHTTP, no mainSQL; unavailableprotection failvisible |
| T3 | Launcher/processroute+legacy modes vsactual package tests | Defaultnoengine; explicitlegacy retained; isolatedprofiles andoldP1regression |

Tasks pending: 1,2,3. Tasklevel review required aftereach, finalwholebranchreview afterward; workers no subagents, controller no sourcefixes. Before any repair read skill fix-loop. Finalartifact mustinclude allsourcechanges; actualD:/config onlycreateifabsent atdelivery. Do not retry previouslyblocked deletions.

Task1 active /root/directory_task1 (gpt-6.1-sol high), BASE2c3a67ded9ee75ce36d626e8fe7c5d1c09abeedb. Directorycore/registry/templates; no actualuserfolder changes yet. T1 report pending; continue sequential T1review,T2config,T3launcher/localrun thenfinalreview. Task1 may bundletemplatesinTS while keepingeditable examples, mustnotcwddependent.

Ruling: recent UI lists 50 entries while registry retains up to 10000 identities in 4MiB, rejecting overflow rather than evicting identities — preserves copy-conflict protection without imposing 50-project lifetime limit — cost if wrong: unusually large registries need a later storage migration.
Ruling: global launcher is sole registry writer; project workbenches read/validate only, normal CLI project opens register through launcher — avoids cross-profile JSON lost updates — cost if wrong: routing must reject unsupported bypasses rather than mutate registry from children.
Ruling: Task1 extends preflight to fixed known engine files/directories before library startup; Task3 repeats inspection near engine open and validates business identity under ownership — static reserved-path junctions must not receive engine writes — cost if wrong: future engine paths require corresponding validation maintenance.

Task1 implemented commit6029fd6; 66/66 affected tests, typecheck passed per report. Fresh reviewer /root/directory_t1_review (astra high) active against2c3a67d..6029fd6. Gate pending; no task2 implementation dispatched yet.

Task 1: complete (commits 2c3a67d..6029fd6, review clean). Reviewer /root/directory_t1_review approved spec and quality; minor existing tool warnings disclosed. Cross-task unverifiable items map explicitly to Task3 acceptance and carry forward: ownership/DB binding/stable replay/launcher sole writer/IPC/package. Task2 BASE6029fd6.

Task2 active /root/directory_task2 (astra high), BASE6029fd6. Task2 config import only; Task3 integration/full frozen suite/package/visible launcher remain.

Task2 integration ruling: existing credential sync needs connection first; validated/protection-available file-owned draft connection may precede vault status then bound immutable connection/model/profile. Retry reuses same owner's protected nonrevoked vault reference via main-only comparison; no plaintext returned or logged. Deterministic receipts prove importer ownership; manual-ID collisions refuse. Full input validation and protection preflight precede mutations.

Task2 implemented19c4126; 18/18 affected integration +1/1 real Electron fixture, typecheck. Fresh reviewer /root/directory_t2_review (astra high) active6029fd6..19c4126, gate pending. T3 not dispatched.

Task2 review: spec fail/quality needs fixes, confirmed P2 repeated trailing slashes causes revision growth. Round1/5 dispatched original /root/directory_task2; FIX_BASE19c4126. Reviewer reproduction no real network. Task1/2 existing SQLite warning minor deferred to final review; no local suppression. Task3 startup/UI/IPC ordering checks are explicit downstream requirements.

Task 2: fix round 1/5 (1 addressed, 0 open — trailing-slash import idempotence; commits 19c4126..450fdf6). Scoped reviewer /root/directory_t2_fix_review clean. Task 2: complete (commits 6029fd6..450fdf6, review clean). Cross-task checks explicitly carried to Task3 handoff. Task3 BASE450fdf6.

Task3 active /root/directory_task3 (astra high), BASE450fdf6. Main/launcher integration, broad freeze verification/package and actual visible local delivery outstanding. User last question about LibTV internals answered: UI/function analysis only, backend layout unverified; local structure is our own requirements-driven design.

Controller docs-only: added evidence boundary to spec in response to latest user question; LibTV research does not establish server directories. Plan T1/T2 checked; both docs remain controller-owned pending commit. Task3 implementation continues.

Task3 implementation DONE e0357da/dfb9217; actual local launcher PID24232 retained. Report 243integration/40Electron/package verified; test-only screenshot output repair2targeted pass. Controller verified PID title/handle and actual config245bytes/cmd195bytes/exe presence; viewed launcher/workbench screenshots. Task3 review pending.

Task 3: complete (commits 450fdf6..dfb9217, review clean). Reviewer /root/directory_t3_review approvedspec/quality. Minor(deferred): App.tsx folder/launcher actions discard Result errors; finalreview triage. Existing tool warnings disclosed. Cannot-verify crosschecks: report contains exactfullsuite commands/results, controller inspected actual screenshots/process/files; current SHA check confirms packaged product. No cross-task implementation remains unverified by assigned integration reports. All3taskgatescomplete; final whole-plan review next.

Final whole-current-plan review active /root/directory_final_review (astra high), BASEa990330 HEAD6bf6ce8, fullpackage275763bytes. EarlierP1closed separately. Final fix wave not used. Controller docs/archive commits5f7681a/6bf6ce8; source/packageunchanged. Final launch PID24232 still retained; no actualkeyread.
Final whole-plan review /root/directory_final_review: ready Yes, zero Critical/Important. No final fix wave needed. P3 App folder/launcher failed action feedback deferred explicitly; does not affect successful actions/data. Existing SQLite/toolchain warnings remain disclosed.
Declined-to-judge dispositions: real provider/billing deferred per user; installer/otherOS/protected-key portability outside this Windows local batch; LibTV internals unverified and Agent/video/timeline/export outside current work; old P1 not reopened except integrated lifecycle surfaces and regression evidence; actively hostile concurrent OS path replacement outside static preflight/owned-engine boundary. No hidden claim of coverage for these cases.
Task2 draft-import decision cost if wrong: interruption can leave a recoverable draft until the next reload; manual file-owned ID collisions refuse instead of overwriting. Source and retained old credentials remain intact.
All tasks and final review complete. Local source stays codex/desktop-foundation per user's local-work preference, no integration action requested. Product package remains e0357da, later changes tests/docs only. Controller will archive final ledger and attempt only this plan's owned scratch cleanup after absolute-path verification; never old blocked workspace.
Cleanup outcome: automatic approval review rejected the guarded removal of this plan's temporary coordination directory with only "blocked by policy". No retry or alternative deletion was attempted. Directory retained; durable reports/screenshots/decisions are already committed. This does not block local use. Prior closed plan's cleanup-denied paths remain untouched.
