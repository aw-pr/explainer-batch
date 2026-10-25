# Stage card 34-openai-api-adapter: one OpenAI API adapter sends strict-schema Responses requests, reuses cached files safely and collects batches by custom ID

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/34-openai-api-adapter
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/providers/openai-api.ts, tests/unit/openai-api-adapter.test.ts
- **Pairing rationale:** Design 17 W6 marks this "Mechanical, Sonnet or Terra tier": the Responses and Batch mappings, the file-cache rules and the JSONL envelope are all written below and pinned by the frozen test, and the HTTP logic moves from `src/providers.ts`. GPT-6.1 Sol at medium effort fits and keeps Codex spend low; Claude Opus 5.5 verifies from the other family at high effort, because the cache-validity and duplicate-row rules reward a careful reader. Stage 33 has a Claude worker and stage 35 another, so worker families alternate.
- **Open decisions:** none

## Surfacing concern

Design 17 (`docs/design/provider-routes.md`) puts every vendor behind one `LlmProvider` boundary (`## Provider interface`, `:79-234`). Today the OpenAI API transport lives in `OpenAIProvider` (`src/providers.ts:392-636`): it finds an API key inside `~/.codex/auth.json` (`:92-106`), collapses batch rows into `succeeded | errored` strings, reads rows in arrival order and keeps the file cache in `src/batch.ts:415-433`. W6 replaces that with an adapter that takes a direct API binding only, normalises every row and response by the OpenAI rows of the mapping table (`:224-225`), reads both result files keyed by `custom_id`, and uses an injected file-cache service built on card 25's `file_cache[provider][accountScope][purpose][sha256]` (`:577-590`). Checked against `dev` at `8bb4372`.

Design decisions this card settles (none needed the operator):

1. **Factory and injected seams.** `createOpenAiApiProvider(opts)` takes the `CredentialBinding`, a `fileCache` service, an `accountScope` (string, or null to disable cross-run reuse as `:581-582` requires when no reliable scope exists), `schemaFor(ref)` (the caller passes `contract/generated/model-output.openai.json`), `systemPrompt(stage)`, `sourceRoot`, an optional `transport` and an optional `now` clock. The transport has three methods, `request(method, path, body?, signal?)`, `text(path, signal?)` and `upload(purpose, filename, bytes, signal?)`, each resolving `{ status, body }` without throwing on HTTP status; the default uses `fetch` against `https://api.openai.com/v1` with `binding.credential()` as the bearer token. The cache service has `get`, `put` and `invalidate`, each keyed `(provider, accountScope, purpose, sha256)` in the argument order of card 25's `fileCacheGet` and `fileCachePut`, so W12 can back it with `transactState`.
2. **Cache validity.** A cached entry is reused only when it has no `expiresAt` or expires at or after now + window + 5 minutes, where the window is 24 hours for `batch-api` and `plan.callTimeoutMs[stage]` for `sync-api` (`:584-587`), and only after `GET /files/{id}` answers 2xx. A 404, or an entry expiring too soon, is invalidated and the PDF re-uploaded; any other non-2xx status throws `HTTP_ERROR` and never re-uploads ("an auth error fails the binding rather than causing endless reuploads", `:588`).
3. **Duplicate rows.** Identical duplicate rows for one `custom_id` collapse to one result; differing rows yield `error` / `RESULT_CONFLICT` for that request (`:224`: "Duplicate contradictory rows fail reconciliation"). Results are yielded in handle order, never arrival order.
4. **Chunking stays in the orchestrator** (W12), as for card 33: this card declares the limits and measures `wireBytes`.
5. **Validity is judged when the request is built.** The design measures validity to the batch's completion deadline or the call's own deadline (`:584-587`); `buildRequest` cannot see either, so it uses now + window. W12 builds requests immediately before submission, so the gap is the chunk's own build time, well inside the 5-minute margin. Batch transport failures throw `HTTP_ERROR` for the polling policy (`:199-201`); only `complete` returns failures as results.
6. **The strict format is reused:** the adapter imports `openAIJsonSchemaFormat` from `src/providers.ts`, because frozen test 07 allows exactly one `type: 'json_schema'` literal under `src/`.

Cold read: see `## Cold read` at the end of this card.

## Objective

`src/providers/openai-api.ts` exports `createOpenAiApiProvider`, an `LlmProvider` for `id: 'openai'` on `batch-api` and `sync-api` that builds strict-schema Responses requests with the full source (an uploaded PDF file or the source text), submits batches as JSONL, polls them, collects both result files by `custom_id`, completes sync calls, and maps every outcome to a `NormalizedResult` that already satisfies `checkResult`.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`## Provider interface` `:79-234`, `### File cache and legacy migration` `:577-590`, W6 `:1102-1107`)
- `src/llm-contract.ts`, `src/routes.ts`, `src/state-v2.ts:54-62` and `:492-506` (the `FileCacheEntry` shape and cache functions)
- `src/providers.ts:362-636` and `src/batch.ts:195-210`, `:415-435` (today's OpenAI transport, content and cache use)
- `contract/generated/model-output.openai.json`
- `tests/contract/34-openai-api-adapter.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. **New `src/providers/openai-api.ts`**, exporting `OpenAiTransport`, `OpenAiFileCache`, `OpenAiApiOptions` and `createOpenAiApiProvider(opts: { binding, fileCache, accountScope, schemaFor, systemPrompt, sourceRoot, transport?, now? }): LlmProvider`:
   - **Binding check, at construction:** anything but `{ provider: 'openai', surface: 'openai-api', credentialKind: 'openai-api-key' }` throws `LlmContractError('MISSING_ROUTE_CREDENTIAL')` without reading the credential. With an injected transport the credential is never read.
   - **Identity and capabilities:** `id: 'openai'`, routes `batch-api` and `sync-api`, passing `assertProviderCapabilities`. Both routes: `structured: 'strict'`, `schemaEvidence: 'fixture'`, `vision: true`, `pdfNative: true`, `outputTokenLimit: 'enforced'`. `batch-api` adds `maxBatchRequests` (at most 10000), `maxBatchBytes` (at most 100000000) and `completionWindowMs: 86400000`.
   - **`buildRequest(stage, item, plan)`:** takes `plan.tiers[stage]`; null, a non-`openai` provider or a route other than `batch-api` or `sync-api` throws `ROUTE_UNSUPPORTED` before any transport call. `payload` is the Responses body `{ model, max_output_tokens, instructions: systemPrompt(stage), input: [{ role: 'user', content }], text: { format: openAIJsonSchemaFormat(schemaFor(item.schema)) } }`, so `text.format` is `{ type: 'json_schema', name: 'explainer', strict: true, schema }`. `content` is, in order: `{ type: 'input_file', file_id }` when the snapshot has a PDF, otherwise `{ type: 'input_text', text: source.text }`; for each image an `input_text` label then `{ type: 'input_image', image_url: 'data:image/<type>;base64,...' }`; last `{ type: 'input_text', text: item.instruction }`. `wireBytes` is `Buffer.byteLength(JSON.stringify({ custom_id, method: 'POST', url: '/v1/responses', body })) + 1` on `batch-api` (the JSONL line and its newline) and `Buffer.byteLength(JSON.stringify(body))` on `sync-api`.
   - **PDF file ID** (purpose `user_data`, cache key `('openai', accountScope, 'user_data', source.pdf.sha256)`): with a non-null scope, look up the entry and apply decision 2. To upload, call `transport.upload('user_data', basename(relativePath), bytes)` with the bytes read from `sourceRoot`; a non-2xx answer throws `HTTP_ERROR`; then `put` `{ fileId: body.id, sizeBytes: bytes.length, uploadedAt: now().toISOString() }`, plus `expiresAt` as ISO when the file's `expires_at` is a number (Unix seconds). With a null scope, never call the cache and always upload.
   - **Responses mapping** (sync bodies and 2xx batch bodies), every result through `checkResult`, `providerRequestId` the body `id`:
     - Text: every `output_text` part of every `type: 'message'` output item, joined with `\n`.
     - `completed`: a `refusal` content part gives `error` / `REFUSAL`; otherwise `stop` (blank text becomes `EMPTY_OUTPUT`).
     - `incomplete`: `incomplete_details.reason` `max_output_tokens` gives `length` / `OUTPUT_LIMIT`; `content_filter` gives `error` / `CONTENT_FILTER`; any other reason `error` / `INCOMPLETE_RESPONSE`. `rawFinishReason` is `incomplete:<reason>`.
     - `failed`: `error` / `PROVIDER_ERROR` with `providerCode` from `body.error.code`. `cancelled`: `error` / `CANCELLED`. Any other or missing status: `error` / `UNEXPECTED_FINISH`.
     - Otherwise `rawFinishReason` is the status string when it is one.
     - Usage: `in` and `out` from `input_tokens` and `output_tokens`, `cacheRead` from `input_tokens_details.cached_tokens`, both cache-write fields null, `source: 'reported'` when `in` and `out` are numbers; kept on failed results.
   - **HTTP precedence:** a non-2xx status gives `error` / `HTTP_ERROR` with `httpStatus`, `retryable` true for 408, 429 and 5xx and false otherwise, whatever the body says.
   - **`complete(req, ctx)`:** `ROUTE_UNSUPPORTED` unless an OpenAI `sync-api` request, before any transport call. `transport.request('POST', '/responses', req.payload, ctx.signal)`, then HTTP precedence, then the Responses mapping. A thrown transport error becomes `error` / `PROVIDER_ERROR`, `retryable: false`.
   - **`submitBatch(reqs, ctx)`:** `ROUTE_UNSUPPORTED` if any request is not an OpenAI `batch-api` request, before any transport call. Upload one JSONL file, each line `JSON.stringify({ custom_id, method: 'POST', url: '/v1/responses', body: payload })`, lines joined with `\n` and ending in `\n`, by `transport.upload('batch', 'batch-input.jsonl', bytes, signal)`; then `transport.request('POST', '/batches', { input_file_id, endpoint: '/v1/responses', completion_window: '24h' }, signal)`. A non-2xx answer at either step throws `HTTP_ERROR`. The handle's `submittedAt` and `expiresAt` are the batch's `created_at` and `expires_at` (Unix seconds) as ISO strings.
   - **`getBatch(handle, ctx)`:** `GET /batches/{id}`; non-2xx throws `HTTP_ERROR`. Status: `validating` is `queued`; `in_progress`, `finalizing` and `cancelling` are `running`; `completed`, `failed`, `cancelled` and `expired` keep their names. Counts from `request_counts`: `succeeded` is `completed`, `failed` is `failed`, `pending` is `total - completed - failed`, floored at 0.
   - **`results(handle, ctx)`:** `GET /batches/{id}`, then `transport.text('/files/{id}/content')` for `output_file_id` and `error_file_id` when present (non-2xx throws `HTTP_ERROR`). Parse every non-blank JSONL line; skip a line that is not JSON or has no string `custom_id`. Then, for each handle request in order: no row gives `MISSING_RESULT` (usage unavailable); more than one distinct row gives `RESULT_CONFLICT`; a row with a non-null `error` gives `PROVIDER_ERROR` with `providerCode` `error.code`; a row whose `response.status_code` is missing or not a number gives `MALFORMED_RESULT`; a 2xx row with no object body gives `MALFORMED_RESULT`; otherwise HTTP precedence then the Responses mapping.
   - **Imports and reads:** no `src/output.ts`, `src/batch.ts`, `src/repair.ts`, `src/quality.ts`, `src/state.ts` or `src/index.ts` (a type-only import from `src/state-v2.ts` for `FileCacheEntry` is fine); no `process.env`; no `.codex` or `auth.json` lookup; no lane support.
2. **New `tests/unit/openai-api-adapter.test.ts`**, run by `npm test`: fixture cases for a strict-schema request, shuffled batch rows, an HTTP 429, an incomplete response and a 404 cache invalidation, against a fake transport and cache.

## Constraints

- No change to `src/providers.ts`, `src/batch.ts`, `src/state.ts`, `src/state-v2.ts` or any caller.
- No article saving, repair or validation in the adapter.
- No network and no paid API calls; tests inject the transport, the cache and a fixture credential.
- The frozen test reads the module's raw source for its import and environment checks, so do not name the banned modules, `process.env` or the other banned strings even in comments.
- Frozen test 07 allows exactly one `type: 'json_schema'` literal under `src/`; reuse `openAIJsonSchemaFormat` and add none.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a cloned `node_modules`.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Opus 5.5 verifier through the Claude CLI, no network needed. The worker runs criteria 1 to 4 in its Codex workspace-write sandbox, which is enough (no network; writes only under the worktree and the OS temp directory).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/34-openai-api-adapter.test.ts` exits 0 with 11 passing. It covers the binding check, capabilities, the strict-schema payload and `wireBytes` for both routes, the six file-cache rules, every Responses-mapping class, HTTP precedence and network failure, route refusals before any transport call, JSONL submit, status mapping and a failed poll, collection in manifest order with HTTP, row-error, conflicting and identical duplicate, malformed and missing rows, and the import and lookup surface. Baseline on `dev`: red, 11 of 11 fail (first: `src/providers/openai-api.ts must exist`).
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/07-truncated-and-errored-responses-are-caught.test.ts tests/contract/22-normalised-provider-contract.test.ts` exits 0. Baseline on `dev`: green.
3. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
4. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/openai-api-adapter.test.ts`. Baseline on `dev`: green (125 tests).
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/34-openai-api-adapter.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Untested rules (verifier, reading):** image parts follow their label in snapshot order; the default transport sends `Authorization: Bearer` from `binding.credential()` and is built only when none is injected; nothing in `src/providers.ts` or `src/batch.ts` is edited. Baseline: not applicable before the run.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/34-openai-api-adapter.test.ts`
- **Assertions digest:** `sha256:47dd999be87109573f70a828daa74a0eebcb82b54c866e38d830bdac31fae734`
- **Oracle proof:** On `dev` (`8bb4372`) all 11 tests fail because `src/providers/openai-api.ts` does not exist. A throwaway reference in a detached scratch worktree (a 230-line `src/providers/openai-api.ts` following Deliverable 1) passed all 11, `npx tsc --noEmit` was clean, `npm test` passed 125 of 125, and contract tests 07 and 22 stayed green. Mutations the test caught: collapsing contradictory duplicates, and ignoring the call window in cache validity. The worktree was removed and pruned. The fixtures model real API shapes: `file` objects with Unix-second `created_at` and nullable `expires_at`, Responses bodies with a `reasoning` item before the `message`, and batch rows `{ id, custom_id, response: { status_code, request_id, body }, error }`, including the error-file shape for an expired row (`response: null`, `error: { code: 'batch_expired' }`).

## Out of scope

- Chunking and `REQUEST_TOO_LARGE` (W12), the finalise seam (W10), cost (W11).
- The Codex subscription route (card 36) and any lane path; removing `OpenAIProvider` or the auth-file key lookup from `src/providers.ts` (W15).
- Wiring the cache service to `state.json` (W12).

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** tranche 1 in this repo: GPT-6.1 Sol workers on cards 22 and 24 used 1.0M to 1.4M tokens at high effort; Opus 5.5 verifiers about 0.5M. Expect about 1.2M worker tokens at medium effort: one module of about 250 lines plus a unit test.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported names of `src/providers/openai-api.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the tests write only under the OS temp dir and stub `fetch`. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree. Contract tests 26 to 28 fail in a run worktree because `input/_held/` is gitignored; that is unchanged from base and not a criterion here.

## Cold read

A read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It raised: cache validity measured at build time rather than at the submission or call deadline (now decision 5, a deliberate choice with its reason); and the raw-source checks catching comments that mention lanes or `auth.json` (now a Constraint). It had no open questions and found no criterion the verifier seat cannot evidence.
