# SDD ledger — plan: docs/superpowers/plans/2026-10-25-minimax-video-workflow.md

Status: CLOSED. Spec: docs/superpowers/specs/2026-10-25-minimax-video-workflow-design.md
Base: ef7a6a9d609352ff0da8bde5e8a823d035a7174c. Branch: codex/desktop-foundation.
User authorization: “ok，那你接通吧” after proposed video UI/task/persistence integration and one real UI validation.

## Preflight

| Tasks | Shared interface / internal consistency | Finding |
|---|---|---|
| 1 → 2 | Video model/pricing/config types, task adapter selection, asset mime/app-media | Task 1 defines backward-compatible interfaces; Task 2 consumes report. Minimal renderer narrowing allowed in 1, full UI belongs to 2. |
| 1 | Backend tests vs product, fixture MP4 vs packaged validation | Product must not depend on host ffmpeg; fixture creation and final decode may use available test tool. Consistent. |
| 2 | UI tests/package/live call versus one-submission cap | Local fixtures first; admission receipt before only live UI POST. On ambiguous acceptance continue query only. Consistent. |

Ruling: use existing dedicated branch and directory — user explicitly moved the product here and expects this runnable path — no separate checkout will be introduced.
Ruling: approved narrow scope supplies design approval — no new product choices need user input — expand only necessary implementation interfaces.
Ruling: explicit kind correction only after code supports it — existing user video config was mislabeled by original image template — preserve every credential/value.
Ruling: old denied SDD cleanup remains untouched; only this new workspace belongs to this plan.

## Tasks

- Task 1: pending; BASE ef7a6a9.
- Task 2: pending.
- Final review and delivery: pending.

Task 1 dispatched: /root/video_engine (gpt-6-astra high), BASE ef7a6a9. Controller owns reviews; no paid calls in Task 1.

Task 1 milestone: worker reports focused adapter/config 8/8, config-file 11/11, MP4 storage/reopen 2/2. Final tests and review pending. TaskView unchanged; media original MIME video/mp4, thumbnails generic PNG.
Task 1 implementation: cb91ad1; 266/266 integration tests and typecheck passed. Report DONE_WITH_CONCERNS: structural (not decoder) MP4 validation; UI/live acceptance belongs to Task 2. Recorded boundary, proceeded to review. Reviewer /root/video_engine_review, diff ef7a6a9..cb91ad1.
Controller extra read-only check: Node inspectMp4 on previous actual MiniMax sample (5,817,120 bytes) succeeded: video/mp4, 768x1344, video-track duration 4.458333333s. No API call. This confirms actual provider container compatibility; does not replace new in-app acceptance.

Task 1 review: Needs fixes (2 Important): bounded codec config validation, duplicate main-only credential scoping. Minor deferred: existing SQLite experimental warnings. Fix round 1/5 starts at cb91ad1, original worker /root/video_engine.

Ruling: validate supported self-contained avc1/H.264 codec configuration and reject other codec entries until validators exist — actual MiniMax output and fixture are H.264 — if the provider changes codec, collection will fail safely and need a new validator, not a new paid submission.
Task 1: fix round 1/5 (2 addressed, 0 open — AVC/header validation and shared credential scope; commits cb91ad1..85d6898), reviewer /root/video_engine_fix_review clean.
Task 1: complete (commits ef7a6a9..85d6898, review clean). Minor retained: known Node SQLite warning noise.
Task 2 BASE: 85d6898. Ready for sequential UI/delivery implementation.

Task 2 dispatched: /root/video_ui_delivery (gpt-6.1-sol high), BASE85d6898. One authorized minimal live UI generation only after local fixture/package checks; worker must persist admission and provider ID, no repeat POST. Controller handles task review/final review.

Task 2 milestone: worker reports actual packaged Electron fixture video approval->RUNNING->durable MP4->player/renewal/save/canvas/reopen, single POST; full integration285/285; package ABI/preload verification passed. Full Electron regression running. Live not started and current config not mutated yet.

Task2 before-live: final packaged video fixture GREEN13.37s, final-review regressions6/6, other33 tests passed in full run, package verification/typecheck passed. Fresh directory planned D:/movieAgent/projects/MovieAgent视频验收-20261026. User already authorized single minimal UI request; announced CNY1.60 estimate. Worker owns exclusive admission marker and durable provider ID; no resubmit.
LIVE ACCEPTED: normal UI button 批准并生成视频 clicked once; exclusive receipt live-ui-20261026/single-submission.json. App task eff971d4-4b99-4da1-b225-d08a3ee55422; provider task456268409471408; RUNNING. Fresh directory D:/movieAgent/projects/MovieAgent视频验收-20261026. Poll/recover only this task, never another POST. Setup-only CDP readiness issue occurred before admission and was fixed in same directory with verified empty task list.
LIVE VERIFIED: original provider task456268409471408 SUCCEEDED durable. App playback and reopened asset/canvas playback verified. Requested4 seconds, actual3.75sec, H264+AAC768x1344, 1,707,766 bytes, full ffmpeg decode exit0. DB exactly1 task/attempt/asset/artifact. SHA2560415d8d08a6f08619eb7050b9ca06901f06b4dde9003c52a01fafd6903c4bcad. Convenience file D:/movieAgent/projects/MovieAgent视频验收-20261026/shots/episode-001/sample.mp4. Controller read sanitized video-validation.json and inspected live player screenshot. Final task and broad review pending; no further paid requests authorized/needed.

Task2 implementation3bc2f7e; report DONE_WITH_CONCERNS has only documented output/packaging limits (actual3.75 vs requested4, billunknown, unsigned build, existing toolchain warnings). Task reviewer /root/video_ui_review reviewing85d6898..3bc2f7e. Product tracked tree clean; live evidence verified. Opened sample in Codex right panel.
Preview UI note: open_in_codex returned queued, not confirmed visible. Final response will include absolute MP4 embed/link.
Task 2: complete (commits85d6898..3bc2f7e, review clean), reviewer /root/video_ui_review Approved. Minor deferred: video-workflow.test.ts:90 refresh assertion should await asynchronous capability refresh completion; existing SQLite/build fallback warning noise. No Critical/Important.
Controller verified current app.asar SHA25607980b7fc3616a8681395fc727a4dbc1e5abedd1a381ab9d377fa79f9eb48930 and final sample hash match report; tracked git tree clean.
Final whole-feature review pending; feature BASEef7a6a9 excludes already completed unrelated desktop foundation history.
Final review /root/video_final_review: With fixes. One P2: large portrait video overflows canvas inspector/history because CSS only sizes main/node video. One P3: await background capability refresh before stable-source assertion. No Critical/additional architectural findings. Single combined final fix wave starts at3bc2f7e. No new API generation.
Final fix dispatched /root/video_final_fixes (gpt-6.1-sol high), BASE3bc2f7e. Owns combined CSS large-portrait integration + asynchronous refresh assertion, focused tests/repackage/hash docs only. No paid calls.
Ruling: keep this plan's ignored workspace/admission record after closing — single-submission.json is the live runner's exclusive no-resubmission guard — deleting it would remove a safety invariant; retained scratch costs disk space. Earlier denied cleanup targets remain untouched.
Final-review declined-to-judge rulings: runtime full codec decode remains excluded (structural validation plus actual decoder evidence); extra codecs/providers remain excluded (unsupported outputs fail clearly); billing and exact provider output duration remain unknown/provider-controlled (truthful observed3.75 vs requested4 retained); screenplay/timeline/remote/global JSON-writeback remain later scope; signing remains local-build boundary; unrelated foundation re-audit/warning cleanup is not required for this feature; duplicate live/full suite executions are unnecessary and prohibited where paid; secret values remain unread and main-only controls reviewed. These match the approved spec and concrete evidence, no silent feature-completion claim beyond them.

Final combined fix d15bc26: CSS sidebar/history sizing + deterministic large portrait fixture + completed HEAD/render refresh assertion; focused7/7 Electron, type/build/package verification passed. Final app.asar4ddc690ac22208f7b0335f1c312f3df76ab072ffaf28657900777e56f6a37742. Original live MP4/admission unchanged; no paid request. Scoped re-review pending.
Final scoped re-review /root/video_final_fix_review: P2/P3 both ADDRESSED, no new breakage. Final fix wave complete3bc2f7e..d15bc26.
Controller final startup: launched actual final package with --project-launcher and initial registered project root; visible MovieAgent window PID13572 HWND200222. Read-only DB confirms ownerCount1, exactly one task stateSUCCEEDED, assetCount1. Current app.asar hash independently rechecked4ddc690ac22208f7b0335f1c312f3df76ab072ffaf28657900777e56f6a37742. Existing normal launcher settings points to software config/models.json; recent project entry correct.
Plan CLOSED — all authorized implementation, tests, single live validation, task/final reviews and runnable local startup complete. Preserve local branch codex/desktop-foundation and original project path. Retain ignored workspace because once-only admission guard is active evidence; no cleanup attempted against this or previously denied workspaces. No unresolved Critical/Important findings.
