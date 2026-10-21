# Stage card 22-normalised-provider-contract: one typed contract module defines the provider boundary, its error codes and its result checks

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/22-normalised-provider-contract
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/llm-contract.ts, tests/unit/llm-contract.test.ts
- **Pairing rationale:** Judgement work (design 17 W1 marks it so): the result-check rules and manifest identity are the contract every later provider card builds on, but the whole deliverable is one new self-contained module with its rules written out below, so GPT-6.1 Sol at high effort fits without the frontier tier. The verifier is from the other family (Claude Opus 5.5), judgement-capable for checking a type surface against the design document. First card of design 17's tranche, so it sets the worker-family alternation for 23 (Claude) to 25.
- **Open decisions:** none

## Surfacing concern

Design 17 (`docs/design/provider-routes.md`, landed at `798d9d4`) replaces today's provider-specific code paths with one normalised boundary. Its W1 card is the foundation: `## Provider interface` (`:79-234`) gives the proposed signatures, the per-route finish-reason table (`:220-229`) and the rule that "`stop` means transport completion, not valid content. Empty output, missing output and unknown terminal statuses are errors. No adapter sets a request to succeeded" (`:215-218`). `## State and resume` (`:525-530`) defines the manifest identity: a request key hashed from run ID, source digest, plan/schema digest and stage; an attempt ID adding a monotonic attempt number; a bounded custom ID checked for collisions; and re-collect idempotency on `(runId, customId, attemptId)` plus a receipt digest, with contradictory duplicates `RESULT_CONFLICT`.

On `dev` (`77909f6`) none of this exists: `src/providers.ts` returns vendor-shaped objects, and no module names the error codes the design lists across `## Provider interface`, `## Routes and selection` (`:281-292`), `## Run plan and tiers`, `## State and resume` and `## Registry`. Cards 23, 24 and 25 throw these codes, so W1 defines them once.

Design decisions this card settles (none needed the operator):

1. **The codes live in one place.** `ERROR_CODES` lists every code the design names, plus three it implies but does not spell: `EMPTY_OUTPUT` (stop with no text), `CUSTOM_ID_COLLISION` (the manifest check) and `INVALID_CAPABILITIES` (the `routes` versus `byRoute` rule at `:194`).
2. **`RunPlan` and `StageBinding` are declared here, not in card 24,** because `LlmProvider.buildRequest` takes a `RunPlan`. Card 24 builds plans; this card only declares the type. Two deviations from the design's snippets, both deliberate: `tiers.vision` is `StageBinding | null` with an optional `visionDisabledReason`, because `:359-361` requires an optional figure to carry "an explicit disabled-with-reason plan decision"; and `NormalizedError.code` is typed `ErrorCode` rather than `string` (`:159`), so an adapter cannot invent a code.
3. **Identity errors throw; content errors return.** A candidate result whose identity fields are missing or invalid is an adapter bug and throws `MALFORMED_RESULT`. Everything else becomes an `error` result that keeps the text and usage, because the design preserves "usable text for diagnosis and usage for accounting even when generation failed" (`:215-216`).

Cold read: a read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It raised: the `ErrorCode` typing conflicting with the fidelity criterion (now a recorded deviation, decision 2); rules the oracle does not exercise (`providerCode` carry-through, a non-string error message, non-empty synthesised messages, canonical key order in `resultDigest`, the `JsonObject` and `ErrorCode` exports, `ERROR_CODES` being an array): these stay required and are judged by reading in criterion 5; nothing else was open.

## Objective

`src/llm-contract.ts` exports the design's domain types, one error-code list with a typed error class, `checkResult` (the result boundary every adapter's output passes through), capability validation, and the manifest identity functions. It is transport-free: no SDK, filesystem, process or environment access.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`## Provider interface`, `## Routes and selection` refusal table, `## Run plan and tiers` first code block, `## State and resume` "Writes, ownership and idempotency")
- `src/providers.ts` (today's `ProviderName` and vendor result shapes, for naming only; do not change it)
- `tests/contract/22-normalised-provider-contract.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. **New `src/llm-contract.ts`**, exporting:
   - Types exactly as in the design's `## Provider interface` block: `ProviderId`, `Route`, `ImmediateRoute`, `Stage`, `SchemaRef`, `JsonObject`, `RouteCapabilities`, `ProviderCapabilities`, `SourceSnapshot`, `PreparedItem`, `ProviderRequest`, `CallContext`, `BatchHandle`, `BatchSnapshot`, `TokenUsage`, `NormalizedError`, `NormalizedResult`, `LlmProvider`; plus `StageBinding` and `RunPlan` from `## Run plan and tiers`, with `tiers.vision: StageBinding | null` and `visionDisabledReason?: string`. `NormalizedError.code` is typed as `ErrorCode`.
   - `ERROR_CODES` (a readonly array, no duplicates) containing at least: `ROUTE_UNSUPPORTED`, `PROVIDER_ERROR`, `BATCH_EXPIRED`, `CANCELLED`, `MISSING_RESULT`, `UNEXPECTED_TOOL`, `OUTPUT_LIMIT`, `REFUSAL`, `UNEXPECTED_FINISH`, `HTTP_ERROR`, `MALFORMED_RESULT`, `CONTENT_FILTER`, `INCOMPLETE_RESPONSE`, `SDK_EXECUTION`, `TURN_LIMIT`, `BUDGET_LIMIT`, `STRUCTURED_OUTPUT_RETRIES`, `CLI_EXIT`, `TIMEOUT`, `CLI_FAILURE`, `MISSING_OUTPUT`, `EMPTY_OUTPUT`, `RESULT_CONFLICT`, `CUSTOM_ID_COLLISION`, `INVALID_CAPABILITIES`, `INVALID_ROUTE_PREFERENCE`, `UNKNOWN_PROVIDER`, `PROVIDER_DISABLED`, `CLAUDE_OAUTH_WRONG_SURFACE`, `MIXED_BILLING_CREDENTIALS`, `CODEX_AUTH_NOT_SUBSCRIPTION`, `MISSING_ROUTE_CREDENTIAL`, `NO_USABLE_ROUTE`, `MODEL_ROUTE_UNSUPPORTED`, `MODEL_PROVIDER_MISMATCH`, `UNKNOWN_MODEL`, `CONFLICTING_ROUTE_FLAGS`, `CONFLICTING_MODEL_OVERRIDE`, `RUN_PROVIDER_MISMATCH`, `LOCAL_RUN_REQUIRES_RESUME`, `REGISTRY_INVALID`, `REGISTRY_NOT_FOUND`, `REGISTRY_UNAVAILABLE`, `PRICE_REVIEW_DUE`, `STATE_CORRUPT`, `STATE_VERSION_UNSUPPORTED`, `STATE_BUSY`, `OUTPUT_COLLISION`. `ErrorCode` is the union of its members.
   - `class LlmContractError extends Error` with `constructor(code: ErrorCode, message: string)`, a readonly `code`, and a message that includes the given text.
   - `checkResult(candidate: unknown): NormalizedResult`, which never mutates its input and applies these rules in order:
     1. Not an object, or `provider` not a `ProviderId`, `route` not a `Route`, `stage` not a `Stage`, or `model`, `customId`, `attemptId` not non-empty strings: throw `LlmContractError('MALFORMED_RESULT', ...)`.
     2. `usage` is kept when `in`, `out`, `cacheRead`, `cacheWrite5m` and `cacheWrite1h` are each `null` or a non-negative integer and `source` is `reported`, `partial` or `unavailable`; otherwise it becomes `{ in: null, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, source: 'unavailable' }`. Bad usage alone never fails a result.
     3. `text`, `providerRequestId` and `rawFinishReason` are carried through when they are strings.
     4. `finishReason: 'stop'`: if an `error` is also present, return `finishReason: 'error'` with `MALFORMED_RESULT`; if `text` is missing or blank after trimming, return `finishReason: 'error'` with `EMPTY_OUTPUT`; otherwise return the stop result.
     5. `finishReason: 'length'` or `'error'`: keep the finish reason; keep `error` when its `code` is in `ERROR_CODES`, `message` is a string and `retryable` is a boolean (carry `httpStatus` and `providerCode` when present); otherwise replace it with `MALFORMED_RESULT`.
     6. Any other or missing finish reason: return `finishReason: 'error'` with `UNEXPECTED_FINISH`; when `rawFinishReason` was absent and the finish reason was a string, record it as `rawFinishReason`.
     Every error the function synthesises has `retryable: false` and a non-empty `message`.
   - `assertProviderCapabilities(p: { id, routes, capabilities })`: throws `INVALID_CAPABILITIES` unless `id` is a `ProviderId`, `routes` equals the key set of `capabilities.byRoute` (same members, no extras either way), every key is a `Route`, the enum fields hold allowed values, `batch` is true exactly on `batch-api` and `subscription` is true exactly on `subscription-cli`.
   - `assertRouteSupported(p: { id, routes }, route)`: throws `ROUTE_UNSUPPORTED` when `route` is not in `routes`.
   - `requestKey({ runId, sourceDigest, planDigest, schemaDigest, stage }): string`: a deterministic hash in which every field matters and field boundaries cannot alias (hash an encoding such as a JSON array, not a plain concatenation).
   - `attemptIdFor(key, attempt)`: deterministic, distinct per attempt number; throws on an attempt number that is not a positive integer.
   - `customIdFor(key)`: deterministic, matching `^[A-Za-z0-9_-]{1,64}$` (the stricter of the two providers' `custom_id` rules), with enough hash bits that 500 distinct keys never collide.
   - `assertNoCustomIdCollision(manifest: Record<string, string>, customId, key)`: throws `CUSTOM_ID_COLLISION` when the manifest maps `customId` to a different key; the same key again is not a collision.
   - `resultDigest(result)`: a deterministic digest string of a checked result (canonical key order), different when any field differs.
   - `reconcileResult(runId, existing: { runId, customId, attemptId, digest } | undefined, incoming): 'new' | 'duplicate'`: `new` when there is no existing receipt or it is for another run, custom ID or attempt; `duplicate` when the digests match; otherwise throw `RESULT_CONFLICT`.
   The module imports nothing but `crypto` (or `node:crypto`) and does not read `process.env`.
2. **New `tests/unit/llm-contract.test.ts`:** the design's shared fixtures, one per terminal class in the `:220-229` table that this card's rules cover (stop, empty stop, length, error, unknown reason, invalid usage), runnable by `npm test`.

## Constraints

- No vendor wire mapping: that belongs to the adapter cards (design 17 W5 to W8). This card does not import or change `src/providers.ts`, `src/batch.ts` or any caller.
- No orchestrator, no I/O, no environment reads in `src/llm-contract.ts`.
- `ProviderName` in `src/providers.ts` stays as it is; `ProviderId` is the new, wider type.
- No network and no paid API calls while working.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Opus 5.5 verifier through the Claude CLI; no network needed. The worker runs criteria 1 to 3 in its Codex workspace-write sandbox, which is enough (no network, writes only under the worktree and the OS temp dir).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/22-normalised-provider-contract.test.ts` exits 0. It covers the error-code list and class, the `checkResult` rules (stop, empty and contradictory stop, length and error with valid, missing and unknown errors, unknown and missing finish reasons, invalid and partial usage, bad identity, no mutation), capability validation, the request key, attempt and custom IDs, the collision check, reconciliation, and the import and type-export surface. Baseline on `dev`: red, 14 of 14 fail (first: `src/llm-contract.ts must exist`).
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/llm-contract.test.ts`. Baseline on `dev`: green (1 test).
4. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/22-normalised-provider-contract.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
5. **Design fidelity and untested rules (verifier, reading):** every type in Deliverable 1 matches the design's signature field for field, apart from the two deviations in decision 2; `ERROR_CODES` is a readonly array and `JsonObject` and `ErrorCode` are exported; `checkResult` carries `providerCode` and `httpStatus`, treats a non-string `message` as invalid and gives every synthesised error a non-empty message; `resultDigest` is independent of key insertion order. Baseline: not applicable before the run.
6. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/22-normalised-provider-contract.test.ts`
- **Assertions digest:** `sha256:9391640e0b2381cfcf6270841b2fef816e64187610b2f1a2363fe5d6bbc9b525`
- **Oracle proof:** On `dev` (`77909f6`) all 14 tests fail because `src/llm-contract.ts` does not exist. A throwaway reference in a detached scratch worktree (a 230-line `src/llm-contract.ts` following Deliverable 1) passed all 14, `npx tsc --noEmit` was clean, and every wave-1 contract test still passed; the worktree was removed and pruned. Trap the reference hit: the transport-free check reads every import specifier, so a provider name such as `'openai'` appearing as a string literal is fine but importing anything other than `crypto` fails.

## Out of scope

- Mapping vendor responses (Claude, OpenAI, Codex, Agent SDK, Gemini) to `NormalizedResult`: adapter cards.
- Routes, credentials and run-plan construction (card 24), the registry (card 23), state and locks (card 25).
- Any change to `src/providers.ts`, `src/batch.ts`, `src/index.ts` or the CLI.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** this repo's cost log: no GPT-6.1 Sol worker runs yet (Terra worker median about 0.56M tokens); Opus 5.5 verifier median about 0.93M. Expect about 1.5M worker tokens: one new module of about 250 lines plus its unit test, every rule written above.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported names of `src/llm-contract.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 3 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the tests write only under the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
