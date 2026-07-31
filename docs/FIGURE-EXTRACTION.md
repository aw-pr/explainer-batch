# Figure extraction pipeline

How the explainer pipeline turns a source document into a lead figure
embedded in the JSON output. The deterministic caption/gap-finder
(`figure-extract.ts`) has been **retired** in favour of a vision model
that looks at the rendered document the way a reader does.

## Current model: vision-driven selection

`src/figure-vlm.ts:extractFigureViaVlm` is the single entry point, called
from `output.ts:attachFigureImage` after the JSON is parsed (and from the
`reextract` script). Callers pass the explainer's own context (hero
headline, subtitle, section labels, chart titles) into the selection
prompt. Because the explainer already recreates headline results as its
own charts, the prompt steers towards a complementary conceptual figure
(architecture, pipeline, schematic, visual abstract) rather than a
results plot the charts duplicate.

### PDF path: two-pass zoom-refine

1. **Pass 1 picks the page.** `pdftoppm` renders width-normalised
   thumbnails (~820px) for pages `1..N`, capped by `FIGURE_VLM_MAX_PAGES`
   (default 24). Each thumbnail is labelled "Page N of M" in the prompt
   content, so the returned page number is unambiguous. The model replies
   with strict JSON: `{ found, page, bbox, source_figure, caption,
   alt_text, confidence }`.
2. **Pass 2 refines the box.** Only the chosen page is re-rendered at
   `FIGURE_VLM_REFINE_PX` wide (default 2200, close to the final crop
   resolution), and the model returns a tight bounding box around the
   figure body, excluding caption and body text. Thumbnails are too
   coarse for trustworthy coordinates; the refined box is what gets
   cropped.
3. **Crop.** The page is rendered at `FIGURE_VLM_DPI` (300), cropped to
   the refined bbox plus a small pad (`FIGURE_VLM_PAD`, default 0.005),
   then JPEG-encoded via `sips`.

### URL path: DOM-candidate choose

1. Playwright loads the page (lazy import; Chromium is only loaded for
   URLs) and scrolls through it so lazy-loaded images and client-side
   charts actually paint.
2. Figure-like elements (`figure`, `picture`, `svg`, `canvas`, `img`,
   plus `chart` / `figure` / `graph` class names) are enumerated,
   filtered by minimum rendered size, deduplicated (a tight inner image
   beats the wrapper that also contains the caption), and capped at 12
   candidates.
3. Each candidate is element-screenshotted, downscaled to at most 1568px
   on the long edge, and sent in one vision call labelled "Candidate 1"
   to "Candidate N". The model chooses one by number and supplies the
   figure name, caption, alt text and confidence.
4. The final crop is a fresh full-quality element screenshot of the
   chosen element. It clips to exact DOM bounds, so there is no
   bounding-box regression on this path.

Pages with zero candidates fall back to the previous full-page flow, now
tiled: the page is split into vertical segments short enough to survive
the vision size cap, the model picks a segment and a bbox within it, and
the bbox is mapped back through the segment offset. The crop still snaps
to a real DOM element when one genuinely overlaps the model's box
(minimum IoU 0.1; the tightest overlapping element wins).

### Image size cap

Vision providers silently downscale oversized images (Claude Opus-tier
caps the long edge at ~2576px), so a tall full-page screenshot used to
reach the model only a few hundred px wide, which is why URL bounding
boxes regressed. `runVision` now downscales every outgoing image to at
most 2500px on its long edge (via `sips`; on Linux the image is sent
as-is with a warning).

### Crop verification

Every produced crop gets one cheap vision check: does this image show a
single complete figure with no surrounding body text, sharp enough that
axis labels and legend text are legible? A rejection feeds
its reason into a retry of the selection, and the retry prompt also names
the failed pick (page, figure, bbox or candidate number), so "choose a
different figure" is actionable. The check fails open: a transport or
parse error never discards a crop. A crude blank-crop guard
(bytes-per-pixel below 0.006, or either side under 48px) rejects
unpainted-chart screenshots before a verification call is spent.

Selections below `MIN_CONFIDENCE` (0.35) or `found: false` drop the
image block.

The model selects autonomously when no directive is present. A
`<paper>.focus.md` sidecar is **optional**: `image: Figure N` pins a
specific figure, `image_caption:` / `image_alt:` override the
model-supplied text, and `image_page_hint:` biases the selection prompt
towards a page without constraining it.

## Routing & cost

The vision call is independent of the synthesis provider and is
**subscription-first** by default, because leftover subscription credit
is cheaper than metered API spend.

| Env var | Effect |
|---|---|
| `FIGURE_VLM_PROVIDER` | `claude` \| `openai`. Default: whichever subscription session is present (Claude OAuth first), else any API key. |
| `FIGURE_VLM_ROUTE` | `auto` (default) \| `subscription` \| `api`. `auto` prefers the subscription route and falls back to the API. |
| `FIGURE_VLM_MODEL` | Override the vision model (default: the provider's `batchModel`). |
| `FIGURE_VLM_MAX_PAGES` | Page cap for PDF render (default 24). |
| `FIGURE_VLM_ATTEMPTS` | Selection attempts before giving up; retries on transport failure, unparseable reply, a blank/uncroppable crop, or a verification rejection (default 2). |
| `FIGURE_VLM_DPI` | PDF crop render DPI, i.e. sharpness (default 300). |
| `FIGURE_VLM_MAX_PX` | Cap on the crop's longest side in px; bounds the inlined base64 size (default 2200). |
| `FIGURE_VLM_JPEG_QUALITY` | JPEG quality 1-100; size vs fidelity (default 90). |
| `FIGURE_VLM_REFINE_PX` | Width of the pass-2 single-page render (default 2200). |
| `FIGURE_VLM_PAD` | Fractional padding around the refined bbox (default 0.005; the two-pass box is tight and trustworthy, so generous padding only drags in body text). |
| `FIGURE_VLM_VERIFY` | Set `0` to disable the crop verification pass (default on). |
| `FIGURE_VLM_VERIFY_MODEL` | Model for the verification call (default: the selection model). |

**Resolution vs size.** The crop is rendered at `FIGURE_VLM_DPI`, capped
to `FIGURE_VLM_MAX_PX` on its longest side, then JPEG-encoded at
`FIGURE_VLM_JPEG_QUALITY`. Because the result is inlined as a base64
`data:` URL inside the explainer JSON, a larger or sharper image inflates
the JSON to roughly 4/3 of its byte size. Defaults (1600px, q85) land
most figures at roughly 300-600 KB with the 2200px/q90 defaults (about
triple the old 1600px/q85 weight, in exchange for axis labels that stay
legible). Lower `MAX_PX` / `DPI` if JSON weight matters more than
sharpness.

Routes by provider/auth (`src/vision.ts`):

- **Claude subscription**: Agent SDK single-turn over
  `CLAUDE_CODE_OAUTH_TOKEN`, image content blocks. Billed to the Max plan.
- **Claude API**: Anthropic Messages with base64 image blocks
  (`ANTHROPIC_API_KEY`).
- **OpenAI subscription**: `codex exec --image <file>` over ChatGPT auth
  (`~/.codex/auth.json`). Per-image labels become an ordered manifest
  appended to the prompt, since codex cannot interleave text and images.
- **OpenAI API**: Responses API with `input_image` (`OPENAI_API_KEY`).

## Figure-data recreation (experimental)

`FIGURE_RECREATE=1` (or a per-paper `recreate:` directive) adds a
post-clip pass that tries to recover the **data** behind the picked
figure so the website can render it natively with Apache ECharts instead
of showing a bitmap. The result lands in `recreated_figure` beside the
normal `image` block; the clip always remains the fallback, and current
renderers simply ignore the new field until the website grows an ECharts
renderer.

Recovery follows a strict provenance ladder, and the deciding gate is
deterministic code, not the model:

| Tier | Source | Accepted when |
|---|---|---|
| `supplied` | `data:` CSV/JSON sidecar next to the paper | always (no vision call) |
| `paper_exact` | numbers printed in the paper (results table, value labels, stated in text) | every series cites its location |
| `figure_estimated` | values read off the axes | only simple bar/scatter figures, at most `FIGURE_DATA_MAX_ESTIMATED_POINTS` (12) points, and never for line or stacked shapes |
| (none) | dense lines, log axes, error bands, unreadable values | pass returns nothing; the clip stands |

The extraction call sees the full-resolution crop plus the surrounding
paper pages (exact numbers usually live in a nearby table), must attach a
provenance claim and source citation to every series, and is told
outright that "not recoverable" is a good answer. Accepted extractions
are re-plotted headlessly (ECharts SSR to SVG, screenshotted via
Chromium) and one further vision call compares the re-plot against the
original crop; a mismatch also falls back to the clip. Estimated data
gets an approximation notice appended to its caption.

Sidecar directives (same `.focus.md` / `urls.txt` mechanism as `image:`):

| Directive | Effect |
|---|---|
| `recreate: Figure 3` | Enable recreation and pin both the figure pick and the recreation target. |
| `recreate: yes` / `recreate: no` | Enable for this paper, or opt out of a global `FIGURE_RECREATE=1`. |
| `recreate_x:` / `recreate_y:` | Free-text axis guidance passed to the extraction prompt. |
| `data: <file>.csv\|.json` | Supply the values yourself (tier `supplied`); CSV header row is `x-label,series…`, JSON matches the neutral shape. |

Env knobs: `FIGURE_RECREATE` (global switch), `FIGURE_DATA_MODEL`
(default: the vision model), `FIGURE_DATA_MAX_TOKENS` (2500),
`FIGURE_DATA_MAX_ESTIMATED_POINTS` (12), `FIGURE_RECREATE_VERIFY=0` to
skip the render-and-compare pass.

Offline check with no vision call or batch:
`npx ts-node scripts/smoke-figure-data.ts` exercises the supplied-data
path, the ECharts mapper, and the SSR render.

One interaction to know about: figure selection normally steers towards
a *conceptual* figure when the explainer already has charts. With
recreation enabled and no pinned target, the picked figure may therefore
be a diagram with no data to recover, which correctly falls back to the
clip. Pin the results figure with `recreate: Figure N` when you want the
data.

## Dependencies

- **poppler** (`pdftoppm`, `pdfinfo`): PDF render. `brew install poppler`.
- **`sips`**: macOS-only JPEG re-encode/downscale, also used for the
  vision size cap. On Linux the JPEG step falls back to raw PNG and
  oversized images are sent uncapped with a warning.
- **Playwright + Chromium**: URL figures and the recreation pass's
  render-and-compare screenshot.
  `npm i && npx playwright install chromium`. The PDF clip path needs neither.
- **echarts**: SSR re-plot for the recreation verify pass (pure npm dep).

## Manual re-extraction

`npm run reextract -- <json> <pdf-or-url> [figure-label] [--caption "..."] [--alt "..."] [--page N]`
patches the `image` block on an existing explainer without a new
synthesis run, using the same vision path and routing knobs. `--page N`
is a soft page hint; the figure label pins a specific figure.

## Deferred work

- **Per-page point sizes.** `pageSizePts` reads the first page's size and
  assumes uniform geometry; mixed-size PDFs could crop slightly off.
- **Candidate shortlist for PDFs.** A cheap first pass could narrow large
  PDFs to a few candidate pages before the full selection call, to cut
  tokens on the subscription route.
- **SVG crops.** `pdftocairo -svg` would keep vector figures sharp at any
  zoom and smaller than JPEG; deferred since raster crops are adequate.
