# Stage card 48-every-route-saves-through-the-v2-seam: every batch and sync route saves its result through the v2 finalise seam

## Metadata

- **Authored:** 2026-10-22
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/48-every-route-saves-through-the-v2-seam
- **Worker effort:** high
- **Verifier effort:** medium
- **Verifier panel:** false
- **Gate:** stage-completed: 47-requests-ask-for-the-v2-wire-shape
- **Path claims:** src/batch.ts, src/output.ts, tests/unit/
- **Pairing rationale:** Six completion sites rewired onto a seam that card 46 already proved, with the receipt, repair adapter, usage and error handling written out and two re-frozen end-to-end contracts pinning them: GPT-6.1 Sol at high fits, and the operator asked on 2026-10-22 to bias token spend towards OpenAI. The verifier is Claude Opus 5.5 at medium from the other family, because this is the card that changes what production saves and judging that no route was missed is the risky part. Neither role needs Fable or Astra.
- **Open decisions:** none

## Surfacing concern

Design 16 W6, the second half of W6b (card 47 changed the requests). This card changes behaviour only: every route now saves through `finalizeResult` in `src/finalize.ts` (card 46). Card 49 then deletes the v1 path this leaves unused. The production pause holds from card 45 landing until W6c lands. **Between this card and W6c, production saves attach no figure**: `saveResult`'s `attachFigureImage` is no longer on the path, and W6c adds `lead_figure` to the seam.

Settled by the orchestrator:

- **One helper.** `src/batch.ts`'s local `finalizeResult` (`src/batch.ts:246`) is replaced by one helper declared as `async function saveThroughSeam(...)`, called by name at exactly six sites (one per completion site; `runOpenAISync` has one site for both auth modes); it is the only caller of the seam's `finalizeResult` in `src/batch.ts`, and nothing in `src/batch.ts` calls `saveResult`, `repairUntilValid`, `maybeRepairClaude` or `maybeRepairOpenAI` (the two local wrappers are deleted).
- **The receipt.** Built from the synthesis result as a `NormalizedResult`: `provider`; `route` `batch-api` for `collectClaude` and `collectOpenAI` (both the single-stage and the lane-synthesis sites), `subscription-cli` for `collectOpenAILocal`, `runClaudeSync` and `runOpenAISync` in `codex_cli` mode, and `sync-api` for `runOpenAISync` in `api_key` mode; `stage: 'synthesis'`; the model the site uses today; `customId`; `attemptId` `<id of the batch whose result is being collected>:<custom id>` (for lane synthesis, the synthesis batch); `finishReason: 'stop'`; the text; `usage` from the input and output tokens, with zero cache fields and `source: 'reported'`.
- **The repair adapter.** `(instruction, payload) => NormalizedResult` calling what `maybeRepairClaude` and `maybeRepairOpenAI` call today (the Claude CLI for a `claude_cli` run, else the provider's `createMessage` with `wireSchema(provider)` from card 47), with `instruction` as the system text and `payload` as the user text, returned as a receipt with `stage: 'repair'` and the repair model. A provider error propagates, as it does today, and the site marks the item errored.
- **The stamp context** from the request: `expectedDate` as today, `detectedReference` from `req.detectedCitation`, `publishedOn` from `req.publishedOn`, `source` `{kind: 'url', ref: <the URL>}` or `{kind: 'pdf', ref: <the PDF basename>}`.
- **Outcomes.** `succeeded` and `needs_review` set `req.result = 'succeeded'` and `req.output` to the saved path relative to the output directory (`review/<slug>.json` for a review item); HTML export runs for `succeeded` items only. `errored` sets `req.result = 'errored'` and `req.error` to `<code>: <message>`, and the synthesis text is kept as `<date>_<id>_error.txt` by `saveRawOutput(customId, text)`, which `src/output.ts` now exports (the body of `saveResult`'s `keepRawOutput`, unchanged).
- **Usage.** `applyUsage` keeps its signature; the repair usage is the sum of the outcome's `repair` receipts.
- **Checkpoints.** Each call passes a fresh in-memory store (`get`/`put` over a `Map`); resuming across processes is provider-routes W12's, not this card's.
- **HTML export.** `exportSavedHtml` takes the saved JSON paths of `succeeded` outcomes; `SaveResult` may stay as the type it collects or be narrowed to paths, as long as `saveResult` itself is not called.
- **What the re-frozen 05 and 06 still pin**, beyond the routes: 05 keeps the model defaults, the README and `CLAUDE.md` lane sentences, one call per paper, and a failed lane failing its paper; 06 requires a batch and a sync run of the same paper to save identical articles once `metadata.route` and `metadata.model` are removed, so nothing else in the stamp may depend on the route.

## Objective

Every batch collect and sync run saves its result through the v2 seam, so the JSON production writes is an `ExplainerV2` with stamped metadata and a structured reference, and the v1 save path is no longer called from any route.

## Inputs (read these in your own context)

- `src/batch.ts`: the local `finalizeResult`, `maybeRepairClaude`, `maybeRepairOpenAI`, `applyUsage`, `exportSavedHtml` and the six completion sites in `collectClaude`, `collectOpenAI` (two), `collectOpenAILocal`, `runClaudeSync` and `runOpenAISync`
- `src/finalize.ts` (`finalizeResult`, `FinalizeContext`, `StampContext`), `src/llm-contract.ts` (`NormalizedResult`), `src/wire-schema.ts`, `src/output.ts` (`saveResult`'s `keepRawOutput`)
- `tests/contract/05-*.test.ts` and `06-*.test.ts` (re-frozen for this card), `tests/contract/48-every-route-saves-through-the-v2-seam.test.ts` (frozen), and this card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

Every file listed here must be created or modified, except the frozen contract tests, which already exist and must not be edited. Paths are relative to the repo root.

1. `src/batch.ts`: `saveThroughSeam`, the receipt builder and the repair adapter as above; the six sites call `saveThroughSeam`; the local `finalizeResult`, `maybeRepairClaude` and `maybeRepairOpenAI` are deleted, with the `saveResult`, `repairUntilValid` and `RepairResult` imports they used.
2. `src/output.ts`: export `saveRawOutput(customId, text): string` (returns the file name), used by `saveResult` and by `src/batch.ts`. Nothing else changes.
3. `tests/unit/`: any unit test that exercised a deleted batch helper is updated; add one for the receipt builder's route mapping.

## Constraints

- `src/finalize.ts`, `src/quality.ts`, `src/repair.ts`, `src/prompt.ts`, `src/preprocess.ts`, `src/state.ts`, `src/providers.ts` and `contract/` are unchanged. `saveResult` and the rest of the v1 path stay in place, unused by `src/batch.ts`; card 49 deletes them.
- Every frozen contract passes unedited, 03, 05 and 06 as re-frozen for this card.
- No network and no paid API calls; every test stubs the providers. British English and no em dashes.
- Do not create or modify files outside the deliverables, except this card's run state. What the frozen tests do themselves (scratch files under the system temporary directory) is not a breach.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: the Claude Opus 5.5 verifier through the Claude CLI, no network needed.

Baseline on `dev` at `253b42c` (2026-10-22, cards 45 to 47 landed): 1 red (this test 36 of 37; re-frozen 06 6 of 6; re-frozen 05 2 of 7: the v1 `saveResult` rejects a v2 wire output as having no metadata and writes `_error.txt`); 2 red at 03, 05, 06 and 48; 3 and 4 green; 5 red. Run the frozen suite with `--test-concurrency=1`.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 tests/contract/48-every-route-saves-through-the-v2-seam.test.ts tests/contract/05-one-call-reads-the-whole-paper-by-default.test.ts tests/contract/06-batch-results-carry-their-provenance.test.ts tests/contract/03-chart-checks-run-on-structured-output.test.ts` exits 0.
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 $(ls tests/contract/*.test.ts | grep -v -e '/26-' -e '/27-' -e '/28-')` exits 0. Contracts 26 to 28 read held PDFs under `input/_held/`, which a run worktree does not have; contracts 39 and 42 find them through the sibling `../explainer-batch` checkout.
3. **Types (verifier):** `npx tsc --noEmit` exits 0.
4. **Unit suite (verifier):** `npm test` exits 0.
5. **One save path (verifier):** `grep -nE '\b(saveResult|repairUntilValid|maybeRepair(Claude|OpenAI))\b' src/batch.ts` prints nothing.
6. **No route missed (verifier, judgement):** read the six sites. Each builds its receipt with the route in the table above, passes a repair adapter for its provider and auth mode, and handles all three outcome statuses. Name any site that does not.
7. **Frozen blocks intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print` for `tests/contract/48-*.test.ts`, `03-*.test.ts`, `05-*.test.ts` and `06-*.test.ts` prints the digests recorded below, and `git diff dev -- tests/contract` is empty.
8. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state.

## Contract test

- **Test file:** `tests/contract/48-every-route-saves-through-the-v2-seam.test.ts`
- **Assertions digest:** `sha256:4a18eea2c2917c739e13fb28f576baf81ae29e55bb811cff2bc40cc7b1fefc6d`
- **Oracle proof:**
  - **Drafted** by a read-only GPT-6.1 Sol session from this card and the cards for 45 to 47, with the re-freezes of 05 and 06; reviewed by the orchestrator. The drafts asserted nothing about the v1 detected fields or the schema module, which card 49 deletes.
  - **Red on `dev` `253b42c`:** this test 36 of 37 (the fixture check passes by design); re-frozen 06 6 of 6; re-frozen 05 2 of 7 (the default sync run and the lane batch collect); re-frozen 03 1 of 8.
  - **Green on a throwaway reference** written by a GPT-6.1 Sol session in a detached worktree at `~/repos/eb-ref48` on `253b42c` (removed and pruned; nothing committed): this test 37 of 37, 05 7 of 7, 06 6 of 6, 03 8 of 8, `tsc` clean, `npm test` 208, and the whole frozen suite with `--test-concurrency=1` green apart from contract 03's `repairUntilValid` assertion, which found the re-freeze below. About 200 changed lines in `src/batch.ts` and `src/output.ts`.
  - **Traps the reference met:** the seam's wire citation type has required keys that may be `undefined`, while `detectedCitation` omits them, so map it explicitly; the seam outcome has `jsonPath`, not `jsonFile`; `NormalizedResult.provider` admits `gemini` while the legacy helpers take only `claude` or `openai`, so narrow it at the site.
- **Re-freezes in the same commit:** `tests/contract/06-batch-results-carry-their-provenance.test.ts` (v2 fixtures; `detectedCitation` and `publishedOn` persisted; `references[0]` detected; batch and sync identical apart from route and model; no `saveResult` call and one `finalizeResult` call in `src/batch.ts`), `tests/contract/05-one-call-reads-the-whole-paper-by-default.test.ts` (v2 fixtures and the stamped slug; every behaviour kept), and `tests/contract/03-chart-checks-run-on-structured-output.test.ts` line 142 (`src/batch.ts` uses `saveThroughSeam`, not `repairUntilValid`). Cards 03, 05 and 06 carry the new digests.

## Out of scope

- Deleting `saveResult`, `repairUntilValid`, `normalizeSchemaDrift`, the v1 validator, `src/schema/explainer-schema.ts` or the v1 detected fields: card 49.
- `lead_figure`, the sidecar and `recreated_figure`: W6c.
- Provider-routes W12 (one orchestrator): this card keeps today's six functions.

## Budget

- **Worker wall-clock:** 75 minutes
- **Verifier wall-clock:** 35 minutes
- **Spend basis:** card 38 (the seam) and card 06 (the provenance stamping across routes): about 3M tokens for the stage.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The `git diff` of `src/batch.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to a frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls and write nothing outside the worktree beyond what the frozen tests themselves write under the system temporary directory.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol) read this card and its three tests on 2026-10-22. Folded in: the in-memory checkpoint store; the lane-synthesis `attemptId`; the HTML export input; `saveThroughSeam` as a function declaration called at six sites; what 05 and 06 still pin; the concurrency flag on criterion 1.
