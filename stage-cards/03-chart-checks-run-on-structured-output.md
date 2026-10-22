# Stage card 03-chart-checks-run-on-structured-output: the repair loop validates the canonical explainer, so chart checks fire on structured output

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/03-chart-checks-run-on-structured-output
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Depends on:** 01-contract-tests-run-with-npm-test
- **Dispatch:** serial
- **Pairing rationale:** The fix is mechanical once the seam is named: split one function, collapse two near-identical loops into one shared helper, add one validator rule. The cheap Codex tier does it and the cheap Claude tier checks it from the other family. Card 02 has an Opus worker and card 04 a Sonnet worker, so worker families alternate. Serial because it edits `src/batch.ts`, `src/output.ts` and `src/quality.ts`, which cards 02, 04 and later also edit.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19, plan item 5 and the high finding at `src/quality.ts:58` (confirmed by execution). Lines checked against `dev` at 0cd17d7:

- The model-facing schema makes `charts[].config_json` a string (`src/schema/explainer-schema.ts:133`), and structured output is on by default (`:193`).
- Both repair loops (`maybeRepairClaude`, `src/batch.ts:233`; `maybeRepairOpenAI`, `:271`) parse the reply and run only `normalizeSchemaDrift` (`:247`, `:284`) before `validateJsonOutput`. `parseStringifiedConfigJson` (`src/output.ts:110`) and `stripSchemaNulls` (`:138`) only run later, inside `saveResult`.
- `chartDatasetNumbers` (`src/quality.ts:57`) reads `config_json` only when it is an object, so on the default route the ordinal and share-of-whole checks see nothing. The orchestrator re-ran it: a `[1,2,3,4,5]` bar chart is flagged as an object and passes as a string.
- A `config_json` string that does not parse also passes, because `src/quality.ts:254` only checks that the key exists.
- The two repair loops are near copies, which is how both carry the same gap.

Cold read: a read-only Codex session (other family) read this card with 01, 04, 07, 08 and 09 on 2026-10-19 and raised nothing for it.

## Objective

Every repair-loop validation runs on the canonical explainer (nulls stripped, drift fixed, `config_json` parsed back into an object), through one provider-neutral `repairUntilValid` in `src/repair.ts` that both providers call with their own repair function. A stringified ordinal chart is sent to repair, a clean stringified chart is not, and a `config_json` that is still a string after canonicalisation is a validation issue.

## Inputs (read these in your own context)

- `src/batch.ts` (`maybeRepairClaude`, `maybeRepairOpenAI`, `RepairResult`, `MAX_REPAIR_ATTEMPTS` and their callers)
- `src/output.ts` (`extractJson`, `parseStringifiedConfigJson`, `normalizeChartEntry`, `stripSchemaNulls`, `normalizeSchemaDrift`, `normalizeExplainerJson`)
- `src/quality.ts`
- `src/providers.ts` (`ProviderMessageResponse` only)
- `src/schema/explainer-schema.ts` (header comment and the chart schema)
- `tests/contract/03-chart-checks-run-on-structured-output.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/output.ts`: export `canonicaliseExplainerJson(json)`, which does what `normalizeExplainerJson` does today up to choosing the chart candidates (strip schema nulls, fix drift, run `normalizeChartEntry` on each chart so a stringified `config_json` becomes an object and `config_raw` is filled, fall back to the legacy `chart`), sets `charts` and `chart` from those candidates, and returns the same object. It does not apply the `MIN_CHART_POINTS` filter or the three-chart cap. `normalizeExplainerJson` calls it and then applies the filter and the cap exactly as today.
2. `src/quality.ts`: `validateJsonOutput` adds the issue ``charts[${i}].config_json is not a valid JSON object`` (any wording that starts `charts[i].config_json`) when a chart's `config_json` is a string. Nothing else in the validator changes.
3. `src/repair.ts` (new): `MAX_REPAIR_ATTEMPTS = 2`, the `RepairResult` type moved from `src/batch.ts` unchanged (`{ html: string; usage?: ProviderMessageResponse }`), and `repairUntilValid({ rawText, expectedDate, repair })`, where `repair(system, text)` returns a `ProviderMessageResponse`. The loop is today's loop with one change: each candidate is parsed with `extractJson` and canonicalised with `canonicaliseExplainerJson` before `validateJsonOutput`. Use static imports; the dynamic `await import('./output')` is not needed.
4. `src/batch.ts`: `maybeRepairClaude` and `maybeRepairOpenAI` become thin wrappers (or are inlined at their call sites) that pass a provider-specific `repair` function to `repairUntilValid`: Claude CLI (`createMessageViaCli`) or API (`createMessage` with `EXPLAINER_JSON_SCHEMA`), and OpenAI `createMessage` with the text wrapped as `input_text`, exactly as today. `src/batch.ts` no longer imports or calls `validateJsonOutput` or `buildRepairInstruction`.

## Constraints

- Keep `repaired.html` and the `html` field name: renaming it is card 09.
- Repair behaviour is otherwise unchanged: same attempt count, same instruction text, same models and token caps, same "unparseable means return as is" rule, same usage handling. Card 09 changes those.
- The six-point filter in `src/output.ts` stays exactly as it is (operator decision for wave 1; card 02's contract test pins the `const MIN_CHART_POINTS = (() => {` block and the `if (len < MIN_CHART_POINTS)` line).
- The model-facing schema still emits `config_json` as a string; do not change `src/schema/explainer-schema.ts`.
- No provider-specific branching inside `src/repair.ts`; the provider difference lives only in the `repair` function each caller passes.
- No network and no paid API calls while working; the contract test stubs `fetch` and passes its own `repair` function.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Sonnet 5.5 verifier through the Claude CLI; no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/03-chart-checks-run-on-structured-output.test.ts` exits 0. It covers the stringified chart becoming an object, the thin chart kept by canonicalisation, the ordinal issue firing, the still-a-string issue, no false positive on a clean stringified chart, the shared loop calling and not calling repair, and `src/batch.ts` validating only through it. Baseline on `dev`: red, 8 of 8 fail (first: "src/output.ts must export canonicaliseExplainerJson").
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0 (the script exists once card 01 has landed). Baseline on `dev`: red until card 01 lands, which is ahead of this card in the queue.
4. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/03-chart-checks-run-on-structured-output.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
5. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/03-chart-checks-run-on-structured-output.test.ts`
- **Assertions digest:** `sha256:f0ac797b47d3af78197686b7f13307c024eab897c9ed8bee5739395bd7f88f19`
- **Oracle proof:** On `dev` (0cd17d7) all 8 tests fail for the card's reason: `canonicaliseExplainerJson` is not exported, `src/repair.ts` does not exist, and `src/batch.ts` still calls `validateJsonOutput`. A throwaway reference in a detached scratch worktree (the split in `src/output.ts`, one validator line, a 30-line `src/repair.ts`, two wrapper bodies in `src/batch.ts`) passed all 8 with `tsc --noEmit` clean; the worktree was removed and pruned. The test pins every path in `process.env` before loading `src/`, because `src/output.ts` runs the fill-only `.env.local` loader at import time. Its fixture keeps an `image: null` to show nulls are stripped before validation. After the reference run, the fixture's one paragraph was changed to state the pill numbers (12% and 3x), so the clean document stays clean once card 15's number-not-in-body lint lands; red on `dev` was re-run and holds, and the change cannot affect the reference result because no current check reads paragraph text beyond non-emptiness.

## Out of scope

- Summing usage across attempts, keeping the best candidate, renaming `html` (card 09).
- Validating inside `saveResult` (card 04).
- New chart rejects (doughnut, uniform values, stacked plus log) and handling chart issues in code instead of LLM repair (wave 2).
- Removing or changing the six-point filter.
- Stamping provenance before repair validation.

## Budget

- **Worker wall-clock:** 45 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** promo-flow medians: Terra worker about 6M tokens, Sonnet verifier about 0.9M. Expect near the median: the reference diff is about 90 lines across four files, most of it deleted duplication.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The final shape of the two wrappers (or their inlined call sites) in `src/batch.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 3 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the test stubs `fetch` and writes only under the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
