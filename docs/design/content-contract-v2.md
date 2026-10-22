# Content contract v2: one zod source for a content-only explainer

Stage 16 design document, attempt 2. Written 2026-10-20 against
explainer-batch `dev` at d1ccc0b and promo-flow `dev` at 939c0304. No file
cited below changed between the attempt-1 bases (d7be9c7 and 1a653f49) and
those two commits, so every line number was re-read and stands. The card's own
line numbers (re-checked against 0cd17d7) have moved under the wave-1 commits,
so every citation below is what this document's author read.

## Summary

The explainer JSON becomes a slim, content-only, versioned artefact defined in
exactly one place, a zod 4 schema in `contract/explainer-v2.ts`, from which
everything else is generated. The decisions, each expanded below:

1. **Content only.** No `*_html` twins, no `accent_color`, no Chart.js
   `config_json`, no executable `config_raw`, no `echarts_option`, no legacy
   `chart`, no base64 `image.src`. Prose fields carry plain text; five prose
   fields may carry an inline allowlist (`em`, `strong`, `a`, `code`, `sub`,
   `sup`) as a canonical HTML subset. The renderer owns every colour, span
   and chart configuration.
2. **One source, two compositions.** The zod file exports `ModelOutputV2`
   (what the model emits: optional fields are nullable, every object is
   strict, editorial bounds such as 2 to 5 sections are enforced) and
   `ExplainerV2` (what is stored: adds `version: 2`, a code-stamped
   `metadata` block, the resolved `lead_figure`, the code-owned reference
   and a quality record; optional fields are absent; only structural
   bounds are enforced, so migrated and hand-edited files parse). Both are
   built from the same block schemas, parameterised by one composition
   object, so a field is declared once.
3. **Generated, not hand-kept.** `npm run contract:build` writes the
   canonical JSON Schema, the OpenAI strict dialect, the Claude tool
   `input_schema`, a Gemini `responseSchema`, and the schema block inside
   `skill.md` between markers. `npm run contract:check` (run by `npm test`)
   regenerates in memory and fails on any drift. The TypeScript type is
   `z.infer`; the runtime validator is the zod schema itself.
4. **One owner per field.** `version`, `date_created`, `slug`, `model`,
   `provider`, `route`, `source`, `publication_date`, `references` and
   `lead_figure` are written by code and do not exist in the model-facing
   schema, so no stamp ever overwrites a model value. The one value either
   side could supply, the paper's citation, is split by name: the model
   emits a nullable `citation`, and code fills `references[0]` from
   detection when the harness has one or from `citation` when it does not,
   recording `origin`. The order is fixed (`### Save order`): canonicalise
   (an ignored citation becomes `null`), validate and repair with the wire
   nulls intact, stamp, strip nulls, store; so the repair loop never sees a
   stamped field and never fires for a compliant `null`.
5. **One chart shape.** `charts[]` holds a neutral `bar | stacked_bar | line
   | scatter` description with typed axes and a per-series
   `source {kind, ref, page}`. The model may emit 0 or 1. The figure
   recreation pass writes the same shape, so `recreated_figure` and the
   ECharts option leave the contract.
6. **The figure is a file.** `lead_figure.asset` is a relative path
   (`<slug>/figure-3.jpg`) beside the JSON, with `sha256`, pixel size and a
   `provenance` enum. The model emits only a `figure_request {label, why}`.
7. **Shared by a vendored copy that the generator delivers.** promo-flow
   holds `src/contract/` (the zod source, the inline sanitiser, the byline
   derivations and the v1 reader) written by `contract:build --website`. A
   `CONTRACT_REVISION` constant is stamped into every artefact; promo-flow's `check:contract`
   fails when an artefact is newer than its reader. Readers land before
   producers; within version 2 changes are additive and optional.
8. **Migration is a pure function that always yields a valid v2.**
   `migrateV1()` ships inside the contract and is the v1 reader in
   promo-flow and the file rewriter in explainer-batch. What v1 never
   recorded is written truthfully (`provider` and `route` become `unknown`,
   `source` is absent, `metadata.migrated_from: 1` marks the file), and a
   live file outside an editorial bound gets a `quality.issues` entry
   rather than a failure. The 49 live explainers are rewritten in one
   commit with re-baked HTML. The v1 reader is deleted when zero v1 files
   remain.

Ten wave-2 cards close the design, in the order readers before producers:
W1 (the zod source and generators) gates everything; W2 to W4 give
promo-flow a v2 reader and renderer before any v2 artefact exists; W5 and
W6 switch the prompt and the producer; W7 to W10 finish the figure paths,
rewrite the archives and delete the v1 reader.

## Current state

### Where the contract lives

The contract is written down in nine places across the two repos, and the
tenth, the baked HTML, is the one promo-flow actually serves.

| Place | What it asserts | Evidence |
|---|---|---|
| `src/types/explainer-json.ts` | The "canonical" TypeScript type, `version: 1` since 2026-04-11 | `src/types/explainer-json.ts:8-9`, `src/types/explainer-json.ts:19` |
| `src/schema/explainer-schema.ts` | A hand-written JSON Schema that "deliberately diverges" from the type and must be kept "in lockstep" by hand | `src/schema/explainer-schema.ts:7-19`, `src/schema/explainer-schema.ts:27-29` |
| `src/quality.ts` | A hand-coded validator with its own view of required fields | `src/quality.ts:107-301` |
| `src/output.ts` | Normalisers that accept shapes none of the above declare (`heading`, `body_html`, `paragraphs_html` on a takeaway) | `src/output.ts:333-357` |
| `skill.md` | The prose schema the model is shown; its body is the system prompt verbatim | `skill.md:36-64`, `src/prompt.ts:19` |
| `promo-flow/src/lib/explainer-json.ts` | A TypeScript copy "kept in sync" by hand | `promo-flow/src/lib/explainer-json.ts:3` |
| `promo-flow/src/types/explainer-json.ts` | A second TypeScript copy, pointing at a repo name that no longer exists, lacking `list`, `image` and `quality` | `promo-flow/src/types/explainer-json.ts:4-5`, `promo-flow/src/types/explainer-json.ts:69-74` |
| `promo-flow/src/lib/explainers.ts` | A normaliser that hard-codes `version: 1`, invents a default `accent_color`, and drops any chart without `config_raw` | `promo-flow/src/lib/explainers.ts:692`, `promo-flow/src/lib/explainers.ts:597`, `promo-flow/src/lib/explainers.ts:672` |
| `promo-flow/src/lib/explainer-to-html-core.mjs` | The HTML baker, which caps charts at 3 and evaluates `config_raw` | `promo-flow/src/lib/explainer-to-html-core.mjs:103`, `promo-flow/src/lib/explainer-to-html-core.mjs:119` |
| Baked HTML under `public/explainer-html/` | What the live route renders: the article component inlines the stored HTML and ignores the JSON for the body | `promo-flow/src/components/explainers/ExplainerArticle.tsx:23-24`, `promo-flow/src/components/explainers/ExplainerInlineHtml.tsx:433` |

The JSON is read by promo-flow only for card pills, titles and dates
(`promo-flow/src/lib/explainers.ts:876`, `promo-flow/src/lib/explainers.ts:918-926`,
`promo-flow/src/lib/explainers.ts:964`). The April plan asked for a
`version: 2` rather than silent changes to `version: 1`
(`promo-flow/docs/plans/2026-04-13-1431-explainer-publishing-hybrid.md:99`);
instead `list`, `table`, `image`, `recreated_figure`, `model`, `run_mode` and
`quality` were all added under version 1.

### How it drifts

A tally over the three v1 corpora (49 live explainers under
`promo-flow/public/explainer-html/`, the 19 files in
`../explainer-batch/output/`, and the 67 files in
`../explainer-batch/output.local/`) shows the drift in the data:

| Observation | Live 49 | `output/` 19 | `output.local/` 67 |
|---|---|---|---|
| Files with 2 or 3 charts | 18 | 1 | 21 |
| Files carrying the legacy `chart` copy (`src/output.ts:416`) | 35 | 12 | 46 |
| Files whose only chart is a legacy `chart` with `config_json: null` (code only in `config_raw`) | 12 | 0 | 23 |
| Chart entries of a banned type (doughnut, radar) | 5 | 0 | 5 |
| Figures stored as base64 `data:` URLs | 0 (lifted by promo-flow to a site-absolute `/explainer-html/<folder>/media/<sha>.jpg` path in 12 files, beside the JSON) | 14 | 7 |
| Files missing `metadata.model` and `run_mode` | 43 | 8 | 67 |
| Files outside a v2 editorial bound (6 or more sections; subtitle over 320 characters; pills without an `end_takeaway`) | 1; 4; 12 | 2; not tallied; not tallied | 0; not tallied; not tallied |
| Largest file | 35 KB | 664 KB | 1351 KB |
| Sections carrying `paragraphs_html` as well as `paragraphs` | 163 of 219 | 68 of 90 | 225 of 275 |
| Inline tags used in `paragraphs_html` | strong 413, em 69, code 4, a 3, sup 2 | strong 152, em 15, code 5 | strong 553, em 128, code 10, a 8, sup 2 |
| Distinct `accent_color` values | 17 | 12 | 17 |
| Files missing `hero.publication_date` | 16 | 0 | 32 |
| Files carrying a field no type declares (`diagrams[].mermaid`) | 1 | 0 | 0 |
| Files carrying `metadata.quality` | 0 | 0 | 0 |

Three further facts matter for the design. Every one of the 172 live pills
uses one of 17 hex colours chosen by the model, three of which cover 125
pills, so the colour carries no information the renderer could not assign
by position. The inline markup the models actually produce is `strong`, `em`
and a little `code`, `a` and `sup`; nothing else appears. And no artefact in
any corpus records where a chart's numbers came from.

### The specific defects, as read today

- `ExplainerChart` is title, caption, a Chart.js config and a JavaScript
  string that promo-flow deserialises with `new Function`
  (`src/types/explainer-json.ts:130-147`,
  `promo-flow/src/components/explainers/ExplainerChartCanvas.tsx:91`,
  `promo-flow/src/components/explainers/ExplainerChartCanvas.tsx:106`,
  `promo-flow/src/lib/explainer-to-html-core.mjs:119`).
- The model-facing schema makes `config_json` a string
  (`src/schema/explainer-schema.ts:137`); `src/output.ts:111-119` parses it
  back, and the data checks in `src/quality.ts:58-69` only see objects.
- Every prose field has an HTML twin: `headline_html`
  (`src/types/explainer-json.ts:58`), `paragraphs_html`
  (`src/types/explainer-json.ts:232`), `intro_html`
  (`src/types/explainer-json.ts:254`), `body_html`
  (`src/types/explainer-json.ts:265`). The baker prefers the HTML copy
  (`promo-flow/src/lib/explainer-to-html-core.mjs:54`,
  `promo-flow/src/lib/explainer-to-html-core.mjs:220`) and writes the pill
  lead unescaped (`promo-flow/src/lib/explainer-to-html-core.mjs:201`).
- Code stamps fields the model was asked to write: the slug author segment,
  the title, the eyebrow, the publication date and the whole references
  array (`src/output.ts:502-527`), after the repair loop has already spent
  calls making those same fields pass validation
  (`src/repair.ts:38-63`, `src/quality.ts:124-135`,
  `src/quality.ts:145-149`, `src/quality.ts:282-293`).
- The figure is inlined as base64 (`src/output.ts:303-309`;
  `docs/FIGURE-EXTRACTION.md:155-162` documents 300 to 600 KB per file) and
  promo-flow carries a script to undo it
  (`promo-flow/scripts/extract-explainer-media.mjs:43`,
  `promo-flow/scripts/extract-explainer-media.mjs:129-145`).
- Chart caps disagree: 4 in the prompt (`skill.md:56`) and validator
  (`src/quality.ts:249-251`), 3 in the normaliser (`src/output.ts:413`) and
  the baker (`promo-flow/src/lib/explainer-to-html-core.mjs:103`); a legacy
  `chart` copy of `charts[0]` is written on every save (`src/output.ts:416`).
- `recreated_figure` is a parallel chart path with an ECharts option
  (`src/types/explainer-json.ts:174-200`, `src/figure-data.ts:294-331`,
  `src/figure-data.ts:407-412`) that promo-flow never renders.
- `image` sits in the model schema (`src/schema/explainer-schema.ts:188`)
  while `skill.md:58` and `src/prompt.ts:25` say never emit it.
- The validator rejects a section with only a table
  (`src/quality.ts:200-202`) although `skill.md:269` allows one.
- Structured output is strict on the OpenAI API route
  (`src/providers.ts:381-383`, attached at `src/providers.ts:603-605`),
  absent on the Claude subscription route (`src/providers.ts:309-313` takes
  no schema), and advisory on Claude models outside the forced-tool
  allowlist (`src/providers.ts:132-147`, `src/providers.ts:172`).

## Findings addressed

| Id | Where (as read) | How the design resolves it |
|---|---|---|
| D1 | `src/types/explainer-json.ts:130-147`; `promo-flow/src/components/explainers/ExplainerChartCanvas.tsx:91` | `ExplainerChart` is replaced by the neutral `Chart` block in `## Schema v2`: `kind`, typed `x` and `y`, and `series[]` each carrying `source {kind, ref, page}`. `config_json` and `config_raw` do not exist in v2; nothing in the artefact is deserialised as code. Lands in W1 (shape), W6 (producer), W8 (recreation pass), W4 (renderer). |
| D2 | `src/schema/explainer-schema.ts:137`; `src/output.ts:111-119`; `src/quality.ts:58-69` | The chart's data is typed in the one source (`series[].values: (number | null)[]`), so the OpenAI dialect carries it as typed arrays, not a string. The ordinal and share-of-whole checks move onto the neutral shape as zod refinements and `chartChecks()` in W6; stage 19's gate builds on the same shape. |
| D3 | `src/schema/explainer-schema.ts:124`, `src/schema/explainer-schema.ts:174`; `src/types/explainer-json.ts:58`, `src/types/explainer-json.ts:232`, `src/types/explainer-json.ts:254`, `src/types/explainer-json.ts:265` | Every text is stored once. `InlineText` fields (paragraphs, list intro, list item body, both takeaway bodies) hold a canonical allowlisted subset; plain text is derived by `inlineToPlain()` at read time, never stored. `PlainText` fields hold raw characters, no tags, no entities. `headline_html` becomes `hero.emphasis`, a plain substring of `headline`. W1, W6, W2. |
| D4 | `src/types/explainer-json.ts:127`; `src/schema/explainer-schema.ts:65`; `skill.md:80-82`, `skill.md:226` | `accent_color` and the headline `<span>` are gone. Pills are `{lead, text}`; the renderer assigns accents by position. The headline carries `emphasis` (content: which phrase is the finding) and the renderer decides how to show it. The `tone?` hint in the starting shape is dropped too (`## Tradeoffs` 6). W1, W5, W4. |
| D5 | `src/schema/explainer-schema.ts:161-179`, `src/schema/explainer-schema.ts:187`; `src/quality.ts:124-135`; `src/output.ts:502-527`, `src/output.ts:529-576` | One owner per field, fixed by name. `ModelOutputV2` has no `version`, `metadata`, `publication_date`, slug, eyebrow, byline, `references` or `lead_figure`; those are stamped by code after the model's output has been validated and repaired, so no stamp can overwrite a model value and no repair call can touch a stamped field. The paper's citation, the one value either side could supply, is split: the model emits a nullable `citation`; code owns `references[0]` and fills it from detection when the harness has a detected reference (the user turn says so, and canonicalisation sets any `citation` the model emits anyway to `null` before validation, listing it in `quality.dropped`) or from `citation` otherwise, recording `origin: detected | model`. The repair loop validates `modelOutputValidator({citationKnown})` on the wire object with its nulls intact, which requires `citation` non-null only when detection has nothing; nulls are stripped only after stamping, when the stored object is composed (today's `src/output.ts:139-153` strip moves there). A model that emits a stamped key regardless costs no repair call: canonicalisation drops unknown keys before validation. The order is canonicalise, validate and repair with nulls, stamp, strip nulls, store (`### Save order`); Q6 gives the field list, Q7 the two citation cases. W6. |
| D6 | `src/output.ts:303-309`; `docs/FIGURE-EXTRACTION.md:155-162`; `promo-flow/scripts/extract-explainer-media.mjs:43` | `lead_figure.asset` is a relative path to a sidecar file written beside the JSON (`<slug>/figure-3.jpg`), with `sha256`, `width`, `height`. explainer-batch writes the file to `output/`, the website staging directory and the Obsidian mirror alongside the JSON; promo-flow's approve step copies the directory. `extract-explainer-media.mjs --check` stays as the guard that no base64 returns. W6 (the write), W7 (reextract), W3 (the copy). |
| D7 | `skill.md:36-64`; `src/schema/explainer-schema.ts:27-29`; `src/quality.ts:116`; `src/types/explainer-json.ts:19`; `promo-flow/src/lib/explainer-json.ts:3`; `promo-flow/src/types/explainer-json.ts:4-5`; `promo-flow/src/lib/explainers.ts:692` | One zod file. Type (`z.infer`), validator (zod), four JSON Schema dialects and the `skill.md` block are generated; `contract:check` fails on drift. promo-flow's two hand copies are deleted and replaced by the vendored, generator-written `src/contract/`. `version` is `z.literal(2)` and `CONTRACT_REVISION` is stamped per artefact; the compatibility rule (additive and optional within v2, otherwise bump `version`) is written into the source file header. W1, W5, W2, W3. |
| D8 | `skill.md:56`; `src/quality.ts:249-251`; `src/output.ts:413`, `src/output.ts:416`; `promo-flow/src/lib/explainer-to-html-core.mjs:103` | One cap, in the schema: `charts` is `.max(1)` on the wire. The artefact cap is `.max(1)` too unless the operator keeps charts 2 and 3 on migrated v1 explainers (Q12; then `.max(3)` on `ExplainerV2` only). The legacy `chart` field does not exist in v2; `migrateV1()` folds it into `charts[0]` when `charts` is empty and drops the duplicate otherwise. W1, W6, W9. |
| D9 | `src/types/explainer-json.ts:89`, `src/types/explainer-json.ts:174-200`; `src/output.ts:263-270`, `src/output.ts:314-324`; `src/figure-data.ts:407-412` | `recreated_figure` and `echarts_option` leave the contract. The recreation pass (`src/figure-data.ts`) keeps its provenance ladder and verify step but emits a `Chart` into `charts[]` with per-series `source.kind` (`supplied`, `table`, `value_labels`, `text`). `buildEChartsOption` is retained only as the internal SSR mapper for render-and-compare, taking a `Chart`; `echarts` stays an explainer-batch dependency for that purpose and promo-flow never needs it (Q10). W8. |
| D10 | `src/schema/explainer-schema.ts:188`; `skill.md:58`; `src/prompt.ts:25` | The model schema has no `image` and no `lead_figure`; it has `figure_request {label, why}`, which the prompt asks for explicitly. The resolved `lead_figure` exists only in `ExplainerV2`, which the model never sees. The contradiction cannot recur because the block in `skill.md` is generated from `ModelOutputV2`. W1, W5. |
| D11 | `src/quality.ts:200-202`; `skill.md:269` | `Section` carries a zod refinement: at least one of `paragraphs` (non-empty), `list` or `table` is present. The validator is the schema, so prose and validator cannot disagree. W1, W6. |
| D12 | `src/providers.ts:381-383`, `src/providers.ts:603-605`; `src/providers.ts:168-172`; `src/providers.ts:309-313` | The three dialects are generated from `ModelOutputV2` by one `toJSONSchema` call plus a fixture-tested post-pass per dialect (`## Dialects and generation`): OpenAI strict (every property required, `additionalProperties: false`, nullable as a type array), Claude `input_schema` (same object minus `$schema`), Gemini `responseSchema` (OpenAPI 3.0 target, no `additionalProperties`, `nullable: true`). Providers import the generated files instead of `EXPLAINER_JSON_SCHEMA`. Routes that cannot carry a schema (the subscription CLI) still get the generated prompt block and the same validator. Enabling Claude's strict tool mode is stage 17's call; the object already qualifies. W1, W6. |
| D13 | `promo-flow/src/lib/explainer-to-html-core.mjs:119`, `promo-flow/src/lib/explainer-to-html-core.mjs:201`, `promo-flow/src/lib/explainer-to-html-core.mjs:220`, `promo-flow/src/lib/explainer-to-html-core.mjs:309`; `promo-flow/src/components/explainers/ExplainerChartCanvas.tsx:91` | v2 carries no executable string and no HTML outside `InlineText`, whose grammar is six tags with one permitted attribute (`a href` with an `http(s)` URL). `sanitiseInline()` ships inside the vendored contract so both repos canonicalise with the same function; promo-flow re-runs it on read. References are structured, so the baker's raw `<p>${r}</p>` disappears with them. The chart island receives a `Chart` object and builds its own configuration. W2, W3, W4. |

## Schema v2

### Shape

```
ExplainerV2 (stored artefact)                         ModelOutputV2 (what the model emits)
  version: 2                              code          (absent)
  metadata {date_created, slug, model,    code          (absent)
            provider, route, source?,
            contract_revision,
            migrated_from?, quality}
  hero {title, headline, emphasis?,       model         hero {title, headline, emphasis, subtitle}
        subtitle, publication_date?}      date: code
  top_block  pills | takeaway             model         same
  sections[] {label, paragraphs[],        model         same
              list?, table?}
  charts[] 0..1 (Q12: 0..3 stored)        model/code    charts[] 0..1
  figure_request? {label, why}            model         figure_request
  lead_figure? {label, caption, alt_text, code          (absent)
                asset, sha256, width?,
                height?, page?, provenance}
  end_takeaway? {label, body}             model         same
  references[1] {authors[], year?,        code          citation {authors[], year?,
                 title, venue?, url?,                             title, venue?, url?} | null
                 origin}
```

Renamed: `metadata.filename_slug` to `metadata.slug`, `metadata.run_mode` to
`metadata.route`. Dropped from v1, with no replacement: `metadata.title`,
`metadata.eyebrow`, `hero.headline_html`,
`sections[].paragraphs_html`, `list.style`, `list.intro_html`,
`list.items[].body_html`, `table.align`, `pills[].accent_color`, `charts[]`
as Chart.js, `chart`, `image`, `recreated_figure`, HTML `references`,
`diagrams`. Each is either presentation, a twin, executable, or derivable
(see the derivations below).

### Text types

Two string types cover every prose field; which fields get which is fixed in
the tables and is what the renderer relies on.

| Type | Rule | Validated by | Sanitised by |
|---|---|---|---|
| `PlainText` | Raw characters. No tag sequence (`/<\/?[a-zA-Z]/` must not match; `<70%` is fine), no HTML entities. The renderer escapes on output. | zod refinement | `toPlain()`: decode entities, strip tags; removals recorded in `metadata.quality.dropped` |
| `InlineText` | Canonical HTML subset: `em`, `strong`, `code`, `sub`, `sup` with no attributes; `a` with exactly one attribute, `href`, an `http(s)` URL; no nesting of `a`; text escaped as `&amp; &lt; &gt; &quot;` only. Canonical means `sanitiseInline(s) === s`. | zod refinement (`sanitiseInline(s) === s`) | `sanitiseInline()`: lowercases tags, drops anything else (tag and attributes, keeping inner text), rewrites entities; removals recorded in `dropped` |

`inlineToPlain()` derives the plain copy for search, cards and alt text.
`sanitiseInline`, `inlineToPlain` and `toPlain` live in `contract/inline.ts`
and are vendored with the schema, so explainer-batch (at the canonicalise step, before validation) and
promo-flow (at read time) run the same code. The renderer adds
`target="_blank" rel="noopener noreferrer"` itself; the contract does not
carry them. Q3 records the alternatives.

### Fields

"Emitted by" is who writes the value. "Needed by" is the consumer that
justifies the field's existence; a field with no consumer does not exist.

Two kinds of bound appear in the tables. Structural bounds (a non-empty
string, at least one section, pill, list item, row and series, exactly one
reference) hold in both compositions. Editorial bounds (the `1..80` style
lengths, 2 to 5 sections, 2 to 6 pills, at most one chart, an `end_takeaway`
with pills) are enforced on `ModelOutputV2` only, because they are rules for
the model, not facts a renderer needs: the live tally in `## Current state`
has one six-section article, four subtitles over 320 characters and twelve
pills explainers with no `end_takeaway`, all curated and published. A stored
artefact outside an editorial bound carries a `metadata.quality.issues` entry
naming the bound instead of failing to parse.

**Root and `metadata`** (all stamped by code; `ModelOutputV2` has none of these)

| Field | Type | Emitted by | Needed by |
|---|---|---|---|
| `version` | literal `2` | code | both readers (dispatch) |
| `metadata.date_created` | `YYYY-MM-DD` | code, from the submit date persisted in state (`src/batch.ts:239`) | promo-flow sort key (`promo-flow/src/lib/explainers.ts:964`), slug |
| `metadata.slug` | `^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9_-]*_explainer$` (date prefix, safe filename characters, `_explainer` suffix); the producer's layout `date_author_short-title_explainer` is the stamp's convention, not a schema rule, because 4 live slugs carry extra `_` segments | code: date, first author family name (from `references[0]`), `hero.title` slugified and cut at a word boundary under 40 characters | filename, promo-flow route |
| `metadata.model` | string; `unknown` when v1 recorded none (43 of 49 live files) | code (`RunProvenance.model`, `src/output.ts:445`); migration | hero tag (omitted for `unknown`) |
| `metadata.provider` | string: `claude`, `openai`, or `unknown`; a new provider adds its id without a schema change | code; migration writes `unknown` or infers it from the model id | review, cost log |
| `metadata.route` | `batch` \| `sync` \| `unknown` | code (today's `run_mode`); migration writes `unknown` when `run_mode` was absent | hero tag (omitted for `unknown`) |
| `metadata.source` | `{kind: pdf \| url, ref}`; `ref` is the URL or the PDF basename, never a directory. Optional in the artefact: always present on a native v2 file, absent on a migrated one (v1 recorded no source) | code, from state (`src/state.ts:54`) | reextract, review, stage 18 |
| `metadata.contract_revision` | integer | code (`CONTRACT_REVISION`) | promo-flow drift check |
| `metadata.migrated_from` | literal `1`, present only on artefacts written by `migrateV1()` | migration | review; `check:contract` tally of migrated versus native files |
| `metadata.quality` | `{issues: string[], dropped: string[]}` | code | admin review; promo-flow ignores |

**`hero`**

| Field | Type | Emitted by | Needed by |
|---|---|---|---|
| `title` | `PlainText` 1..80 | model | page `<title>`, cards, slug |
| `headline` | `PlainText` 1..160 | model | hero H1 |
| `emphasis` | `PlainText`, must be a substring of `headline` | model (nullable on the wire) | hero highlight |
| `subtitle` | `PlainText` 1..320 | model | hero, cards |
| `publication_date` | `YYYY-MM` or `YYYY-MM-DD` | code, from detected metadata (`src/preprocess.ts:400-403`); absent when unknown | hero date line; renderer falls back to `references[0].year` |

**`top_block`** (discriminated on `kind`)

| Field | Type | Emitted by | Needed by |
|---|---|---|---|
| `kind` | `pills` \| `takeaway` | model | renderer |
| `pills[]` | 2..6 of `{lead: PlainText 1..24, text: PlainText 1..160}` | model | hero pills, cards |
| `label`, `body` (takeaway) | `PlainText`, `InlineText` | model | takeaway block |

**`sections[]`** (2..5 on the wire, 1 or more stored; refinement: non-empty `paragraphs`, or `list`, or `table`)

| Field | Type | Emitted by | Needed by |
|---|---|---|---|
| `label` | `PlainText` | model | section label |
| `paragraphs[]` | `InlineText[]` | model | prose, search |
| `list` | `{ordered: boolean, intro?: InlineText, items: 1+ of {label?: PlainText, body: InlineText}}` | model | list block |
| `table` | `{caption?: PlainText, columns: 2+ PlainText, rows: 1+ of (PlainText or empty)[], source?: SourceRef}` | model | table block; stage 19 gate |

`SourceRef` is `{ref: PlainText, page?: integer}`; `ref` names the table as
printed ("Table 2") or, for a URL source, the section heading. The caption
no longer carries the bracketed source tag: the renderer composes it from
`source`, and the style lint (`src/style-lint.ts`) stops parsing captions.

**`charts[]`** (0..1 on the wire)

| Field | Type | Emitted by | Needed by |
|---|---|---|---|
| `kind` | `bar` \| `stacked_bar` \| `line` \| `scatter` | model, or the recreation pass | chart island |
| `title`, `caption` | `PlainText` | model | chart card |
| `x` | `{label: PlainText, unit?: PlainText, type: category \| linear \| log, values: (string \| number)[]}` | model | axis |
| `y` | `{label: PlainText, unit?: PlainText, scale: linear \| log}` | model | axis |
| `series[]` | 1+ of `{name: PlainText, values?: (number \| null)[], points?: {x: number, y: number}[], source: SeriesSource}` | model | data; stage 19 gate |

`SeriesSource` is `{kind, ref: PlainText, page?: integer}`. The `kind` enum
differs by composition: the wire allows `table | text`; the artefact adds
`value_labels | supplied | legacy`. Semantics per kind are in Q4. Structural
refinements: a non-scatter series has `values` of the same length as
`x.values`; a scatter series has `points` and may leave `x.values` empty;
`stacked_bar` with `y.scale: log` is rejected (`skill.md:162`); a numeric
axis has a `unit` (`skill.md:212`). The ordinal and share-of-whole checks
from `src/quality.ts:71-105` become refinements on `series[].values`.

**`figure_request`** and **`lead_figure`**

| Field | Type | Emitted by | Needed by |
|---|---|---|---|
| `figure_request` | `{label: PlainText ("Figure 3"), why: PlainText 1..240}` | model (nullable on the wire) | stage 18 locator; kept in the artefact for reextract |
| `lead_figure.label` | `PlainText` | code (locator) | caption prefix |
| `lead_figure.caption`, `alt_text` | `PlainText` | code (locator or sidecar override) | figure block |
| `lead_figure.asset` | relative POSIX path, 1..2 segments, no `..`, no leading `/` | code | `<img src>` via the artefact's directory |
| `lead_figure.sha256`, `width`, `height` | hex string; integers, present for every raster asset and absent for the one migrated SVG | code | cache keys, layout, dedupe against `media/` |
| `lead_figure.page` | integer | code (PDF only) | review |
| `lead_figure.provenance` | `arxiv-source` \| `pdf-embedded` \| `pdf-vector-crop` \| `dom-asset` \| `vlm-crop` \| `legacy` | code; `legacy` by migration only | review; stage 18 |

**`end_takeaway`** is `{label: PlainText, body: InlineText}`, nullable on the
wire. Forbidden when `top_block.kind` is `takeaway` in both compositions
(`src/quality.ts:238-240` today). Required with pills on the wire only
(`src/quality.ts:241-243` today); the stored schema leaves it optional, since
12 live pills explainers have none, and migration records the absence as a
`quality.issues` entry.

**`citation`** (wire only) and **`references`** (stored, exactly one entry)

The paper's citation is the one value both the model and the harness can
supply, so it has two names with one owner each. `citation` is the model's
reading of the paper's own front matter; `references[0]` is code's, built
from detection when the harness has a detected reference and copied from
`citation` when it does not. Neither is ever overwritten: `citation` is not
stored, and `references` is never requested from the model.

| Field | Type | Emitted by | Needed by |
|---|---|---|---|
| `citation` | `{authors[], year?, title, venue?, url?}` with the field types below; nullable | model. The user turn says which case applies: "the citation is known, set `citation` to null" when detection has a value, "emit the paper's citation" when it does not. If a model emits one when told not to, canonicalisation sets it to `null` before validation with a `quality.dropped` entry, so it is never validated, repaired, compared or used | the stamp, only when no detected reference exists |
| `references[0].authors[]` | 1+ of `{family: PlainText, given?: PlainText}` | code: the detected reference (`src/state.ts:77`, structured in v2) or the model's `citation` | byline, slug, reference block |
| `references[0].year` | integer | code, as above | byline |
| `references[0].title` | `PlainText` | code, as above | reference block |
| `references[0].venue` | `PlainText` | code, as above | reference block |
| `references[0].url` | `https?://` URL | code, as above | reference link |
| `references[0].origin` | `detected` \| `model` \| `legacy` | code; `legacy` by migration only | review; stage 17's run ledger |

### Derived, never stored

| Derived value | From |
|---|---|
| Byline, e.g. `Alenezi (2026)` or `Hu et al. (2025)` | `references[0].authors[0].family`, author count, `year`, through `contract/derive.ts` so both repos produce the same string |
| Eyebrow `Research Explainer · <byline>` | byline |
| Page title `<hero.title>: <byline>` | `hero.title`, byline |
| "Published February 2026" | `hero.publication_date`, else `references[0].year` |
| Caption source tag `(Table 3, p. 12)` | `table.source`, or the distinct `series[].source` entries |
| Plain text for search and cards | `inlineToPlain()` over `InlineText` fields |
| Pill accents, headline highlight, list numbering style, column alignment | the renderer's own rules |

### One source, two compositions

The file declares each block once as a function of one composition object,
`c`, with two members: `c.opt`, which is `nullable` for the wire and
`optional` for the artefact, and `c.edit`, which applies an editorial bound
on the wire and is the identity for the artefact. A field is therefore
written once and both schemas stay structurally identical where they
overlap.

```ts
// contract/explainer-v2.ts (sketch; W1 writes it)
import { z } from 'zod';
export const CONTRACT_REVISION = 1;

type Bound = { min?: number; max?: number };
type Comp = {
  opt: <T extends z.ZodTypeAny>(s: T) => z.ZodTypeAny;                 // nullable | optional
  edit: <T extends z.ZodString | z.ZodArray<any>>(s: T, b: Bound) => T; // editorial bound | identity
};
const onWire: Comp = { opt: (s) => s.nullable(), edit: (s, b) => bounded(s, b) };
const stored: Comp = { opt: (s) => s.optional(), edit: (s) => s };

const Plain = z.string().min(1).refine(isPlain, 'no tags or entities');
const Inline = z.string().min(1).refine((s) => sanitiseInline(s) === s, 'not canonical inline markup');

const sourceRef = (c: Comp) => z.strictObject({ ref: Plain, page: c.opt(z.int().positive()) });
const seriesSource = (c: Comp, kinds: readonly [string, ...string[]]) =>
  z.strictObject({ kind: z.enum(kinds), ref: Plain, page: c.opt(z.int().positive()) });
const section = (c: Comp) => z.strictObject({
  label: Plain,
  paragraphs: z.array(Inline),
  list: c.opt(list(c)),
  table: c.opt(table(c)),
}).refine(hasContent, 'a section needs paragraphs, a list or a table');
const chart = (c: Comp, kinds: readonly [string, ...string[]]) => z.strictObject({ /* ... */ });
const citation = z.strictObject({ authors: z.array(author).min(1), year: ..., title: Plain, venue: ..., url: ... });

const WIRE_KINDS = ['table', 'text'] as const;
const STORED_KINDS = ['table', 'text', 'value_labels', 'supplied', 'legacy'] as const;

export const ModelOutputV2 = z.strictObject({
  hero: hero(onWire),
  top_block: topBlock(onWire),
  sections: onWire.edit(z.array(section(onWire)).min(1), { min: 2, max: 5 }),
  charts: z.array(chart(onWire, WIRE_KINDS)).max(1),
  figure_request: onWire.opt(figureRequest),
  end_takeaway: onWire.opt(takeaway),
  citation: onWire.opt(citation),
}).refine(takeawayRule(onWire));

// The request context decides whether the model had to emit a citation.
export const modelOutputValidator = (ctx: { citationKnown: boolean }) =>
  ctx.citationKnown
    ? ModelOutputV2
    : ModelOutputV2.refine((o) => o.citation !== null, 'citation: no reference was detected, so the model must emit the citation');

const metadata = z.strictObject({
  date_created: IsoDay, slug: Slug, model: z.string().min(1),
  provider: z.string().min(1), route: z.enum(['batch', 'sync', 'unknown']),
  source: stored.opt(source), contract_revision: z.int().positive(),
  migrated_from: stored.opt(z.literal(1)), quality,
});

export const ExplainerV2 = z.strictObject({
  version: z.literal(2),
  metadata,
  hero: hero(stored).extend({ publication_date: stored.opt(IsoMonthOrDay) }),
  top_block: topBlock(stored),
  sections: z.array(section(stored)).min(1),
  charts: z.array(chart(stored, STORED_KINDS)).max(1),   // .max(3) if Q12 says keep
  figure_request: stored.opt(figureRequest),
  lead_figure: stored.opt(leadFigure),
  end_takeaway: stored.opt(takeaway),
  references: z.array(citation.extend({ origin: z.enum(['detected', 'model', 'legacy']) })).length(1),
}).refine(takeawayRule(stored));

export type ModelOutputV2 = z.infer<typeof ModelOutputV2>;
export type ExplainerV2 = z.infer<typeof ExplainerV2>;
```

`takeawayRule(c)` forbids `end_takeaway` with a takeaway top block in both
compositions and requires it with pills on the wire only. The metadata,
references and `lead_figure` blocks are declared with `stored` alone because
no wire composition contains them.

Every object is `z.strictObject`, which zod 4 emits as
`additionalProperties: false` regardless of the `io` setting
(`node_modules/zod/v4/core/json-schema-processors.js:307-309` in the 4.3.6
copy that `@anthropic-ai/sdk` already pulls in). Refinements are runtime
checks only; they are not representable in JSON Schema and are not meant to
be. The dialects carry structure; the validator carries structure plus the
content rules; the repair prompt is built from the validator's issues.

Because the wire objects are strict, a model that emits a key the schema
does not know (a `metadata` block, say, or `references`) would fail
validation. Canonicalisation therefore drops unknown keys at any depth
before validation and records each in `quality.dropped`, so a stamped field
can never cost a repair call even when a model ignores the instruction not
to emit it.

### Save order

This is the one statement of the order in which a model response becomes a
stored artefact; the Summary, D5, Q6, Q7 and W6 refer to it and do not
restate a different one. Every route (batch, sync, subscription CLI) runs the
same steps.

1. **Parse** the response to JSON (`extractJson`, as today).
2. **Canonicalise** the wire object, keeping its nulls: `sanitiseInline()`
   on `InlineText` fields, `toPlain()` on `PlainText` fields, drop unknown
   keys at any depth, and, when the request context says the citation is
   known (`citationKnown: true`), set `citation` to `null`. Each removal,
   including a non-null `citation` replaced by `null`, goes to
   `quality.dropped`. Canonicalising the ignored citation first means a
   malformed citation the harness would discard can never trigger repair.
3. **Validate** with `modelOutputValidator({citationKnown})` against the
   wire shape, nulls intact. A nullable wire property is required, so a
   compliant `citation: null`, `figure_request: null` or `emphasis: null` is
   valid here; stripping nulls before this step would turn each of them into
   a missing required property and a needless repair call.
4. **Repair** (`src/repair.ts:38-63` today) against those issues only; each
   repaired response re-enters at step 1, so it is canonicalised and
   validated the same way. After the last attempt, a structural failure on
   an optional item is resolved by setting that item to `null` (listed in
   `quality.dropped`), editorial issues are kept in `quality.issues`, and a
   structural failure on a required field takes the `_error.txt` path.
5. **Stamp** onto the validated wire object: `version`, `metadata` from
   state (date, slug, model, provider, route, source, contract revision)
   with `metadata.quality {issues, dropped}`, `hero.publication_date`,
   `references[0]` with its `origin` (the detected reference when
   `citationKnown`, else a copy of `citation`), and `lead_figure` from the
   locator. No stamp reads a field the model was told to leave null, and no
   stamp writes a key the wire schema contains, so nothing is overwritten.
   `citation` is consumed here and not carried forward.
6. **Strip nulls** while composing the stored object: every object property
   whose value is `null` is removed, so `c.opt` fields that were null on the
   wire become absent, as the `stored` composition expects. Array elements
   are left alone, so a `null` gap in `series[].values` survives. This is
   today's `stripSchemaNulls` (`src/output.ts:139-153`) moved from before
   validation to after stamping.
7. **Assert** `ExplainerV2.safeParse`. A failure here is a harness bug,
   thrown with the raw output kept as `_error.txt` (`src/output.ts:532-537`
   today), never a repair trigger.
8. **Store**: write the JSON, the figure sidecar and the staged copies.

Short form, used elsewhere in this document: canonicalise, validate and
repair with nulls, stamp, strip nulls, store.

Descriptions attach with `.describe()` on each field and flow into every
dialect's `description` and into the generated `skill.md` block, so the
prose the model reads about a field and the schema the API enforces come
from the same string.

## Dialects and generation

### Artefacts and their producers

| Output | Produced by | Consumed by |
|---|---|---|
| TypeScript types `ModelOutputV2`, `ExplainerV2` | `z.infer`, no file | both repos |
| Runtime validator | the zod schemas themselves (`safeParse`) | `src/output.ts`, `src/repair.ts`, promo-flow `parseExplainerJson()` |
| `contract/generated/explainer-v2.schema.json` (canonical, draft 2020-12, from `ExplainerV2`) | `z.toJSONSchema(ExplainerV2, {target: 'draft-2020-12', io: 'output', unrepresentable: 'throw'})` | promo-flow `check:contract` (optional second validator), editors, docs |
| `contract/generated/model-output.openai.json` | `z.toJSONSchema(ModelOutputV2, {target: 'draft-2020-12'})` then the OpenAI pass | `src/providers.ts:381-383` (`text.format`), batch bodies |
| `contract/generated/model-output.claude.json` | same call, then the Claude pass | `src/providers.ts:168` (`input_schema`) |
| `contract/generated/model-output.gemini.json` | `z.toJSONSchema(ModelOutputV2, {target: 'openapi-3.0'})` then the Gemini pass | a future Gemini provider (stage 17); pinned by fixture now |
| `skill.md` block between `<!-- CONTRACT-V2-BEGIN -->` and `<!-- CONTRACT-V2-END -->` | the skill renderer over the OpenAI dialect (the strictest, so the model sees what the API enforces) | the system prompt (`src/prompt.ts:19`) |
| promo-flow `src/contract/{explainer-v2.ts, inline.ts, derive.ts, migrate-v1.ts}` | verbatim copy of every `contract/*.ts` with a generated header | promo-flow build and checks |

### What zod 4 emits, and the per-dialect pass

The 4.3.6 generator's behaviour, read from the shipped code rather than
assumed: `.nullable()` becomes `anyOf: [inner, {type: 'null'}]` on the
draft targets and `nullable: true` on `openapi-3.0`
(`node_modules/zod/v4/core/json-schema-processors.js:446-457`); `.optional()`
drops the key from `required` (`:294-302`); `z.literal('pills')` becomes
`const` on draft-07 and 2020-12 but `enum: ['pills']` on draft-04 and
`openapi-3.0` (`:179-187`); discriminated unions become `anyOf`; tuples
become `prefixItems`, which is why scatter points are `{x, y}` objects rather
than tuples. The documented options are `target`, `io`, `unrepresentable`,
`cycles`, `reused`, `override` and `metadata`
(`node_modules/zod/v4/core/to-json-schema.d.ts:16-33`).

Each dialect is the canonical output plus a small, deterministic,
fixture-tested post-pass in `contract/dialects.ts`. No dialect is
hand-written.

| Dialect | Pass | Why |
|---|---|---|
| OpenAI strict | Collapse `anyOf: [{type: T, ...}, {type: 'null'}]` into `type: [T, 'null']` carrying the inner keywords (the form `src/schema/explainer-schema.ts:44-55` uses today). Rewrite `const: v` to `enum: [v]` (`src/schema/explainer-schema.ts:25` records that a bare `const` was a problem). Keep only `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `anyOf`, `description`, `minItems`, `maxItems`; drop `$schema`, `minLength`, `maxLength` and other keywords the strict subset does not accept. Assert afterwards that every object has `additionalProperties: false` and lists every property in `required`. | OpenAI's strict mode requires every property required and `additionalProperties: false`; optionality must be expressed as null. |
| Claude `input_schema` | Drop `$schema`. Rewrite `const` to `enum` (harmless, keeps one shape). Keep `anyOf` nullables. | Claude's tool schema accepts standard JSON Schema; the strict-tool variant also wants `additionalProperties: false` and all-required, which the object already satisfies, so stage 17 can flip `strict: true` without a schema change. |
| Gemini `responseSchema` | Start from the `openapi-3.0` target (so nullables are `nullable: true` and literals are `enum`). Drop `additionalProperties` everywhere and `$schema`. Add `propertyOrdering` = property insertion order on every object. | Gemini rejects `additionalProperties`; `propertyOrdering` keeps key order deterministic for the model. |

The `override` hook is an alternative to a post-walk; a walk over plain JSON
is easier to fixture-test and does not depend on zod internals, so the design
uses the walk.

### Build and check

- `npm run contract:build` runs `scripts/contract-build.ts`: generates the
  four JSON files, rewrites the `skill.md` block in place between the
  markers (the prose outside the markers is untouched), and with
  `--website` (or when `WEBSITE_REPO` is set) copies every `contract/*.ts`
  source file (a glob, so a new file such as `migrate-v1.ts` needs no script
  change) into `$WEBSITE_REPO/src/contract/` with a first-line header
  `// generated by explainer-batch contract:build; revision N; do not edit`.
- `npm run contract:check` runs the same generators into memory and prints
  a unified diff for anything that differs on disk: the generated JSON, the
  `skill.md` block, and, when `WEBSITE_REPO` is set, the sibling's vendored
  copies. Exit 1 on drift. `tests/unit/contract.test.ts` calls the same
  function, so `npm test` is the drift gate; the pre-commit hook under
  `scripts/git-hooks/` may call it too, but `npm test` is the contract.
- `src/prompt.ts` strips the two marker comments when building the system
  prompt, so the markers never reach the model.

Neither repo lists zod today (`package.json:30-35`,
`promo-flow/package.json:30-52`); explainer-batch already has it transitively
at 4.3.6. W1 adds `zod@^4` as a direct dependency of explainer-batch, W3 of
promo-flow.

## Sharing with promo-flow

### Options

| Option | How it works | Drift detection | Cost |
|---|---|---|---|
| Published package (`@promotionem/explainer-contract`) | explainer-batch publishes a package; promo-flow depends on a version | semver; promo-flow pins and bumps | A registry (private, or public via the mirror), auth on Netlify, a release step for every schema change, two repos' lockfiles |
| Vendored copy, generator-delivered, revision-checked | `contract:build --website` writes `src/contract/*` into the sibling checkout with a header; promo-flow commits it | explainer-batch: `contract:check` diffs the sibling's copy when `WEBSITE_REPO` is set. promo-flow: `check:contract` parses every live sidecar with the vendored schema and fails when an artefact's `metadata.contract_revision` exceeds the vendored `CONTRACT_REVISION` | Four source files committed twice; no registry; the operator lands a promo-flow commit per contract change |
| Generated file read from the sibling at build time | promo-flow imports `../explainer-batch/contract/...` or regenerates from a path | none needed, nothing is copied | promo-flow's Netlify build would depend on another checkout being present; the public mirror could not build promo-flow |

### Choice

The vendored copy, delivered by the generator and guarded by a revision
number in both directions. It needs no infrastructure, it is the mechanism
already used for the JSON artefacts themselves (explainer-batch writes into
`explainers-new/`, `src/output.ts:580-584`), and it keeps promo-flow's build
self-contained. The copy is four files: the zod source, the inline
sanitiser, the byline derivations (`derive.ts`) and `migrate-v1.ts`.

Drift is detected in each repo as follows. In explainer-batch, `npm test`
fails when the generated files or the `skill.md` block are stale, and warns
(not fails) when the sibling checkout's `CONTRACT_REVISION` is behind, since
the sibling may legitimately be mid-update. In promo-flow,
`npm run check:contract` (W3) runs `parseExplainerJson()` over
`public/explainer-html/**/*.json` and `explainers-new/*.json`; a strict
object rejects any key the vendored schema does not know, and the revision
comparison turns "a producer got ahead of this reader" into a named failure
rather than a parse error. The approve route runs the same parse before
publishing (`promo-flow/src/app/api/admin/approve/[filename]/route.ts:73-74`
is where the staged JSON is read and parsed today, and `:90` is where the
baker is then called on it), so a newer artefact cannot reach the live
site.

### Landing a contract change without breaking the live site

Within version 2 a change is additive and the new field is optional in
`ExplainerV2`; anything else bumps `version` to 3 and gets a new migration.
The order for an additive change is fixed: (1) explainer-batch lands the
schema change and bumps `CONTRACT_REVISION` on `dev`, with `npm test`
green; (2) `contract:build --website` writes the copy, and promo-flow lands
the vendored files plus any renderer change in one commit, deploys; (3) only
then does explainer-batch's producer run with the new revision. Because the
new field is optional, promo-flow at step 2 still reads every older artefact.
The public mirror of explainer-batch receives steps 1 and 3 whenever the
operator next replays `publish`; that replay is manual and curated and is
never a card step. A change made before any artefact or vendored copy exists
at the current revision leaves the revision unchanged (the blank-cell change
of 2026-10-22).

## What the promo-flow renderer needs

This section states what promo-flow's native renderer (W4, not designed here)
may rely on. Anything not listed is not promised.

### Guarantees

- A file that passes `parseExplainerJson()` is a complete `ExplainerV2`:
  every required field present and typed, every `InlineText` canonical,
  every `PlainText` tag-free, `references.length === 1` with `origin` set,
  at least one section and each with content, at least one pill when
  `top_block.kind === 'pills'`, `end_takeaway` absent when the top block is
  a takeaway, `emphasis` a substring of `headline`. The editorial bounds (2
  to 5 sections, 2 to 6 pills, the string lengths, an `end_takeaway` with
  pills) hold for every native v2 artefact; a migrated file may sit outside
  one, and then says so in `metadata.quality.issues`, so the renderer must
  cope with a missing `end_takeaway` and a sixth section.
- `metadata.model` and `metadata.route` are `unknown` on most migrated
  files; the hero tag that shows them is omitted for that value.
- `parseExplainerJson()` returns a `version: 2` object for a v1 file too,
  via `migrateV1()`, until W10 deletes that path. The renderer never sees a
  v1 shape.
- `metadata.quality.issues` may be non-empty on a file the operator chose to
  approve anyway; the renderer ignores `quality` entirely.
- No field contains executable content, and no field other than the five
  `InlineText` fields contains markup. The renderer escapes `PlainText` on
  output and passes `InlineText` through `sanitiseInline()` once more before
  injecting it; the allowlist is the contract's, not a second one.

### Which fields are which

| Plain (escape on output) | Inline (allowlisted subset) |
|---|---|
| `hero.title`, `hero.headline`, `hero.emphasis`, `hero.subtitle`, pill `lead` and `text`, takeaway `label`, section `label`, list item `label`, table `caption`, `columns`, `rows`, chart `title`, `caption`, axis `label`, `unit`, series `name`, `source.ref`, `lead_figure.caption`, `alt_text`, reference fields | `top_block.body` (takeaway), `sections[].paragraphs[]`, `list.intro`, `list.items[].body`, `end_takeaway.body` |

### The chart island's input

The island receives one `Chart` object and builds a Chart.js configuration
from it (Chart.js is already a dependency, `promo-flow/package.json:33`);
nothing in the artefact is a configuration. It may rely on: `kind` in the
four-value enum; `x.type` and `y.scale`; `x.values` aligned by index to
each non-scatter series' `values` (`null` is a gap); scatter series carrying
`points`; `unit` present on every numeric axis; `series[].source` for the
caption tag. It must not assume a point count beyond 1 (the 6-point filter
in `src/output.ts:363-366` is a producer policy, and migrated `legacy`
charts are not re-filtered).

### The figure asset

`lead_figure.asset` resolves against the artefact's own directory:
`public/explainer-html/<folder>/<slug>.json` with `asset: "<slug>/figure-3.jpg"`
serves from `/explainer-html/<folder>/<slug>/figure-3.jpg`; a migrated file
with `asset: "media/d3201ff0d6c9.jpg"` serves from
`/explainer-html/<folder>/media/d3201ff0d6c9.jpg` (migration rewrites the
site-absolute `src` the 12 live files carry today into that relative form;
one of them is an SVG beside the JSON rather than a `media/` JPEG). The
approve step copies `explainers-new/<slug>/` alongside the JSON (W3), and
`check:media` keeps failing on any `data:` URL
(`promo-flow/scripts/extract-explainer-media.mjs:158-161`). `width` and
`height` are present for every raster asset and reliable for layout;
`alt_text` is always present.

### Derivations the renderer owns

Byline, eyebrow, page title, the "Published ..." line, caption source tags,
pill accents, the headline highlight and column alignment are composed by the
renderer from the fields in `## Schema v2`. The baker that produces the
archive HTML (`promo-flow/src/lib/explainer-to-html-core.mjs`) is rewritten
against `ExplainerV2` as part of W4, since the archive snapshot must come
from the same input as the live page.

## Migration and rollback

### The mapping (`migrateV1()`)

A pure function from any v1 file to an `ExplainerV2`, shipped in
`contract/migrate-v1.ts` and vendored. It never does I/O; the two callers
(promo-flow's reader, explainer-batch's file rewriter) supply the bytes of a
base64 image and the folder listing it needs through parameters.

| v1 | v2 |
|---|---|
| `version: 1` | `version: 2`; `metadata.contract_revision` = the migrating revision; `metadata.migrated_from: 1` |
| `metadata.date_created`, `filename_slug` | `metadata.date_created`, `metadata.slug` (unchanged strings; the stored slug rule accepts all 49 live slugs, including the 4 with extra `_` segments) |
| `metadata.model`, `run_mode` | `metadata.model` = the v1 value, else `unknown` (43 of 49 live files); `metadata.route` = `run_mode`, else `unknown` (`sync` is never assumed); `metadata.provider` = `openai` for a `gpt-` model id, `claude` for `claude-`, else `unknown`; `metadata.source` absent. Every migrated file therefore carries every required `metadata` field |
| `metadata.title`, `eyebrow` | `hero.title` = the part of `title` before the final `: Surname (Year)` segment; eyebrow dropped |
| `hero.headline`, `headline_html` | `hero.headline`; `emphasis` = the text of the first `<span>` in `headline_html` when it is a substring of `headline` |
| `hero.publication_date` "Published Month Year" | `hero.publication_date` as `YYYY-MM`; omitted when absent or unparseable |
| `top_block.pills[].number`, `description`, `accent_color` | `lead` (entities decoded), `text`; colour dropped |
| `sections[].paragraphs`, `paragraphs_html` | `paragraphs` = `sanitiseInline(paragraphs_html[i])` when present, else `paragraphs[i]`; removed tags are recorded in `quality.dropped` |
| `list.style`, `intro_html`, `items[].body_html` | `style` dropped; `intro` and `body` from the `_html` twin when present |
| `table.align` | dropped |
| a takeaway (`top_block` or `end_takeaway`) with `headline` instead of `label`, or `paragraphs_html` / `paragraphs` instead of `body` | `label` = `label`, else `headline`; `body` = the `body_html` / `body` twin when either is present, else the non-empty paragraphs joined with one space; a takeaway with neither `label` nor `headline` stays a typed failure |
| an empty table cell (the paper reported no value) | stays `''`; every other cell goes through `toPlain()` |
| `table.caption` ending in a source tag `(Table 2, p. 6)` | tag parsed into `table.source {ref, page}` and removed from the caption |
| `charts[]` with an object `config_json` of type `bar`, `line` or `scatter`; the legacy `chart` copy (35 live files) when `charts` is empty (13 live files) | one `Chart` per entry: `data.labels` to `x.values`, each dataset to a series, `options.scales.*.title.text` to axis labels, `stacked` to `stacked_bar`, a log axis to `scale: log`; every series gets `source {kind: 'legacy', ref: 'v1 charts[i]'}` and the caption's source tag, when present, becomes `ref`. A legacy `chart` beside a non-empty `charts` is the duplicate `src/output.ts:416` writes (identical to `charts[0]` in 21 of the 22 live files that have both) and is dropped, with a `quality.dropped` entry only when it differs |
| a legacy `chart` with `config_json: null` and code in `config_raw` only (12 live files, their only chart) or a `charts[]` entry of a banned type (5 live entries) | not converted automatically; the chart is dropped with a `quality.dropped` entry naming the title and the migration prints the list for curation (Q13; none of the 12 `config_raw` strings contains a function, which gives the operator a third option there) |
| `image {source_figure, caption, alt_text, src}` | `lead_figure` with `label`, `caption`, `alt_text`; `asset` is `src` rewritten relative to the artefact's directory when `src` is a path (the 12 live files carry a site-absolute `/explainer-html/<folder>/media/<sha>.jpg`, one of them an SVG beside the JSON; all 12 resolve to a file next to the JSON), or a file the rewriter writes from the base64 (21 local files); `sha256` from the bytes, `width` and `height` for raster files; `provenance: 'legacy'` |
| `recreated_figure` (1 live, 7 in `output/`) | converted to a `Chart` with `source.kind` from each series' `provenance` and `source` text (`exact` with a table citation to `table`, otherwise `text`; `supplied` stays `supplied`); `figure_estimated` entries are dropped with a `quality.dropped` entry (Q11) |
| `references[]` HTML strings | exactly one structured reference with `origin: 'legacy'`: the anchor `href` becomes `url`; authors, year, title and venue are parsed from the APA-style text where the pattern matches, otherwise `title` holds the plain text and `quality.issues` records the partial parse; extra entries (3 live files) are dropped and listed |
| `diagrams` (1 live) | dropped and listed (Q14) |
| anything else undeclared | dropped and listed |
| a value outside an editorial bound (1 live file with 6 sections, 4 subtitles over 320 characters, 12 pills explainers without an `end_takeaway`) | kept as is; `quality.issues` names the bound. The stored schema enforces only structural bounds (see `## Schema v2`), so the file still parses |
| a file that fails a structural bound (in `output.local/`: 2 files with no sections, 2 with no reference; none live) | cannot become an `ExplainerV2`; `migrateV1()` returns a typed failure, the rewriter leaves the file as v1 and lists it, and `--check` counts it until the operator deletes or hand-fixes it |

### Steps, in order, each with its rollback

Readers land before producers, so the website can read and render a v2
artefact before the first one is written.

1. **W1 lands the contract in explainer-batch** (`dev`). Producers still
   write v1; nothing consumes the new files. Rollback: revert the commit.
   No artefact or site state changed.
2. **W2 lands `migrateV1()` in explainer-batch.** A pure function with
   tests; nothing calls it yet. Rollback: revert the commit.
3. **W3 lands the reader in promo-flow.** The vendored copy,
   `parseExplainerJson()` with the in-memory v1 reader, `check:contract`,
   and the approve route's parse-before-publish replace the two hand copies
   and `normalizeSidecarJson`. The 49 live explainers stay v1 on disk and
   are still served as baked HTML; cards, dates, pills and the admin
   listings now come through `parseExplainerJson()`. Rollback: revert the
   promo-flow commit; the deleted hand copies and normaliser return with
   it.
4. **W4 lands the native renderer and the v2 baker in promo-flow.** A
   `version: 2` file renders natively; a file still at v1 on disk keeps
   serving its baked HTML, so no live page changes. The baker, the admin
   preview and the export route take an `ExplainerV2`. Rollback: revert the
   promo-flow commit; there is no v2 file on the site yet, so nothing is
   affected.
5. **W5 then W6 switch the prompt and the producer**, as two commits landed
   back to back with no production run between them (W5 changes what the
   model emits, W6 what the pipeline accepts). New runs write `ExplainerV2`
   plus the figure sidecar into `output/`, the staging directory and the
   Obsidian mirror, and promo-flow (step 4) can approve and render them.
   Rollback: revert both commits on `dev`; v2 files already written stay
   readable by promo-flow and can be deleted by hand, since `output/` is
   not tracked.
6. **W7 and W8 finish the figure paths** (reextract on the sidecar; the
   recreation pass emitting a `Chart`). No site state changes. Rollback:
   revert each commit independently.
7. **W9 rewrites the archives.** `scripts/migrate-v1-to-v2.ts` runs over
   `output/`, `output.local/` and, with `--website`, every
   `promo-flow/public/explainer-html/**/*.json` (49 files: 12 whose only
   chart is a code-only legacy `chart` and 5 with banned chart types to
   curate, 12 with `media/` images, 1 with `diagrams`, 1 with
   `recreated_figure`, 3 with extra references, and up to 17 outside an
   editorial bound, which migrate with an issue recorded). For the
   untracked local archives the script writes `<name>.v1.json` beside each
   rewritten file and leaves a file that cannot migrate (no sections, no
   reference) as v1, listed. The promo-flow rewrite is one commit that also
   re-bakes the 49 HTML files from v2 through the W4 baker, so the archive
   snapshot and the JSON agree, and from that deploy the 49 render
   natively. The operator reviews the migration report (dropped items and
   issues per file) before that commit. Rollback: for promo-flow,
   `git revert` of the one commit restores the 49 v1 files and their HTML,
   and step 4's rule serves them as baked HTML again; for the local
   archives, move each `.v1.json` back over its v2 file.
8. **W10 deletes the v1 reader** once `check:contract` reports zero v1
   files in promo-flow and `migrate-v1-to-v2.ts --check` reports zero in
   the local archives, and step 7 has been live through one deploy.
   `migrate-v1.ts` is removed from the contract, the vendored copy and the
   script. Rollback: revert the commit; the v1 reader is a pure function
   and comes back intact. A v1 file that appears after W10 (for example an
   old `explainers-new/` drop) fails `check:contract` with "version 1 is
   no longer read; run explainer-batch's migration script", which is the
   intended behaviour, not a gap.

### Ordering across the two repos and the publish branch

explainer-batch `dev` (steps 1 and 2) before promo-flow `dev` (steps 3 and
4) before explainer-batch's prompt and producer (step 5) and figure cards
(step 6) before the promo-flow archive rewrite (step 7) before deletion
(step 8). promo-flow deploys from its own trunk after steps 3, 4 and 7.
explainer-batch's `publish` branch and public mirror pick up steps 1, 2, 5,
6 and 8 whenever the operator replays, which is manual and curated and never
part of a card; the generated `contract/generated/*.json` files are tracked
so the mirror carries them.

## Tradeoffs

1. **zod 4 with native `z.toJSONSchema`** over zod 3 plus
   `zod-to-json-schema`, and over TypeBox. zod 4 ships the generator in the
   package, with the `openapi-3.0` target that the Gemini dialect needs and
   the `override` hook if a pass ever needs schema-level context; it is
   already in explainer-batch's `node_modules` at 4.3.6 through the
   Anthropic SDK, so the version is known to coexist. Rejected: zod 3 plus
   `zod-to-json-schema` (a second dependency whose README points zod 4
   users at the built-in generator; no OpenAPI 3.0 target) and TypeBox
   (JSON-Schema-first, so the TypeScript types and validator are fine, but
   the three dialects still need the same post-pass, the operator's
   direction is a zod source, and nothing in the design is blocked by zod,
   so no deferred case is raised).
2. **Inline markup as a canonical HTML subset** over markdown-lite and
   over `{text, marks}` runs. The models already emit exactly this subset
   (strong, em, code, a, sup in every corpus), the renderer already has an
   HTML sanitiser (`promo-flow/package.json:42`), and a canonical form
   makes validation a one-line equality. Rejected: markdown-lite (ambiguous
   in technical prose: `O(N*M)`, `snake_case`, `2*2`) and runs (safest
   shape, but models produce them unreliably, every paragraph becomes an
   array of objects, and tokens roughly double for the same prose).
3. **Vendored copy delivered by the generator** over a published package
   and over a build-time read of the sibling. Rejected: the package (a
   registry, Netlify credentials and a release step for a four-file
   contract that changes a few times a year) and the sibling read
   (promo-flow's build must not depend on another checkout; the public
   mirror could never build it).
4. **Two compositions from shared blocks** over one schema with
   transforms and over one nullable-everywhere schema. A `.transform()`
   makes the schema unrepresentable to `toJSONSchema` under
   `unrepresentable: 'throw'`, and a single all-nullable schema would store
   nulls in artefacts and let the model emit stamped fields. Rejected: both,
   for those reasons.
5. **Sidecar asset by relative path** over base64 and over a
   content-addressed `media/` directory as the producer's convention. The
   relative-path rule accepts the existing `media/<sha12>.jpg` files, so
   migration moves no bytes, while a new artefact's `<slug>/figure-N.jpg`
   keeps the asset next to the file that owns it. Rejected: base64 (D6) and
   mandating `media/` (the producer does not know promo-flow's folder, and
   the hash name hides which figure it is).
6. **Dropping `eyebrow`, byline, `title`, `tone`, `style` and `align`**
   over keeping the starting shape's `eyebrow*`, `byline*` and `tone?`. The
   eyebrow, byline and page title are deterministic functions of
   `references[0]` and `hero.title`; a stamped copy is a second source of
   truth that can disagree with the first. Pill tone, list style and column
   alignment are presentation. Rejected: keeping them as stamped or
   model-emitted fields.
7. **Chart cap of 1 on the wire** over 4 (never used well: 18 of 49 live
   files have 2 or 3 charts, and 12 more have only a code-only legacy
   `chart`) and over 0 (a
   stated-values chart is content the operator asked for in card 02).
   Rejected: both. Whether the artefact cap is 1 or 3 for migrated files is
   Q12.
8. **Structured references** over the HTML string. A string cannot yield a
   byline or a slug without parsing, and the detected reference is already
   built from structured `citation_*` metadata
   (`src/preprocess.ts:392-405`). Rejected: the HTML string, and a mixed
   form with both.
9. **Editorial bounds on the wire only** over enforcing them in the stored
   schema and over having none. The model needs the bounds, and the
   renderer does not: it needs non-empty, well-typed content. Enforcing
   them on `ExplainerV2` would fail up to 17 curated live files at
   migration or force trimming pages the operator approved. Rejected: both;
   a migrated file outside a bound records it in `quality.issues` instead.
10. **A model-owned `citation` beside a code-owned `references`** over the
   model emitting `references` for detection to overwrite, and over
   detection as the only source. The first is today's generate-then-overwrite
   (`src/output.ts:524-526`), which costs repair calls on a field that is
   then replaced and leaves two owners for one value. The second fails on
   any PDF without `citation_*` metadata, where only the model has read the
   front matter. Rejected: both. The split costs one nullable field on the
   wire and an `origin` enum in the artefact.

## Open questions

1. **Q1** Which zod version and JSON Schema path. **Answer:** zod 4 (`zod@^4`, the shipped `z.toJSONSchema`), one `draft-2020-12` canonical output plus the `openapi-3.0` target for Gemini, and a fixture-tested post-pass per dialect in `contract/dialects.ts`. The behaviours relied on are read from the 4.3.6 generator in this tree (`node_modules/zod/v4/core/json-schema-processors.js:179-187`, `:294-322`, `:446-457`; options at `node_modules/zod/v4/core/to-json-schema.d.ts:16-33`). TypeBox is rejected in `## Tradeoffs` 1 without a deferred case, because nothing it offers is needed.
2. **Q2** How promo-flow consumes the contract and how a change lands in both repos. **Answer:** a vendored copy of four files written by `contract:build --website`, guarded by `CONTRACT_REVISION` (explainer-batch warns when the sibling is behind; promo-flow's `check:contract` and approve route fail when an artefact is ahead). Additive, optional changes only within version 2. Order: explainer-batch schema on `dev`, then promo-flow reader plus renderer in one commit and deploy, then the producer. See `## Sharing with promo-flow`.
3. **Q3** Inline markup representation, sanitisation and plain text. **Answer:** a canonical HTML subset (`em`, `strong`, `code`, `sub`, `sup`; `a` with `href` only) in five `InlineText` fields; `sanitiseInline()` canonicalises in explainer-batch at the canonicalise step, before validation (`### Save order`), (removals go to `quality.dropped`) and again at read time in promo-flow; validity is `sanitiseInline(s) === s`; `inlineToPlain()` derives search and card text; nothing plain is stored twice. Markdown-lite and runs are rejected in `## Tradeoffs` 2.
4. **Q4** The chart shape. **Answer:** `kind: bar | stacked_bar | line | scatter`; `x {label, unit?, type: category | linear | log, values}`; `y {label, unit?, scale: linear | log}`; `series[] {name, values? | points?, source {kind, ref, page?}}`. Source kinds: `table` (`ref` names the printed table, `page` where it sits; the gate checks each value against that table's cells), `text` (`ref` is a verbatim fragment of at most 160 characters containing the values; the gate checks it occurs in the extracted text), `value_labels` (artefact only; `ref` names the figure; produced by the recreation pass), `supplied` (artefact only; `ref` is the data sidecar filename), `legacy` (artefact only; written by migration; never gated). The wire enum is `table | text`, matching the current prompt rule that figure labels do not yet count (`skill.md:198`); stage 19 widens it by editing one array. Cap: 0 or 1 on the wire; artefact per Q12. Tables carry `source {ref, page?}` as a sibling of `caption`, and the bracketed tag leaves the caption text. Structural refinements are listed under `charts[]` in `## Schema v2`; the value gate itself is stage 19's.
5. **Q5** The lead figure as a sidecar asset. **Answer:** the model emits `figure_request {label, why}`; the locator (stage 18) resolves it and code writes `<slug>/figure-<n>.jpg` (n from the label when it has one, else `figure.jpg`) beside the JSON in `output/`, `explainers-new/` and the Obsidian mirror, and stamps `lead_figure {label, caption, alt_text, asset, sha256, width, height, page?, provenance}`. The `provenance` enum is `arxiv-source | pdf-embedded | pdf-vector-crop | dom-asset | vlm-crop | legacy`, best first; today's path writes `vlm-crop` (W6) and stage 18 adds the rest. promo-flow's approve route copies the directory; the renderer resolves `asset` against the artefact's folder.
6. **Q6** Stamped fields, order, and the quality record. **Answer:** the model emits only the keys of `ModelOutputV2`: `hero {title, headline, emphasis, subtitle}`, `top_block`, `sections`, `charts`, `figure_request`, `end_takeaway` and `citation`. It never emits `version`, `metadata.*` (`date_created`, `slug`, `model`, `provider`, `route`, `source`, `contract_revision`, `migrated_from`, `quality`), `hero.publication_date`, `references` or `lead_figure`, and no longer emits `metadata.title` or `eyebrow`, which are derived; the generated `skill.md` block cannot mention them because they are not in the wire schema. Order in `saveResult` (`### Save order` in full): parse; canonicalise, keeping wire nulls (`sanitiseInline`, `toPlain`, drop unknown keys at any depth, and set `citation` to `null` when `citationKnown`, each removal into `quality.dropped`); validate with `modelOutputValidator({citationKnown})` with the nulls intact, so a compliant `citation: null` passes the required-property check; repair loop (`src/repair.ts:38-63` today) against those issues only, which is the whole of what the model can fix, each repaired response re-entering at canonicalise; stamp `version`, `metadata` from state (`src/state.ts:73-77`, `src/batch.ts:237-244`) including the quality record, `hero.publication_date`, `references[0]` with its `origin`, and `lead_figure` from the locator; strip null-valued object properties (today's `src/output.ts:139-153`, moved here from before validation; array elements such as `series[].values` gaps are kept); assert `ExplainerV2.safeParse`, whose failure is a harness bug thrown with the raw output kept as `_error.txt` (`src/output.ts:532-537` today), never a repair trigger; write the file. Author (through `references[0]`), date, provider and route are all stamp-step fields: none is in the wire schema, so none is validated, repaired or stripped. An issue that survives repair is either editorial (kept; listed in `quality.issues`) or structural on an optional item (the item is set to `null` before stamping, stripped with the other nulls, and listed in `quality.dropped`: a chart failing a data check, an `emphasis` that is not a substring, a `figure_request` without a label); a structural failure on a required field (no sections) cannot be saved and takes the `_error.txt` path, as today. `metadata.quality {issues, dropped}` lives in the artefact: `issues` are validator messages that survived repair, `dropped` names items code removed (thin charts, stripped tags, unknown keys, an unused `citation`, an unresolved figure). Nothing records "fields detection overwrote" because nothing is overwritten; `references[0].origin` says where the reference came from.
7. **Q7** Structured references and the detected reference. **Answer:** `references` is exactly one `{authors[{family, given?}], year?, title, venue?, url?, origin}` and is code-owned. Detection (`src/preprocess.ts:397-406`, `:447-449`) stores a structured reference in state (`src/state.ts:77`) instead of HTML, before the request is built. When it is present, the user turn (`src/prompt.ts:22-30`) says the citation is known and asks for `citation: null`; canonicalisation sets whatever the model emits for `citation` to `null` before validation and lists it in `quality.dropped`, so it is never compared, merged or repaired, validation then sees the compliant `null` with the wire nulls intact, and the stamp makes `references[0]` the detected entry with `origin: detected`. When it is absent, the user turn asks for the citation, `modelOutputValidator` requires it non-null, repair can ask for it, and the stamp copies it unchanged into `references[0]` with `origin: model`; `url` must be `http(s)` in either case. No field is both required of the model and replaced by code, so the July finding that some models ignore an injected instruction (the reason detection became a post-stamp, `src/output.ts:493-501`) costs tokens at most, never a wrong artefact. The byline, eyebrow, page title and slug author segment derive from `references[0]` through `contract/derive.ts` in both repos.
8. **Q8** Versioning. **Answer:** `version: z.literal(2)` on `ExplainerV2`; `parseExplainerJson(raw)` dispatches on `raw.version`: `2` parses directly, `1` or absent goes through `migrateV1()` then parses, anything else fails. `metadata.contract_revision` carries the additive revision inside version 2, and `metadata.migrated_from: 1` marks an artefact that came through the reader rather than the producer. The v1 reader is deleted in W10 once both repos report zero v1 files and the native route has been live through one deploy; after that a v1 file is a named failure.
9. **Q9** The `skill.md` schema block. **Answer:** marker-delimited (`<!-- CONTRACT-V2-BEGIN -->` / `<!-- CONTRACT-V2-END -->`), rewritten in place by `contract:build` from the OpenAI dialect plus each field's `.describe()` text, rendered as the annotated skeleton the current block uses (`skill.md:36-64`); `contract:check` (run by `npm test`) fails when the block on disk differs from the render; `src/prompt.ts` strips the markers so the production system prompt is unchanged in form. Prose rules stay hand-written outside the markers.
10. **Q10** `recreated_figure`, the ECharts mapper and the dependency. **Answer:** `recreated_figure` and `echarts_option` leave the contract; `src/figure-data.ts` emits a `Chart` with per-series `source.kind` and writes it to `charts[0]` only when the model emitted no chart (otherwise it is discarded with a `dropped` entry; stage 19 may change the precedence without changing the shape); `buildEChartsOption` becomes `chartToEChartsOption(chart)` used only by the render-and-compare verifier (`src/figure-data.ts:342-401`), so `echarts` stays an explainer-batch dependency and promo-flow never adds it.
11. **Q11** Whether `figure_estimated` recreations (values read off axes, allowed today with a caption notice, `docs/FIGURE-EXTRACTION.md:192`) may enter v2 `charts[]`. The design recommends no: the artefact enum has no estimate kind, matching card 02's stated-values rule, and estimated recreations are dropped with a `quality.dropped` entry. This reverses a phase-1 figure-recreation decision, so it is not taken here. **Deferred (owner: operator):** confirm the drop, or ask for an `estimated` source kind with its caption notice.
12. **Q12** Whether migrated v1 explainers keep their second and third charts (18 live files) by giving `ExplainerV2.charts` `.max(3)` while the wire stays `.max(1)`, or are trimmed to one chart during migration. The design recommends keeping them, since trimming changes live pages the operator curated. **Deferred (owner: operator):** choose keep (artefact cap 3) or trim (cap 1 everywhere).
13. **Q13** What migration does with the 12 live files whose only chart is a legacy `chart` with `config_json: null` and code in `config_raw`, and the 5 banned-type `charts[]` entries (3 doughnut, 2 radar), none of which converts through the Chart.js mapping. The design drops them with a listed `quality.dropped` entry so the operator can re-author a table or pills by hand before the W9 commit. None of the 12 `config_raw` strings contains a function, so a third option exists: parse them as a JavaScript object literal (a JSON5-style reader, one extra dependency in the rewriter only) and convert like any other `bar` or `line` config. **Deferred (owner: operator):** confirm drop-and-list, name the files to re-author first, or ask for the object-literal parse.
14. **Q14** The one live file with an undeclared `diagrams[].mermaid` block (`ai-strategy/2026-04-14_zhang_ai-agile-roadmap_explainer.json`). v2 has no diagram block; migration drops it and lists it. **Deferred (owner: operator):** confirm the drop, or ask for a diagram block in a later revision.
15. **Q15** Whether `metadata.quality` should be stripped from the public sidecar at approve time. **Answer:** no; it holds validator messages and dropped-item names, nothing sensitive, and leaving it in place lets `check:contract` report review state across the archive. The approve route copies the artefact unchanged.
16. **Q16** Whether promo-flow should vendor only the generated JSON Schema and validate with a JSON Schema library instead of adopting zod. **Answer:** adopt zod; the vendored zod source yields the TypeScript type, the validator and the sanitiser from one file, whereas a JSON Schema validator would add a dependency and still need a hand-written type.
17. **Q17** What changed between attempt 1 and attempt 2 of this document, for the cards (17 to 19) that may already cite it. **Answer:** the chart shape and its `source` are unchanged. Field changes: `citation` added to the wire schema and `references[0].origin` to the artefact; `metadata.quality.stamped` removed; `metadata.migrated_from` added; `metadata.route` gains `unknown` and `metadata.provider` reserves it; `metadata.source` and `lead_figure.width`/`height` become optional in the artefact; editorial bounds move to the wire schema; the stored slug rule is relaxed to safe filename characters; `contract/derive.ts` joins the vendored files. Card renumbering, attempt 1 to attempt 2: W2 to W5, W3 to W6, W4 to W6 (the sidecar write) and W7 (reextract), W5 to W8, W6 to W2, W7 to W3, W8 to W9, W9 to W4; W1 and W10 keep their ids.
18. **Q18** Whether a table cell may be empty. **Answer:** yes (2026-10-22): a cell is `PlainText` or `''`, rendered blank, because the paper printed no value and a placeholder would put a mark in the data it never printed; headings and every other `PlainText` keep `min(1)`. `migrateV1` also reads the `headline` and `paragraphs_html` takeaway shapes. `CONTRACT_REVISION` stays 1.

## Wave-2 cards

Dependency order, readers before producers: W1 gates everything; W2, W3, W4
give promo-flow a reader and a renderer before any v2 artefact exists; W5
and W6 switch the prompt and the producer; W7 and W8 finish the figure
paths; W9 rewrites the archives through the W4 baker; W10 deletes the v1
reader. Every card's dependencies appear earlier in the list. Pairs that
may run concurrently once their dependencies land, each checked to claim
disjoint files: W7 with W9, W7 with W10, W8 with W9, W8 with W10.
Everything else is serial, and the overlaps that force it are named: W5 and
W6 both touch `src/prompt.ts` and must land back to back; W6 and W7 both
touch `docs/FIGURE-EXTRACTION.md`; W7 and W8 both touch
`docs/FIGURE-EXTRACTION.md` and `src/types/explainer-json.ts`.

Frozen wave-1 contract tests pin v1 names and must be re-frozen by the
orchestrator (the oracle seat) before the card that invalidates them is
dispatched, since a worker may not edit an assertion block:
`tests/contract/01`, `03`, `04`, `05`, `06`, `09` and `15` pin
`config_json`, `metadata.quality.needs_review`, `date_created`,
`filename_slug`, HTML `references` or `EXPLAINER_JSON_SCHEMA` and are
invalidated by W6; `tests/contract/02` and `14` read the system prompt and
the user instruction (`skill.md` rule sentences, "prefer a table", the
`MIN_CHART_POINTS` block in `src/output.ts`) and survive W5 and W6 only
if those sentences stay outside the markers and that block stays verbatim,
which the two cards require.

### W1. one-zod-source-defines-the-v2-contract

- **Outcome:** `contract/explainer-v2.ts` exists with `ModelOutputV2`, `modelOutputValidator`, `ExplainerV2` and `CONTRACT_REVISION`; `npm run contract:build` writes four dialect files under `contract/generated/` and, with `--website`, copies every `contract/*.ts` to `$WEBSITE_REPO/src/contract/`; `npm run contract:check` prints `contract: generated files up to date` and exits 0; `npm test` includes a unit test that parses the tracked v1 sample converted by hand into a v2 fixture, rejects a `<span>` in a paragraph, rejects a two-chart wire output, rejects a wire output carrying a `metadata` key, requires `citation` only when `citationKnown` is false, accepts a stored artefact with `provider: "unknown"`, `route: "unknown"`, `migrated_from: 1` and six sections, and asserts every object in the OpenAI dialect has `additionalProperties: false` and all properties required.
- **Files:** `contract/explainer-v2.ts` (new), `contract/inline.ts` (new), `contract/derive.ts` (new), `contract/dialects.ts` (new), `contract/generated/explainer-v2.schema.json` (new), `contract/generated/model-output.openai.json` (new), `contract/generated/model-output.claude.json` (new), `contract/generated/model-output.gemini.json` (new), `scripts/contract-build.ts` (new), `tests/unit/contract.test.ts` (new), `tests/unit/fixtures/v2/` (new), `package.json` (zod dependency, `contract:build`, `contract:check` scripts)
- **Depends on:** none

### W2. a-pure-function-migrates-v1-to-v2

- **Outcome:** `contract/migrate-v1.ts` exports `migrateV1(raw, io)` with no file access, returning either an `ExplainerV2` or a typed failure; `npm test` runs it over the tracked v1 sample and over fixtures for each row of the mapping table (a legacy `chart` with `config_json: null` as the only chart, a banned type, a site-absolute `media/` image, a base64 image, `recreated_figure`, multi-entry references, `diagrams`, a file with no `run_mode`, a six-section file, a pills file without `end_takeaway`, a file with no sections) and asserts each result parses as `ExplainerV2` with `migrated_from: 1`, `provider: "unknown"` where unknown, `references[0].origin: "legacy"` and the expected `quality.dropped` and `quality.issues` entries, or is the typed failure; `grep -c migrated_from contract/migrate-v1.ts` prints at least 1.
- **Files:** `contract/migrate-v1.ts` (new), `tests/unit/migrate-v1.test.ts` (new), `tests/unit/fixtures/v1/` (new)
- **Depends on:** W1

### W3. promo-flow-reads-the-shared-contract

- **Outcome:** in promo-flow, `npm run check:contract` prints `49 artefacts parsed (49 via migrateV1, 0 native v2), revision 1` and exits 0; `src/lib/explainer-json.ts` exports `parseExplainerJson()` and re-exports the vendored types; `src/types/explainer-json.ts` and `normalizeSidecarJson` are deleted; cards, dates and pills on the home and folder pages and the title and eyebrow in the admin listings come from the parsed object through `derive.ts`; the approve route parses before publishing and copies `explainers-new/<slug>/` beside the JSON; `grep -rn 'normalizeSidecarJson\|types/explainer-json\|accent_color' src/lib/explainers.ts src/app/admin/layout.tsx src/app/api/admin` prints nothing. The baker, the admin preview and the export route keep reading the raw v1 file until W4.
- **Files:** `promo-flow:src/contract/explainer-v2.ts` (new, generated), `promo-flow:src/contract/inline.ts` (new, generated), `promo-flow:src/contract/derive.ts` (new, generated), `promo-flow:src/contract/migrate-v1.ts` (new, generated), `promo-flow:src/lib/explainer-json.ts`, `promo-flow:src/lib/explainers.ts`, `promo-flow:src/types/explainer-json.ts` (delete), `promo-flow:src/app/admin/layout.tsx`, `promo-flow:src/app/api/admin/files/route.ts`, `promo-flow:src/app/api/admin/approve/[filename]/route.ts`, `promo-flow:scripts/check-explainer-contract.mjs` (new), `promo-flow:scripts/check-explainer-sidecars.mjs` (delete; its paragraph count folds into `check:contract`), `promo-flow:tests/fixtures/explainer-v2.json` (new; a copy of the W1 fixture), `promo-flow:package.json`
- **Depends on:** W2

### W4. promo-flow-renders-v2-natively

- **Outcome:** `/explainers/<slug>` for a `version: 2` file renders from the parsed `ExplainerV2` (hero with derived byline and eyebrow, pills with renderer-assigned accents, inline prose through `sanitiseInline`, tables with derived alignment and source tag, the chart island building its own Chart.js configuration from `Chart`, the figure from `lead_figure.asset`, structured reference block); a file still at v1 on disk keeps serving its baked HTML; the baker, the admin preview, the export route and `export-explainer-html.mts` (which explainer-batch's `html-export` spawns) take an `ExplainerV2` from `parseExplainerJson()`; `npm run test:parity` passes with the W3 fixture served from `explainers-new/`; `grep -rn 'config_raw\|accent_color\|paragraphs_html\|new Function' src scripts` prints nothing outside `src/contract/migrate-v1.ts`. The renderer's design is this card's, not this document's.
- **Files:** `promo-flow:src/components/explainers/ExplainerArticle.tsx`, `promo-flow:src/components/explainers/ExplainerChartCanvas.tsx`, `promo-flow:src/components/explainers/ExplainerInlineHtml.tsx`, `promo-flow:src/lib/explainer-to-html-core.mjs`, `promo-flow:src/lib/explainer-to-html.ts`, `promo-flow:src/lib/explainer-json.ts` (remove the v1 type), `promo-flow:src/lib/explainer-rendering.ts`, `promo-flow:src/lib/search-index.ts`, `promo-flow:src/styles/explainer-article.css`, `promo-flow:src/app/admin/[slug]/page.tsx`, `promo-flow:src/app/api/admin/export/[slug]/route.ts`, `promo-flow:scripts/export-explainer-html.mts`, `promo-flow:scripts/bake-explainer.ts`, `promo-flow:scripts/backfill-pills.mjs` (delete; a one-time v1 pills backfill that writes `accent_color`, unreferenced by `package.json`), `promo-flow:tests/e2e/explainer-routes.ts`, `promo-flow:tests/e2e/explainer-parity.spec.ts`, `promo-flow:tests/e2e/explainer-figures.spec.ts`
- **Depends on:** W3

### W5. the-skill-schema-block-is-generated-from-the-contract

- **Outcome:** `skill.md` carries the generated block between `<!-- CONTRACT-V2-BEGIN -->` and `<!-- CONTRACT-V2-END -->`; `grep -c 'CONTRACT-V2-BEGIN' skill.md` prints 1; `npm run contract:check` reports the block in sync; the prose outside the markers is rewritten for v2 (no `*_html`, no `accent_color`, `emphasis` instead of `<span>`, `figure_request`, `citation`, the neutral chart shape, `source` instead of a caption tag) while the rule sentences `tests/contract/02` and `14` grep for stay in place; `src/prompt.ts` strips the markers so `buildSystemPrompt()` contains neither. Landed immediately before W6, with no production run between them.
- **Files:** `skill.md`, `scripts/contract-build.ts`, `src/prompt.ts`, `tests/unit/contract.test.ts`
- **Depends on:** W1, W4 (landing order only: the prompt must not change until promo-flow can render what the model will then emit)

### W6. the-pipeline-stamps-validates-and-saves-v2

- **Outcome:** `saveResult` writes an `ExplainerV2` with `version: 2`, stamped `metadata`, `references[0]` with `origin`, `lead_figure` with the crop written as the sidecar `output/<slug>/figure-<n>.jpg` (`provenance: "vlm-crop"`, copied beside the staged JSON in `explainers-new/<slug>/` and the Obsidian mirror) and a `quality {issues, dropped}` record; the repair loop validates `modelOutputValidator(ctx)` only, on the wire object with its nulls intact, and null-valued properties are stripped only after stamping (`### Save order`); the user turn states whether the citation is known; providers send the generated dialects (`src/providers.ts:168`, `src/providers.ts:381-383`) instead of `EXPLAINER_JSON_SCHEMA`; `src/schema/explainer-schema.ts` is deleted and `src/output.ts`, `src/quality.ts`, `src/repair.ts` and `src/batch.ts` no longer import `src/types/explainer-json.ts`; `normalizeSchemaDrift`, the legacy `chart` write, the `config_json` parse and the base64 `image` are gone; `recreated_figure` is not written until W8 (recreation is off by default, `src/output.ts:263-270`); the `MIN_CHART_POINTS` block stays verbatim. `npm test` passes; `npx ts-node scripts/smoke-contract.ts tests/unit/fixtures/v2/model-output.json --detected` prints an artefact whose `references[0].origin` is `detected` (and the same with a fixture carrying a malformed non-null `citation` reports zero repair attempts), the same command without `--detected` prints one whose `origin` is `model`, and `grep -c 'data:image' output/<slug>.json` prints 0 after a fixture run.
- **Files:** `src/output.ts`, `src/quality.ts`, `src/repair.ts`, `src/batch.ts`, `src/providers.ts`, `src/preprocess.ts`, `src/state.ts`, `src/prompt.ts`, `src/style-lint.ts`, `src/html-export.ts`, `scripts/smoke-contract.ts` (new), `src/schema/explainer-schema.ts` (delete), `tests/unit/fixtures/metadata-less.json`, `tests/unit/fixtures/ordinal-sequence.json`, `tests/unit/fixtures/stacked-log.json`, `tests/unit/fixtures/stringified-config-json.json`, `tests/unit/fixtures/uniform-values.json`, `tests/unit/fixtures/v2/`, `docs/FIGURE-EXTRACTION.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`; re-frozen by the orchestrator before dispatch, not edited by the worker: `tests/contract/01`, `03`, `04`, `05`, `06`, `09`, `15`
- **Depends on:** W5

### W7. reextract-updates-the-sidecar-figure-in-place

- **Outcome:** `npm run reextract -- output/<slug>.json <pdf> "Figure 3"` rewrites `output/<slug>/figure-3.jpg` and updates `lead_figure.asset`, `sha256`, `width`, `height`, `page` and `provenance` in the JSON; `contextFromExplainer` reads v2 fields; `grep -n 'types/explainer-json' src/figure-vlm.ts scripts/reextract-figure.ts` prints nothing; `docs/FIGURE-EXTRACTION.md` describes the sidecar and no longer documents base64.
- **Files:** `scripts/reextract-figure.ts`, `src/figure-vlm.ts`, `docs/FIGURE-EXTRACTION.md`
- **Depends on:** W6

### W8. figure-recreation-writes-the-v2-chart-shape

- **Outcome:** `npx ts-node scripts/smoke-figure-data.ts` prints a `Chart` whose `series[0].source.kind` is `supplied` and which contains no `echarts_option`; `recreateFigureData` returns a `Chart`; `saveResult` places it at `charts[0]` only when the model emitted none; `buildEChartsOption` is renamed `chartToEChartsOption` and used only by the verifier; estimated recreations are dropped or kept per Q11; `src/types/explainer-json.ts` is deleted and `grep -rn 'types/explainer-json' src scripts tests` prints nothing.
- **Files:** `src/figure-data.ts`, `src/output.ts`, `scripts/smoke-figure-data.ts`, `docs/FIGURE-EXTRACTION.md`, `src/types/explainer-json.ts` (delete), `tests/unit/fixtures/v2/`
- **Depends on:** W7

### W9. the-archives-are-rewritten-to-v2

- **Outcome:** `npx ts-node scripts/migrate-v1-to-v2.ts --check` prints `v1 remaining: N` for `output/` and `output.local/`, where N counts only the files the report lists as unmigratable (the 2 with no sections and 2 with no reference in `output.local/`, until the operator removes them), writing `<name>.v1.json` backups beside each rewritten file; with `--website` it rewrites the 49 live JSON files under `promo-flow/public/explainer-html/`, re-bakes their HTML through the W4 baker, prints the curation report (12 code-only legacy charts, 5 banned-type charts, 1 `diagrams`, 3 files with extra references, 1 six-section file, 4 long subtitles, 12 pills explainers without an `end_takeaway`) and `npm run check:contract` in promo-flow then prints `49 artefacts parsed (0 via migrateV1, 49 native v2)`; the promo-flow change is one commit.
- **Files:** `scripts/migrate-v1-to-v2.ts` (new), `promo-flow:public/explainer-html/**/*.json` (49 files), `promo-flow:public/explainer-html/**/*.html` (49 files), `README.md`
- **Depends on:** W2, W4, W6

### W10. the-v1-reader-is-deleted

- **Outcome:** `migrateV1` is removed from `contract/`, the vendored copy and `scripts/migrate-v1-to-v2.ts` is deleted; `grep -rn 'migrateV1' contract src ../promo-flow/src` prints nothing; promo-flow's `check:contract` fails a planted v1 fixture with `version 1 is no longer read`; `npm test` in both repos passes.
- **Files:** `contract/migrate-v1.ts` (delete), `scripts/migrate-v1-to-v2.ts` (delete), `tests/unit/migrate-v1.test.ts` (delete), `promo-flow:src/contract/migrate-v1.ts` (delete), `promo-flow:src/lib/explainer-json.ts`, `promo-flow:scripts/check-explainer-contract.mjs`, `README.md`
- **Depends on:** W9
