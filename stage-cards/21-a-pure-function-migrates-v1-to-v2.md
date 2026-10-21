# Stage card 21-a-pure-function-migrates-v1-to-v2: a pure function migrates any v1 explainer to a v2 artefact or a typed failure

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/21-a-pure-function-migrates-v1-to-v2
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Gate:** stage-completed: 20-one-zod-source-defines-the-v2-contract
- **Path claims:** contract/migrate-v1.ts, tests/unit/migrate-v1.test.ts, tests/unit/fixtures/v1/
- **Pairing rationale:** One pure mapping function over a fully specified table, with the schema it targets already landed by card 20: mechanical enough for GPT-6.1 Sol at medium effort, and an OpenAI worker after card 20's Claude worker alternates the families. The verifier is Claude Sonnet 5.5 from the other family at high effort, because checking the mapping row by row against the design is careful reading, not frontier judgement.
- **Open decisions:** none

## Surfacing concern

Design stage 16 (`docs/design/content-contract-v2.md`, landed at `447c19d`) card W2. promo-flow's reader (W3) and explainer-batch's archive rewriter (W9) both need one function that turns any v1 file into an `ExplainerV2`, so the 49 live explainers and the local archives can be read through the v2 contract before any is rewritten on disk. The mapping is `### The mapping (migrateV1())`; this card turns it into code with no I/O, so both repos can vendor it.

Checked against `dev` at `77909f6`: the v1 shape is `src/types/explainer-json.ts:17-284`; the one tracked v1 sample is `output/2026-04-16_alenezi_agentic-ai-architecture_explainer.json`, whose image is a base64 JPEG, whose headline carries one `<span>` and whose reference is one APA string with an anchor.

Cold read 2026-10-21 by the other family (codex exec, read-only, model gpt-6.1-sol): it asked about a version-less file, more than three charts, a listed image with no bytes, and the fixture directory, and found the purity and long-subtitle assertions too weak; each is answered in Deliverables or fixed in the test.

Operator decisions applied, each the design's recommendation: Q11 drops estimated recreations; Q12 keeps up to three charts (card 20 caps the artefact at three); Q13 drops code-only and banned-type charts and lists them; Q14 drops `diagrams` and lists it. The design leaves four details open, settled here: the `io` parameter's shape, the base64 sidecar name, the fallback author for a reference the APA pattern cannot parse, and the default axis labels.

## Objective

`contract/migrate-v1.ts` exports `migrateV1(raw, io)`, a pure function that maps any v1 explainer to `{ok: true, explainer, assets}`, whose `explainer` parses as `ExplainerV2` with `migrated_from: 1`, or to `{ok: false, reason}` when the file fails a structural bound, applying every row of the design's mapping table.

## Inputs (read these in your own context)

- `docs/design/content-contract-v2.md`: `### The mapping (migrateV1())`, `## Schema v2`, Q11 to Q14, and W2 under `## Wave-2 cards`
- The contract module card 20 creates, contract/explainer-v2.ts and contract/inline.ts (they do not exist on `dev` until card 20 lands)
- `src/types/explainer-json.ts` (the v1 shape)
- `output/2026-04-16_alenezi_agentic-ai-architecture_explainer.json` (the tracked v1 sample)
- `tests/contract/21-a-pure-function-migrates-v1-to-v2.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `contract/migrate-v1.ts` exporting:
   ```ts
   export type MigrateIo = { listing: readonly string[]; bytes: (relPath: string) => Uint8Array | undefined };
   export type MigrateAsset = { path: string; bytes: Uint8Array };
   export type MigrateResult =
     | { ok: true; explainer: ExplainerV2; assets: MigrateAsset[] }
     | { ok: false; reason: string };
   export function migrateV1(raw: unknown, io: MigrateIo): MigrateResult;
   ```
   `io.listing` and `io.bytes` work in paths relative to the artefact's own directory; the caller does the I/O. The function applies the mapping table, with these details:
   - **metadata:** `slug` and `date_created` unchanged; `model` the v1 value or `unknown`; `provider` `openai` for `gpt-`, `claude` for `claude-`, else `unknown`; `route` the v1 `run_mode` or `unknown` (never assumed `sync`); no `source`; `contract_revision` from `CONTRACT_REVISION`; `migrated_from: 1`; `quality.issues` starts from any v1 `metadata.quality.issues`.
   - **hero:** `title` is `metadata.title` without its final `: Surname (Year)`; `emphasis` the plain text of the first `<span>` in `headline_html` when it is a substring of `headline`; `publication_date` `YYYY-MM` from "Published Month Year", omitted otherwise.
   - **text:** every `InlineText` field passes through `sanitiseInline` (from the `_html` twin when present) and every `PlainText` field through `toPlain`, so the result is canonical.
   - **tables:** a caption ending in `(Table 2, p. 6)` becomes `source {ref, page}` and leaves the caption; `align` is dropped.
   - **charts:** Chart.js `bar`, `line` and `scatter` convert per the table, every series with `source.kind: legacy` and `ref` from the caption's tag when present, else `v1 charts[i]`; an absent axis title becomes `Category` (x) or `Value` (y); a converted chart that does not parse as a v2 chart is dropped and listed; past three converted charts, the first three are kept and the rest listed; the legacy `chart` converts only when `charts` is empty, and a differing duplicate is listed when dropped.
   - **recreated_figure:** appended to `charts` (dropped and listed if it would exceed three); `grouped_bar` becomes `bar`; `supplied` data gives kind `supplied`, an `exact` series citing a table gives `table` with that table as `ref`, otherwise `text`; `figure_estimated` is dropped and listed.
   - **image:** a site-absolute `/explainer-html/<folder>/media/<file>` resolves to `media/<file>` when `io.listing` has it; a base64 data URL becomes the asset `<slug>/figure-<n>.<ext>` (n from the label's number, else `<slug>/figure.<ext>`) returned in `assets` with its decoded bytes; `sha256` from the bytes; `width` and `height` read from PNG and JPEG headers, absent for SVG; `provenance: legacy`. An image whose file is not in the listing, or whose bytes `io.bytes` cannot return, is dropped and listed; a raster file whose header gives no size is kept without `width` and `height`, with a `quality.issues` entry.
   - **references:** the first entry becomes the one reference with `origin: legacy`, parsed from the APA pattern `Authors (Year). Title. Venue...` with the first `http(s)` anchor as `url`; when the pattern fails, `title` is the plain text, the single author is the slug's author segment capitalised, and `quality.issues` records the partial parse. Each extra entry is dropped and listed.
   - **drops and issues:** `diagrams` and any other undeclared top-level key are dropped and listed; values outside an editorial bound (sections outside 2 to 5, a subtitle over 320 characters, pills with no `end_takeaway`) are kept with a `quality.issues` entry naming the field.
   - **version:** `version: 1` or no `version` at all is read as v1 (design Q8); any other value is a failure.
   - **failure:** a non-object or non-v1 input, no sections, or no reference returns `{ok: false, reason}` with a non-empty reason, as does a result that fails `ExplainerV2.safeParse`.
2. `tests/unit/migrate-v1.test.ts` and `tests/unit/fixtures/v1/`: the design's W2 unit tests, over the tracked sample and one fixture per mapping row listed in W2's outcome.

## Constraints

- Pure: no `fs` import, no dynamic import, no `fetch`, no clock (`Date.now`, `new Date`), no `Math.random`; `node:crypto` for the hash is allowed. The input object is not mutated. The test checks the module source with comments stripped.
- `contract/explainer-v2.ts`, `contract/inline.ts` and the generated files are card 20's and stay unchanged; `npm run contract:check` stays clean.
- No caller yet: nothing under `src/` or `scripts/` changes, and no file under `output/` is rewritten (W9 does that).
- No network and no paid API calls.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Sonnet 5.5 verifier through the Claude CLI; no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/21-a-pure-function-migrates-v1-to-v2.test.ts` exits 0. It covers the tracked sample (metadata, hero, pills, paragraphs, the structured reference, the base64 image as a sidecar asset with hash and size), the field mapping (emphasis, publication date, entity-decoded pills, `_html` twins, list and table fields, the caption tag), model, provider and route, a convertible chart with its duplicate, a stacked bar and a legacy-only chart, code-only and banned-type drops, the media image (JPEG size, SVG without size, a missing file), the base64 PNG asset, `recreated_figure` by provenance and the estimated drop, extra references, `diagrams` and an undeclared key, multi-author and unparseable references, the editorial-bound issues with the values kept, a version-less file read as v1, the three-chart cap, an unreadable listed image, the typed failures, and purity (no fs, dynamic import, fetch, clock or randomness in the source; the input not mutated; the unit test and its fixture directory present). Baseline on `dev`: red, 16 of 16 fail (first: `Cannot find module '../../contract/migrate-v1'`). Baseline once card 20 has landed: red, 16 of 16 for the same reason.
2. **Card 20 still holds (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/20-one-zod-source-defines-the-v2-contract.test.ts` exits 0 (its `--website` test now also vendors `migrate-v1.ts`). Baseline: green once card 20 has landed.
3. **Contract types (verifier):** `npx tsc --noEmit --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck contract/*.ts scripts/contract-build.ts` exits 0, and `npx tsc --noEmit` exits 0. Baseline: green once card 20 has landed.
4. **Unit suite (verifier):** `npm test` exits 0 and its output lists the tests from `tests/unit/migrate-v1.test.ts`. Baseline: green once card 20 has landed, without that file.
5. **Drift gate (verifier):** `npm run contract:check` prints `contract: generated files up to date`. Baseline: green once card 20 has landed.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/21-a-pure-function-migrates-v1-to-v2.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/21-a-pure-function-migrates-v1-to-v2.test.ts`
- **Assertions digest:** `sha256:8e61c8e31c0223afeb2d0f975e440790793040c2b9568dbc2e6a3c82688b6748`
- **Oracle proof:** On `dev` (`77909f6`) all 16 tests fail because `contract/migrate-v1.ts` does not exist; they fail the same way on top of card 20's reference alone. A throwaway reference in a detached scratch worktree, stacked on card 20's reference (one 220-line `migrate-v1.ts` with a PNG and JPEG header reader), passed all 16, card 20's test still passed with `migrate-v1.ts` vendored, `contract:check` stayed clean and the strict `tsc` over `contract/*.ts` was clean. The contract test builds its own fixtures (v1 documents, a generated 3 by 2 PNG and a minimal JPEG header); the worker's unit tests still keep theirs as files under `tests/unit/fixtures/v1/` (deliverable 2). The worktree was removed and pruned.

## Out of scope

- Any caller: promo-flow's `parseExplainerJson()` (W3) and the archive rewriter `scripts/migrate-v1-to-v2.ts` (W9), including writing the returned assets to disk.
- Parsing `config_raw` code (Q13's third option) and a diagram block (Q14).
- Re-baking HTML or touching promo-flow.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** wave 1 medians in this repo's cost log: about 0.8M tokens per card, p95 2.1M. Expect near the median: one module and its unit tests over a fully specified table; the reference was about 220 lines.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The `migrateV1` signature as written, and the complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the tests write nothing outside the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
