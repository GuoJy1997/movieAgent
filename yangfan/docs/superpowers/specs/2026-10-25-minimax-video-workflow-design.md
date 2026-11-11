# MiniMax video workflow

Approved scope: connect MovieAgent's existing desktop generation, directory projects, task queue, durable assets and canvas to the user's working MiniMax video model. Deliver a runnable local app, not another standalone API script.

## Behavior

- Model configuration remains software-owned `config/models.json`, schema 1, with explicit provider `kind: video` supported alongside existing image entries. Native adapter identifier is `minimax-video-v2`. Initial model is `MiniMax-H3-Highspeed`.
- Text-to-video parameters: duration integer 4–15 seconds (default 4), resolution 768P, ratio one of 21:9,16:9,4:3,1:1,3:4,9:16 (default 9:16). Native POST normalizes the configured API origin/path to `/v2/video_generation`, including the current base URL ending `/v1`.
- POST body contains model, content=[{type:text,text:prompt}], duration, resolution, ratio. Response task_id is durably recorded before polling. GET `/v2/query/video_generation/{task_id}` returns task with queued/running/succeeded/failed/cancelled, and completed content.url. A transient query failure retains the known task ID and can retry the GET; it never retries the POST. Unknown POST acceptance remains unknown and cannot auto-resubmit.
- Freeze the actual adapter/model/config revision into existing task snapshots. Adapter selection must be per task, so existing image tasks and new video tasks coexist and recover correctly.
- Keep API keys in main-process vault and existing secret-scoped HTTP capability. No secrets in renderer, logs, command lines, receipts or git. Native model HTTP retains SSRF/DNS/private-grant and bounded-response controls. Artifact downloads never forward model Authorization. Preserve dispatch identities, journal/lease/late-result behavior, shutdown fences and directory isolation.
- Pricing supports existing per-image records and video per-second CNY 0.40, dated 2026-10-25, with frozen duration in estimates. Default estimate is CNY 1.60; actual bill is unknown. Approval UI describes the real video request and estimate.
- MP4 originals use existing staging/hash/journal/object/asset storage. Bound videos to 64 MiB; retain image limits. Validate bounded MP4 structure/metadata (including actual video track) without relying on an installed ffmpeg binary in the shipped app. This structural validation is not a claim of full decoder validation. Reject malformed/truncated/oversize media. Video thumbnails may be a generic play poster; do not describe that as an extracted video frame.
- Render playable video in task results, saved assets and canvas as applicable. Existing app-media capabilities, HTTP Range and per-project controls remain in use. No signed cloud URL is exposed to renderer. Saved result survives app/project reopen.
- UI exposes video preset/model selection, correct video parameters, queued/running/collecting/completed/error states. Unsupported cloud cancellation is stated truthfully. Retain the established visual style; no UI redesign.
- The current config has a legacy `kind:image` label with the proven video model. Once support exists, correct only that known entry's kind to video, preserving key, base URL, model ID and other values. Never dump its contents. General model-settings JSON writeback is out of scope.

## Verification and delivery

Use deterministic fixtures for contracts, adapter payload/status handling, duplicate prevention, recovery, media validation and Electron UI play/save/reopen. Run appropriate integration/type/build/package checks, and existing Electron regression suite once at the integrated final state. Preserve unrelated files and ongoing user projects.

After local checks, build actual Windows unpacked app and perform exactly one additional live minimal video request through the application's real UI and engine using the configured key. Use a fresh directory project, no old pending outbox. Persist a single-submission admission receipt outside tracked files before enabling the action, record task ID promptly, then poll/recover only that task. If acceptance is ambiguous, do not submit again. Validate downloaded MP4 by actual Electron playback and available local ffprobe/ffmpeg; report cost as estimate, never billed fact. Save sanitized evidence and show the output to the user. Preserve any non-test user windows when updating the package.

Not included: Agent screenplay generation, storyboard automation, editing/timeline/exported full episodes, remote deployment, arbitrary provider compatibility or global configuration page redesign.
