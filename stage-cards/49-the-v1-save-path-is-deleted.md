# Stage card 49-the-v1-save-path-is-deleted: the v1 save, repair and validation path, the hand-written v1 schema and the v1 detected fields are deleted

## Metadata

- **Authored:** 2026-10-22
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/49-the-v1-save-path-is-deleted
- **Worker effort:** high
- **Verifier effort:** medium
- **Verifier panel:** false
- **Gate:** stage-completed: 48-every-route-saves-through-the-v2-seam
- **Path claims:** src/output.ts, src/quality.ts, src/repair.ts, src/style-lint.ts, src/preprocess.ts, src/state.ts, src/batch.ts, src/finalize.ts, src/schema/explainer-schema.ts, tests/unit/, CLAUDE.md, AGENTS.md, README.md
- **Pairing rationale:** A deletion card: every symbol it removes is named below and has no caller once card 48 lands, and re-frozen contracts pin what replaces each guarantee. GPT-6.1 Sol at high fits, and the operator asked on 2026-10-22 to bias token spend towards OpenAI. The verifier is Claude Sonnet 5.5 at medium from the other family: verifying is running the commands and checking that nothing named survives. Neither role needs Fable or Astra.
- **Open decisions:** none

## Surfacing concern

Design 16 W6, the last of the W6b split: card 47 changed the requests, card 48 moved every save onto the seam, and this card deletes what card 48 left unused. It changes no behaviour a route can see. The production pause holds until W6c (card 50) lands.

Settled by the orchestrator:

- **Deleted:** `src/schema/explainer-schema.ts`; in `src/output.ts`, `saveResult`, `SaveResult`, `RunProvenance`, `normalizeSchemaDrift`, `canonicaliseExplainerJson`, `normalizeExplainerJson`, `parseStringifiedConfigJson`, `normalizeChartEntry`, `stripSchemaNulls`, `deriveFilename`, `stampProvenanceByline` and its helpers (`PLACEHOLDER_AUTHOR_RE`, `slugifySurname`, `stampSlugAuthor`, `escapeRegExp`, `firstYear`), and the legacy `chart` write; in `src/repair.ts`, `repairUntilValid` and `RepairResult` (`MAX_REPAIR_ATTEMPTS` stays); in `src/quality.ts`, `validateJsonOutput`, `buildRepairInstruction`, `isChartIssue` and the v1-only helpers, and its import of `src/types/explainer-json.ts`; in `src/preprocess.ts`, `buildReference`, `formatCitationDate` and the `detectedSurname`, `detectedPublished` and `detectedReference` fields; the same three fields on `RequestState` and wherever `src/batch.ts` persists them; `lintStyle`'s v1 field paths (it reads v2 only).
- **Kept:** `extractJson`, `persistArtefact`, `saveRawOutput`, `chartIssues`, `buildWireRepairInstruction`, `MAX_REPAIR_ATTEMPTS`; `attachFigureImage` and the figure helpers in `src/output.ts`, which card 50 moves onto the seam (so `src/output.ts` may still import `src/types/explainer-json.ts` for them; W8 deletes that file); the `Detected paper author(s):` lines prepended to fetched text.
- **The `MIN_CHART_POINTS` source shape** that frozen contract 02 pins stays in `src/output.ts`: the `const MIN_CHART_POINTS = (() => {` block with its default of 6, and an `if (len < MIN_CHART_POINTS)` test, now inside an exported v2 helper `dropThinCharts(charts: Chart[]): { kept: Chart[]; dropped: string[] }` that `src/finalize.ts` calls for the thin-chart rule (replacing whatever card 46 wrote for it).
- **Re-frozen contracts:** 01, 03, 04, 09, 15 and 38 test the deleted functions directly or through v1 fixtures. Each is re-frozen by the orchestrator to the v2 equivalent of its guarantee before this card dispatches; the `## Contract test` section lists what each now asserts.

## Objective

No v1 save, repair or validation code remains: the seam is the only way a result becomes a stored artefact, the provider dialects are the only schemas, and the detected citation is the only detected reference.

## Inputs (read these in your own context)

- `src/output.ts`, `src/quality.ts`, `src/repair.ts`, `src/style-lint.ts`, `src/schema/explainer-schema.ts`
- `src/preprocess.ts` (the detected fields), `src/state.ts` (`RequestState`), `src/batch.ts` (where the request records the detected fields), `src/finalize.ts` (its thin-chart rule)
- `CLAUDE.md` (`Output post-processing`, the module map), `AGENTS.md`, `README.md`: the sentences that describe `saveResult`, `normalizeSchemaDrift` or the hand-written schema
- The re-frozen contracts 01, 03, 04, 09, 15 and 38, and `tests/contract/49-the-v1-save-path-is-deleted.test.ts` (frozen), and this card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

Every file listed here must be created or modified, except the frozen contract tests, which already exist and must not be edited. Paths are relative to the repo root.

1. `src/schema/explainer-schema.ts`: deleted.
2. `src/output.ts`, `src/quality.ts`, `src/repair.ts`, `src/style-lint.ts`, `src/preprocess.ts`, `src/state.ts`, `src/batch.ts`: the deletions above; `dropThinCharts` exported from `src/output.ts`.
3. `src/finalize.ts`: its thin-chart rule calls `dropThinCharts`; nothing else changes.
4. `tests/unit/`: unit tests and fixtures that exercised a deleted function are removed or rewritten against the seam; the five v1 fixtures (`metadata-less.json`, `ordinal-sequence.json`, `stacked-log.json`, `stringified-config-json.json`, `uniform-values.json`) are rewritten as v2 wire fixtures or deleted when nothing reads them.
5. `CLAUDE.md`, `AGENTS.md`, `README.md`: every sentence describing `saveResult`, `normalizeSchemaDrift`, `finalizeResult` in `src/batch.ts`, `src/schema/` or the hand-written schema now describes the seam (`src/finalize.ts`) and the generated dialects (`contract/generated/`, `src/wire-schema.ts`); the module map lists `src/finalize.ts` and `src/wire-schema.ts` and drops `src/schema/`.

## Constraints

- No behaviour a route can see changes: the frozen contracts 05, 06, 46, 47 and 48 pass unedited.
- `contract/`, `skill.md`, `src/prompt.ts`, `src/providers.ts`, `src/figure-vlm.ts`, `src/figure-data.ts` and `src/types/explainer-json.ts` are unchanged.
- No network and no paid API calls. British English and no em dashes.
- Do not create or modify files outside the deliverables, except this card's run state. What the frozen tests do themselves is not a breach.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: the Claude Sonnet 5.5 verifier through the Claude CLI, no network needed.

Baseline: recorded under `## Contract test`.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 tests/contract/49-the-v1-save-path-is-deleted.test.ts tests/contract/01-*.test.ts tests/contract/03-*.test.ts tests/contract/04-*.test.ts tests/contract/09-*.test.ts tests/contract/15-*.test.ts tests/contract/38-*.test.ts` exits 0.
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 $(ls tests/contract/*.test.ts | grep -v -e '/26-' -e '/27-' -e '/28-')` exits 0. Contracts 26 to 28 read held PDFs under `input/_held/`, which a run worktree does not have; contracts 39 and 42 find them through the sibling `../explainer-batch` checkout.
3. **Types (verifier):** `npx tsc --noEmit` exits 0.
4. **Unit suite (verifier):** `npm test` exits 0.
5. **Nothing named survives (verifier):** `grep -rnE '\b(saveResult|repairUntilValid|validateJsonOutput|normalizeSchemaDrift|canonicaliseExplainerJson|stampProvenanceByline|EXPLAINER_JSON_SCHEMA|detectedReference|detectedSurname|detectedPublished)\b' src scripts` prints nothing, and `test -e src/schema/explainer-schema.ts` fails.
6. **Frozen blocks intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print` for this card's test and each re-frozen contract prints the digest recorded on its card, and `git diff dev -- tests/contract` is empty.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state.

## Contract test

- **Test file:** `tests/contract/49-the-v1-save-path-is-deleted.test.ts`
- **Assertions digest:** `PENDING`
- **Oracle proof:** PENDING

## Out of scope

- `attachFigureImage`, `lead_figure`, the sidecar and `recreated_figure`: card 50.
- `src/types/explainer-json.ts`, `src/figure-vlm.ts`, `src/figure-data.ts`, `scripts/reextract-figure.ts`: W7 and W8.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** a deletion card with doc edits; card 47's request plumbing as the nearest: about 2M tokens for the stage.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- `git diff --stat`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to a frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls and write nothing outside the worktree beyond what the frozen tests themselves write under the system temporary directory.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** PENDING
