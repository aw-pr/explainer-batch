# Stage card 46-the-finalise-seam-saves-v2: the finalise seam turns a wire receipt into a stored ExplainerV2, in the design's save order

## Metadata

- **Authored:** 2026-10-22
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/46-the-finalise-seam-saves-v2
- **Worker effort:** high
- **Verifier effort:** medium
- **Verifier panel:** false
- **Depends on:** 45-the-skill-schema-block-is-generated-from-the-contract
- **Path claims:** src/finalize.ts, src/quality.ts, src/style-lint.ts, src/output.ts, tests/unit/finalize.test.ts, tests/unit/fixtures/v2/
- **Pairing rationale:** The seam every route will share, rewritten to the design's save order. The card fixes the order, the stamps, the slug rule and the classification of surviving issues, and two frozen tests pin them, so GPT-6.1 Sol at high fits, and the operator asked on 2026-10-22 to bias token spend towards OpenAI. The verifier is Claude Opus 5.5 at medium from the other family; judging that no stamp can overwrite a model value and no repair can touch a chart is judgement work, so Opus rather than Sonnet. Neither role needs Fable or Astra.
- **Open decisions:** none

## Surfacing concern

Design 16 (`docs/design/content-contract-v2.md`), wave-2 card W6, split into three by the operator's decision of 2026-10-22: W6a (this card) the v2 text finalisation in the seam; W6b the cutover of every route onto it, structured detection, the citation-aware user turn, the generated dialects and the deletion of the v1 schema; W6c the figure sidecar and `lead_figure`. The four cards W5, W6a, W6b and W6c land back to back with **no explainer-batch production run** from W5 landing until W6c lands.

**Why this boundary.** Production does not use `src/finalize.ts` yet: `src/batch.ts` saves through its own `finalizeResult` (`src/batch.ts:246`) and `saveResult` (`src/output.ts:576`). This card converts the seam only and leaves the live v1 path (`saveResult`, `repairUntilValid`, `validateJsonOutput`, `buildRepairInstruction`, `normalizeSchemaDrift`) untouched, so frozen contracts 01, 03, 04, 05, 06, 09, 14 and 15, which pin the v1 path, pass unedited. W6b moves the six completion sites onto this seam and re-freezes them.

Settled by the orchestrator, from the design (`### Save order`, Q5, Q6, Q7, the `metadata` table under `## Schema v2`):

- **Order:** parse; canonicalise keeping nulls; validate with `modelOutputValidator({citationKnown})`; repair; resolve surviving issues; stamp; strip nulls; assert `ExplainerV2`; persist. No stamp reads or overwrites a wire field.
- **The citation.** `citationKnown` is true exactly when the context carries a detected reference. Then canonicalisation sets any non-null `citation` to `null` before validation and lists it in `quality.dropped`, so a malformed citation the harness discards never costs a repair, and `references[0]` is the detected one with `origin: "detected"`. Otherwise the validator requires `citation`, repair may ask for it, and `references[0]` is a copy with `origin: "model"`.
- **Charts never reach repair** (card 38's rule, kept): the repair payload carries `charts: []`, a reply's charts are discarded and the originals restored, and chart issues are not sent. After repair a chart that still fails a check is **removed** and listed in `quality.dropped` (design Q6), which changes card 38's "a chart-only issue goes to review". A thin chart (fewer than `MIN_CHART_POINTS` values in every series, default 6) is removed the same way.
- **Surviving issues after repair**, in order: an issue under `charts[i]` removes that chart; one under `hero.emphasis` sets it to `null`; one under `figure_request` sets it to `null`; each such removal is listed in `quality.dropped`. Every other issue is editorial when the stamped, stripped object parses as `ExplainerV2` (an editorial bound such as six sections or a long subtitle, a style issue, a pills top block with no `end_takeaway`): it is kept in `quality.issues` and the item is saved for review. Otherwise it is structural on a required field (no sections, say): nothing is saved and the outcome is `errored` with code `INVALID_ARTICLE`.
- **Metadata from the receipt and the context.** `model` and `provider` come from the synthesis receipt; `route` is `batch` when the receipt's route is `batch-api`, else `sync`. `date_created`, `source` and `publication_date` come from the context. `contract_revision` is `CONTRACT_REVISION`.
- **The slug** is `<date>_<family>_<title>_explainer`: `family` is `references[0].authors[0].family` and `title` is `hero.title`, each slugified (NFKD, combining marks removed, lowercase, every run of characters outside `a-z0-9` replaced by one `-`, leading and trailing `-` trimmed) and cut at a `-` boundary to at most 20 characters for `family` and at most 40 for `title`; an empty result becomes `paper`. It is not in `contract/derive.ts`, which cards 43 and 44 pin by hash.
- **No figure in this card.** The seam drops its `figure` hook and writes no `image` and no `lead_figure`; W6c adds `lead_figure` with the sidecar. `figure_request` is kept in the artefact.

## Objective

`finalizeResult` in `src/finalize.ts` takes a model receipt in the v2 wire shape and saves an `ExplainerV2` that parses, with stamped `metadata`, `references[0]` and its `origin`, a `quality {issues, dropped}` record, nulls stripped only after stamping, and charts that repair never saw.

## Inputs (read these in your own context)

- `src/finalize.ts` (all), `src/output.ts` (`persistArtefact`, `deriveFilename`, the `MIN_CHART_POINTS` block, `extractJson`), `src/quality.ts` (`isChartIssue`, the chart data checks), `src/style-lint.ts` (`lintStyle`, `collectProseFields`, `numberIssues`)
- `contract/explainer-v2.ts` (read only), `contract/inline.ts` (`sanitiseInline`, `toPlain`, read only)
- `docs/design/content-contract-v2.md`: `### Save order`, the `metadata` and `references[]` rows under `## Schema v2`, Q5 to Q7
- `tests/unit/finalize.test.ts`, `tests/unit/fixtures/v2/alenezi-agentic-ai-architecture.model-output.json`
- `tests/contract/38-one-finalise-and-repair-seam.test.ts` (re-frozen for this card) and `tests/contract/46-the-finalise-seam-saves-v2.test.ts` (frozen), and this card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

Every file listed here must be created or modified, except the frozen contract tests, which already exist and must not be edited. Paths are relative to the repo root.

1. `src/finalize.ts`:
   - `FinalizeContext` becomes `{ stamp: StampContext; checkpoints; repair?; persist? }`, where `StampContext` is `{ expectedDate: string; detectedReference?: <the wire citation shape, non-null>; publishedOn?: string /* YYYY-MM or YYYY-MM-DD */; source?: { kind: 'pdf' | 'url'; ref: string } }`. The `provenance` and `figure` fields are removed.
   - Export `canonicaliseWire(raw: unknown, ctx: { citationKnown: boolean }): { wire: unknown; dropped: string[] }`: `sanitiseInline` on every `InlineText` field, `toPlain` on every `PlainText` field and table cell, unknown keys dropped at any depth, `citation` set to `null` when `citationKnown` and it was non-null; nulls kept; each change listed in `dropped` as a short message naming the path.
   - Export `wireIssues(wire: unknown, ctx: { citationKnown: boolean }): string[]`: the `modelOutputValidator(ctx)` issues as `<path>: <message>`, plus `chartIssues()` for each chart, plus `lintStyle()` issues prefixed `style (<check>) at <path>:`.
   - Export `stampArtefact(wire, receipt, stamp, quality): ExplainerV2`: composes the stored object (stamps per Surfacing concern, then nulls stripped from object properties at every depth, array elements kept) and returns `ExplainerV2.parse` of it. A parse failure here throws: it is a harness bug, never a repair trigger.
   - Export `slugFor(date: string, family: string, title: string): string` per the slug rule.
   - `finalizeResult` follows the order above. The repair instruction is built from the issues that are not chart issues and says only what the model can fix. Neither it nor `buildWireRepairInstruction` contains the words `date_created`, `slug`, `metadata`, `publication_date` or `references` anywhere (the frozen tests ban the words, case-insensitively); an issue message that would carry one must be reworded. The payload is the canonical wire object with `charts: []`. A reply re-enters at canonicalise; a candidate replaces the best only when it has fewer issues. `MAX_REPAIR_ATTEMPTS` bounds the loop. Checkpoints keep the `:repair` and `:final` stages with the same replay guarantees as today; the `:figure` stage goes.
   - The outcome's `article` is the `ExplainerV2`; `status` is `succeeded` when `quality.issues` is empty, else `needs_review` (saved under `output/review/`, not staged or mirrored, as today); `errored` adds the code `INVALID_ARTICLE`. `artefactDigest` and `chartDigest` keep their meaning (`chartDigest` over `charts`).
   - Imports nothing from `./types/explainer-json`, `./providers`, `./batch`, `./vision`, `./figure-vlm`, `./figure-data` or `./index`, and the names `saveResult`, `attachFigureImage`, `normalizeSchemaDrift` and `stampProvenanceByline` do not appear in the file at all, not even in an import or a comment.
2. `src/quality.ts`: export `chartIssues(chart: Chart, index: number): string[]` over the neutral chart (ordinal sequence, share-of-whole, uniform values, a single point), with messages starting `charts[<i>]`, and `buildWireRepairInstruction(issues: string[], ctx: { citationKnown: boolean }): string`. Everything existing stays exported and behaves as today.
3. `src/style-lint.ts`: `lintStyle` also reads a v2 object (pill `lead` and `text`, list `intro` and item `body`, table `caption` and cells, chart `title` and `caption`, takeaway `body`). Its output for every v1 object is byte-identical to today's (contract 15 pins it).
4. `src/output.ts`: `persistArtefact` takes an `ExplainerV2` and names the file `<metadata.slug>.json`. Export `MIN_CHART_POINTS` (its declaring block stays byte-identical; contract 02 pins it). Nothing else in this file changes.
5. `tests/unit/finalize.test.ts`: rewritten for the v2 seam with v2 fixtures, keeping the replay, interruption, malformed-receipt and copy-failure cases.
6. `tests/unit/fixtures/v2/`: add any wire fixtures the unit tests need. The two existing fixtures do not change.

## Constraints

- `saveResult`, `repairUntilValid`, `validateJsonOutput`, `buildRepairInstruction`, `normalizeSchemaDrift`, `canonicaliseExplainerJson`, `isChartIssue` and every v1 behaviour they implement are unchanged. `src/batch.ts`, `src/repair.ts`, `src/prompt.ts`, `src/providers.ts` and `src/schema/` are unchanged.
- `contract/` and `skill.md` are unchanged; `WEBSITE_REPO= npm run contract:check` stays clean.
- Every frozen contract passes unedited: 01 to 15 and 20 to 45 as they stand, and 38 and 46 as re-frozen for this card. Contracts 26 to 28 need held PDFs a run worktree lacks, so criterion 2 leaves them out; nothing this card changes is read by them. The `MIN_CHART_POINTS` block in `src/output.ts` stays byte-identical.
- No network and no paid API calls. British English and no em dashes in prose and messages.
- Do not create or modify files outside the deliverables, except this card's run state. What the frozen tests do themselves (scratch files under the system temporary directory, card 20's `contract:build` into one) is not a breach.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: the Claude Opus 5.5 verifier through the Claude CLI, no network needed.

Baseline on `dev` at `0fc0996` (2026-10-22): 1 red (this test 15 of 15; re-frozen 38 8 of 12); 2 red at 38 and 46, and at 45 because W5 has not landed (this card depends on it); 3, 4 and 5 green. Run the frozen suite with `--test-concurrency=1`: contract 45 rewrites `skill.md` for a moment and contract 20 corrupts and restores a generated file.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/46-the-finalise-seam-saves-v2.test.ts tests/contract/38-one-finalise-and-repair-seam.test.ts` exits 0.
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 $(ls tests/contract/*.test.ts | grep -v -e '/26-' -e '/27-' -e '/28-')` exits 0. Contracts 26 to 28 read held PDFs under `input/_held/`, which a run worktree does not have; this card touches nothing they test. Contracts 39 and 42 find held PDFs through the sibling `../explainer-batch` checkout.
3. **Types (verifier):** `npx tsc --noEmit` exits 0.
4. **Unit suite (verifier):** `npm test` exits 0.
5. **Drift gate (verifier):** `WEBSITE_REPO= npm run contract:check` prints `contract: generated files up to date`.
6. **The order holds (verifier, judgement):** read `finalizeResult`. No stamp is applied before validation or repair; nulls are stripped only after stamping; the repair payload and instruction carry no chart data and no stamped field; a repaired reply's charts never reach the artefact. Name any step out of order.
7. **Frozen blocks intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/46-the-finalise-seam-saves-v2.test.ts` and the same for `tests/contract/38-one-finalise-and-repair-seam.test.ts` print the digests recorded below, and `git diff dev -- tests/contract` is empty.
8. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state. A `node_modules` clone is gitignored and does not appear.

## Contract test

- **Test file:** `tests/contract/46-the-finalise-seam-saves-v2.test.ts`
- **Assertions digest:** `sha256:8b1d72834c53c7349997b83c281a711e53ad30db05b1098fb680c7a77ed249a0`
- **Oracle proof:**
  - **Drafted** by a read-only GPT-6.1 Sol session from this card, with the re-freeze of contract 38; reviewed by the orchestrator, who removed a test pinning the v1 bridges' existence (W6b deletes them; the frozen v1 contracts guard them until then) and renamed the re-frozen 38's messages from `46:` to `38:`.
  - **Red on `dev` `0fc0996`:** this test 15 of 15 fail (`canonicaliseWire`, `slugFor`, `buildWireRepairInstruction` and the stamped shape do not exist). Re-frozen 38: 8 of 12 fail; the 4 it keeps unchanged pass (exports and classifier, no hidden calls, truncated synthesis, malformed receipt).
  - **Green on a throwaway reference** written by a GPT-6.1 Sol session in a detached worktree at `~/repos/eb-ref46` (removed and pruned; nothing committed): this test 15 of 15, re-frozen 38 12 of 12, `tsc --noEmit` clean, `contract:check` clean, and the frozen suite with `--test-concurrency=1` green except contract 45 and contract 42's marker test (the reference started from `dev` without W5, which this card depends on) and contract 01's `npm test` check (the reference did not rewrite `tests/unit/finalize.test.ts`, deliverable 5). Contracts 02, 04, 06, 09 and 15, which pin the v1 path, passed unedited. The reference was about 380 changed lines across `src/finalize.ts`, `src/quality.ts`, `src/style-lint.ts` and `src/output.ts`.
  - **Traps the reference met:** zod keeps an explicitly present `undefined` property, which JSON then drops, so a saved file and a replayed checkpoint stop comparing equal (strip `undefined` with the nulls); the receipts array needs the explicit `NormalizedResult[]` type to hold a failed repair receipt; a JSON round-trip copy throws on `undefined`, so copy charts with a helper that tolerates it.
- **Re-freeze in the same commit:** `tests/contract/38-one-finalise-and-repair-seam.test.ts`, converted to the v2 seam context and wire fixtures: the export and classifier test, the no-hidden-calls test, the truncated synthesis and the malformed receipt are unchanged; a failing chart is now removed and the item succeeds; a wire output with no `metadata` key is valid; the figure test and every figure callback are gone (W6c owns `lead_figure`). Card 38's recorded digest is updated to `sha256:916dd6d1be2e40242010f8981a583483d083558d534214a99ba75f55f7d9e667`.

## Out of scope

- `src/batch.ts`, `saveResult` and the six completion sites, structured detection, the user turn, the provider dialects and deleting `src/schema/explainer-schema.ts`: W6b.
- `lead_figure`, the sidecar file and `recreated_figure`: W6c.
- Any change to `contract/`.

## Budget

- **Worker wall-clock:** 75 minutes
- **Verifier wall-clock:** 35 minutes
- **Spend basis:** card 38, the same seam and its frozen test: about 3M tokens for the stage. Expect similar.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The `git diff` of `src/finalize.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to a frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls and write nothing outside the worktree beyond what the frozen tests themselves write under the system temporary directory.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family from the verifier) read this card and both frozen tests on 2026-10-22. It had no questions. Folded in: the constraint now says why contracts 26 to 28 are outside criterion 2; the source ban names all four legacy helpers and covers imports and comments; the repair instruction's word ban is stated as the tests enforce it.
