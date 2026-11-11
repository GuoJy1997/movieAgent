# OpenAI Images adapter: supported contract

Implementation: `openai-image-v1`. Documentation checked **2026-10-25**. This is the desktop application's versioned protocol subset, not a claim that every endpoint advertising OpenAI compatibility works.

## Official reference and version

Read the official [Create image HTTP reference](https://developers.openai.com/api/reference/resources/images/methods/generate) and its [image-generation guide](https://developers.openai.com/api/docs/guides/image-generation). The HTTP reference is a living, unversioned document; no dated server API version header is asserted. The configured model ID is sent unchanged. There is no model substitution or implicit SDK default.

The current official GPT Image API accepts `POST /v1/images/generations` and returns base64 image data. Its documented Image response schema also contains an optional URL field. The parser accepts that field for a compatible service, but this does not establish compatibility with retired DALL-E models or arbitrary relays. Those services need their own documented and tested adapter when request semantics differ.

## Request subset

Base URL identifies the API prefix, for example `https://api.openai.com/v1`. The adapter appends only `/images/generations`.

| Field | Supported value |
| --- | --- |
| model | Configured model ID, unchanged |
| prompt | Frozen text, existing 16,000-character contract |
| n | Exactly 1 |
| output_format | png |
| size | Optional: 1024x1024, 1024x1536, 1536x1024 |
| quality | Optional: auto, low, medium, high |

No seed, style, edits, reference images, masks, batch, streaming, arbitrary paths, scripts, raw headers or request templates. Unsupported parameters fail before HTTP. Configured model constraints are still checked by the engine; this subset does not imply every model supports every allowed option.

## Trust and network boundaries

The utility engine receives a narrow request-image capability. It sends its frozen plan and durable dispatch identity over a fixed private utility-process channel. Main independently validates the plan and identity, constructs the fixed request, and calls the already initialized credential vault's `withSecret`. It never sends secrets back to the utility or renderer. Headers use owned credential references; authentication and secret X-Headers exist only during main's transport call. The renderer cannot install capabilities or call a generic network IPC endpoint.

The scheduler starts only after main has loaded all retained credential references, initialized the vault, synchronized status, and installed that capability. Dispatch intent, client request ID, output staging ID, request digest and original evidence source are durable before sending. Existing intent cannot submit again. No SDK or HTTP retry is enabled; the client request header is diagnostic, not a claim of provider idempotency.

Public model endpoints require HTTPS. An explicit private model grant must match the exact hostname, port and model-api purpose. The actual DNS result is checked and pinned to the socket. Model POST redirects are never followed, including same-origin redirects, so credentials cannot cross redirects. Socket/body/DNS work shares the configured bounded timeout; malformed, lost or oversized responses never trigger another POST.

Content downloads are a separate HTTPS-only capability without credentials, cookies or model grants. Each hop resolves, validates and pins addresses again; at most three redirects are followed. Loopback, private, link-local, cloud metadata and special-purpose addresses are denied. **A private model's output URL is also denied**, even if it points to the same authorized model host. Such a service must return inline base64 for this subset. There is no endpoint-specific locator refresh implementation.

## Completion and persistence

HTTP 400/401/403/404/413/415/422/429 produce explicit rejection; 5xx, redirect, disconnect, timeout or an incomplete/oversized response remain unknown. A synchronous 200 response with unusable output is recorded as completed with unavailable output; it never becomes unsubmitted. Provider error bodies are not propagated to user errors or logs.

The protocol response cap is 44,804,780 bytes (base64 allowance for a 32 MiB original plus 64 KiB JSON overhead); requests are capped at 128 KiB. Downloads have a 30-second overall budget and 32 MiB cap. Object collection independently enforces static PNG/JPEG/WebP, 40 million pixels and a full decode with the existing 15-second limit.

Inline output is written under the pre-existing opaque staging identity, fsynced, hash-manifested, published, and synced before the adapter releases it. The stable spool can be recovered after restart, including interruption before rename; different bytes cannot replace that identity. Spool loss during inline handling returns completed/unavailable. Fully durable inline spools can satisfy local recovery before a completed fact was recorded; this is not remote reconciliation.

URL output is first persisted as a private completed descriptor. Download/materialization then runs outside SQL. Failure preserves completed state and retries only collection. No temporary URL becomes an artifact ID. Spool paths, URLs and signatures are excluded from TaskView, command receipts and events; private descriptors remain in engine-owned SQLite for recovery. Committed spools are conservatively retained; automatic garbage collection and whole-library backup policy remain later work. A retry may remove only its own incomplete unpublished partial and invalid manifest after owned-path validation. A valid manifest is retained and requires the same hash; an existing final file is never replaced.

## Verification state and UI handoff

Schema **6** adds `provider_verification`, keyed by library + connection ID + immutable connection revision + model ID. Task7 canvas migration is **0007**. `provider.list` adds a validated `verification` array:

- `connectionRef`, `modelId`, `adapterId`, `checkedAt` identify evidence.
- `configuration`: valid/invalid.
- `authentication`: unknown/accepted/rejected. There is no free authoritative authentication probe in this subset, so config-only probe leaves this unknown. Successful generation can supply acceptance evidence; actual 401/403 can supply rejection evidence.
- `generation`: unverified/verified. Verified is written only with successful decoded object/artifact publication using the original real dispatch evidence.
- `fixtureGeneration`: separate fixture evidence, never a substitute for generation verified.
- `capabilities`: textToImage adapter-declared, batch 1, reconcile unsupported. This is an implementation declaration, not provider acceptance.

`adapter.probe` performs configuration validation and reads/records state; it makes no HTTP call, never submits a paid test, and does not treat `/models` as proof. Task8 can use these fields and the immutable connection's networkPolicy to present configured capability, source, private endpoint authorization and verification separately.

Evidence provenance comes only from trusted execution context, not endpoint address or renderer input. Production defaults to real, including authorized private services. Tests can downgrade at trusted startup with `--provider-evidence=fixture`. The source is persisted in dispatch intent; restarting a fixture task in real mode cannot upgrade it. Old intents with no source remain unknown. Tests of real-context classification use isolated temporary libraries and do not constitute real provider acceptance.

## Acceptance status

Local HTTP contract fixtures and a Windows x64 unpacked Electron fixture were run with dummy credentials in temporary profiles. **No actual provider API, real API key, paid generation, installer signing, or clean-machine acceptance was performed.** The user deferred real API acceptance to Task10. A real generation test must be separately prepared, explicitly approved with finite risk allowance, and recorded as actual provider evidence.
