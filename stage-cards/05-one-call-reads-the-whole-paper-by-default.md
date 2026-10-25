# Stage card 05-one-call-reads-the-whole-paper-by-default: the OpenAI writer reads the whole paper in one call unless lanes are asked for

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/05-one-call-reads-the-whole-paper-by-default
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** Mechanical change with every decision already made by the operator (default flip, fail on a missing lane, two doc corrections), so the batch-lane worker tier (Terra) fits. The verifier is the other family's mechanical tier (Sonnet 5.5). Serial because the card edits `src/batch.ts`, which cards 06 and later also edit.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19 (plan item 8, high finding at `src/batch.ts:880`). Lines checked against `dev` at 0cd17d7:

- `src/batch.ts:178-181`: `useOpenAILanes()` reads `OPENAI_USE_LANES ?? '1'`, so every OpenAI run (batch, sync and the codex local batch) splits the paper into four lane calls and the synthesis writer sees only the lane bullets plus the user instruction, never the paper.
- `src/batch.ts:723-725` (batch collect), `:880-882` (codex local batch) and `:1123-1125` (sync): a lane that failed or never returned is joined in as `(missing)`, so synthesis can write a whole explainer from four empty lanes. Batch collect only errors the paper when no lane at all came back (`:717-721`).
- Operator decision (wave 1): lanes are off by default now, one call with the full paper; `OPENAI_USE_LANES=1` still opts in until wave 2 deletes the lane code, and when lanes are opted into a missing lane fails the paper.
- `CLAUDE.md:37-38` states the Claude repair default as `claude-sonnet-5`; commit cfa462a moved it to `claude-sonnet-5-5` (`src/model-config.ts:62`). `README.md:208-210` already matches `src/model-config.ts`, but its auth-route table (`README.md:228`) and "How it works" step 2 (`README.md:239-241`) still describe lane extraction as what OpenAI does.

## Objective

With `OPENAI_USE_LANES` unset, every OpenAI route (batch submit, sync, codex local batch) sends one request per paper that carries the document and the explainer system prompt, and records no lane requests in state. With `OPENAI_USE_LANES=1` lanes still run, but a paper whose lanes are not all present is marked errored with a message naming the missing lane(s), no synthesis request is made for it, and the string `(missing)` is never sent to a model. Other papers in the same batch carry on. `CLAUDE.md` and `README.md` state the model defaults that `src/model-config.ts` holds and document the lane opt-in.

## Inputs (read these in your own context)

- `AGENTS.md`, `CLAUDE.md`
- `src/batch.ts` (`useOpenAILanes`, `submitOpenAIBatch`, `collectOpenAI`, `collectOpenAILocal`, `runOpenAISync`, `runSync`)
- `src/model-config.ts`
- `README.md` (the environment table, model defaults paragraph, auth routes table and "How it works")
- `tests/contract/05-one-call-reads-the-whole-paper-by-default.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/batch.ts`: `useOpenAILanes()` returns true only for `OPENAI_USE_LANES` set to `1`, `true` or `yes` (case-insensitive); unset or anything else means one call. One shared helper finds the lanes missing from a paper's lane map, used by all three lane paths (batch collect, codex local batch, sync); no per-path copies. In batch collect a paper with a missing lane is set `result: 'errored'` with an error naming the missing lanes (for example `Lane(s) failed: results`) and is left out of the synthesis JSONL; in the codex local batch and sync paths the same condition errors the paper before the synthesis call. The `(missing)` placeholder is removed.
2. `CLAUDE.md`: the "Model defaults" bullet names repair `claude-sonnet-5-5` and no longer names `claude-sonnet-5`.
3. `README.md`: an `OPENAI_USE_LANES` row in the environment table (default unset: one call per paper with the full document; `1` opts into the four-lane split, and a failed lane fails the paper); the auth-route row for OpenAI batch and "How it works" step 2 describe one call per paper instead of lane extraction; the model defaults paragraph keeps naming `claude-opus-4-8`, `claude-sonnet-5-5`, `gpt-5.6-terra` and `gpt-5.6-luna`.

## Constraints

- Model defaults in `src/model-config.ts` do not change.
- No new provider-specific branching: the missing-lane rule is one helper shared by the three paths.
- The lane code stays (wave 2 deletes it). Do not change the lane custom-id format, `laneInstruction`, `lanePrompt` or `OPENAI_LANES`.
- Claude paths are untouched.
- No network and no paid API calls while working; the contract test stubs the provider.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Sonnet 5.5 verifier, Claude CLI, no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/05-one-call-reads-the-whole-paper-by-default.test.ts` exits 0. Baseline on `dev`: red, 6 of 7 tests fail (only "model defaults are unchanged" passes).
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **No placeholder (verifier):** `grep -n "(missing)" src/batch.ts` prints nothing. Baseline on `dev`: red (three matches).
4. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/05-one-call-reads-the-whole-paper-by-default.test.ts` prints the digest recorded below. Baseline on `dev`: green.
5. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only the deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/05-one-call-reads-the-whole-paper-by-default.test.ts`
- **Assertions digest:** `sha256:7962fcb1211ab81a3ff9cd84f8474fe37ab9cdd7adc161d2dee0a91e14d8a587`
- **Oracle proof:** On `dev` (0cd17d7) the first failing assertion is "lane calls made with OPENAI_USE_LANES unset" (default sync run makes four lane calls); the batch-submit, three lane-failure and docs tests also fail for the card's reasons ("synthesis ran although a lane failed", "CLAUDE.md still names claude-sonnet-5 as a default"); "model defaults are unchanged" passes as the regression guard. A throwaway reference in a detached scratch worktree (default flipped to opt-in, one `missingLanes` helper used by the three paths, the two doc edits) passed all 7 tests with `tsc --noEmit` clean; the worktree was removed and pruned. Traps the reference met: none. The test pins every path and key in `process.env` before loading `src/`, because `src/output.ts` runs the fill-only `.env.local` loader at import time and would otherwise redirect output into the operator's vault.

## Out of scope

- Deleting the lane code or changing the lane custom-id delimiter (wave 2).
- Passing the document to synthesis when lanes are opted in.
- Batch-versus-sync provenance stamping (card 06), vision model selection (card 13).
- `README.md` Fable 5 wording and anything else in the docs beyond the deliverables.
- The 6-point chart filter (`MIN_CHART_POINTS`).

## Budget

- **Worker wall-clock:** 45 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** small mechanical card on the promo-flow medians: Terra worker about 6M tokens, Sonnet verifier about 0.9M. Hold one re-brief at the same size.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 3 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** runs under workspace-write with no network; the contract test needs none (it stubs `fetch` and the provider prototypes). Run `node` directly as in criterion 1; `npm` scripts are not needed. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Both roles:** do not create `.env.local` in the run worktree; the test does not need it.
