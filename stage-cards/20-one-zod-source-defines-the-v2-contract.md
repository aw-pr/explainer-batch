# Stage card 20-one-zod-source-defines-the-v2-contract: one zod source defines the v2 explainer contract and generates every schema dialect

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/20-one-zod-source-defines-the-v2-contract
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Dispatch:** serial
- **Path claims:** contract/explainer-v2.ts, contract/inline.ts, contract/derive.ts, contract/dialects.ts, contract/generated/, scripts/contract-build.ts, tests/unit/contract.test.ts, tests/unit/fixtures/v2/, package.json, package-lock.json
- **Pairing rationale:** The first card of wave 2 and the schema every later card builds on, written fresh from a long design: a strong Claude worker at high effort (Opus 5.5; the design is settled, so the frontier tier is not needed for judgement), checked from the other family by GPT-6.1 Sol, which can read the zod source against the design and run every command offline. Serial because `package.json` is a shared file other tranche-1 cards may also touch.
- **Open decisions:** none

## Surfacing concern

Design stage 16 (`docs/design/content-contract-v2.md`, landed at `447c19d`) card W1. Today the explainer contract lives in six or seven hand-kept places that have drifted (`## Current state`, D1 to D13). Wave 2 replaces them with one zod 4 source from which the TypeScript types, the runtime validators and the provider schema dialects are generated. Nothing consumes the new files in this card; W6 (a later card) switches the producer, and promo-flow reads them from W3.

Checked against `dev` at `77909f6`: no `contract/` directory exists; zod is not a direct dependency (`package.json:36-41`) but `node_modules/zod` is 4.3.6, pulled in by `@anthropic-ai/sdk`; `tsconfig.json` includes only `src/**/*.ts`.

Two corrections to the design, found while building the reference:

- zod 4.3.6 emits a discriminated union as `oneOf`, not `anyOf` (the design's `### What zod 4 emits` says `anyOf`). OpenAI's strict subset has no `oneOf`, so the OpenAI pass rewrites `oneOf` to `anyOf`.
- "A numeric axis has a unit" is listed with the structural chart refinements, but structural refinements hold in both compositions and no v1 Chart.js chart carries a unit, so every migrated chart (card 21) would fail to parse. This card applies the unit rule on the wire only, like the editorial bounds. The design's renderer guarantee (`### The chart island's input`, "`unit` present on every numeric axis") therefore holds for native v2 charts only; W4's renderer must tolerate a missing unit on a migrated chart.

Cold read 2026-10-21 by the other family (codex exec, read-only, model gpt-6.1-sol): it found the wire section-bound assertions vacuous (their sections lacked the required `list` and `table` nulls), the drift assertion too loose, and asked about a year-less byline, `contract:check` over the vendored copies, `--website` without `WEBSITE_REPO`, and the ordinal checks; each is fixed in the test or answered in Deliverables and Out of scope.

Operator decision applied: Q12, keep up to three charts in a stored artefact (the design's recommendation); the wire stays at one.

## Objective

`contract/explainer-v2.ts` declares `ModelOutputV2` (what the model emits) and `ExplainerV2` (the stored artefact) once each through the two-composition pattern of the design's `### One source, two compositions`, exports `modelOutputValidator({citationKnown})` and `CONTRACT_REVISION = 1`, and `npm run contract:build` generates the canonical schema and the OpenAI, Claude and Gemini dialects from it, with `npm run contract:check` as the drift gate.

## Inputs (read these in your own context)

- `docs/design/content-contract-v2.md`: `## Schema v2` (all of it), `## Dialects and generation`, Q1, Q3, Q4, Q12, and W1 under `## Wave-2 cards`
- `node_modules/zod/v4/core/json-schema-processors.js` and `node_modules/zod/v4/core/to-json-schema.d.ts` (what the generator emits)
- `src/schema/explainer-schema.ts` (today's hand-written OpenAI schema; read for the strict-mode conventions only, do not change it)
- `output/2026-04-16_alenezi_agentic-ai-architecture_explainer.json` (the tracked v1 sample)
- `tests/contract/20-one-zod-source-defines-the-v2-contract.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `contract/inline.ts`: `sanitiseInline`, `inlineToPlain`, `toPlain` and the `PlainText` check, per `### Text types`. `sanitiseInline` keeps `em`, `strong`, `code`, `sub`, `sup` with no attributes and `a` with exactly one `href` attribute holding an `http(s)` URL (no nested `a`); lowercases tags; drops any other tag and its attributes while keeping the inner text; decodes entities and re-escapes text as `&amp; &lt; &gt; &quot;` only. `InlineText` is valid when `sanitiseInline(s) === s`. `PlainText` rejects `/<\/?[a-zA-Z]/` and any HTML entity; `<70%` is fine.
2. `contract/explainer-v2.ts`: both compositions per `### Shape`, `### Fields` and the sketch in `### One source, two compositions`, every object a `z.strictObject`, with:
   - wire nullables (`c.opt` on the wire) as required-but-nullable properties; stored optionals as optional and **not** nullable;
   - editorial bounds (title 80, headline 160, subtitle 320, 2 to 5 sections, 2 to 6 pills with lead 24 and text 160, figure `why` 240, `end_takeaway` required with pills) on the wire only;
   - structural rules in both: non-empty strings, a section has paragraphs or a list or a table, `end_takeaway` forbidden with a takeaway top block, `emphasis` a substring of `headline`, a non-scatter series' `values` the length of `x.values`, a scatter series has `points`, no `stacked_bar` on a log `y`;
   - the unit rule (`y.unit`, and `x.unit` when `x.type` is not `category`) on the wire only (see Surfacing concern);
   - series source kinds `table | text` on the wire and `table | text | value_labels | supplied | legacy` in the artefact; wire `charts` at most 1, stored at most 3 (Q12);
   - `references` exactly one entry with `origin: detected | model | legacy`; the stored slug rule `^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9_-]*_explainer$`; `lead_figure.asset` a relative POSIX path of one or two segments with no `..`;
   - `.describe()` text on each field (it flows into the dialects; W5 renders it into `skill.md`).
3. `contract/derive.ts`: `byline(reference)` (one author `Family (Year)`, two `Family and Family (Year)`, three or more `Family et al. (Year)`; with no `year`, the names alone) and `eyebrow(reference)` (`Research Explainer · <byline>`).
4. `contract/dialects.ts`: the three post-passes of `### What zod 4 emits, and the per-dialect pass`, plus `oneOf` to `anyOf` in the OpenAI pass, and an assertion that every OpenAI object has `additionalProperties: false` and every property in `required`.
5. `scripts/contract-build.ts`: `contract:build` writes `contract/generated/explainer-v2.schema.json` (draft 2020-12 from `ExplainerV2`, `io: 'output'`, `unrepresentable: 'throw'`), `model-output.openai.json`, `model-output.claude.json` and `model-output.gemini.json` (from the `openapi-3.0` target), each as two-space JSON with a trailing newline; with `--website` or a non-empty `WEBSITE_REPO` it also copies every `contract/*.ts` (a glob) to `$WEBSITE_REPO/src/contract/` with the first line `// generated by explainer-batch contract:build; revision 1; do not edit`. `--website` with no `WEBSITE_REPO` exits non-zero with a message naming `WEBSITE_REPO`. `contract:check` renders the same output into memory and, when `WEBSITE_REPO` is set, also compares the vendored copies; it prints `contract: generated files up to date` and exits 0, or names each drifted file and exits 1. It does not touch `skill.md`; the marker block arrives with W5.
6. `tests/unit/contract.test.ts` and `tests/unit/fixtures/v2/`: the design's W1 unit tests (the tracked v1 sample converted by hand into a v2 fixture parses; a `<span>` paragraph, a two-chart wire output and a wire output carrying `metadata` are rejected; `citation` is required only when `citationKnown` is false; a stored artefact with `provider: "unknown"`, `route: "unknown"`, `migrated_from: 1` and six sections parses; the OpenAI dialect is strict), and a call to the same check function `contract:check` uses, so `npm test` is the drift gate.
7. `package.json` and `package-lock.json`: `zod` as a direct dependency at `^4.3.6`, and the `contract:build` and `contract:check` scripts (`ts-node scripts/contract-build.ts`, with `--check` for the second).

## Constraints

- Nothing under `src/`, `skill.md` or `scripts/` other than `scripts/contract-build.ts` changes. No producer, provider or prompt reads the new files yet.
- The generated files are deterministic: a build on an up-to-date tree leaves them byte-identical.
- Add zod with `npm install --package-lock-only --offline zod@4.3.6`, which pins the copy already in `node_modules` without network; a bare `zod@^4` resolves a newer cached version and desynchronises the lock from `node_modules`.
- No network and no paid API calls. The contract test runs `contract:build --website` against a temp directory; never point `WEBSITE_REPO` at the real promo-flow checkout.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write, no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/20-one-zod-source-defines-the-v2-contract.test.ts` exits 0. It covers the exports and revision; the citation rule by `citationKnown`; wire nullables required but nullable; rejection of a `<span>`, a raw `&`, a second chart, stamped keys and markup in plain fields; the editorial bounds (two and five sections pass, one and six fail) and the takeaway rule on the wire; the chart refinements and the wire unit rule; a migrated artefact outside the editorial bounds parsing, three legacy charts parsing and four failing; the stored artefact's optional-not-nullable fields, one reference, origin, version, slug, route and asset rules; inline sanitising; the byline; the strict OpenAI dialect, the Claude, Gemini and canonical passes; `contract:check` up to date and exiting 1 naming the drifted file; `contract:build --website` vendoring every source verbatim without touching `skill.md` or the generated files, `contract:check` comparing the vendored copies, and `--website` refusing to run without `WEBSITE_REPO`; and the zod dependency, scripts and unit test. Baseline on `dev`: red, 15 of 15 fail (first: `Cannot find module '../../contract/explainer-v2'`).
2. **Contract types (verifier):** `npx tsc --noEmit --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck contract/*.ts scripts/contract-build.ts` exits 0. Baseline on `dev`: not applicable (no files).
3. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
4. **Unit suite (verifier):** `npm test` exits 0 and its output lists the tests from `tests/unit/contract.test.ts`. Baseline on `dev`: green, without that file.
5. **Drift gate (verifier):** `npm run contract:check` prints `contract: generated files up to date` and exits 0. Baseline on `dev`: missing script.
6. **Wave 1 still holds (verifier):** every `tests/contract/0*.test.ts` and `tests/contract/1[0-5]-*.test.ts` passes under the command in criterion 1. Baseline on `dev`: green.
7. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/20-one-zod-source-defines-the-v2-contract.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
8. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/20-one-zod-source-defines-the-v2-contract.test.ts`
- **Assertions digest:** `sha256:910e14aa6ca9602cd0713eb3905d7710160ff82bc4121d3c77fc25d21d460879`
- **Oracle proof:** On `dev` (`77909f6`) all 15 tests fail because `contract/explainer-v2.ts` does not exist. A throwaway reference in a detached scratch worktree (about 250 lines across `explainer-v2.ts` and `inline.ts`, a 55-line `dialects.ts`, an 11-line `derive.ts`, a 60-line `contract-build.ts`, and zod pinned with the offline command above) passed all 15; a mutation raising the wire section maximum to six turned the bounds test red; `contract:check` was clean, the strict `tsc` over `contract/*.ts` and `npx tsc --noEmit` were clean, and the reference also passed with card 21's `migrate-v1.ts` present. Traps the reference met, recorded above: zod emits `oneOf` for the discriminated union, and an online `npm install zod@^4` resolved 4.6.7 from cache. The worktree was removed and pruned.

## Out of scope

- The `skill.md` marker block and its renderer (W5), and stripping markers in `src/prompt.ts`.
- Any producer change: `saveResult`, repair, providers and `src/schema/explainer-schema.ts` stay as they are (W6).
- `migrateV1()` (card 21) and promo-flow (W3, W4).
- Canonicalisation and the save order (W6); this card provides the functions and schemas they call.
- The ordinal and share-of-whole chart checks (`src/quality.ts:71-105`): D2 moves them onto the v2 shape in W6, not here.

## Budget

- **Worker wall-clock:** 90 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** wave 1 medians in this repo's cost log: about 0.8M tokens per card, p95 2.1M. Expect above the median: a new module of five files and a design to read; the reference was about 400 lines.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 6 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls and do not set `WEBSITE_REPO` to the real promo-flow checkout.
- **Codex (verifier):** workspace-write with no network is enough; the test writes only under the OS temp dir and restores the one generated file it perturbs. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.

## Attempt 2 re-brief (2026-10-21)

Attempt 1's verifier passed criteria 1 to 7 and failed only criterion 8, because the card asked `git status --porcelain` to print nothing while the dispatch leaves the worker's output uncommitted. That was a card defect, not a worker one; criterion 8 now reads as the other wave-2 cards do. The attempt-1 tree is preserved: confirm criteria 1 to 7 still hold on it, change nothing that does not need changing, and return.
