# Stage card 08-unknown-providers-and-dead-batches-fail-loudly: a mistyped provider, a stale sync run and a dead batch each stop with a clear error

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Base branch:** dev
- **Run branch:** autometta/08-unknown-providers-and-dead-batches-fail-loudly
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Depends on:** 01-contract-tests-run-with-npm-test
- **Dispatch:** serial
- **Pairing rationale:** Three small guards in known places (argument parsing, the pending lookup, the poll loop): mechanical, so the cheap Claude tier writes it and the cheap Codex tier checks it from the other family. Cards 07 and 09 have Terra workers, so worker families alternate. Serial because it edits `src/providers.ts`, `src/batch.ts` and `src/index.ts`, which cards 05, 06, 07, 09 and later also edit.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19, plan item 13, the low finding at `src/providers.ts:647` and the medium finding at `src/state.ts:152`. Lines checked against `dev` at 0cd17d7:

- `getProviderFromArgs` returns `raw === 'openai' ? 'openai' : 'claude'` (`src/providers.ts:652`), so `--provider gemini`, `PROVIDER=gemini` or a typo such as `--provider claud` silently runs Claude, on Claude billing. `src/index.ts:32` filters positional arguments against the two literal names, a second copy of the list.
- `runSync` registers its run in state as `sync_<provider>_<ms>` with status `processing` (`src/batch.ts:1197`) and only marks it ended on completion. After a crashed sync run, `getLatestPendingBatchByProvider` (`src/state.ts:152`) returns that id to an argument-less `poll`, which sends it to the real batch API.
- `pollUntilEnded` (`src/batch.ts:43`) treats every status error as transient: five retries with backoff of 30 s doubling to an 8-minute cap, about 15 minutes before it gives up on an id the provider will never know (404) or a key it will never accept (401). The OpenAI client's errors carry the status only in the message text (`src/providers.ts` `requestJson`); the Anthropic SDK's errors carry a numeric `status`.

Cold read: a read-only Codex session (other family) read this card with 01, 03, 04, 07 and 09 on 2026-10-19 and raised nothing for it.

## Objective

An unknown provider name, from `--provider` or `PROVIDER`, throws an error naming the value and the known providers; the known providers live in one exported list that the argument filter in `src/index.ts` also uses. The pending-batch lookup never returns a local `sync_*` run. Polling stops on the first status error that cannot succeed on retry (any 4xx except 408 and 429), decided by one shared `isFatalHttpError` that recognises both providers' errors, and keeps retrying 408, 429, 5xx and network errors as today.

## Inputs (read these in your own context)

- `src/providers.ts` (`ProviderName`, `getProviderFromArgs`, `OpenAIProvider.requestJson`, `requestText`, `retrieveBatch`)
- `src/index.ts` (`parseCommandArgs`, the usage text)
- `src/state.ts` (`getLatestPendingBatchByProvider`, `BatchState`)
- `src/batch.ts` (`pollUntilEnded`, `pollAndRetrieve`, `runSync`)
- `tests/contract/08-unknown-providers-and-dead-batches-fail-loudly.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/providers.ts`:
   - `export const PROVIDER_NAMES = ['claude', 'openai'] as const`, with `ProviderName` derived from it, and an `isProviderName` guard.
   - `getProviderFromArgs` keeps its lower-casing and its `claude` default when nothing is set, and throws on any other value: `Unknown provider "<value>". Known providers: claude, openai.`
   - `export function isFatalHttpError(error: unknown): boolean`: true for a status from 400 to 499 other than 408 and 429, false otherwise, including errors with no status.
   - `OpenAIProvider.requestJson` and `requestText` throw an `Error` that carries the HTTP status as a numeric `status` property (same message as today), so `isFatalHttpError` reads both providers the same way.
2. `src/index.ts`: the positional-argument filter uses `isProviderName` instead of the two literals.
3. `src/state.ts`: `getLatestPendingBatchByProvider` skips any batch whose id starts with `sync_`.
4. `src/batch.ts`: export `pollUntilEnded`; in its catch, a fatal error (per `isFatalHttpError`) throws at once with the label and the original message; everything else keeps today's backoff.

## Constraints

- Explicit `poll <batch-id>` lookups are unchanged, including for a `sync_` id.
- The `codexbatch_` local path in `pollAndRetrieve` is unchanged.
- `src/vision.ts` `resolveVisionProvider` has the same silent default for `FIGURE_VLM_PROVIDER`; leave it to the vision card (13), which owns that file.
- No new provider-specific branching: one `isFatalHttpError` for both providers.
- Backoff timings, `POLL_MAX_CONSECUTIVE_ERRORS` and the 12-hour cap are unchanged.
- No network and no paid API calls while working; the contract test stubs `fetch` and uses mocked timers.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Codex GPT-5.6 Terra verifier under workspace-write; no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/08-unknown-providers-and-dead-batches-fail-loudly.test.ts` exits 0. It covers the provider list, unknown values from the flag and the environment, the unchanged known values and default, the pending lookup with `sync_` runs, `isFatalHttpError` on plain status errors and on real `OpenAIProvider` 404 and 503 errors, and `pollUntilEnded` stopping after one call on a 404. Baseline on `dev`: red, 7 of 8 fail (first: `PROVIDER_NAMES` is undefined); the known-providers test passes on `dev` as a regression guard. The poll test uses mocked timers, so a wrong implementation fails in milliseconds rather than retrying for 15 minutes.
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: red until card 01 lands, which is ahead of this card in the queue.
4. **CLI rejects a typo (verifier):** `npx ts-node src/index.ts status --provider gemini </dev/null` exits non-zero and prints `Unknown provider "gemini"`. Baseline on `dev`: red (in a fresh worktree it prints "No batches recorded in state.json" and exits 0). The `status` command reads `state.json` only and makes no network call.
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/08-unknown-providers-and-dead-batches-fail-loudly.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/08-unknown-providers-and-dead-batches-fail-loudly.test.ts`
- **Assertions digest:** `sha256:4968a6dcc15a74fdba8b41ea0e26f76a27dc4913c4fedca8931521edbbb977a7`
- **Oracle proof:** On `dev` (0cd17d7) 7 of 8 tests fail for the card's reason: no `PROVIDER_NAMES`, `gemini` and `claud` resolve to `claude`, the lookup returns the newer `sync_` run, `isFatalHttpError` and an exported `pollUntilEnded` do not exist. The known-providers test passes on `dev` and guards the default and case handling. A throwaway reference in a detached scratch worktree (the list, guard and throw in `src/providers.ts`, a numeric `status` on OpenAI errors, one `startsWith('sync_')` clause, an early throw in the poll catch, the index filter) passed all 8 with `tsc --noEmit` clean, stacked on the card 03, 04 and 07 references; the worktree was removed and pruned. With the early throw disabled, the poll test failed in 44 ms, which shows the mocked timers keep a wrong implementation from hanging the run.

## Out of scope

- Storing a `route` or `kind` on `BatchState`, or marking orphaned sync runs aborted on start-up.
- `resolveVisionProvider` in `src/vision.ts` (card 13 owns that file).
- A provider registry beyond the two-name list; adding Gemini (wave 2).
- Truncation and batch-row status codes (card 07).

## Budget

- **Worker wall-clock:** 40 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** promo-flow medians: Sonnet worker about 2.2M tokens, Terra verifier well under its 6M worker median for a read-and-run check. The reference diff is about 40 lines across four files.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exact error text for an unknown provider and for a fatal poll error.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls. Run criterion 4 with no `.env.local` in the worktree so no real key is loaded.
- **Codex (verifier):** workspace-write with no network is enough; the test writes only under the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.
