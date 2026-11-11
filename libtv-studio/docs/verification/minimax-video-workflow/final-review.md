# Final whole-feature review — native MiniMax desktop video

Range: `ef7a6a9..3bc2f7e`. Reviewed 2026-10-26 in `D:/movieAgent/libtv-studio`.

Scope: single supplied review package, approved spec and plan, progress ledger, Task 1 and Task 2 reports, plus narrow reads of adjacent scheduler/recovery/media-protocol/CSS code. Used the supplied requesting-code-review/code-reviewer.md rubric. No product, index, HEAD, configuration or user-project mutations; no subagents, provider calls or repeated full suites. This report is the only checkout write.

## Strengths

- Native video is integrated through the existing durable task/attempt/lease/journal pipeline. The per-library adapter registry selects the frozen task adapter for preparation, submission and reconciliation, preserving image coexistence and avoiding a parallel task implementation.
- POST acceptance becomes a durable provider-ID fact before normal GET polling. Known acceptance survives transient or malformed query responses; no-ID ambiguity moves to unsupported reconciliation rather than replacement submission. Terminal provider facts cannot be regressed. Fixture recovery coverage includes restart, a single POST and mixed image/video work.
- The shared main-only credential scope checks library and connection ownership, retains vault-scoped cleanup, and keeps video POST/query separate from uncredentialed artifact downloads. Existing transport DNS/private-endpoint, redirect and response bounds are retained.
- Pricing uses bounded integer micros with frozen duration and preserves old image records. Approval and delivery distinguish estimated cost from billing, generic posters from extracted frames, and requested duration from actual duration.
- MP4 collection reuses staging, immutable hashes, receipts, publication, app-media capabilities and Range responses. Video and image size limits remain distinct. The bounded self-contained AVC structural validator and explicit unsupported-codec boundary are appropriate for the approved model scope.
- Delivery evidence is unusually concrete: final package hash, exactly one accepted provider task, durable object hash/counts, normal UI playback/save, reopened asset/canvas playback, and separate full ffmpeg decoding. Reported 285 integration tests and Electron coverage of all 41 tests through the full run plus affected reruns are adequately accounted for; there is no reason to repeat those successful checks in this review.

## Issues

### Critical

None found.

### Important — should fix

**P2: Size videos in the canvas inspector and output history as well as the main preview surfaces.**

- File: `apps/desktop/src/renderer/style.css:1016`.
- Related callers: `apps/desktop/src/renderer/features/canvas/CanvasWorkspace.tsx:292` and `:448`; existing image-only sizing is at `apps/desktop/src/renderer/style.css:804` and `:912`.
- `MediaPreview` now emits a native video for these callers, but the new CSS rule handles only `.large-preview` and `.node-media`. `.inspector-media` and `.history-media` still size only `img`. A normal generated video therefore renders at its intrinsic dimensions in the sidebar. In the history surface it extends far above and below the fixed-height wrapper, obscuring history text/actions and making the controls difficult to use; the fixed-asset inspector also horizontally overflows.
- Focused proof: a hidden Electron window loaded the exact current stylesheet and existing accepted local MP4 (768×1344), using the actual inspector/history class structure. The inspector wrapper was about 233 pixels wide while its video remained 768×1344. The history wrapper was about 233×140 while its video remained 768×1344 and extended 602 pixels above and below the wrapper. This check used local media only and did not initialize the app engine or contact a provider. The initial data-URL harness exceeded Chromium URL length; the successful file-based harness exited 0.
- Fix: apply responsive video sizing on both sidebar surfaces. Inspector video should fit the available width while retaining aspect ratio; history video should fit its 140-pixel box with `object-fit: contain`. Verify both with media larger than the sidebar (the current 64×48 Electron fixture cannot expose intrinsic-size overflow). A focused layout check is sufficient; no new paid generation is necessary.

### Minor — nonblocking

**P3: Await capability refresh completion before asserting the video source stayed stable.**

- File: `tests/electron/video-workflow.test.ts:90`.
- The timer is advanced and `src` is read immediately; the asynchronous mediaUrl/HEAD query may still be pending, so this assertion can pass before the refresh whose behavior it intends to verify. Await a completed background refresh or an observable query/capability response, then compare `src`. The subsequent explicit error-renewal and playback assertions are useful independent coverage. This is the same minor item retained in the task ledger, not a new product defect.

Existing SQLite experimental and builder fallback warnings are not new findings: package ABI/preload checks and actual image/video execution establish the delivered package works in this environment.

## Recommendations

Resolve the one CSS integration issue in the planned combined fix wave and perform a focused inspector/history layout check. If the refresh test is touched in that wave, make its asynchronous completion condition explicit. Rebuild the distributed package if product CSS changes, and record its new hash; preserve the existing single-submission receipt and completed live artifact without another provider POST.

## Declined to judge

- Full runtime compressed H.264/AAC bitstream decoding: explicitly outside the approved structural-validation scope; separate actual Electron playback and ffmpeg decode evidence exists. Structural acceptance is not treated as decoder proof.
- Additional codecs, fragmented MP4 and arbitrary providers: intentionally rejected or excluded by the approved scope/ledger; no claim of universal compatibility was made.
- Provider billing accuracy and exactly four seconds of encoded duration: the application cannot infer the actual bill or force provider encoding duration. Requested 4 seconds, actual 3.75 seconds and unknown bill are truthfully documented; no corrective paid resubmission is appropriate.
- General JSON configuration writeback, screenplay/storyboard automation, timeline/full-episode export and remote deployment: explicit exclusions from this delivery.
- Signing/distribution hardening beyond the local Windows unpacked build: not requested; the unsigned build limitation is documented and the actual package was validated.
- Re-auditing unrelated foundation history, every prior scheduler failure mode and unchanged build-warning causes: outside this feature range; reviewed the adjacent invariants needed to assess integration, and relied on existing regression/package evidence for unchanged paths.
- Independent re-execution of the one live acceptance or full successful suites: deliberately not repeated because the task prohibits more paid calls and redundant tests; inspected code and sanitized reports/evidence instead.
- Live secret values and broad configuration correctness: deliberately not read. The narrow kind-only correction and credential-preservation checks are documented in the delivery report; this review assessed the main-only boundary and importer code.

## Assessment

**Ready to merge/deliver? With fixes.**

The native provider, durability/recovery, credential boundaries, pricing and existing image compatibility are sound on the reviewed evidence. One ordinary canvas-use path is visibly broken by missing sidebar video sizing; fix that small integration defect before final delivery. No new architectural blocker or additional paid acceptance is required.
