# Stage card 47-requests-ask-for-the-v2-wire-shape: every request sends the generated v2 dialect and a citation-aware user turn, and detection records a structured citation

## Metadata

- **Authored:** 2026-10-22
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/47-requests-ask-for-the-v2-wire-shape
- **Worker effort:** high
- **Verifier effort:** medium
- **Verifier panel:** false
- **Depends on:** 46-the-finalise-seam-saves-v2
- **Path claims:** src/prompt.ts, src/preprocess.ts, src/state.ts, src/batch.ts, src/providers.ts, src/wire-schema.ts, src/schema/explainer-schema.ts, tests/unit/
- **Pairing rationale:** Request-side plumbing with every rule written out (the two user-turn sentences, the citation mapping, which dialect each provider sends) and pinned by a frozen test: GPT-6.1 Sol at high fits, and the operator asked on 2026-10-22 to bias token spend towards OpenAI. The verifier is Claude Sonnet 5.5 at medium from the other family: verifying is running the commands and reading a mechanical diff. Neither role needs Fable or Astra.
- **Open decisions:** none

## Surfacing concern

Design 16 W6, split by the operator on 2026-10-22 into W6a (card 46, the v2 seam), W6b and W6c; the orchestrator split W6b in two when carding it, because it would not fit one worker's context: **W6b1 (this card) changes what every request asks for; W6b2 (card 48) moves every save onto the seam and deletes the v1 path.** The production pause holds from W5 (card 45) landing until W6c lands; between this card and card 48 the requests ask for v2 while `saveResult` still saves v1, which only a production run would hit.

Settled by the orchestrator, from the design (Q7, D12, `### Artefacts and their producers`):

- **The user turn.** `buildUserInstruction(expectedDate, focusHint?, pinnedFigure?, citationKnown = false)`. The positional signature is kept because frozen contracts 02 and 42 call it that way; `expectedDate` is no longer used in the text. It drops the `metadata.date_created`, `metadata.filename_slug`, `Published Month Year` and Chart.js sentences, and adds exactly one citation sentence: when `citationKnown`, "The paper's citation is already known: set `citation` to null."; otherwise, "Fill `citation` from the paper's front matter: the authors in order, the year, the full title, the venue and a URL." Everything contracts 02 and 42 match stays: "prefer a table", "stated", `figure_request`, "Never emit an `image` block: the figure pipeline locates and attaches the figure.", the pin sentence, the emphasis block and no em dash.
- **Which dialect each request sends.** `src/wire-schema.ts` (new) exports `wireSchema(provider: 'claude' | 'openai')`, which reads `contract/generated/model-output.claude.json` or `model-output.openai.json`, and `structuredOutputEnabled()`, moved there unchanged from `src/schema/explainer-schema.ts` (which re-exports it until card 48 deletes the file). Every Claude request and Claude repair sends `wireSchema('claude')` where it sends `EXPLAINER_JSON_SCHEMA` today; every OpenAI request and repair sends `wireSchema('openai')`. Routes that cannot carry a schema (the Claude CLI and the Codex CLI) send none, as today (design D12); the prompt block and the seam's validator cover them. `openAIJsonSchemaFormat` stays the only OpenAI format constructor (frozen contract 07). The Claude forced-tool mechanism is unchanged.
- **Structured detection, additive.** `src/preprocess.ts` exports `buildCitation(meta, sourceUrl)`, the structured twin of `buildReference` with the same rules: undefined unless the metadata has a title and at least one author; `authors` every author in order, each `{family, given}` with `family` from "Surname, Given" or the last word of "Given Surname" and `given` the initials (`"Vivek"` to `"V."`, `"Jean Paul"` to `"J. P."`), omitted when there are none; `year` the four-digit year of the date, omitted when none; `title` the metadata title; `venue` the journal when there is a DOI, `arXiv preprint arXiv:<id without version>` for an arXiv page with no DOI, else the journal, omitted when none; `url` the DOI link (`https://doi.org/<doi>`), else the arXiv `/abs/` URL, else the source URL. Every text value goes through `toPlain`, so it holds no tag and no HTML entity; a decoded `&` stays (`Bank runs &amp; liquidity` becomes `Bank runs & liquidity`). It also exports `publishedOnFrom(date)`, giving `YYYY-MM` (month zero-padded) from a date that carries a year and a month 1 to 12, such as `2024/03/05` or `2024-11`, and undefined for anything else, a bare year included. `InputItem` and `RequestState` gain `detectedCitation?` and `publishedOn?`; the existing `detectedSurname`, `detectedPublished` and `detectedReference` stay and are still filled, because the v1 save path reads them until card 48. A state entry with no `detectedCitation` (every entry written before this card) means the citation is not known.
- **Where `citationKnown` comes from:** `item.detectedCitation !== undefined` at every one of the six call sites (`src/batch.ts:334`, `445`, `718`, `828`, `971`, `1079`), persisted on the request through `detectedCitation`.

## Objective

Every synthesis and repair request sends the generated v2 dialect for its provider, the user turn tells the model whether to emit `citation`, and detection records the paper's citation in the v2 shape so the seam can stamp `references[0]` from it.

## Inputs (read these in your own context)

- `src/prompt.ts` (`buildUserInstruction`), `src/preprocess.ts` (`CitationMeta`, `extractCitationMeta`, `buildReference`, `formatCitationDate`, `fetchHtmlContent`, the URL branch near line 650), `src/state.ts` (`RequestState`), `src/batch.ts` (the six `buildUserInstruction` calls and every `EXPLAINER_JSON_SCHEMA` use), `src/providers.ts` (`toolOutputParams`, `openAIJsonSchemaFormat`, the sync `createMessage`), `src/schema/explainer-schema.ts` (`structuredOutputEnabled`)
- `contract/generated/model-output.claude.json` and `model-output.openai.json` (read only), `contract/inline.ts` (`toPlain`, read only)
- `docs/design/content-contract-v2.md`: Q7 and D12
- Frozen tests that call what you change: `tests/contract/02-*.test.ts` (user instruction), `07-*.test.ts` (line 155), `12-*.test.ts` (line 145) and `14-*.test.ts` (both re-frozen for this card), `42-*.test.ts` (lines 236 to 247), `06-*.test.ts` (how batch requests and state are stubbed)
- `tests/contract/47-requests-ask-for-the-v2-wire-shape.test.ts` (frozen) and this card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

Every file listed here must be created or modified, except the frozen contract tests, which already exist and must not be edited. Paths are relative to the repo root.

1. `src/wire-schema.ts` (new): `wireSchema` and `structuredOutputEnabled` as above.
2. `src/schema/explainer-schema.ts`: `structuredOutputEnabled` becomes a re-export from `src/wire-schema.ts`; nothing else changes. The file is deleted by card 48.
3. `src/prompt.ts`: `buildUserInstruction` per the Surfacing concern. `buildSystemPrompt` is unchanged.
4. `src/preprocess.ts`: `buildCitation`, `publishedOnFrom`, and `detectedCitation` and `publishedOn` filled beside the existing detected fields.
5. `src/state.ts`: `detectedCitation?` and `publishedOn?` on `RequestState`.
6. `src/batch.ts`: every request and repair sends `wireSchema(provider)`; every `buildUserInstruction` call passes `citationKnown`; `detectedCitation` and `publishedOn` are persisted on the request beside the existing fields. No completion site and no save path changes.
7. `src/providers.ts`: imports `structuredOutputEnabled` from `./wire-schema`, and the doc comment above `toolOutputParams` no longer names `EXPLAINER_JSON_SCHEMA` (it says the generated Claude dialect); nothing else changes.
8. `tests/unit/`: unit tests for `buildCitation` (a DOI journal page, an arXiv page, a page with no title, "Surname, Given" and "Given Surname" names, an entity in the title) and for `publishedOnFrom`.

## Constraints

- `saveResult`, `repairUntilValid`, `validateJsonOutput`, `normalizeSchemaDrift`, `stampProvenanceByline`, `src/finalize.ts` and `src/output.ts` are unchanged. The v1 detected fields are still written exactly as today.
- `skill.md`, `contract/` and `src/schema/explainer-schema.ts` beyond the one re-export line are unchanged.
- Every frozen contract passes unedited, 12 and 14 as re-frozen for this card.
- No network and no paid API calls. British English and no em dashes.
- Do not create or modify files outside the deliverables, except this card's run state. What the frozen tests do themselves (scratch files under the system temporary directory, card 20's `contract:build` into one) is not a breach.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: the Claude Sonnet 5.5 verifier through the Claude CLI, no network needed.

Baseline on `dev` at `66652d9` (2026-10-22): 1 red (this test 8 of 8; re-frozen 14 1 of 6, the date assertion); 2 red at 14, 45, 46, 38 and 47 on `dev` because cards 45 and 46 have not landed (this card depends on 46, which depends on 45; card 45 adds the system-prompt marker strip that contract 42 needs); 3 and 4 green; 5 red (`EXPLAINER_JSON_SCHEMA` in both files). Run the frozen suite with `--test-concurrency=1`.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 tests/contract/47-requests-ask-for-the-v2-wire-shape.test.ts tests/contract/14-explainer-prose-is-faithful-not-quippy.test.ts tests/contract/12-the-figure-picker-prefers-the-results-figure.test.ts` exits 0.
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 $(ls tests/contract/*.test.ts | grep -v -e '/26-' -e '/27-' -e '/28-')` exits 0. Contracts 26 to 28 read held PDFs under `input/_held/`, which a run worktree does not have; contracts 39 and 42 find them through the sibling `../explainer-batch` checkout.
3. **Types (verifier):** `npx tsc --noEmit` exits 0.
4. **Unit suite (verifier):** `npm test` exits 0 and lists the new `buildCitation` and `publishedOnFrom` tests.
5. **No v1 schema in requests (verifier):** `grep -n 'EXPLAINER_JSON_SCHEMA' src/batch.ts src/providers.ts` prints nothing.
6. **Frozen blocks intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print` for `tests/contract/47-requests-ask-for-the-v2-wire-shape.test.ts`, `tests/contract/14-explainer-prose-is-faithful-not-quippy.test.ts` and `tests/contract/12-the-figure-picker-prefers-the-results-figure.test.ts` prints the digests recorded below, and `git diff dev -- tests/contract` is empty.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state.

## Contract test

- **Test file:** `tests/contract/47-requests-ask-for-the-v2-wire-shape.test.ts`
- **Assertions digest:** `sha256:19c6856292723691499587b2053b23575a1f2997ab6fe045eb2197d00f5dc220`
- **Oracle proof:**
  - **Drafted** by a read-only GPT-6.1 Sol session from this card, with the re-freeze of contract 14; reviewed by the orchestrator, who removed the assertions that the v1 detected fields persist (card 49 deletes them; contract 06 guards them until card 48 re-freezes it), and narrowed the plain-text check to tags and entities so a literal `x < 3` in a title is allowed, as `toPlain` allows it.
  - **Red on `dev` `66652d9`:** this test 8 of 8 fail (no `src/wire-schema.ts`, no citation sentence, `EXPLAINER_JSON_SCHEMA` in the request bodies, no `buildCitation` or `publishedOnFrom`). Re-frozen 14: 1 of 6 fails, the user instruction still asks for `Published Month Year`.
  - **Green on a throwaway reference** written by a GPT-6.1 Sol session in a detached worktree at `~/repos/eb-ref47` on `dev` (removed and pruned; nothing committed): this test 8 of 8, re-frozen 14 6 of 6, `tsc --noEmit` clean. The request-body tests capture real `submitBatch` bodies through the provider stubs. About 130 changed lines across seven files.
  - **Traps the reference met:** the source scan rejects `EXPLAINER_JSON_SCHEMA` in a comment too (deliverable 7 now says so); the inferred citation types make `given` a required key that may be `undefined`, while detection must omit it, so declare an explicit detected-citation interface.
- **Re-freeze in the same commit:** `tests/contract/14-explainer-prose-is-faithful-not-quippy.test.ts`: the assertion that the user instruction matches `Published Month Year` becomes two: it no longer asks for a publication date, and it carries a `citation` sentence. `tests/contract/12-the-figure-picker-prefers-the-results-figure.test.ts` line 145: the user instruction no longer carries the submit date (it asserted the date was there); the proof found it, the survey had missed it. Card 12's recorded digest is updated to `sha256:00c7e7598444455c593f6a39322ddeffa359ff58855f08c25424514b723b8106` (red on `dev`, 1 of 4; green on the reference, 4 of 4). Card 14's recorded digest is updated to `sha256:902eb61343df641c8429dc890ea4f1b0de701381a0b32520608b503016825cfa`.

## Out of scope

- The completion sites, `saveResult`, the repair loop's validation, `_error.txt`, and deleting the v1 detected fields or `src/schema/explainer-schema.ts`: card 48.
- `lead_figure` and the sidecar: W6c.
- The `Detected paper author(s):` lines prepended to fetched text: unchanged.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** card 40 (preprocess plus batch request plumbing): about 2M tokens for the stage.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The `git diff` of `src/prompt.ts` and `src/wire-schema.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to a frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls and write nothing outside the worktree beyond what the frozen tests themselves write under the system temporary directory.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol) read this card and both tests on 2026-10-22. Folded in: the CLI routes carry no schema (D12); the baseline explains why contract 42 needs card 45 first; criterion 1 runs with `--test-concurrency=1`; the plain-text check allows a literal `<`. The digests are recorded above.
