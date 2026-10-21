# Stage card 29-number-normaliser-and-page-text-matcher: a chart value is matched against the printed page exactly, by table, text fragment or value label

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/29-number-normaliser-and-page-text-matcher
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** contract/chart-gate/numbers.ts, contract/chart-gate/match.ts
- **Pairing rationale:** Two new pure modules with a dense, exact specification (a number grammar and three matching units) and real page text as fixtures: precise work rather than open design, so GPT-6.1 Sol at high effort writes it, and Claude Opus 5.5 from the other family checks it, because judging whether a failure is the matcher's or the fixture's needs a careful reader of the design. Codex is used only for the worker, the cheap role for this budget. Stage 30 has a Claude worker, so worker families alternate.
- **Open decisions:** none

## Surfacing concern

Design stage 19 (`docs/design/chart-value-gate.md`, landed by the operator on 2026-10-21 without a final verifier pass) wave-2 card W1. The gate's value check rests on two pure functions: read every number printed on a page (`### Tokenising a page`, `:245-280`), and decide whether a chart value is that number (`### Normalising a chart value`, `:281-299`) inside the right unit of the page (`### The matching unit, per source.kind`, `:300-366`; `### Neighbouring pages`, `:367-377`; `### How false positives are avoided`, `:378-390`). Checked against `dev` at `77909f6`: no `contract/` directory exists; `tsconfig.json` includes only `src/**/*.ts` with `rootDir: src`, so `npx tsc --noEmit` does not see `contract/` (criterion 2 type-checks the two files directly).

Corrections to the design entry, made here because the design landed unverified:

- **En dash.** The grammar treats an en dash as a minus, but `pdftotext` prints ranges with one (`Weeks 21–30` on Demirer page 35). An en dash, hyphen or U+2212 is a minus only when the character before it is not a digit.
- **Short labels.** The label rule matches a token of four or more letters, or the whole name when the name is under four letters. Flyvbjerg's `Oil and gas` has no four-letter token and is longer than four letters, so Table D2 could not pass at tier A as the design claims. Rule used here: any word of four or more letters in the name, or, when the name has none, the whole name as a word-bounded, case-insensitive phrase (`IT`, `Oil and gas`).
- **Fixtures.** The design's `p08-tokens.txt` and `p12-tokens.txt` are token lists, but the `usable` test (stage 31) needs page text. The fixtures here are full per-page `pdftotext -layout` output with control characters removed, committed under this card's contract fixture directory, and stage 31 reads the same files. The design's `tests/unit/chart-gate-match.test.ts` and `tests/unit/fixtures/chart-gate/` copies are not made: the frozen contract test is the unit test.
- **Running heads.** The rule that values found only in a page's first and last three lines fail (`:389-390`) is left to stage W4, which owns page-level verdicts; it is out of scope here.
- **Percent sources.** The design also takes `percent` from a `%` in a column header or caption line above a token (`:277-278`, `:292`). That is left out: `percent` is the token's own suffix, and the percent axis comes from the chart (`y.unit`, `y.label`, series name). A header-only percent table therefore needs exact values, which Demirer Table 5 and EPIC Figure 10 have.
- **Page numbers.** The design's "unless the chart's `x.values` are years" (`:386-388`) is applied to year-like tokens only; a bare integer alone on its line is always a page number.

Cold read: a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21. Folded in: the upward table region, the under-three-values label rule, an uncited page, `points`, the 20 to 160 character fragment bounds and hyphenation now have assertions; static, dynamic and side-effect imports are all checked; the page reported on a failure, `sig` for zero and scientific forms, and fragment length after normalisation are stated below; the two deviations above are recorded; the clean-tree criterion now reads the working tree. Its remaining note, that the test and fixtures are untracked, is answered by committing them with this card before it is queued.

## Objective

`contract/chart-gate/numbers.ts` tokenises a printed line into `NumberToken`s and decides whether a chart value equals a token; `contract/chart-gate/match.ts` decides whether a chart series is printed on its cited page, for `table`, `text` and `value_labels` sources, trying the cited page and then the page before and after. Both are pure (no file, process or network access) and import only each other, because stage 16's contract build vendors `contract/` into promo-flow.

## Inputs (read these in your own context)

- docs/design/chart-value-gate.md (`## Gate inputs` to `## Reject list`, lines 176 to 390, and `## Test fixtures`, lines 663 to 783)
- tests/contract/29-number-normaliser-and-page-text-matcher.test.ts (frozen)
- tests/contract/fixtures/29-number-normaliser-and-page-text-matcher/ (four page texts: Demirer page 35, Flyvbjerg page 27, EPIC pages 8 and 12)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test and its fixtures, which already exist and must not be edited. Paths are relative to repo root.

1. `contract/chart-gate/numbers.ts` (new), exporting:
   - `interface NumberToken { value: number; text: string; decimals: number; sig: number; percent: boolean; line: number; column: number }`. `decimals` counts digits after the point as printed (`11.0` has 1, `187` has 0). `sig` counts significant digits as printed: from the first non-zero digit to the last non-zero digit, plus every digit after a decimal point (`11.0` is 3, `58.40` is 4, `0.5` is 1, `10000` is 1, `0` is 1). A scientific token takes `decimals` and `sig` from its mantissa. `percent` is a `%` suffix. `column` is the character offset of the token's first character, its sign included.
   - `tokeniseLine(line: string, lineIndex = 0): NumberToken[]`, ordered by column. Scientific forms first (`a × 10^b`, `a x 10^b`, `a·10^b`, `a × 10` followed by superscript digits such as `10⁻⁵`, `aE±b`, `ae±b`; one token, value `a × 10^b`). Then plain decimals: optional sign (`-`, U+2212 or an en dash, counted as a minus only when the preceding character is not a digit), digits, a comma as a thousands separator only when followed by exactly three digits and then a non-digit (`13,108.7` is one token, `[0.75,1.17]` and `[12,5]` are two each, `[1,250]` is `1250`), an optional decimal part and an optional `%`. Tokens are bounded by non-numeric characters, and `YYYY-MM` and `YYYY-MM-DD` runs (years 1900 to 2099) yield no tokens.
   - `tokenisePage(lines: string[]): NumberToken[]` (each line's tokens, with `line` set to the index).
   - `valueMatchesToken(v: number, t: NumberToken, opts?: { percentAxis?: boolean }): boolean`: `|v - t.value| <= 1e-9 × max(1, |t.value|)`. Rounding is never a match (`741` against `741.3`, `0.9` against `0.92`). Only when `percentAxis` is true: a fraction token in `[0, 1]` without `%` matches `v` equal to `t.value × 100`, and a `%` token matches `v` in `[0, 1]` equal to `t.value / 100`.
2. `contract/chart-gate/match.ts` (new), exporting:
   - `interface PageText { page: number; lines: string[]; tokens: NumberToken[]; usable: boolean }` (the design's shape) and `pageTextFromLines(page: number, lines: string[], usable: boolean): PageText`, which fills `tokens` with `tokenisePage`.
   - Structural input types, so that stage 16's v2 `Chart` fits without importing it: a chart `{ x: { values: (string | number)[]; label?; unit?; type? }; y?: { label?; unit?; scale? }; caption? }` and a series `{ name: string; values?: (number | null)[]; points?: { x: number; y: number }[]; source: { kind: string; ref: string; page?: number } }`. A series' values are `values`, or `points[].y`; `null` entries are skipped.
   - `matchSeries(chart, series, pageText: (page: number) => PageText | null): { pass: boolean; tier?: 'A' | 'B'; page?: number; reason?: string; unmatched: number[] }`. `page` is the page that decided the verdict: the passing page, or on a failure the first page tried that had text. A series with no numeric value, or a `table`, `text` or `value_labels` source with no `page`, fails with a reason. When a series has both `values` and `points`, `values` wins. `unmatched` lists the series values found nowhere in the matching unit (the table region, the fragment, or the page's eligible tokens), and is empty on a pass. Kinds other than `table`, `text` and `value_labels` return `pass: false` with a reason; stage W4 decides what they mean.
   - The rules of `### The matching unit` (`:300-366`) and `### Neighbouring pages` (`:367-377`), with the corrections in the Surfacing concern: the table region runs from the caption line (`^\s*Table\s+<id>\b`) to the next `Table` or `Figure` caption line or the first two consecutive blank lines after at least one numeric line, and when that downward region holds no numeric line (a caption below its table) it runs upward from the caption by the same rule instead; tier A by row layout (one line holding a label match and every non-null value) or column layout (each value on a line holding its `x.values[i]` label, all value tokens within 12 columns of each other); tier B when every value is in the region and the series has at least three values, each matched by a token with three or more significant digits. A `table` series whose caption is on none of the three pages fails with a reason containing `Table <id> not found on page N (searched N-1 to N+1)`. A `text` fragment must be 20 to 160 characters, hold at least three alphabetic words and every value as a token, and occur in the page text after whitespace is collapsed and line-end hyphenation removed. `value_labels` needs the figure caption line on the page, or a usable page when the caption is absent, and every value matched by a token with at least three significant digits or at least two decimals; a series of fewer than three values also needs each value's line to hold a label match for the series name or that value's `x.values` label. Fragment length is measured after normalisation.
   - Two exclusions on every page: a year-like integer token (1900 to 2099, no decimals) does not match unless every `x.values` entry is such a year, and an integer token alone on its line is a page number and never matches.
   - `percentAxis` is true when `y.unit`, `y.label` or the series name contains `%`.

## Constraints

- Pure modules: no `fs`, `child_process`, `process` or `fetch`; imports only sibling modules (the contract test checks static, dynamic and side-effect imports in the source text).
- Do not touch `tsconfig.json`, `package.json`, anything under `src/` or any frozen test or fixture.
- No network and no paid API calls; the fixtures are committed text, so no PDF or `pdftotext` is needed.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state, a cloned `node_modules` (gitignored) and files under the OS temp directory.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Opus 5.5 verifier through the Claude CLI; no network needed. The worker (Codex workspace-write sandbox) can run every command too.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/29-number-normaliser-and-page-text-matcher.test.ts` exits 0 (13 tests). Baseline on `dev`: red, 13 of 13 fail (first: the existence assertion `contract/chart-gate/numbers.ts does not exist`; the rest at `Cannot find module`).
2. **Types (verifier):** `npx tsc --noEmit --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck contract/chart-gate/numbers.ts contract/chart-gate/match.ts` exits 0, and `npx tsc --noEmit` exits 0. Baseline on `dev`: the first errors (files absent); the second is green.
3. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green.
4. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/29-number-normaliser-and-page-text-matcher.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
5. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/29-number-normaliser-and-page-text-matcher.test.ts`
- **Assertions digest:** `sha256:f55561707d2fe9a4a25eed1f62a6410a3650782a60906d13401a6930f65568cb`
- **Oracle proof:** On `dev` (`77909f6`) all 13 tests fail because `contract/chart-gate/numbers.ts` does not exist. A throwaway reference in a detached scratch worktree (an 85-line `numbers.ts` and a 170-line `match.ts`) passed all 13, both type-check commands were clean, and every wave-1 contract test still passed; the worktree was removed and pruned. Mutation checks against the reference, each of which the test caught: dropping the en-dash range rule, the date-run exclusion, the three-digit thousands rule, the percent-axis guard, the trailing-zero rule for integer `sig`, the tier-B three-digit rule, the year exclusion, the 20-character fragment minimum, the value-label precision rule, the label-word requirement, widening the column band to 100, and (after the cold read) the reference without the upward region, the under-three-values label rule, the uncited-page refusal, or with a side-effect `import "fs"`. Narrowing the band to 0 is not caught, because Flyvbjerg's alpha column is perfectly aligned; the test pins that a value from another column breaks the band, not the width. Fixture facts the worker will meet: Demirer's `Async agent` row ends in an em-dash cell (the chart value there is `null`); `58.4` must match the printed `58.40%`; Flyvbjerg page 27 is printed page 40 and carries Table D3 (`IT 0.91`) below Table D2, which the region must exclude; EPIC page 8's `Figure 9` caption is not at the start of its line, so the usable-page fallback decides there.

## Out of scope

- The reject list (stage 30), page text extraction and `pdftotext` (stage 31), `gateCharts`, verdict lines and the running-head rule (W4).
- `supplied` and `legacy` semantics beyond returning a non-pass with a reason.
- Any change to `src/quality.ts`, the prompt or the schema.

## Budget

- **Worker wall-clock:** 90 minutes
- **Verifier wall-clock:** 40 minutes
- **Spend basis:** Wave 1 in this repo: median 0.83M tokens per card, p95 2.1M. Expect about 2M for the worker (a precise spec, real fixtures, two modules) and 1M for the verifier.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported signatures of both modules.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block or its fixtures fails the stage. The worker runs criteria 1 to 3 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the test reads only committed fixtures. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
