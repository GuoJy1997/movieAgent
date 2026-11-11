# P2 desktop creation and delivery

The final P2 Windows x64 unpacked beta is `apps/desktop/release-p2-final/win-unpacked/MovieAgent.exe`. `D:/movieAgent/启动MovieAgent.cmd` selects this build, `--project-launcher`, and the existing software `config/models.json`. The canonical `release` directory and any running older user windows are preserved. Close an older window before opening that same project in the new version. The launcher does not automatically open a user library or pending task.

## Using the workbench

1. In 模型设置, add a software model by text/image/video category and enter Base URL, API Key, model ID. Optional name, exact adapter, parameters, price and private-endpoint authorization remain under 高级设置 in the protected window. A blank key when editing retains the existing key. File saved and current project imported are distinct outcomes; conflicts preserve the draft. Saving never sends a compatibility probe.
2. Create/open a project. Add fixed text or generation nodes. Place imported PNG/JPEG/WebP, MP4 or explicit TXT/MD assets from the library. New cards find an empty grid cell without moving saved cards; Fit View fits the graph. Node dragging and layout saving remain explicit.
3. Drag output to an input handle, or select 连接来源 and 目标端口 in the inspector. Text feeds 提示词, images feed 参考图/首帧/尾帧. The engine rejects incompatible inputs, cycles, duplicate edges and unsupported modes. 断开连线 and 撤销 use observed canvas revisions.
4. Pick a fixed profile version. 节点模式与参数 can save an independent project preset (text max_tokens, image size/quality when declared, video duration/resolution/ratio); then save node content. This does not overwrite global file defaults. For image edits and video, choose asset **versions** and ordered roles. MiniMax first-frame or first/last-frame mode requires adaptive ratio; text-only uses one of the six fixed ratios. Reference images and frame mode are mutually exclusive; tail-only is rejected.
5. 运行当前节点 executes only that node and needs explicit fixed outputs for external generation inputs. 运行所需上游 reruns the required ancestors. Shift selection or 执行选择 checkboxes define 运行选定子图; external ancestors are not implicitly added. All drafts must be saved before a workflow preview.
6. Inspect frozen prompts, model/parameter versions, dependencies, step count and costs. Supply each step's finite risk allowance and a single project budget, acknowledge unknown costs, then 一次批准并运行计划. Waiting steps reserve budget too. A changed input/model/scope needs another preview; moving a card does not invalidate semantics.
7. The engine's workflow panel reports waiting, running, blocked, failed, stopped and unknown states. 停止后续步骤 prevents new child tasks; accepted/unknown cloud work can still complete and cannot be withdrawn. Original-task query and collection retry live in task details. Unknown submissions retain risk and concurrency capacity; independent branches on available connections continue. Reopening recovers the original tasks, never automatically resubmits an unknown POST.
8. Text is displayed as escaped plain text. Text/image/video results remain durable originals. Use task details → 加入资产库 for a new asset or explicit new version. Select a historical result or a fixed asset output without generating again. Output history shows why a late result was historical-only; expanded trace details retain node incarnations, semantic/selection versions, plan inputs, task IDs and fixed original hashes.

## Protocol and validation boundary

| Adapter / input mode | Local native fixture | Live service in this P2 delivery |
| --- | --- | --- |
| openai-chat-v1, bounded non-streaming Chat Completions | Integration and packaged text chains; max_tokens and escaped output | Not run |
| openai-image-v1, one text-to-image PNG | Integration, existing packaged image workflow and P2 chain | Not run |
| openai-image-edit-v1, ordered fixed image[] multipart references | Integration and packaged reference editor | Not run |
| minimax-video-v2, text-only | Existing packaged video workflow; fixed-ratio project preset preview | No new request; historical limited MiniMax evidence retained |
| MiniMax first_frame, adaptive | Integration and packaged text→image→video chain | Not run |
| MiniMax first_frame + last_frame, adaptive | Integration and packaged ordered role flow | Not run |
| MiniMax reference_image mode | Integration and packaged fixed reference flow | Not run |

These are explicit protocol subsets, not arbitrary vendor compatibility. Text is non-streaming with max_tokens 1–8192 and a 1 MiB original cap. Image editing has no mask/painting UI. Fixed references are limited to four PNG/JPEG/WebP images, each ≤10 MiB, total ≤32 MiB, frozen hash/MIME/dimensions/bytes. MiniMax validates dimensions 256–5760 and aspect 0.4–2.5 without silent resizing. No live credentials were read or provider probes/paid requests made during development.

Packaged tests create isolated software configs, project roots and profiles and use actual Electron main→utility→SQLite→native HTTP transport. Normal creation, connection, preview, approval, role/parameter editing and result/history interactions occur through the UI. MP4 output is staged in the real immutable provider spool before native query completion, as in the existing video fixtures. This verifies collection/player/restart behavior without claiming real public-CDN downloading. Asset version/trash/recovery and global config conflict/reopen/new-project coverage remain in their focused packaged suites. Existing offline/loading/error/keyboard/IPC/reconnect tests run against the same final package.

## Schema and reproduction

Current storage schema is **10** (8 asset metadata, 9 typed edges, 10 durable workflows), centralized in the contracts. Migrations and backups remain intact; old fixed originals and their hashes are preserved. Use the blank-key V2 template in `configs/models.example.json`; the main process still reads V1 and writes V2 only on explicit save. Keys remain in main/vault or the protected model editor, never generic renderer commands.

```powershell
$env:PATH='D:/nodejs;C:/Windows/System32/WindowsPowerShell/v1.0;'+$env:PATH
npm test -- --fileParallelism=false --testTimeout=60000 --hookTimeout=60000
npm run typecheck
npm run build
npm run package:win -- --dir --config.directories.output=release-p2-final
npm run verify:package -- --dir apps/desktop/release-p2-final/win-unpacked
$env:MOVIEAGENT_TEST_PACKAGE=(Resolve-Path apps/desktop/release-p2-final/win-unpacked).Path
npm run test:electron -- --testTimeout=60000 --hookTimeout=60000
```

The output is an unsigned unpacked beta, not a newly validated NSIS installer or clean-machine install. P3 Agent, P4 audio/timeline/export and P5 remote services/full backup are outside P2. Historical admission guards, live acceptance records and prior release directories are preserved.

## Final verification, 2026-10-26

The final core log contains 29 files / 382 passing tests (119.37s). Typecheck and build passed. The complete Electron run found 9 failures among 55 tests (18 files, 365.84s); these exposed protected-editor dependency loading, Escape selection and graph redraw issues, plus older label/error-code assertions. After fixes and rebuilding this package, the affected 7-file run had 19 passing tests and 3 remaining failures (214.54s). Those three were resolved with an engine-default assertion correction, observed completion before mouse dragging, and native capture of the video screenshot; their final focused run passed 3/3 (22.58s). All original full-suite failures and the added cross-model preset regression are covered; no claim is made that the entire final suite ran in one all-green invocation. Unaffected suites were not repeated after UI/build fixes.

Task 5 review fix round 1, after `07953fd`, addresses three renderer findings: incoming typed edges disable the legacy single-generation action with a workflow instruction; keyboard selection batches read the live active selection; node parameter state mounts only when the exact immutable profile/model has loaded. A focused run passed 6/7 cases, with the remaining test incorrectly expecting connected inputs inside the template prompt. The workflow contract freezes them separately in step inputs; the corrected input/reference/metadata preview case then passed 1/1 without approval or any provider request. The delayed-profile case renders the real component in a fixture harness with a test-only command sink; the other cases use the actual package. No full core/Electron suite was repeated for this fix round.

Final native verification passed: Electron 45.0.0 / ABI 150 / Node 24.22.0, SQLite 3.53.4 and native Sharp. All 21 compiled output files match app.asar byte-for-byte after the single review-fix rebuild. Protected model-config entry, preload and shared resources (5 files) retain their previous hashes. This current package contains the review fixes committed after `07953fd`; later changes affect tests/docs only. Full commands, inherited versus fresh TDD evidence, warnings, hashes and source commits are in `.superpowers/sdd/2026-10-26-p2-complete-creation/task-5-report.md`.

| File | SHA256 |
| --- | --- |
| MovieAgent.exe | `19227f5fe44cc037a79bf4cf99e06f866103c7e3315be2655baece97b9c15d6b` |
| resources/app.asar | `6961da47c135a1c8a593882175836be93a2c204d0999fab7d2b38391bc448b5b` |

Earlier Task 5 screenshots are in `test-results/p2-workflow/`: `connected-canvas.png` (four nodes/three edges after normal Fit View), `history-1100.png` (1100 CSS px, full graph and durable outputs/history), `text-parameters.png`, `video-parameters.png`, and `approval.png`. Fit assertions check each node's bounds, unchanged positions, and all changes saved; screenshot capture does not modify the graph or viewport. The video history screenshot uses Electron's native capture because Playwright capture timed out while compositing video. Review fixes did not repeat these closed display/drag checks.

The authorized outside-Git launcher now selects the verified `release-p2-final` path and retains `--project-launcher` and the same explicit `config/models.json`. Final safe user startup is performed by the controller after independent reviews.
