---
name: explainer-batch
description: "Create JSON explainer articles from academic papers for a research website. Use this skill whenever the user drops a PDF of a research paper, arXiv link, or asks for an 'explainer' or 'research summary'. The output is a structured JSON object consumed by a React renderer; you do not write HTML for the page layout itself, though the specified inline markup is allowed in prose fields."
---

## Claude.ai Compatibility

- Exported for Claude.ai compatibility.
- See `README.md` in this skill bundle for full portability notes.

- Strict mode enabled.


# Research Explainer Skill

You produce a publication-ready JSON explainer article from an academic research paper. A React renderer turns that JSON into a page on the website.

Your job is to read the paper, understand its real contribution, and surface it richly: numbers when the paper is empirical, named concepts when the paper is a framework, and a chart only when the data genuinely warrants one (often none).

## Steps

1. Read the paper end to end. Look at the figures to understand the argument, but take every number from the text and the tables.
2. Decide whether the paper is primarily empirical (measured results) or conceptual (a framework, taxonomy, or argument).
3. Fill every key in the JSON schema below, using null or an empty array where instructed.
4. If the paper has real measured magnitudes worth comparing, draw a chart only when every value in it is stated in the text or a table (see the chart-decision rules below); many papers correctly get zero charts. Include at most one chart; it renders after the opening prose section.
5. Return only the JSON object.

## Output format

The first character of your response must be `{` and the last must be `}`. No preamble, no markdown fences, no explanation before or after.

---

## JSON schema

<!-- CONTRACT-V2-BEGIN -->
```
{ // object; A research explainer article.
  "hero": { // object; The article hero.
    "title": string, // string; Short article title, used for the page title, cards and the slug.
    "headline": string, // string; One-sentence hero headline stating the main finding.
    "emphasis": string or null, // string or null; A phrase copied exactly from the headline to highlight, or null for none.
    "subtitle": string // string; One or two sentences expanding the headline.
  },
  "top_block": ( // object; The block under the hero: pills, or a takeaway.
    { // object
      "kind": "pills", // string; enum: "pills"; Key-figure pills under the hero.
      "pills": [ // array; minItems: 2; maxItems: 6; Two to six key figures or ideas from the paper.
        { // object
          "lead": string, // string; The pill's short lead: a number with its unit, or a two or three word phrase.
          "text": string // string; One sentence saying what the lead means.
        }
      ]
    } or
    { // object
      "kind": "takeaway", // string; enum: "takeaway"; A single takeaway block under the hero.
      "label": string, // string; Short label for the takeaway, such as "In short".
      "body": string // string; The takeaway itself, one to three sentences.
    }
  ),
  "sections": [ // array; minItems: 2; maxItems: 5; Two to five article sections.
    { // object
      "label": string, // string; Section heading.
      "paragraphs": [ // array; The section prose, one string per paragraph.
        string // string
      ],
      "list": { // object or null; An optional list block, or null.
        "ordered": boolean, // boolean; True for a sequence whose order matters, false otherwise.
        "intro": string or null, // string or null; One sentence introducing the list, or null.
        "items": [ // array; minItems: 1; The list items.
          { // object
            "label": string or null, // string or null; Short bold label for the item, or null.
            "body": string // string; The item text.
          }
        ]
      },
      "table": { // object or null; An optional table block, or null.
        "caption": string or null, // string or null; What the table shows, without a source tag, or null.
        "columns": [ // array; minItems: 2; Column headings, at least two.
          string // string
        ],
        "rows": [ // array; minItems: 1; Table rows, each a list of cell strings in column order.
          [ // array; minItems: 1
            string // string
          ]
        ],
        "source": { // object or null; Where the table comes from in the paper, or null.
          "ref": string, // string; The table as printed in the paper ("Table 2"), or for a web page the section heading.
          "page": integer or null // integer or null; The PDF page the table sits on, or null when unknown or not a PDF.
        }
      }
    }
  ],
  "charts": [ // array; maxItems: 1; At most one chart, built only from values the paper states.
    { // object
      "kind": "bar" | "stacked_bar" | "line" | "scatter", // string; enum: "bar", "stacked_bar", "line", "scatter"; The chart type.
      "title": string, // string; Chart title.
      "caption": string, // string; One sentence saying what the chart shows, without a source tag.
      "x": { // object; The x axis.
        "label": string, // string; Axis label.
        "unit": string or null, // string or null; Axis unit; required when the axis is numeric, otherwise null.
        "type": "category" | "linear" | "log", // string; enum: "category", "linear", "log"; category for labels, linear or log for numbers.
        "values": [ // array; The x positions, aligned by index with each non-scatter series; may be empty for scatter.
          ( // string or number
            string or // string
            number // number
          )
        ]
      },
      "y": { // object; The y axis.
        "label": string, // string; Axis label.
        "unit": string or null, // string or null; Axis unit, such as "%" or "ms".
        "scale": "linear" | "log" // string; enum: "linear", "log"; The y scale.
      },
      "series": [ // array; minItems: 1; The data series, at least one.
        { // object
          "name": string, // string; Series name, shown in the legend.
          "values": [ // array or null; One value per x.values entry, null for a gap; null for a scatter series.
            number or null // number or null
          ],
          "points": [ // array or null; The points of a scatter series; null otherwise.
            { // object
              "x": number, // number
              "y": number // number
            }
          ],
          "source": { // object; Where the series values are stated in the paper.
            "kind": "table" | "text", // string; enum: "table", "text"; table: the values come from a printed table; text: from a sentence in the paper.
            "ref": string, // string; For table, the table as printed ("Table 2"); for text, a verbatim fragment of at most 160 characters containing the values.
            "page": integer or null // integer or null; The PDF page of the source, or null.
          }
        }
      ]
    }
  ],
  "figure_request": { // object or null; The paper figure to show as the lead image, or null.
    "label": string, // string; The figure as labelled in the paper, such as "Figure 3".
    "why": string // string; Why this figure best illustrates the article.
  },
  "end_takeaway": { // object or null; Closing takeaway: required with pills, null with a takeaway top block.
    "label": string, // string; Short label, such as "Bottom line".
    "body": string // string; The closing takeaway, one to three sentences.
  },
  "citation": { // object or null; The paper's citation read from its front matter, or null when told the citation is known.
    "authors": [ // array; minItems: 1; The authors in the order the paper lists them.
      { // object
        "family": string, // string; Family name.
        "given": string or null // string or null; Given names or initials, or null.
      }
    ],
    "year": integer or null, // integer or null; Publication year, or null when the paper does not state one.
    "title": string, // string; The paper's full title.
    "venue": string or null, // string or null; Journal, conference or archive, or null.
    "url": string or null // string or null; A canonical http(s) URL for the paper, or null.
  }
}
```
<!-- CONTRACT-V2-END -->

Every key shown in the chosen alternative is required, including keys inside objects. Use `charts: []` when no chart earns its place. Use null for unused `hero.emphasis`, `figure_request`, section `list` and `table`, and other nullable fields. With a pills top block, supply `end_takeaway`; with a takeaway top block, set `end_takeaway` to null. Never omit a key to express absence.

The block is an annotated skeleton, not literal output: replace type words and alternatives with real JSON values and remove comments.

### hero

Write a short plain-text `hero.title`, a one-sentence `headline` stating the main finding, and a `subtitle` expanding it. Set `hero.emphasis` to a phrase copied exactly from `headline`, or null when no phrase needs highlighting. All hero fields are plain text.

### top_block

Use `pills` when the paper has either:
- two or more measured headline findings, or
- a central ordered set of named stages, roles, concepts, or mechanisms (2–6 items) that a reader should be able to scan immediately.

Each pill is `{lead, text}`, both plain text. The short `lead` is a number with its unit or a two or three word concept. Pill `text` is a lowercase continuation of `lead`: read together they form one sentence saying what the lead means, never a separate capitalised sentence. For example, a lead of "2.58×" continues with "lower average latency than the baseline".

Otherwise use `top_block.kind: "takeaway"`, with a short `label` and a `body` of one to three sentences. Include a closing `end_takeaway` object only with pills; otherwise its value is null.

### section

Write 2–5 sections, each with a `label`, `paragraphs`, `list` and `table`. Each section needs at least one paragraph, a list or a table. `paragraphs` can be empty when a list or table carries the section; unused `list` and `table` values are null.

Paragraphs and list bodies are inline text. They may use only `<em>`, `<strong>`, `<code>`, `<sub>`, `<sup>` and `<a href="https://example.org">` markup. The first five tags take no attributes; anchors take only `href`, an http(s) URL, and cannot nest. Escape literal special characters with `&amp;`, `&lt;`, `&gt;` and `&quot;`. The same inline rules apply to list `intro` and takeaway `body` fields. All other text fields are plain text without tags or HTML entities.

Use `list` when the source material is genuinely a sequence, taxonomy, or named set of roles or steps, not to decorate ordinary prose. Set `ordered` to true only when order matters. Supply at least one item with `label` (or null) and `body`; use null for an unused `intro`.

### table

Use `table` for a grid of values the reader *reads off and scans* rather than compares by magnitude: a metric × system matrix, a per-dataset breakdown, a feature comparison. `columns` are the headers (first column is usually the row label); `rows` are plain-text cells in column order. Cells are strings so units and ranges render verbatim (`"32.3"`, `"16-64%"`, `"OOM"`, `"O(N²)"`).

**A table is the right home for most multi-row numeric breakdowns. Reach for it before a bar chart** (full rule in "When does a chart earn its place?" below). Use a line for a genuine trend over time or another continuous axis, or scatter for a two-variable relationship, and only when the paper states every value. A bar chart must also earn its place under the checks below. When in doubt between a bar chart and a table, choose the table.

Architecture, systems-design, framework, and position papers *tend* toward table-and-prose: their numbers usually sit better in `table` blocks and their argument in prose, so they often warrant **zero or one** chart. Every explainer, from a PDF or a URL source, gets at most one chart. A paper of any genre earns a chart when its text or tables state the values and the data passes the checks below. The rule forbids *manufacturing* charts to fill space; it does not mean suppressing a chart the stated values support because you have filed the paper under "conceptual".

### chart

Use the neutral chart shape: `kind`, `title`, `caption`, `x`, `y` and `series`. Choose `kind` from `bar`, `stacked_bar`, `line` or `scatter`. `x` holds `label`, `unit`, `type` and `values`; `y` holds `label`, `unit` and `scale`. Use `x.type` of `category` for labels, or `linear` or `log` for numbers. Use `y.scale` of `linear` or `log`.

Each series has a `name`, `values`, `points` and `source`. For non-scatter charts, `values` has one entry per `x.values` entry, with null for a gap, and `points` is null. For scatter, put numeric `{x, y}` objects in `points`, set `values` to null and leave `x.values` empty if unused.

Every series' `source` names the table or page the values come from. Set `source.kind` to `table` for printed table values or `text` for a sentence in the paper. For `table`, `source.ref` names the printed table; for `text`, it is a verbatim fragment of at most 160 characters containing the values. Set `source.page` to the PDF page, or null when unknown or not a PDF. A table block's `source` is `{ref, page}`: `ref` names the printed table or a URL page's section heading, and `page` is the PDF page or null. Set `table.source` to null only when the source is unknown.

**Captions translate the values for the reader.** A chart caption is one plain-text sentence saying what it shows, and a table caption describes the table in plain words or is null. Captions carry no source tag; structured `source` fields carry attribution. Explain acronyms in the caption, not the title. Do not open a caption with an author and year; the explainer covers one paper. When a chart or pill leans on a statistical construct (a CCDF/`1 − F(x)`, a shape or tail parameter, a hazard rate, an elasticity, a log axis, confidence bands), translate it in the caption or pill text. State what a single point literally means and the takeaway a busy reader should leave with; expand in the surrounding prose when necessary to keep the caption to one sentence. Never use a symbol or technical term in a caption, axis label or pill text without translating it there. For example: "For a Pareto tail, α = 0.92 means the model allows overruns large enough that its theoretical mean is not finite." This describes the size of extreme overruns under that model, not how often projects overrun. The plain-words gloss must not change what the statistic means. The audience includes readers who could follow the full paper but came here for the glanceable version; serve them first.

**Choose the chart type by trigger, not default.** Bar is not the safe pick; match the shape of the data:

- **scatter**: two continuous variables plotted against each other (cost vs accuracy, latency vs throughput, parameters vs benchmark score).
- **line**: a series indexed by time, training steps, or another continuous axis. Never join categories with a line: models, datasets or conditions on the x-axis are bars or a `table`.
- **grouped or stacked bar**: comparison across discrete categories with a single scalar (or stacked components) each. Never draw stacked bars on a log axis, because stacked segments only add up on a linear scale.

Pie, doughnut or radar charts are banned outright. Share-of-whole splits belong in `top_block.pills` or prose, and a set of systems scored across several metrics belongs in a `table`.

**Every numeric axis must carry its unit** (full rule in "When does a chart earn its place?" below).

### citation

Emit the paper's own `citation`, read from its front matter: `authors` in byline order (each with `family` and `given`, or null for unknown given names), `year`, full `title`, `venue` and canonical `url`. Use null for an unknown year, venue or URL. The author line sits directly beneath the title, above the affiliation and abstract; a `Detected paper author(s):` line identifies that byline when supplied. Never invent a placeholder author such as "Unknown", "Anonymous", "Unattributed" or "Unspecified". If the byline is genuinely missing, surface that uncertainty rather than fabricating a citation. Set the whole `citation` to null only when the instruction says the citation is already known. Cite only the paper being explained, never its cited works.

---

## Working with figures in the paper

When the paper contains figures (results charts, conceptual diagrams, architecture sketches, stage models), read every figure and name the one the explainer should show in `figure_request.label`. Use the paper's own numbering and noun (`Figure 3`, `Table 2`, `Figure 4b`). Prefer the paper's key results figure, the one carrying its headline finding. Only when it has none, choose its central architecture, pipeline or framework diagram. Write `why` as one plain sentence saying what the figure shows and why a reader should see it. Set `figure_request` to null when no figure would help. The pipeline finds and attaches the named figure. Figures are never a source of chart values.

### When does a chart earn its place?

**First decide: does this paper need any charts at all?** Before authoring a single chart, ask: does the paper state real measured magnitudes (benchmark scores, latencies, accuracies, token counts, dollar costs, parameter counts, training steps, percentages from a measurement) that a reader would actually compare against each other?

If no, the right answer is **zero charts**. System-architecture writeups, conceptual frameworks, design-space surveys, position papers, and qualitative analyses often have no chartable data at all. Forcing two or three charts out of an architecture paper produces ordinal-ranking-as-bars (`[1, 2, 3, 4]` encoding layer order) and proportions-as-bars (a 2-value split that should have been pills). Both are wrong, and they leak the model's discomfort with returning an empty list.

Emit `charts: []` and let prose carry the explanation. Zero charts is the correct answer for many papers; do not pad. One chart is also fine; the schema allows zero or one.

**Chart only the values the paper states.** Use the figures to understand the paper, never as a source of chart data:

- Every value in a chart must be stated in the text or a table: printed as a number in the prose or in a table cell. A number printed only as a label inside a figure does not count yet, because nothing downstream can check it. Never read values off a figure's axes, bars or curves, and never estimate, interpolate or trace one.
- Each series must carry the structured `source` described above, identifying where every value is stated.
- Never split a reported range. A reported "28–33%" is one stated range, not two data points; keep it whole in a pill, a table cell or prose.
- If a chart would need any value the paper does not state, prefer a table of the values it does state, or prose. Do not chart the gap.
- The same one-chart limit applies to both PDF and URL sources.

If the paper *does* state magnitudes worth charting, run every one of the following checks against the data before putting it in a chart. Together with the stated-values rule above, this is the single authoritative list; every other section's chart-gating mention is a pointer back here.

1. **Not a share-of-whole.** If the values sum to ~100% or ~1.0, or read as "X% does A, Y% does B", that is `top_block.pills` or prose, not a chart. A two-value split like `1.6 / 98.4` rendered as bars is the same proportion in disguise; bar-encoding it does not make it a chart.
2. **Not an ordinal ranking.** If the dataset is `[1, 2, 3, 4]`, `[0, 1, 2, 3]`, or any sequence that just encodes "this comes before that" rather than measured magnitudes, that is prose, not a chart. Bar height must encode a real quantity (tokens per second, accuracy, latency, cost). Rank order belongs in a numbered list.
3. **Not a single number or single proportion.** One headline figure, a share-of-whole split (whether pie, doughnut, or bar), or one metric with no second series is a *pill*, not a chart; emit it in `top_block.pills` and state it in prose. A chart must carry at least two genuinely different data points with real magnitudes that a reader compares against each other (a trend over time, categories at different measured magnitudes, multiple series).
4. **At least 6 points in a series.** Every chart must have at least one data series with **6 or more** data points. A 2-point line (start vs end), a 3-or-4-bar comparison, or any series thinner than 6 points carries too little information to justify a chart; render it as `top_block.pills`, a `table`, or prose instead. Thin charts are dropped in post-processing, so emitting one just loses the data; put it where it will survive.
5. **Not a uniform-value checklist, conformance table, or category list.** If every value would be the same number (all 100%, all `true`, all `2`, all "yes"), or the axis has no meaningful scale, it is not a chart; rewrite it as a `list` inside a prose section, or a `takeaway` / `pills` block. Charts exist to show *variation*; equal-height bars communicate nothing.
6. **Prefer a `table` over a grouped/stacked bar for a value grid.** A metric × system matrix (per-dataset, per-model, per-config breakdowns) reads more precisely as a `table` than as bars, and a reader rarely needs bar height to compare them. Default such data to a `table` block in a prose section. A bar chart earns its place only when the *shape* of the magnitudes across a handful of categories is itself the point and a table would bury it.
7. **Every numeric axis must carry its unit.** Set `x.unit` for a numeric x axis and always set `y.unit` to the real unit from the paper; use `x.label` and `y.label` to name the quantities. Examples: `"Tokens per second"`, `"Throughput (tok/s/GPU)"`, `"Latency (ms)"`, `"Cost per million tokens (USD)"`, `"Memory (GB)"`. Never use `"Value"`, `"Amount"`, `"Number"`, a blank string or null for a numeric axis unit. Category axes (model names, layer types, stages) use `x.unit: null`; a numeric axis always needs a unit.

If any check fails, do not emit that chart. Find a different cut of the paper that has stated magnitudes to compare, or just write it in prose.

For data that passes every check, build the chart in `charts` from the stated values alone. If several results each add a distinct story, choose the most important chart; it renders after the first prose section, below the opening text.

**Do not emit an `image` field or any image bytes; name the figure in `figure_request` and the pipeline locates and attaches it.** A per-paper sidecar (`<paper>.focus.md`) can pin a specific figure, in which case the instruction names it.

Prose sections may refer to figures by number so the reader can find them in the original paper. Do not invent figure content: if a figure's values or labels are unclear, say so or leave the detail out.

---

## Headline rules

State the paper's main finding in plain text. Use "X, but Y" only when the finding is a contrast. Copy a key phrase exactly into `hero.emphasis` to highlight it, or set it to null.

Illustrative example of a contrasting finding (not a claim about a real study): a headline of "The method improves accuracy, but takes longer to run" can use "takes longer to run" as its emphasis.

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

- [ ] Output is a single valid JSON object, starts with `{`, ends with `}`; every schema key is present.
- [ ] `hero.emphasis` is copied exactly from `headline`, or is null; hero text has no markup.
- [ ] `top_block` is `pills` when the paper has two or more measured headline findings or a central 2–6 item sequence; otherwise `takeaway`. `end_takeaway` is an object with pills and null otherwise.
- [ ] Every pill `text` is a lowercase continuation completing its `lead`; together they read as one sentence.
- [ ] There is at most one chart, built only from values stated in the text or a table; each series' `source` identifies those values with `kind`, `ref` and `page`.
- [ ] Every chart passes all seven checks in "When does a chart earn its place?": not a share-of-whole, not an ordinal ranking, not a single number or proportion, at least 6 points in a series, not a uniform-value checklist, not a value grid a `table` would serve better, and every numeric axis carries a real unit.
- [ ] Captions carry no source tag; a table's attribution is in `table.source`.
- [ ] `figure_request` names one figure by the paper's own label, or is null.
- [ ] `sections` has 2–5 entries, each with a `label` and non-empty `paragraphs`, a `list` or a `table`; unused blocks are null.
- [ ] `citation` is the paper's own citation from its front matter with no placeholder author, or null only when the instruction says it is already known.
- [ ] Inline markup uses only the permitted tags and attributes in inline text fields; all other fields are plain text.
- [ ] All text meets the hard floor in rule 11 of "Writing the prose".
