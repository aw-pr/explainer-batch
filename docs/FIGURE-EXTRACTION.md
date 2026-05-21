# Figure extraction pipeline

How the explainer pipeline turns a figure label into an image embedded in
the JSON output, and what deferred work would push it further.

## Current model: directive-only

The pipeline does not ask the model to pick figures from the paper. Two
runs of the same paper at different times both came back with no figure
chosen, and when the model did pick one historically it routinely
landed on captions, body prose, or whichever rasterised glyph happened
to sit at the right Y position. The model cannot see the PDF document
block in a way that makes visual judgement reliable.

So figure attachment is **directive-only**: an image is attached when a
`<paper>.focus.md` sidecar names one, and otherwise the field is dropped
from output. See `input/.focus.md.example` and `README.md` for the
sidecar format.

The model's job is prose, pills, charts, and structure. The image is
out-of-band.

## Two extraction tiers

`src/figure-extract.ts:deriveFigureCrop` returns a single
`{ page, cropPts, column, tier }` rectangle that both the rasteriser and
the post-extraction text-density gate consume.

### Tier 1 — embedded raster

When the page contains an embedded PNG/JPEG `>= 600x300` (slide-style
visual abstracts, scanned diagrams), `pdfimages -png -f -l` extracts
the largest by file size. Lossless, fast, no cropping needed.

`hasEmbeddedImage()` in `figure-extract.ts` is the tier-1 check.

### Tier 2 — vector page raster

When the figure is vector (matplotlib PDF backend, TikZ, pgfplots,
Inkscape) there is no image to extract. The figure only exists as a
sequence of drawing operators that become pixels at render time.

`pdftoppm` rasterises the whole page at 150 dpi; we then crop to the
figure's bounding rectangle. Two paths:

- **Directive path** (`opts.pageHint` set): crop = `[60pt header skip,
  captionTopY - 4pt]`. The figure is above the caption in essentially
  100% of academic papers, so we trust that rule and the user's pinned
  page. Bypasses both `isPageCodeHeavy` and the gap-finder.

- **Unguided path** (legacy, no `pageHint`): `findGapAbove` /
  `findGapBelow` look for the largest text-free vertical gap above and
  below the caption Y. Brittle when the figure has internal text labels
  (architecture diagrams), because intra-figure gaps look like
  inter-block gaps to a word-position heuristic.

Horizontal: when `findColumnBounds` detects a two-column layout from
the word x-distribution, the crop is constrained to the caption's
column with a 6pt bleed. Otherwise full page width.

## Text-density gate

After cropping, `output.ts:cropIsMostlyText` runs `pdftotext
-bbox-layout` on the same `{page, cropPts}` the rasteriser used and
computes the word-area intersection. If the ratio exceeds 0.30, the
image block is dropped with a stderr warning. Catches a bad
`image_page_hint` or a caption match that landed on a prose page.

## Deferred: SVG-based extraction

The current Tier 2 path renders the whole page to raster pixels then
crops. The vector information is thrown away. Better, in principle:

1. `pdftocairo -svg -f <page> -l <page> input.pdf -` — emit the page as
   SVG. Drawing primitives, text, and clip paths preserved.
2. Clip the SVG `viewBox` to `[0, headerSkip] → [pageWidth, captionY -
   4pt]`. For the directive path we already know the caption Y, so
   bounding-box detection is unnecessary — pure viewport math.
3. Emit as `data:image/svg+xml;base64,<encoded>`. Browsers render
   natively, sharp at any zoom.

Wins:
- Sharp at any zoom; no DPI choice.
- Typical diagram SVG is 20-80 KB vs. 150-200 KB JPEG.
- Text inside the figure (layer labels) stays selectable and
  accessible to screen readers.

Risks the original audit flagged that are real:
- Complex clip paths, image patterns, or font embeddings can translate
  imperfectly from PDF to SVG. Renders fine in one browser, breaks in
  another.
- Embedded rasters inside a figure (diagram with a bolted-on
  screenshot) get re-emitted as base64 PNG inside the SVG, so file
  size can balloon.
- The unguided path still needs bounding-box detection (no caption Y
  to anchor against). Not our problem while attachment is
  directive-only.

Scope when we land this:
- New branch inside `extractFigureAsDataUrl`: when directive path AND
  `tier === 'vector'`, try SVG; fall back to PNG raster if the SVG
  output is empty or malformed.
- Gate behind `EXPLAINER_SVG_FIGURES=1` env var for the first few runs
  to A/B against the JPEG path.
- Test on architecture-paper Figure 3 (the worked case from the
  current pipeline) then on a tighter two-column layout.

Maps to the original audit's deferred fix #8.

## Failure modes still on the table

- **Wide figures on two-column pages**: column detection correctly
  returns null when the figure spans both columns, but the resulting
  full-width crop can pick up marginalia. Acceptable for now.
- **Multi-figure pages**: if a page has Figure 3a and Figure 3b
  side-by-side, the directive crop captures both. Real solution is
  per-subfigure bbox detection (SVG path above).
- **Bottom-of-page figures**: rare in academic papers but breaks the
  "figure is above caption" rule. Directive path will crop the wrong
  region. Worked around manually via `image_page_hint` pointing at
  the adjacent page if needed.
