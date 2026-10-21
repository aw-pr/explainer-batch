# Stage card 27-page-geometry-and-region-rule: code measures the figure body beside its caption from the text layer, a 50 dpi ink map and the embedded image boxes

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/27-page-geometry-and-region-rule
- **Worker effort:** high
- **Verifier effort:** high
- **Gate:** stage-completed: 26-caption-index-and-label-parser
- **Verifier panel:** false
- **Path claims:** src/figure-locator/geometry.ts, src/figure-locator/region.ts, src/figure-locator/checks.ts, scripts/figure-region.ts, tests/unit/figure-region.test.ts, tests/fixtures/figure-locator/region/
- **Pairing rationale:** The nine-step region rule is the hardest geometry in the redesign but it is fully specified, measured on the three held pages and pinned by the frozen test within 6 points, so the default OpenAI coding tier at high effort writes it; no frontier tier is needed. The verifier is Claude Opus 5.5 from the other family, at high effort, because judging the unit test's coverage of the rule and re-running poppler against the held pages is careful reading. Worker families alternate along the chain (26 and 28 have Claude workers). Gated on 26 because `locateRegion` reads its caption index; the path claims are new files only and do not overlap any other tranche-1 card.
- **Open decisions:** none

## Surfacing concern

Wave 2 of the figure redesign, card W2 of `docs/design/figure-locator.md` (`### W2. page-geometry-and-region-rule`; the rules are `### Extents: what each tool reports`, `### Region rule (Q4)` and `### Rotation`). Today a vision model guesses a bounding box as page fractions twice (`selectionPrompt`, `src/figure-vlm.ts:184-209`, `:201`; `refineBboxOnPage`, `:515-552`, `:527`), and the pad ladder and full-width fallback (`CROP_PAD_STEPS` `:130`, `:674-677`) exist to repair those guesses (design D5, D6, D9). This card replaces the guess with measurement: the caption block from card 26, `pdftotext -bbox-layout` blocks for the page, a `pdftoppm -gray -r 50` ink map and `pdftohtml -xml -zoom 1` image boxes. It does not crop (card 28) and nothing calls it from the pipeline until W8. Lines re-checked against `dev` at `77909f6` on 2026-10-21.

"Moved from `src/figure-vlm.ts`" in the design means the new module owns its own implementation of `pageSizePts`, `pageCount`, `renderPdfPage` and `looksBlank`; the legacy module keeps its private copies, unedited, until W10 deletes it. That keeps this card's claims disjoint from the legacy path.

Cold read: see the note at the end of `## Family-specific notes`.

## Objective

`locateRegion(pdfPath, label)` returns the figure body's region in points for a labelled caption, its provenance (`pdf-embedded` when one embedded image is the whole drawing, otherwise `pdf-vector-crop`), the box to crop, the coverage that decided it, and the candidates when the body is ambiguous, or a named stop reason. `npx ts-node scripts/figure-region.ts ../explainer-batch/input/_held/2410.15332v3.pdf "Figure 4"` prints page 5 and a region within 6 points of 54,69 to 541,280; `w35275.pdf "Figure 1"` gives page 5 and about 128,95 to 488,282; `flyvbjerg-it-cost-risk.pdf "Figure 3"` gives page 9, the framed region about 32,67 to 554,314, provenance `pdf-embedded`, crop box 114,78 to 474,305 and coverage about 100 percent of the content extents.

## Inputs (read these in your own context)

- `docs/design/figure-locator.md` (`### Extents: what each tool reports` through `### Rotation`, `### Stop rules`, `### W2. page-geometry-and-region-rule`)
- The label and caption modules card 26 creates, src/figure-locator/label.ts and src/figure-locator/captions.ts (they do not exist on `dev` until card 26 lands; `buildCaptionIndex`, `selectCaption`, `matchCaption`)
- `src/figure-vlm.ts` (lines 286-306 and 463-512 only: `looksBlank`, `pngSizePx`, `pageSizePts`, `pageCount`, `renderPdfPage`; read, do not edit)
- `tests/contract/27-page-geometry-and-region-rule.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root. Rectangles are `Rect { x0, y0, x1, y1 }` in points, origin top left, in the page's displayed (rotated) frame.

1. `src/figure-locator/geometry.ts` (new), exporting `Rect`, `GreyMap { width; height; data: Uint8Array }`, and:
   - `pageSizePts(pdfPath, page): { w, h } | null` from `pdfinfo -f P -l P`, swapping width and height for `rot` 90 or 270; never from `<page width height>` of `pdftotext`.
   - `pageCount(pdfPath): number | null`, `renderPdfPage(pdfPath, page, widthPx, outDir): string | null` (same behaviour as the legacy ones).
   - `parsePgm(buf: Buffer): GreyMap` (binary `P5`, header tokens may be separated by any whitespace; no dependency) and `renderGrey(pdfPath, page, dpi = 50): GreyMap` (`pdftoppm -gray -r <dpi>` into a temporary directory that is removed afterwards).
   - `imageBoxes(pdfPath, page): Rect[]` from `pdftohtml -xml -zoom 1 -f P -l P <pdf> <tmpdir>/out`, always with a temporary output path (run without one it writes image files next to the source PDF), the directory removed afterwards.
2. `src/figure-locator/region.ts` (new), exporting `pageBlocks(pdfPath, page)` (blocks with box, line count, word count and text), a pure `regionOnPage(...)` that takes the page size, blocks, grey map, image boxes and the caption entry (so the unit test runs it on snapshots with no poppler), and `locateRegion(pdfPath, label: string | LabelKey, opts?: { pageHint?: number; forceRegionCrop?: boolean; index?: CaptionEntry[] })` returning either
   `{ ok: true, label, page, captionBox, region, cropBox, contentBox, coverage, provenance: 'pdf-embedded' | 'pdf-vector-crop', candidates: Rect[], ambiguous: boolean, notes: string[] }` or
   `{ ok: false, reason: 'label-not-found' | 'region-too-small' | 'source-unavailable', labels?: string[], notes: string[] }`.
   The rule is the design's nine steps, with these readings, each confirmed by the reference against the held pages:
   - **Classification:** a caption block is any block `matchCaption` accepts; a header or footer is a one-line block within the top or bottom 8 percent of the page height; a body-text block has at least three lines, or two lines and twelve words, and a width of at least 60 percent of its column; everything else is in-figure text. Prose-like blocks are the non-caption blocks that pass the line and word test and are at least 25 percent of the page width; they are clustered into columns by x overlap (any overlap merges, so a full-width prose block makes the page one column). The text width runs from the first column's left to the last column's right; with no prose-like block, the text width is the whole page and there is one column.
   - **Range:** a caption wider than 60 percent of the text width uses the text width, otherwise the column containing its centre.
   - **Stoppers** are body-text, caption (other than this one), header and footer blocks, each treated as 3 points taller at top and bottom, because glyph ink at 50 dpi reaches past the word boxes (without the margin, `w35275.pdf`'s Notes block leaks into Figure 1 as a second band).
   - **Scan** starts 3 points beyond the caption's own edge, looks above first (figure above when ink within 40 points is not a stopper), else below; it extends across ink rows (any pixel under 200 within the range) until a stopper, the page edge or a 40-point gap. Bands separated by more than 12 and less than 40 points are separate candidates.
   - **Rules and frames:** a run of rows at most 2 points tall whose ink covers at least 80 percent of the range, with the rows directly before and after it carrying under 20 percent ink (that is, an isolated line, not a dense row of figure content), is a rule. A rule whose end columns carry ink on the adjacent rows is a frame and is kept as content; any other rule stops the scan.
   - **Region:** the ink extents within the span, intersected with the range, unioned with every image box that lies within the range and overlaps the span vertically by at least half its own height (EPIC's heatmap strip ends at 276 points, below the last ink row at 272), padded 4 points and clamped to the page.
   - **Content extents and coverage:** the ink bounding box inside the span before the pad; when a frame was kept, the ink inside the frame with a 2-pixel inset. `coverage` is the largest in-span image box's intersection with the content extents over the content area, 0 with no image. Exactly one in-span image box with coverage of at least 0.9, and `forceRegionCrop` not set, gives `pdf-embedded` with `cropBox` the image box; otherwise `pdf-vector-crop` with `cropBox` equal to `region`.
   - **Ambiguity:** more than one band gives `ambiguous: true` and `candidates` each band's padded extents in scan order (nearest the caption first, at most five) followed by the union of all bands, so at most six, and `region` is that union; one band gives `candidates: [region]`.
   - **Stops:** a label `selectCaption` cannot find gives `label-not-found` with its `labels`; a missing PDF, or a poppler command that fails or returns nothing parseable on an existing one, gives `source-unavailable`; no ink beside the caption, or a region under 60 by 40 points, gives `region-too-small`. `selectCaption`'s notes are carried into `notes`.
3. `src/figure-locator/checks.ts` (new): `looksBlank(file: string, size: { w: number; h: number } | null): boolean`, the legacy thresholds (a side under 48 pixels, or under 0.006 bytes per pixel, is blank).
4. `scripts/figure-region.ts` (new): `figure-region.ts <pdf> "<label>" [--force-region-crop]` prints the `locateRegion` result as one JSON line and exits 0 when `ok`, 1 on a stop, 2 on a usage error.
5. `tests/unit/figure-region.test.ts` (new): runs `regionOnPage` offline on the snapshots below, including the rotated page whose displayed size is 792 by 612, where a figure placed past 612 points in the displayed frame comes back with `region.x1` above 612 (the frozen test checks rotation only for page size and rendering, so this unit case is the region-level check); also covers PGM headers with arbitrary whitespace and a usage error exiting 2.
6. `tests/fixtures/figure-locator/region/` (new; this card's path supersedes the design's `tests/fixtures/figure-locator/{w35275,...}/`, which would collide with card 26's and card 28's fixtures, and its JSON snapshots supersede the design's "XML snapshots"): per case (`w35275`, `hu-2410.15332v3`, `flyvbjerg`, `rotated`) the caption page's blocks, the 50 dpi ink map as JSON (for example the ink runs per row) and the `pdftohtml` image boxes; text and JSON only, no PDF and no image. The rotated case comes from a one-page PDF with `/Rotate 90` written for the test.

## Constraints

- `src/figure-vlm.ts` and every other existing file are unchanged; nothing imports the new modules from the pipeline. The new modules must not import `src/figure-vlm.ts`.
- No new dependencies; poppler only (`pdfinfo`, `pdftotext`, `pdftoppm`, `pdftohtml`), no `pdftocairo -svg`, no pdf.js, no `sips`, no `sharp`.
- No poppler call writes next to a source PDF; every temporary directory is removed.
- Card 26's modules keep passing their frozen test unchanged.
- No network, no paid API calls, no vision calls.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a `node_modules` clone made as `## Family-specific notes` describes.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root, which sits beside the main checkout, so `../explainer-batch/input/_held/` holds the three PDFs. Seat for every criterion: Claude Opus 5.5 verifier through the Claude CLI, unsandboxed, no network; poppler 26.07 is on `PATH`.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/27-page-geometry-and-region-rule.test.ts` exits 0 (11 tests: displayed page size under rotation, PGM parsing and a rotated render, image boxes without writing beside the PDF, the three held regions within 6 points with their provenance, coverage and crop box, forced region crop, the three stop reasons, two stacked bands as ambiguous candidates plus their union, `looksBlank`, the CLI, and the legacy module untouched). Baseline on `dev`: red, 11 of 11 fail (first: `src/figure-locator/geometry.ts does not exist`).
2. **Card 26 still holds (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/26-caption-index-and-label-parser.test.ts` exits 0. Baseline: green once card 26 has landed.
3. **CLI (verifier):** `npx ts-node scripts/figure-region.ts ../explainer-batch/input/_held/flyvbjerg-it-cost-risk.pdf "Figure 3"` prints JSON with `"page":9` and `"provenance":"pdf-embedded"`. Baseline on `dev`: red (no script).
4. **Unit test (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/figure-region.test.ts` exits 0 and runs no poppler command (it reads only `tests/fixtures/figure-locator/region/`). Baseline on `dev`: red (no file).
5. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green.
6. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
7. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/27-page-geometry-and-region-rule.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
8. **Clean tree (verifier):** `git diff --check dev...HEAD` passes, `git diff --name-only dev...HEAD` lists only deliverables (this is also the evidence that `src/figure-vlm.ts` is unchanged), and `git status --porcelain` prints nothing, so no uncommitted or untracked change is left behind. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/27-page-geometry-and-region-rule.test.ts`
- **Assertions digest:** `sha256:6d77ec82dcb68c1f2b3fe244e5ff7311e3bf8a6b487e81726a1f781c4516ebe3`
- **Oracle proof:** On `dev` (`77909f6`) all 11 tests fail because the three modules do not exist. A throwaway reference (about 250 lines of geometry and region code plus a 9-line CLI), stacked on the card 26 reference in a detached scratch worktree, passed all 11, card 26's test still passed, and `tsc --noEmit` was clean; the worktree was removed and pruned. Its results: EPIC 54,69 to 545,280 (coverage 0.23, vector crop), `w35275` 128,95 to 489,283, Flyvbjerg 33,66 to 555,314 with crop box 114,78 to 474,305 and coverage 1.00. Four traps it met are written into Deliverable 2 as readings of the rule: the 3-point stopper margin, the isolation test that separates a rule from a dense figure row (EPIC page 5 has twelve rows over 80 percent ink inside its figure), image boxes taken by vertical overlap rather than containment, and starting the scan 3 points off the caption. The held PDFs are gitignored; the test looks in `$EXPLAINER_HELD_DIR`, then `input/_held/`, then `../explainer-batch/input/_held/`.

## Out of scope

- The 300 dpi crop, the sidecar asset file, header readers and naming (card 28).
- The vision picker for ambiguous candidates (W7), arXiv source (W5), HTML figures (W6), the ladder and pipeline wiring (W8), the evaluation harness (W9).
- Any edit to `src/figure-vlm.ts`, `src/output.ts` or `src/preprocess.ts`.

## Budget

- **Worker wall-clock:** 90 minutes
- **Verifier wall-clock:** 40 minutes
- **Spend basis:** wave-1 medians in this repo's `state/cost-log.jsonl`: about 0.8M tokens per stage, p95 2.1M. Expect above the median, near the p95: the region rule is tuned against three real pages and a synthetic set.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The three held-page results from the CLI (region, crop box, coverage, provenance).
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 6 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; poppler reads the held PDFs outside the worktree, which the sandbox permits, and every temporary file goes under the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21. Raised and folded in: how columns are clustered and the no-prose fallback, which candidates survive the six cap, poppler failure on an existing PDF, the region-level rotated check (now a unit-test requirement), temporary-directory cleanup and PGM whitespace (Deliverables 1 and 5), the fixture path and format superseding the design's, and the clean-tree criterion now checking `git status --porcelain` and standing as the evidence that the legacy module is unchanged.
