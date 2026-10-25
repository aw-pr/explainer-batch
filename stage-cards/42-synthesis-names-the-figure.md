# Stage card 42-synthesis-names-the-figure: the synthesis model names the lead figure in `figure_request`, and a locator skeleton finds it in the PDF with no vision call

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/42-synthesis-names-the-figure
- **Worker effort:** high
- **Verifier effort:** high
- **Gate:** stage-completed: 41-html-figures-and-dom-dedupe
- **Dispatch:** serial
- **Verifier panel:** false
- **Path claims:** skill.md, src/prompt.ts, src/preprocess.ts, src/figure-locator/request.ts, src/figure-locator/index.ts
- **Pairing rationale:** A production-prompt edit (`skill.md` is the system prompt verbatim) that must keep two frozen wave-1 tests' sentences, a directive parser, and a request builder and ladder skeleton over the landed locator modules, all specified to the sentence and pinned by a frozen test: the OpenAI coding tier at high effort fits and keeps Codex effort capped at high. The verifier is a strong Claude from the other family at high effort, because the prompt wording and the precedence rules are judgement-heavy to check. Gated on card 41 and serial because both edit `src/preprocess.ts`. Worker families alternate (card 41 has a Claude worker).
- **Open decisions:** none

## Surfacing concern

Wave 2 of the figure redesign, card W4 of `docs/design/figure-locator.md` (`### W4. synthesis-names-the-figure`; the rules are `## Synthesis names the figure`, `### Inputs`, `### The ladder`, `### Stop rules` and Q7, Q8 and Q16). Today the synthesis model is told never to name a figure (`skill.md:58`, `:186`, `:218`, the checklist at `:268`, and `src/prompt.ts:25`), and a vision model that has not read the paper chooses one from thumbnails (design D1, D3). This card turns the choice round: the prompt asks for `figure_request {label, why}` (stage 16's wire field, `contract/explainer-v2.ts:235-239`), `image_raster:` becomes a recognised directive, `src/figure-locator/request.ts` builds the locator's request with the design's precedence (`image:`, then `recreate:`, then `figure_request`), and `src/figure-locator/index.ts` is the ladder skeleton with the PDF step only. Stage 16 W5 (the generated `skill.md` schema block) has not landed, so the three paragraphs and the shape entry are edited directly, as the design allows. Lines re-checked against `dev` at `8bb4372` on 2026-10-21.

**What a production run sees between this card and stage 16 W6.** The legacy figure path is unchanged and still chooses the figure itself: `attachFigureImage` (`src/output.ts:262-333`) never reads `figure_request`, and it replaces or deletes whatever `image` block the model wrote (`:300-317`), so no figure is lost. The providers still send the v1 schema (`src/schema/explainer-schema.ts:181-194`, outside this card): on the OpenAI strict route the model cannot emit `figure_request` and emits `image: null` as before; on the Claude forced-tool route the schema is permissive (`src/providers.ts:155-158`), so a `figure_request` key may reach the saved v1 JSON as an extra top-level key, which promo-flow's v1 reader ignores (`normalizeSidecarJson` reads named fields only) and which nothing in explainer-batch reads until W8. The prompt change takes effect on the deterministic path only when W8 wires `locateFigure` in and stage 16 W6 sends the v2 dialect. Wiring the pin sentence from `src/batch.ts` into `buildUserInstruction` is W8's (batch.ts is not in this card's claims); this card adds the optional parameter.

**Prerequisite re-freeze (orchestrator, before dispatch).** Frozen `tests/contract/11-figure-directives-and-pdf-urls-are-honoured.test.ts` uses `image_raster: true` as its example of an unknown `image_*` key that must warn. This card makes `image_raster` a recognised directive, so the orchestrator re-freezes that one case to use `image_size: large` (two lines, the assertion unchanged in intent; new digest `sha256:2e1599c292bf9f45cbcab34f02f64daf7b383c644e6a0bcd6e4057a16e22693d`, written onto card 11) in the commit that queues this card. The re-frozen test passes on `dev` (12 of 12) and on this card's reference.

Cold read: see the note at the end of `## Family-specific notes`.

## Objective

`skill.md` and `src/prompt.ts` ask the synthesis model for `figure_request {label, why}` or null and still forbid an `image` block; `parseFocusDirectives` recognises `image_raster:`; `buildFigureRequest` turns a model output and the sidecar directives into one `FigureRequest` (pin precedence, page hint, overrides, forced region crop, arXiv id); `locateFigure` runs the PDF step and returns the located crop or a named stop. A model output naming Figure 3 of `w35275.pdf` locates page 12 with zero vision calls, and a pinned Figure 14 stops with `pin-not-found` and the 17 labels the caption index found.

## Inputs (read these in your own context)

- `docs/design/figure-locator.md` (`## Synthesis names the figure`, `### Inputs`, `### The ladder`, `### Stop rules`, `### W4. synthesis-names-the-figure`)
- `skill.md` (lines 40-62, 180-222 and 255-275 only), `src/prompt.ts`, and `src/preprocess.ts` (lines 46-150 only: `ImageOverride`, `parseFocusDirectives`)
- `src/figure-locator/label.ts`, `captions.ts`, `region.ts`, `pdf-crop.ts` and `asset.ts` (landed by cards 26 to 28; use `parseLabel`, `labelsEqual`, `buildCaptionIndex`, `selectCaption`, `locateRegion`, `cropPdfRegion`, `renderDpiFor`, `embeddedImagePpi`, `sniffImageType`)
- `src/state.ts` (`FigureCandidate`, `RecreateDirective`)
- `tests/contract/42-synthesis-names-the-figure.test.ts` (frozen), and `tests/contract/02`, `11`, `12` and `14` (frozen; the sentences and directive cases they pin)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract tests, which already exist and must not be edited. Paths are relative to repo root.

1. `skill.md`, four direct edits and nothing else:
   - Line 58, the `"image":    <NEVER emit; ...>` entry of the output shape, becomes `"figure_request": { "label": "Figure 3", "why": "<one plain sentence: what the figure shows and why a reader should see it>" } or null,`. No `"image":` key remains in the shape.
   - The paragraph at line 186 ("When the paper contains figures ...") is rewritten to say: read every figure; name the one the explainer should show in `figure_request.label`, using the paper's own numbering and noun (`Figure 3`, `Table 2`, `Figure 4b`); prefer the paper's key results figure, the one carrying its headline finding, and only when it has none, its central architecture, pipeline or framework diagram; write `why` as one plain sentence; set `figure_request` to null when no figure would help; the pipeline finds and attaches the named figure. It contains the sentence `Figures are never a source of chart values.` and keeps the existing sentence about `recreated_figure`. It no longer says a vision model picks the figure.
   - The paragraph at line 218 begins `**Do not emit an `image` field or any image bytes; name the figure in `figure_request` and the pipeline locates and attaches it.**` and drops the sentence about a vision model auto-picking; it may say that a sidecar can pin a figure, in which case the instruction names it.
   - The checklist line at 268 becomes `- [ ] `figure_request` names one figure by the paper's own label, or is null.`
   - Afterwards `grep -n 'NEVER emit' skill.md` prints nothing, no sentence in `skill.md` matches `vision model picks` or `vision model auto-picks`, and every sentence frozen `tests/contract/02` and `14` require is still present.
2. `src/prompt.ts`: `buildUserInstruction(expectedDate, focusHint?, pinnedFigure?)`. In the base instruction, the sentence `Never emit an `image` block, because the figure pipeline attaches the figure.` becomes `Name the lead figure in `figure_request` (its label as the paper prints it and a one-sentence why), or set it to null. Never emit an `image` block: the figure pipeline locates and attaches the figure.` (the second sentence keeps frozen test 12's `never emit ... `image`` and `figure pipeline` matches). When `pinnedFigure` is given, the base instruction ends with `A sidecar pins <pinnedFigure> as the lead figure; set `figure_request.label` to it and write `why` for it.`, before the emphasis block; without it the output is unchanged from a call with `undefined`. Every other sentence is unchanged.
3. `src/preprocess.ts`: `ImageOverride` gains `forceRegionCrop?: boolean`. `parseFocusDirectives` recognises `image_raster: <value>` (also `image-raster`), with no warning: `true`, `yes`, `1` or `on` (any case) set `forceRegionCrop: true`, any other value sets `false`; like every image key it creates the `imageOverride`, and the line never reaches the focus hint. Other unknown `image_*` keys still warn.
4. `src/figure-locator/request.ts` (new), exporting:
   - `interface FigureRequest { label?: LabelKey; pinned: boolean; why?: string; pageHint?: number; captionOverride?: string; altOverride?: string; forceRegionCrop: boolean; source: { pdfPath?: string; url?: string; arxivId?: string; snapshot?: FigureCandidate[] } }` (the design's `### Inputs`).
   - `detectArxivId({ url?, referenceUrl?, sourceRef?, firstPageText? }): string | null`: the first of `url`, `referenceUrl`, `sourceRef` that is an `arxiv.org/abs|pdf|html/<id>` URL (`http` or `https`, optional `www.`; `<id>` is `\d{4}\.\d{4,5}` with an optional `v<n>`, and a trailing `.pdf` is not part of it); otherwise `arXiv:(\d{4}\.\d{4,5})(v\d+)?` in `firstPageText`, version kept; otherwise `null`. Only `arxiv.org` URLs count.
   - `buildFigureRequest({ output?, override?, recreate?, source })`: `output` is the model's JSON (v1 or v2, any shape). The label is, in order: `override.source_figure` (pinned); `recreate.target` when `recreate.enabled` (pinned); `output.figure_request.label` (not pinned), each through `parseLabel`, an unparseable one counting as absent. `why` is `output.figure_request.why` only when that request's label is equal (`labelsEqual`) to the chosen label; otherwise there is no `why` key. `pageHint`, `captionOverride` (from `override.caption`), `altOverride` (from `override.alt_text`) are copied when present; `forceRegionCrop` is `override.forceRegionCrop === true`. `source` is the given source plus `arxivId` from `detectArxivId` over `source.url`, the first reference's URL (the `href` of a v1 HTML string, or `.url` of a v2 object) and `output.metadata.source.ref`, then, when none matched and `source.pdfPath` is set, the first page's text (`pdftotext -f 1 -l 1 <pdf> -`). Absent values are absent keys, not `undefined`.
5. `src/figure-locator/index.ts` (new), exporting `LocatedFigure` and `NoFigure` (the design's shapes: `LocatedFigure { ok: true; label; captionText?; page?; regionPt?; bytes; ext; width?; height?; provenance; calls: { picker, verify }; notes }`, `NoFigure { ok: false; reason; labels?; notes }`) and `locateFigure(request): Promise<LocatedFigure | NoFigure>`, the skeleton with the PDF step only:
   1. No `label` gives `no-request`.
   2. No `source.pdfPath` gives `source-unavailable` (the arXiv, HTML and picker steps are W8's).
   3. The caption index is built once with `buildCaptionIndex` and passed to `locateRegion(pdfPath, label, { pageHint, forceRegionCrop, index })`. A `label-not-found` stop becomes `pin-not-found` when the request is pinned (`labels` carried over); `region-too-small` and `source-unavailable` pass through.
   4. The region's `cropBox` is cut with `cropPdfRegion` at `renderDpiFor(provenance, embeddedImagePpi(...))` (the ppi only for `pdf-embedded`); a failed crop gives `source-unavailable`. An ambiguous region takes the union region `locateRegion` already returns as `cropBox`, with a note; there is no picker call.
   5. Success returns the located caption's own label (with the request's panel added when it had one), the caption entry's `text` as `captionText`, `page`, `regionPt` (the `cropBox`), the JPEG bytes with `ext`, `width` and `height`, the region's `provenance`, and `calls: { picker: 0, verify: 0 }`.

## Constraints

- The legacy figure path is unchanged: `src/figure-vlm.ts`, `src/output.ts`, `src/batch.ts`, `src/schema/explainer-schema.ts`, `src/vision.ts` and `contract/` are not edited, and nothing in the pipeline calls the new modules yet.
- The new modules make no vision call, no network call and do not import `src/figure-vlm.ts`.
- Every frozen contract test from wave 1 and tranche 1 passes unchanged, except `tests/contract/11`, which the orchestrator re-freezes before dispatch as `## Surfacing concern` says; the worker edits none of them.
- `skill.md` is production prompt text: change only the four places in Deliverable 1, no em dashes, British English.
- Do not create or modify files outside the deliverables, except this card's run state and a `node_modules` clone made as `## Family-specific notes` describes.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root, which sits beside the main checkout, so `../explainer-batch/input/_held/` holds the held PDFs. Seat for every criterion: Claude Opus 5.5 verifier through the Claude CLI, no network; poppler 26.07 is on `PATH`.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/42-synthesis-names-the-figure.test.ts` exits 0 (10 tests: exports, arXiv id detection, label precedence and `why`, source and arXiv id from the EPIC PDF and both reference shapes, Figure 3 of `w35275.pdf` on page 12 with zero vision calls, the four stops and an ignored page hint, `image_raster:` and the forced region crop on Flyvbjerg Figure 3, the `skill.md` wording, the user instruction and its pin sentence, and no vision, network or legacy import). Baseline on `dev`: red, 10 of 10 fail (first: `src/figure-locator/request.ts does not exist`).
2. **Every frozen contract test (verifier):** `for f in tests/contract/*.test.ts; do TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test "$f" || echo "FAILED $f"; done` prints no `FAILED` line (cards 01 to 32 and 39 to 41 as landed, with card 11 re-frozen; `tests/contract/41`'s live case may skip). Baseline on `dev` with card 11 re-frozen and cards 39 to 41 landed: every file green except `tests/contract/42` itself (red, criterion 1).
3. **No NEVER emit (verifier):** `grep -n 'NEVER emit' skill.md` prints nothing and exits 1. Baseline on `dev`: red (line 58).
4. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green (125 of 125).
5. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/42-synthesis-names-the-figure.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`; the worker leaves its changes uncommitted, so this lists the whole diff against the base (and is also the evidence that the legacy path's files are unchanged). Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/42-synthesis-names-the-figure.test.ts`
- **Assertions digest:** `sha256:1dff820825ecc04d2bc09d4ee3e0736b7686262dd5d9931b56ad6437e0800d26`
- **Oracle proof:** On `dev` (`8bb4372`) all 10 tests fail because `src/figure-locator/request.ts` and `index.ts` do not exist. A throwaway reference (about 50 lines for `request.ts`, 50 for `index.ts`, the four `skill.md` edits, two `prompt.ts` lines and five `preprocess.ts` lines), stacked on the card 39 to 41 references in a detached scratch worktree, passed all 10; `tsc --noEmit` was clean and `npm test` passed 125 of 125. Every other contract test passed on it except `tests/contract/11`'s `image_raster` case, which is the re-freeze in `## Surfacing concern`; with that case re-frozen, card 11 passed 12 of 12 on the reference and on `dev`. The worktree was removed and pruned. Its Figure 3 crop of `w35275.pdf` page 12 came from the region 74,94 to 538,152 points.

## Out of scope

- The arXiv, HTML and picker steps of the ladder, wiring `locateFigure` into `attachFigureImage`, composing the displayed caption, and passing `pinnedFigure` from `src/batch.ts` (W8).
- The v2 schema dialect the providers send and the generated `skill.md` block (stage 16 W5 and W6).
- Any edit to `src/figure-vlm.ts`, `src/output.ts`, `src/batch.ts`, `src/schema/`, `src/vision.ts` or `contract/`.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 35 minutes
- **Spend basis:** wave-2 tranche-1 figure cards in this repo's `state/cost-log.jsonl` (cards 26 to 28): 0.76M to 1.96M tokens per stage. Expect the middle of that range: two small modules over landed code plus exact prompt edits.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The `git diff` of `skill.md` and `src/prompt.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to a frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; poppler reads the held PDFs outside the worktree, which the sandbox permits, and the tests write only under the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21 and had no questions before starting. Raised and folded in: criterion 2's baseline now excludes this card's own test, and the clean-tree evidence is stated as the uncommitted diff. It also listed rules the frozen test does not exercise (an unparseable pin falling through, panel preservation, the ambiguous-region note, the `image-raster` spelling); they stay specified in Deliverables 3 to 5 for the verifier's reading. It confirmed the card 11 re-freeze is the orchestrator's prerequisite, not the worker's.
