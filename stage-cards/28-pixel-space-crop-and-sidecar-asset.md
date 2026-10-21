# Stage card 28-pixel-space-crop-and-sidecar-asset: a located figure becomes a JPEG file cut in the page's own pixel space, with its hash, size, page and provenance

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/28-pixel-space-crop-and-sidecar-asset
- **Worker effort:** high
- **Verifier effort:** high
- **Gate:** stage-completed: 27-page-geometry-and-region-rule
- **Verifier panel:** false
- **Path claims:** src/figure-locator/pdf-crop.ts, src/figure-locator/asset.ts, scripts/figure-crop.ts, tests/unit/figure-asset.test.ts, tests/fixtures/figure-locator/headers/
- **Pairing rationale:** Binary header parsing for five formats, a rotation-aware pixel transform and the record that stage 16 W6 will stamp as `lead_figure`: byte-level work where one off-by-one breaks a format, so a strong Claude worker at high effort, without the frontier tier the design itself does not need. The verifier is the cheap OpenAI tier from the other family, at high effort to re-run the crops against the held PDFs. Worker families alternate along the chain (27 has an OpenAI worker). Gated on 27 because the CLI crops the box `locateRegion` returns; the path claims are new files only and do not overlap any other tranche-1 card.
- **Open decisions:** none

## Surfacing concern

Wave 2 of the figure redesign, card W3 of `docs/design/figure-locator.md` (`### W3. pixel-space-crop-and-sidecar-asset`; the rules are `### The 300 dpi crop in the page's own pixel space` and `### The sidecar asset`). Today the crop is converted from model-guessed fractions (`cropPdfBboxPng`, `src/figure-vlm.ts:594-617`), re-encoded with macOS `sips` (`encodeJpegDataUrl`, `:569-587`) and written into the JSON as a base64 `data:` URL (`src/output.ts:303-309`), so the pipeline needs macOS and the JSON carries megabytes of image (design D10, D14). This card produces the file and its record only: it cuts the region card 27 located with `pdftoppm -jpeg -r 300 -x -y -W -H` in the rendered page's own pixel space, reads sizes from headers, and writes `<dir>/figure-<n>.jpg`. Stage 16 W6 stamps `lead_figure` from the record; nothing calls this from the pipeline until W8. Lines re-checked against `dev` at `77909f6` on 2026-10-21.

"`pngSizePx` moved" in the design means `asset.ts` owns its own implementation; the legacy module keeps its private copy, unedited, until W10.

Cold read: see the note at the end of `## Family-specific notes`.

## Objective

`npx ts-node scripts/figure-crop.ts ../explainer-batch/input/_held/2410.15332v3.pdf "Figure 4" <dir>` writes `<dir>/figure-4.jpg` of about 2012 by 845 pixels and prints its record (`file`, `asset`, `sha256`, `width`, `height`, `page: 5`, `provenance`, `label`); the Flyvbjerg Figure 3 is the embedded image at 1500 by 946 pixels with provenance `pdf-embedded`; a crop on a `/Rotate 90` page is cut in the 792 by 612 frame; header readers cover PNG, JPEG, GIF and WebP, SVG is sniffed, and no locator file calls `sips`.

## Inputs (read these in your own context)

- `docs/design/figure-locator.md` (`### The 300 dpi crop in the page's own pixel space`, `### The sidecar asset`, `### W3. pixel-space-crop-and-sidecar-asset`)
- The locator modules cards 26 and 27 create under src/figure-locator/ (label.ts, captions.ts, geometry.ts, region.ts; they do not exist on `dev` until those cards land)
- `src/figure-vlm.ts` (lines 463-476 and 569-617 only: `pngSizePx`, `encodeJpegDataUrl`, `cropPdfBboxPng`; read, do not edit)
- `tests/contract/28-pixel-space-crop-and-sidecar-asset.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/figure-locator/asset.ts` (new), exporting:
   - `type AssetExt = 'jpg' | 'png' | 'webp' | 'gif' | 'svg'`.
   - `sniffImageType(buf): AssetExt | null` from magic bytes (PNG signature, JPEG `FF D8 FF`, `GIF87a`/`GIF89a`, `RIFF....WEBP`) or, for SVG, text that starts (after whitespace, an XML declaration, comments or a doctype) with `<svg`; anything else, HTML included, is `null`.
   - `imageSize(buf): { width, height } | null` with no decoding: PNG IHDR; JPEG walks the markers to the first SOFn (skipping DHT `C4`, `C8` and `CC`, which share the range); GIF logical screen; WebP `VP8X` (24-bit canvas size plus one), `VP8L` (14-bit fields plus one; a minimal `VP8L` header is 25 bytes, so do not require more) and lossy `VP8 ` (14-bit frame size). SVG and unknown bytes give `null`.
   - `pngSizePx(file)` (the legacy helper's behaviour, now through `imageSize`).
   - `assetFileName(label: LabelKey | null, ext)`: `figure-3.jpg`, `figure-2b.jpg` for a panel, `table-2.png`, `figure-a1.webp` (noun and number lower-cased), `figure.<ext>` when there is no label or number.
   - `writeAsset(dir, label, bytes, meta: { page?: number; provenance: string; label?: string })`: creates `dir` if missing, writes `<dir>/<assetFileName>` with the extension from `sniffImageType` (throws on unrecognised bytes), and returns `{ file, asset, sha256, width?, height?, page?, provenance, label? }` with `sha256` the hex digest of the bytes and `width`/`height` from the header (absent for SVG); optional fields are absent, not `undefined`-valued keys, when not known.
2. `src/figure-locator/pdf-crop.ts` (new), exporting:
   - `renderDpiFor(provenance, imagePpi?)`: 300, except `pdf-embedded` with a known ppi, which renders at `max(300, ppi)` capped at 600.
   - `embeddedImagePpi(pdfPath, page): number | null`: the x-ppi of the largest `image` row (by pixel count) in `pdfimages -list -f P -l P`; `null` when the page has none.
   - `cropPdfRegion(pdfPath, page, box: Rect, dpi = 300): { bytes, width, height, dpi } | null`: one `pdftoppm -jpeg -jpegopt quality=90 -r <dpi> -f P -l P -x X -y Y -W W -H H` into a temporary directory (removed afterwards), with `X, Y` the box's left and top in points times `dpi/72` rounded down and `W, H` its right and bottom rounded up minus `X, Y`, computed and clamped against the page's displayed size from card 27's `pageSizePts` (so a rotated page is cut in its 792 by 612 frame). Round with a small epsilon (`floor(v + 1e-6)`, `ceil(v - 1e-6)`): `114 * 300 / 72` is 474.99999 in floating point, and a plain floor makes the Flyvbjerg crop 1501 pixels wide instead of 1500. The JPEG is the asset; its size comes from `imageSize`.
3. `scripts/figure-crop.ts` (new): `figure-crop.ts <pdf> "<label>" <out-dir> [--force-region-crop]` runs `locateRegion`, crops its `cropBox` at `renderDpiFor(provenance, embeddedImagePpi(...))`, writes the asset with `writeAsset` and prints the record as one JSON line, exit 0; on a stop it prints the `locateRegion` result as JSON, writes nothing and exits 1; when the region is found but `cropPdfRegion` returns `null` it prints `{"ok":false,"reason":"source-unavailable"}`, writes nothing and exits 1; a usage error exits 2.
4. `tests/unit/figure-asset.test.ts` (new): header readers and sniffing on the committed header fixtures, and the naming rule including `figure-2b.jpg` and `table-2.png`.
5. `tests/fixtures/figure-locator/headers/` (new): tiny hand-made PNG, JPEG, GIF, WebP (`VP8X`, `VP8L` and `VP8 `) and SVG files, each a few dozen bytes, with their sizes in the file name or a `sizes.json`.

## Constraints

- No `sips`, no `sharp`, no PNG round trip, no re-encoding and no size cap: `grep -rn "'sips'" src/figure-locator` prints nothing and exits 1.
- `src/figure-vlm.ts`, `src/output.ts` and every other existing file are unchanged; the new modules do not import `src/figure-vlm.ts`. Stamping `lead_figure` and moving the asset beside the JSON belong to stage 16 W6 and W8, not this card.
- Cards 26 and 27 keep passing their frozen tests unchanged.
- No poppler call writes next to a source PDF; every temporary directory is removed.
- No network, no paid API calls, no vision calls.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a `node_modules` clone made as `## Family-specific notes` describes.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root, which sits beside the main checkout, so `../explainer-batch/input/_held/` holds the three PDFs. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write sandbox, no network; reads of `../explainer-batch/input/_held/` and writes under the OS temp dir are within that sandbox; poppler 26.07 (including `pdfimages`) is on `PATH`.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/28-pixel-space-crop-and-sidecar-asset.test.ts` exits 0 (11 tests: six header cases including a minimal 25-byte `VP8L`, SVG sniffing and rejection, naming, `writeAsset`'s record with absent (not `undefined`) optional keys, render DPI and embedded ppi, the rotated-frame crop, the EPIC and Flyvbjerg crops through the CLI, `--force-region-crop`, a stop that writes nothing, and no `sips`, `sharp` or legacy import). Baseline on `dev`: red, 11 of 11 fail (first: `src/figure-locator/asset.ts does not exist`).
2. **Earlier cards still hold (verifier):** the contract tests for cards 26 and 27 (`tests/contract/26-caption-index-and-label-parser.test.ts`, `tests/contract/27-page-geometry-and-region-rule.test.ts`, same command form) exit 0. Baseline: green once both have landed.
3. **CLI (verifier):** `npx ts-node scripts/figure-crop.ts ../explainer-batch/input/_held/2410.15332v3.pdf "Figure 4" "$TMPDIR/fig28"` exits 0 and writes `$TMPDIR/fig28/figure-4.jpg`, whose printed `width` is between 1950 and 2150 and `height` between 820 and 940 (the band the frozen test uses around the design's 2012 by 845). Baseline on `dev`: red (no script).
4. **No sips (verifier):** `grep -rn "'sips'" src/figure-locator` prints nothing and exits 1. Baseline on `dev`: exits 2 (the directory does not exist yet).
5. **Unit test (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/figure-asset.test.ts` exits 0 and reads only `tests/fixtures/figure-locator/headers/`. Baseline on `dev`: red (no file).
6. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green.
7. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
8. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/28-pixel-space-crop-and-sidecar-asset.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
9. **Clean tree (verifier):** `git diff --check dev...HEAD` passes, `git diff --name-only dev...HEAD` lists only deliverables (this is also the evidence that `src/figure-vlm.ts` is unchanged), and `git status --porcelain` prints nothing, so no uncommitted or untracked change is left behind. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/28-pixel-space-crop-and-sidecar-asset.test.ts`
- **Assertions digest:** `sha256:e54fa2934d2280790c08cae63694a414a0291b57fd714250797915b26ca7705e`
- **Oracle proof:** On `dev` (`77909f6`) all 11 tests fail because `src/figure-locator/asset.ts` and `pdf-crop.ts` do not exist. A throwaway reference (about 140 lines across the two modules and a 15-line CLI), stacked on the card 26 and 27 references in a detached scratch worktree, passed all 11, both earlier contract tests still passed, and `tsc --noEmit` was clean; the worktree was removed and pruned. Its crops: EPIC 2048 by 878 (the region rule's 545-point right edge, within the test's band around the design's 2012 by 845), Flyvbjerg 1500 by 946 at 300 dpi, `w35275` Figure 1 1504 by 784. Two traps it met are written into Deliverables 1 and 2: the 25-byte `VP8L` header and the floating-point rounding of `114 * 300 / 72`. The EPIC strip's raster is 617 ppi (the design's "469-ppi" figure is the page's icons), so `embeddedImagePpi` on EPIC page 5 is 617.

## Out of scope

- Stamping `lead_figure` into the explainer JSON, writing beside `output/`, the website staging directory or the Obsidian mirror (stage 16 W6, W8).
- Fetching web or arXiv assets (W5, W6); the picker (W7); the ladder and pipeline wiring (W8).
- Any edit to `src/figure-vlm.ts`, `src/output.ts`, `src/vision.ts` or `src/figure-data.ts`.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** wave-1 medians in this repo's `state/cost-log.jsonl`: about 0.8M tokens per stage, p95 2.1M. Expect a little above the median: five header formats and a CLI against a fully specified record.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The EPIC and Flyvbjerg records printed by the CLI.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 7 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough; poppler reads the held PDFs outside the worktree, which the sandbox permits, and the test writes only under the OS temp dir. Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21. Raised and folded in: the CLI's output when the crop itself fails, criterion 3's size band now matching the frozen test's, the `VP8L` fixture shrunk to the minimal 25 bytes, absent optional keys and the record's `label` now asserted, `--force-region-crop` now exercised, and the clean-tree criterion now checking `git status --porcelain` and standing as the evidence that the legacy module is unchanged. Usage exit 2, SVG doctype handling and temporary-directory cleanup remain for the unit test and the verifier's reading.
