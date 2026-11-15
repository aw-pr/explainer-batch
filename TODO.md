# TODO

Open follow-ups noted during recent work. Not a roadmap — just a parking lot so things don't get lost.

## Figure extraction

The deterministic `figure-extract.ts` (caption scan + gap-finder + tier-1
embedded raster) has been **retired**. Local PDFs first try a conservative
embedded-image capture (`src/figure-locator/pdf-embedded.ts`); every other
layout is vision-driven (`src/figure-vlm.ts` + `src/vision.ts`): render the
document, let a VLM pick the figure and bbox, crop from the source render.
Subscription-first routing.

Open follow-ups (see `docs/FIGURE-EXTRACTION.md`):

- **Token cost on large PDFs.** Whole-doc render sends up to `FIGURE_VLM_MAX_PAGES`
  page images per selection. A cheap candidate-shortlist pass could cut this.
- **`reextract` is still a v1 tool.** It writes an inline `image` block rather
  than updating the v2 `lead_figure` sidecar.

## Model behaviour

- **Thinking / effort not wired through.** No `thinking` or effort parameter on
  the Claude routes. If we want high-reasoning runs, add an env knob in
  `src/providers.ts`; it would need testing for batch cost impact.

## Documentation

_(AGENTS.md/CLAUDE.md duplication, `config/models.json.example`, and the
committed runtime lock are resolved as of the public-release pass.)_
