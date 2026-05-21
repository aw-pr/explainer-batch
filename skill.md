---
name: explainer-batch
description: "Create JSON explainer articles from academic papers for a research website. Use this skill whenever the user drops a PDF of a research paper, arXiv link, or asks for an 'explainer' or 'research summary'. The output is a structured JSON object consumed by a React renderer — you do not write HTML for the page layout itself; inline markup inside paragraphs, pills, and references is allowed where shown."
---

## Claude.ai Compatibility

- Exported for Claude.ai compatibility.
- See `README.md` in this skill bundle for full portability notes.

- Strict mode enabled.


# Research Explainer Skill

You produce a publication-ready JSON explainer article from an academic research paper. A React renderer turns that JSON into a page on the website.

Your job is to read the paper, understand its real contribution, and surface it richly: numbers when the paper is empirical, named concepts when the paper is a framework, and a Chart.js chart when the paper has a figure worth recreating.

## Steps

1. Read the paper end to end. Look at the figures and tables as well as the prose.
2. Decide whether the paper is primarily empirical (measured results) or conceptual (a framework, taxonomy, or argument).
3. Fill every required field in the JSON schema below.
4. Recreate the paper's central figure as a Chart.js chart. Put the most important chart first — it renders after the opening prose section.
5. Return only the JSON object.

## Output format

The first character of your response must be `{` and the last must be `}`. No preamble, no markdown fences, no explanation before or after.

---

## JSON schema

```
{
  "version": 1,

  "metadata": {
    "title":         "Topic: First Author Surname (Year)",
    "eyebrow":       "Research Explainer · Author Surname (Year)",
    "date_created":  "YYYY-MM-DD",
    "filename_slug": "YYYY-MM-DD_authorsurname_short-title_explainer"
  },

  "hero": {
    "headline":         "Plain-text headline",
    "headline_html":    "Headline with <span>key phrase</span> for amber highlight",
    "subtitle":         "1–2 sentence summary of the core finding or argument",
    "publication_date": "Published Month Year"
  },

  "top_block": <pills or takeaway — see below>,

  "charts":   [ <0–4 chart objects, omit if none> ],

  "image":    <NEVER emit; supplied externally via directive sidecar>,

  "sections":      [ <2–5 section objects> ],
  "end_takeaway":  <object or omit>,
  "references":    [ "<HTML string>" ]
}
```

### top_block

Use `pills` when the paper has either:
- two or more measured headline findings, or
- a central ordered set of named stages, roles, concepts, or mechanisms (2–6 items) that a reader should be able to scan immediately.

```json
{
  "kind": "pills",
  "pills": [
    { "number": "2.58×", "description": "average end-to-end latency reduction vs standard PD disaggregation", "accent_color": "#4dabf7" },
    { "number": "89%",   "description": "of GPU memory wasted on prefill instances in standard disaggregated serving", "accent_color": "#ff6b6b" },
    { "number": "1.72×", "description": "more requests meeting SLO on Llama 3.1-70B under production load", "accent_color": "#51cf66" }
  ]
}
```

Concept pills use the same shape, with a short label in `number`:

```json
{ "number": "Agentic AI", "description": "pursues complex goals with limited supervision and crosses into genuine decision rights", "accent_color": "#ff6b6b" }
```

Otherwise use a takeaway:

```json
{ "kind": "takeaway", "label": "KEY CONTRIBUTION", "body": "2–3 sentence summary of the core contribution." }
```

Include `end_takeaway` only when `top_block.kind` is `"pills"`.

### section

```json
{
  "label": "The core question",
  "paragraphs": ["Plain-text paragraph.", "Another paragraph."],
  "paragraphs_html": ["Paragraph with <strong>markup</strong>.", "Another paragraph."],
  "list": {
    "ordered": true,
    "style": "steps",
    "intro": "Optional short intro.",
    "items": [
      { "label": "Decision 1", "body": "What the first decision covers." },
      { "label": "Decision 2", "body": "What the second decision covers." }
    ]
  }
}
```

`paragraphs_html` mirrors `paragraphs` with inline markup (`<strong>`, `<em>`, `<a href="..." target="_blank" rel="noopener noreferrer">`). Include it whenever a paragraph has useful inline emphasis.

Use `list` when the source material is genuinely a sequence, taxonomy, or named set of roles or steps — not to decorate ordinary prose.

### chart

```json
{
  "title": "Chart card title",
  "caption": "Source attribution in plain text.",
  "config_json": { /* Chart.js config — JSON-compatible */ }
}
```

Use any Chart.js type the data calls for: grouped bar, stacked bar, line, radar, scatter. Label arrays instead of `ticks.callback` for axis formatting. Explain acronyms in the caption, not the title.

**Choose the chart type by trigger, not default.** Bar is not the safe pick — match the shape of the data:

- **radar**: 3-6 systems compared on the same set of 3+ comparable metrics; capability or profile shapes. If the paper itself uses a radar/spider chart, reproduce that shape.
- **scatter**: two continuous variables plotted against each other (cost vs accuracy, latency vs throughput, parameters vs benchmark score).
- **line**: any series indexed by time, training steps, or another continuous axis.
- **grouped or stacked bar**: comparison across discrete categories with a single scalar (or stacked components) each.

Pie and doughnut are off the menu. Share-of-whole splits belong in `top_block.pills` or prose, not a chart.

If the paper's own central figure is a radar, spider, scatter, or line, reproduce that shape. Do not collapse it to a bar.

**Every numeric axis must carry its unit.** Set `options.scales.<axis>.title.text` to the real quantity and unit from the paper, and set `options.scales.<axis>.title.display` to `true`. Examples: `"Tokens per second"`, `"Throughput (tok/s/GPU)"`, `"Latency (ms)"`, `"Cost per million tokens (USD)"`, `"Memory (GB)"`. Never use `"Value"`, `"Amount"`, `"Number"`, a blank string, or leave `display: false` on a numeric axis. Category axes (model names, layer types, stages) do not need a unit — a numeric axis always does.

### references

One entry per primary source. Raw HTML string with the URL wrapped in an anchor:

```json
[
  "Author, A., & Author, B. (Year). Title. <em>Journal</em>, <em>Vol</em>(issue), pages. <a href=\"https://doi.org/10.xxxx\" target=\"_blank\" rel=\"noopener noreferrer\">https://doi.org/10.xxxx</a>"
]
```

---

## Working with figures in the paper

When the paper contains figures — results charts, conceptual diagrams, architecture sketches, stage models — read them for context, but emit nothing to the `image` field.

**Before emitting any chart, run two checks against the data you are about to put in it:**

1. **Is this a share-of-whole?** If the values sum to ~100% or ~1.0, or read as "X% does A, Y% does B" — that is `top_block.pills` or prose, not a chart. A two-value split like `1.6 / 98.4` rendered as bars is the same proportion in disguise; bar-encoding it does not make it a chart.
2. **Are the values an ordinal ranking?** If the dataset is `[1, 2, 3, 4]`, `[0, 1, 2, 3]`, or any sequence that just encodes "this comes before that" rather than measured magnitudes — that is prose, not a chart. Bar height must encode a real quantity (tokens per second, accuracy, latency, cost). Rank order belongs in a numbered list.

If either answer is yes, do not emit the chart. Find a different cut of the paper that has genuine magnitudes to compare, or just write it in prose.

Then, for what does qualify:

- For a **data-bearing figure** (measured values, comparisons, trends): reproduce it as a Chart.js chart in `charts`. Match the axes, groupings, and data points. If multiple central results figures exist and each adds a distinct story, include multiple charts.
- **Never chart a checklist, conformance table, or category list.** If every value would be the same number (all 100%, all `true`, all `2`, all "yes"), or the axis has no meaningful scale, it is not a chart — rewrite it as a `list` inside a prose section, or a `takeaway` / `pills` block. Charts exist to show *variation*; equal-height bars communicate nothing.
- **Never chart a single number or a single proportion.** One headline figure, a share-of-whole split (whether pie, doughnut, or bar), or one metric with no second series is a *pill*, not a chart — emit it in `top_block.pills` and state it in prose. A chart must carry at least two genuinely different data points with real magnitudes that a reader compares against each other (a trend over time, categories at different measured magnitudes, multiple series). If the figure collapses to "the number is X" or "the split is X/Y", it belongs in pills.
- Put the most important chart first — it renders after the first prose section, below the opening text.

**Do not emit an `image` field.** Conceptual figures (visual abstracts, architecture diagrams, framework figures) are attached downstream from a per-paper directive sidecar (`<paper>.focus.md`). Your job is to author the prose, pills, charts, and structure; the image is supplied externally or omitted entirely.

Prose sections may refer to figures by number so the reader can find them in the original paper. Do not invent figure content — if a figure's values or labels are unclear, say so or leave the detail out.

---

## Headline rules

Plain-text lead clause + `, ` + contrast clause. Wrap the key phrase after the comma in `<span>` in `headline_html` only.

```
"headline":      "AI makes novice developers faster, but quietly stops them from learning",
"headline_html": "AI makes novice developers faster, but <span>quietly stops them from learning</span>"
```

- Use a comma before `but` / `yet` / `while`.
- No semicolons.
- No em dashes (— is banned anywhere in the document).

---

## Writing the prose

Write like a well-edited long-form blog post. Second person is fine where it helps. Concrete numbers, plain explanations of jargon on first use, 2–3 short paragraphs per section. A reader who never opens the PDF should understand the paper's contribution in under four minutes.

**Voice:** Professional-informal. Serious ideas, light touch. British dry wit and understatement. Assertive — take positions, state findings directly. Mix short punchy sentences with longer analytical ones. End sections on a sharp closer, not a trailing observation.

**Hard rules:**
- No em dashes anywhere. Use a comma, parenthesis, or restructure.
- No corporate jargon: leverage, ecosystem, robust, seamless, pain points, bandwidth (metaphorical), synergy, circle back.
- No AI tell-tales: delve, it's worth noting, in conclusion, fascinating, certainly.
- No hedging openers ("In today's rapidly changing world...").
- No rhetorical questions as section labels.

---

## Pre-delivery checklist

- [ ] Output is a single valid JSON object, starts with `{`, ends with `}`.
- [ ] `metadata.filename_slug` follows `YYYY-MM-DD_authorsurname_short-title_explainer`.
- [ ] `hero.publication_date` uses `"Published Month Year"`.
- [ ] `top_block` is `pills` when the paper has measured results or a central 2–6 item sequence; otherwise `takeaway`. `end_takeaway` is present iff `top_block.kind === "pills"`.
- [ ] Every chart comes from real data or a faithfully recreated figure from the paper. The most important chart is first.
- [ ] No chart has uniform values (all bars equal, all rows `true`, all categories the same count). If a "chart" is really a checklist or membership table, it belongs in a `list` or `takeaway`, not `charts`.
- [ ] No chart conveys just a single number or one share-of-whole split (whether pie, doughnut, or 2-bar). Single figures and proportions go in `top_block.pills`; a chart must compare at least two genuinely different data points with real magnitudes.
- [ ] No chart encodes an ordinal ranking as bar height (datasets like `[1, 2, 3, 4]` or `[0, 1, 2, 3]` where the numbers mean "order", not "amount"). Rank order goes in a numbered list or prose.
- [ ] Every numeric chart axis has a real unit in `options.scales.<axis>.title.text` with `title.display: true` — never `"Value"`, `"Amount"`, `"Number"`, blank, or hidden.
- [ ] No `image` field is emitted. The image block is supplied externally via a per-paper directive sidecar; the model does not author it.
- [ ] `sections` has 2–5 entries, each with a `label` and either `paragraphs` or `list`.
- [ ] `references` contains the primary source with a clickable anchor (`target="_blank"`, `rel="noopener noreferrer"`).
- [ ] No em dashes, corporate jargon, or AI tell-tales in prose.
