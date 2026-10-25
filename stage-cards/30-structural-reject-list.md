# Stage card 30-structural-reject-list: a chart's shape is checked against the reject list before any value is matched

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/30-structural-reject-list
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** contract/chart-gate/reject.ts
- **Pairing rationale:** One new pure module of eight predicates and two flags, each fully specified with examples: mechanical, so Claude Sonnet 5.5 at medium effort writes it and GPT-6.1 Sol from the other family checks it at high effort (the reading is short, so the Codex share stays small). Stage 29 has a Codex worker and stage 31 another, so worker families alternate across 29, 30 and 31. No gate: it shares no file with stage 29 and reads nothing stage 29 writes.
- **Open decisions:** none

## Surfacing concern

Design stage 19 (`docs/design/chart-value-gate.md`, landed by the operator on 2026-10-21 without a final verifier pass) wave-2 card W2. `## Reject list` (`:391-426`) defines the structural rules that run before the value check, so that small-integer sequences, banned types and admitted estimates never reach the matcher. Today two of them live in `src/quality.ts:71-105` (`chartDataIssues`, ordinal sequence and two-value share) and feed LLM repair; W4 deletes those and calls this module instead. Checked against `dev` at `77909f6`: no `contract/` directory exists, and `tsconfig.json` covers only `src/`, so criterion 2 type-checks the file directly.

Corrections to the design entry, made here because the design landed unverified:

- **Time axis.** The line-across-categories rule hits on `x.type: category`, but v2 has no time type (`x.type` is `category | linear | log`, `docs/design/content-contract-v2.md:324`), so Mertens' quarters on a line must be a category axis and would hit, against the design's own non-hit. Rule used here: a line hits when `x.type` is `category` and not every label is a date form, or when any `x.values` entry is a string that is neither numeric nor a date form (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `Qn YYYY`, `Mon YYYY`). This is the lexical stand-in for the deferred `x.type: time` (Q12).
- **v1 input.** The design names a doughnut "in v1 form" but defines only two rules on v1 configuration (banned type, stacked on a log scale). Given a v1 entry (an object with `config_json`, a string or an object), `rejectRules` evaluates those two only; every other rule needs the v2 chart that `migrateV1` (stage 21) produces.
- **Fixtures.** The design's nine fixtures under `tests/unit/fixtures/chart-gate/synthetic/` carry W5 verdicts (`table`, `dropped`, `kept`) that need the matcher and page text. This card's cases are built inside the frozen test, and the verdict fixtures are left to W4 and W5.

Cold read: a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21. Folded in: numeric predicates read `points[].y` and skip `null`s, the second ordinal clause needs three values, and `hand-off-gap` is defined on first and last non-null indices (all stated below); v2 banned kinds, `polarArea`, a v1 entry's empty flags, the full ordered hit list and scatter and null-gap inputs now have assertions; static, dynamic and side-effect imports are all checked. Its remaining note, that the test is untracked, is answered by committing it with this card before it is queued.

## Objective

`contract/chart-gate/reject.ts` exports `rejectRules(chart)`, which returns every reject rule the chart hits, in the rule order of `## Reject list`, and the two report flags. It is pure and imports nothing outside `contract/chart-gate/`, because stage 16's contract build vendors `contract/` into promo-flow, where the import lint (W7) runs it without page text.

## Inputs (read these in your own context)

- docs/design/chart-value-gate.md (`## Reject list`, lines 391 to 426)
- src/quality.ts (`chartDataIssues`, lines 71 to 105: the ordinal rule is kept verbatim)
- tests/contract/30-structural-reject-list.test.ts (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `contract/chart-gate/reject.ts` (new), exporting `rejectRules(chart): { hits: RuleId[]; flags: Flag[] }` with `RuleId` one of, in this order, `pie-doughnut-radar`, `line-across-categories`, `mixed-projected`, `stacked-on-log`, `ordinal-sequence`, `two-value-split`, `no-variation`, `caption-admission`, and `Flag` one of `linear-series`, `hand-off-gap`. Every rule is evaluated; `hits` lists each that matched, in rule order.
   - **Input.** A v2 chart (`kind`, `title`, `caption`, `x {label, unit?, type, values}`, `y {label, unit?, scale}`, `series[] {name, values?, points?, source}`), typed structurally. A v1 entry (`config_json` present, as a JSON string or an object) is evaluated for `pie-doughnut-radar` (`config_json.type` in `pie`, `doughnut`, `polarArea`, `radar`) and `stacked-on-log` (any `options.scales.<key>.type === 'logarithmic'` together with `stacked: true` on any scale or a `stack` on any dataset) only, with no flags.
   - **pie-doughnut-radar** (v2): `kind` is one of those types (it cannot be on a valid v2 chart; the check is a guard).
   - **line-across-categories**: `kind: line`, and either `x.type: category` with at least one label that is not a date form, or any `x.values` string that is neither numeric nor a date form (see the Surfacing concern).
   - **mixed-projected**: label level, some but not all of the `x.values` labels and series names match `/\b(proj(?:\.|ected|ection)?|forecast|predicted|extrapolat\w*|target|scenario)\b/i` (note that `proj.` ends in a full stop, so a trailing `\b` cannot follow it: match `proj.` followed by a non-word character or the end); or caption level, the caption matches `/\b(projection|projected|forecast|roadmap|scenario)s?\b/i`, the chart has more than one x value, and at least one label contains a year (1900 to 2099).
   - **stacked-on-log** (v2): `kind: stacked_bar` and `y.scale: log`, nothing else.
   - **Numeric values.** Every predicate reads a series' numeric values: `values`, or `points[].y` when there is no `values` (scatter), with `null` entries skipped.
   - **ordinal-sequence**: some series has three or more values, all integers, with a constant step of exactly 1 (ascending or descending) and a first or last value of 0 or 1 (`src/quality.ts:82-91`); or three or more values, all integers, with any non-zero constant step, a first value of 0 or 1, and a categorical x axis (`x.type: category`, or any non-numeric string label).
   - **two-value-split**: exactly one series, with exactly two numeric values, on a categorical x axis. No sum condition.
   - **no-variation**: every series has three or more numeric values and each series is uniform.
   - **caption-admission**: the caption or any series name matches `/\b(approximate(?:ly)?|read[- ]?offs?|traced|illustrative|reconstructed|inferred|eyeballed|digiti[sz]ed|subjective|estimated from)\b/i`. `estimates` alone is not a hit.
   - **Flags**: `linear-series` when any series of three or more numeric values has a constant non-zero first difference; `hand-off-gap` when one series has `null`s after its last non-null index L, and another series has `null`s before its first non-null index F with F at most L + 1 (a historical series handing over to a projection).

## Constraints

- Pure module: no `fs`, `child_process`, `process` or `fetch`; imports only sibling modules (the contract test checks the source text).
- Do not change `src/quality.ts`; W4 deletes `chartDataIssues` once the gate runs in `saveResult`.
- Do not touch `tsconfig.json`, `package.json`, anything under `src/` or any frozen test.
- No network and no paid API calls.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state, a cloned `node_modules` (gitignored) and files under the OS temp directory.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write sandbox, no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/30-structural-reject-list.test.ts` exits 0 (15 tests). Baseline on `dev`: red, 15 of 15 fail (first: `contract/chart-gate/reject.ts does not exist`).
2. **Types (verifier):** `npx tsc --noEmit --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck contract/chart-gate/reject.ts` exits 0, and `npx tsc --noEmit` exits 0. Baseline on `dev`: the first errors (file absent); the second is green.
3. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green.
4. **Card 03 still holds (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/03-chart-checks-run-on-structured-output.test.ts` exits 0. Baseline on `dev`: green.
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/30-structural-reject-list.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/30-structural-reject-list.test.ts`
- **Assertions digest:** `sha256:82d19c37998c74ad690b86400ab245ac5dc8fdc7862b744047884e01ae41daa3`
- **Oracle proof:** On `dev` (`77909f6`) all 15 tests fail because `contract/chart-gate/reject.ts` does not exist. A throwaway 80-line reference in a detached scratch worktree passed all 15, the direct type check was clean, and card 03's test still passed; the worktree was removed and pruned. Each of these mutations of the reference was caught: dropping the date-form exception, the caption-level projection test, the second ordinal clause, the v1 dataset `stack` case, the "some but not all" projection condition, the single-series condition on the two-value split, the `hand-off-gap` flag, turning "every series uniform" into "any series uniform", adding `estimates` to the admission pattern, and (after the cold read) the reference reading `values` only, which fails the scatter case. A trap the worker will meet: `\bproj\.\b` never matches `(proj.)`, because no word boundary follows the full stop; the reference used a lookahead for a non-word character or the end.

## Out of scope

- The value matcher (stage 29), page text (stage 31), verdicts, `gateCharts`, conversion to tables and the fixtures that need them (W4, W5).
- Deleting `chartDataIssues` or changing repair (W4).
- Any schema, prompt or renderer change.

## Budget

- **Worker wall-clock:** 45 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** Wave 1 in this repo: median 0.83M tokens per card, p95 2.1M. Expect under the median: one specified module.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported signature of `rejectRules` and the rule order it uses.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; make no network calls. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough. Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.
