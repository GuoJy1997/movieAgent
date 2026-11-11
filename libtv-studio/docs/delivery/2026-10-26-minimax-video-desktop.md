# MovieAgent MiniMax video desktop acceptance — 2026-10-26

The Windows unpacked application now supports native MiniMax text-to-video alongside the existing image workflow. Model settings expose `minimax-video-v2`, per-second pricing and video presets. The normal approval dialog freezes duration, resolution, ratio and estimated cost. Task output, saved assets and canvas results play the durable local MP4 with native controls; the generic asset-grid poster is explicitly not an extracted video frame.

Final local package: `apps/desktop/release/win-unpacked/resources/app.asar`, SHA-256 `4ddc690ac22208f7b0335f1c312f3df76ab072ffaf28657900777e56f6a37742`. This package includes the final sidebar video sizing fix described below.

## Run locally

1. Start `D:/movieAgent/启动MovieAgent.cmd` (or `apps/desktop/release/win-unpacked/MovieAgent.exe`). The existing startup command still points to the packaged executable and software-owned model config.
2. Open the recent short drama **MovieAgent视频验收-20261026**, then open **资产 → 湖面涟漪 · 4秒视频** to play the saved result. The canvas includes both the generation output and the saved fixed asset.
3. The same original is available for direct preview at `D:/movieAgent/projects/MovieAgent视频验收-20261026/shots/episode-001/sample.mp4`. This acceptance copy is not a general export feature.

For future requested work, choose a video preset, save the node prompt, select **准备生成**, review the frozen parameters/estimate, fill explicit allowance and project budget, then approve once. Accepted tasks continue querying their original provider ID. Unknown submission is not permission to create a replacement task. Current native adapters cannot withdraw an accepted cloud task.

## One live acceptance

Exactly one additional paid generation was submitted through the actual UI on 2026-10-26 at 00:44:21 Asia/Singapore. A unique ignored admission receipt was exclusively created before the click and is retained permanently at `.superpowers/sdd/2026-10-25-minimax-video-workflow/live-ui-20261026/single-submission.json`. Do not rerun the submit script or replace this receipt.

| Fact | Recorded value |
| --- | --- |
| Requested model | MiniMax-H3-Highspeed |
| Requested parameters | 4 seconds, 768P, 9:16 |
| Frozen estimate | CNY 1.60; actual bill unknown |
| App task | eff971d4-4b99-4da1-b225-d08a3ee55422 |
| Provider task | 456268409471408 |
| Completion | SUCCEEDED / durable |
| Actual output | MP4, H.264 video + AAC audio, 768×1344, **3.750000 seconds** |
| Original byte length | 1,707,766 |
| SHA-256 | 0415d8d08a6f08619eb7050b9ca06901f06b4dde9003c52a01fafd6903c4bcad |
| Persistence | Saved asset v1; generation output and asset canvas nodes restored after close/reopen |
| Decoder checks | Electron readyState 4 and playback position advanced; full ffmpeg decode exit 0 |
| Durable DB counts | 1 generation task, 1 attempt, 1 asset, 1 artifact |

The requested four seconds and provider's actual 3.75-second output are distinct. Pricing is a frozen estimate, not a statement of billed cost. The copied MP4 and immutable original have the same SHA-256.

Evidence is local and ignored: `test-results/video-live-20261026/{validation.json,task-player.png,reopened-asset-player.png}`; another sanitized validation copy lives beside the project MP4 as `video-validation.json`. No keys, signed cloud URLs or downloaded media are tracked by Git.

The first automation setup closed the launcher before its asynchronous directory initialization completed. Initialization resumed in the same fresh folder before approval. After saving the output, the launcher's in-memory recent list had not refreshed following the setup bridge call; verification reopened the already registered directory using the actual package's `--workspace-child` entry. Recovery queried and played the existing task only. No second generation was submitted.

## Verification

- `npm test`: 21 files, 285 tests passed.
- `npm run typecheck`, `npm run build`, `npm run package:win -- --dir`, and `npm run verify:package`: passed. The package verifies Electron 45.0.0 / ABI 150 / x64, SQLite, Sharp and isolated preload boundaries.
- Full `npm run test:electron` ran once: 15 files, 41 tests, 39 passed and 2 failed. Failures were an old image-only empty-title assertion and the newly added terminal-result assertion against the pre-fix package. The empty-title expectation was updated without dropping loading/error/cached-read checks. Completed task wording was fixed and the current package rebuilt.
- Focused final checks against that rebuilt package: `final-review-regressions.test.ts` 6/6 passed; `video-workflow.test.ts` 1/1 passed. One intermediate video check used an immediate count before the asynchronous task detail query rendered; it was corrected to await the result text.
- The new Electron fixture uses a loopback native MiniMax POST/query server through the real main/utility/provider pathway. A real deterministic MP4 is pre-staged in the production video spool to preserve the app's public-CDN download restrictions. It verifies payload, one POST, running state, actual decoding, stable source across timer refresh, renewal restoring playback position, asset save and reopen. Existing image regressions passed in the full run.
- The earlier standalone provider sample was inspected read-only (5,817,120 bytes; 768×1344; 4.458333 seconds); it was not used as this new UI acceptance.

## Final sidebar fix verification

The fixed-asset inspector now fits video to the available width while retaining its aspect ratio. Output-history video fits the existing 140-pixel box with `object-fit: contain`, keeping native controls, history text and the selection action accessible. Existing image sizing rules are unchanged.

The packaged Electron video workflow now uses a checked-in, deterministic 768×1344 H.264 fixture (2,411 bytes); the backend's original 64×48 fixture remains unchanged. The new bounds check failed against the previous package: the inspector overflowed horizontally and the history video escaped its box and overlapped the following text/action area. It passes against the final package above, including an actionable history selection button and saved-asset playback after reopening. The timer check installs its clock before the preview mounts, observes a completed fresh capability HEAD through the real fetch, and allows subsequent React render frames before comparing the retained player source.

- `npm run test:electron -- tests/electron/video-workflow.test.ts tests/electron/final-review-regressions.test.ts`: **2 files, 7 tests passed** against the final package.
- `npm run typecheck`, `npm run build`, `npm run package:win -- --dir`, and `npm run verify:package`: passed. The final package again verifies Electron 45.0.0 / ABI 150 / x64, SQLite, Sharp and isolated preload boundaries.
- The focused layout screenshot is retained locally at `test-results/video-workflow/portrait-history.png`. The full successful integration/Electron suites were not repeated for this CSS-only fix.

No paid generation was repeated for this package. The original live evidence above remains evidence for the unchanged generation and storage code; the final package was checked with local fixture traffic only. Provider task `456268409471408`, its exclusive submission receipt and the original acceptance MP4 remain unchanged. The MP4 still hashes to `0415d8d08a6f08619eb7050b9ca06901f06b4dde9003c52a01fafd6903c4bcad`.

The local package is unsigned. Electron-builder used its manual dependency traversal after the environment could not spawn `powershell.exe`; the resulting package passed native ABI and actual UI tests. Existing SQLite experimental warnings remain unchanged. Runtime MP4 validation remains structural; acceptance separately performs actual Electron and ffmpeg decoding. General model-settings JSON writeback, timeline editing and full-episode export remain outside this delivery.
