# Figure extraction pipeline

How the explainer pipeline turns a source document into a lead figure
embedded in the JSON output. The deterministic caption/gap-finder
(`figure-extract.ts`) has been **retired** in favour of a vision model
that looks at the rendered document the way a reader does.

## Current model: vision-driven selection

`src/figure-vlm.ts:extractFigureViaVlm` is the single entry point, called
from `output.ts:attachFigureImage` after the JSON is parsed. It:

1. **Renders the whole document to images.**
   - PDF → `pdftoppm` thumbnails (width ~820px), pages `1..N` capped by
     `FIGURE_VLM_MAX_PAGES` (default 24).
   - URL → Playwright full-page screenshot (lazy import; Chromium only
     loaded for the URL path).
2. **Asks a vision model to pick one figure** and return strict JSON:
   `{ found, page, bbox:[x0,y0,x1,y1] (normalized), source_figure,
   caption, alt_text, confidence }`. The system prompt biases towards a
   diagram/chart/visual-abstract that conveys the core idea, and away
   from prose, references, equations, and dense tables.
3. **Crops sharply from the source render** — not from the thumbnail:
   - PDF → re-renders the chosen page at `CROP_DPI` (150) cropped to the
     bbox in points, then JPEG via `sips`.
   - URL → re-screenshots the live page with a `clip` rectangle.
4. Returns a `data:` URL plus caption/alt. Selections below
   `MIN_CONFIDENCE` (0.35) or `found:false` drop the image block.

The model now selects autonomously when no directive is present. A
`<paper>.focus.md` sidecar is **optional**: `image: Figure N` pins a
specific figure, and `image_caption:` / `image_alt:` override the
model-supplied text. (`image_page_hint:` is parsed for backward
compatibility but no longer used — the model finds the page itself.)

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
| `FIGURE_VLM_ATTEMPTS` | Selection attempts before giving up; retries on transport failure, unparseable reply, or a blank/uncroppable crop (default 2). |
| `FIGURE_VLM_DPI` | PDF crop render DPI — sharpness (default 150). |
| `FIGURE_VLM_MAX_PX` | Cap on the crop's longest side in px; bounds the inlined base64 size (default 1600). |
| `FIGURE_VLM_JPEG_QUALITY` | JPEG quality 1–100; size vs fidelity (default 85). |
| `FIGURE_VLM_PAD` | Fractional padding around the model bbox so tight boxes don't clip outer labels (default 0.022). |

**Resolution vs size.** The crop is rendered at `FIGURE_VLM_DPI`, capped to
`FIGURE_VLM_MAX_PX` on its longest side, then JPEG-encoded at
`FIGURE_VLM_JPEG_QUALITY`. Because the result is inlined as a base64 `data:` URL
inside the explainer JSON, a larger/sharper image inflates the JSON roughly
4/3× its byte size. Defaults (1600px, q85) land most figures at ~150–250 KB.
Raise `MAX_PX`/`DPI` for sharper diagrams at the cost of heavier JSON.

Routes by provider/auth (`src/vision.ts`):

- **Claude subscription** — Agent SDK single-turn over `CLAUDE_CODE_OAUTH_TOKEN`, image content blocks. Billed to the Max plan.
- **Claude API** — Anthropic Messages with base64 image blocks (`ANTHROPIC_API_KEY`).
- **OpenAI subscription** — `codex exec --image <file>` over ChatGPT auth (`~/.codex/auth.json`).
- **OpenAI API** — Responses API with `input_image` (`OPENAI_API_KEY`).

## Dependencies

- **poppler** (`pdftoppm`, `pdfinfo`) — PDF render. `brew install poppler`.
- **`sips`** — macOS-only JPEG re-encode/downscale. On Linux the JPEG
  step falls back to raw PNG.
- **Playwright + Chromium** — only for URL figures:
  `npm i && npx playwright install chromium`. The PDF path needs neither.

## Manual re-extraction

`npm run reextract -- <json> <pdf-or-url> [figure-label] [--caption "..."] [--alt "..."]`
patches the `image` block on an existing explainer without a new
synthesis run, using the same vision path and routing knobs.

## Deferred work

- **Per-page point sizes.** `pageSizePts` reads the first page's size and
  assumes uniform geometry; mixed-size PDFs could crop slightly off.
- **Tall web pages.** Very long screenshots are sent whole to the model;
  consider tiling + per-tile selection if token cost bites.
- **Candidate shortlist.** For large PDFs, a cheap first pass could narrow
  to a few candidate pages before the full-resolution selection call, to
  cut tokens on the subscription route.
- **SVG crops.** `pdftocairo -svg` would keep vector figures sharp at any
  zoom and smaller than JPEG; deferred since raster crops are adequate.
