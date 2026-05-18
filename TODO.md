# TODO

Open follow-ups noted during recent work. Not a roadmap — just a parking lot so things don't get lost.

## Figure extraction

- **Tier-1 image picker grabs decorative imagery.** `extractEmbeddedImage` in `src/figure-extract.ts` returns the largest embedded raster ≥600×300 on the figure's page. On infographic-heavy reports (e.g. CCAF), that's sometimes a fabric/photo background, not the chart. Add filters: minimum colour-variance / aspect-ratio bounds / reject single-tone or near-uniform images. Reproducible with `Figure 3.1` from `ccaf-2026-04-28-global-ai-in-financial-services-report-2.pdf` (returns a fabric texture).
- **Model rarely emits `image` block.** 5 of 63 historical explainers (8%) include a lead image. The skill prompt is heavily skip-biased and asks the model to "visually verify" the figure region — impossible in batch mode where it only has the file. Options: relax the verification rule, add infographic/survey-chart as an explicit valid image case, or build a heuristic auto-picker that runs *after* the model and offers a candidate when none was emitted. The per-paper override (`image: Figure N` in `.focus.md`) is the manual escape hatch in the meantime.
- **Multiple `Figure N.X` matches on the same page.** Decimal labels are disambiguated, but if a single page contains both the caption and an inline reference, the locator picks the first occurrence which is sometimes the wrong page entirely. Could weight caption-style matches more aggressively or look for proximity to actual figure regions.

## Model behaviour

- **Opus 4.7 schema drift is persistent.** Every Claude batch run we've inspected emits `paragraphs_html` (no `paragraphs`) and `end_takeaway.heading/body_html` (not `label/body`). The normaliser in `src/output.ts` covers this, but it'd be cleaner to either (a) tighten `skill.md` to call out both fields explicitly in the checklist, or (b) drop the drifted keys from the schema entirely and only document the canonical ones.
- **Validation warnings still appear post-normaliser.** The validator runs *before* normalisation in `quality.ts`, so we still see "sections must include paragraphs" warnings on every Claude run. Move validation after normalisation, or have it inspect both shapes.
- **Extended thinking / reasoning not wired through.** No `thinking` parameter on the Claude batch path. If we want high-reasoning runs, add a `THINKING_BUDGET` env knob in `src/providers.ts` — would need testing for batch cost impact.

## Plumbing

- **Per-paper image override has no skill.md visibility.** The model still gets the prose hint, but doesn't know the directive lines were stripped. Could include a brief mention in the user instruction so the model doesn't redundantly try to pick a different figure.

## Documentation

_(AGENTS.md/CLAUDE.md duplication, `config/models.json.example`, and the
committed runtime lock are resolved as of the public-release pass.)_
