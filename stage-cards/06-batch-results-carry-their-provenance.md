# Stage card 06-batch-results-carry-their-provenance: a batch result is stamped with the same author, date and reference as a sync result

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Verifier:** GPT-6 Astra <gpt-6-astra@local>
- **Base branch:** dev
- **Run branch:** autometta/06-batch-results-carry-their-provenance
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** Batch is the operator's preferred route (50% off), so a wrong merge of the six save paths costs every future run; that is judgement work across state persistence and three collectors, which earns the Opus 5.5 worker. The verifier is the other family's frontier tier (GPT-6 Astra), reading the same six call sites cold. Adjacent cards 05 and 13 have Terra workers, so the worker family alternates. Serial because the card edits `src/batch.ts`, which cards 05 and later also edit.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19 (plan item 9, high finding at `src/batch.ts:580`). Lines checked against `dev` at 0cd17d7:

- `src/preprocess.ts:565-591` detects the first author's surname, the publication date and a canonical reference for URL sources (arXiv `/abs/` metadata) and puts them on the `InputItem` as `detectedSurname`, `detectedPublished` and `detectedReference`.
- Sync paths pass them to `saveResult` (`src/batch.ts:987` Claude sync, `:1160` OpenAI sync), and `src/output.ts:489-514` (`stampProvenanceByline`) overwrites the model's byline, eyebrow, `hero.publication_date` and `references` with them.
- `RequestState` (`src/state.ts:50-73`) has no field for them, so the batch submitters (`src/batch.ts:362-375` Claude, `:387-398` OpenAI, and `runSync` at `:1212-1225`) drop them, and the three batch collectors call `saveResult` without them: `:580` (Claude), `:644` (OpenAI single stage), `:788` (OpenAI lane synthesis). A batch explainer therefore keeps whatever author and date the model guessed, while the same paper run sync is corrected.
- Not in the review: the codex local batch (`collectOpenAILocal`, `:917`) does pass `item.detected*`, but `item` is rebuilt from state by `requestToInputItem` (`:212-231`), which cannot carry them, so that route loses them too.
- There are six `saveResult` call sites in `src/batch.ts`, each assembling its own provenance object; that duplication is how three of them drifted.

## Objective

The detected provenance is persisted on each explainer request in `state.json` at submit (batch and sync), and every result in `src/batch.ts` is saved through one `finalizeResult` that builds the provenance from the request, so a paper's saved JSON is identical whether it ran batch or sync, apart from `metadata.run_mode`.

## Inputs (read these in your own context)

- `AGENTS.md`, `CLAUDE.md` (the "Output post-processing" bullet)
- `src/state.ts` (`RequestState`)
- `src/batch.ts` (submitters, `requestToInputItem`, `runSync`, the three collectors, both sync runners)
- `src/output.ts` (`RunProvenance`, `stampProvenanceByline`, `saveResult`)
- `src/preprocess.ts` (the `InputItem` `detected*` fields, read only)
- `tests/contract/06-batch-results-carry-their-provenance.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/state.ts`: `RequestState` gains optional `detectedSurname`, `detectedPublished` and `detectedReference` (these exact names; the contract test reads them from `state.json`).
2. `src/batch.ts`:
   - Every place that builds an explainer `RequestState` from an `InputItem` (`submitClaudeBatch`, `submitOpenAIBatch`, `runSync`) copies the three fields. Lane requests do not need them.
   - `requestToInputItem` carries them back onto the rebuilt `InputItem`.
   - A single `finalizeResult(customId, rawText, req, model, runMode)` (name fixed by the contract test; it may live in `src/batch.ts` or `src/output.ts`) builds the `RunProvenance` from the request and calls `saveResult`. All six current call sites call `finalizeResult` instead; after the change `saveResult(` is called from exactly one place in `src/`.
3. `src/output.ts`: only if `finalizeResult` lives there. `RunProvenance`, `stampProvenanceByline` and the stamping order are unchanged.
4. `CLAUDE.md`: the "Output post-processing" bullet says every save path goes through `finalizeResult`, which stamps the detected provenance and then calls `saveResult`.

`src/index.ts` needs no change: it hands the preprocessed `InputItem`s to `submitBatch` and `runSync` untouched (checked).

## Constraints

- Sync output does not change: for the same input, the JSON a sync run saves today is what it saves after this card.
- The route tag stays as today on every path (`batch` for the three batch collectors, `sync` for both sync runners and for `collectOpenAILocal`). Changing the codex local batch's tag is not part of this card.
- Do not move stamping before validation (a separate review finding, `src/output.ts:531`), and do not change what `stampProvenanceByline` writes.
- No provider-specific provenance handling: one helper for all six paths.
- No comment or string in `src/` may contain the literal text `saveResult(` outside the one real call, because the contract test counts call sites by that text.
- Existing `state.json` files written before this card (requests without the new fields) must still load and collect; the fields are optional.
- No network and no paid API calls while working; the contract test stubs the providers.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6 Astra verifier under Codex workspace-write; no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/06-batch-results-carry-their-provenance.test.ts` exits 0. It covers Claude batch, OpenAI single-stage batch, OpenAI lane batch, the codex local batch, batch-versus-sync identity on OpenAI, and the single call site. Baseline on `dev`: red, all 6 tests fail (first: "RequestState.detectedSurname not persisted at submit").
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **One call site (verifier):** `grep -rn "saveResult(" src` prints the `saveResult` definition in `src/output.ts` and exactly one call, inside `finalizeResult`. Baseline on `dev`: red (six calls in `src/batch.ts`).
4. **Docs (verifier):** `grep -n "finalizeResult" CLAUDE.md` prints at least one line. Baseline on `dev`: red.
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/06-batch-results-carry-their-provenance.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/06-batch-results-carry-their-provenance.test.ts`
- **Assertions digest:** `sha256:581921f2e1c57df7118c74d273fcfee6d782091604d38e7e604a26ef7a2adbff`
- **Oracle proof:** On `dev` (0cd17d7) all 6 tests fail for the card's reason: Claude batch at "RequestState.detectedSurname not persisted at submit"; OpenAI batch, lane batch and codex local batch save `2026-10-19_unknown_*` instead of the stamped `2026-10-19_lovelace_*`; the identity test fails because the batch output never stamped; the call-site test finds 6 calls at `src/batch.ts:580, 644, 788, 917, 987, 1160`. A throwaway reference in a detached scratch worktree (three optional fields on `RequestState`, copied at the three request builders and in `requestToInputItem`, one `finalizeResult` in `src/batch.ts` replacing the six calls) passed all 6 tests with `tsc --noEmit` clean; the worktree was removed and pruned. Trap the reference met: a lane custom id containing the word `lane` in its base id confused the test's lane stub, fixed in the test before freezing (the test's ids avoid it). The test pins every path and key in `process.env` before loading `src/`, because `src/output.ts` runs the fill-only `.env.local` loader at import time, and uses customIds without the `explainer-url-` prefix so figure extraction finds no source and makes no call.

## Out of scope

- Stamping before validation, metadata v2, and moving stamping into a contract schema (wave 2).
- The codex local batch's `sync` route tag.
- Lane behaviour (card 05) and vision models (card 13).
- Per-item state saves during collect and `--retry-errored` (separate review finding).
- Any change to `src/preprocess.ts` detection.

## Budget

- **Worker wall-clock:** 90 minutes
- **Verifier wall-clock:** 40 minutes
- **Spend basis:** promo-flow medians: Opus 5.5 worker about 18M tokens (p95 43M), Astra verifier about 2.6M. Expect nearer the median: the reference diff is about 130 lines across two files. Hold one re-brief at the median.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The six former call sites and what each now passes to `finalizeResult` (model and route).
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls.
- **Codex (verifier):** workspace-write with no network is enough; the test stubs `fetch` and the provider prototypes and writes only under the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Both roles:** do not create `.env.local` in the run worktree.
