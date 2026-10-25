# Figure locator: the synthesis model names the figure, code finds it, a vision model only picks a number

Design document for stage card `18-design-figure-locator`. Written against the run branch at `447c19d` (which carries the wave-1 figure cards 10 to 13) on 2026-10-20. Every `path:line` below was read on that revision and re-checked on `152d28a` (attempt 2, 2026-10-20; no source file changed between the two). Poppler 26.07 was used for every command quoted here; the evaluation PDFs live only in the main checkout's gitignored `input/_held/`.

## Summary

Today a vision model chooses the figure from 820px thumbnails of the first 24 pages, guesses a bounding box as fractions of the page, and a second vision call judges the crop. Everything else in `src/figure-vlm.ts` (a refine pass, a pad ladder, a full-width fallback, drift guards, tiling) exists to repair the consequences of those two guesses. The confirmed failure (an image labelled "Figure 1" whose pixels are Figure 3 of `w35275.pdf`) is the direct product of a model that did not read the paper choosing a figure, and a model that cannot measure guessing where it is.

The design inverts the roles:

1. **The synthesis model names the figure.** It already reads the whole paper inside the batch request, so it emits `figure_request {label, why}` (stage 16's wire field) and the choice rides the 50 percent batch discount. No vision call is spent on choosing.
2. **Code locates the figure deterministically.** For an arXiv paper the e-print's `\includegraphics` file or the `arxiv.org/html` asset for that label is the figure itself. For a PDF, `pdftotext -bbox-layout` finds the caption line (page and y position in points), `pdftoppm -gray -r 50` gives the ink bands beside it and `pdftohtml -xml -zoom 1` gives embedded image boxes, and the figure body is the band between the caption and the nearest body text. For an HTML page, the `<figure>` whose label matches is the candidate. The crop is cut by `pdftoppm -jpeg -r 300 -x -y -W -H` in the rendered page's own pixel space.
3. **A vision model only picks a number.** When the deterministic step yields more than one plausible region, the regions are sent as numbered crops and the model returns a single integer. Every provider, including the codex CLI, can do that. A pin that cannot be located fails closed: no figure rather than a wrong one.
4. **The asset is a file**, written as `<slug>/figure-<n>.jpg` beside the JSON with `sha256`, `width`, `height`, `page` and a `provenance` value naming the ladder step that produced it (stage 16's `lead_figure`).

The result is at most two vision calls per paper (typically none) instead of up to twelve; all 42 functions in `src/figure-vlm.ts` are accounted for in the deletion map (444 function lines deleted outright, 422 rewritten, 103 moved; the 1,286-line module is removed by the last wave-2 card); and the ten wave-2 cards at the end are written to be carded directly.

## Current state

### How a figure is chosen

- The synthesis model is told never to name or emit a figure. `skill.md:58` declares `"image": <NEVER emit; attached externally by the figure pipeline ...>`, `skill.md:184-186` and `skill.md:218` repeat it in prose, `skill.md:268` puts it in the checklist, and `src/prompt.ts:25` says "Never emit an `image` block, because the figure pipeline attaches the figure". (Wave-1 card 12 made `prompt.ts` and `skill.md` agree; before it they contradicted each other.)
- At collect time `saveResult` (`src/output.ts:529`) calls `attachFigureImage` (`src/output.ts:559`, body at `src/output.ts:254-325`), which resolves the source PDF (`src/output.ts:161-172`; a URL-sourced id returns null at `:162`) or URL (`src/output.ts:214-225`), the sidecar override (`src/output.ts:174-186`) and the recreation directive (`src/output.ts:188-197`). A `recreate: Figure N` target also pins the pick when no `image:` line does (`src/output.ts:284-286`).
- `extractFigureViaVlm` (`src/figure-vlm.ts:1243-1286`) dispatches: local PDF (`:1258-1259`), PDF URL downloaded to a temp file (`:1261-1274`, added by wave-1 card 11), persisted DOM snapshot candidates then live Playwright for HTML URLs (`:1276-1280`).
- **PDF path** (`extractFromPdf`, `src/figure-vlm.ts:619-715`): `pdftoppm` renders pages 1 to `min(total, 24)` (`:620-621`, `MAX_PAGES` at `:105`) as 820px-wide thumbnails (`:106`, `renderPdfThumbnails` `:555-567`). One vision call (`selectFigureOnce` `:250-273`) receives every thumbnail and the prompt built by `selectionPrompt` (`:184-209`), which asks for `page`, a normalised `bbox` (`:201`), `source_figure`, `caption` (`:203`) and `alt_text`, all before any crop exists. Since wave-1 card 12 the context block asks for the paper's key results figure (`:158`).
- **HTML snapshot path** (`extractFromSnapshot`, `:936-1004`): `preprocess.ts` captured `<figure>` candidates at submit time (`src/preprocess.ts:218-260`, persisted as `FigureCandidate` `src/state.ts:14-22`), their `<img>` assets are fetched (`:948`), a pinned label is matched by `matchesNamedFigure` (`:903-911`), otherwise one vision call (`chooseCandidateOnce` `:869-891`, prompt `candidatePrompt` `:821-844`) picks a candidate number and writes caption and alt (`:837-838`).
- **HTML live path** (`extractFromUrl`, `:1006-1116`): Playwright loads the page at 1280x1600 with device scale 2 (`:1013`), `markFigureCandidates` (`:770-801`) enumerates `figure, picture, svg, canvas, img` and class-name matches (`:775`), de-duplicates by intersection over the smaller area at 0.85 (`:786-790`), keeps the 12 largest (`:757`, `:793-794`), screenshots each, and the vision model picks one by number. Pages with no candidates fall to `extractFromFullPage` (`:1129-1225`).

### How it is located and cropped

- PDF: after the page is chosen, `renderPdfPage` (`:498-508`) renders it at 2200px and `refineBboxOnPage` (`:515-552`) asks the model for a second normalised box (`:527`). `cropPdfBboxPng` (`:594-617`) converts the fractions to pixels with `pageSizePts` (`:478-488`; since wave-1 card 11 it passes `-f/-l` and swaps width and height for `rot: 90/270`) and runs `pdftoppm -r 300 -x -y -W -H` (`:609-610`). If verification fails, the same box is re-cut with pads 0.005, 0.02 and 0.045 (`CROP_PAD_STEPS` `:130`) and finally at full page width over the box's vertical span (`:674-677`).
- HTML live: the element screenshot is the crop (`:1081`). The full-page fallback screenshots the page (`:1137`), measures it, then grows the viewport to the content height (`:1148-1151`), which reflows the page after the measurement, tiles it (`:1154-1160`), asks for a page-and-bbox selection and snaps the box to the smallest overlapping element with IoU at least 0.1 (`snapToFigureElement` `:421-451`, threshold `:420`).

### How it is verified

`verifyCrop` (`:328-368`) makes one vision call per crop attempt. Since wave-1 card 10 it is told the pinned label (`:339`) and fails closed for pins (`:335`, `:357`, `:366`). For an unpinned pick an unparseable reply (`:357`) or a transport error (`:366`) still passes. The unpinned snapshot path never verifies (`:985-1000`). `looksBlank` (`:289-306`) rejects crops under 48px or below 0.006 bytes per pixel. `pinDriftReason` (`:918-923`) rejects a selection that names a different figure or none, comparing labels with `figureLabelKey` (`:898-901`), which keeps only the leading number-and-letter run.

### How it is stored

`encodeJpegDataUrl` (`:569-587`) re-encodes the crop with macOS `sips` and the result is written into the JSON as a base64 `data:` URL (`src/output.ts:303-309`, `src/figure-vlm.ts:77`). The label stamped on the image is the pin when one exists, otherwise whatever the model reported (`:698`, `:1096`, `:1212`). When recreation is on, the full-resolution PNG is kept in memory (`cropPngBase64`, `:707`) and handed to `recreateFigureData` (`src/output.ts:314-324`, `src/figure-data.ts:419`).

### How the vision model is chosen

`resolveVisionProvider` (`src/vision.ts:222-232`) picks the provider from whichever credential is present; `runVision` (`src/vision.ts:179-219`) picks subscription or API per provider (`src/vision.ts:71-116`), downscales every image to 2500px (`src/vision.ts:42`, `:190`) with `sips` (`src/vision.ts:45-69`) and labels images as `image/png` unless the extension is `.jpg` (`src/vision.ts:31-33`). The codex CLI route gets labels as an appended manifest (`src/vision.ts:153-157`) and images through `codex exec --image` (`src/providers.ts:632`, `:670`). Since wave-1 card 13 the model comes from `resolveVisionModel` (`src/figure-vlm.ts:240-242`; `src/model-config.ts:99-108`), defaulting to `claude-opus-4-8` or `gpt-5.6-terra` (`src/model-config.ts:65`, `:79`), and a model from the other provider is refused (`src/model-config.ts:92-94`).

### Directives

`parseFocusDirectives` (`src/preprocess.ts:68-140`) reads `image:` (`:81`), `image_caption:`, `image_alt:`, `image_page_hint:` (`:84`) and the `recreate*`/`data:` family (`:85-88`). Since wave-1 card 11 any image key sets the override (`:94-105`, `:125-127`). An unknown `image_*` key only warns (`:116-119`); the EPIC sidecar in the evaluation set carries `image_raster: true`, which is therefore ignored today. `scripts/reextract-figure.ts:52-61` builds the same override from CLI flags and patches `image` in place (`:68-78`).

### What wave 1 changed under the card's defect table

The card's line numbers were against `dev` at `0cd17d7`. On this base: D1's drift guard now also rejects an unnamed selection, but the pin's label is still stamped on the crop the model claimed is the pin; D2's verifier is told the label and fails closed for pins only; D3's `prompt.ts` contradiction is gone; D4 is reversed (`src/figure-vlm.ts:158`); D6's `pdfinfo` call is per page and reads `rot`; D7's PDF URLs are downloaded and follow the PDF path; D8's model is per provider but the provider is still ambient; D11's bare `image_page_hint:` now works. D5, D9, D10, D12, D13, D14, D15, D16 and D17 are as the card describes, at the lines given in the table below.

## Findings addressed

| Id | Where (this base) | How the design resolves it | Card |
|---|---|---|---|
| D1 | `src/figure-vlm.ts:698`, `:1096`, `:1212`; drift guard `:918-923` | The pinned label is never stamped on a model's claim. A pin is satisfied only by a region adjacent to the caption whose parsed label equals the pin (noun, number and panel), found in the text layer or the DOM; the label on the asset is the located caption's own label. No caption, no figure. | W4, W8 |
| D2 | `src/figure-vlm.ts:335`, `:339`, `:357`, `:366`; snapshot `:985-1000` | Vision verification is removed from the acceptance path. Acceptance is deterministic: the region contains the matched caption's figure body and no body-text block or second caption, has a minimum size and is not blank. The optional single `vlm-crop` verify call is off by default and, when on, an unparseable reply or transport error is a fail for every pick, not only pins. | W2, W8 |
| D3 | `skill.md:58`, `:184-186`, `:218`, `:268`; `src/prompt.ts:25`; `src/figure-vlm.ts:105-106`, `:184-209`, `:203` | The synthesis model names the figure in `figure_request {label, why}` and the prompt asks it to. Thumbnails of up to 24 pages, the selection prompt and the model-written caption go. The displayed caption is composed from the paper's own caption text after the crop exists. | W4, W10 |
| D4 | `src/figure-vlm.ts:158`; `src/output.ts:289-291` | Reversed by wave-1 card 12 and kept reversed: the prompt change asks the synthesis model for the paper's key results figure, else its central diagram. No steer away from results plots exists anywhere in the new ladder. | W4 |
| D5 | `src/figure-vlm.ts:201`, `:527`, `:130`, `:674-677`; `:370-400`, `:454-460` | No step asks a model for coordinates. Regions come from caption geometry, ink bands and embedded image boxes in points; the picker returns an integer. The pad ladder, full-width fallback, `clamp01`, `bboxToRect`, `padRect`, `clampClip`, `padBbox` and `refineBboxOnPage` are deleted. | W2, W3, W10 |
| D6 | `src/figure-vlm.ts:478-488`, `:594-602` | Wave-1 card 11 fixed the per-page `pdfinfo` call. The design goes further: the crop's pixel geometry is derived from the rendered page's own dimensions (the PGM header), and the rotation experiment below shows that `pdftotext -bbox-layout` word boxes are already in the displayed frame while its `<page>` size is not, so the locator trusts word boxes plus the render, never `<page width/height>`. | W3 |
| D7 | `src/output.ts:161-172`; `src/preprocess.ts:579`; `src/figure-vlm.ts:22-25`, `:1261-1274` | Wave-1 card 11 downloads PDF URLs. The design keeps that and adds a cache under the state directory so the arXiv step, the PDF locator and `reextract` read one file; `isPdfUrl` moves to the locator's source resolver. | W5, W8 |
| D8 | `src/vision.ts:222-232`, `:235-237`; `src/model-config.ts:92-108` | The picker and the optional verify are the only vision calls and both go through stage 17's vision binding (provider-scoped `tiers.<provider>.vision`, explicit `VISION_PROVIDER`, `VISION_ROUTE_PREFERENCE`, `VISION_ROUTE=batch-api`). Ambient credential selection is deleted by stage 17 W15; until then the locator calls `runVision` through one adapter function so the swap is a single edit. | W7, stage 17 W13 |
| D9 | `src/figure-vlm.ts:786-790`; `src/preprocess.ts:226` | True IoU at 0.7 replaces intersection over the smaller area, a `<figure>` with more than one image child is kept as the candidate and its children dropped, and the snapshot parser records every `<img>`, `<picture>` source and `<object data="*.svg">` inside a figure. | W6 |
| D10 | `src/figure-vlm.ts:426`, `:775`; `src/preprocess.ts:244` | Class matching is by token: split `className` on whitespace and hyphens and match a token equal to `chart`, `figure`, `graph` or `plot`. `paragraph` and `typography` no longer match. | W6 |
| D11 | `src/preprocess.ts:94-105`, `:116-119` | Fixed by wave-1 card 11. The design adds `image_raster:` as a recognised directive (force the region crop over an embedded image or arXiv asset) so the EPIC sidecar stops warning. | W4 |
| D12 | `src/figure-vlm.ts:105`, `:620-621` | No page cap. `pdftotext -bbox-layout` scans the whole document (0.48 s for the 97 pages of `w35275.pdf`, measured below) and only the caption's page is rendered. `FIGURE_VLM_MAX_PAGES` is deleted. | W1, W10 |
| D13 | `src/figure-vlm.ts:898-901`, `:903-911`, `:918-923` | A label key is `{noun, number, panel?}`: `Table 4` and `Figure 4` differ; `Figure 4a` refines `Figure 4` and matches a `Figure 4` caption with `panel: a` recorded; `Fig.`, `FIGURE`, `Figure 4(a)` and `Figure 4 (a)` normalise to the same key. | W1 |
| D14 | `src/vision.ts:31-33`; `src/figure-vlm.ts:951`, `:955`, `:971` | Image type is sniffed from the first bytes (PNG, JPEG, GIF, WebP RIFF, SVG text), the media type sent to a model matches the bytes, and the asset written is the fetched original, never the downscaled send copy. SVG assets are stored as `.svg` with no `width`/`height`, as stage 16 allows. | W3, W6 |
| D15 | `src/figure-vlm.ts:1137`, `:1148-1151` | The full-page tiled fallback is deleted; a page whose DOM has no figure-like element yields no figure. Element screenshots clip to the element's box at the viewport the page was measured in; the viewport is never resized after measurement. | W6, W10 |
| D16 | `src/figure-vlm.ts:238`, `:659-663`, `:674-685` | At most two vision calls per paper: one picker call when the deterministic step is ambiguous, one optional verify. Typical papers make none. Both calls use stage 17's vision binding, so `VISION_ROUTE=batch-api` can defer them to a batch. | W7, W8 |
| D17 | `src/output.ts:303-309`; `src/figure-vlm.ts:77`, `:569-587` | The asset is written as `<slug>/figure-<n>.<ext>` beside the JSON and `lead_figure.asset` holds the relative path with `sha256`, `width`, `height` (stage 16 Q5). `sips` and base64 encoding go; `pdftoppm -jpeg -jpegopt quality=90` produces the JPEG directly. | W3, stage 16 W6 |

## Pipeline

### Inputs

```
FigureRequest {
  label?: LabelKey            // from image: pin, recreate: target, or figure_request.label (that order)
  pinned: boolean             // true for image: and recreate: targets
  why?: string                // figure_request.why
  pageHint?: number           // image_page_hint:
  captionOverride?, altOverride?: string
  forceRegionCrop: boolean    // image_raster: true
  source: { pdfPath?: string; url?: string; arxivId?: string; snapshot?: FigureCandidate[] }
}
```

`arxivId` is detected deterministically: from an `arxiv.org/abs|pdf|html/<id>` source URL, from `references[0].url` or `metadata.source.ref` in the artefact, or from the first page's text layer (`pdftotext -f 1 -l 1`) matching `arXiv:(\d{4}\.\d{4,5})(v\d+)?`.

### The ladder

| Step | Applies when | Finds | Provenance |
|---|---|---|---|
| 0 | always | the label to look for; see Synthesis names the figure | |
| 1 | `arxivId` known, network allowed, `forceRegionCrop` false | the e-print `\includegraphics` file or the `arxiv.org/html` asset for that label | `arxiv-source` |
| 2 | a PDF is local or downloadable | the caption on its page, the figure body beside it; an embedded image box covering at least 90 percent of the body's content extents (the ink inside the span, frame rules excluded) gives `pdf-embedded`, otherwise the body is rasterised | `pdf-embedded`, `pdf-vector-crop` |
| 3 | source is an HTML page | the DOM `<figure>` (snapshot candidates first, live Playwright second) whose label matches | `dom-asset` |
| 4 | step 2 or 3 produced more than one plausible region, or a label was found but its body is ambiguous | a number, chosen by the vision model among numbered candidate crops | `vlm-crop` |

Each step either returns a `LocatedFigure` or falls through with a recorded reason. Step 4 never runs on its own: it only disambiguates candidates produced by step 2 or 3, so it can never introduce a figure the text layer or DOM did not label.

```
LocatedFigure {
  label: LabelKey; captionText?: string; page?: number; regionPt?: Rect;
  bytes: Buffer; ext: 'jpg' | 'png' | 'webp' | 'gif' | 'svg'; width?: number; height?: number;
  provenance: 'arxiv-source' | 'pdf-embedded' | 'pdf-vector-crop' | 'dom-asset' | 'vlm-crop';
  calls: { picker: 0 | 1; verify: 0 | 1 }; notes: string[];
}
```

### Stop rules

- **No label** (the model emitted `figure_request: null` and no directive pins one): stop before step 1 with `no-request`. The locator does not guess a figure the synthesis model did not want.
- **Label not found by any step**: stop with `label-not-found` and the list of labels the caption index did find. No second choice is taken (Q7).
- **Pinned and not found, or pinned and the picker declines or is unavailable**: stop with `pin-not-found` or `picker-declined`. A pin means this figure or nothing.
- **Unpinned and the picker is unavailable** (transport error, unparseable reply): take the largest candidate region adjacent to the caption, provenance `pdf-vector-crop` or `dom-asset`, with the note `picker-unavailable: largest region taken`. Every candidate is the labelled figure's body, so the label is right and only the extent is uncertain.
- **Region too small** (under 60 by 40 points) or **blank**: `region-too-small` or `blank-region`; no figure.
- **Source unavailable** (PDF missing, URL unreachable, arXiv unreachable with no PDF): `source-unavailable`; no figure.

Every stop writes `metadata.quality.dropped` an entry `lead_figure: <reason>` (stage 16 Q6) and the locator's debug record (caption index, bands, candidates, calls) to `state/figure-locator/<customId>.json`, gitignored, so a reviewer can see why. No figure is a valid article (stage 17: optional figure failure produces a valid article with a recorded warning).

### Budget per paper

Deterministic work: one `pdfinfo`, one whole-document `pdftotext -bbox-layout`, one `pdftoppm -gray -r 50` of the caption page, one `pdftohtml -xml -zoom 1` of that page, one `pdftoppm -jpeg -r 300` crop (0.18 s measured). Network: at most one e-print and one HTML fetch, cached. Vision: at most one picker call and one optional verify.

## Synthesis names the figure

### Wire field

Stage 16 owns the shape: `figure_request {label: PlainText ("Figure 3"), why: PlainText 1..240}`, nullable on the wire, kept in the artefact for `reextract` (`docs/design/content-contract-v2.md`, table under "figure_request and lead_figure", and Q5). The card calls these `lead_figure.label` and `why`; in the contract the model-facing field is `figure_request` and the code-stamped result is `lead_figure`. This document uses the contract's names.

- `label` uses the paper's own numbering and noun: `Figure 3`, `Table 2`, `Figure 4b`. The locator normalises `Fig. 3`, `FIGURE 3` and `Figure 3(b)`.
- `why` is one plain-words sentence saying what the figure shows and why a reader should see it. It is the model's justification and, by default, the asset's `alt_text` (Q13).
- `null` means the paper has no figure worth showing; the locator stops with `no-request`.

### Which figure the model is asked for

The paper's key results figure, the one carrying its headline finding; only when the paper has no results figure, its architecture, pipeline or framework figure. A table may be named when the paper's result is a table and no results plot exists. The same rule wave-1 card 12 put into `src/figure-vlm.ts:158` moves to the synthesis prompt; nothing steers away from results plots because the explainer's own charts exist (the chart gate is stage 19's and is unrelated).

### How the caption is written

The displayed `lead_figure.caption` is composed by code after the crop exists: the located label, a colon, and the paper's caption text (the caption block's text from `pdftotext -bbox-layout`, or the `<figcaption>` text, or the `\caption{}` text with macros stripped), cut at the first sentence end after 40 characters and at most 300 characters, in plain text. `alt_text` is `figure_request.why`. Sidecar `image_caption:` and `image_alt:` override both (Q8). The synthesis model never writes the figure caption: it cannot see the crop, and the paper's caption is the faithful description. Q13 records the open choice of whether `why` should be reader-facing.

### The prompt change (described, not applied)

- `skill.md:58`: the `"image": <NEVER emit ...>` entry is replaced by the generated `figure_request` entry (stage 16 W5 generates this block from the contract, so the text is produced by `contract:build`, not hand-written).
- `skill.md:184-186` ("Working with figures in the paper"): replace the paragraph that says a vision model picks the figure with: read every figure; name the one the explainer should show in `figure_request.label`, using the paper's numbering; prefer the key results figure, else the central diagram; write `why` as one plain sentence; emit `null` when no figure helps the reader. Keep the sentence that figures are never a source of chart values.
- `skill.md:218` ("Do not emit an `image` field"): becomes "Do not emit an `image` field or any image bytes; name the figure in `figure_request` and the pipeline locates and attaches it."
- `skill.md:268` (checklist): "`figure_request` names one figure by the paper's own label, or is null."
- `src/prompt.ts:25`: "Never emit an `image` block, because the figure pipeline attaches the figure." becomes "Name the lead figure in `figure_request` (label and one-sentence why) and emit no image block; the figure pipeline locates it." When a sidecar pins a figure, the user instruction adds "A sidecar pins `<label>` as the lead figure; set `figure_request.label` to it and write `why` for it." so the model's reason and the pin agree.

## arXiv source

### Evidence

The e-print for `2410.15332v3` is a gzip tarball (940 KB) with the figures as separate PDFs and each figure's TeX in its own file:

```
$ curl -sL https://arxiv.org/e-print/2410.15332v3 | tar -tz | grep -E 'fig-algo'
figs/fig-algo.tex
figs/figs/fig-algo.pdf
$ grep -nE '\\includegraphics|\\caption\{|\\label\{' figs/fig-algo.tex
3:    \includegraphics[width=\linewidth]{figs/figs/fig-algo.pdf}
4:    \caption{Comparison of PIC Algorithms. The area above the dashed line corresponds to the compile step, ... \texttt{KVLink}
5:    \label{fig-algo}
```

The figure number is not in the source: `\label{fig-algo}` is a name, and `\system` and `\algo` macros stand for words that appear expanded in the PDF caption. The HTML render has the numbering and the asset reference:

```
$ curl -sL https://arxiv.org/html/2410.15332v3 | grep -o '<figure[^>]*>' | wc -l
10
<figure id="S4.F4" class="ltx_figure"><object type="image/svg+xml" data="2410.15332v3/fig-algo.svg" ...
<figcaption ...>Figure 4: Comparison of PIC Algorithms. The area above the dashed line ...
```

So the HTML gives `Figure 4` to `fig-algo.svg` (basename `fig-algo`), and the e-print gives `fig-algo.pdf`, which poppler renders at any resolution without a new dependency.

### Design

- **Primary mapping: `arxiv.org/html/<id>`.** Parse `<figure id="S<sec>.F<n>">` (or `A<k>.F<n>` for appendices, `S<sec>.T<n>` for tables) and its `<figcaption>` label; take the `<object data>`, `<img src>` or `<img srcset>` basename. Match on the label key. When the HTML is absent (not every paper has a render) fall to the e-print-only mapping.
- **Asset bytes: the e-print.** Resolve the basename against the tarball's `\includegraphics{...}` arguments (with and without extension, as TeX allows: `fig-eval-data-dist` without `.pdf` appears above). PDF assets are rasterised with `pdftoppm -jpeg -r 300` (page 1 of the asset) and stored as `.jpg`; PNG and JPEG assets are stored as fetched. EPS cannot be rendered by poppler and ghostscript is not a dependency, so an EPS-only figure falls through to the PDF locator.
- **E-print-only mapping (no HTML).** Walk the main `.tex` (the one with `\documentclass`), expand `\input`/`\include`, and number `figure`/`figure*` environments in order, `table`/`table*` separately, skipping environments inside `\appendix` into an appendix sequence only when the PDF's captions use letter prefixes. Accept the mapping only when at least 60 percent of the first eight non-trivial words of the PDF caption (from the text layer) appear in the stripped `\caption{}`; otherwise fall through. Macro-heavy captions (the EPIC paper) are why the HTML mapping is primary.
- **HTML asset only (SVG, no e-print).** Poppler does not rasterise SVG and the design adds no rasteriser, so an SVG-only figure falls through to the PDF locator, which crops the same figure from the page. The PNG assets LaTeXML emits for raster figures are used directly.
- **Multi-file and sub-figure panels.** A figure environment with more than one `\includegraphics` (sub-figures, side-by-side panels) is not composed; the step falls through to the PDF locator, which crops the composed figure. Exception: a pinned panel label (`Figure 2b`) whose environment has as many `\includegraphics` as panels takes the matching file in order, with `panel: b` recorded.
- **Format conversion.** PDF to JPEG via `pdftoppm -jpeg -jpegopt quality=90 -r 300`; PNG and JPEG untouched; EPS and SVG fall through as above. Dimensions come from the file header (JPEG SOF, PNG IHDR).
- **Caching.** `state/cache/arxiv/<id>/{eprint.tar.gz, html.html, mapping.json}`, gitignored, no expiry (an arXiv version is immutable; a new version is a new id). `reextract` reads the same cache.
- **Network unavailable at collect time.** The step is skipped within a 20 s budget per fetch, records `arxiv-source: unavailable (<error>)` in the locator notes and the PDF locator runs offline. A run with `FIGURE_ARXIV_SOURCE=0` skips the step without trying.

## PDF caption locator

### Caption regex and label parsing

A caption candidate is the first words of a `<block>` in `pdftotext -bbox-layout` output (block-anchored, not line-anchored), matching:

```
^(Figure|Fig\.?|FIGURE|Table|Tab\.?|TABLE|Scheme|Exhibit)\s*
 ([A-Z]?\d+|S\d+|[IVXL]+)            number: 3, A1, S2, or roman for tables
 (?:\s*\(?([a-z])\)?)?               panel: 2b, 2(b), 2 (b)
 (?:\.(\d+))?                        sub-number: 3.1
 \s*(?:[:.]|(?=\s+[A-Z(]))           punctuation, or a capital or bracket next
```

Normalisation produces `LabelKey {noun: 'Figure' | 'Table' | 'Scheme' | 'Exhibit', number: string, panel?: string}`. Equality is noun and number; a pin with a panel matches a caption without one and records the panel. `Fig.`, `FIGURE` and `Figure` are one noun; `Table 4` never equals `Figure 4` (D13).

The punctuation rule separates captions from references in prose. In `w35275.pdf` the whole-document scan finds exactly the 17 captions and none of the references:

```
$ pdftotext -bbox-layout input/_held/w35275.pdf out.html   # 0.48 s, 97 pages, 4.3 MB
block-start captions: 17
p5:  Figure 1: Overview of Productivity Effects of
p11: Figure 2: Assigning Tasks to Async Coding
p12: Figure 3: The Software Production Hierarchy
p15: Table 1: AI Coding Tools and the
...
```

"Figure 8 presents the corresponding event studies" (a paragraph start on page 36) is rejected by the lowercase word after the number; "Figure 13. All in all, these results" (`2507.14554`, a sentence end) is rejected because it is not at a block start. A "(continued)" caption is recorded with `continued: true` and never chosen over the first caption of the same label.

### Page selection without a page cap

One `pdftotext -bbox-layout <pdf>` over the whole document builds the caption index: every `LabelKey` with its page, block box and caption text. There is no page cap (D12). `image_page_hint:` is a tie-breaker: when the same label has captions on more than one page (a continued figure, or a figure and an appendix figure sharing a number), the hinted page wins; otherwise the hint is ignored and noted. A label absent from the index stops the step with `label-not-found` and the index's labels.

### Extents: what each tool reports

`pdfimages -list` reports sizes and resolution but no page position, so it cannot place an image:

```
$ pdfimages -list -f 9 -l 9 input/_held/flyvbjerg-it-cost-risk.pdf
page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
   9     0 image    1501   945  sep     1   8  image  no        60  0   300   300 67.2K 4.9%
```

`pdftohtml -xml -zoom 1` reports each embedded image's box in points (the default zoom of 1.5 scales everything by 1.5; `-zoom 1` gives the page's own points):

```
$ pdftohtml -xml -zoom 1 -f 9 -l 9 input/_held/flyvbjerg-it-cost-risk.pdf /tmp/x/fly9
<page number="9" position="absolute" top="0" left="0" height="782" width="585">
<image top="78" left="114" width="360" height="227" src=".../fly9-9_1.png"/>
$ pdftohtml -xml -zoom 1 -f 5 -l 5 input/_held/2410.15332v3.pdf /tmp/x/epic5
<image top="162" left="316" width="20" height="20" .../>     (four 20pt icons)
<image top="162" left="335" width="206" height="114" .../>   (the heatmap strip)
```

`pdftohtml` always writes the image files beside its output, so it must be given an output path in a temporary directory (run without one it writes `<pdf>-5_1.jpg` next to the source PDF). It reports nothing for vector drawings: `w35275.pdf` page 5 yields no `<image>` at all.

Vector extents come from a low-resolution grey render, not from path parsing. `pdftocairo -svg` of that page is 463 KB with 315 paths under one `transform="matrix(0.65315, 0, 0, -0.65315, 117.892, 283.382)"`; computing extents needs a path parser and transform maths. `pdftoppm -gray -r 50` produces a PGM (a 13-byte header and raw bytes, parsed with no dependency) in 0.12 s, and scanning rows for ink (any pixel under 200) gives the bands:

```
$ pdftoppm -gray -r 50 -f 5 -l 5 input/_held/w35275.pdf /tmp/x/p5     # 425x550 PGM
rows 50-58   (pt 72-84)   x pt 143-468    caption "Figure 1: Overview ..."
rows 69-193  (pt 99-278)  x pt 132-484    the figure body (vector chart)
rows 206-212 (pt 297-305) x pt 71-539     "Notes: ..." block begins
...
```

Text words from `-bbox-layout` inside a band (axis labels such as `2000%`, `17.3x`, `Lines`) are part of the figure and are not masked; they are small blocks and never qualify as body text under the rule below.

### Region rule (Q4)

Given the caption block `C` on page `P`:

1. **Text classification.** From the page's blocks: a *body-text block* has at least three lines, or at least two lines and twelve words, and a width of at least 60 percent of its column. A *running header or footer* is a one-line block within the top or bottom 8 percent of the page. A *caption block* starts with a caption match. Everything else (axis labels, legend words, panel letters) is *in-figure text*.
2. **Columns.** Body-text blocks' x ranges cluster into one or two columns. `C` is *full-width* when its width exceeds 60 percent of the text width (the EPIC caption: 55 to 542 of a 55 to 541 text width); otherwise its column is the one containing its centre.
3. **Side.** Captions sit below figures in most templates, so look above `C` first: the figure side is the side whose nearest ink band within 40 points is not a body-text block, a caption block or a header. If the block directly above `C` (gap under 6 points) is a header or the page edge, the figure is below (NBER style, `w35275.pdf` page 5: caption at 72 to 84 is the first block, body at 99 to 278).
4. **Vertical extent.** From `C`'s edge, extend across ink rows until a body-text block, another caption block, a header or footer, or the page margin. A thin horizontal rule (ink rows at most 2 points tall spanning at least 80 percent of the span) splits the band unless its end columns carry ink on the adjacent rows, in which case it is a frame around the figure and is kept. The Flyvbjerg page shows the frame case: rows at 71 and 310 points span 36 to 550 with 2-pixel ink at both ends between them, enclosing the image at 78 to 305.
5. **Horizontal extent.** The ink extents within the vertical span, intersected with the full text width (full-width captions) or the column (column captions), unioned with any `pdftohtml` image box inside the span, padded 4 points, clamped to the page.
6. **Embedded image shortcut.** The denominator is the span's *content extents*: the bounding box of the ink inside the span after the frame rules kept by step 4 are removed and before the 4-point pad of step 5. When exactly one image box lies in the span and covers at least 90 percent of the content extents' area, provenance is `pdf-embedded` and the crop is that box (step 5's region is still recorded). The denominator is content rather than the region because a figure centred in a frame or in a text-width box is surrounded by white space that is not drawing, and the shortcut asks whether the raster is the whole drawing: on Flyvbjerg page 9 the image is 66 percent of the framed box (360 by 227 of 514 by 239 points) yet 100 percent of the content extents, which the 50 dpi render puts at exactly the image box (114 to 474 by 78 to 305 points; measured below). The EPIC span fails both conditions: five image boxes lie in it (four 20 by 20 icons and the strip), and the strip is 24 percent of the content extents (206 by 114 of 483 by 203 points), so Figure 4 is a `pdf-vector-crop` of the whole band, which is what the `image_raster: true` sidecar was asking for; `forceRegionCrop` disables the shortcut explicitly.
7. **Ambiguity.** When step 4 yields more than one band on the figure side separated by gaps over 12 points but under 40 points (stacked panels, a legend floated apart), the candidates are each band and their union, capped at six; the picker chooses (Vision picker). A single band is accepted without a model.
8. **Captions above, two-column pages, split figures.** Captions above are step 3. A full-width figure on a two-column page (EPIC page 5) takes the text width in step 5 and stops at the header above (the one-line `E PIC: ...` block at 48 to 56 points); its body comes out as 58 to 541 by 73 to 276. A figure continued on a second page is not merged: the first caption's page is cropped and `continued` captions are noted.
9. **Minimum size.** A region under 60 by 40 points stops with `region-too-small`.

The content-extents measurement behind step 6, from the 50 dpi PGM of Flyvbjerg page 9 (ink is any pixel under 200; a point is 50/72 of a pixel):

```
$ pdftoppm -gray -r 50 -f 9 -l 9 input/_held/flyvbjerg-it-cost-risk.pdf /tmp/x/fly   # 407x544 PGM
frame: rows 49 and 215 (pt 71 and 310) carry 357 and 358 ink pixels across px 25-382 (pt 36-550);
       cols 25 and 382 carry 166 and 167 ink pixels over rows 49-215; rows 50 and 214 carry 2 each
ink inside the frame with a 2 px perimeter removed: 1919 pixels,
       bbox px x 79-328, y 54-211  =  pt 114-474 by 78-305  (the pdftohtml image box exactly)
$ pdftohtml -xml -zoom 1 -f 5 -l 5 input/_held/2410.15332v3.pdf /tmp/x/epic5
five <image> elements in the Figure 4 span: 20x20 at left 316 (top 162, 191, 218, 246) and
       206x114 at left 335 top 162 (the heatmap strip)
```

Worked results on the evaluation pages (all from the commands above): `w35275` Figure 1 region 128 to 488 by 95 to 282 points on page 5 (band 132 to 484 by 99 to 278 plus 4); EPIC Figure 4 region 54 to 541 by 69 to 280 on page 5; Flyvbjerg Figure 3 region 32 to 554 by 67 to 314 on page 9 (the framed box).

### Rotation

A one-page PDF with `/Rotate 90` written for the test shows how poppler reports rotation:

```
$ pdfinfo -f 1 -l 1 rot.pdf | grep -E 'size|rot'
Page    1 size:  612 x 792 pts (letter)
Page    1 rot:   90
$ pdftotext -bbox-layout rot.pdf - | grep -E '<page|>Figure<'
  <page width="612.000000" height="792.000000">
          <word xMin="697.102000" yMin="72.000000" xMax="710.052000" yMax="111.676000">Figure</word>
$ pdftoppm -gray -r 72 rot.pdf r; head -2 r-1.pgm | tail -1
792 612
```

Word boxes are in the displayed (rotated) frame (`xMin` 697 exceeds the unrotated width 612), the `<page>` element keeps the unrotated size, and `pdftoppm` renders the displayed frame (792 by 612). The locator therefore takes the displayed page size from `pdfinfo` (`rot` 90 or 270 swaps width and height) or from the render's own header, and never from `<page width height>`. Ink bands are computed on the rendered PGM, so they are in the displayed frame by construction.

### The 300 dpi crop in the page's own pixel space

Render once per figure with `pdftoppm -jpeg -jpegopt quality=90 -r 300 -f P -l P -x X -y Y -W W -H H`, where `X, Y, W, H` are the region's points multiplied by 300/72 and rounded outwards, computed against that page's displayed size. For `pdf-embedded`, the render DPI is `max(300, image x-ppi)` capped at 600 so a 469-ppi raster is not softened. Measured on the EPIC region: 0.18 s, a 2012 by 845 JPEG of 292 KB. The JPEG is the asset; its dimensions are read from the SOF marker. No `sips`, no PNG round-trip, no size cap: the website resizes for display and the stage 16 artefact records `width` and `height`.

## HTML figures

### Evidence

The URL in `input/urls.txt` (the Anthropic research page) read on 2026-10-20:

```
$ curl -sL https://www.anthropic.com/research/claude-code-expertise | grep -c '<figure'
8
$ ... | grep -o '<figcaption style="--figure-label:&quot;[^&]*' | sed 's/.*;//'
Figure 1  Figure 2  Table 1  Figure 3  Figure 4  Table 2  Figure 5  Figure 6
```

Eight `<figure>` elements, each with one `<img>` and a `<figcaption>`, plus one bare hero `<img>` outside any figure. The label lives in a CSS custom property on the figcaption (`style="--figure-label:"Figure 5""`), not in the caption text, so `parseSourceFigureLabel` (`src/preprocess.ts:205-208`) finds no label on this page today and a pin cannot match. Image sources are `/_next/image?url=<encoded CDN URL>&w=3840` with the original dimensions in the CDN filename (`...-1920x1080.png`). The arXiv HTML render uses `<figure id="S4.F4"><object type="image/svg+xml" data="...">` with no `<img>`, so the regex parser (`src/preprocess.ts:226`) records nothing for arXiv HTML today.

### Design

- **Candidates.** `<figure>` elements first; `picture`, `svg`, `canvas`, `img` and token-matched wrappers (`chart`, `figure`, `graph`, `plot` as whole class tokens, D10) only when the page has no `<figure>`. The bare hero image is never a candidate on a page that has figures.
- **Labels.** In order: the figcaption text prefix (`Figure 4:`), the `--figure-label` custom property, `aria-label`, an `id` of the LaTeXML form `S4.F4`/`A1.F2`/`S2.T1`, and a `data-label` attribute. The label key is the same `LabelKey`.
- **Assets.** For each candidate record every image source: `<img src>`, the largest `srcset` entry, `<picture><source srcset>`, `<object data>`. A `/_next/image?url=` wrapper is unwrapped to the CDN URL. The snapshot parser in `src/preprocess.ts:218-260` is extended to do this at submit time (it survives: it is the no-Playwright path for batch runs and records the labels for pins); the live Playwright path uses the same extraction in the page.
- **De-duplication.** True intersection over union at 0.7 (`intersectionOverUnion`, `src/figure-vlm.ts:402-408`, kept). Wrapper preference: a `<figure>` with more than one image child is one candidate (multi-panel) and its children are dropped; a `<figure>` with exactly one image yields the image's box as the crop with the figcaption carried from the wrapper. The current rule (intersection over the smaller area at 0.85, `:786-790`) always drops the wrapper (D9) and goes.
- **Image type detection.** Sniff the first bytes: `89 50 4E 47` PNG, `FF D8` JPEG, `47 49 46` GIF, `52 49 46 46 .... 57 45 42 50` WebP, text starting `<svg` or `<?xml` with an `<svg` root. The stored extension and the media type sent to a model follow the sniffed type. SVG is stored as `.svg` with no `width`/`height`.
- **Pinned and unpinned.** A label match on a `<figure>` returns that asset with no vision call (`dom-asset`). An unpinned request whose label matches does the same. When the label is not on the page (the page numbers its figures differently from the paper, or not at all), the step falls through; the picker is not asked to choose among all a page's figures, because a web page's figure numbering is not the paper's and a wrong figure under the synthesis label is the defect this design removes.
- **Screenshot clipping without a viewport resize.** Only when a matched candidate has no fetchable asset (a `canvas` or inline `svg` chart) does Playwright take `locator.screenshot()` of that element at the viewport the page was measured in (1280 by 1600, device scale 2, after `renderReady`). `setViewportSize` after measurement (`src/figure-vlm.ts:1148-1151`) is gone with the full-page fallback (D15).

## Vision picker

### When it runs

Only on ambiguity produced by step 2 or 3: more than one candidate band beside a located caption (region rule step 7), or a DOM figure with several same-label candidates after de-duplication. A single candidate is never sent to a model. The picker never chooses which figure; it chooses which region is the complete body of a figure the text layer has already identified.

### Numbered candidates

Candidates are sent as separate labelled images, not as boxes drawn on the page: `pdftoppm -jpeg -r 100 -x -y -W -H` crops each candidate region (and, for a PDF, the whole page at 100 dpi as context); each image is preceded by its label `Candidate 1`, `Candidate 2`, ... (`runVision`'s `labels`, `src/vision.ts:171`, which the codex route turns into an ordered manifest, `src/vision.ts:153-157`). Drawing numbered overlays would need a rasteriser the project does not have; labelled crops need none and give the model a clean view of each region. The cap is six candidates.

### Prompt contract

System: "You are checking a figure crop for a research explainer. Reply with a single integer and nothing else."

User: "The caption on this page reads: `Figure 4: Comparison of PIC Algorithms ...`. Candidates 1 to N are regions beside that caption; the last image is the page. Which candidate is the complete body of Figure 4 (every panel, axis and legend, no body text, no other figure)? Reply with the candidate number, or 0 if none is complete."

Parsing accepts `^\s*(\d+)\s*$` after stripping code fences; anything else is unparseable. `0` is a decline. There is no caption, alt text, label or confidence in the reply (D3, D5).

### Model tier and calls

The picker and the optional verify use stage 17's vision binding (`docs/design/provider-routes.md`, "Vision defaults to the run's provider" and Q3): provider-scoped `tiers.<provider>.vision` (registry `claude.sonnet`, currently Claude Sonnet 5.5; `openai.batch`, currently Terra), never `MODEL`/`MODEL_BATCH`, route preference `subscription,api`, or `VISION_ROUTE=batch-api` to defer the call into a batch with the article pending until it is collected. Until stage 17 W13 lands, the locator calls today's `runVision` through one `pickCandidate(images, prompt)` adapter so the binding swap is a single edit. Maximum calls per paper: one picker, one verify. `FIGURE_VLM_ATTEMPTS` and retries with "pick a different figure" are gone: a retry cannot change what the text layer says.

### Deterministic checks before any vision verify

Every candidate passes these before it may be sent or accepted: the region contains the figure side of the caption and not the caption block itself; it contains no body-text block and no other caption block; it is at least 60 by 40 points and at most 95 percent of the page; `looksBlank` (`src/figure-vlm.ts:289-306`, kept) is false; for `pdf-embedded` the image box lies inside it. A candidate failing a check is dropped before the picker sees it.

### Optional verify and failing closed for pins

`FIGURE_VERIFY=1` enables one vision call on a `vlm-crop` result only ("Is this one complete figure with no body text? Reply yes or no."). It is off by default because the deterministic checks already exclude body text and partial crops, and because the current verifier's fail-open paths are part of D2. When enabled, `no`, an unparseable reply and a transport error all reject, pinned or not. For a pin: a picker decline, an unparseable reply, a transport error or a verify rejection each end with no figure (`picker-declined`, `picker-unavailable`, `verify-rejected`). For an unpinned request only `picker-unavailable` has a fallback (the largest candidate, see Stop rules).

## Output and provenance

### The sidecar asset

Per stage 16 Q5 and W6: the locator returns bytes and metadata; code writes `<slug>/figure-<n>.<ext>` beside the JSON in `output/`, the website staging directory and the Obsidian mirror, and stamps `lead_figure {label, caption, alt_text, asset, sha256, width, height, page?, provenance}`.

- **Naming.** `figure-<number>` from the label (`figure-3.jpg`), `figure-<number><panel>` for a panel (`figure-2b.jpg`), `table-<number>` for a table label, `figure.jpg` when the label has no number. `<ext>` is `jpg` for every poppler render, and the sniffed type (`png`, `jpg`, `webp`, `gif`, `svg`) for a fetched asset.
- **Fields.** `sha256` of the bytes; `width` and `height` from the header (absent for SVG); `page` for PDF-derived assets; `label` as `Figure 3` (noun, number, panel); `caption` and `alt_text` as composed above or overridden.
- **Provenance per ladder step.** `arxiv-source` (e-print or HTML asset), `pdf-embedded` (one embedded image box was the region), `pdf-vector-crop` (a rendered region), `dom-asset` (a fetched web asset or element screenshot), `vlm-crop` (a region chosen by the picker). `legacy` is written only by stage 16's migration.
- **Locator record.** `state/figure-locator/<customId>.json` (gitignored) holds the request, the caption index, bands, image boxes, candidates, the picker reply if any, timings and the stop reason. `reextract` prints it.

### A run that found no figure

`lead_figure` is absent, `metadata.quality.dropped` contains `lead_figure: <reason>` with the reasons enumerated in Stop rules, the locator record is written, and the article is saved as valid. A pinned miss additionally logs a warning naming the pin and the labels the index did find, since a pin is an operator's instruction.

## Deletion map

Line ranges are each function's declaration to its closing brace on this base (42 functions, 969 lines; the file is 1,286 lines). Verdicts: **keep** (moved verbatim into `src/figure-locator/`), **rewrite** (the name survives with a new contract in the new module), **delete**.

| Function | Lines | Verdict | Where it goes or why it goes |
|---|---|---|---|
| `isPdfUrl` | 22-25 | keep | `src/figure-locator/source.ts` |
| `contextFromExplainer` | 39-51 | rewrite | reads `figure_request` and v2 fields; returns the `FigureRequest` (stage 16 W7 already touches it) |
| `envNum` | 110-113 | keep | `src/figure-locator/config.ts` |
| `contextBlock` | 151-161 | delete | selection prompt is gone; the results-figure rule moves to `skill.md` |
| `previousBlock` | 163-177 | delete | no selection retries |
| `pageHintLine` | 179-182 | delete | the page hint is a deterministic tie-breaker, not prompt text |
| `selectionPrompt` | 184-209 | delete | no model selection |
| `parseSelection` | 211-236 | delete | no model selection |
| `visionModel` | 240-242 | delete | stage 17's vision binding supplies the model |
| `selectFigureOnce` | 250-273 | delete | no model selection |
| `looksBlank` | 289-306 | keep | `src/figure-locator/checks.ts` |
| `cropBase64` | 309-316 | delete | recreation consumes `LocatedFigure.bytes` |
| `verifyCrop` | 328-368 | rewrite | `verifyOnce` in `picker.ts`: yes/no, off by default, fails closed for every pick |
| `clamp01` | 370-372 | delete | no normalised boxes |
| `bboxToRect` | 377-383 | delete | no normalised boxes |
| `padRect` | 385-389 | delete | regions are in points with a fixed 4-point pad |
| `clampClip` | 391-400 | delete | no viewport resize, no tiling |
| `intersectionOverUnion` | 402-408 | keep | `src/figure-locator/dom-figures.ts` |
| `snapToFigureElement` | 421-451 | delete | no model box to snap |
| `padBbox` | 454-460 | delete | no normalised boxes |
| `pngSizePx` | 463-476 | keep | `src/figure-locator/asset.ts`, joined by JPEG, GIF and WebP header readers |
| `pageSizePts` | 478-488 | keep | `src/figure-locator/geometry.ts` |
| `pageCount` | 490-495 | keep | `src/figure-locator/geometry.ts` |
| `renderPdfPage` | 498-508 | keep | `src/figure-locator/geometry.ts`; `src/figure-data.ts` imports it from there |
| `refineBboxOnPage` | 515-552 | delete | no model box |
| `renderPdfThumbnails` | 555-567 | delete | no thumbnails of 24 pages; the picker renders one page at 100 dpi |
| `encodeJpegDataUrl` | 569-587 | delete | `pdftoppm -jpeg` writes the asset; no `sips`, no base64 |
| `cropPdfBboxPng` | 594-617 | rewrite | `cropRegion(pdf, page, regionPt, dpi)` in `pdf-crop.ts`, JPEG out, pixel space from the displayed page size |
| `extractFromPdf` | 619-715 | delete | replaced by `captions.ts` + `geometry.ts` + `region.ts` + `pdf-crop.ts` |
| `loadPlaywright` | 718-726 | keep | `src/figure-locator/dom-figures.ts` |
| `renderReady` | 734-752 | keep | `src/figure-locator/dom-figures.ts` |
| `markFigureCandidates` | 770-801 | rewrite | token class match, IoU 0.7, wrapper preference, label sources, asset URLs |
| `candidatePrompt` | 821-844 | rewrite | number-only contract in `picker.ts` |
| `parseCandidateSelection` | 846-867 | rewrite | `parsePick`: a single integer or null |
| `chooseCandidateOnce` | 869-891 | rewrite | `pickCandidate` through the stage 17 binding adapter |
| `figureLabelKey` | 898-901 | rewrite | `parseLabel` returning `{noun, number, panel}` in `label.ts` |
| `matchesNamedFigure` | 903-911 | rewrite | `sameFigure(a, b)` on `LabelKey` |
| `pinDriftReason` | 918-923 | rewrite | `pinSatisfied(pin, located)` on `LabelKey`; drift is impossible by construction, the check guards the DOM label sources |
| `extractFromSnapshot` | 936-1004 | rewrite | `fromSnapshot` in `dom-figures.ts`: label match, sniffed type, original bytes, no vision |
| `extractFromUrl` | 1006-1116 | rewrite | `fromLivePage`: same candidate extraction in-page, element screenshot without resize, no full-page fallback |
| `extractFromFullPage` | 1129-1225 | delete | tiled bbox guessing is D5 and D15 |
| `extractFigureViaVlm` | 1243-1286 | rewrite | `locateFigure(request): Promise<LocatedFigure | NoFigure>` in `src/figure-locator/index.ts`, the ladder above |

Totals: **delete** 19 functions, 444 lines; **rewrite** 13 functions, 422 lines; **keep** 10 functions, 103 lines. W10 removes `src/figure-vlm.ts` entirely (1,286 lines, of which the 103 kept lines reappear in the new module), and with stage 17 W15 removes `imageSizePx` and `downscaleLongEdge` (`src/vision.ts:45-69`) and the `sips` dependency. Module constants deleted with their functions: `MAX_PAGES`, `THUMB_WIDTH_PX`, `MIN_CONFIDENCE`, `SELECTION_MAX_TOKENS`, `CROP_PAD`, `CROP_PAD_STEPS`, `REFINE_WIDTH_PX`, `SELECTION_SYSTEM`, `FIGURE_ATTEMPTS`, `MIN_SNAP_IOU`, `CANDIDATE_SEND_PX`, `MAX_CANDIDATES`, `CANDIDATE_SYSTEM`, `TILE_HEIGHT_CSS`, `MAX_TILES`; retained: `CROP_DPI` (as the 300 default), `MIN_CROP_DIM_PX`, `BLANK_BYTES_PER_PIXEL`.

## Evaluation set

Expected picks were read from the PDFs with `pdftotext -f P -l P -layout <pdf> - | grep -n '<label>'` on 2026-10-20; the verifier can repeat each command against `../explainer-batch/input/_held/`. Pass criteria apply to every case: the located label equals the expected label (noun and number), the page equals the expected page, the asset's provenance is the expected step, the region (for PDFs) contains the expected ink band and no body text, and the number of vision calls is at most the stated maximum.

| Case | Source | Pin | Expected pick | Step | Max calls | Evidence |
|---|---|---|---|---|---|---|
| E1 | `input/_held/w35275.pdf` (97 pages) | `recreate: Figure 1` in `w35275.focus.md` | Figure 1, page 5 (Figure 3 is on page 12) | `pdf-vector-crop` (no embedded image on the page) | 0 | `pdftotext -f 5 -l 5 -layout ... \| grep -n 'Figure 1'` prints line 1 `Figure 1: Overview of Productivity Effects of AI Coding Tools`; page 12 line 1 `Figure 3: The Software Production Hierarchy`; caption above the figure; the 24-page cap would have hidden pages 25 to 97 |
| E2 | `input/_held/2410.15332v3.pdf` (12 pages), also `arxiv.org/pdf/2410.15332v3` as a PDF URL | `image: Figure 4`, `image_page_hint: 5`, `image_raster: true` in its focus file | Figure 4, page 5; full-width, two-column page; body 58 to 541 by 73 to 276 points | `arxiv-source` (`fig-algo.pdf`) when online; `pdf-vector-crop` offline or with `image_raster: true` | 0 | page 5 layout line 32 `Figure 4. Comparison of PIC Algorithms. ...`; `pdfimages -list -f 5 -l 5` shows the only large image is 1767 by 978 (the heatmap strip, 206 by 114 points at left 335, top 162), 24 percent of the region, so the embedded shortcut does not fire |
| E3 | `input/_held/flyvbjerg-it-cost-risk.pdf` (30 pages) | `image: Figure 3`, `image_page_hint: 9`, `recreate: Figure 3` | Figure 3, page 9 (CCDF curves), framed box 36 to 550 by 71 to 310 points | `pdf-embedded`: exactly one image box in the span (1501 by 945 pixels at 300 ppi, placed at 114 to 474 by 78 to 305 points, 360 by 227 points) and the content extents equal that box, so coverage is 360 by 227 = 81,720 of 81,720 square points, 100 percent (against the framed box 514 by 239 = 122,846 it would be 66.5 percent, and against W2's padded region 522 by 247 = 128,934 it would be 63.4 percent, which is why rule 6's denominator is the content extents); the crop is the image box at 300 dpi, 1500 by 946 pixels | 0 | page 9 layout line 6 `Figure 3. Complementary cumulative distribution functions (CDF) for the five project types with largest samples in the tail.`; `pdftohtml -xml -zoom 1 -f 9 -l 9` gives `<image top="78" left="114" width="360" height="227">`; `pdftoppm -gray -r 50` ink inside the frame, perimeter removed, has bbox px 79 to 328 by 54 to 211, which is 114 to 474 by 78 to 305 points (PDF caption locator, step 6 measurement) |
| E4 | the URL in `input/urls.txt` (`anthropic.com/research/claude-code-expertise`) | none | Figure 5 ("Expertise and how sessions end: Session outcomes by the user's rated expertise ..."), the results figure matching the paper's title and the prior explainer's headline; Figure 6 (success by inferred occupation) is the acceptable alternative | `dom-asset` | 0 | 8 `<figure>` elements with labels Figure 1, Figure 2, Table 1, Figure 3, Figure 4, Table 2, Figure 5, Figure 6 in `--figure-label`; each has one `<img>` under `/_next/image?url=`; caption texts recorded in HTML figures above; the prior run (`output/2026-06-17_hitzig_agentic-coding-expertise_explainer.json`) has no image at all |
| E5 | `input/_held/w35275.pdf` without its pin | none (synthesis names it) | Figure 1, page 5: the paper's own summary of its results ("Our results are summarized in Figure 1", page 5 layout line 36) | `pdf-vector-crop` | 0 | as E1; the synthesis prompt asks for the key results figure |
| E6 | `input/_held/flyvbjerg-it-cost-risk.pdf` without its pin | none | Figure 2, page 8 (bootstrapped median alpha per project type with confidence intervals, the headline finding that IT is uniquely risky); Figure 3, page 9 acceptable | `pdf-embedded` or `pdf-vector-crop` | 0 | whole-document layout line 440 `Figure 2. Bootstrapped median alpha values for upper tail, per project type, with 95% confidence interval (CI), N = 11,011.`; `pdftotext -f 8 -l 8` contains it; the paper's text "Figure 2 shows the alpha values for each project type" |
| E7 | arXiv `2507.14554` (Su, Ahmad, Esposito, Janes, Taibi, Lenarduzzi, 29 pages; prior explainer `output.local/2026-04-02_taibi_2025_emerging-trends-sa_2507-14554_explainer.json`) | none | Figure 3, page 11 ("Top 10 technologies in the fourth quartile (top 25%) by Year (RQ1.1)"), the results figure behind the prior headline "Kubernetes dominates five years of practitioner talks" | `arxiv-source` online, `pdf-vector-crop` offline | 0 | PDF downloaded read-only to a scratch directory; `pdftotext -f 11 -l 11 -layout 2507.14554.pdf - \| grep -n 'Figure 3'` prints the caption; the prior explainer has no image |
| E8 | arXiv `2506.11019` (Koc, Verre, Blank, Morgan, 16 pages; prior explainer `output.local/2026-04-02_koc_2025_mind-the-metrics-mcp_2506-11019_explainer.json`) | none | Figure 2, page 6 ("Comparison between traditional prompt-engineering workflow (top) and MCP-enhanced IDE ..."): the paper has no results figure (Figures 1 to 5 are workflow and sequence diagrams), so the central comparison diagram is the pick; Figure 1, page 2 acceptable | `arxiv-source` online, `pdf-vector-crop` offline | 0 | scratch PDF; `pdftotext -f 6 -l 6 -layout 2506.11019.pdf - \| grep -n 'Figure 2'` prints the caption; `-f 2 -l 2` prints Figure 1's |
| E9 | `input/_held/w35275.pdf` with `image: Figure 9` and `image_page_hint: 5` | pin | Figure 9, page 38: the hint is wrong and must be ignored, not followed | `pdf-vector-crop` | 0 | whole-document scan lists `p38: Figure 9: Calibrated Model Fit for Autocomplete`; page 5 has no Figure 9 caption |
| E10 | `input/_held/w35275.pdf` with `image: Figure 14` | pin | no figure, reason `pin-not-found`, with the 17 found labels listed | none | 0 | the caption index has Figures 1 to 12 and Tables 1 to 5 |

E9 and E10 are synthetic directive cases on a held PDF and need no new material. A page-hint case where the hint is right and decisive (the same label on two pages) is not in the held set; W9 adds a two-page fixture built from `pdfseparate` output of a held PDF locally.

## Migration and rollback

1. **Land the locator beside the current path.** W1 to W7 add `src/figure-locator/` with its own tests; nothing calls it from the pipeline until W8. `FIGURE_LOCATOR=legacy|deterministic` (default `legacy`) selects the implementation in `attachFigureImage`, or in stage 17's `finalizeResult` step 6 once that seam exists. Rollback: unset the variable or set `legacy`; the new module is inert.
2. **Synthesis names the figure.** W4 changes `skill.md` and `src/prompt.ts` (through stage 16 W5's generated block where it exists). The legacy path ignores `figure_request`; the deterministic path reads it. Rollback: revert the prompt commit; the deterministic path then behaves as if every request were `null` and pins still work.
3. **Flip the default.** After W9's evaluation passes on the held set, `FIGURE_LOCATOR` defaults to `deterministic`. Batch and subscription runs are unchanged in shape: the locator runs at collect inside the finalise step for both. Rollback: `FIGURE_LOCATOR=legacy` in `.env.local` for a run, no code change.
4. **Re-extract existing outputs.** `npm run reextract -- <json> <source> [label]` (stage 16 W7 rewrites it for the sidecar) calls `locateFigure` with the artefact's `figure_request.label`, or the v1 `image.source_figure`, or the CLI label, writes `<slug>/figure-<n>.<ext>` and updates `lead_figure`. `scripts/reextract-all.ts` (W8) walks `output/` and `output.local/` with `--dry-run` printing the planned label, page and provenance per file first. Publishing stays a manual curated replay; re-extraction writes to `output/` only. Rollback: the previous JSON and asset are written to `<slug>.bak/` for one run and the website repo keeps its own history.
5. **Delete the replaced code.** W10 removes `src/figure-vlm.ts`, the `FIGURE_VLM_*` knobs, `sips` usage and the legacy branch of the switch, and rewrites `docs/FIGURE-EXTRACTION.md`. Rollback: `git revert` of the W10 commit restores the legacy path behind the switch; nothing else depends on the deleted functions after W8.

Operator decisions already made are respected throughout: batch and subscription runs stay first-class (the locator is route-agnostic and its two optional calls use stage 17's binding), the six-point chart filter is untouched, and no step publishes.

## Tradeoffs

1. **The synthesis model names the figure instead of a vision model choosing one.** The synthesis model has read the whole paper and already costs nothing extra inside the batch; a vision model sees 24 thumbnails at 820px and has not read the argument. The cost is that a model that emits `null` or a wrong label yields no figure or a located-but-unwanted figure, with no vision fallback. Rejected: keeping a vision selection as a fallback when `figure_request` is null, because that reintroduces the second, less-informed chooser the review found at fault, and because no figure is an acceptable article.
2. **Ink bands from a 50 dpi grey render instead of vector path extents.** `pdftocairo -svg` needs a path parser and transform maths to produce extents (315 paths under a matrix transform on one evaluation page); a PGM is a header and bytes and renders in 0.12 s. The cost is that a thin faint element (a light grey gridline under the ink threshold) can be missed at the edge of a figure, which the 4-point pad covers in practice. Rejected: `pdftocairo -svg` extent parsing, and a pdf.js operator-list walk, which adds a dependency and a second PDF engine.
3. **Labelled candidate crops instead of numbered overlays drawn on the page.** Overlays need a rasteriser (`sharp`, Chromium or a canvas library); labelled crops need only `pdftoppm`. The cost is that the model loses the spatial relation between candidates, which the whole-page context image restores. Rejected: adding `sharp` for overlay drawing; the project's only image needs are met by poppler and header readers.
4. **arXiv source before the PDF, even with a local PDF.** The author's original asset is sharper than any crop, has no neighbouring text to exclude and carries no region uncertainty; the cost is a network dependency and a 20 s budget at collect time, mitigated by the cache and by the PDF step running whenever the arXiv step misses. Rejected: PDF first with arXiv as an enhancement, because the PDF crop would then be the common case and the better asset the rare one.
5. **No full-page tiled fallback for HTML pages without figure-like elements.** Such pages are rare among research sources and the fallback is the model-guesses-coordinates pattern the design removes; the cost is no figure for a page whose charts are plain `<div>` backgrounds. Rejected: keeping `extractFromFullPage` behind a flag; a guessed box under the synthesis label is the defect, flagged or not.
6. **No `sharp`; poppler and header readers only.** `pdftoppm -jpeg` writes the crop, assets are stored in their fetched format, and dimensions come from headers, so the pipeline runs on Linux without `sips` and without a native module. The cost is that no step can resize or re-encode a fetched asset; a 6 MB PNG is stored as fetched and the website resizes for display. Rejected: `sharp` for a size cap, pending Q14 if asset weight becomes a problem.
7. **The caption is the paper's caption, composed by code, not written by a model.** It is faithful and deterministic and needs no call; the cost is that technical captions are not glossed for a glancing reader the way chart captions are. Rejected: having the synthesis model write a figure caption it cannot see the crop for, and having the picker write one (D3). Q13 keeps the door open to a reader-facing `why`.
8. **True IoU at 0.7 with wrapper preference instead of overlap over the smaller area at 0.85.** Overlap over the smaller area is 1.0 for any element inside another, so a `<figure>` wrapping two panels always loses to its first child; IoU keeps the wrapper when its children are small relative to it. The cost is a possible duplicate when a caption-only wrapper is nearly the size of its image, which the one-image rule (take the image, carry the figcaption) handles. Rejected: overlap over the smaller area at any threshold, because it is 1.0 for every nested element and so can never keep a wrapper.

## Open questions

1. **Q1** Ladder order, and whether arXiv source is tried before the PDF when a local PDF exists. **Answer:** synthesis label, then arXiv source (when an id is known and the network is allowed), then the PDF caption locator, then the HTML DOM, then the picker on ambiguity only. arXiv goes first even with a local PDF because the original asset is sharper and region-free; the step is bounded (20 s per fetch, cached, `FIGURE_ARXIV_SOURCE=0` to skip) and every miss falls to the PDF step offline. Tradeoff 4.
2. **Q2** arXiv e-print versus `arxiv.org/html`, `\includegraphics` and sub-figure resolution, and vector sources becoming a raster asset. **Answer:** the HTML render is the primary mapping from label to asset basename (`<figure id="S4.F4">` with `<figcaption>Figure 4:` and `<object data="fig-algo.svg">`), the e-print supplies the original bytes (`figs/figs/fig-algo.pdf`, matched to the basename with or without extension); with no HTML the e-print is numbered by walking `figure` environments through `\input` and accepted only when the PDF caption's words overlap the stripped `\caption{}` by at least 60 percent. PDF assets become JPEG through `pdftoppm -jpeg -r 300`; PNG and JPEG are stored as is; EPS and SVG-only figures fall through to the PDF locator (no ghostscript, no SVG rasteriser). Multi-file figures fall through unless a pinned panel maps one-to-one to a file.
3. **Q3** How image and vector extents are found on a PDF page and the dependency cost. **Answer:** embedded images from `pdftohtml -xml -zoom 1 -f P -l P <pdf> <tmp>/out` (`<image top left width height>` in points; it writes image files, so it is given a temporary output path), confirmed on the Flyvbjerg and EPIC pages above; `pdfimages -list` gives sizes and resolution but no position and is used only to learn the image's ppi for the `pdf-embedded` render DPI; vector and total ink extents from `pdftoppm -gray -r 50` PGM row scanning (0.12 s per page, parsed with no dependency), confirmed on the vector figure of `w35275.pdf` page 5. Dependency cost: none beyond poppler, which is already required. `pdftocairo -svg` and pdf.js were rejected (Tradeoff 2).
4. **Q4** The region rule between a caption and the nearest body text, captions above, full-width figures on two-column pages, split figures. **Answer:** the nine-step rule in PDF caption locator: classify blocks (body text, header or footer, caption, in-figure text), infer columns, choose the figure side (above first, below when the caption is the first block or sits under a header), extend across ink rows until body text, another caption, a header or the margin, treating free-standing rules as separators and frames as content, take ink extents unioned with image boxes within the caption's width (text width for full-width captions), apply the embedded-image shortcut at 90 percent of the content extents (ink inside the span, frames excluded, so a framed or centred raster is not penalised for white space), send multi-band ambiguity to the picker, never merge continued figures, and reject regions under 60 by 40 points. Worked on all three held pages above.
5. **Q5** IoU threshold and wrapper preference for HTML figures, and whether the regex parser survives. **Answer:** true IoU at 0.7; a `<figure>` with more than one image child is the candidate and its children are dropped; a `<figure>` with one image yields the image's box with the figcaption carried over. The `preprocess.ts` regex parser survives as the no-Playwright snapshot source and is extended to record every image source (`src`, largest `srcset`, `<picture>`, `<object data>`), `/_next/image` unwrapping, and labels from figcaption text, `--figure-label`, `aria-label` and LaTeXML ids; the live path extracts the same in-page.
6. **Q6** The picker's prompt and output contract, candidate cap, model tier and fail-closed rule for pins. **Answer:** labelled candidate crops (at most six) plus the page at 100 dpi; the reply is a single integer, `0` to decline, anything else unparseable; stage 17's vision binding (`tiers.<provider>.vision`, Sonnet 5.5 or Terra by registry alias, route preference `subscription,api`, or `batch-api`) through one adapter until W13 lands; a pin ends with no figure on decline, unparseable reply or transport error; an unpinned request falls back to the largest candidate only on transport or parse failure, with a note.
7. **Q7** What the synthesis model emits, what happens when its label is not found, and whether a second choice is allowed. **Answer:** `figure_request {label, why}` or `null` (stage 16's shape); the displayed caption is composed from the paper's caption and `alt_text` defaults to `why`; a label no step can find stops with `label-not-found` and the found labels in `quality.dropped` and the locator record; no second choice is taken, because the contract has one label and a code-chosen substitute would be the uninformed chooser again. The operator can re-run `reextract` with a label.
8. **Q8** Sidecar overrides in the new pipeline, and whether a pin exists separately from the synthesis choice. **Answer:** yes, a pin is separate and wins: precedence is `image:` then `recreate: Figure N` then `figure_request.label`; `image_page_hint:` is a tie-breaker between pages carrying the same label and is otherwise ignored with a note (never a steer); `image_caption:` and `image_alt:` override the composed text; `image_raster: true` becomes a recognised directive forcing the region crop over the embedded-image shortcut and the arXiv asset. When a pin exists the user instruction tells the synthesis model to set `figure_request.label` to it, so request and pin agree and `why` describes the pinned figure.
9. **Q9** Where the locator runs and how one figure is re-run without synthesis. **Answer:** at collect, inside the single finalise seam, after validation and repair and before stamping (stage 17 orchestrator step 6, `finalizeResult` at `src/batch.ts:246` today), with its bytes, provenance and warnings checkpointed so a resume does not repeat a picker call; `VISION_ROUTE=batch-api` defers the picker to a batch and leaves the item pending. One figure is re-run by `npm run reextract -- <json> <source> [label]` (stage 16 W7), which calls `locateFigure` with the artefact's `figure_request` or the CLI label, reuses the arXiv cache and rewrites the sidecar and `lead_figure` only.
10. **Q10** `sharp` versus `sips`, and whether Playwright is still needed beyond HTML sources. **Answer:** neither `sharp` nor `sips`: `pdftoppm -jpeg -jpegopt quality=90` writes crops, fetched assets are stored as fetched with sniffed types, and dimensions come from PNG, JPEG, GIF and WebP headers, so the pipeline is Linux-portable with poppler alone (Tradeoff 6). Playwright is needed only for HTML pages whose matched figure has no fetchable asset (canvas or inline SVG charts) and for the figure-recreation render-and-compare pass in `src/figure-data.ts`, which this design does not touch; it stays a lazy import.
11. **Q11** The evaluation set's storage. **Answer:** wave 2 commits, per case under `tests/fixtures/figure-locator/<case>/`, the caption page's `pdftotext -bbox-layout` XML, the `pdftohtml -xml -zoom 1` XML with image files deleted, the 50 dpi ink-band JSON, the arXiv HTML and e-print listing for E2, E7 and E8, the trimmed Anthropic page HTML for E4, and `expected.json`; no PDF, no page image and no crop is committed. The unit test runs the caption, region and label logic on those snapshots offline; `npm run eval:figures` runs the full ladder against `input/_held/` and the scratch arXiv PDFs locally, skipping cases whose source is absent, and is not part of `npm test`. Whether small crops of the two arXiv figures may be committed as golden images is Q14.
12. **Q12** How `recreated_figure` and `recreate:` relate to `lead_figure` under stage 16's one chart shape. **Answer:** per stage 16 Q10 and W8, `recreated_figure` leaves the contract and recreation writes a `Chart` to `charts[0]` when the model emitted none; `recreate: Figure N` keeps pinning both the lead figure and the recreation target (`src/output.ts:284-286` today) so the asset and the chart describe the same figure; the recreation pass consumes `LocatedFigure.bytes`, `page` and `label` instead of `cropPngBase64` (`src/output.ts:314-324`); `lead_figure` and the recreated chart may coexist and stage 19's gate decides the chart. No chart shape is changed here.
13. **Q13** Whether `figure_request.why` should be written as a reader-facing sentence that doubles as `alt_text` and as the first sentence of the displayed caption, or stay a terse justification with the caption taken from the paper alone. The design defaults to the paper's caption plus `why` as alt text (Tradeoff 7) because the prompt wording and the field's description belong to stage 16's generated block. **Deferred (owner: 16-design-content-contract-v2):** confirm the `why` wording in the generated `figure_request` description, or add a `caption_gloss` field.
14. **Q14** Whether small golden crops of the two arXiv evaluation figures (E7, E8) may be committed under `tests/fixtures/`, given arXiv licences vary per paper, and whether asset weight needs a cap (a fetched 6 MB PNG is stored as is under Tradeoff 6). **Deferred (owner: operator):** licence check on `2507.14554` and `2506.11019`, and a yes or no on a size cap that would reintroduce an image library.
15. **Q15** Whether the arXiv step should run in headless `run-batch-tmux.sh` runs by default, given it adds outbound network at collect time beyond the provider APIs. The design defaults it on with the 20 s budget and the `FIGURE_ARXIV_SOURCE=0` switch. **Deferred (owner: operator):** confirm the default for headless runs.
16. **Q16** Whether a `Table N` label is an acceptable lead figure when the synthesis model names one (a results table rendered as an image), or whether tables are refused and the model told to name figures only. The design accepts tables (the label parser and the asset naming handle them) and lets the prompt prefer figures. **Answer:** accept; the article's own `table` blocks carry the values and the image is illustrative, and refusing would turn a clear request into `label-not-found`.

## Wave-2 cards

Dependencies first. W1 and W2 are sequential; W3 follows W2; W4, W5, W6 and W7 can run in parallel after W3 (W7 needs only W2); W8 integrates; W9 evaluates; W10 deletes. Cards that touch stage 16 or 17 work say so in their outcome; none redesigns either. Every outcome command is satisfiable by the card's own Files on top of its dependencies: a `grep` that names a directory is recursive (`-r`), "prints nothing" means exit status 1 (no match; exit 2 is a failure of the command itself), and a check for the absence of legacy code across the whole of `src` belongs to W10, the card that deletes `src/figure-vlm.ts`.

### W1. caption-index-and-label-parser

- **Outcome:** `npx ts-node scripts/figure-captions.ts ../explainer-batch/input/_held/w35275.pdf` prints one line per caption with page, label key and the first words, including `p5 Figure 1` and `p12 Figure 3` and no "Figure 8 presents" line; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/figure-captions.test.ts` passes on the committed `bbox-layout` snapshots, including `Table 4` not equal to `Figure 4`, `Fig. 2(b)` parsing to `{Figure, 2, b}`, and the continued-caption rule.
- **Files:** new `src/figure-locator/label.ts`, `src/figure-locator/captions.ts`, `scripts/figure-captions.ts`, `tests/unit/figure-captions.test.ts`, `tests/fixtures/figure-locator/w35275/captions.bbox.xml` (page 5 and page 36 only), `tests/fixtures/figure-locator/su-2507.14554/captions.bbox.xml` (the page with "Figure 13. All in all")
- **Depends on:** none

### W2. page-geometry-and-region-rule

- **Outcome:** `npx ts-node scripts/figure-region.ts ../explainer-batch/input/_held/2410.15332v3.pdf "Figure 4"` prints page 5 and a region within 6 points of 54,69 to 541,280, and the same for `w35275.pdf "Figure 1"` (page 5, about 128,95 to 488,282) and `flyvbjerg-it-cost-risk.pdf "Figure 3"` (page 9, region the framed box about 32,67 to 554,314, provenance `pdf-embedded` with crop box 114,78 to 474,305 and coverage 100 percent of the content extents); `tests/unit/figure-region.test.ts` passes on committed ink-band JSON and `pdftohtml` XML snapshots, including the rotated-page fixture where the displayed size is 792 by 612.
- **Files:** new `src/figure-locator/geometry.ts` (`pageSizePts`, `pageCount`, `renderPdfPage` moved from `src/figure-vlm.ts`, PGM ink bands, `pdftohtml -xml -zoom 1` image boxes), `src/figure-locator/region.ts`, `src/figure-locator/checks.ts` (`looksBlank` moved), `scripts/figure-region.ts`, `tests/unit/figure-region.test.ts`, `tests/fixtures/figure-locator/{w35275,hu-2410.15332v3,flyvbjerg,rotated}/`
- **Depends on:** W1

### W3. pixel-space-crop-and-sidecar-asset

- **Outcome:** `npx ts-node scripts/figure-crop.ts ../explainer-batch/input/_held/2410.15332v3.pdf "Figure 4" /tmp/out` writes `/tmp/out/figure-4.jpg` of about 2012 by 845 pixels and prints its `sha256`, `width`, `height`, `page: 5` and `provenance`; the rotated fixture crops in the 792 by 612 frame; `tests/unit/figure-asset.test.ts` passes header readers for PNG, JPEG, GIF, WebP and SVG sniffing and the `figure-2b.jpg` / `table-2.png` naming rule; `grep -rn "'sips'" src/figure-locator` prints nothing and exits 1. Stage 16 W6 stamps `lead_figure` from the returned record; this card only produces the file and record.
- **Files:** new `src/figure-locator/pdf-crop.ts`, `src/figure-locator/asset.ts` (`pngSizePx` moved, plus JPEG, GIF, WebP readers and sniffing), `scripts/figure-crop.ts`, `tests/unit/figure-asset.test.ts`, `tests/fixtures/figure-locator/headers/` (tiny hand-made PNG, JPEG, GIF, WebP, SVG files)
- **Depends on:** W2

### W4. synthesis-names-the-figure

- **Outcome:** `skill.md` and `src/prompt.ts` ask for `figure_request {label, why}` and no image block (through stage 16 W5's generated block when it has landed, otherwise by direct edit of the three paragraphs named in Synthesis names the figure); `parseFocusDirectives` recognises `image_raster:`; a contract test feeds a model output with `figure_request {label: "Figure 3"}` plus `w35275.pdf` through `locateFigure` and asserts `label` Figure 3 and `page` 12 with zero vision calls, and a pinned `Figure 14` yields `pin-not-found` with the found labels; `grep -n 'NEVER emit' skill.md` prints nothing and exits 1.
- **Files:** `skill.md`, `src/prompt.ts`, `src/preprocess.ts`, new `src/figure-locator/request.ts` (precedence `image:`, `recreate:`, `figure_request`; arXiv id detection), `src/figure-locator/index.ts` (ladder skeleton with the PDF step only), `tests/contract/<card>.test.ts`
- **Depends on:** W3

### W5. arxiv-source-step

- **Outcome:** with the committed HTML and e-print listing fixtures for `2410.15332v3`, `tests/unit/arxiv-source.test.ts` maps `Figure 4` to `fig-algo` through `<figure id="S4.F4">` and resolves `figs/figs/fig-algo.pdf` from the `\includegraphics` list, maps an extension-less `\includegraphics{figs/figs/fig-eval-data-dist}`, falls through on a two-`\includegraphics` environment and on an EPS-only asset, and reports `unavailable` on a simulated network error; `FIGURE_ARXIV_SOURCE=1 npx ts-node scripts/figure-arxiv.ts 2410.15332v3 "Figure 4" /tmp/out` (online, optional) writes `figure-4.jpg` rendered from the e-print PDF with provenance `arxiv-source` and populates `state/cache/arxiv/2410.15332v3/`.
- **Files:** new `src/figure-locator/arxiv-source.ts`, `scripts/figure-arxiv.ts`, `tests/unit/arxiv-source.test.ts`, `tests/fixtures/figure-locator/hu-2410.15332v3/{html.html,eprint-listing.txt,fig-algo.tex}`; `.gitignore` already covers `state/**`
- **Depends on:** W3

### W6. html-figures-and-dom-dedupe

- **Outcome:** `tests/unit/dom-figures.test.ts` runs the extended snapshot parser on the committed trimmed Anthropic page and yields 8 candidates labelled Figure 1, Figure 2, Table 1, Figure 3, Figure 4, Table 2, Figure 5, Figure 6 with unwrapped CDN URLs, and on a trimmed arXiv HTML page yields `<object data>` SVG candidates by `S4.F4` id; IoU de-duplication keeps a two-image `<figure>` wrapper over its children and takes the image box for a one-image wrapper; `grep -rnE 'class\*="graph" i|class\*="figure" i' src/figure-locator src/preprocess.ts src/state.ts` prints nothing and exits 1; `grep -rn setViewportSize src/figure-locator` prints nothing and exits 1. The legacy hits at `src/figure-vlm.ts:426`, `:775` and `:1151` are outside this card's Files and stay until W10 deletes that module.
- **Files:** `src/preprocess.ts` (`parseFigureCandidates` extension), `src/state.ts` (`FigureCandidate` gains `label`, `sources[]`), new `src/figure-locator/dom-figures.ts` (`intersectionOverUnion`, `loadPlaywright`, `renderReady` moved; `fromSnapshot`, `fromLivePage`), `tests/unit/dom-figures.test.ts`, `tests/fixtures/figure-locator/anthropic-expertise/page.html` (trimmed to the article body), `tests/fixtures/figure-locator/hu-2410.15332v3/html.html` (shared with W5)
- **Depends on:** W3

### W7. numbered-vision-picker

- **Outcome:** `tests/unit/figure-picker.test.ts` passes with an injected fake vision function: two candidate bands produce one call whose prompt names the caption text and whose images are labelled `Candidate 1`, `Candidate 2` and the page; a reply of `2` selects the second; `0`, prose and a thrown transport error return null; a pinned request with null ends `picker-declined` or `picker-unavailable`; an unpinned request with a transport error takes the largest candidate with a note; a single candidate makes no call; `FIGURE_VERIFY=1` adds exactly one yes/no call and `no` rejects pinned and unpinned alike. The adapter calls today's `runVision` and is the single edit point for stage 17 W13's binding.
- **Files:** new `src/figure-locator/picker.ts`, `tests/unit/figure-picker.test.ts`
- **Depends on:** W2

### W8. locator-ladder-and-finalise-integration

- **Outcome:** `FIGURE_LOCATOR=deterministic npm run reextract -- output/<slug>.json ../explainer-batch/input/_held/w35275.pdf "Figure 1"` writes `output/<slug>/figure-1.jpg`, sets `lead_figure.page` to 5 and `provenance` to `pdf-vector-crop`, and logs `vision calls: 0`; with `FIGURE_LOCATOR=legacy` the existing path runs unchanged; `attachFigureImage` (or stage 17's `finalizeResult` step 6 when it exists) branches on the switch; recreation receives `LocatedFigure` bytes; `scripts/reextract-all.ts --dry-run output/` prints label, page and provenance per file without writing; `npm test` passes.
- **Files:** `src/figure-locator/index.ts` (full ladder), `src/output.ts`, `src/batch.ts`, `src/figure-data.ts` (consume `LocatedFigure`), `scripts/reextract-figure.ts`, new `scripts/reextract-all.ts`, `tests/unit/figure-locator.test.ts`, `docs/FIGURE-EXTRACTION.md` (new section, legacy section marked deprecated)
- **Depends on:** W4, W5, W6, W7

### W9. evaluation-harness

- **Outcome:** `npm run eval:figures` runs E1 to E10 from Evaluation set against `../explainer-batch/input/_held/` and the scratch arXiv PDFs (skipping cases whose source is absent) and prints a table with label, page, provenance, calls and pass or fail per case, all local cases passing; `tests/unit/figure-locator-eval.test.ts` runs the offline subset (captions, regions, DOM labels) on the committed snapshots and is part of `npm test`; the two-page same-label fixture built locally with `pdfseparate` exercises the page-hint tie-breaker.
- **Files:** new `scripts/eval-figures.ts`, `tests/unit/figure-locator-eval.test.ts`, `tests/fixtures/figure-locator/cases.json` (the E1 to E10 table), `package.json` (`eval:figures` script), `docs/FIGURE-EXTRACTION.md` (evaluation section)
- **Depends on:** W8

### W10. delete-the-vlm-module

- **Outcome:** `test ! -e src/figure-vlm.ts && echo gone` prints `gone`; `grep -rn 'FIGURE_VLM_' src scripts README.md docs/FIGURE-EXTRACTION.md` prints nothing and exits 1; `grep -rn "'sips'" src scripts` prints nothing and exits 1; `grep -rn setViewportSize src scripts` and `grep -rnE 'class\*="graph" i|class\*="figure" i' src scripts` each print nothing and exit 1 (moved here from W6; the only hits today are in the deleted module); `grep -n legacy src/figure-locator/index.ts` prints nothing and exits 1; `npm test` and `npm run eval:figures` pass; `docs/FIGURE-EXTRACTION.md` describes only the deterministic locator; the lines-deleted count in the commit is at least 1,286 for `src/figure-vlm.ts`. Coordinated with stage 17 W15, which deletes `src/vision.ts`'s ambient routing and `downscaleLongEdge`.
- **Files:** `src/figure-vlm.ts` (delete), `src/vision.ts` (`imageSizePx`, `downscaleLongEdge` delete), `src/model-config.ts` (`FIGURE_VLM_MODEL`, `FIGURE_VLM_VERIFY_MODEL` knobs), `src/index.ts` (vision preflight), `src/output.ts`, `scripts/reextract-figure.ts`, `docs/FIGURE-EXTRACTION.md`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `tests/contract/10`, `11`, `12`, `13` (re-frozen by the orchestrator against the new module before dispatch)
- **Depends on:** W9
