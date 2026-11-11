# Text model onboarding

User request: choose OpenAI compatible or Anthropic compatible, enter Base URL and API key, fetch/select a model or type its ID, and require successful connectivity testing before adding it. This extends the authorized P2 implementation.

## Behavior
- The protected model configuration window exposes the two text protocols visibly. Image/video workflows keep their existing behavior.
- A model list button uses the entered endpoint/key. Unsupported list APIs never prevent manual model ID entry. Lists are bounded, deduplicated, and cannot themselves mark a model working.
- Test sends one small, non-streaming text inference request. Only a valid nonempty text response counts. Explain in the UI that this request may incur a small provider charge. No automatic generation or retry on ambiguous failure.
- Save of an enabled new/edited text configuration requires a successful test for its exact effective connection, key, model, parameters and config revision. Editing invalidates success. Main process enforces this independently of the UI. Explicit credential clearing/removal remains possible without testing.
- Existing secrets stay in main; editing with blank key retains the secret and can test it. Do not reveal key or remote raw error bodies. Close cancels pending work; stale responses never unlock a changed draft. Version conflicts require retesting.
- Anthropic models must work in ordinary text generation and workflow output materialization, using the same protocol request/response logic as the connectivity test.
- Existing file configuration remains compatible. Hand-edited files are not claimed to have passed a test.

## Protocol decisions
- OpenAI Chat Completions: Bearer authorization, models GET and chat/completions POST. Support existing max_tokens configurations, plus a persisted advanced choice of max_completion_tokens for modern OpenAI models. Default new OpenAI configuration to max_completion_tokens; no automatic paid fallback. The same choice is used in production. Keep the main setup form simple.
- Anthropic Messages: x-api-key and anthropic-version 2023-06-01 for broad compatible-gateway support, max_tokens. Official authentication documentation confirms the legacy key header is supported. Do not send both auth schemes or try guessing a protocol from model names.
- Normalize a host-root URL to /v1; an existing /v1 or custom gateway path is a base path. Reject credentials/query/hash in endpoint input. Preserve DNS pinning, private-network explicit grant, no credential-bearing redirects, timeout and response-size bounds.
- Models GET is bounded to 3 pages, 1000 items total and 1 MiB per response; communicate truncation. Anthropic after_id pagination is supported. Connectivity has a 30s timeout and uses the currently selected generation output budget (1–8192, default 1024), visibly disclosed before the click. The advanced output setting therefore changes both test and production budgets. If reasoning consumes the budget with no text, show an actionable failure; never claim success or silently increase budget/retry.
- Anthropic responses may contain recognized thinking or redacted_thinking blocks alongside text. Ignore those internal blocks while collecting validated final text; still reject unsupported/tool output and responses with no usable final text. Production errors must not incorrectly refer to a fixed test-only budget.

Recovery uses the existing generation parameter rather than a separate test budget: a user may manually increase it in advanced settings and explicitly retest. This invalidates the previous receipt, persists the same value for generation and may increase provider charges. The shared extractor validates thinking/signature or redacted data fields but never returns those internals in the receipt or materialized text.

## Scope and evidence
Use local HTTP fixtures, including successful and rejected OpenAI/Anthropic inference. Do not read or call live provider secrets. Preserve the running desktop, project libraries and unrelated untracked work. Build/package once after implementation settles; run focused packaged onboarding tests, not canvas regression loops.

Sources: https://developers.openai.com/api/reference/resources/models/methods/list ; https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create ; https://platform.claude.com/docs/en/api/models/list ; https://platform.claude.com/docs/en/api/messages/create ; https://platform.claude.com/docs/en/manage-claude/authentication ; https://platform.claude.com/docs/en/api/versioning
