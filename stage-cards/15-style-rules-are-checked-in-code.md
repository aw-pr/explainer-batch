# Stage card 15-style-rules-are-checked-in-code: a deterministic style lint runs in validation and feeds repair

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Base branch:** dev
- **Run branch:** autometta/15-style-rules-are-checked-in-code
- **Worker effort:** high
- **Verifier effort:** medium
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** a pure function against a frozen oracle that fixes every rule, fixture and expected path, so the cheaper Claude tier writes it and the cheaper Codex tier verifies it by running tests and reading one diff. Card 14 before it is Astra/Opus, so the worker family alternates.
- **Open decisions:** none

## Surfacing concern

Nothing checks style in code. The repair prompt carries no style rules (`src/quality.ts:295`) and `validateJsonOutput` checks structure only (`src/quality.ts:106-293`), so a model that ignores the prompt's hard floor ships, and a repair pass can undo it. The review's audit of 85 real outputs found em dashes in prose (16 in the Opus 4.7 runs), American spellings before the British rule (169), banned phrases ("leverage", "certainly", "not even close" in the Wu headline), and headlines and pills that claim more than the body. Card 14 rewrites the prompt; this card makes the floor hold whatever the model does.

A reference lint run over `output/` and `output.local/` on 2026-10-19 (86 files) tripped on 54: em dashes in titles and captions, `-ize` spellings, "leverage", and pill numbers missing from the body. It also showed where a naive lint is wrong. "ecosystem" appears about 20 times and almost always in a technical sense (the MCP ecosystem, agent ecosystems, an index's "ecosystem fields"). "bandwidth" is nearly always memory or network bandwidth. "judgment" and "artifact" are accepted British spellings and appear in clean outputs. The rules below are tuned to those findings.

Risk: style issues now make `ok` false, so a run whose output breaks the floor spends one more repair call. The repair model has no copy of the paper (`src/batch.ts:258-263`), so the number check's message must tell it to change the headline or pill, never to add a number to the body.

Cold read 2026-10-19 by the other family (codex exec, read-only, model gpt-6-sol): it asked about `list.intro_html`, `list.items[n].body_html` and the legacy `chart`; all three are now in the field list.

## Objective

`src/style-lint.ts` exports `lintStyle(json)`, which returns one issue per broken rule per field across every prose string field, with a check id and a field path. `validateJsonOutput` appends those issues, so the existing repair loop sees them. The lint is precise: two real clean outputs trip nothing, every allowlisted case trips nothing, and each bad fixture trips exactly one check at the expected path.

## Inputs (read these in your own context)

- `src/quality.ts`
- `src/types/explainer-json.ts` (which fields are prose)
- `src/batch.ts` lines 233-275 (how validation issues reach the repair prompt; read only)
- `skill.md`, "## Writing the prose" (rule 11 is the merged banned list after card 14)
- `tests/contract/15-style-rules-are-checked-in-code.test.ts` (the frozen oracle) and `tests/contract/fixtures/15-style-rules-are-checked-in-code/` (two real outputs, `image.src` stripped)
- This card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test and its fixtures, which already exist and must not be edited. Paths are relative to repo root.

1. `src/style-lint.ts` (new, pure, no I/O). Exports:
   - `type StyleCheck = 'dash' | 'spelling' | 'banned-phrase' | 'number-not-in-body'`
   - `interface StyleIssue { check: StyleCheck; path: string; message: string }`
   - `lintStyle(json: unknown): StyleIssue[]`: returns `[]` for a non-object. At most one issue per field per check.
   - **Prose fields** (the only fields linted), with paths written exactly like this: `metadata.title`, `metadata.eyebrow`, `hero.headline`, `hero.headline_html`, `hero.subtitle`, `top_block.pills[i].number` (dash check only), `top_block.pills[i].description`, `top_block.label`, `top_block.body`, `sections[i].label`, `sections[i].paragraphs[n]`, `sections[i].paragraphs_html[n]`, `sections[i].list.intro`, `sections[i].list.intro_html`, `sections[i].list.items[n].label`, `sections[i].list.items[n].body`, `sections[i].list.items[n].body_html`, `sections[i].table.caption`, `charts[i].title`, `charts[i].caption`, the legacy `chart.title` and `chart.caption` only when `charts` is absent or empty (otherwise `chart` is a copy of `charts[0]` and would report twice), `image.caption`, `image.alt_text`, `recreated_figure.title`, `recreated_figure.caption`, `end_takeaway.label`, `end_takeaway.body`. Never linted: `references` (citations quote other people's titles), `metadata.filename_slug`, dates, colours, `config_json`, `config_raw`, `echarts_option`, series data and table cells.
   - **`dash`:** an em dash (U+2014), a horizontal bar (U+2015), the entities `&mdash;`, `&#8212;` and `&#x2014;`, a spaced hyphen (` - `, ` -- `), or an en dash (U+2013) anywhere except directly between two digits (`16–64%` is fine; `autonomy – and` is not).
   - **`spelling`:** an American-to-British map applied to lowercase words in prose only. Skip capitalised words (proper nouns and sentence starts), anything inside straight or curly double quotes, backticks or `<code>` elements, and HTML tags. At minimum: behavior family, color family, labor, favor family, center family, modeling/modeled, labeled/labeling, defense, catalog, fulfill, the `-yze` family (analyze, analyzed, analyzing), and a general `-ize`/`-ized`/`-izes`/`-izing`/`-ization`/`-izations` rule. The general rule never flags size, seize or capsize (any word ending in `size`, `sized`, `sizes` or `sizing`, and the `seize` family), nor prize, maize or baize. Never flag judgment, artifact, program or percent: both spellings are accepted British usage and they appear in clean outputs.
   - **`banned-phrase`:** the merged list in `skill.md` rule 11, matched case-insensitively on whole words, after the same quote and code skipping: leverage (and its forms), seamless, pain points, synergy, circle back, delve (and its forms), it's worth noting, in conclusion, in summary, fascinating, certainly, unlock (and its forms), game-changer, cutting-edge, navigate the complexities, testament to, tapestry, not even close, robust, robustly, bandwidth. Allowlists for the technical senses: `robustness` is never flagged, and nor is `robust to` (the statistical sense); `bandwidth` is not flagged after memory, HBM, DRAM, network, bus, interconnect, link, PCIe, NVLink or I/O, or before a rate unit (`GB/s`); `ecosystem` is not linted at all, because the corpus uses it almost only in its technical sense and code cannot tell the two apart (the prompt still bans the corporate sense).
   - **`number-not-in-body`:** every number (a digit run with optional `.` or `,` groups, commas removed before comparison) in `hero.headline` or a pill's `number` must appear among the numbers of the body, meaning every prose field under `sections` plus every table cell. A headline or pill with no digits is skipped. The issue's path is the headline or pill-number field. Its message says to change the headline or pill to a number the body already states, never to add a number to the body.
2. `src/quality.ts`: `validateJsonOutput` calls `lintStyle` on the object it validates and pushes one issue string per `StyleIssue`, naming its path and its check (for example `style (dash) at sections[1].paragraphs[0]: ...`). Nothing else in validation changes.

## Constraints

- Pure and deterministic: no I/O, no network, no model call, no dependency.
- `lintStyle` must not mutate its input.
- No change to `buildRepairInstruction`, the repair loop in `src/batch.ts`, `saveResult` or any other validation rule. The existing clean outputs must still validate with no issues.
- The lint does not auto-fix anything; repair stays the only path that rewrites text.
- British spelling and no em dash in every message the lint writes.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Baselines were taken on `dev` at `0cd17d7` on 2026-10-19.

1. **Contract test (verifier, Codex workspace-write seat):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/15-style-rules-are-checked-in-code.test.ts` exits 0 with 28 passing tests: 2 clean real outputs trip nothing and validate; 15 bad fixtures each trip exactly one check at the expected path; 11 good fixtures (digit en dash, plain hyphen, size/seize/capsize, proper noun, quoted term, backticks, `<code>`, memory bandwidth/robustness/ecosystem, an American title in `references`, a concept pill, chart config text) trip nothing; every bad fixture fails `validateJsonOutput` with an issue naming its path. Baseline: red, all 28 fail, 27 at "src/style-lint.ts does not export lintStyle" and the validation test at "\"em dash\" passed validation, so repair never sees it".
2. **Frozen block and fixtures intact (verifier, same seat):** `bash scripts/check-contract-test-gate.sh print tests/contract/15-style-rules-are-checked-in-code.test.ts` prints the digest recorded below (the block also pins each fixture's sha256), and `git diff --name-only dev...HEAD -- tests/` is empty. Baseline: green once committed to `dev`.
3. **Typecheck (verifier, same seat):** `npx tsc --noEmit` exits 0. Baseline: green.
4. **Scope (verifier, same seat):** `git diff --name-only dev...HEAD` lists only `src/style-lint.ts` and `src/quality.ts`, plus this card's run state; the `src/quality.ts` diff is the import and the loop that appends style issues. Baseline: empty diff.
5. **Earlier cards still hold (verifier, same seat):** the card 02 and card 14 contract tests (`tests/contract/02-charts-come-only-from-stated-values.test.ts`, `tests/contract/14-explainer-prose-is-faithful-not-quippy.test.ts`) exit 0 with the same command form. Baseline: red on `dev` today; green once those cards land, which serial dispatch guarantees before this card runs. If either has not landed, record it as not applicable rather than failing it.

## Contract test

- **Test file:** `tests/contract/15-style-rules-are-checked-in-code.test.ts`
- **Assertions digest:** sha256:d9d36d0579fb01189178f3a05341c66c275cea80983eabc67fde8920642de4f7
- **Oracle proof:** red on `dev` (`0cd17d7`, 2026-10-19): all 28 tests fail, 27 at "src/style-lint.ts does not export lintStyle" (the test loads the module lazily, so a missing module reads as an assertion failure, not a crash) and the validation test at "\"em dash\" passed validation". A throwaway reference (a 93-line `src/style-lint.ts` with the rules above and a three-line hook in `validateJsonOutput`, in a detached scratch worktree on top of the card 02 and 14 references, since removed) passed all 28, kept the card 02 and 14 tests green, and `npx tsc --noEmit` stayed clean. Fixtures: `output/2026-06-17_demirer_writing-vs-shipping-code_explainer.json` (Opus) and `output/2026-07-31_flyvbjerg_it-cost-risk_explainer.terra.json` (GPT-5.6 Terra), chosen because the reference lint found nothing in them and both validate with no issues; `image.src` was stripped to keep them small. Traps met by the reference: a bare word list flags "judgment" and "artifact" in clean outputs, and a bare `ecosystem` ban trips on the technical sense, which is why both are excluded above.

## Out of scope

- Per-file template counts (", not Y", "It is not X. It is Y."), the long-sentence share and first-use acronym expansion: the review lists them, but they need thresholds the operator has not set.
- Changing the repair prompt or the repair loop, and running validation inside `saveResult` (a separate card).
- Linting `references`, chart configs or table cells for anything but body numbers.
- Re-linting live explainers in promo-flow.

## Budget

- **Worker wall-clock:** 45 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** promo-flow cost log medians: Sonnet 5.5 worker 2.2M tokens, Terra as verifier about 1M (no Terra verifier median is logged; the Sonnet verifier median is 0.9M). One new module and a three-line hook; expect about the median.

## Dispatch envelope

Return:

- One result per acceptance criterion, with its evidence (command, exit code, the lines that decide it).
- The changed-file list.
- If `../explainer-batch/output` exists beside the run worktree, the count of issues per check from running `lintStyle` over its `*_explainer*.json` files (information only, not a criterion).
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block or its fixtures fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Run worktree setup, every role:** the run worktree has no `node_modules`. Clone it from the shared checkout before running anything: `cp -cR ../explainer-batch/node_modules node_modules` (an APFS clone; never a symlink, never `npm install`).
- **Codex (verifier):** workspace-write is enough. No network, no browser, no API keys.
