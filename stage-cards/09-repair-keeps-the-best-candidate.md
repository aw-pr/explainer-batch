# Stage card 09-repair-keeps-the-best-candidate: repair counts every attempt's tokens and never trades a better candidate for a worse one

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/09-repair-keeps-the-best-candidate
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Depends on:** 01-contract-tests-run-with-npm-test, 03-chart-checks-run-on-structured-output
- **Dispatch:** serial
- **Pairing rationale:** One small loop in one new file (from card 03) and a field rename: mechanical, so the cheap Codex tier writes it and the cheap Claude tier checks it from the other family. Card 08 has a Sonnet worker, so worker families alternate. Serial, and it depends on card 03, because it rewrites the `repairUntilValid` loop that card 03 creates in `src/repair.ts`.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19, plan item 11 and the medium finding at `src/batch.ts:244`. Lines checked against `dev` at 0cd17d7, in the two loops card 03 merges into `repairUntilValid` (`src/batch.ts:233-307` on `dev`):

- `usage = await ...` is overwritten on each attempt (`:261`, `:263`, `:296`), so with `MAX_REPAIR_ATTEMPTS = 2` (`:37`) the first repair call's tokens are never costed.
- `currentText = usage.text` is taken unconditionally (`:265`, `:304`). An unparseable repair reply makes the next pass hit the parse catch (`:251`, `:288`) and return that broken text, with no usage at all. The original, parseable explainer is thrown away and `saveResult` then fails with "JSON parse failed". A parseable reply with more issues than the original also replaces it.
- The result field is named `html` (`:85-88`), a leftover from the HTML pipeline; every caller reads `repaired.html` (six sites from `:580`).

Cold read: a read-only Codex session (other family) read this card with 01, 03, 04, 07 and 08 on 2026-10-19 and raised nothing for it, given that card 03 lands first.

## Objective

`repairUntilValid` returns `{ text, usage }`, where `text` is the best candidate seen (the original or a repair reply that parses and has strictly fewer validation issues than the best so far), each repair attempt works on that best candidate, and `usage` is the sum of input and output tokens across every repair call made (undefined when none was made). The `html` name is gone from the repair result and its callers.

## Inputs (read these in your own context)

- The repair module card 03 creates, src/repair.ts (it does not exist on `dev` until card 03 lands)
- `src/batch.ts` (the repair wrappers and every `repaired.` read, and `applyUsage`)
- `src/quality.ts` (`validateJsonOutput`, `JsonValidation`)
- `src/output.ts` (`extractJson`, `canonicaliseExplainerJson`)
- `tests/contract/09-repair-keeps-the-best-candidate.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/repair.ts`: `RepairResult` becomes `{ text: string; usage?: ProviderMessageResponse }`. `repairUntilValid`:
   - parses and validates the original (`extractJson`, `canonicaliseExplainerJson`, `validateJsonOutput`); an unparseable original is returned as is with no repair call, as today;
   - while the best candidate is invalid and fewer than `MAX_REPAIR_ATTEMPTS` (2) repairs have been made, sends the best candidate and its issues to `repair`, adds the reply's `inputTokens` and `outputTokens` to the running total, and adopts the reply only when it parses and has strictly fewer issues than the best;
   - returns the best candidate and the summed usage.
2. `src/batch.ts`: every `repaired.html` becomes `repaired.text`; `applyUsage` receives the summed usage unchanged in shape, so repair cost now covers every attempt.

## Constraints

- No provider-specific code in `src/repair.ts`; the provider difference stays in the `repair` function each caller passes (card 03).
- Attempt limit, repair instruction text, models and token caps are unchanged.
- A `repair` call that throws still propagates, as today (card 07 makes a truncated reply throw; that request is then errored by its caller).
- No `html` field or `.html` read remains in `src/repair.ts` or `src/batch.ts` (the contract test checks the source text).
- No network and no paid API calls while working; the contract test passes scripted `repair` functions.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Sonnet 5.5 verifier through the Claude CLI; no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/09-repair-keeps-the-best-candidate.test.ts` exits 0. It covers summed usage over two attempts, an unparseable reply never replacing a parseable candidate (with its tokens still counted), a worse parseable reply not replacing a better one and the next attempt repairing the better one, a better reply being adopted, no call for a valid original, the two-attempt limit, and the `text` name. Baseline on `dev`: red, 7 of 7 fail (first: `src/repair.ts` does not exist; it arrives with card 03). Baseline once card 03 has landed: red, 6 of 7 fail (the attempt-limit test passes as a regression guard).
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: red until card 01 lands, which is ahead of this card in the queue.
4. **Card 03 still holds (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/03-chart-checks-run-on-structured-output.test.ts` exits 0. Baseline: green once card 03 has landed.
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/09-repair-keeps-the-best-candidate.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/09-repair-keeps-the-best-candidate.test.ts`
- **Assertions digest:** `sha256:bfbbe70058d6f65aadc3905ddbf0e8f38fd43f900d79f340a47004508e2f5967`
- **Oracle proof:** On `dev` (0cd17d7) all 7 tests fail because `src/repair.ts` does not exist yet. Against a card 03 reference alone (today's loop moved into `src/repair.ts`), 6 of 7 fail: the summed-usage, unparseable-reply and worse-reply tests for this card's reasons (usage is the last call only, the broken reply is returned, the worse reply replaces the original), and the adopt, no-call and `text` tests because the field is still `html`. The two-attempt limit passes there and guards the attempt count. A throwaway reference in a detached scratch worktree (a 45-line `src/repair.ts` with a best-candidate loop and a usage sum, and a six-site rename in `src/batch.ts`) passed all 7, card 03's test still passed, and `tsc --noEmit` was clean, stacked on the card 03, 04, 07 and 08 references; the worktree was removed and pruned. After the reference run, the fixture's one paragraph was changed to state the pill numbers (12% and 3x), so the clean document stays clean once card 15's number-not-in-body lint lands; red on `dev` was re-run and holds, and the change cannot affect the reference result because no current check reads paragraph text beyond non-emptiness.

## Out of scope

- Returning the validation status from repair or marking the request `needs_review` in state (card 04 records quality in the saved JSON).
- Handling chart issues in code instead of LLM repair, and sending the paper to the repair model (wave 2).
- Changing `applyUsage`'s cost model or the `batch_cost_usd` naming.
- Catching a throwing `repair` call.

## Budget

- **Worker wall-clock:** 30 minutes
- **Verifier wall-clock:** 20 minutes
- **Spend basis:** promo-flow medians: Terra worker about 6M tokens, Sonnet verifier about 0.9M. Expect under the median: the reference is one rewritten 30-line function and a mechanical rename.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The final `repairUntilValid` body.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the test writes only under the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
