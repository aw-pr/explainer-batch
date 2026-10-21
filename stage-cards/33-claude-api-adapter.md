# Stage card 33-claude-api-adapter: one Claude API adapter builds batch and sync requests and returns only normalised results

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/33-claude-api-adapter
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/providers/claude-api.ts, tests/unit/claude-api-adapter.test.ts
- **Pairing rationale:** Design 17 W5 marks this "Mechanical, Sonnet or Terra tier, against the settled contract": every mapping rule is written below and pinned by the frozen test, and the transport logic moves from `src/providers.ts`, so Claude Sonnet 5.5 at medium effort fits. GPT-6.1 Sol verifies from the other family at high effort. First of four adapter cards (33 to 36); worker families alternate Claude, Codex, Claude, Codex.
- **Open decisions:** none

## Surfacing concern

Design 17 (`docs/design/provider-routes.md`) puts every vendor behind one `LlmProvider` boundary (`## Provider interface`, `:79-234`). Cards 22 to 25 landed the contract (`src/llm-contract.ts`), the registry, credential bindings and run plans (`src/routes.ts`, `src/run-plan.ts`) and the state ledger. Today the Claude API transport lives in `ClaudeProvider` (`src/providers.ts:191-360`): it returns vendor-shaped objects, throws on truncation and has no `custom_id` or usage normalisation. W5 moves that transport into an adapter whose only output is `NormalizedResult`, following the Claude rows of the mapping table (`:222-223`) and the HTTP retry rule (`:231-234`). Checked against `dev` at `8bb4372`.

Design decisions this card settles (none needed the operator):

1. **Factory and injected seams.** `createClaudeApiProvider(opts)` takes the resolved `CredentialBinding` (card 24), a `schemaFor(ref)` function standing in for stage 16's schema service (the caller passes the generated `contract/generated/model-output.claude.json`; no current-schema bridge is needed because card 20 landed the dialects), a `systemPrompt(stage)` function, a `sourceRoot` against which `SourceSnapshot` relative paths resolve, and an optional `client`. The client is a structural subset of `@anthropic-ai/sdk` (`messages.stream`, `messages.batches.create | retrieve | results`), so the real SDK instance satisfies it and tests inject a fake. The SDK is constructed lazily, as `new Anthropic({ apiKey: binding.credential(), maxRetries: 0 })`, only when no client is injected.
2. **Chunking stays in the orchestrator.** This card declares the batch limits in capabilities (`maxBatchRequests` at most 10,000, `maxBatchBytes` at most 100,000,000, the design's application caps at `:462-469`) and measures `wireBytes` exactly; splitting into chunks and the `REQUEST_TOO_LARGE` refusal belong to W12, which owns the chunk manifest.
3. **Unknown and missing rows.** A results row whose `custom_id` is not in the handle is skipped; an expected request with no row yields `MISSING_RESULT` after the stream ends. Rows are yielded as they arrive, then the missing ones in handle order.
4. **The forced-tool allowlist is reused, not copied:** the adapter imports `acceptsForcedToolChoice` from `src/providers.ts`.
5. **No automatic retries on POSTs.** The design allows automatic transport retries only on safe reads (`:231-234`); the installed SDK retries failed requests twice by default, so the lazily built client passes `maxRetries: 0`. Batch transport failures (`submitBatch`, `getBatch`, `results`) are thrown errors left to the polling policy (`:199-201`), not results; only `complete` turns a failed call into a result.
6. **`stop_sequence`.** The API reports `stop_sequence` only for a configured sequence; this adapter configures none, so the value is accepted as `stop` without a further check.

Cold read: see `## Cold read` at the end of this card.

## Objective

`src/providers/claude-api.ts` exports `createClaudeApiProvider`, an `LlmProvider` for `id: 'claude'` on `batch-api` and `sync-api` that builds Messages requests from a `PreparedItem` and `RunPlan`, submits, polls and collects batches by `custom_id`, completes sync calls by streaming, and maps every outcome, including HTTP failures, to a `NormalizedResult` that already satisfies `checkResult`.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`## Provider interface` `:79-234`, `## Orchestrator` batch chunking `:462-469`, W5 `:1095-1100`)
- `src/llm-contract.ts`, `src/routes.ts` (landed contract and `CredentialBinding`)
- `src/providers.ts:117-360` (today's Claude transport, `acceptsForcedToolChoice`, `toolOutputParams`, `extractClaudeText`)
- `contract/generated/model-output.claude.json` (the dialect the test injects)
- `tests/contract/33-claude-api-adapter.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. **New `src/providers/claude-api.ts`**, exporting `ClaudeApiClient`, `ClaudeApiOptions` and `createClaudeApiProvider(opts: { binding, schemaFor, systemPrompt, sourceRoot, client? }): LlmProvider`:
   - **Binding check, at construction, before reading any credential:** a binding with `credentialKind: 'claude-oauth-token'` or `surface: 'claude-agent-sdk'` throws `LlmContractError('CLAUDE_OAUTH_WRONG_SURFACE')`; any other binding that is not `{ provider: 'claude', surface: 'anthropic-api-sdk', credentialKind: 'anthropic-api-key' }` throws `MISSING_ROUTE_CREDENTIAL`. With an injected client, `binding.credential()` is never called.
   - **Identity and capabilities:** `id: 'claude'`, `routes` `batch-api` and `sync-api`, passing `assertProviderCapabilities`. Both routes: `structured: 'tool'`, `schemaEvidence: 'fixture'`, `vision: true`, `pdfNative: true`, `outputTokenLimit: 'enforced'`. `batch-api` adds `maxBatchRequests` (at most 10000), `maxBatchBytes` (at most 100000000) and `completionWindowMs: 86400000`.
   - **`buildRequest(stage, item, plan)`:** takes the binding `plan.tiers[stage]`; if it is null, not `provider: 'claude'`, or its route is not `batch-api` or `sync-api`, throws `ROUTE_UNSUPPORTED`. The `ProviderRequest` carries that binding's `route` and `model`, the item's `customId`, `attemptId` and `schema`. `payload` is the Messages params object: `model`; `max_tokens` from the binding's `maxOutputTokens`; `system` as one block `{ type: 'text', text, cache_control: { type: 'ephemeral' } }` whose text is `systemPrompt(stage)`, with an instruction naming the `emit_explainer` tool appended when the model is not forced (the wording of `EMIT_INSTRUCTION` at `src/providers.ts:153`, which is not exported, so repeat it); `messages` as one user message whose content is, in order: a `document` block `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }` read from `sourceRoot` + `source.pdf.relativePath` when the snapshot has a PDF, otherwise a `text` block of `source.text`; for each snapshot image a `text` block of its label then an `image` base64 block, its `media_type` from the file extension (`.png` `image/png`, `.gif` `image/gif`, `.webp` `image/webp`, anything else `image/jpeg`); and last a `text` block of `item.instruction`. `tools` is one `emit_explainer` tool whose `input_schema` is `schemaFor(item.schema)` unmodified; `tool_choice` is `{ type: 'tool', name: 'emit_explainer' }` when `acceptsForcedToolChoice(model)` is true, else `{ type: 'auto' }`. `wireBytes` is `Buffer.byteLength(JSON.stringify({ custom_id, params: payload }))` on `batch-api` and `Buffer.byteLength(JSON.stringify(payload))` on `sync-api`.
   - **Message mapping** (sync completions and succeeded batch rows), after which every result goes through `checkResult`:
     - The tool rule is checked first, so an invalid emission is `UNEXPECTED_TOOL` whatever the stop reason. Text: if the content has any `tool_use` block, or `stop_reason` is `tool_use`, there must be exactly one `tool_use` block named `emit_explainer` with a serialisable `input`, whose `JSON.stringify` is the text; otherwise `error` / `UNEXPECTED_TOOL`. Without tool blocks, the text blocks joined with `\n`.
     - `end_turn`, `stop_sequence` or `tool_use`: `stop` (blank text becomes `EMPTY_OUTPUT` through `checkResult`).
     - `max_tokens` or `model_context_window_exceeded`: `length` / `OUTPUT_LIMIT`, keeping text and usage.
     - `refusal`: `error` / `REFUSAL`. `pause_turn`, null or any other value: `error` / `UNEXPECTED_FINISH`.
     - `rawFinishReason` is the `stop_reason` whenever it is a string; `providerRequestId` is the message `id`.
     - Usage: `in` and `out` from `input_tokens` and `output_tokens`; `cacheRead` from `cache_read_input_tokens`; `cacheWrite5m` and `cacheWrite1h` from `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` when that breakdown exists, otherwise `cacheWrite5m` from `cache_creation_input_tokens` and `cacheWrite1h` null; any absent count is null; `source: 'reported'` when `in` and `out` are both numbers, `'partial'` when a usage object lacks either, `'unavailable'` when there is no usage object.
   - **`complete(req, ctx)`:** throws `ROUTE_UNSUPPORTED` unless `req.provider` is `claude` and `req.route` is `sync-api`, before any client call. Calls `client.messages.stream(req.payload, { signal: ctx.signal }).finalMessage()` (streaming, as today, because of the SDK's non-streaming timeout cap; never `messages.create`). A thrown error with a numeric `status` becomes `error` / `HTTP_ERROR` with `httpStatus`, `retryable` true for 408, 429 and 5xx and false for other statuses, and unavailable usage; any other thrown error becomes `error` / `PROVIDER_ERROR`, `retryable: false`.
   - **`submitBatch(reqs, ctx)`:** throws `ROUTE_UNSUPPORTED` if any request is not a Claude `batch-api` request, before any client call. Calls `client.messages.batches.create({ requests: reqs.map(r => ({ custom_id: r.customId, params: r.payload })) }, { signal })` and returns a `BatchHandle` with `remoteId` the batch `id`, `submittedAt` the batch `created_at`, `expiresAt` the batch `expires_at`, and one `{ customId, attemptId, stage, model }` per request in order.
   - **`getBatch(handle, ctx)`:** `processing_status` `ended` is `completed`; `in_progress` and `canceling` are `running`. Counts: `pending` is `processing`, `succeeded` is `succeeded`, `failed` is `errored + canceled + expired`.
   - **`results(handle, ctx)`:** iterates `await client.messages.batches.results(handle.remoteId, { signal })`. Row `succeeded`: the message mapping, with identity from the handle entry (`route: 'batch-api'`). `errored`: `PROVIDER_ERROR`, `providerCode` the inner `error.error.type`. `expired`: `BATCH_EXPIRED`. `canceled`: `CANCELLED`. Usage unavailable on the three failures. Unknown `custom_id` rows are skipped; each expected request with no row ends as `MISSING_RESULT`.
   - **Imports:** no `src/output.ts`, `src/batch.ts`, `src/repair.ts`, `src/quality.ts`, `src/state.ts`, `src/state-v2.ts` or `src/index.ts`; no `process.env` reads; never the Agent SDK.
2. **New `tests/unit/claude-api-adapter.test.ts`**, run by `npm test`: fixture-driven cases for tool choice (forced and auto), each finish-reason class, an HTTP 429 and a 400, and the batch-limit capabilities, against an injected fake client.

## Constraints

- No change to `src/providers.ts`, `src/batch.ts` or any caller: the legacy path keeps working until W12 and W14 switch entrypoints.
- No article saving, repair, validation or shared-loop logic in the adapter.
- No network and no paid API calls. Tests inject a client and a binding whose credential is a fixture string.
- The frozen test reads the module's raw source for its import and environment checks, so do not name the banned modules, `process.env` or the other banned strings even in comments.
- Frozen test 07 allows exactly one `type: 'json_schema'` literal under `src/`; this card needs none, so add none.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a cloned `node_modules`.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write sandbox, no network needed; the worker runs criteria 1 to 4 unsandboxed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/33-claude-api-adapter.test.ts` exits 0 with 11 passing. It covers the binding checks, capabilities, the batch and sync payloads (forced and auto tool choice, document and text sources, `wireBytes`), refused tiers, every message-mapping class and usage shape, streaming with the call signal, HTTP and network failures, route refusals before any client call, batch submit, status and collection by `custom_id`, and the import surface. Baseline on `dev`: red, 11 of 11 fail (first: `src/providers/claude-api.ts must exist`).
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/07-truncated-and-errored-responses-are-caught.test.ts tests/contract/22-normalised-provider-contract.test.ts` exits 0. Baseline on `dev`: green.
3. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
4. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/claude-api-adapter.test.ts`. Baseline on `dev`: green (125 tests).
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/33-claude-api-adapter.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Untested rules (verifier, reading):** image blocks follow their label in snapshot order; the SDK client is built from `binding.credential()` with `maxRetries: 0` only when none is injected; batch methods let transport errors throw; nothing in `src/providers.ts` is edited. Baseline: not applicable before the run.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/33-claude-api-adapter.test.ts`
- **Assertions digest:** `sha256:8f9fdd687de9a3bf3e3b679ccdb7606ea6f0b6fdaa5bdb82edbd6da6bdae8e4b`
- **Oracle proof:** On `dev` (`8bb4372`) all 11 tests fail because `src/providers/claude-api.ts` does not exist. A throwaway reference in a detached scratch worktree (a 190-line `src/providers/claude-api.ts` following Deliverable 1) passed all 11, `npx tsc --noEmit` was clean, `npm test` passed 125 of 125, and contract tests 07 and 22 stayed green. Mutations the test caught: always using auto tool choice, and treating only 5xx as retryable. The worktree was removed and pruned. The test writes its PDF fixture to the OS temp directory and stubs `fetch` to throw.

## Out of scope

- Chunking, chunk manifests and `REQUEST_TOO_LARGE` (W12); the shared finalise and repair seam (W10); cost and pricing (W11).
- The Agent SDK route (card 35) and any OpenAI route (cards 34, 36).
- Deleting or rewiring `ClaudeProvider` in `src/providers.ts` (W15).

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** tranche 1 in this repo: Sonnet 5.5 worker on card 23 at medium effort, about 1.2M tokens for a card of similar size; GPT-6.1 Sol verifiers 0.3M to 0.6M. Expect about 1.2M worker tokens: one module of about 200 lines plus a unit test.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported names of `src/providers/claude-api.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; make no network calls. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough; the tests write only under the OS temp directory. Clone `node_modules` as above if missing. Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree. Contract tests 26 to 28 fail in a run worktree because `input/_held/` is gitignored; that is unchanged from base and not a criterion here.

## Cold read

A read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It raised: batch transport failures were unspecified (now decision 5: thrown); which rule wins between an invalid tool and `max_tokens` (now stated: the tool rule first); image MIME types (now by extension); `usage.source` for partial usage (now stated); the SDK's default retries contradicting the design's safe-read rule (now `maxRetries: 0`, decision 5); `stop_sequence` acceptance (decision 6); and the raw-source checks catching comments (now a Constraint). It found no criterion the verifier seat cannot evidence.
