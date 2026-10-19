# Stage card 04-saved-explainers-record-their-quality-issues: every saved explainer carries its own validation result

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Base branch:** dev
- **Run branch:** autometta/04-saved-explainers-record-their-quality-issues
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Depends on:** 01-contract-tests-run-with-npm-test
- **Dispatch:** serial
- **Pairing rationale:** One function's save path plus an optional type field and six call-site arguments: mechanical, so the cheap Claude tier writes it and the cheap Codex tier checks it from the other family. Cards 03 and 05 have Terra workers, so worker families alternate. Serial because it edits `src/output.ts` and `src/batch.ts`, which cards 03, 05, 06 and later also edit.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19, plan item 6, the medium finding at `src/output.ts:516` and the low finding at `src/output.ts:532`. Lines checked against `dev` at 0cd17d7:

- Validation lives only in the repair loops in `src/batch.ts`. When `MAX_REPAIR_ATTEMPTS` runs out, the still-invalid text goes to `saveResult` (`src/output.ts:516`), which writes it with no check and no record, and the request is marked `succeeded`. Nothing in the saved JSON or in state says it failed validation.
- `saveResult` writes `json.metadata.model` (`:532`) and calls `stampProvenanceByline` (`:531`) outside the try/catch that keeps a raw `_error.txt` (`:519-529`). Parseable JSON with no `metadata` object therefore throws a `TypeError` and the raw output is lost.

Reader safety, checked in the sibling website repo (promo-flow): its sidecar normaliser picks named metadata fields and drops the rest (`src/lib/explainers.ts:654-697`), its baker reads only `model`, `run_mode`, `eyebrow` and `title` from `metadata` (`src/lib/explainer-to-html-core.mjs:178-186`, `:219`, `:318`), and the admin routes parse the file and pass it through. An extra `metadata.quality` object is ignored everywhere. That is the same footing `metadata.model` and `metadata.run_mode` already stand on: both are in this repo's `ExplainerJson` and absent from promo-flow's copy.

Cold read: a read-only Codex session (other family) read this card with 01, 03, 07, 08 and 09 on 2026-10-19. It asked how card 06's `finalizeResult` keeps the expected date (answered in Constraints) and whether the quality record should describe the file after figure attachment (yes; Deliverable 1 now validates after attachment).

## Objective

`saveResult` validates the explainer it is about to write (after normalisation and provenance stamping, against the request's expected date) and records the result in the saved file as `metadata.quality = { issues: string[], needs_review: boolean }`, always present, with `needs_review` true exactly when `issues` is non-empty. An invalid explainer is still saved, for review. Parseable JSON that is not an object with a `metadata` object is kept as `_error.txt` and rejected with a clear error, never a `TypeError`.

## Inputs (read these in your own context)

- `src/output.ts` (`saveResult`, `RunProvenance`, `stampProvenanceByline`, `normalizeExplainerJson`)
- `src/quality.ts` (`validateJsonOutput`)
- `src/types/explainer-json.ts` (the `metadata` block)
- `src/schema/explainer-schema.ts` (header comment and `metadataSchema`)
- `src/batch.ts` (every `saveResult` call and the `expectedDate` in scope at each)
- `tests/contract/04-saved-explainers-record-their-quality-issues.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/output.ts`:
   - `RunProvenance` gains `expectedDate?: string` (YYYY-MM-DD, the date the request was submitted).
   - In `saveResult`: after `extractJson`, if the value is not a plain object or has no `metadata` object, write the raw text to `_error.txt` exactly as the parse-failure path does and throw an `Error` that says the metadata object is missing. Then normalise, stamp provenance, set `model` and `run_mode`, and attach the figure, all as today. Only then, immediately before the filename is derived and the file written, call `validateJsonOutput` on that final object with `expectedDate` taken from `provenance.expectedDate`, falling back to `metadata.date_created` when that is a YYYY-MM-DD string, else today's UTC date. Exclude any existing `metadata.quality` from what is validated, then set `metadata.quality` and log one warning line when `needs_review` is true. Filename, staging and mirroring are unchanged.
2. `src/types/explainer-json.ts`: `metadata.quality?: { issues: string[]; needs_review: boolean }`, with a doc comment saying explainer-batch writes it and readers may ignore it.
3. `src/schema/explainer-schema.ts`: header comment only. Add `metadata.quality` to the list of deliberate divergences (code writes it; the model must never emit it). `metadataSchema` does not change.
4. `src/batch.ts`: every `saveResult` call passes `expectedDate` (each call site already has it in scope from `dateFromIso(...submitted_at)`).

## Constraints

- An invalid explainer is still written and staged; this card records, it does not block or drop. The request's `succeeded` status in state is unchanged.
- The six-point filter and the three-chart cap in `src/output.ts` stay exactly as they are (operator decision; card 02's contract test pins them). Validation sees the charts that will be saved.
- Do not add `quality` to `metadataSchema` or anywhere the model is asked to produce it.
- Do not edit promo-flow; its reader ignores the field (see Surfacing concern).
- Do not write the literal text `saveResult(` in any new comment or string under `src/`: card 06's contract test counts call sites by that text.
- Card 06, later in the queue, replaces the six `saveResult` calls with one `finalizeResult`. That card must carry `expectedDate` through; the orchestrator owns that hand-off. This card only adds `expectedDate` at today's six calls, and the `metadata.date_created` fallback keeps a missing date from flagging every batch result.
- No network and no paid API calls while working; the contract test stubs `fetch`, uses a URL-style custom id with no state entry so figure extraction makes no call, and points every output path at a temp dir.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Codex GPT-5.6 Terra verifier under workspace-write; no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/04-saved-explainers-record-their-quality-issues.test.ts` exits 0. It covers the empty record on a clean explainer, issues and `needs_review` on an invalid one, the ordinal issue on a stringified chart that survives the filter, the expected date from provenance, validation after stamping, the `_error.txt` path for metadata-less JSON, and the unchanged model-facing schema. Baseline on `dev`: red, 6 of 7 fail (first: `metadata.quality` is undefined on the clean explainer); the schema test passes on `dev` as a regression guard.
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: red until card 01 lands, which is ahead of this card in the queue.
4. **Every save passes the date (verifier):** `grep -n "saveResult(" src/batch.ts` lists only calls whose provenance object includes `expectedDate`. Baseline on `dev`: red (six calls, none pass it).
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/04-saved-explainers-record-their-quality-issues.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/04-saved-explainers-record-their-quality-issues.test.ts`
- **Assertions digest:** `sha256:fecad73fbefc70461668913476e0abc21beb30a287201e1e581edd6e0ddfbad5`
- **Oracle proof:** On `dev` (0cd17d7) 6 of 7 tests fail for the card's reason: saved files carry no `metadata.quality`, and metadata-less JSON rejects with `TypeError: Cannot set properties of undefined` and no `_error.txt`. The seventh (no `quality` in the model-facing schema) is a regression guard and passes on `dev`. A throwaway reference in a detached scratch worktree (a metadata guard, `expectedDate` on `RunProvenance`, a validate-and-record block after stamping and figure attachment, the optional type field, `expectedDate` at the six calls) passed all 7 with `tsc --noEmit` clean, stacked on the card 03 reference; the worktree was removed and pruned. The test pins `EXPLAINER_OUTPUT_DIR`, `EXPLAINER_OBSIDIAN_DIR=''`, `WEBSITE_REPO=''` and the state file before loading `src/`, because `src/output.ts` runs the fill-only `.env.local` loader at import time and would otherwise stage into a real website checkout and vault. After the reference run, the fixture's one paragraph was changed to state the pill numbers (12% and 3x), so the clean document stays clean once card 15's number-not-in-body lint lands; red on `dev` was re-run and holds, and the change cannot affect the reference result because no current check reads paragraph text beyond non-emptiness.

## Out of scope

- Marking the request `needs_review` or errored in `state.json`, or changing the run summary.
- Handling chart issues in code (dropping or tabling a bad chart): wave 2.
- Moving stamping ahead of the repair-loop validation (wave 2; card 06 also leaves it).
- Any promo-flow change, including surfacing `needs_review` in its admin view.
- The repair loop itself (cards 03 and 09).

## Budget

- **Worker wall-clock:** 40 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** promo-flow medians: Sonnet worker about 2.2M tokens, Terra verifier near its 6M worker median at most, likely far less for a read-and-run check. The reference diff is about 50 lines across three files plus six one-word call-site edits.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The final order of steps inside `saveResult`, showing validation after figure attachment.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls.
- **Codex (verifier):** workspace-write with no network is enough; the test writes only under the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.
