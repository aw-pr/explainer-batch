# Stage card 12-the-figure-picker-prefers-the-results-figure: the figure picker asks for the paper's key results figure, and the synthesis instruction never asks for an image block

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Base branch:** dev
- **Run branch:** autometta/12-the-figure-picker-prefers-the-results-figure
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** Two prompt sentences, two comments and two doc passages: mechanical, so a Sonnet 5.5 worker. The verifier is the other family's mechanical tier (Terra). Card 11 before it has a Terra worker, so the worker family alternates. Serial because cards 10, 11 and 13 also edit `src/figure-vlm.ts`, and card 02 edits the same line of `src/prompt.ts`.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19, section 2a item 9 (plan item 7), plus a contradiction found while checking it. Lines checked against `dev` at 0cd17d7:

- `contextBlock` (`src/figure-vlm.ts:146-158`) tells the selection model, whenever the explainer has charts, "The explainer ALREADY recreates these results as its own charts" and "Prefer a complementary CONCEPTUAL figure ... over a results plot those charts duplicate" (`:153-154`). The same block feeds the PDF selection prompt (`selectionPrompt`, `:181`) and the URL candidate prompt (`candidatePrompt`, `:805`). `docs/FIGURE-EXTRACTION.md:13-17` presents this as design, and `:208-212` admits it makes recreation pick diagrams with no data. The comments at `src/figure-vlm.ts:22-26` and `src/output.ts:288-289` repeat the rationale. The model-written charts that justified it are being cut back (card 02), so the steering now hides the real results plot.
- `buildUserInstruction` (`src/prompt.ts:25`) tells the synthesis model "If the paper has a single standout conceptual figure ..., emit it as an `image` block per skill.md; otherwise omit `image`", while `skill.md` forbids emitting `image` at `:58`, `:189`, `:213` and `:262`. The figure pipeline attaches the image.

## Objective

The figure-selection prompts (PDF pages and URL candidates) ask for the paper's key results figure, the one carrying its headline finding, with a conceptual figure only as the fallback when there is no results figure, and no longer steer away from results plots because the explainer has charts. The synthesis user instruction says never to emit `image` because the figure pipeline attaches it. The docs and comments describe the new preference.

## Inputs (read these in your own context)

- `AGENTS.md`, `CLAUDE.md` (the `skill.md` bullet)
- `src/figure-vlm.ts` (`FigureContext` comment, `contextFromExplainer`, `contextBlock`, `selectionPrompt`, `candidatePrompt`)
- `src/output.ts` (the comment above the `extractFigureViaVlm` call in `attachFigureImage`)
- `src/prompt.ts` (`buildUserInstruction`)
- `skill.md` (lines 58, 189, 213 and 262, read only)
- `docs/FIGURE-EXTRACTION.md` (lines 9-17 and 205-212)
- `tests/contract/12-the-figure-picker-prefers-the-results-figure.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/figure-vlm.ts`: in `contextBlock`, remove the two chart-steering lines and add one line, present whether or not the explainer has charts, asking for the paper's key results figure. The contract test requires the phrase "key results figure" (any case) in the selection system or user prompt, on both the PDF and the candidate path, and forbids the words "CONCEPTUAL", "complementary", "ALREADY recreates" and "duplicate" there. Chart titles may stay as neutral context. Update the `FigureContext` comment (`:22-26`) to match. Headline, subtitle and section labels still reach the prompt.
2. `src/output.ts`: the comment above the `extractFigureViaVlm` call (`:288-289`) no longer says the charts already recreate the results. Comment only; no code change.
3. `src/prompt.ts`: in `buildUserInstruction`, replace the `image` sentence ("If the paper has a single standout conceptual figure ... otherwise omit `image`.") with one that says never to emit `image` because the figure pipeline attaches it. The test requires the text to match `never emit[^.]*` followed by `` `image` `` in the same sentence, and the words "figure pipeline". Leave every other sentence on that line as you find it (card 02 owns the chart wording).
4. `docs/FIGURE-EXTRACTION.md`: lines 13-17 describe the new preference (use the phrase "key results figure"), and the "One interaction to know about" paragraph (`:208-212`) no longer says selection steers towards a conceptual figure.

## Constraints

- `skill.md` is not edited: it already forbids `image`, and it is production prompt text owned by other cards.
- No change to the selection JSON shape, to `SELECTION_SYSTEM` and `CANDIDATE_SYSTEM` beyond what deliverable 1 needs, to page limits, crop maths, label handling or verification (cards 10 and 11), or to model resolution (card 13).
- In `src/prompt.ts`, only the `image` sentence changes. If card 02 has already reworded the chart sentences on the same line, keep its wording.
- No network and no paid API calls while working; the contract test stubs `runVision` and `fetch`.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Codex GPT-5.6 Terra verifier under Codex workspace-write; no network needed (`pdftoppm` and `sips` run locally).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/12-the-figure-picker-prefers-the-results-figure.test.ts` exits 0. It captures the PDF selection prompt and the URL candidate prompt with chart titles in the context, reads `buildUserInstruction`, and scans `docs/FIGURE-EXTRACTION.md`. Baseline on `dev`: red, all 4 tests fail (first: "the selection prompt must not steer away from results plots"; the instruction test at "the instruction must not ask for an image block").
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **No steering left (verifier):** `grep -rn -i "complementary\|already recreate" src docs/FIGURE-EXTRACTION.md` prints nothing. Baseline on `dev`: red (matches at `src/figure-vlm.ts:153`, `:154`, `src/output.ts:289`, `docs/FIGURE-EXTRACTION.md:14`, `:15`).
4. **skill.md untouched (verifier):** `git diff --quiet dev...HEAD -- skill.md` exits 0. Baseline on `dev`: green.
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/12-the-figure-picker-prefers-the-results-figure.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/12-the-figure-picker-prefers-the-results-figure.test.ts`
- **Assertions digest:** `sha256:00c7e7598444455c593f6a39322ddeffa359ff58855f08c25424514b723b8106`
- **Oracle proof:** On `dev` (0cd17d7) all 4 tests fail for the card's reason: both selection prompts carry "ALREADY recreates" and "CONCEPTUAL", the instruction says "emit it as an `image` block", and the docs say "complementary conceptual figure". A throwaway reference in a detached scratch worktree (one neutral chart-titles line plus one "key results figure" line in `contextBlock`, the `image` sentence replaced with "Never emit `image`: the figure pipeline attaches it.", the two doc passages rewritten) passed all 4 with `tsc --noEmit` clean; the worktree was removed and pruned. The stub model id was then changed from a placeholder to `claude-sonnet-5-5` so card 13's provider check accepts it; the base result was re-run and is unchanged. Traps: "duplicate" is a forbidden word in the selection prompts, so do not use it in the new guidance; the URL test takes the snapshot path, and `PLAYWRIGHT_BROWSERS_PATH` points at an empty directory so no browser starts.

## Out of scope

- Moving the figure choice into the synthesis call (`lead_figure`), two image slots, or any locator redesign: wave-2 design card 18.
- The chart wording in `src/prompt.ts` and `skill.md` (card 02).
- Pin labelling and verification (card 10), PDF URLs and crop maths (card 11), vision model resolution (card 13).

## Budget

- **Worker wall-clock:** 30 minutes
- **Verifier wall-clock:** 20 minutes
- **Spend basis:** promo-flow medians: Sonnet worker about 2.2M tokens, Terra verifier at its worker median of about 6M as an upper bound (no Terra verifier median is logged). The reference diff is about 10 lines across three source files plus two doc passages. Hold one re-brief at the median.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The new `contextBlock` lines and the new `image` sentence, quoted.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls.
- **Codex (verifier):** workspace-write with no network is enough; the test stubs `fetch` and the vision module and writes only under the OS temp dir. `pdftoppm` (poppler) and `sips` must be on `PATH`. Run `codex exec` with stdin redirected from `/dev/null`. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Both roles:** do not create `.env.local` in the run worktree.
