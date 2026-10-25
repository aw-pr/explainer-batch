# Stage card 32-typecheck-reaches-contract: a `src/` module may import from `contract/`, and the project type-check covers both

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/32-typecheck-reaches-contract
- **Worker effort:** low
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** tsconfig.json
- **Pairing rationale:** A two-line config change pinned by a frozen test: Claude Sonnet 5.5 at low effort makes it, GPT-6.1 Sol from the other family checks it at high effort. Stage 31 has a Codex worker, so worker families alternate. No gate: the test carries its own `src/` and `contract/` probe, so it does not need stage 20's modules, and it type-checks whatever `contract/` files have landed when it runs.
- **Open decisions:** none

## Surfacing concern

`tsconfig.json` sets `rootDir: src` and includes only `src/**/*.ts`. Wave 2 puts the shared contract in `contract/` (stages 20, 21, 29 and 30), and later cards need `src/` code to import it: the chart gate's `src/chart-gate.ts` (design 19 W4) and the v2 pipeline (design 16 W6). Today any `src/` file that imports `../contract/` fails `npx tsc --noEmit` with TS6059 (file not under `rootDir`), and so does `ts-node` in its default type-checking mode, which `npm run process` uses. Stage 31 worked round it by keeping `src/page-text.ts` free of `contract/` imports. Nothing reads `dist/` (no `main` or `bin` in `package.json`), so widening `rootDir` costs only a change of output layout. Checked against `dev` at `aa14ae6`.

## Objective

`tsconfig.json` has the repo root as its `rootDir` (set to `.`, or left unset so the compiler computes it) and includes `contract/**/*.ts` beside `src/**/*.ts`, so a `src/` module can import from `contract/` and `npx tsc --noEmit` type-checks both trees under the existing strict options.

## Inputs (read these in your own context)

- tsconfig.json
- tests/contract/32-typecheck-reaches-contract.test.ts (frozen)
- tests/contract/fixtures/32-typecheck-reaches-contract/ (the probe: a source file importing a sibling contract module)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test and its fixtures, which already exist and must not be edited. Paths are relative to repo root.

1. `tsconfig.json`: `compilerOptions.rootDir` becomes `.` (or is removed); `include` becomes `["src/**/*.ts", "contract/**/*.ts"]`. Every other compiler option and `exclude` stays as it is.

## Constraints

- No other compiler option changes: `strict`, `target`, `module`, `lib`, `esModuleInterop`, `skipLibCheck` and `outDir` stay as they are, and nothing under `tests/` or `scripts/` joins the project type-check.
- If a landed `contract/` file fails the project type-check, stop and report it; do not edit `contract/` or `src/` to make it pass.
- `npm run build` now writes `dist/src/` and `dist/contract/` instead of `dist/*.js`. That is expected; nothing consumes `dist/`.
- No paid API calls.
- Do not create or modify files outside the deliverables, except this card's run state, a cloned `node_modules` (gitignored) and files under the OS temp directory (the test writes its probe tsconfig there).

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write sandbox, no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/32-typecheck-reaches-contract.test.ts` exits 0 with 4 passing. It covers: the probe `src/` file importing a sibling `contract/` module type-checks with no TS6059; the project lists `src/index.ts` and every landed `contract/**/*.ts` and nothing under `tests/`; the whole project type-checks; no other compiler option or `exclude` changes. Baseline on `dev`: red, 3 of 4 fail (first: `TS6059: File '.../fixtures/32-typecheck-reaches-contract/src/uses-contract.ts' is not under 'rootDir'`); the whole-project check is green on `dev` and guards against regression.
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green.
4. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/32-typecheck-reaches-contract.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
5. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only `tsconfig.json`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/32-typecheck-reaches-contract.test.ts`
- **Assertions digest:** `sha256:8925e80fe75790dbee7db01d208ff56a9eb2914df04712a0726ba7a3767b7a46`
- **Oracle proof:** On `dev` (`aa14ae6`) 3 of 4 tests fail: the probe hits TS6059, `include` lacks `contract/**/*.ts`, and `rootDir` is `src`. A throwaway reference in a detached scratch worktree (the two-line `tsconfig.json` change), with stage 29's reference `contract/chart-gate/{numbers,match}.ts` present, passed 4 of 4, so the strict project check also covers real `contract/` code. Mutations the test caught: keeping `rootDir: src` with the wider `include` (4 fail), and adding `tests/**/*.ts` to `include` (2 fail). The worktree was removed and pruned.

## Out of scope

- TypeScript project references, path aliases or a separate `contract/tsconfig.json`.
- Type-checking `scripts/` or `tests/`.
- Any edit under `src/` or `contract/`, including removing stage 31's workaround.

## Budget

- **Worker wall-clock:** 20 minutes
- **Verifier wall-clock:** 20 minutes
- **Spend basis:** Wave 1 in this repo: median 0.83M tokens per card, p95 2.1M. Expect well under the median: one config file.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The final `tsconfig.json`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block or its fixtures fails the stage. The worker runs criteria 1 to 3 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; make no network calls. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough; the test writes only under the OS temp directory. If `node_modules` is missing in the run worktree, clone it from the main checkout as above. Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.
