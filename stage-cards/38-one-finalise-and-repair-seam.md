# Stage card 38-one-finalise-and-repair-seam: one finalise seam turns any route's receipt into a saved success, a review artefact or a classified failure

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/38-one-finalise-and-repair-seam
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/finalize.ts, src/output.ts, src/quality.ts, src/repair.ts, tests/unit/finalize.test.ts
- **Pairing rationale:** Design 17 marks W10 judgement work: it is the save path every route will share. The card writes out the seam's signature, its order of steps and every classification rule, and the frozen test pins them, so GPT-6.1 Sol at high effort fits without the frontier tier; the worker never edits a caller. Claude Opus 5.5 from the other family verifies at high effort, which a save-path card earns: it must also confirm the legacy bridges and every wave-1 contract test still pass. Card 37 has a Claude worker, so worker families alternate.
- **Open decisions:** none

## Surfacing concern

Design 17 (`docs/design/provider-routes.md`) `## Orchestrator` steps 4 to 7 (`:416-427`), the seam signature (`:429-446`) and the issue-class table (`:448-455`) put parsing, code-first fixes, bounded repair, figure work, final validation and saving behind one `finalizeResult(itemKey, result, context)`. Today the same work is spread across `finalizeResult` in `src/batch.ts:246` (a thin wrapper over `saveResult`), the six provider-specific call sites that run `repairUntilValid` first (`src/batch.ts:562`, `:627`, `:772`, `:908`, `:978`, `:1159`), and `saveResult` (`src/output.ts:532-607`), which calls the figure step inside saving and saves invalid output as a reviewed success (finding D12, `:73`). Every chart issue reaches the repair instruction (`src/repair.ts:41-43`). Card 22 landed `NormalizedResult` and `checkResult` (`src/llm-contract.ts:93-106`, `:222`). Checked against `dev` at `8bb4372`.

This card adds the seam beside today's path and changes no caller: design 17 W12 moves the routes onto it. Later cards build on it without this card pre-empting them: stage 16 W6 swaps the v1 validator for the v2 contract inside the seam, and stage 19 W4 puts the chart gate into it (that card's text says the hook goes into `src/finalize.ts` when it exists). So the seam validates with today's `validateJsonOutput`, keeps the six-point chart filter (`src/output.ts:363-366`, through `normalizeExplainerJson`), and keeps `saveResult`, `repairUntilValid`, `canonicaliseExplainerJson`, `extractJson` and `buildRepairInstruction` working exactly as they do. Wave-1 contract tests 03, 04, 06 and 09 pin those bridges, including that `repairUntilValid` still sends an ordinal-chart issue to repair; the new chart policy lives only in the seam.

Design decisions this card settles (none needed the operator):

1. **Run provenance comes from the context, not the receipt.** `metadata.model` and `metadata.run_mode` are stamped from `context.provenance`, as `src/batch.ts:246` passes them today, so the same text from any route gives the same article apart from those two fields.
2. **Code-first means stamping before validation:** detected byline, publication date and reference (the existing `stampProvenanceByline`), `metadata.date_created` set to the expected date, and a slug's leading `YYYY-MM-DD_` replaced with the expected date. These are run metadata and source metadata already in hand, so none is an invented source fact, and none costs a repair call (`:416-419`). `saveResult` keeps reporting a stale date as an issue (contract 04 pins that).
3. **What counts as a chart issue.** `isChartIssue(issue)` is true when the issue text starts with `chart`, `charts` or `recreated_figure` (as a word), or is a style issue whose path starts with one of them (`style (<check>) at charts[0].caption: ...`). Chart issues never reach repair; a chart's own title and caption are treated as chart content, since its text is part of what the evidence gate will judge.
4. **Chart protection.** The repair payload is the stamped candidate without `charts`, `chart` and `recreated_figure`; after each reply the original values of those three keys replace whatever the reply carried. So a reply cannot change chart numbers or add a chart, and `chartDigest` is unchanged by repair. This is the design's "exclude chart data from the editable payload and reattach the original data" (`:453`); its further "a repair that changes numbers/evidence is rejected" becomes moot for chart data, because the reply's chart changes never reach the candidate, so the reply's prose fix is kept rather than thrown away.
5. **Acceptance is by total issue count.** With chart keys reattached, chart issues are identical before and after a reply, so a reply is kept only when it has strictly fewer issues in all; a reply that fixes one prose issue and introduces another is rejected, which is the design's "without introducing hard failures" (`:451`). Source evidence for the repair belongs to the caller's `repair` callback (design 17 W12 builds it from the run plan); the seam passes only the instruction and the payload.
6. **Review artefacts** go to `<OUTPUT_DIR>/review/<filename>` and are neither staged to the website nor mirrored (`:455`). `metadata.quality` keeps today's `{ issues, needs_review }` shape.
7. **Invalid JSON and missing metadata** both fail `INVALID_JSON` (a seam-local code; `ERROR_CODES` is unchanged). Nothing is written, and the receipt is returned, so the caller keeps the raw text.
8. **Checkpoint keys** include the item key and the receipt's `attemptId`, so replaying the same attempt reuses its checkpoints and a new attempt of the same item is new work. Checkpoint values must survive a JSON round trip (they will live in state under design 17 W12). Checkpoints are taken after the repair loop, after the figure step and before persisting; an interruption inside the repair loop repeats the loop on the next call. Journalling each repair receipt as it arrives is design 17 W12's, through `recordReceipt` in `src/state-v2.ts`.
9. **Only an optional figure here.** A figure failure saves without an image and with a warning. A required figure and the stage 18 locator ladder are later cards (stage 18 W8, design 17 W13).

Missing provenance fields: an absent `expectedDate` falls back to the document's own well-formed `date_created`, then today's UTC date, as `saveResult` does (`src/output.ts:574-575`); an absent `model` or `runMode` is not stamped. A `repair` callback that throws, or returns a receipt `checkResult` rejects, rejects the whole call with nothing checkpointed; an adapter reports a failed call as an error receipt, never by throwing.

Cold read: a read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It raised: defaults for missing provenance and the handling of a throwing repair callback (now the paragraph above); the interruption window inside the repair loop (now decision 8); the chart-digest algorithm (now Deliverable 1); the design's "rejected" and "eligible issues" wording (now decisions 4 and 5); atomic saving and checkpointing before copies (now Deliverables 1 step 7 and 2); `checkResult` turning some malformed shapes into error receipts rather than throwing (now step 1); contract 01's sentinel files under `tests/` during the wave-1 run (now in Constraints); the static-import requirement (now Deliverable 1); and that criterion 7 needs the test committed before dispatch, which the orchestrator does. Nothing else was open.

## Objective

`src/finalize.ts` exports `finalizeResult(itemKey, result, context)`, which takes one route's `NormalizedResult` and, with no model call of its own, returns a `succeeded`, `needs_review` or `errored` outcome carrying the saved artefact's digest and destinations, its issues, its chart-data digest and every receipt, using code-first fixes, at most two chart-free repair attempts through an injected callback, and checkpoints that make replay free of further calls.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`## Orchestrator` `:402-455`, `## Open questions` Q4 `:1040`)
- `src/output.ts` (`canonicaliseExplainerJson`, `normalizeExplainerJson`, `deriveFilename`, `stampProvenanceByline`, `saveResult`)
- `src/quality.ts` (`validateJsonOutput`, `buildRepairInstruction`)
- `src/repair.ts` (`repairUntilValid`, `MAX_REPAIR_ATTEMPTS`)
- `src/llm-contract.ts` (`NormalizedResult`, `checkResult`, `ErrorCode`)
- `src/batch.ts:246-296` (today's wrapper and repair call sites; read only, do not change)
- `tests/contract/38-one-finalise-and-repair-seam.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root. `src/repair.ts` is claimed so the shared loop may move there; changing it is optional, and `repairUntilValid` and `MAX_REPAIR_ATTEMPTS` (2) must keep their behaviour.

1. **New `src/finalize.ts`**, which imports with static `import ... from` syntax and does not import `./providers`, `./batch`, `./vision`, `./figure-vlm`, `./figure-data` or `./index`, and does not reference `saveResult` or `attachFigureImage`, exporting:
   - `FinalizeContext`: `provenance: RunProvenance` (from `src/output.ts`); `checkpoints: { get(key: string): unknown | Promise<unknown>; put(key: string, value: unknown): void | Promise<void> }`; optional `repair: (instruction: string, payload: string) => Promise<NormalizedResult>`; optional `figure: (article: ExplainerJson, itemKey: string) => Promise<ExplainerImage | null>`; optional `persist` with the signature of `persistArtefact` (default `persistArtefact`).
   - `FinalizeOutcome`, discriminated on `status`. Every outcome has `itemKey`, `issues: string[]`, `warnings: string[]`, `receipts: NormalizedResult[]` (the checked synthesis receipt, then every repair receipt in call order, failed ones included) and `repairAttempts: number`. `succeeded` and `needs_review` add `article` (the saved object), `artefactDigest` (hex SHA-256 of the exact text written, `JSON.stringify(article, null, 2)`), `chartDigest` (hex SHA-256 of a canonical JSON of the article's `charts`, `chart` and `recreated_figure`: keys sorted, absent keys omitted), `jsonPath` and `destinations`. `errored` adds `code: ErrorCode | 'INVALID_JSON'` and a non-empty `message`.
   - `finalizeResult(itemKey: string, result: NormalizedResult, context: FinalizeContext): Promise<FinalizeOutcome>`, in this order:
     1. `checkResult(result)`: a receipt with missing or invalid identity fields rejects with `MALFORMED_RESULT`; other malformed shapes come back as error receipts and are handled by step 2.
     2. A receipt whose `finishReason` is not `stop` returns `errored` with the receipt's own error code (`OUTPUT_LIMIT` for a truncation), with no repair and nothing written.
     3. Parse with `extractJson`; unparseable text or no metadata object returns `errored` `INVALID_JSON`, with no repair and nothing written.
     4. Canonicalise and filter with `normalizeExplainerJson` (the six-point filter and three-chart cap stay), then stamp per decisions 1 and 2, then validate with `validateJsonOutput` (without `metadata.quality`) against `provenance.expectedDate`.
     5. While `context.repair` is given, fewer than `MAX_REPAIR_ATTEMPTS` (2) calls have been made, and at least one issue is not a chart issue: call `repair(buildRepairInstruction(nonChartIssues, expectedDate), payload)` with the payload of decision 4. Each call counts as an attempt and its checked receipt is kept, whatever it returns. A reply that is not `stop`, does not parse or has no metadata is skipped. Otherwise prepare it as in step 4, put back the original chart keys, revalidate, and keep it only when it has strictly fewer issues than the best so far.
     6. Checkpoint the best article, receipts and attempt count before any figure work. When `context.figure` is given, call it once with a copy of the article; its image replaces `article.image` (`null` removes it); a throw removes the image and adds a warning that includes the error message. Checkpoint that result. Without `context.figure` there is no figure step.
     7. Validate the final article again, set `metadata.quality = { issues, needs_review }`, checkpoint the final article and its digest, and persist: no issues is `succeeded` with kind `success`; any issue left (chart issues included) is `needs_review` with kind `review`. A persist failure rejects; a later call with the same checkpoints resumes from step 7 with no repair or figure call.
     On a replay of the same item and attempt, steps 3 to 6 come from the checkpoints: no repair or figure call, the same receipts and the same `artefactDigest`.
2. **`src/output.ts`:** export `normalizeExplainerJson` and `stampProvenanceByline` unchanged, and add `persistArtefact(article, { itemKey, kind: 'success' | 'review' }): Promise<{ jsonPath, destinations: { output: 'written'; staging: 'written' | 'skipped' | 'failed'; mirror: 'written' | 'skipped' | 'failed' } }>`. It names the file with `deriveFilename(itemKey, article)` and writes `JSON.stringify(article, null, 2)` atomically (a temporary file in the same directory, then a rename); a success goes to `OUTPUT_DIR`, then copies to `WEBSITE_STAGING_DIR` and `OBSIDIAN_MIRROR_DIR` when configured (`skipped` when not, `failed` when a copy throws); a review goes to `OUTPUT_DIR/review/` with both copies `skipped`. `saveResult` behaves exactly as today.
3. **`src/quality.ts`:** export `isChartIssue(issue: string): boolean` per decision 3. `validateJsonOutput` and `buildRepairInstruction` are unchanged.
4. **New `tests/unit/finalize.test.ts`**, run by `npm test`: code-first repair, unchanged chart-data digests, bounded attempts and replay without extra calls (the design's W10 outcome, `:1132`), with injected fakes and temporary directories only.

## Constraints

- No caller changes: `src/batch.ts`, `src/index.ts`, `src/providers.ts` and the scripts keep using `saveResult` and `repairUntilValid`. Moving them onto the seam is design 17 W12.
- No v2 contract, chart-gate or locator work: stage 16 W6, stage 19 W4 and stage 18 W8 own those. The seam uses today's v1 validator and six-point filter.
- `src/llm-contract.ts`, `src/state.ts`, `src/state-v2.ts` and every frozen contract test stay as they are.
- Tests set `EXPLAINER_OUTPUT_DIR`, `EXPLAINER_OBSIDIAN_DIR`, `WEBSITE_REPO` and `EXPLAINER_STATE_FILE` to temporary paths before loading `src/`, as contract 04 does; they never touch the operator's `output/`, website checkout, vault, `.env.local` or `state.json`.
- No network and no paid API calls.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state, a cloned `node_modules` (gitignored), files under the OS temp directory, and the sentinel files contract 01 creates and removes under `tests/` while the wave-1 suite runs.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Opus 5.5 verifier through the Claude CLI; no network needed. The worker runs criteria 1 to 4 in its Codex workspace-write sandbox, which is enough (no network; contract 38 writes only under the OS temp directory, and contract 01 writes and removes its sentinels inside the worktree).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/38-one-finalise-and-repair-seam.test.ts` exits 0 with 13 passing. It covers the exports and bridges and `isChartIssue`; the import surface; a clean success saved, staged and mirrored with its digest; the same article from all six routes; code-first date, slug and reference; a chart-only issue sent to review with no repair; a chart-free repair payload whose chart changes are discarded with the chart digest unchanged; the two-attempt bound, best-candidate retention and skipped truncated or unparseable replies; `INVALID_JSON` and `OUTPUT_LIMIT` failures with nothing written; `MALFORMED_RESULT`; the optional figure and its failure; and replay after completion, after an interrupted save, and for a new attempt. Baseline on `dev`: red, 13 of 13 fail (first: `src/finalize.ts must exist`).
2. **Wave-1 bridges (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/0*.test.ts tests/contract/1[0-5]*.test.ts` exits 0 (141 passing). Baseline on `dev`: green, 141 passing.
3. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
4. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/finalize.test.ts`. Baseline on `dev`: green.
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/38-one-finalise-and-repair-seam.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Design fidelity (verifier, reading):** `finalizeResult` follows Deliverable 1's step order; `src/finalize.ts` holds no provider, vendor or route branch; `saveResult` and `repairUntilValid` are unchanged in behaviour. Baseline: not applicable before the run.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/38-one-finalise-and-repair-seam.test.ts`
- **Assertions digest:** `sha256:4b286b3670d3ce77489d9ba6e5e2a4dcce8338d87fbe7903a37b3b226dcdd548`
- **Oracle proof:** On `dev` (`8bb4372`) all 13 tests fail because `src/finalize.ts` does not exist. A throwaway reference in a detached scratch worktree (a 190-line `src/finalize.ts`, `persistArtefact` and two exports added to `src/output.ts`, `isChartIssue` added to `src/quality.ts`, `src/repair.ts` untouched) passed 13 of 13, with `npx tsc --noEmit` and `npm test` (125) green and every wave-1 contract test passing; contracts 26 to 28 fail in any scratch worktree for want of the held PDFs beside a sibling checkout, and pass in a run worktree. Ten mutations of the reference were each caught: no chart reattachment, charts in the payload, three attempts, no date stamp, no repair checkpoint, no figure checkpoint, no review routing, chart issues sent to repair, keeping the latest reply instead of the best, and skipping `checkResult`. The worktree was removed and pruned.

## Out of scope

- Moving `src/batch.ts` callers, the cost ledger or state receipts onto the seam: design 17 W12.
- Writing v2 artefacts or the `lead_figure` sidecar: stage 16 W6. The chart gate: stage 19 W4. Required figures and the locator: stage 18 W8 and design 17 W13.
- Deleting `saveResult`, `repairUntilValid` or the provider-specific repair wrappers: design 17 W15.
- New entries in `ERROR_CODES`.

## Budget

- **Worker wall-clock:** 75 minutes
- **Verifier wall-clock:** 40 minutes
- **Spend basis:** tranche 1 in this repo: Sol worker cards 0.6M to 1.2M tokens (card 30 0.61M, card 29 1.20M), Opus 5.5 verifier median about 0.9M; card 24 (Sol worker, judgement) 1.40M in all. Expect about 1.8M: one new module of about 200 lines, two small exports, a unit test, and a 30-second wave-1 run.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported names of `src/finalize.ts` and the new exports of `src/output.ts` and `src/quality.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the tests write under the OS temp directory and, for contract 01, inside the worktree. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
