# Stage card 35-claude-subscription-adapter: the Agent SDK route returns structured output or a named failure, in an isolated, tool-free, bounded call

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/35-claude-subscription-adapter
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/providers/claude-subscription.ts, tests/unit/claude-subscription.test.ts
- **Pairing rationale:** Design 17 W7 marks this "Judgement": the worker must read the installed Agent SDK types, keep credentials and repository instructions out of the child, and get the abort, timeout and cleanup paths right. Claude Opus 5.5 at high effort is the judgement tier without the frontier one, and it knows this SDK's surface; GPT-6.1 Sol verifies from the other family at high effort. Stage 34 has a Codex worker and stage 36 another, so worker families alternate.
- **Open decisions:** none

## Surfacing concern

Design 17's `### Claude Code OAuth and the two SDKs` (`docs/design/provider-routes.md:751-788`) fixes the subscription route: the Claude Code OAuth credential goes only to the Agent SDK, never the raw API client; the call uses a temporary cwd, `settingSources: []`, `tools: []`, an explicit `systemPrompt`, `permissionMode: 'dontAsk'`, an abort controller, a sanitised `env`, `maxTurns` 3 and `outputFormat` with the stage 16 dialect; and no `maxBudgetUsd`. The mapping row is `:226`. Today's `createMessageViaCli` (`src/providers.ts:309-359`) uses `allowedTools: []`, `bypassPermissions`, `maxTurns: 1`, no `outputFormat`, inherits `process.env` and throws on any non-success subtype, losing usage. The installed SDK is `@anthropic-ai/claude-agent-sdk` 0.2.114; the design's citations hold on it: `outputFormat` at `sdk.d.ts:1402`, `tools` with "`[]` (empty array) - Disable all built-in tools" at `:1160-1168`, the result types at `:2878-2920` (`SDKResultError` subtypes `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`; `SDKResultSuccess` with `structured_output?`). Checked against `dev` at `8bb4372`.

Design decisions this card settles (none needed the operator):

1. **Factory and injected seams.** `createClaudeSubscriptionProvider(opts)` takes the `CredentialBinding`, `schemaFor(ref)` (the caller passes `contract/generated/model-output.claude.json`), `systemPrompt(stage)`, `sourceRoot`, `parentEnv` (the environment the child allowlist is drawn from; the adapter never reads `process.env` itself), an optional `query` typed `AgentQuery = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage>` (the SDK's own `query` satisfies it, since its `Query` is an async generator; tests inject a fake fed by fixture streams) and an optional `tmpRoot` (default `os.tmpdir()`). Without an injected `query`, the SDK is loaded lazily with a dynamic `import()` hidden from the CommonJS emitter, as `src/providers.ts:117` does; a type-only import of the SDK's `Options`, `SDKMessage` and `SDKUserMessage` is fine and resolves under `tsc`.
2. **The child environment is `childEnvironment(binding, parentEnv)`** from card 24's `src/routes.ts`: the allowlist plus `CLAUDE_CODE_OAUTH_TOKEN` from `binding.credential()`, with `assertSingleCredential` refusing anything else. It is always passed as `options.env`, because the SDK defaults to `process.env` when `env` is absent.
3. **Result mapping, in this order** (design `:226`): no `result` message, `MISSING_RESULT`; `success` with `is_error: true`, contradictory, `UNEXPECTED_FINISH`; `success` whose `stop_reason` is `max_tokens` or `model_context_window_exceeded`, `length` / `OUTPUT_LIMIT`; `success` whose `stop_reason` is a string other than `end_turn`, `stop_sequence` or `tool_use`, `UNEXPECTED_FINISH`; `success` without `structured_output`, `MISSING_OUTPUT` (keeping `result` as text); `success` otherwise (including a null `stop_reason`, which the installed types allow, `string | null`, beside the terminal `success` subtype), `stop` with `JSON.stringify(structured_output)` as text; the four error subtypes, their codes, whatever `stop_reason` says (so `error_max_turns` is never read as truncation); any other subtype, `UNEXPECTED_FINISH`. `rawFinishReason` is the result's `stop_reason` when it is a string, otherwise its `subtype`.
4. **Deadline and cancellation.** `ctx.deadline` arms a timer that aborts the SDK's controller; `ctx.signal` aborting does the same. An abort from the deadline returns `TIMEOUT`, from the caller `CANCELLED`, whatever the SDK then throws; any other thrown error is `SDK_EXECUTION`.
5. **Frozen test 07 trap.** Test 07 allows exactly one `type: 'json_schema'` literal under `src/` (the OpenAI format in `src/providers.ts:382`). The Agent SDK's `outputFormat` also has `type: 'json_schema'`, so name the value once in a constant (for example `const SDK_JSON_SCHEMA = 'json_schema' as const`) and write `outputFormat: { type: SDK_JSON_SCHEMA, schema }`. The reference hit this; criterion 2 checks it.

Runtime schema and turn behaviour stay unverified by this offline card (design `:786-788`); the capability says so with `schemaEvidence: 'unverified'`.

Cold read: see `## Cold read` at the end of this card.

## Objective

`src/providers/claude-subscription.ts` exports `createClaudeSubscriptionProvider`, an `LlmProvider` for `id: 'claude'` on `subscription-cli` only, whose `complete` runs one Agent SDK query in a fresh empty temporary directory with no tools, no settings, an allowlisted environment, three turns at most, the stage 16 dialect as `outputFormat` and a deadline, and returns structured output or a named failure with usage kept on every result subtype.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`:220-234` mapping, `### Claude Code OAuth and the two SDKs` `:751-788`, W7 `:1109-1114`)
- `src/llm-contract.ts`, `src/routes.ts` (`childEnvironment`, `CredentialBinding`)
- `src/providers.ts:117-130` and `:309-359` (today's lazy import and Agent SDK call)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` around `:1150-1190`, `:1350-1420` and `:2878-2920`
- `tests/contract/35-claude-subscription-adapter.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. **New `src/providers/claude-subscription.ts`**, exporting `AgentQuery`, `ClaudeSubscriptionOptions` and `createClaudeSubscriptionProvider(opts: { binding, schemaFor, systemPrompt, sourceRoot, parentEnv, query?, tmpRoot? }): LlmProvider`:
   - **Binding check, at construction:** anything but `{ provider: 'claude', surface: 'claude-agent-sdk', credentialKind: 'claude-oauth-token' }` throws `LlmContractError('MISSING_ROUTE_CREDENTIAL')` without reading the credential; an API-key binding never reaches this adapter.
   - **Identity and capabilities:** `id: 'claude'`, `routes: ['subscription-cli']`, passing `assertProviderCapabilities`, with `structured: 'strict'`, `schemaEvidence: 'unverified'`, `vision: true`, `pdfNative: true`, `batch: false`, `subscription: true`, `outputTokenLimit: 'advisory'`.
   - **`buildRequest(stage, item, plan)`:** `plan.tiers[stage]` must be a `claude` `subscription-cli` binding, else `ROUTE_UNSUPPORTED`. `payload` is `{ systemPrompt: systemPrompt(stage), content, schema: schemaFor(item.schema) }`, where `content` is the same block list as the Claude API adapter: a base64 `document` block for a PDF snapshot (read from `sourceRoot`) or a `text` block of `source.text`, each image's label `text` block then its base64 `image` block, and last a `text` block of `item.instruction`. `wireBytes` is `Buffer.byteLength(JSON.stringify(payload))`.
   - **`complete(req, ctx)`:** `ROUTE_UNSUPPORTED` unless a Claude `subscription-cli` request. Creates a fresh empty directory with `mkdtemp` under `tmpRoot` and calls `query({ prompt, options })` once, where `prompt` is an async iterable yielding one `{ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }` and `options` is exactly: `model`, `systemPrompt`, `cwd` (the new directory), `settingSources: []`, `tools: []`, `permissionMode: 'dontAsk'`, `maxTurns: 3`, `outputFormat` with type `json_schema` and the payload `schema` (the type written through the constant of decision 5), `abortController`, `env: childEnvironment(binding, parentEnv)`; no `maxBudgetUsd`. It reads messages until the first `type: 'result'` message and maps it by decision 3; usage from the result's `usage` by the same rule as the Claude API adapter (`in`, `out`, `cacheRead` from `cache_read_input_tokens`, the two write fields from the `cache_creation` breakdown or else `cache_creation_input_tokens` and null), `source: 'reported'`; unavailable usage when there is no result. `providerRequestId` is the result's `session_id`. Every result goes through `checkResult`. The directory is removed and the timer and abort listener cleared in a `finally`, on every path.
   - **`submitBatch`, `getBatch` and `results`** throw `ROUTE_UNSUPPORTED` before any query.
   - **Imports:** never `@anthropic-ai/sdk`; no runtime `import` or `require` of the Agent SDK at module load (type-only is fine); no `src/output.ts`, `src/batch.ts`, `src/repair.ts`, `src/quality.ts` or `src/state.ts`.
2. **New `tests/unit/claude-subscription.test.ts`**, run by `npm test`: fixture streams for success with structured output, `error_max_turns`, missing structured output and a timeout, with a fake `query`.

## Constraints

- No change to `src/providers.ts`, `src/routes.ts`, `src/llm-contract.ts` or any caller; `createMessageViaCli` keeps working until W14 switches entrypoints.
- No raw API fallback on any failure; no real token reads; no paid or subscription calls in tests.
- The frozen test reads the module's raw source for its import and environment checks, so do not name the banned modules, `process.env` or the other banned strings even in comments.
- Write the `json_schema` type through a constant (decision 5); frozen test 07 must stay green.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a cloned `node_modules`.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write sandbox, no network needed (the test injects `query`, starts no process and writes only under the OS temp directory; it passed under the Codex seatbelt sandbox); the worker runs criteria 1 to 4 unsandboxed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/35-claude-subscription-adapter.test.ts` exits 0 with 8 passing. It covers the binding check, capabilities, the request and refused tiers, the named query options (tools, settings, permission mode, turns, no budget, output format, abort controller, empty temporary cwd removed afterwards, allowlisted env carrying the binding token), the user message content, the success mapping and usage, all four error subtypes, token and context exhaustion, missing structured output, a contradictory success, an unknown subtype, no terminal result, an SDK throw, deadline and caller aborts, each leaving no temporary directory, batch refusals, and the import surface. Baseline on `dev`: red, 8 of 8 fail (first: `src/providers/claude-subscription.ts must exist`).
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/07-truncated-and-errored-responses-are-caught.test.ts tests/contract/22-normalised-provider-contract.test.ts` exits 0. Baseline on `dev`: green.
3. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
4. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/claude-subscription.test.ts`. Baseline on `dev`: green (125 tests).
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/35-claude-subscription-adapter.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Untested rules (verifier, reading):** the SDK is loaded lazily only when no `query` is injected; `options` carries no keys beyond those listed in Deliverable 1; a text source sends a `text` block; image blocks follow their label; a `success` with an unlisted string `stop_reason` maps to `UNEXPECTED_FINISH`; nothing outside the deliverables is edited. Baseline: not applicable before the run.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/35-claude-subscription-adapter.test.ts`
- **Assertions digest:** `sha256:694edf6ae91063fcb646cc2373968d25d1e667be89be765c79b58ff21698bc31`
- **Oracle proof:** On `dev` (`8bb4372`) all 8 tests fail because `src/providers/claude-subscription.ts` does not exist. A throwaway reference in a detached scratch worktree (a 140-line module following Deliverable 1) passed all 8, `npx tsc --noEmit` was clean (the type-only SDK import resolves), `npm test` passed 125 of 125, and contract tests 07 and 22 passed once the `json_schema` literal was moved into a constant (decision 5); tests 35 and 36 also passed together under `codex sandbox` with workspace-write. Mutations the test caught: `maxTurns: 1`, and passing the parent environment through. The worktree was removed and pruned. Fixture result messages use the installed SDK's real `SDKResultSuccess` and `SDKResultError` fields; the `init` system and assistant messages are abbreviated, because the adapter reads only the result. The result messages carry `duration_ms`, `num_turns`, `result`, `stop_reason`, `total_cost_usd`, `usage` with the `cache_creation` breakdown, `modelUsage`, `permission_denials`, `uuid` and `session_id`.

## Out of scope

- Live subscription calls or any proof that a generated schema works at runtime (no card in this tranche; W9 covers Codex only).
- The raw Claude API route (card 33); vision bindings and figure work (W13).
- Removing `createMessageViaCli` from `src/providers.ts` (W15).

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** tranche 1 in this repo: Opus 5.5 worker on card 25 at high effort about 1.5M tokens; GPT-6.1 Sol verifiers 0.3M to 0.6M. Expect about 1.3M worker tokens: one module of about 150 lines plus a unit test, with SDK type reading.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported names of `src/providers/claude-subscription.ts` and the final `options` object `complete` passes.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; make no network calls and start no real Agent SDK session. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough. Clone `node_modules` as above if missing. Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree. Contract tests 26 to 28 fail in a run worktree because `input/_held/` is gitignored; that is unchanged from base and not a criterion here.

## Cold read

A read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It raised: a `success` with an unknown `stop_reason` passing as `stop` (now `UNEXPECTED_FINISH`, decision 3, with null accepted and why); the `AgentQuery` type (now spelled out, decision 1); criterion 1 overstating coverage (reworded; the untested rules moved to criterion 6); the `init` fixture not being a full SDK shape (the oracle proof now says so); a timing-fragile timeout assertion (the test now uses a 300 ms deadline and checks the temp root is empty instead of reading the first query's cwd; re-proven red 8 of 8 and green 8 of 8, new digest); and raw-source checks catching comments (now a Constraint). It found no criterion the verifier seat cannot evidence.
