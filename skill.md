---
name: explainer-batch
description: "Create JSON explainer articles from academic papers for a research website. Use this skill whenever the user drops a PDF of a research paper, arXiv link, or asks for an 'explainer' or 'research summary'. The output is a structured JSON object consumed by a React renderer; you do not write HTML for the page layout itself, though inline markup inside paragraphs, pills, and references is allowed where shown."
---

## Claude.ai Compatibility

- Exported for Claude.ai compatibility.
- See `README.md` in this skill bundle for full portability notes.

- Strict mode enabled.


# Research Explainer Skill

You produce a publication-ready JSON explainer article from an academic research paper. A React renderer turns that JSON into a page on the website.

Your job is to read the paper, understand its real contribution, and surface it richly: numbers when the paper is empirical, named concepts when the paper is a framework, and a Chart.js chart only when the data genuinely warrants one (often none).

## Steps

1. Read the paper end to end. Look at the figures to understand the argument, but take every number from the text and the tables.
2. Decide whether the paper is primarily empirical (measured results) or conceptual (a framework, taxonomy, or argument).
3. Fill every required field in the JSON schema below.
4. If the paper has real measured magnitudes worth comparing, draw a Chart.js chart only when every value in it is stated in the text or a table (see the chart-decision rules below); many papers correctly get zero charts. If you do include charts, put the most important one first; it renders after the opening prose section.
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

  "top_block": <pills or takeaway, see below>,

  "charts":   [ <0–4 chart objects, omit if none> ],

  "figure_request": { "label": "Figure 3", "why": "<one plain sentence: what the figure shows and why a reader should see it>" } or null,

  "sections":      [ <2–5 section objects> ],
  "end_takeaway":  <object or omit>,
  "references":    [ "<HTML string>" ]
}
```

### metadata

Fill `title`, `eyebrow`, and `filename_slug` with the paper's real author byline. The author line sits directly beneath the paper title in the source, above the affiliation and abstract; when the fetched text opens with a `Detected paper author(s):` line, that is the byline, use it. Use the first author's surname for `filename_slug` and the `(Year)` in `title`. Never emit a placeholder byline such as "Unknown", "Anonymous", "Unattributed", or "Unspecified": if the author is genuinely absent after you have looked below the title, drop the author segment rather than inventing a placeholder.

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

**Pill `description` strings are lowercase continuation phrases that complete the headline `number`** (e.g. `"of tasks completed without intervention"`), never standalone capitalised sentences.

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
  },
  "table": {
    "caption": "What the numbers are, in plain words (Table 2, p. 6).",
    "columns": ["Benchmark", "System A", "System B", "System C"],
    "rows": [
      ["Benchmark 1", "12.3", "45.6", "78.9"],
      ["Benchmark 2", "23.4", "56.7", "89.0"],
      ["Benchmark 3", "34.5", "67.8", "90.1"]
    ],
    "align": ["left", "right", "right", "right"]
  }
}
```

`paragraphs_html` mirrors `paragraphs` with inline markup (`<strong>`, `<em>`, `<a href="..." target="_blank" rel="noopener noreferrer">`). Include it whenever a paragraph has useful inline emphasis.

Use `list` when the source material is genuinely a sequence, taxonomy, or named set of roles or steps, not to decorate ordinary prose.

### table

Use `table` for a grid of values the reader *reads off and scans* rather than compares by magnitude: a metric × system matrix, a per-dataset breakdown, a feature comparison. `columns` are the headers (first column is usually the row label), `rows` are plain-text cells aligned to `columns` by index, and `align` (optional) sets per-column text alignment (default: first column left, the rest right). Cells are strings so units and ranges render verbatim (`"32.3"`, `"16-64%"`, `"OOM"`, `"O(N²)"`).

**A table is the right home for most multi-row numeric breakdowns. Reach for it before a bar chart** (full rule in "When does a chart earn its place?" below). Reserve charts for a genuine trend over time or another continuous axis (line) or a two-variable relationship (scatter), and only when the paper states every value. When in doubt between a bar chart and a table, choose the table.

Architecture, systems-design, framework, and position papers *tend* toward table-and-prose: their numbers usually sit better in `table` blocks and their argument in prose, so they often warrant **zero or one** chart. Treat that as a prior about what such papers usually hold, not a ceiling. A paper of any genre earns a chart when its text or tables state the values and the data passes the checks below. The rule forbids *manufacturing* charts to fill space; it does not mean suppressing a chart the stated values support because you have filed the paper under "conceptual".

### chart

```json
{
  "title": "Chart card title",
  "caption": "How to read the chart, then the takeaway, in plain words (Table 3, p. 12).",
  "config_json": { /* Chart.js config, JSON-compatible */ }
}
```

Use the Chart.js type the data calls for: grouped bar, stacked bar, line or scatter. Label arrays instead of `ticks.callback` for axis formatting. Explain acronyms in the caption, not the title.

**Captions translate first, then tag the source.** Every chart caption, and every `table` caption, has one shape: plain words for the glancing reader, then a short source tag in brackets at the very end naming the table or page the values come from, such as `(Table 3, p. 12)` or `(Table 2)`. A URL source has no page numbers, so its tag names the table or the section heading of the page, such as `(section "Results")`. Do not open a caption with an author and year; the explainer covers one paper. When a chart (or the pill set) leans on a statistical construct (a CCDF/`1 − F(x)`, a shape or tail parameter, a hazard rate, an elasticity, a log axis, confidence bands), the plain words must do two things: (a) open with a one-sentence *how to read it* stating what a single point on the chart literally means, and (b) finish with the takeaway a busy reader should leave with, just before the source tag. Never use a symbol or technical term in a caption, axis label, or pill description that the same text does not translate. For example: "For a Pareto tail, α = 0.92 means the model allows overruns large enough that its theoretical mean is not finite." This describes the size of extreme overruns under that model, not how often projects overrun. The plain-words gloss must not change what the statistic means. The audience includes readers who could follow the full paper but came here for the glanceable version; serve them first.

**Choose the chart type by trigger, not default.** Bar is not the safe pick; match the shape of the data:

- **scatter**: two continuous variables plotted against each other (cost vs accuracy, latency vs throughput, parameters vs benchmark score).
- **line**: a series indexed by time, training steps, or another continuous axis. Never join categories with a line: models, datasets or conditions on the x-axis are bars or a `table`.
- **grouped or stacked bar**: comparison across discrete categories with a single scalar (or stacked components) each. Never draw stacked bars on a log axis, because stacked segments only add up on a linear scale.

Pie, doughnut or radar charts are banned outright. Share-of-whole splits belong in `top_block.pills` or prose, and a set of systems scored across several metrics belongs in a `table`.

**Every numeric axis must carry its unit** (full rule in "When does a chart earn its place?" below).

### references

**Exactly one entry: the paper being explained.** This is the source citation
for *this* explainer, not a bibliography. Do not add the works the paper itself
cites (baselines, prior methods, related systems); they belong in the original
paper's reference list, not here. A single-element array, raw HTML string with
the URL wrapped in an anchor:

```json
[
  "Author, A., & Author, B. (Year). Title. <em>Journal</em>, <em>Vol</em>(issue), pages. <a href=\"https://doi.org/10.xxxx\" target=\"_blank\" rel=\"noopener noreferrer\">https://doi.org/10.xxxx</a>"
]
```

---

## Working with figures in the paper

When the paper contains figures (results charts, conceptual diagrams, architecture sketches, stage models), read every figure and name the one the explainer should show in `figure_request.label`. Use the paper's own numbering and noun (`Figure 3`, `Table 2`, `Figure 4b`). Prefer the paper's key results figure, the one carrying its headline finding. Only when it has none, choose its central architecture, pipeline or framework diagram. Write `why` as one plain sentence saying what the figure shows and why a reader should see it. Set `figure_request` to null when no figure would help. The pipeline finds and attaches the named figure. Figures are never a source of chart values. The same pipeline may additionally recreate that figure as native chart data (a `recreated_figure` block) when the underlying numbers are recoverable; that block is also not something you author, and it does not change the `charts` rules below.

### When does a chart earn its place?

**First decide: does this paper need any charts at all?** Before authoring a single chart, ask: does the paper state real measured magnitudes (benchmark scores, latencies, accuracies, token counts, dollar costs, parameter counts, training steps, percentages from a measurement) that a reader would actually compare against each other?

If no, the right answer is **zero charts**. System-architecture writeups, conceptual frameworks, design-space surveys, position papers, and qualitative analyses often have no chartable data at all. Forcing two or three charts out of an architecture paper produces ordinal-ranking-as-bars (`[1, 2, 3, 4]` encoding layer order) and proportions-as-bars (a 2-value split that should have been pills). Both are wrong, and they leak the model's discomfort with returning an empty list.

Emit `charts: []` (or omit `charts` entirely) and let prose carry the explanation. Zero charts is the correct answer for many papers; do not pad. One chart is also fine. The schema allows 0-4, and the lower end of that range exists for a reason.

**Chart only the values the paper states.** Use the figures to understand the paper, never as a source of chart data:

- Every value in a chart must be stated in the text or a table: printed as a number in the prose or in a table cell. A number printed only as a label inside a figure does not count yet, because nothing downstream can check it. Never read values off a figure's axes, bars or curves, and never estimate, interpolate or trace one.
- The caption must name the table or page every value comes from, in the bracketed source tag that ends the caption (format under "Captions translate first, then tag the source" above).
- Never split a reported range. A reported "28–33%" is one stated range, not two data points; keep it whole in a pill, a table cell or prose.
- If a chart would need any value the paper does not state, prefer a table of the values it does state, or prose. Do not chart the gap.
- A URL source (a fetched web page rather than a PDF) gets at most one chart.

If the paper *does* state magnitudes worth charting, run every one of the following checks against the data before putting it in a chart. Together with the stated-values rule above, this is the single authoritative list; every other section's chart-gating mention is a pointer back here.

1. **Not a share-of-whole.** If the values sum to ~100% or ~1.0, or read as "X% does A, Y% does B", that is `top_block.pills` or prose, not a chart. A two-value split like `1.6 / 98.4` rendered as bars is the same proportion in disguise; bar-encoding it does not make it a chart.
2. **Not an ordinal ranking.** If the dataset is `[1, 2, 3, 4]`, `[0, 1, 2, 3]`, or any sequence that just encodes "this comes before that" rather than measured magnitudes, that is prose, not a chart. Bar height must encode a real quantity (tokens per second, accuracy, latency, cost). Rank order belongs in a numbered list.
3. **Not a single number or single proportion.** One headline figure, a share-of-whole split (whether pie, doughnut, or bar), or one metric with no second series is a *pill*, not a chart; emit it in `top_block.pills` and state it in prose. A chart must carry at least two genuinely different data points with real magnitudes that a reader compares against each other (a trend over time, categories at different measured magnitudes, multiple series).
4. **At least 6 points in a series.** Every chart must have at least one data series with **6 or more** data points. A 2-point line (start vs end), a 3-or-4-bar comparison, or any series thinner than 6 points carries too little information to justify a chart; render it as `top_block.pills`, a `table`, or prose instead. Thin charts are dropped in post-processing, so emitting one just loses the data; put it where it will survive.
5. **Not a uniform-value checklist, conformance table, or category list.** If every value would be the same number (all 100%, all `true`, all `2`, all "yes"), or the axis has no meaningful scale, it is not a chart; rewrite it as a `list` inside a prose section, or a `takeaway` / `pills` block. Charts exist to show *variation*; equal-height bars communicate nothing.
6. **Prefer a `table` over a grouped/stacked bar for a value grid.** A metric × system matrix (per-dataset, per-model, per-config breakdowns) reads more precisely as a `table` than as bars, and a reader rarely needs bar height to compare them. Default such data to a `table` block in a prose section. A bar chart earns its place only when the *shape* of the magnitudes across a handful of categories is itself the point and a table would bury it.
7. **Every numeric axis must carry its unit.** Set `options.scales.<axis>.title.text` to the real quantity and unit from the paper, and set `options.scales.<axis>.title.display` to `true`. Examples: `"Tokens per second"`, `"Throughput (tok/s/GPU)"`, `"Latency (ms)"`, `"Cost per million tokens (USD)"`, `"Memory (GB)"`. Never use `"Value"`, `"Amount"`, `"Number"`, a blank string, or leave `display: false` on a numeric axis. Category axes (model names, layer types, stages) do not need a unit; a numeric axis always does.

If any check fails, do not emit that chart. Find a different cut of the paper that has stated magnitudes to compare, or just write it in prose.

For data that passes every check, build the Chart.js chart in `charts` from the stated values alone. If several stated results each add a distinct story, include one chart for each, within the URL limit above. Put the most important chart first; it renders after the first prose section, below the opening text.

**Do not emit an `image` field or any image bytes; name the figure in `figure_request` and the pipeline locates and attaches it.** A per-paper sidecar (`<paper>.focus.md`) can pin a specific figure, in which case the instruction names it.

Prose sections may refer to figures by number so the reader can find them in the original paper. Do not invent figure content: if a figure's values or labels are unclear, say so or leave the detail out.

---

## Headline rules

State the paper's main finding in plain text. Use "X, but Y" only when the finding is a contrast. Wrap the key phrase in `<span>` in `headline_html` only.

Illustrative example of a contrasting finding (not a claim about a real study):

```
"headline":      "The method improves accuracy, but takes longer to run",
"headline_html": "The method improves accuracy, but <span>takes longer to run</span>"
```

- Use a comma before `but` / `yet` / `while`.
- No semicolons.

---

## Writing the prose

Apply these rules in ranked order:

1. **Faithful.** State only what the paper supports. No invented statistics, quotes, metaphors or conclusions. Match the paper's own confidence and hedges.
2. **Headlines and pills claim no more than the body.** Every number in them appears in the body. Make no claims about other researchers' motives or the whole field, such as "nobody", "pretending" or "not even close".
3. **Plain English.** Gloss each technical or statistical term on first use, including in pills. Write for an intelligent reader from outside the field.
4. **One idea per sentence**, about 28 words at most. Prefer concrete subjects and active verbs.
5. **Lead each section with its finding.** Use the rest of the section to explain the evidence and its limits.
6. **End a section on its most useful specific finding, number or caveat.** No recap and no manufactured twist. Use at most one figurative line per article; analogies only where they explain a mechanism.
7. **`end_takeaway` is the plain "so what" with the key number.** Summary is allowed.
8. **Tone is calm and neutral; dry at most.** No jokes.
9. **Templates are capped.** Use ", not Y" at most twice per article. No "It is not X. It is Y." couplets; no verbless fragment closers.
10. **Headline contrast.** Use "X, but Y" only when the finding is a contrast.
11. **Hard floor.** Use British English throughout: colour, behaviour, analyse, optimise and other -ise verbs. No em dashes; use a comma, parenthesis or restructure. Banned words and phrases: leverage, ecosystem, robust, seamless, pain points, bandwidth (metaphorical), synergy, circle back, delve, it's worth noting, in conclusion, fascinating, certainly, unlock, game-changer, cutting-edge, "navigate the complexities", "testament to", tapestry. No hedging openers such as "In today's rapidly changing world...". No rhetorical questions as section labels.

---

## Pre-delivery checklist

- [ ] Output is a single valid JSON object, starts with `{`, ends with `}`.
- [ ] `metadata.filename_slug` follows `YYYY-MM-DD_authorsurname_short-title_explainer`.
- [ ] The byline is the paper's real author (found beneath the title, or from a `Detected paper author(s):` line). No placeholder author ("Unknown", "Anonymous", "Unattributed", "Unspecified"); drop the author segment rather than invent one.
- [ ] `hero.publication_date` uses `"Published Month Year"`.
- [ ] `top_block` is `pills` when the paper has measured results or a central 2–6 item sequence; otherwise `takeaway`. `end_takeaway` is present iff `top_block.kind === "pills"`.
- [ ] Every pill `description` is a lowercase continuation phrase completing its `number`, not a standalone capitalised sentence.
- [ ] Every chart value is stated in the text or a table of the paper (never read off a figure), and each caption ends with a bracketed tag naming that table or page. The most important chart is first.
- [ ] Every chart passes all seven checks in "When does a chart earn its place?" above: not a share-of-whole, not an ordinal ranking, not a single number or proportion, at least 6 points in a series, not a uniform-value checklist, not a value grid a `table` would serve better, and every numeric axis carries a real unit with `title.display: true`.
- [ ] `figure_request` names one figure by the paper's own label, or is null.
- [ ] `sections` has 2–5 entries, each with a `label` and at least one of `paragraphs`, `list`, or `table`.
- [ ] `references` follows the single-entry rule above: one entry, anchor with `target="_blank"` and `rel="noopener noreferrer"`, no cited-work bibliography.
- [ ] All text meets the hard floor in rule 11 of "Writing the prose".
