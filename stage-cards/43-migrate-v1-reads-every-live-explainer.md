# Stage card 43-migrate-v1-reads-every-live-explainer: migrateV1 reads the two takeaway drift shapes and blank table cells, so every live explainer migrates

## Metadata

- **Authored:** 2026-10-22
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/43-migrate-v1-reads-every-live-explainer
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Path claims:** contract/explainer-v2.ts, contract/migrate-v1.ts, contract/generated/, tests/unit/migrate-v1.test.ts, tests/unit/fixtures/v1/, tests/unit/contract.test.ts, docs/design/content-contract-v2.md
- **Pairing rationale:** Two small, fully specified edits to landed code (one schema refinement, one mapping helper) plus three fixtures, pinned to the sentence by a frozen test: Claude Sonnet 5.5 at medium fits, and a Claude worker after card 42's Codex worker alternates the families. The verifier is GPT-6.1 Sol at medium from the other family: verifying is running the commands and reading a 25-line diff, nothing judgement-heavy, so neither role needs Fable or Astra.
- **Open decisions:** none

## Surfacing concern

Found while carding design 16 W3 (promo-flow reads the shared contract), on 2026-10-22. Card 21's `migrateV1` runs over promo-flow's 49 live explainers (`promo-flow/public/explainer-html/**/*_explainer.json`), and on `dev` at `7ebc500` it fails on 3 of them. W3's outcome (`49 artefacts parsed (49 via migrateV1, 0 native v2)`) is therefore red on its base for a reason that lies in this repo, not in promo-flow. The three failures:

- `ai-architecture/2026-05-17_liu_claude-code-architecture_explainer.json`: `end_takeaway` is `{headline, body, body_html}`. There is no `label`, so `end_takeaway.label` comes out empty and fails `PlainText`.
- `ai-strategy/2026-05-11_mertens_rising-tides_explainer.json`: `end_takeaway` is `{label, paragraphs_html: [...]}`. There is no `body`, so `end_takeaway.body` comes out empty.
- `ai-adoption/2026-07-16_acharya_maturity-model_explainer.json`: a table with 14 blank cells (values the paper did not report at that level). `rows` is `PlainText`, which has `min(1)`.

Across every corpus (the 49 live files, the 11 staged in `promo-flow/explainers-new/`, and this repo's `output/` and `output.local/`), the takeaway shapes are: 84 `{label, body}`, 4 `{label, body, body_html}`, 1 `{label, body, kind}`, 2 `{headline, body, body_html}` and 2 `{label, paragraphs_html}`; top-block takeaways are all `{label, body}`. The acharya table is the only one with blank cells. The 11 staged files and the 19 in `output/` already migrate. The 24 failures in `output.local/` are 18 empty-pills archives, 2 with no sections, 1 with no reference and 1 with an invalid slug, which are W9's curation and out of scope here, plus the same two takeaway shapes, which this card fixes.

Operator decisions, 2026-10-22:

- Fix this as its own explainer-batch card, landed before W3, so that W3 vendors the corrected `migrate-v1.ts` unedited (the vendored copy is generated and must not be hand-edited).
- **Blank cells are allowed in the contract**, rendered blank, rather than migrated to a placeholder: a dash would put a mark into the data that the paper never printed. Only table cells change. Column headings and every other `PlainText` field keep `min(1)`.

Settled by the orchestrator:

- **`CONTRACT_REVISION` stays 1.** The design's rule (`### Landing a contract change without breaking the live site`) bumps the revision so that a reader can tell when a producer is ahead of it. No artefact has been written at revision 1 yet and promo-flow has no vendored copy (`promo-flow/src/contract/` does not exist), so there is no reader to warn. Frozen card 20 asserts revision 1 and its vendoring header.
- **Paragraphs join with one space.** `InlineText` is one string, and none of its six tags is a paragraph break. Two paragraphs in a takeaway read as one body.
- **`label` wins over `headline` and `body` wins over paragraphs** when both are present, so the 89 well-formed files migrate exactly as today. A takeaway with neither `label` nor `headline` stays a typed failure: the migration never invents a label.

## Objective

`migrateV1` turns all 49 live promo-flow explainers into `ExplainerV2` artefacts. It reads a takeaway's label from `headline` when `label` is absent and its body from the paragraphs when `body` and `body_html` are both absent, and the contract accepts an empty table cell, so W3's reader can parse the live site.

## Inputs (read these in your own context)

- `contract/explainer-v2.ts` (`PlainText`, `table`), `contract/inline.ts` (`isPlainText`), `contract/migrate-v1.ts` (`twin`, `takeaway`, the table mapping)
- `tests/unit/migrate-v1.test.ts` and one fixture under `tests/unit/fixtures/v1/` (the fixture shape: `{input, ok, expected?, dropped?, issues?}`; the unit test runs every `*.json` in the directory)
- `docs/design/content-contract-v2.md`: `### The mapping (migrateV1())` and the `table` row of the block table under `### Fields` (`rows: 1+ PlainText[]`)
- `tests/contract/43-migrate-v1-reads-every-live-explainer.test.ts` (frozen) and this card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

Every file listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to the repo root.

1. `contract/explainer-v2.ts`: an exported `TableCell`, a string that is either `''` or passes `isPlainText` (its refine message names both), used for `table.rows` cells in both compositions. `columns`, `caption` and every other `PlainText` use are unchanged. `CONTRACT_REVISION` stays `1`.
2. `contract/generated/`: regenerated with `WEBSITE_REPO= npm run contract:build` (no `--website`, and `WEBSITE_REPO` cleared, since setting it alone makes the build vendor into the sibling checkout). The stored schema's cell loses its `minLength`; the OpenAI dialect stays strict.
3. `contract/migrate-v1.ts`, inside the existing `takeaway` helper (used for both `top_block` and `end_takeaway`):
   - `label` is `plain(o.label ?? o.headline)`.
   - `body` comes from the `body` twin (`body_html`, else `body`) when either is present. Otherwise it comes from `paragraphs_html`, else `paragraphs`: each entry's text, empty entries dropped, joined with one space, then through the same `inline()` path as every other `InlineText`.
   - A table cell that is the empty string stays `''`. Every other cell goes through `plain()` as today.
4. `tests/unit/fixtures/v1/takeaway-headline.json`, `takeaway-paragraphs.json` and `blank-cells.json`, each `ok: true`, with `expected` paths for the takeaway label and body or the blank cell. Add any further fixture you want.
5. `tests/unit/contract.test.ts`: one test that `ExplainerV2` accepts an empty cell and rejects a tagged cell and an empty column heading.
6. `docs/design/content-contract-v2.md`: in `### The mapping (migrateV1())`, add a row for the two takeaway shapes and one for blank cells. Under `### Fields`, change the `table` row's `rows` to say a cell is `PlainText` or empty. Add one line to the `## Open questions` log recording the 2026-10-22 decision, and one sentence at the end of `### Landing a contract change without breaking the live site` saying that a change made before any artefact or vendored copy exists at the current revision leaves the revision unchanged (the blank-cell change of 2026-10-22). Nothing else in the document changes.

## Constraints

- `migrateV1` stays pure (card 21's purity assertions still hold).
- Every frozen contract test passes unedited, cards 20 and 21's above all.
- `WEBSITE_REPO= npm run contract:check` stays clean. Do not run `contract:build --website` or write anything outside this worktree: W3 vendors into promo-flow.
- Nothing under `src/` or `scripts/` changes, and no file under `output/` is rewritten.
- No network and no paid API calls. British English and no em dashes in prose.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: the GPT-6.1 Sol verifier through the Codex CLI, workspace-write, no network needed.

Baseline on `dev` at `7ebc500` with the frozen test present (recorded 2026-10-22): 1 red, 9 of 11 failing; the two passing tests are the regression guards (the existing `{label, body}` takeaway migrates unchanged; a takeaway with no label stays a failure), green on the base by design. 2 to 5 green.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/43-migrate-v1-reads-every-live-explainer.test.ts` exits 0, 11 of 11.
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test $(ls tests/contract/*.test.ts | grep -v -e '/26-' -e '/27-' -e '/28-')` exits 0: every frozen contract, cards 20 and 21 included. Contracts 26 to 28 are left out because they read the held PDFs under `input/_held/`, which a run worktree does not have; they are not a criterion, and this card touches nothing they test.
3. **Types (verifier):** `npx tsc --noEmit` exits 0, and `npx tsc --noEmit --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck contract/*.ts scripts/contract-build.ts` exits 0.
4. **Unit suite (verifier):** `npm test` exits 0 and lists the three new fixtures.
5. **Drift gate (verifier):** `WEBSITE_REPO= npm run contract:check` prints `contract: generated files up to date`.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/43-migrate-v1-reads-every-live-explainer.test.ts` prints the digest recorded below.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. A `node_modules` clone is gitignored and does not appear.

## Contract test

- **Test file:** `tests/contract/43-migrate-v1-reads-every-live-explainer.test.ts`
- **Assertions digest:** `sha256:7c167799d8b3820c7b9aa4538dbc4364100ad2c8ca581bd3793bffb623cb4ee1`
- **Oracle proof:**
  - **Red on `dev` `7ebc500`:** 9 of 11 fail: both takeaway shapes, the plain-paragraphs and precedence case, body-over-paragraphs and empty-entry dropping, the top-block case, the blank-cell migration, the schema case, the stored cell's `minLength`, and the missing fixtures. The two regression guards pass by design.
  - **Green on a throwaway reference** (a detached scratch worktree, removed and pruned; nothing committed): 11 of 11, with cards 20 and 21's contracts (42 tests across the three), `npm test` (191), both `tsc` runs and `contract:check` all green. The reference was 5 files, +15/-9.
  - **Live corpus (orchestrator proof, not a criterion: a run worktree has no promo-flow sibling it can rely on):** with the reference, all 49 live promo-flow explainers migrate and parse as `ExplainerV2` (the 50th JSON file there, `_order.json`, is not an explainer).

## Out of scope

- promo-flow, vendoring (`contract:build --website`) and `parseExplainerJson()`: W3, promo-flow card 33.
- The `output.local/` archives that fail a structural bound or carry empty pills: W9's curation.
- Any other `PlainText` relaxation.

## Budget

- **Worker wall-clock:** 40 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** tranche 2's smallest cards in this repo's cost log (37 and 39): 0.89M to 0.93M tokens per stage. Expect below that, since the reference was 24 changed lines.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The `git diff` of `contract/explainer-v2.ts` and `contract/migrate-v1.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to a frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; make no network calls and write nothing outside the worktree.
- **Codex (verifier):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-22. Folded in: criterion 2 now names the contracts it runs and leaves out 26 to 28 (held PDFs) rather than allowing a FAIL; `WEBSITE_REPO` is cleared on every build and check, since setting it alone vendors into the sibling; the `node_modules` clone is gitignored, so it is outside criterion 7; the design gains one sentence for the revision exception instead of being left inconsistent; and the test now pins body-over-paragraph precedence, empty-entry dropping, the exported `TableCell` and the OpenAI cell, with its title corrected. It also noted that the frozen test cannot read the 49 live files; that check is the orchestrator's proof above, and W3's `check:contract` repeats it in promo-flow. Fixture `expected` paths and the doc edits are for the verifier's reading.
