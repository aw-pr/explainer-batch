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
prompt as context. The prompt asks for the paper's key results figure, the
one carrying its headline finding, and falls back to a conceptual figure
(architecture, pipeline, schematic, visual abstract) only when the paper
has no results figure.

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
3. **Crop, with pad escalation.** The page is rendered at
   `FIGURE_VLM_DPI` (300) and cropped to the refined bbox plus a pad.
   Verification failures escalate the pad through
   0.5% → 2% → 4.5% (`CROP_PAD_STEPS`; the first step is
   `FIGURE_VLM_PAD`), and as a last resort the crop widens to the full
   page width over the bbox's vertical span — that step exists because a
   rotated y-axis label sits far left of where the model draws the box.
   Only when every step fails does the whole selection retry. The result
   is JPEG-encoded via `sips`.

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
axis labels and legend text are legible? On the PDF path a rejection
first escalates the crop pad (see pad escalation above); only when every
crop of the same bbox fails does the rejection feed its reason into a
retry of the *selection*, and the retry prompt names the failed pick
(page, figure, bbox or candidate number), so "choose a different figure"
is actionable — unless the figure is pinned, in which case a different
figure is not an acceptable answer. For an unpinned pick the check fails
open: a transport or parse error never discards a crop. For a pinned
figure the check is told the expected label ("the crop must be Figure 3
of the source document") and fails closed: a transport error, an
unparseable reply or a rejection all count as a failed check, and only an
explicit pass keeps the crop. The snapshot path verifies a pinned caption
match the same way before using it; an unpinned snapshot asset is still
used without verification. `FIGURE_VLM_VERIFY=0` turns verification off
for every pick, pins included. A crude blank-crop guard
(bytes-per-pixel below 0.006, or either side under 48px) rejects
unpainted-chart screenshots before a verification call is spent.

Selections below `MIN_CONFIDENCE` (0.35) or `found: false` drop the
image block.

The model selects autonomously when no directive is present. A
`<paper>.focus.md` sidecar is **optional**: `image: Figure N` pins a
specific figure, `image_caption:` / `image_alt:` override the
model-supplied text, and `image_page_hint:` biases the selection prompt
towards a page without constraining it.

A PDF URL source is downloaded to a temporary file and follows the PDF path;
HTML URL sources continue through the existing snapshot and live-page paths.

**Pinning means "this figure or nothing."** A retry after a failed crop
may re-crop the pinned figure, but a selection that names a *different*
figure, or names no figure at all, is rejected outright (drift guard, on
the PDF, URL-candidate and full-page paths) and the retry prompt tells
the model only the pinned label is acceptable. The pin's label is only
ever stamped on a pick the selection named as the pin and verification
confirmed. If the pin cannot be
satisfied the image block is dropped rather than silently substituted —
a wrong figure under the right label is worse than no figure. Two
practical consequences:

- A pinned figure past `FIGURE_VLM_MAX_PAGES` (default 24) fails with
  "no suitable figure" because the model never sees its page. Raise the
  env var (page-hint directives do not extend the render range).
- The page hint and pin work best together: the pin constrains *what*,
  the hint speeds up *where*.

**Captions are written for a glancing reader.** The selection prompt
requires the caption to translate any statistical construct (CCDF /
1 − F(x), tail parameters, log axes, error bands) into plain words —
first what a point on the figure means, then the takeaway. The same rule
lives in the synthesis skill for the explainer's own charts.

## Routing & cost

The vision call is independent of the synthesis provider and is
**subscription-first** by default, because leftover subscription credit
is cheaper than metered API spend.

| Env var | Effect |
|---|---|
| `FIGURE_VLM_PROVIDER` | `claude` \| `openai`. Default: whichever subscription session is present (Claude OAuth first), else any API key. |
| `FIGURE_VLM_ROUTE` | `auto` (default) \| `subscription` \| `api`. `auto` prefers the subscription route and falls back to the API. |
| `FIGURE_VLM_MODEL` | Override the vision model (default: the provider's `batchModel`). |
| `FIGURE_VLM_MAX_PAGES` | Page cap for PDF render (default 24). Raise it when pinning a figure that lives deeper in the PDF — the model cannot pick a page it never saw. |
| `FIGURE_VLM_ATTEMPTS` | Selection attempts before giving up; retries on transport failure, unparseable reply, a blank/uncroppable crop, or a verification rejection (default 2). |
| `FIGURE_VLM_DPI` | PDF crop render DPI, i.e. sharpness (default 300). |
| `FIGURE_VLM_MAX_PX` | Cap on the crop's longest side in px; bounds the inlined base64 size (default 2200). |
| `FIGURE_VLM_JPEG_QUALITY` | JPEG quality 1-100; size vs fidelity (default 90). |
| `FIGURE_VLM_REFINE_PX` | Width of the pass-2 single-page render (default 2200). |
| `FIGURE_VLM_PAD` | First step of the pad-escalation ladder (default 0.005; later steps 0.02 and 0.045 are fixed). Keep it tight — verification escalates automatically when labels get shaved, and generous padding only drags in body text. |
| `FIGURE_VLM_VERIFY` | Set `0` to disable the crop verification pass (default on). |
| `FIGURE_VLM_VERIFY_MODEL` | Model for the verification call (default: the selection model). |

**Resolution vs size.** The crop is rendered at `FIGURE_VLM_DPI`, capped
to `FIGURE_VLM_MAX_PX` on its longest side, then JPEG-encoded at
`FIGURE_VLM_JPEG_QUALITY`. Because the result is inlined as a base64
`data:` URL inside the explainer JSON, a larger or sharper image inflates
the JSON to roughly 4/3 of its byte size. The 2200px/q90 defaults land
most figures at roughly 300-600 KB (about triple the old 1600px/q85
weight, in exchange for axis labels that stay legible). Lower `MAX_PX` /
`DPI` if JSON weight matters more than sharpness.

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
| `data: <file>.csv\|.json` | Supply the values yourself (tier `supplied`); CSV header row is `x-label,series…` and blank cells become gaps (`null`), JSON matches the neutral shape in `src/types/explainer-json.ts`. |

Env knobs: `FIGURE_RECREATE` (global switch), `FIGURE_DATA_MODEL`
(default: the vision model), `FIGURE_DATA_MAX_TOKENS` (2500),
`FIGURE_DATA_MAX_ESTIMATED_POINTS` (12), `FIGURE_RECREATE_VERIFY=0` to
skip the render-and-compare pass.

Offline check with no vision call or batch:
`npx ts-node scripts/smoke-figure-data.ts` exercises the supplied-data
path, the ECharts mapper, and the SSR render.

One interaction to know about: figure selection prefers the key results
figure, but if the paper has none it falls back to a conceptual figure.
With recreation enabled and no pinned target, the picked figure may then
be a diagram with no data to recover, which correctly falls back to the
clip. Pin the figure with `recreate: Figure N` when you want specific data.

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

- **Text-layer page targeting for pins.** A pinned figure past
  `FIGURE_VLM_MAX_PAGES` currently needs the env var raised by hand; the
  PDF text layer could locate "Figure N" and extend the render range to
  its page automatically.
- **Fail-open on verification transport errors (unpinned picks).** When
  the verification *call* itself errors (e.g. codex quota exhaustion) on
  an unpinned pick, the unverified crop is kept; a pinned figure is
  dropped instead. Deliberate for transient blips, but a long outage ships
  unchecked crops; consider distinguishing "model said no" from "no
  answer" with a retry.
- **`reextract` keeps the stale caption.** Patching a new image onto an
  existing JSON leaves the previous caption/alt unless `--caption` /
  `--alt` are passed; it should refresh them from the new selection by
  default.
- **Candidate shortlist for PDFs.** A cheap first pass could narrow large
  PDFs to a few candidate pages before the full selection call, to cut
  tokens on the subscription route.
- **SVG crops.** `pdftocairo -svg` would keep vector figures sharp at any
  zoom and smaller than JPEG; deferred since raster crops are adequate.
