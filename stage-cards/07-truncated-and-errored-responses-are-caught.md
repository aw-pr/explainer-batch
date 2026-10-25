# Stage card 07-truncated-and-errored-responses-are-caught: a truncated or failed model response is an error, not a result

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/07-truncated-and-errored-responses-are-caught
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Depends on:** 01-contract-tests-run-with-npm-test
- **Dispatch:** serial
- **Pairing rationale:** Four small, well-located checks in the provider layer plus one shared format helper: mechanical, so the cheap Codex tier writes it and the cheap Claude tier checks it from the other family. Card 06 has an Opus worker and card 08 a Sonnet worker, so worker families alternate. Serial because it edits `src/providers.ts` and `src/batch.ts`, which cards 05, 06, 08 and later also edit.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19, plan item 12, the medium findings at `src/providers.ts:154` and `src/providers.ts:522`. Lines checked against `dev` at 0cd17d7; `grep -rnE "stop_reason|incomplete|status_code" src` finds nothing.

- Claude: `extractClaudeText` (`src/providers.ts:154`) stringifies whatever `tool_use` input exists. When `max_tokens` is hit that is a partial object, and neither the batch path (`:221`) nor the sync path (`:260`) reads `stop_reason`. A cut-off explainer is then "repaired" or saved as if whole.
- OpenAI sync: a Responses API body with `status: "incomplete"` (`max_output_tokens`) is read as a normal reply.
- OpenAI batch: a row with `error: null` is a success whenever `response.body` exists (`:475-493`). The row's `response.status_code` is never read, so a 429 or 400 row becomes `succeeded` with empty text.
- OpenAI `text.format` is `json_schema` without `strict: true` in three places (`src/providers.ts:522`, `src/batch.ts:483`, `:742`). The schema is already written to the strict subset (`src/schema/explainer-schema.ts:17-21`; the orchestrator walked it and every object has `additionalProperties: false` with every property required), but OpenAI enforces it only when `strict` is true.

Cold read: a read-only Codex session (other family) read this card with 01, 03, 04, 08 and 09 on 2026-10-19. It asked whether "sync" covers the subscription routes (no; the Objective now says API-key sync only) and noted that live acceptance of `strict: true` needs the network (answered in Out of scope).

## Objective

A Claude reply that stopped on `max_tokens`, an OpenAI reply with `status: "incomplete"`, and an OpenAI batch row whose `status_code` is not 2xx all become errors carrying the reason (`max_tokens`, `incomplete` and the incomplete reason, or `HTTP <code>` and the body's message), on the API batch path and the API-key sync path of each provider (Claude `createMessageWithContent`, OpenAI `createMessage` with an API key), so no truncated or failed API text reaches repair or `saveResult`. The subscription routes (Agent SDK and codex CLI) report no stop reason this card can read and are unchanged. Every OpenAI structured-output request asks for `strict: true` through one shared helper.

## Inputs (read these in your own context)

- `src/providers.ts` (`extractClaudeText`, `ClaudeProvider.iterateBatchResults`, `createMessageWithContent`, `OpenAIProvider.iterateBatchResults`, `createMessage`, `extractOutputText`, `ResponsesBody`)
- `src/batch.ts` (the two jsonl builders that set `text.format`, and how the callers handle a thrown provider error and an `errored` batch item)
- `src/schema/explainer-schema.ts` (header comment)
- `tests/contract/07-truncated-and-errored-responses-are-caught.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/providers.ts`:
   - One shared check used by both providers (for example `assertCompleteResponse(provider, { truncated, reason })`) that throws an `Error` naming the provider and the reason. Each provider only maps its own wire format onto it: Claude `stop_reason === 'max_tokens'` (also `model_context_window_exceeded` where the SDK reports it), OpenAI `status === 'incomplete'` with `incomplete_details.reason`.
   - Claude: `createMessageWithContent` rejects on a truncated message; `iterateBatchResults` yields `{ type: 'errored', error }` for a truncated succeeded item and keeps yielding the rest. `end_turn`, `tool_use` and `stop_sequence` replies are unchanged.
   - OpenAI: `createMessage` (API-key route) rejects on an incomplete body; `iterateBatchResults` yields `errored` with `HTTP <status_code>: <body.error.message>` for a non-2xx row and `errored` with the incomplete reason for an incomplete body. Existing `row.error` and missing-body handling stays.
   - One exported helper that builds the OpenAI `text.format` object with `type: 'json_schema'`, `name: 'explainer'`, `strict: true` and the schema, used by `createMessage`.
2. `src/batch.ts`: both jsonl builders use that helper instead of their inline `text.format` literal.
3. `src/schema/explainer-schema.ts`: header comment only, if it still calls the schema advisory anywhere; say OpenAI requests it with `strict: true`.

## Constraints

- No provider-specific branching outside the mapping from each wire format onto the shared check; the batch and sync paths of one provider use the same mapping.
- After the change, `type: 'json_schema'` appears in exactly one non-comment line under `src/` (the contract test counts it).
- Do not change the schema's shape. If a strict request is rejected for a schema reason, stop and report it; do not loosen the schema.
- Do not add retries, raise token caps or change models: a truncated reply simply fails its request, as any other provider error does today.
- The subscription routes (`createMessageViaCli` through the Agent SDK, and the codex CLI runner) are unchanged.
- No network and no paid API calls while working; the contract test stubs `fetch` and the Anthropic client.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Sonnet 5.5 verifier through the Claude CLI; no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/07-truncated-and-errored-responses-are-caught.test.ts` exits 0. It covers Claude sync and batch truncation, OpenAI sync incompleteness with the strict format on the wire, OpenAI batch rows with 429, incomplete and complete bodies, the unchanged happy paths, and the single format literal. Baseline on `dev`: red, 5 of 7 fail (first: the Claude sync `max_tokens` reply resolves instead of rejecting); the two happy-path tests pass on `dev` as regression guards.
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: red until card 01 lands, which is ahead of this card in the queue.
4. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/07-truncated-and-errored-responses-are-caught.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
5. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/07-truncated-and-errored-responses-are-caught.test.ts`
- **Assertions digest:** `sha256:c50653d9a494d8dcca710c8e24426d41e5aa1316b682afedbf7a241f38ce28d4`
- **Oracle proof:** On `dev` (0cd17d7) 5 of 7 tests fail for the card's reason: the Claude `max_tokens` reply resolves, the truncated Claude batch item and both bad OpenAI rows come back `succeeded`, the incomplete OpenAI reply resolves with no `strict` on the request, and the format literal appears three times. The two happy-path tests pass on `dev` and guard against over-rejection. A throwaway reference in a detached scratch worktree (one shared check, a Claude and an OpenAI mapping used by both paths, a status-code guard on batch rows, one format helper used at three sites) passed all 7 with `tsc --noEmit` clean, stacked on the card 03 and 04 references; the worktree was removed and pruned. Trap fixed in the test before freezing: the schema file's header comment also contains `type:'json_schema'`, so the count skips comment lines.

## Out of scope

- A normalised result type with `finishReason` and `error` across providers (wave 2, with `LlmProvider`).
- Retrying with a higher token cap, raising caps, or reasoning-effort settings.
- Schema enforcement on the subscription routes (codex `--output-schema`, Agent SDK `outputFormat`) and Anthropic strict tool use.
- Surfacing batch-level `errors` or marking leftover requests when a whole batch fails.
- Unknown providers and polling errors (card 08).
- A live request proving OpenAI accepts the strict schema. The orchestrator walked `EXPLAINER_JSON_SCHEMA` offline and found it inside the strict subset, so no seat on this card needs the network; the first real OpenAI run after this card lands is the live check, and a schema rejection there is a new card, not a re-brief.

## Budget

- **Worker wall-clock:** 45 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** promo-flow medians: Terra worker about 6M tokens, Sonnet verifier about 0.9M. Expect near the median: the reference diff is about 80 lines in `src/providers.ts` and two one-line swaps in `src/batch.ts`.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The error text each of the four failure cases now produces.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 3 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the test replaces `globalThis.fetch` and the Anthropic client on a provider instance, and sets dummy keys. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
