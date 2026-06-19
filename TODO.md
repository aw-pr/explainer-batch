# TODO

Open follow-ups noted during recent work. Not a roadmap — just a parking lot so things don't get lost.

## Figure extraction

The deterministic `figure-extract.ts` (caption scan + gap-finder + tier-1
embedded raster) has been **retired**. Figure selection is now vision-driven
(`src/figure-vlm.ts` + `src/vision.ts`): render the document, let a VLM pick
the figure and bbox, crop from the source render. Subscription-first routing.

Open follow-ups on the new path (see `docs/FIGURE-EXTRACTION.md`):

- **Validate both providers live.** Wiring compiles; needs a real run on Claude
  OAuth and OpenAI/codex against a paper and a URL.
- **Token cost on large PDFs.** Whole-doc render sends up to `FIGURE_VLM_MAX_PAGES`
  page images per selection. A cheap candidate-shortlist pass could cut this.
- **Per-page geometry.** `pageSizePts` assumes uniform page size; mixed-size
  PDFs may crop slightly off.

## Model behaviour

- **Opus 4.7 schema drift is persistent.** Every Claude batch run we've inspected emits `paragraphs_html` (no `paragraphs`) and `end_takeaway.heading/body_html` (not `label/body`). The normaliser in `src/output.ts` covers this, but it'd be cleaner to either (a) tighten `skill.md` to call out both fields explicitly in the checklist, or (b) drop the drifted keys from the schema entirely and only document the canonical ones.
- **Validation warnings still appear post-normaliser.** The validator runs *before* normalisation in `quality.ts`, so we still see "sections must include paragraphs" warnings on every Claude run. Move validation after normalisation, or have it inspect both shapes.
- **Extended thinking / reasoning not wired through.** No `thinking` parameter on the Claude batch path. If we want high-reasoning runs, add a `THINKING_BUDGET` env knob in `src/providers.ts` — would need testing for batch cost impact.

## Plumbing

- **Per-paper image override has no skill.md visibility.** The model still gets the prose hint, but doesn't know the directive lines were stripped. Could include a brief mention in the user instruction so the model doesn't redundantly try to pick a different figure.

## Documentation

_(AGENTS.md/CLAUDE.md duplication, `config/models.json.example`, and the
committed runtime lock are resolved as of the public-release pass.)_
