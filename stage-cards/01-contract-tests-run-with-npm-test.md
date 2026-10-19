# Stage card 01-contract-tests-run-with-npm-test: `npm test` runs the unit tests, with fixtures for the known bad outputs

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/01-contract-tests-run-with-npm-test
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** Mechanical scaffolding (one script line, six fixture files, a README line), so the cheap Codex tier does it and the cheap Claude tier checks it from the other family. Card 02 has an Opus worker, so worker families alternate. Serial because it is first in the queue and touches `package.json`, which nothing else in wave 1 claims but which every later card's verifier relies on.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19, plan item 16 and the medium finding at `package.json:18`: the repo has no test script and no test directory (`package.json` scripts on `dev` at 0cd17d7 end at `guards:install`; `find . -name '*.test.*' -not -path './node_modules/*'` finds nothing apart from the wave-1 contract tests). The only guard is `scripts/smoke-models.ts`, which checks pricing rows. The string `config_json` bypass (`src/quality.ts:58`) went unnoticed for that reason.

Contract tests already live under `tests/contract/` and run one at a time with `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test <file>`. They must stay out of `npm test`: every queued card commits its contract test to `dev` before it runs, so a suite that included them would be red until the whole queue landed, and every verifier's `npm test` would fail on other cards' work.

Cold read: a read-only Codex session (other family) read this card with 03, 04, 07, 08 and 09 on 2026-10-19 and raised nothing for it.

## Objective

`npm test` runs every `tests/unit/**/*.test.ts` file with the built-in `node:test` runner and `ts-node/register` in transpile-only mode, exits non-zero when any unit test fails, and never runs `tests/contract/`. `tests/unit/fixtures/` holds the six raw outputs the review named, ready for later cards' unit tests. The README says how to run it.

## Inputs (read these in your own context)

- `package.json`, `.nvmrc`, `tsconfig.json`
- `README.md` (the Commands table and the Development section)
- `src/output.ts` (`extractJson` only), `src/types/explainer-json.ts`
- `tests/contract/01-contract-tests-run-with-npm-test.test.ts` (frozen; read it to see the fixture shapes it checks)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `package.json`: a `test` script, `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test "tests/unit/**/*.test.ts"` (quote the glob so Node expands it, not the shell). Node's own glob needs Node 22 or later, so `engines.node` becomes `>=22`. No new dependency.
2. `.nvmrc`: `22` (Node 20 left support in April 2026 and cannot expand the glob).
3. `tests/unit/harness.test.ts`: one trivial passing test, so the suite is never empty.
4. `tests/unit/fixtures/`, six files, each a whole explainer document (version, metadata, hero, top_block with two pills, one section, end_takeaway, one anchored reference) unless stated:
   - `stringified-config-json.json`: `charts[0].config_json` is a JSON string of a bar config with six non-ordinal numbers, as the structured-output schema makes the model emit it.
   - `ordinal-sequence.json`: `charts[0].config_json` is an object whose first dataset is `[1,2,3,4,5]`.
   - `uniform-values.json`: the same with `[2,2,2,2]`.
   - `stacked-log.json`: a bar config with two datasets, both axes `stacked: true`, and the y axis `type: "logarithmic"`.
   - `truncated-output.txt`: the first part of a pretty-printed explainer, cut mid-document so neither `JSON.parse` nor `extractJson` accepts it.
   - `metadata-less.json`: a parseable explainer with no `metadata` key.
5. `README.md`: `npm test` in the Commands table and in the Development block, with one sentence saying contract tests under `tests/contract/` are run one file at a time by the stage that owns them and are not part of `npm test`.

## Constraints

- `npm test` must not run anything under `tests/contract/`.
- Do not change `src/`, `tsconfig.json` (it type-checks `src/` only and must stay that way, or the frozen contract tests of queued cards would break `npm run typecheck`), or any existing script.
- Fixtures use invented values only (no real paper numbers), British English, no em dashes.
- No network calls; the unit tests must run offline.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Sonnet 5.5 verifier through the Claude CLI; no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/01-contract-tests-run-with-npm-test.test.ts` exits 0. It writes throwaway sentinel tests under `tests/unit/` and `tests/contract/`, runs `npm test`, checks which ran, checks a failing unit test fails the run, checks the six fixtures and the README, then deletes the sentinels. Baseline on `dev`: red, 10 of 10 fail (first: "scripts.test is missing").
2. **Suite (verifier):** `npm test` exits 0. Baseline on `dev`: red (`Missing script: "test"`).
3. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
4. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/01-contract-tests-run-with-npm-test.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
5. **Clean tree (verifier):** `git diff --check dev...HEAD` passes, `git diff --name-only dev...HEAD` lists only deliverables, and `git status --porcelain` shows no leftover `contract01-` sentinel. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/01-contract-tests-run-with-npm-test.test.ts`
- **Assertions digest:** `sha256:6ea37b90dfb85559ee7315f128c32b72f92bd00a239c40cd4e5ce2dd67a8b9fb`
- **Oracle proof:** On `dev` (0cd17d7) all 10 tests fail for the card's reason: no `scripts.test`, `npm test` exits with "Missing script", no fixture files, no `npm test` in the README. A throwaway reference in a detached scratch worktree (the script line above, a one-test `harness.test.ts`, the six fixtures, one README line) passed all 10 on Node 26.5; the worktree was removed and pruned. Two traps the reference met, both fixed in the test before freezing: a nested `node --test` inherits `NODE_TEST_CONTEXT` from the outer runner and silently runs nothing, so the test strips it; and npm writes a log under the home directory, which a sandboxed seat cannot, so the test sets `npm_config_logs_max=0`.

## Out of scope

- Unit tests that exercise the fixtures against `src/` (the cards that fix each behaviour add them).
- A `test:contract` script or any runner for `tests/contract/`.
- CI wiring, coverage, vitest or any other dependency.
- `scripts/smoke-models.ts`.

## Budget

- **Worker wall-clock:** 30 minutes
- **Verifier wall-clock:** 20 minutes
- **Spend basis:** promo-flow medians: Terra worker about 6M tokens, Sonnet verifier about 0.9M. Expect well under the median: the reference diff is two lines of config, one README line, one tiny test and six small fixtures.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The `npm test` output.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 3 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. The contract test spawns `npm test` and writes only inside the worktree and the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree. The machine runs Node 26; the script needs Node 22 or later.
