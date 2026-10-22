# Stage card 50-the-lead-figure-is-a-sidecar-asset: the seam stamps lead_figure from a sidecar image file written beside the JSON, and recreated_figure is never written

## Metadata

- **Authored:** 2026-10-22
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/50-the-lead-figure-is-a-sidecar-asset
- **Worker effort:** high
- **Verifier effort:** medium
- **Verifier panel:** false
- **Gate:** stage-completed: 49-the-v1-save-path-is-deleted
- **Path claims:** src/finalize.ts, src/output.ts, src/batch.ts, scripts/smoke-contract.ts, tests/unit/, docs/FIGURE-EXTRACTION.md, CLAUDE.md
- **Pairing rationale:** The figure hook, the sidecar write and its copies, with the naming rule and the stamp fields written out and pinned by a frozen test: GPT-6.1 Sol at high fits, and the operator asked on 2026-10-22 to bias token spend towards OpenAI. The verifier is Claude Opus 5.5 at medium from the other family, because this is the card that ends the production pause and the verifier judges that a real run would now write a complete artefact. Neither role needs Fable or Astra.
- **Open decisions:** none

## Surfacing concern

Design 16 W6c, the last of the cards that land back to back from W5 (card 45). **When this card lands, the production pause ends**: a run then writes a complete `ExplainerV2` with its lead figure as a sidecar file.

The figure still comes from today's vision path (`extractFigureViaVlm`), so `provenance` is `vlm-crop` (design Q5: "today's path writes `vlm-crop` (W6) and stage 18 adds the rest"); the deterministic locator ladder is figure-locator W8, carded later, which will swap the hook's body without touching the seam.

Settled by the orchestrator:

- **The hook.** `FinalizeContext` gains `figure?: (wire, itemKey) => Promise<FigureAsset | null>`, where `FigureAsset` is `{ label: string; caption: string; alt_text: string; bytes: Buffer; page?: number; provenance: 'arxiv-source' | 'pdf-embedded' | 'pdf-vector-crop' | 'dom-asset' | 'vlm-crop' }`. The seam calls it after repair and the resolution of surviving issues, and before stamping, only when `figure_request` is non-null. Its result is checkpointed (bytes as base64 inside the checkpoint), so a replay makes no second figure call, as before card 46.
- **No figure.** A hook that returns `null` or throws gives no `lead_figure`; `quality.dropped` gains `figure_request: no figure located` or `figure_request: <error message>`; `figure_request` stays in the artefact for reextract; the item's status is unchanged.
- **The stamp.** `lead_figure` is `{label, caption, alt_text, asset, sha256, width?, height?, page?, provenance}`: `asset` is `<slug>/<file>`, where `<file>` is `assetFileName(parseLabel(label), sniffImageType(bytes))` from `src/figure-locator/` (`figure-3.jpg`, `figure-4b.png`, `table-2.jpg`, or `figure.<ext>` for a label with no number); `sha256` is the lowercase hex hash of the bytes; `width` and `height` come from `imageSize(bytes)` and are omitted when it returns null (an SVG). Bytes whose type cannot be sniffed count as no figure (`figure_request: unrecognised image bytes`).
- **The write.** `persistArtefact` writes the image to `<dir>/<slug>/<file>` before the JSON, in the same directory as the JSON (`output/` or `output/review/`), and copies it to `<staging>/<slug>/<file>` and `<mirror>/<slug>/<file>` beside each JSON copy, under the same skip and fail rules as the JSON. The artefact digest covers the JSON bytes only.
- **The production hook** (`src/output.ts`, called from `saveThroughSeam` in `src/batch.ts`): `locateLeadFigure(wire, customId)` runs `extractFigureViaVlm` with the request's `figure_request.label` as the pinned figure and the `.focus.md` image override as today, decodes the result's data URL to bytes, and returns `provenance: 'vlm-crop'`, the page, and the caption and alt text from the override or the result. It replaces `attachFigureImage`, which is deleted.
- **`recreated_figure` is never written**, whatever `FIGURE_RECREATE` or a `.focus.md` recreate directive says: the recreation call is not made from the save path. W8 brings it back as a v2 `Chart`. `src/figure-data.ts` is unchanged.
- **The smoke.** `scripts/smoke-contract.ts <wire.json> [--detected]` runs the seam offline on a wire fixture with a stub figure hook returning a tiny fixed JPEG, writes into a temporary directory, prints the saved artefact, and prints `repair attempts: <n>`; with `--detected` the stamp context carries a fixed detected citation.

## Objective

A saved explainer's lead figure is an image file beside its JSON, named by the paper's label and recorded in `lead_figure` with its hash and size, copied wherever the JSON is copied, and no artefact carries image bytes or a `recreated_figure`.

## Inputs (read these in your own context)

- `src/finalize.ts` (the seam as cards 46 and 49 left it), `src/output.ts` (`persistArtefact`, `attachFigureImage` and its helpers), `src/batch.ts` (`saveThroughSeam`)
- `src/figure-locator/asset.ts` (`assetFileName`, `sniffImageType`, `imageSize`) and `src/figure-locator/label.ts` (`parseLabel`), read only
- `src/figure-vlm.ts` (`extractFigureViaVlm`, `VlmFigureResult`), read only
- `docs/design/content-contract-v2.md`: Q5, D6; `docs/FIGURE-EXTRACTION.md`
- `tests/contract/50-the-lead-figure-is-a-sidecar-asset.test.ts` (frozen) and this card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

Every file listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to the repo root.

1. `src/finalize.ts`: the `figure` hook, its checkpoint and the `lead_figure` stamp.
2. `src/output.ts`: `persistArtefact` writes and copies the sidecar; `locateLeadFigure` replaces `attachFigureImage`; no code path writes `recreated_figure` or a `data:image` string into an artefact.
3. `src/batch.ts`: `saveThroughSeam` passes `figure: (wire) => locateLeadFigure(wire, customId)`.
4. `scripts/smoke-contract.ts` (new), as above.
5. `tests/unit/`: tests for the sidecar naming, the copies and a hook failure.
6. `docs/FIGURE-EXTRACTION.md`: a section on the sidecar (where the file goes, how it is named, what `lead_figure` records); the base64 description is marked superseded (W7 removes it).
7. `CLAUDE.md`: the `Output post-processing` note describes the seam's order with the figure hook and the sidecar.

## Constraints

- `contract/`, `skill.md`, `src/figure-vlm.ts`, `src/figure-data.ts`, `src/figure-locator/` and `src/types/explainer-json.ts` are unchanged.
- Every frozen contract passes unedited.
- No network and no paid API calls in any test or in the smoke; the production hook is never called by a test.
- Do not create or modify files outside the deliverables, except this card's run state. What the frozen tests and the smoke do themselves under the system temporary directory is not a breach.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: the Claude Opus 5.5 verifier through the Claude CLI, no network needed.

Baseline: recorded under `## Contract test`.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 tests/contract/50-the-lead-figure-is-a-sidecar-asset.test.ts` exits 0.
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 $(ls tests/contract/*.test.ts | grep -v -e '/26-' -e '/27-' -e '/28-')` exits 0. Contracts 26 to 28 read held PDFs under `input/_held/`, which a run worktree does not have; contracts 39 and 42 find them through the sibling `../explainer-batch` checkout.
3. **Types (verifier):** `npx tsc --noEmit` exits 0.
4. **Unit suite (verifier):** `npm test` exits 0.
5. **Smoke (verifier):** `npx ts-node scripts/smoke-contract.ts tests/unit/fixtures/v2/alenezi-agentic-ai-architecture.model-output.json --detected` prints an artefact whose `references[0].origin` is `detected` and whose `lead_figure.asset` ends in `.jpg`, and `repair attempts: 0`; the same command without `--detected` prints `origin` `model`; neither output contains `data:image` or `recreated_figure`.
6. **A run would be complete (verifier, judgement):** read `saveThroughSeam`, `locateLeadFigure` and the seam's figure step. A real batch or sync run now writes an `ExplainerV2` with `lead_figure` and its sidecar beside every copy of the JSON, or records why there is none. Name anything that would still write v1 or base64.
7. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/50-the-lead-figure-is-a-sidecar-asset.test.ts` prints the digest recorded below, and `git diff dev -- tests/contract` is empty.
8. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state.

## Contract test

- **Test file:** `tests/contract/50-the-lead-figure-is-a-sidecar-asset.test.ts`
- **Assertions digest:** `PENDING`
- **Oracle proof:** PENDING

## Out of scope

- The deterministic locator ladder and `FIGURE_LOCATOR`: figure-locator W8.
- `scripts/reextract-figure.ts`: W7. Recreation as a v2 `Chart`: W8.
- Rewriting the archives: W9.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** card 46 (the seam) and card 42 (figure plumbing): about 2.5M tokens for the stage.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The `git diff` of `src/finalize.ts` and `src/output.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to a frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls and write nothing outside the worktree beyond what the frozen tests and the smoke write under the system temporary directory.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** PENDING
