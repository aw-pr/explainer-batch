# Stage card 02-charts-come-only-from-stated-values: the synthesis prompt allows a chart only when every value is stated in the paper

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Verifier:** GPT-6 Astra <gpt-6-astra@local>
- **Base branch:** dev
- **Run branch:** autometta/02-charts-come-only-from-stated-values
- **Worker effort:** high
- **Verifier effort:** medium
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** `skill.md` is the production system prompt, so this is a judgement card: the rules have to read as one coherent chart section, not a list of patches, and the wording decides model behaviour. Opus writes it; Astra, from the other family, reads it cold the way a different model will read the prompt. Card 14 (next in the queue, also on `skill.md`) swaps the pair, so the families alternate.
- **Open decisions:** none

## Surfacing concern

The bad charts come from the prompt, not the model. `skill.md` tells the synthesis model to "recreate the relevant figure as a Chart.js chart" (`skill.md:25`) and to "Match the axes, groupings, and data points" (`:211`), to "reproduce it as a chart whatever the paper's genre" (`:142`), offers radar as a chart type and tells the model to copy a paper's radar shape (`:160`, `:167`), and accepts "a faithfully recreated figure" in the checklist (`:260`). The user instruction opens with "Read the figures" and reserves charts for "capability profiles" (`src/prompt.ts:25`). Charts carry no field that says where their numbers came from (`src/types/explainer-json.ts:124-141`), so a value read off a curve looks the same as a value from a table.

The outputs show the result. The same EPIC Figure 9 was charted three times with three different datasets, and the captions say "approximate read-offs" and "traced from the published figure". A URL source (plain page text, `src/preprocess.ts:509`) produced a Hitzig chart that split a reported "28-33%" range into two invented points. Live charts include doughnuts, stacked bars on a log axis, lines drawn across categories and radar charts with invented scores. The table example in the prompt also uses real EPIC numbers (`skill.md:119-127`), which a model can copy into an unrelated paper.

These are the interim rules. The wave-2 provenance gate (a `source{kind, ref, page}` on every series, checked against the PDF text layer) replaces them later. Until then the 6-point filter in `src/output.ts` (`MIN_CHART_POINTS`) stays exactly as it is (operator decision).

Cold read 2026-10-19 by the other family (codex exec, read-only, model gpt-6-sol): it asked what "stated" means for figure value labels and what a URL caption cites, and noted the user-instruction check is narrower than the objective; all three are answered in Objective and Constraints.

## Objective

`buildSystemPrompt()` tells the model to draw a chart only from values stated in the text or a table, to name that table or page in the caption, and otherwise to prefer a table; it bans read-offs, pie, doughnut and radar charts, lines across categories, split ranges and stacked bars on a log axis, and limits a URL source to at most one chart. `buildUserInstruction()` agrees with it: no "Read the figures", no capability profiles, charts only from stated values, and a table when in doubt. The prompt's example carries no real paper's numbers.

## Inputs (read these in your own context)

- `skill.md` (whole file; the body after the frontmatter is sent to the model verbatim)
- `src/prompt.ts`
- `src/output.ts` lines 357-411 (the 6-point filter you must leave alone)
- `CLAUDE.md` (Claude-specific notes: `skill.md` is production code)
- `tests/contract/02-charts-come-only-from-stated-values.test.ts` (the frozen oracle)
- This card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `skill.md`, chart guidance only. Line numbers are from 2026-10-19; re-check them.
   - Steps (`:22`, `:25`): the model reads figures to understand the paper but takes numbers only from the text and tables; step 4 draws a chart only when every value is stated in the text or a table.
   - Table example (`:119-127`): replace the EPIC columns, row labels and values (HotpotQA, MuSiQue, MultiNews, Mistral 7B, 58.4 and the rest) with obviously fake placeholders such as `System A` and `Benchmark 1`. Keep the `table` block itself.
   - Table guidance (`:140`, `:142`): drop "capability profile (radar)" and the "reproduce it as a chart whatever the paper's genre" override.
   - Chart block (`:154`, `:158-167`): drop radar from the allowed types and the two "reproduce that shape" rules; a line chart needs a time or other continuous axis, never categories; stacked bars never sit on a log axis; pie, doughnut and radar are banned in one sentence.
   - "When does a chart earn its place?" (`:193-215`): state the stated-values rule once, near the top, with the caption naming the table or page, the range rule, "prefer a table" as the fallback, and the URL rule; rewrite `:211` so nothing asks the model to match axes or data points.
   - Checklist (`:260`): every chart value is stated in the text or a table, and the caption names it.
   - Keep checks 1 to 7, including check 4 (at least 6 points), because the code filter it describes stays.
2. `src/prompt.ts`, `buildUserInstruction` only: replace "Read the figures and tables as well as the prose" and "reserve Chart.js charts for genuine trends, relationships, or capability profiles" with wording that matches the new rule (figures for understanding, numbers from text and tables, charts only from stated values, prefer a table). Replace the em dash in the focus-hint sentence (`:40`) with a semicolon or a full stop.

The test asserts these short phrases (case-insensitive, regex in brackets where the wording may vary). Use them as written; the sentences around them are yours:

- `never read values off` (a figure's axes or curves)
- `stated in the text or a table`
- `name the table or page` (`names?` is accepted; this is the caption rule)
- `pie, doughnut or radar` (`and` is accepted)
- `never join categories with a line` (`connect` is accepted)
- `never split a reported range`
- a sentence with `no` or `never`, `stacked bars` and `log` (stacked bars on a log axis)
- `prefer a table`
- `at most one chart`, in a sentence that also says `URL`

## Constraints

- Change only the chart guidance, the steps and the table example in `skill.md`. The "Headline rules", "Writing the prose" and the style lines of the checklist belong to card 14, which runs next on the same file; leave them byte-identical.
- "Stated" means printed as text in the paper's prose or in a table. A number printed only as a value label inside a figure does not count in this interim rule, because nothing can check it yet; the wave-2 gate decides whether value labels become a source. For a URL source, which has no page numbers, the caption names the table or the section heading of the page instead.
- Every sentence that mentions pie, doughnut, radar or spider must be a ban (it contains no, never, not or banned).
- No em dash or horizontal bar in any paragraph that carries a new chart rule, or anywhere in `buildUserInstruction`. En dashes between digits (`0–4`) are fine.
- `src/output.ts` is not edited: `MIN_CHART_POINTS`, its default of 6 and the thin-chart filter stay.
- Leave the `image` sentence in `buildUserInstruction` as it is; the image contradiction is a separate change.
- No change to `src/quality.ts`, the JSON schema, the types or the `recreated_figure` pipeline (`src/figure-data.ts`).
- British spelling in everything you write.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Baselines were taken on `dev` at `0cd17d7` on 2026-10-19.

1. **Contract test (verifier, Codex workspace-write seat):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/02-charts-come-only-from-stated-values.test.ts` exits 0 with 8 passing tests. Baseline: red, 6 of 8 fail; the first failure is "system prompt is missing the rule: never read values off a figure". The em-dash paragraph test and the `MIN_CHART_POINTS` regression test are green on the base and must stay green.
2. **Frozen block intact (verifier, same seat):** `bash scripts/check-contract-test-gate.sh print tests/contract/02-charts-come-only-from-stated-values.test.ts` prints the digest recorded below. Baseline: green once the card and test are committed to `dev`.
3. **Typecheck (verifier, same seat):** `npx tsc --noEmit` exits 0. Baseline: green.
4. **Scope (verifier, same seat):** `git diff --name-only dev...HEAD` lists only `skill.md` and `src/prompt.ts`, plus this card's run state; and `git diff dev...HEAD -- skill.md` shows no change inside "## Headline rules" or "## Writing the prose". Baseline: empty diff.
5. **Reads as one rule set (verifier, read of the diff):** the chart section states each rule once, does not contradict itself (no leftover "reproduce", "match the axes" or radar trigger), and still says to prefer zero charts when the paper has no stated magnitudes. Evidence: `git diff dev...HEAD -- skill.md src/prompt.ts`, quoted in the envelope.

## Contract test

- **Test file:** `tests/contract/02-charts-come-only-from-stated-values.test.ts`
- **Assertions digest:** sha256:6a7166df753ecd44f9e026d9d53b1ccf2d44865ae8a5ace1265ad02fd77b7e16
- **Oracle proof:** red on `dev` (`0cd17d7`, 2026-10-19): 6 of 8 tests fail, first at "system prompt is missing the rule: never read values off a figure"; the em-dash paragraph and `MIN_CHART_POINTS` regression tests pass on the base, as they should. A throwaway reference (the chart edits above plus the two `prompt.ts` sentences, in a detached scratch worktree, since removed) passed all 8, and `npx tsc --noEmit` stayed clean. Trap met by the reference: the "reproduce" ban also matches `:142` ("reproduce it as a chart") and `:211` ("reproduce it as a Chart.js chart"), so all four "reproduce" sentences have to go, not only the two radar ones.

## Out of scope

- The style section, headline rules and the em dashes at `skill.md:156`, `:158` and `:230` (card 14). You may remove an em dash in a paragraph you are already rewriting.
- `MIN_CHART_POINTS` and any code-level chart check (`src/output.ts`, `src/quality.ts`); the wave-2 provenance gate.
- The `image` sentence in `src/prompt.ts` and the figure pipeline (`src/figure-vlm.ts`, `src/figure-data.ts`).
- The pill example at `skill.md:80-82` (it looks like real semi-PD numbers but is not part of this card).
- Re-running any paper or re-baking live explainers.
- The stale Cowork export of the skill.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** promo-flow cost log medians: Opus 5.5 worker 18M tokens (p95 43M), Astra verifier 2.6M. This is a two-file prompt edit, so expect well under the worker median, about 6M, and about 2M for the verifier.

## Dispatch envelope

Return:

- One result per acceptance criterion, with its evidence (command, exit code, the lines that decide it).
- The changed-file list.
- The rewritten chart section of `skill.md` and the new `buildUserInstruction` base string, quoted in full.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Run worktree setup, every role:** the run worktree has no `node_modules`. Clone it from the shared checkout before running anything: `cp -cR ../explainer-batch/node_modules node_modules` (an APFS clone; never a symlink, never `npm install`).
- **Codex (verifier):** workspace-write is enough. No network, no browser, no API keys: the test reads `skill.md` and calls pure prompt builders.

## Re-brief 2026-10-20 (attempt 2)

Attempt 1 (WIP preserved at `667c0f9` on `wip/02-charts-come-only-from-stated-values-attempt-1`) passed criteria 1 to 4 and failed criterion 5. The verifier was right: the new rule makes the caption name its table or page, while the caption paragraph (now `skill.md:156`, "Captions are for the glancing reader: translate, don't cite.") still tells the model not to cite, and the chart example caption ("Plain-language reading guide, then the source table or page.") sits between them. Three caption instructions, two of them in conflict.

**Base.** Start from current `dev`, not from the WIP. Card 14 has since landed and rewrote the style text, including the `:156` paragraph (em dashes gone, new Pareto example), so line numbers in Deliverables are stale; re-check every one. You may read the WIP diff (`git diff 291088c 667c0f9 -- skill.md src/prompt.ts`) and reuse its wording where it still fits; most of it was sound.

**One caption rule.** Every chart caption has the same shape, stated once:

1. Plain words first: how to read the chart (what one point or bar means) and the takeaway, as the `:156` paragraph already asks.
2. Then a short source tag in brackets at the very end, naming the table or page the values come from: `(Table 3, p. 12)`, or `(Table 2)`, or for a URL source the table or the section heading: `(section "Results")`.

Concretely:

- Rewrite the `:156` heading so it no longer says "don't cite". Something like "Captions translate first, then tag the source." Keep the rest of that paragraph's substance (how-to-read, takeaway, translate every symbol, do not change what the statistic means); it was card 14's work and is not being reopened.
- The stated-values bullet says the caption "must name the table or page" (the test phrase) and points to the bracketed tag, not to an "Author (Year), Table 3" lead-in. No author-year prefix in chart captions: the explainer is about one paper.
- The chart JSON example caption and the `table` example caption (`skill.md:120`, currently "Author (Year), Table/Figure N. What the numbers are.") follow the same shape: plain words, then the bracketed tag. The table example must not name a Figure as a source, since figure value labels do not count as stated.
- The checklist line says the same thing in a few words.
- Nothing anywhere in `skill.md` or `src/prompt.ts` may tell the model both to cite and not to cite. Grep for `cite`, `caption`, `source` and `attribution` before returning, and quote each surviving line in the envelope.

**Unchanged.** All other deliverables, constraints, acceptance criteria and the frozen contract test stand as written. Criterion 4's "Headline rules" and "Writing the prose" constraint still holds: the `:156` caption paragraph sits in the chart section, so editing its heading is in scope; the two named sections are not. The em-dash rule still applies to every paragraph you touch.

**Verifier focus for criterion 5.** Read every caption-related line in the diff and in the final `skill.md`. FAIL if any two of them disagree about whether or how a caption names its source.

**Worktree note.** Clone `node_modules` (`cp -cR`), never symlink it; attempt 1's worktree had a symlink.
