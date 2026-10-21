# Chart value gate: every chart value is checked against the cited page before a chart ships

Stage 19 design document. Written 2026-10-20 against explainer-batch `dev`
at 447c19d (the stage 16 document is on this base) and promo-flow `dev` at
939c0304. The card's line numbers were taken at 0cd17d7; the wave-1 commits
(canonicalise before validate, validation inside `saveResult`, the shared
repair loop) moved several of them, so every citation below is what this
document's author read on 447c19d, and `## Findings addressed` says where a
wave-1 change already altered a defect.

## Summary

A chart reaches a reader only when code has found every one of its numbers
in the text layer of the page it cites, or when the operator supplied the
numbers. The gate is a deterministic function over the stage 16 v2 chart
shape and a map of page texts; it never calls a model and never sends a
chart to LLM repair. Its decisions, each expanded below:

1. **Evidence or nothing.** Each series carries `source {kind, ref, page}`
   (stage 16, Q4 there). The gate runs `pdftotext -f p -l p -layout` on the
   cited page, normalises every numeric token, and requires each value of
   the series to be found in the row or table region the source names
   (`table`), inside the verbatim fragment the source quotes (`text`), or
   on the figure's page with enough significant digits to rule out axis
   ticks (`value_labels`). A self-declared provenance is never trusted.
2. **A reject list in code**, run before the value check because it is
   cheap and because small values (`[1,2,3,4,5]`) would otherwise match
   trivially: pie, doughnut and radar (not expressible in v2; rejected by
   type in the v1 sweep); a line across categorical x values; observed and
   projected values in one series; stacked bars on a log axis; ordinal
   sequences; two-value splits; a chart with no variation; a caption that
   admits the values were read off, traced or approximated.
3. **On rejection the chart is dropped, or becomes a section table when
   its values verified.** Verified numbers are content the paper states;
   an invented series is not. The quality record names the rule, the
   values that failed and the page searched. Nothing about a chart is ever
   put in a repair instruction.
4. **Input kinds decide what is checkable.** A local PDF or a downloaded
   PDF URL is checked page by page. An HTML URL source, a scanned PDF and a
   page whose text layer is empty or mangled cannot be checked, so a
   model-authored chart on such an input is dropped; a table or the figure
   crop is the right failure. Operator-supplied data is allowed on every
   input kind, gets the structural rules, and gets the page check too when
   the data file names a page.
5. **The 6-point rule is retired after the gate is live**, not before. Its
   replacement is "verified values and at least three points in the longest
   series"; thinner verified data becomes pills or a table by the same
   conversion the gate uses on rejection. `MIN_CHART_POINTS` and the
   `skill.md` rule stay until the operator reads the gate's report-only
   output and takes the decision (W9).
6. **One module, three callers.** The pure gate lives in the vendored
   contract directory beside stage 16's sanitiser, so explainer-batch's
   finalise step, promo-flow's import lint and the one-off sweep of the 49
   live explainers run the same rules. Only explainer-batch has PDFs, so
   only it runs the value check; the gate writes one verdict line per
   chart into `metadata.quality` in every mode, and promo-flow re-runs the
   structural rules and requires that line for every non-legacy chart.

Nine wave-2 cards close the design: W1 and W2 (matcher, reject list) run in
parallel and W3 (page text) follows W1, whose page excerpts its tests read;
W4 wires the gate in report-only mode and takes chart issues out of repair;
W5 enforces; W6, W7 and W8 (prompt, promo-flow lint and sweep, recreation
pass) run in parallel after W5; W9 retires the 6-point rule last. A tenth
card, W10, is deferred: it gates the recreations the stage 16 migration
carries over ungated, once the archive rewrite has landed.

## Current state

### The checks that exist today, and where they run

| Check | Where | What it catches | Routes |
|---|---|---|---|
| Prompt rules: values must be stated in the text or a table, never read off a figure, figure labels "do not count yet", no pie, doughnut or radar, never join categories with a line, never stacked bars on a log axis, never split a range, prefer a table, at least 6 points, one chart per URL source | `skill.md:25`, `skill.md:140-142`, `skill.md:157-164`, `skill.md:196-202`, `skill.md:204-214`, checklist `skill.md:266-267` | Nothing by itself: the prompt is advice. The EPIC, Hitzig and Demirer charts in `## Test fixtures` were all produced under rules the model then ignored | all |
| `chartDataIssues`: an ordinal sequence (`src/quality.ts:82-91`: consecutive steps of 1 starting or ending at 0 or 1) and a two-value split summing to about 100 or 1 (`src/quality.ts:93-102`) | called per chart from `validateJsonOutput` at `src/quality.ts:261` | the two rules only; `[2,2,2,2]`, a doughnut summing to 85, a line across categories, a stacked log chart and `[1,2,3,4,5]` with a non-rank start all pass | all, see below |
| `config_json` must be an object | `src/quality.ts:258-260` | a string config that failed to parse | all |
| Chart cap | 4 at `src/quality.ts:249-251`; 3 at `src/output.ts:413` and promo-flow `src/lib/explainer-to-html-core.mjs:102-103` | nothing consistent (D7) | all |
| `MIN_CHART_POINTS` filter: longest series under 6 points is dropped | `src/output.ts:359-366`, applied at `src/output.ts:405-412` inside `normalizeExplainerJson` (`src/output.ts:400-419`) | thin charts, real or invented alike; an 11-point read-off passes | all |
| Recreation-pass provenance gate | `src/figure-data.ts:231-280`, only when `FIGURE_RECREATE=1` or a `recreate:` directive (`src/output.ts:204-207`) | rejects `recoverable: false`, low confidence, missing names and length mismatches; trusts the model's own `exact` claim (`src/figure-data.ts:247-249`) and accepts estimated values up to 12 points (`src/figure-data.ts:267-278`) | opt-in only |
| Render-and-compare verify | `src/figure-data.ts:342-401` | a strict `match: false`; returns `{}` (fails open) when `FIGURE_RECREATE_VERIFY=0` (`:347`), when playwright is absent (`:360-362`), when the reply is not JSON (`:390`) or on any error (`:394-397`) | opt-in only |

### Which routes run the checks, and what the checks do when they fail

Two wave-1 changes on this base altered the picture the card drew from
0cd17d7.

- **The checks now run on the structured-output route.** `saveResult`
  canonicalises before it validates: `normalizeExplainerJson`
  (`src/output.ts:550`) calls `canonicaliseExplainerJson`
  (`src/output.ts:382-398`), which parses a stringified `config_json` back
  to an object (`src/output.ts:111-119`, `src/output.ts:121-128`) before
  `validateJsonOutput` runs at `src/output.ts:568`. The repair loop does the
  same at `src/repair.ts:28-29`, `src/repair.ts:39-40` and
  `src/repair.ts:53-54`. The OpenAI dialect still declares `config_json` as
  a string (`src/schema/explainer-schema.ts:131-141`) and structured output
  is on by default (`src/schema/explainer-schema.ts:196-198`), so the parse
  step is what makes D3 fixed on this base; `tests/contract/03` pins it.
- **`saveResult` now validates, but it does not enforce.** The validation
  result is written to `metadata.quality {issues, needs_review}`
  (`src/output.ts:565-572`) and the file is then written, staged into the
  website directory and mirrored regardless (`src/output.ts:574-592`). A
  chart that fails every check still ships, flagged. D10 is therefore half
  fixed: recorded, not acted on.
- **Chart issues still go to LLM repair.** `buildRepairInstruction` pastes
  every issue verbatim (`src/quality.ts:303-314`, the chart messages at
  `src/quality.ts:87-89` and `src/quality.ts:98-100` ask the model to
  "replace with measured values" or move the data), and `repairUntilValid`
  sends them (`src/repair.ts:43`) with only the JSON as context
  (`src/batch.ts:257-296`). The frozen test
  `tests/contract/03-chart-checks-run-on-structured-output.test.ts:121-122`
  asserts that repair *is* called for an ordinal chart, so taking chart
  issues out of repair (W4) needs that block re-frozen by the orchestrator.

Every route reaches these checks through the same seam: the six
`finalizeResult` call sites in `src/batch.ts` (`:570`, `:634`, `:779`,
`:916`, `:986`, `:1167`) wrap `saveResult` (`src/batch.ts:246-256`), and
both repair wrappers (`src/batch.ts:257-296`) call `repairUntilValid`. The
Claude subscription CLI route carries no schema but runs the same validator
through `maybeRepairClaude` (`src/batch.ts:257-275`, the CLI branch at
`src/batch.ts:269-270`). No route skips the
checks on this base; what every route skips is enforcement.

### What the model is given, per input kind

A local PDF is sent as a base64 document (`src/batch.ts:116`); a PDF URL is
sent as a URL document block (`src/batch.ts:114-115`) and never downloaded,
so `resolveSourcePdf` returns `null` for every URL-sourced result
(`src/output.ts:161-163`); an HTML URL is fetched, stripped to text and
truncated to 200,000 characters (`src/preprocess.ts:10`,
`src/preprocess.ts:487`, `src/preprocess.ts:510`), and that text is what the
model charts from (`src/batch.ts:111-113`). State records the source as
`{kind: 'url' | 'local_pdf'}` (`src/state.ts:54-59`) and the recreation
directive with its optional `dataFile` (`src/state.ts:30-40`,
`src/preprocess.ts:115`, `src/preprocess.ts:136`).

### What reaches promo-flow

promo-flow renders whatever `charts[]` holds: `normalizeCharts` takes the
first three (`src/lib/explainer-to-html-core.mjs:102-103`), evaluates
`config_raw` as code when `config_json` is null
(`src/lib/explainer-to-html-core.mjs:109-119`), and attaches a callout
plugin for pie and doughnut types (`src/lib/explainer-to-html-core.mjs:268-269`),
so the renderer actively supports two banned types. The approve route
parses the staged JSON and bakes it with no chart check
(`src/app/api/admin/approve/[filename]/route.ts:73-74`).

The 49 live files hold 67 chart entries: 36 bar, 14 line, 3 doughnut,
2 radar and 12 legacy entries whose only configuration is code in
`config_raw`. Of the 55 parseable entries, 33 have a longest series under 6
points (the card's figure), so the filter as it stands would drop half the
live charts. Seven captions admit approximation ("traced", "Approximate",
"Reconstructed" twice, "Estimated from", "Subjective ... inferred", and one
more "approximate"); six lines run across category labels (Hitzig, Liu, the 06-10
Demirer, two Mertens, Bravyi), one of them across quarters; three charts
have exactly two points; four mix observed and projected points (two
Litowitz, IBM, Xing); one single-series chart is uniform (`[2,2,2,2]`,
Alenezi); one is the rank sequence `[1,2,3,4,5]` (Liu). No live chart
stacks on a log axis; the one that does is in `output/` (the Demirer
`.sol.json`). Not one entry records where its numbers came from.

## Findings addressed

| Id | Where (as read on 447c19d) | How the design resolves it |
|---|---|---|
| D1 | `skill.md:25`, `skill.md:140-142`, `skill.md:157-164`, `skill.md:196-202`, `skill.md:204-214` | Wave 1 (card 02) already removed "match the axes" and "whatever the paper's genre" and added the stated-values rules the frozen test `tests/contract/02` greps for. What remains to change is in `## Migration and rollback` step 4 and W6: a chart is a recreation of one source figure or table with every value from that artefact, or it is not made (operator decision); every series names its `source {kind, ref, page}` (the caption tag goes, per stage 16); `value_labels` becomes a permitted kind because the gate can now check it (the "does not count yet" sentence at `skill.md:198` is replaced); a URL source gets no chart at all instead of "at most one" (`skill.md:202`); the 6-point sentence (`skill.md:209`) and the checklist line (`skill.md:267`) go only in W9. The prompt stops being the enforcement point: the gate is. |
| D2 | `src/types/explainer-json.ts:130-147`; `src/schema/explainer-schema.ts:133-141` | Resolved by stage 16's chart shape: `series[].source {kind, ref, page}` (stage 16 `## Schema v2`, Q4). This design adds no field to it; the two fields it would like (`basis`, a `time` axis type) are deferred to stage 16 as Q11 and Q12. Lands in stage 16's `one-zod-source-defines-the-v2-contract`. |
| D3 | `src/schema/explainer-schema.ts:131-141`; `src/output.ts:111-119`; `src/quality.ts:58-69`; `src/repair.ts:28`, `src/repair.ts:39`, `src/repair.ts:53`; `src/output.ts:550` | Fixed on this base by wave 1: canonicalisation parses the string before validation on every route (pinned by `tests/contract/03`). The gate keeps the property by construction: it reads the canonical v2 object after stage 16's canonicalise step, in which `series[].values` is a typed array in every dialect, so there is no string to miss. W4. |
| D4 | `src/quality.ts:74-105`, `src/quality.ts:82-91`, `src/quality.ts:93-102` | Replaced by the reject list in `## Reject list`, each rule with detection logic: type (pie, doughnut, radar), line across categories, mixed observed and projected, stacked on log, ordinal (generalised to any constant unit step starting or ending at a rank), two-value split (any two-point single series, not only one summing to 100), no variation, caption admission. The live examples the card lists are each caught by a named rule: the doughnut summing to 85 by type, `[2,2,2,2]` by no-variation, `[1,2,3,4,5]` by ordinal. W2. |
| D5 | `src/quality.ts:87-89`, `src/quality.ts:98-100`, `src/quality.ts:303-314`; `src/repair.ts:43`; `src/batch.ts:257-296`; `tests/contract/03-chart-checks-run-on-structured-output.test.ts:121-122` | Chart issues leave the validator's issue list: `chartDataIssues` is deleted and the gate produces verdicts, not issues. The repair instruction is built from validator issues only, and the gate runs after the last repair attempt, so no chart message can reach a model. Stage 17's finalise table says the same ("Never send chart-value issues to LLM repair") and its W10 pins chart-data digests across repair; this design is the policy that card consumes. The frozen test 03 block that asserts the opposite is re-frozen by the orchestrator before W4 is dispatched. `## On rejection` restates the guarantee. W4. |
| D6 | `src/output.ts:359-366`, `src/output.ts:405-412`; `skill.md:209`, `skill.md:267` | Retired in W9, after the gate is live and the operator has read its report-only output (an operator decision the card records). Replacement rule: verified values and at least three points in the longest series; thinner verified data becomes pills or a table. `## Retiring the 6-point rule`. |
| D7 | `src/quality.ts:249-251`; `src/output.ts:413`; promo-flow `src/lib/explainer-to-html-core.mjs:102-103` | Owned by stage 16 (its D8): one cap in the schema, 1 on the wire, 1 or 3 stored (its Q12). The gate takes no position on the cap; it gates each chart independently and the conversion to a table does not count against the cap. |
| D8 | `src/figure-data.ts:231-280`, `src/figure-data.ts:247-249`, `src/figure-data.ts:267-278`; `src/figure-data.ts:342-401`, `src/figure-data.ts:347`, `src/figure-data.ts:394-397`; `src/figure-data.ts:426-437`, `src/figure-data.ts:430`, `src/figure-data.ts:433`; `src/figure-data.ts:78-99` | `applyProvenanceGate` is deleted. The recreation pass emits the v2 chart shape (stage 16's `figure-recreation-writes-the-v2-chart-shape`) with each series' `source.kind` set from the model's claim, and that claim is then checked by the same gate as a model-authored chart: `table` against the table region, `value_labels` against the figure's page. An `estimated` claim maps to no kind and is dropped (stage 16 Q11 recommends the same; the operator decision there stands). Supplied data is stamped `supplied`, not `exact`, gets the structural rules, and gets the page check when the file names a page. The CSV reader requires an explicit chart type; a file without one is rejected with a named reason instead of defaulting to a line. Render-and-compare stays as an extra veto and may keep failing open, because the value check now stands in front of it. `## Where the gate runs`, Q8, W8. |
| D9 | `src/preprocess.ts:487`, `src/preprocess.ts:510`; `src/batch.ts:111-113`; `src/output.ts:161-163` | An HTML URL source has no text layer the gate can read, so the prompt tells the model it gets no chart (W6) and the gate drops any chart it emits anyway, with "source kind url: no checkable text". A PDF URL is downloaded at preprocess time into the file cache and treated as a local PDF (W3). The Hitzig split range is caught twice over: no checkable source, and the prompt's never-split-a-range rule stays. `## Gate inputs`, Q6. |
| D10 | `src/output.ts:529-600`, `src/output.ts:565-572`, `src/output.ts:574-592` | Validation now runs (wave 1) but the artefact ships flagged. The gate runs inside the same save path (stage 16 `### Save order` step 4, "a structural failure on an optional item is resolved by setting that item to null"), before the stamp, on every route, and in enforce mode removes or converts the chart before the file is written or staged. Report-only mode (W4) records the verdict without acting; enforce (W5) is the default once the fixtures pass. |
| D11 | promo-flow `src/lib/explainer-to-html-core.mjs:102-103`, `src/lib/explainer-to-html-core.mjs:109-119`, `src/lib/explainer-to-html-core.mjs:268-269`; `src/app/api/admin/approve/[filename]/route.ts:73-74` | One verdict contract, written by the producer and read by the consumer. The gate writes exactly one line per input chart into `metadata.quality` in every mode (`## On rejection`): a `kept:` line into `issues` for every chart that stays, a `table:` or `dropped:` line into `dropped` for every chart it removed, and in report-only mode a `report:` line into `issues` for a chart it would have removed. promo-flow's `check:contract` (stage 16 W3) runs the structural reject list through the vendored gate module and fails an artefact that holds a chart with a non-`legacy` series and no `kept:` line for it, or any `report:` line; the approve route runs the same check. Files the migration wrote (`metadata.migrated_from: 1`) are exempt and reported as `migrated, ungated`, because stage 16 converts a `recreated_figure` into a non-`legacy` chart without gating it; the one live case (Flyvbjerg) is gated by the deferred W10, not by the migration (operator decision, Q19). The 49 live explainers are swept once by `scripts/chart-gate-sweep.ts` on the pre-migration v1 JSON, before stage 16's `the-archives-are-rewritten-to-v2` runs, and the report (rule hit per chart, and the value verdict for the papers whose PDF is on hand) is what the operator curates from in that archive commit. The renderer's pie and doughnut support is removed by stage 16's W4, where the island builds its own configuration from a `kind` enum that has neither. W7. |

## Gate inputs

The gate is a pure function:

```ts
gateCharts(output: ModelOutputV2, evidence: ChartEvidence): GateResult

interface ChartEvidence {
  source: { kind: 'pdf' | 'url' | 'none'; ref: string };   // from metadata.source (stage 16); 'none' is the evidence object's own value, see below
  pageText: (page: number) => PageText | null;              // null: no page, no text layer, or mangled
  supplied?: SuppliedData;                                  // the data sidecar, when a `data:` directive exists
}

interface PageText { page: number; lines: string[]; tokens: NumberToken[]; usable: boolean }

interface GateResult {
  charts: Chart[];                                   // what remains in charts[]
  tables: Array<{ sectionIndex: number; table: Table }>;  // conversions to append
  verdicts: ChartVerdict[];                          // one per input chart, for the quality record
}
```

`pageText` is supplied by `src/page-text.ts`, the only part that touches a
file: one `pdftotext -f p -l p -layout <pdf> -` call per distinct page,
cached by `(sha256 of the PDF, page)` for the run. Control characters are
stripped (page 8 of the EPIC PDF carries 386 NUL bytes from the vector
figures' fonts) and the page is marked `usable` only when it has at least
40 alphabetic words of three or more letters and at least 70 percent of
them contain a vowel. The threshold is calibrated on the held PDFs: Demirer
page 35 scores 0.96, EPIC pages 8 and 12 score 0.96 and 0.99 after the
NULs are removed, and a page rendered from a font with no Unicode map
(the `5HTXHVWUDWHUHTV` strings on EPIC page 8 are "Request rate (req/s)"
shifted by 29 code points) scores near zero. An unusable page is reported
as "no text layer", which can only make the value check fail; it can never
produce a false pass.

What the gate reads: the canonical v2 model output after stage 16's
canonicalise step and after the last repair attempt (`### Save order` step
4), `metadata.source` from state, the PDF path resolved from state for a PDF
source, and the data sidecar named by the `recreate:` directive. It writes
`charts[]`, the appended tables, and `metadata.quality` entries. Every
field it reads or writes is one stage 16 defines: `charts[].kind`, `title`,
`caption`, `x {label, unit, type, values}`, `y {label, unit, scale}`,
`series[] {name, values, points, source {kind, ref, page}}`,
`sections[].table {caption, columns, rows, source {ref, page}}`,
`metadata.source {kind, ref}` and `metadata.quality {issues, dropped}`.
The evidence object's `source.kind: 'none'` is not a v2 value: `src/chart-gate.ts`
sets it when `metadata.source` is absent (stage 16 leaves it optional in
the artefact and absent on a migrated file) and promo-flow's lint sets it
always, since it has no PDFs. The two fields the rules would like and v2
lacks, `series[].basis` and `x.type: time`, are deferred to stage 16 (Q11,
Q12) and detected lexically until then.

Per input kind:

| Input kind | `metadata.source.kind` | Evidence available | Model-authored chart | Supplied data |
|---|---|---|---|---|
| Local PDF, born digital | `pdf` | every cited page, plus one page either side on a miss | checked | structural rules, plus the page check when the data file names a page |
| PDF URL (`isPdfUrl`, `src/figure-vlm.ts:22-25`: `.pdf` or `arxiv.org/pdf/`) | `pdf` with `ref` the URL | W3 downloads it at preprocess time into stage 17's file cache keyed by sha256, records the cached path in state beside `source`, and the gate reads it as a local PDF; the gate itself makes no network call | checked | as above |
| arXiv `/abs/` or `/html/` URL | `url` | the fetched HTML text is not persisted and is truncated (`src/preprocess.ts:487`), so there is no checkable evidence; the `/abs/` page is used only for the citation (`src/preprocess.ts:329-330`) | dropped, reason `source kind url: no checkable text layer`; the prompt says to use a table instead (W6) | structural rules only |
| Other HTML URL | `url` | none | dropped, same reason | structural rules only |
| Scanned PDF, or a cited page whose text layer is empty or mangled | `pdf` | `pageText` returns `usable: false` | dropped, reason `page N has no usable text layer`; the figure crop (stage 18) carries the result instead | structural rules only (the page check is skipped and recorded as `unchecked: no text layer`) |

The arXiv LaTeX source that stage 18 names as a figure provenance is not an
input kind of this gate; if a later stage feeds LaTeX tables, they enter as
a `PageText` with `page` set to the table's label, and nothing else changes.

## Value matching

### Tokenising a page

`pdftotext -layout` keeps a table row on one line with its label, which is
the property the matcher relies on. From page 35 of `w35275.pdf`:

```
$ pdftotext -f 35 -l 35 -layout ../explainer-batch/input/_held/w35275.pdf - | sed -n '1,7p'
            Table 5: Attenuation of Productivity Effects Across Production Layers
                                                    Outcomes (Weeks 21-30, %)
                               Lines Chg     Dist Files      Commits   PRs      Dist Repos   Releases
          Autocomplete            228.2        50.8           35.9     11.0       13.6         10.2
                                  (17.6)       (4.5)          (2.9)    (2.7)      (1.7)        (4.1)
          Sync Effect             741.3        187.0          109.1    65.5       25.5         20.3
```

Each line is scanned for numeric tokens with this grammar, in order:

1. Scientific forms first: `a × 10^b`, `a·10^b`, `a x 10^b`, `aE±b`,
   `ae±b`, and `a × 10` followed by superscript digits as pdftotext emits
   them (`10⁻⁵` or `10-5` depending on the font). The value is `a × 10^b`.
2. Plain decimals: an optional sign (`-`, the Unicode minus U+2212, or an
   en dash used as a minus), digits with optional thousands separators,
   an optional decimal part, an optional trailing `%`. A comma is a
   thousands separator only when followed by exactly three digits and
   then a non-digit, so `13,108.7` is one token and `[0.75,1.17]` (the
   confidence intervals on Flyvbjerg page 27) is two.
3. A token is bounded by non-numeric characters; `11.0` does not yield
   `11`, and `2024` inside `2024-06` is not a value token (date-like
   `YYYY-MM` and `YYYY-MM-DD` runs are excluded).

Each token records `value` (a JavaScript number), `decimals` (digits after
the point as printed, so `11.0` has 1 and `187` has 0), `sig` (significant
digits as printed), `percent` (a `%` suffix, or a `%` in the column header
or caption line above), `line` and `column` (character offset, which is
what `-layout` preserves).

### Normalising a chart value

A chart value `v` (a `number` in `series[].values` or `points[].y`) matches
a token `t` when, after normalisation, `|v - t.value| <= 1e-9 × max(1,
|t.value|)`. Normalisation is representation only:

| Difference | Rule | Fixture example |
|---|---|---|
| Trailing zeros | `11` matches `11.0`; `187` matches `187.0` | Demirer `.sol.json` has `11` and `187`; Table 5 prints `11.0` and `187.0`. Match. |
| Thousands separators | `13108.7` matches `13,108.7` | Demirer Table OA-5, page 96 |
| Unicode minus | `-3.1` matches `−3.1` (U+2212) | the Demirer paper prints a Unicode minus on 162 lines, Table OA-5 on page 96 among them |
| Percent versus fraction | when `y.unit` is `%` (or the series name or the column header carries `%`) and the token is a fraction in `[0, 1]`, `v` matches `t.value × 100`; the reverse when the token carries `%` and `v` is in `[0, 1]`. Never both ways at once, and never for a unitless axis | Flyvbjerg alpha values are unitless, so `0.92` must be printed as `0.92`, which it is |
| Scientific notation | `7e-05` matches `7 × 10⁻⁵` and `7E-5` | Bravyi (live) prints `7 × 10^-5` style tokens; `tests/unit/fixtures` gains a synthetic case |
| Rounding | **not a match**: `741` does not match `741.3`, `0.9` does not match `0.92` | a rounded value is not the stated value; the conversion to a table keeps the printed precision because it copies the matched token's text |

Tolerance is therefore zero beyond floating-point noise. The one deliberate
asymmetry is that the chart may carry *fewer* decimals only when the printed
value's dropped digits are zeros.

### The matching unit, per `source.kind`

**`table`**: `ref` names the printed table ("Table 5", "Table D2") and
`page` says where it sits. The gate locates the table on the cited page by
the caption line, `^\s*Table\s+<id>\b` where `<id>` is the number or
letter-number the `ref` carries, and takes the region from that line to the
next caption line (`Table` or `Figure`) or the first run of two blank lines
that follows at least one numeric line, extending upward by the same rule
when the caption sits below the table. Inside the region two layouts are
tried:

- *Row layout*: one line holds the series label and all the series'
  non-null values. The label matches when the line contains any token of
  `series.name` of four or more letters (case-insensitive; `Sync agent`
  matches `Sync Effect` on `sync`, `Async agent` matches `Async Effect`),
  or the whole name when it is shorter than four letters (`IT`).
- *Column layout*: each value sits on a line that contains the matching
  `x.values[i]` label under the same rule, and the value tokens share a
  column band (their character offsets lie within 12 columns of each
  other), which is how Flyvbjerg's one-series, 23-row Table D2 is read.

A series passes at **tier A** when every value is placed by one of the two
layouts. It passes at **tier B** when every value occurs somewhere in the
table region and the series has at least three values each printed with
three or more significant digits. Tier B exists for tables whose labels are
abbreviated beyond recognition (`Lines Chg` for `Lines of code`); it is
denied to short numbers because a region containing `1`, `2`, `5` proves
nothing. A value occurring elsewhere on the page but outside the region is
not a match for `table`. A caption line that cannot be found on the cited
page, or on the page either side, fails the series with `table Table 5 not
found on page N (searched N-1 to N+1)`; the EPIC fixture shows a caption
that is absent from the text layer altogether, so this failure is real.

**`text`**: `ref` is a verbatim fragment of at most 160 characters that
contains the values (stage 16 Q4). The gate normalises whitespace and
undoes line-end hyphenation in both the fragment and the page, requires the
fragment to occur on the cited page (or one either side), requires it to
contain every value of the series as tokens under the rules above, and
requires it to be at least 20 characters with at least three alphabetic
words. That last rule stops `15 15 15` (three axis ticks on EPIC page 12)
from being a fragment.

**`value_labels`** (artefact today; added to the wire by W6): `ref` names
the figure. The gate requires the figure's caption line on the cited page
(`^\s*(Figure|Fig\.)\s+<n>\b`), or accepts the page as given when the
caption is absent but the page is usable, and then requires every value to
occur as a token on that page with at least three significant digits or
at least two decimals. Axis ticks are short (`0`, `0.5`, `2`, `10000` on
EPIC page 8), printed value labels are not (`32.33`, `58.40`, `63.56` on
EPIC page 12 are the bars of Figure 10, and all eight checked tokens are
found there). A series with fewer than three values needs tier-A-style
label placement too: the value's line must contain a token of the series
name or x label.

**`supplied`**: `ref` is the data file name. The values are the operator's
and are not matched against the page for acceptance, but when the data
file carries `page` (per series or at the top level; W8 adds the field to
the sidecar format and to both held files) the gate runs the `table` check
on it and records the result as `supplied, page check: pass | fail`
without changing the verdict. A failed page check on supplied data is
surfaced in the console and the quality record so the operator can fix the
file; it does not drop the chart, because the operator is the authority
the rule names.

**`legacy`** (migration only): never value-checked; the structural rules
still run in the sweep and the verdict says `legacy: unverified`.

### Neighbouring pages

The cited page is tried first; on a miss the page before and after are
tried, in that order, and the verdict records which page matched. One page
each side covers a table that straddles a page break and a printed page
number that differs from the PDF index by one; it does not cover a wrong
citation by five pages, and should not: the paper's own pagination is what
the `page` field means, and `741.3` occurring on pages 34, 35 and 96 of a
97-page paper shows how often a headline number recurs. Whole-document
search is rejected in `## Tradeoffs` 9.

### How false positives are avoided

Five rules, in order of how often they bite: the structural reject list runs
first, so small-integer sequences never reach the matcher; `table` matches
only inside the located table region, never page-wide; tier B needs three
significant digits per value; `value_labels` needs three significant
digits or two decimals, because axis ticks have neither; and `text` needs a
fragment with words in it. Two further rules close the obvious holes: a
year-like token (`1900` to `2099`) and a page-number token (a bare integer
on a line by itself) are excluded from matching unless the chart's
`x.values` are years, and a series whose values all appear in the page's
first and last three lines only (running heads and footers) fails.

## Reject list

The rules run on the canonical v2 chart before the value check, in this
order; the first hit decides and later rules are still evaluated for the
report. Every rule is a pure predicate in `contract/chart-gate/reject.ts`
(W2) with a fixture.

| Rule | Detection | Example it catches |
|---|---|---|
| **pie, doughnut, radar** | v2 `kind` is `bar \| stacked_bar \| line \| scatter`, so these types cannot be expressed natively; on the wire a strict dialect refuses them. In the v1 sweep and in `migrateV1`: `config_json.type` in `{pie, doughnut, polarArea, radar}` | live: Fokou doughnut (`[43,163,73,1]`), Singla doughnut (sums to 100), Xing doughnut (`[15,25,40,5]`, the one summing to 85), Arunkumar and Leite radars; synthetic: a doughnut fixture |
| **line across categories** | `kind: line` and (`x.type: category`, or any `x.values[i]` is a string that is not a number and not a date form `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `Qn YYYY`, `Mon YYYY`) | live: Hitzig (`Novice, Intermediate, Expert`), Liu (`<50, ~250, ~500, 750+`), the 06-10 Demirer line across production layers, Mertens Figure 4 (`1 min, 5 min, ...` as strings; as numbers with `unit: minutes` on a log axis it would pass), Bravyi code names. Mertens Figure 6 over quarters passes as a time axis; see Q12 |
| **observed and projected in one series** | label level: some but not all of the `x.values[i]` labels and `series.name` values match `/\b(proj(?:\.|ected|ection)?|forecast|predicted|extrapolat\w*|target|scenario)\b/i`; or caption level: the caption matches `/\b(projection|projected|forecast|roadmap|scenario)s?\b/i` and the chart has more than one x value with a year in at least one label. A chart whose labels are *all* projected is not mixed and falls to the value check (a simulated curve is never printed, so it fails there) | live, four charts: Litowitz `2024 Observed, 2024 Capacity, 2028 Capacity (proj.)` and Litowitz `2024, 2028 (proj.)` (both levels), IBM (caption "roadmap", labels `Heron (2024)` to `Starling (2029)`), Xing Figure 3 (caption "Two diverging projections", years 2023 to 2029, and a `null` hand-off gap between the historical and projected series); synthetic: `Observed` and `Projected` points in one series |
| **stacked on a log scale** | v2: `kind: stacked_bar` and `y.scale: log`, nothing else, because stacking in v2 is carried by `kind` alone (the series shape is `{name, values?, points?, source}` and has no per-series stack field); v1, in the sweep and in `migrateV1`: `options.scales.<y>.type === 'logarithmic'` with `stacked: true` on a scale or `stack` on a dataset. Stage 16 lists this pair as a zod refinement; Q13 asks for it to live here instead, so that it is a verdict and never a repair candidate | `output/2026-07-31_demirer_writing-code-shipping-code_explainer.sol.json`: three stacked datasets on a logarithmic y axis |
| **ordinal sequence** | a series of three or more values, all integers, with a constant step of exactly 1, whose first or last value is 0 or 1 (today's `src/quality.ts:82-91` rule, kept verbatim), plus: all integers with any constant step whose first value is 0 or 1 and whose `x.values` are category labels | live: Liu `[1,2,3,4,5]`; synthetic: `[1,2,3,4,5]`, `[0,1,2,3]` |
| **two-value split** | a single-series chart with exactly two points and a category x axis (today's `src/quality.ts:93-102` sum-to-100 rule is a special case; the split need not sum to anything to be a pill pair) | live: Litowitz `[1.6, 7.2]` (also mixed projected), IBM `[2880, 288]`, Chen `[83, 100]`; synthetic: `[1.6, 98.4]` |
| **no variation** | every series in the chart has three or more values and each series is uniform (all values equal). A uniform series beside a varying one is allowed: Lin's `71.9` baseline and Fokou's row of `100` are real printed rows | live: Alenezi `[2,2,2,2]`; synthetic: `[2,2,2,2]` |
| **caption admission** | the caption or any series name matches `/\b(approximate(?:ly)?|read[- ]?offs?|traced|illustrative|reconstructed|inferred|eyeballed|digiti[sz]ed|subjective|estimated from)\b/i`. `estimates` alone is not in the list, so Demirer's "Event-study estimates" caption is not a hit, and neither is "estimates (weeks 21 to 30)" | live, seven charts: EPIC ("Values traced from the published figure"; the `output/` copy says "approximate read-offs from the published curves"), Leite radar ("Subjective intensity ratings ... inferred"), Arunkumar ("Approximate relative token complexity"), Prucs ("approximate"), Nation ("Estimated from ... Sec. I.B"), IBM and Hitzig ("Reconstructed from") |

Two things the card asks about that are **not** reject rules: constant first
differences (Chen's `[3500, 3200, 2900, 2600, 2300, 2000, 1700, 1400]` is
a straight line and almost certainly invented, but `[10, 20, 30, 40]` can
be a designed input variable), and a series with `null` gaps where another
series begins. Both are recorded in the verdict as flags (`linear-series`,
`hand-off-gap`) for the report and the sweep, and both are decided by the
value check: a straight line that is printed in a table passes, one that
is not fails.

Not a rule either: a share-of-whole with three or more parts summing to
100. `skill.md:206` sends it to pills, and the prompt keeps saying so, but a
verified four-part composition drawn as bars is content, not invention, so
the gate lets the value check decide.

Rules that need a field v2 does not have are implemented lexically above
and recorded as deferred questions: `basis: observed | projected |
simulated` per series (Q11) and `x.type: time` (Q12).

## On rejection

The verdict for a chart is one of `kept`, `table`, `dropped`:

- **`kept`**: no reject rule hit and every series verified at tier A or B
  (or is `supplied`). The chart stays in `charts[]` unchanged; the gate
  never edits a kept chart's values.
- **`table`**: a reject rule hit (any rule except pie, doughnut, radar in
  v2, where there is nothing to convert from; in the v1 sweep a verified
  doughnut converts too), and every series verified, or is `supplied`. The
  chart is removed and a `Table` is appended to the first section (in
  order, starting with the section the chart would have followed, which is
  the first) that has no `table`; if every section has one, the chart is
  dropped with the reason `no section free for a table`. The table keeps
  the orientation of the source table its series cite, so the reader sees
  the table as the paper prints it (operator decision, 2026-10-21). One
  orientation test, on the page text the value check has already
  tokenised, and one fallback:
  - *Orientation test*: when every series is `table` kind and verified at
    tier A by the **row layout** (the series label and all its values on
    one line of the located region), the paper prints series as rows, so
    the table has one row per series: `columns: [ref, ...x.values]` (the
    first column is headed by the source `ref`, such as `Table 5`, because
    the printed table has no header over its row-label column) and each
    row is `[series.name, ...series.values]`. When every series verified at
    tier A by the **column layout** (each value on the line of its
    `x.values[i]` label), the paper prints x values as rows, so the table
    has one row per x value: `columns: [x.label, ...series names]`.
  - *Fallback*: in every other case (a source kind other than `table`,
    tier B, series that verified by different layouts, or a `supplied`
    series with no page check) the table is `columns: [x.label, ...series
    names]`, one row per `x.values[i]`.
  Cells are the matched tokens' printed text (so `187.0` stays `187.0`, a
  `null` becomes an empty cell), `caption` is the chart's caption, and
  `source {ref, page}` is copied from the series sources; when the series
  cite different refs, `ref` joins the distinct values with `; ` and `page`
  is the first. A label suffix such as `(proj.)` survives in whichever
  cell its label becomes, so the observed-versus-projected distinction is
  still visible in the table. No other conversion rule exists.
- **`dropped`**: any series failed the value check, or the source kind has
  no checkable text, or the chart is a banned type with nothing verified.
  The chart is removed and nothing replaces it. The prose and pills the
  model wrote around it stand.

A chart thinner than three points in its longest series, once verified and
once the 6-point filter is retired (W9), takes the same path as `table`,
except that a single-series chart with exactly two points becomes nothing
(the two-value rule), on the grounds that two numbers already live in the
pills or prose and a two-row table is noise.

**What the quality record holds.** Stage 16's `metadata.quality` is
`{issues: string[], dropped: string[]}`: `dropped` names items code
removed, `issues` holds the messages that survived repair and are shown in
admin review. The gate writes **exactly one line per input chart, in every
mode**, in a fixed grammar the sweep and the lint parse. A line names the
chart by its `title` (a `PlainText` the chart always has, and stable
across the removal of a neighbour, unlike an index):

| Verdict | Mode | Written to | Line |
|---|---|---|---|
| `kept` | report-only and enforce | `issues` | `chart "<title>" kept: 3 series verified at tier A on page 35 (Table 5)` |
| `table` | enforce | `dropped` | `chart "<title>" table: rule stacked-on-log; all 3 series verified at tier A on page 35 (Table 5); appended to sections[0].table` |
| `dropped` | enforce | `dropped` | `chart "<title>" dropped: value check failed on page 8 (source table "Figure 9"): 10 of 10 values of "Fully Recompute (FR)" not found (0.3, 0.7, 1.2, ...); rule caption-admission` |
| `table` or `dropped` | report-only | `issues` | `chart "<title>" report: would be dropped; ...` (the same body as the enforce line), because nothing was removed |

A `supplied` series whose page check failed adds its own `issues` line
(`chart "<title>" supplied page check failed: ...`) beside the `kept:` line.
A `kept:` line is information, not a defect; it carries the `chart "` prefix
so promo-flow's admin review can show it as such, and the lint treats it as
the proof it needs. The grammar is the contract between the producer and
the consumer: an artefact with a chart and no `kept:` line for it was saved
before W4 or by a producer that bypassed `saveResult`, and the lint
(`## Where the gate runs`) refuses it, with one exception: a file stage
16's migration wrote (`metadata.migrated_from: 1`) was never gated, so its
charts are reported as `migrated, ungated` and not refused until the
deferred clean-up W10 records their verdicts (Q19). A structured `quality.charts[]`
record (chart title, rule hits, per-series tier, page, unmatched values,
flags) would be the better home and is raised as Q14, deferred to stage 16
as an additive optional field within version 2; when it lands, the gate
writes the record and the lines in the same save, and the lint reads the
record first.

**No chart issue is ever sent to LLM repair.** The gate runs after the last
repair attempt (stage 16 `### Save order` step 4), reads the canonical
object, and returns verdicts, not validator issues; `buildRepairInstruction`
receives validator issues only, and the validator no longer contains a chart
data rule (`chartDataIssues` is deleted in W4). Stage 17's finalise seam
carries the same rule in its issue-class table and digests chart data across
any prose repair, so a repair that changed a number would be rejected there
as well. Report-only mode writes verdicts and leaves the chart in place; it
does not re-open repair either.

## Retiring the 6-point rule

What `MIN_CHART_POINTS` (`src/output.ts:359-366`, `src/output.ts:405-412`)
and the prompt rule (`skill.md:209`, `skill.md:267`) were for was keeping
invented thin charts out; what they do is drop real three-bar data (33 of
the 55 parseable live charts are under 6 points, among them Li's six-bar
acceptance rates, Okpala's five metrics and the Demirer production-layer
bars, which have six categories and would survive, while the eleven-point
EPIC read-off sails through). The gate replaces the proxy with the thing
it was a proxy for.

**Replacement rule.** A chart is allowed when every value verified and the
longest series has at least three points. Verified data with two points in
a multi-series chart becomes a table; a single-series two-point chart
becomes nothing (its two numbers are a pill pair; `skill.md:206-208`
already say so). One point is a pill. The `skill.md` rule 4 sentence is
replaced by: "A chart needs at least three stated points in its longest
series; two stated numbers are a pill pair or a table row."

**Order of retirement**, each step an operator decision:

1. W4 lands the gate in report-only mode with the filter untouched
   (`tests/contract/02-charts-come-only-from-stated-values.test.ts:100-102`
   pins the block verbatim; stage 16's W6 and stage 17's W13 also say it
   stays). The report lists, per run, the charts the filter dropped that
   the gate would have kept, and the charts the filter kept that the gate
   drops.
2. W5 switches the gate to enforce. The filter still runs first, so
   nothing thinner than six points reaches the gate yet.
3. The operator reads the reports from at least one batch run and one
   subscription run on real papers (the held fixtures are enough to start)
   and decides.
4. W9 removes the block, the `MIN_CHART_POINTS` environment variable from
   `README.md`, the rule 4 sentence and the checklist phrase from
   `skill.md`, and the orchestrator re-freezes the three assertions in
   `tests/contract/02` that pin the block. The replacement rule's threshold
   (three points) is a constant in the gate, not an environment variable.

**What thin verified data becomes.** Exactly what a rejected verified
chart becomes in `## On rejection`: a section table with the printed
values and a `source`, or, for a single-series two-point chart, nothing
beyond the pills and prose that already carry the numbers. The conversion
is the gate's, so retiring the filter adds no new code path.

## Where the gate runs

**In explainer-batch.** Inside `saveResult` on this base, at the point
stage 16 calls step 4 of `### Save order`: after parse, canonicalise,
validate and the last repair attempt, before stamp. Concretely, between
today's `normalizeExplainerJson` (`src/output.ts:550`) and the stamp block
(`src/output.ts:552-554`), so that every route (`src/batch.ts:570`, `:634`,
`:779`, `:916`, `:986`, `:1167`) passes through it, and `attachFigureImage`
(`src/output.ts:559`) runs after it, since the recreation pass's chart
(W8) also goes through the gate before it is placed. When stage 17's W10
lands `src/finalize.ts`, the same call moves into its step 6 ("Run stage
19's chart evidence interface") unchanged: the gate takes the canonical
object and an evidence object, and the seam supplies both. Until stage
16's W6 switches the producer to v2, the gate is reached only through the
sweep CLI (below), which feeds v1 files through `migrateV1` with the
caption tag parsed into `source`; W4 therefore depends on stage 16's W2
for the adapter and on W6 for the live path.

**Module layout** (Q7): the pure gate is vendored with the contract, the
I/O stays in explainer-batch.

| Path | Contents | Vendored to promo-flow |
|---|---|---|
| `contract/chart-gate/numbers.ts` | token grammar, normalisation, equality | yes |
| `contract/chart-gate/match.ts` | table region, row and column layouts, tiers, `text` and `value_labels` matching over a `PageText` | yes |
| `contract/chart-gate/reject.ts` | the reject list and flags | yes |
| `contract/chart-gate/index.ts` | `gateCharts()`, verdict grammar, table conversion | yes |
| `src/page-text.ts` | `pdftotext` per page, sha-keyed cache, control-character strip, `usable` heuristic | no |
| `src/chart-gate.ts` | builds `ChartEvidence` from state (source, PDF path, data sidecar) and applies `GateResult` to the artefact and quality record | no |
| `scripts/chart-gate-sweep.ts` | the CLI: a directory of JSON (v1 or v2) plus an optional PDF directory, writes a report; v1 files go through `migrateV1` in memory, and `--cite <file>` assigns a v2 `source {kind, ref, page}` per `<basename>#<chart index>` to v1 charts whose caption carries no source tag (the held fixtures need this: the EPIC and `.sol.json` captions cite no page); `--apply` performs drop-or-table in place, writing v2 | no |

`contract:build --website` already copies every `contract/*.ts` by glob
(stage 16 `### Build and check`), so a subdirectory is the one thing W1
must confirm the glob includes.

**In promo-flow.** `check:contract` (stage 16 W3) and the approve route
call `gateCharts()` with an evidence object whose `pageText` always returns
`null` and whose source kind is `none`: the structural rules run in full and
the value check cannot pass, so the lint checks the two things it can. For
every stored chart with at least one non-`legacy` series it requires a
`chart "<title>" kept:` line in `metadata.quality.issues` (the line the gate
writes in every mode, `## On rejection`), failing with `chart "<title>" has
no gate verdict; re-run explainer-batch` when it is absent and with `chart
"<title>" was saved under report-only and would be dropped` when a
`report:` line is present; and it re-runs the structural reject list, failing
on a hit for a non-`legacy` chart and reporting a hit for a `legacy` one
(those are the migration's curation list, not the lint's). Two classes of
chart are exempt from the `kept:` requirement, and the lint names each in
its report rather than failing: a chart whose every series is `legacy`
(nothing was ever claimed for it), and any chart in a file whose
`metadata.migrated_from` is `1` (stage 16 writes that literal only from
`migrateV1()`), reported as `migrated, ungated`. The second class exists
because stage 16 converts a v1 `recreated_figure` into a chart whose
series are `table`, `text` or `supplied`, never `legacy`, and the
migration does not run the gate (operator decision, 2026-10-21: migrated
recreations are left for the deferred clean-up W10, Q19). Structural hits
in a migrated file are reported, not failed, under the same rule. That is
why the 49 live files pass for a true reason: 48 hold only `legacy`
series, and the Flyvbjerg file's one migrated recreation is reported, not
required to carry a verdict. This is the import lint; it never needs a PDF
and never needs the structured record of Q14.

**The one-off sweep of the 49 live explainers.** `chart-gate-sweep.ts
--website <dir>` runs on the live JSON **as it stands before stage 16's
`the-archives-are-rewritten-to-v2`**, because the sweep's report is an
input to that rewrite's curation and because the rewrite drops the 12
code-only and 5 banned-type charts the sweep must count. The operator
queues W7 before that stage 16 card; if the rewrite has already landed,
`<dir>` is a checkout of promo-flow at 939c0304 (the commit this document
counted) and the counts are unchanged. For each file the sweep first lists
the raw v1 entries (`charts[]` and the legacy `chart`, with their
`config_json.type` and whether only `config_raw` holds code), so that the
12 code-only and 5 banned-type entries are rows even though `migrateV1`
drops them, then feeds the file through `migrateV1` and runs the reject
list over the 55 parseable charts and the value check for the papers whose
PDF is present in the directory the operator points it at (EPIC and Demirer
among the held set; most live papers have no PDF on hand and are reported
`legacy: unverified`). The one live `recreated_figure` (the Flyvbjerg
file's Table D2 bars) is a row too, marked `migrated, ungated`; it is left
for W10 and not gated by the sweep or the migration (operator decision,
2026-10-21). It writes `output/chart-gate-sweep.md`: one row per
chart with the rule hits, flags, verdict and the proposed action. The
operator acts on it inside stage 16's archive-rewrite commit (the same
commit that re-bakes the HTML), which is a manual, curated step; the sweep
never writes to promo-flow by itself. Publishing to the public mirror is
not a card step.

**`figure-data.ts`'s recreation pass** (Q8): kept as the producer of
`value_labels`, `table` and `supplied` series. `applyProvenanceGate`
(`src/figure-data.ts:231-280`) is deleted; the extraction reply's
per-series `provenance` and `source` map to v2 `source.kind` (`exact` with
a table citation to `table`, `exact` citing labels on the figure to
`value_labels`, `estimated` to nothing: the series is dropped before the
gate), and the resulting chart is gated like any other. `buildEChartsOption`
(renamed `chartToEChartsOption` by stage 16's W8)
stays only as the render-and-compare mapper (stage 16 Q10) and the verifier
keeps its fail-open behaviour, which is now harmless because the value
check is in front of it. `FIGURE_RECREATE` and the `recreate:` directive
keep their meaning; `data:` is the `supplied` path.

## Test fixtures

Every verdict below was worked out with `pdftotext` on the held PDFs on
2026-10-20; the commands are the ones W1's tests reproduce. Page numbers
are PDF indices as `pdftotext -f N -l N` counts them.

### Demirer, supplied data: pass

`input/_held/w35275.pdf` (97 pages) with `input/_held/w35275.figure1.json`:
three series (`Autocomplete`, `Sync agent`, `Async agent`) over six
production layers, `chart_type: bar`, sources `Table 5, <row> row`.

```
$ pdftotext -f 35 -l 35 -layout ../explainer-batch/input/_held/w35275.pdf - | grep -nE 'Table 5|Autocomplete|Sync Effect|Async Effect'
1:            Table 5: Attenuation of Productivity Effects Across Production Layers
5:          Autocomplete            228.2        50.8           35.9     11.0       13.6         10.2
7:          Sync Effect             741.3        187.0          109.1    65.5       25.5         20.3
15:         Async Effect            658.3        52.4           33.6      71.8      13.8          [em dash glyph]
```

Expected: `supplied`, structural rules pass (a bar chart across categorical
layers is what bars are for; the line-across-categories rule applies to
`line` only), and with `page: 35` added to the file (W8) the page check
passes at tier A for all three series: row layout, label tokens `sync`
and `async` match `Sync Effect` and `Async Effect`, all 17 non-null values
found on their rows, `11.0` matching `11.0` and the `null` for the async
release effect matching the dash cell. `741.3` also occurs on pages 34 and
96, which the region rule ignores. Verdict: `kept`.

### Flyvbjerg, supplied data: pass

`input/_held/flyvbjerg-it-cost-risk.pdf` (30 pages) with
`input/_held/flyvbjerg-it-cost-risk.figure3.json`: one series of 23 alpha
values over project types, source `Table D2`.

```
$ pdftotext -f 27 -l 27 -layout ../explainer-batch/input/_held/flyvbjerg-it-cost-risk.pdf - | grep -nE 'Table D2|^IT |Solar power|Olympics'
4:Table D2. Bootstrapped Median Alpha Values with 95% Confidence
8:IT                          0.92       12.53        [0.75,1.17]
11:Olympics                    1.237       1.016       [0.97,1.7]
33:Solar power                 7.836       1.02        [5.44,12.59]
```

All 23 values are found on page 27 (checked one by one). Expected: column
layout at tier A, each value on the line carrying its x label (`IT` matched
whole, being under four letters), the alpha column band distinct from the
cutoff and CI columns. The second block on the same page (`IT 0.91`, a
different fit) is not confused with `0.92` because equality is exact.
Verdict: `kept`.

### EPIC Figure 9 read-offs: fail

`output/2026-05-28_hu_epic-legolink-position-independent-caching_explainer.json`,
chart 0, against `input/_held/2410.15332v3.pdf` (12 pages): a line chart
of TTFT against context length, three series of up to ten points
(`[0.3, 0.7, 1.2, 1.8, 2.6, 3.4, 4.3, 5.1, 5.7, 6.2]` and so on), caption
"Values are approximate read-offs from the published curves".

The card assigns page 12. Two facts about the text layer, so the fixture is
honest: `pdftotext -f 8 -l 8 -layout` is the per-page call that contains
the caption `Figure 9. TTFT vs. context length of FR, CacheBlend-15, and`
(two hits, inside a page whose vector figures also emit 386 NUL bytes and
glyph-shifted axis labels), while a form-feed count over the whole
document puts the same caption at page 12, and page 12 by the per-page call
holds Figure 10 and its table. The gate always uses the per-page call, so
the fixture cites page 8 and the test also asserts the verdict on page 12.

```
$ pdftotext -f 8 -l 8 -layout ../explainer-batch/input/_held/2410.15332v3.pdf - | tr -d '\000' | grep -oE '[0-9]+(\.[0-9]+)?' | sort -un | tr '\n' ' '
0 0.5 1 2 3 3.1 4 5 5.5 5.6 6 7 8 9 15 16 30 77 512 2023 2024 10000 20000 30000 40000 50000
```

Of the 25 distinct read-off values, 23 are absent from page 8 and all 25
are absent from page 12; the two that occur on page 8 (`0.5` and `2`) are
axis ticks, which is why `value_labels` demands three significant digits.
Expected: the caption-admission rule hits first; the value check then fails
with `23 of 25 values not found`. Verdict: `dropped`.

The same file's chart 1 (Figure 10's bars, values such as `32.33`, `58.4`,
`20.05`) is a second fixture: all eight sampled values are found on page 12
with four significant digits. As `value_labels` with `page: 12` it is
`kept`; it is the positive case for that kind, and the case the current
prompt forbids with "does not count yet".

### Hitzig, a URL source: dropped

`output/2026-06-17_hitzig_agentic-coding-expertise_explainer.json`: a line
over `Novice, Intermediate, Expert` with `[77, 91, 92]` and `[15, 28, 33]`,
caption "Reconstructed from ..." going on to call the paper's reported 28
to 33 percent range "the verified range", source an HTML URL (`anthropic.com/research/...`). Three independent
reasons: `metadata.source.kind: url` has no checkable text; line across
categories; caption admission. Verdict: `dropped`, reason recorded as the
source kind, with the rule hits listed. The split range is also what
`skill.md:200` forbids.

### Demirer `.sol.json`, stacked on log: table

`output/2026-07-31_demirer_writing-code-shipping-code_explainer.sol.json`,
chart 0: three datasets stacked (`stacked: true` on both scales) on a
logarithmic y axis, values `[228.2, 50.8, 35.9, 11, 13.6, 10.2]`,
`[741.3, 187, 109.1, 65.5, 25.5, 20.3]`, `[658.3, 52.4, 33.6, 71.8, 13.8,
null]`, caption citing "Figure 1 and Table 5" with no page. Expected: rule
stacked-on-log hits; with `source {kind: table, ref: "Table 5", page: 35}`
assigned by the sweep's `--cite` file (the caption has no tag for
`migrateV1` to parse) the value check passes at tier A for all three series
(`11` matching `11.0`, `187` matching `187.0`). Verdict: `table`, appended
to the first section as a 3-row, 7-column table with `source {ref: "Table
5", page: 35}`. The counts follow from the orientation test in `## On
rejection`: all three series verified by the row layout (`Autocomplete`,
`Sync Effect` and `Async Effect` each sit on one line with their six
values, as the `pdftotext -f 35 -l 35 -layout` excerpt above shows), so
Table 5 prints tools as rows and outcomes as columns, and the converted
table does the same: `columns: ["Table 5", "Lines changed", "Files
touched", "Commits", "Pull requests", "Repositories", "Releases"]` (the
chart's six x values) and one row per series, the async row ending in an
empty cell for the `null`. The fallback orientation (6 rows by 4 columns)
would have turned the paper's table on its side. The same file carries a `recreated_figure` from the
supplied data, which `migrateV1` (stage 16) converts to a chart whose
series are `supplied`; with the model's chart converted, the supplied one
is the file's only chart, at `charts[0]`.

### Synthetic reject-list cases

Committed as small v2 fixtures under `tests/unit/fixtures/chart-gate/`,
each with the expected verdict and rule:

| Fixture | Content | Rule | Verdict |
|---|---|---|---|
| `doughnut.json` (v1 form, for the sweep) | `type: doughnut`, `[15, 25, 40, 5]` | pie, doughnut, radar | dropped (v1 sweep); unrepresentable in v2 |
| `uniform.json` | one series `[2, 2, 2, 2]` | no variation | dropped (values `2` would verify anywhere, which is the point of running the rule first) |
| `ordinal.json` | `[1, 2, 3, 4, 5]` | ordinal | dropped |
| `line-categories.json` | `kind: line`, `x.values: ["Novice", "Intermediate", "Expert"]`, values verified from a synthetic page text | line across categories | table |
| `mixed-projected.json` | one series over `["2024", "2028 (proj.)"]` | observed and projected; two-value | dropped (single series, two points) |
| `mixed-projected-table.json` | two series over four years, two labelled `(proj.)`, values verified | observed and projected | table |
| `stacked-log.json` | `kind: stacked_bar`, `y.scale: log`, values verified | stacked on log | table |
| `two-value.json` | `[1.6, 98.4]` | two-value split | dropped |
| `text-fragment.json` | `source {kind: text, ref: "rose from 12.5% to 30.1% of commits"}` over a synthetic page | none | kept |

## Migration and rollback

1. **W1 to W3 land the matcher, the reject list and the page-text
   extractor** with their fixtures (W3 after W1, whose excerpts it reads).
   Nothing calls them from the pipeline.
   Rollback: revert the commits; no artefact changes.
2. **W4 wires the gate into `saveResult` in report-only mode** (`CHART_GATE=report`,
   the default until W5), takes chart issues out of the validator and the
   repair instruction, and re-freezes `tests/contract/03`. Every saved
   artefact gains verdict lines in `metadata.quality`; charts are not yet
   touched; the 6-point filter is unchanged. Rollback: revert the commit,
   or set `CHART_GATE=off` to skip the call; the filter and the old
   validator messages return with the revert.
3. **W5 switches the default to enforce** (`CHART_GATE=enforce`): drop or
   table per `## On rejection`. The filter still runs first. Rollback:
   `CHART_GATE=report` restores the previous behaviour without a code
   change; revert the commit to remove the mode.
4. **W6 changes the prompt** (`skill.md` prose outside stage 16's
   generated block): per-series `source`, `value_labels` allowed, no chart
   for a URL source, the "does not count yet" sentence replaced, and one
   or two sentences on what a chart is (operator decision, 2026-10-21): a
   chart is a recreation of one source figure or table, every value taken
   from that one artefact, or it is not made; the model must not assemble
   a chart from values scattered through the text, and thin data stays
   pills or prose by the existing route (`skill.md:206-208`). This is
   prompt guidance only, it adds no gate rule, and the gate stays the
   enforcement point. Stage 16's W5 generates the schema block, so this
   card is the prose only.
   Landed after W5 so the model's new `value_labels` claims are checked
   from the first run. The orchestrator re-freezes the `tests/contract/02`
   assertions that grep for "at most one chart" tied to URL sources.
   Rollback: revert the commit; the gate drops what the old prompt
   produces, so the pipeline stays safe either way.
5. **W7 lands the promo-flow import lint and runs the live sweep.** The
   lint ships through stage 16's W3 vendoring path and passes over the
   live archive whether it is still v1 (every series `legacy`) or already
   rewritten (the Flyvbjerg recreation reported `migrated, ungated`); the
   sweep runs on the pre-rewrite live JSON (or a checkout
   of it at 939c0304), writes `output/chart-gate-sweep.md`, and the
   operator folds its actions into stage 16's archive-rewrite commit,
   which is why W7 is queued before that card. Rollback: revert the
   promo-flow lint commit; the sweep report is a file and the archive
   commit has stage 16's own rollback (one `git revert`).
6. **W8 routes the recreation pass through the gate.** `applyProvenanceGate`
   goes; the supplied-data format gains `page`; the CSV reader requires a
   chart type. Rollback: revert the commit; recreation is opt-in, so no
   default run changes.
7. **W9 retires `MIN_CHART_POINTS` and the prompt rule**, after the
   operator's decision in `## Retiring the 6-point rule` step 3.
   Rollback: revert the commit; the block and the sentence return, and the
   orchestrator restores the earlier `tests/contract/02` digest.

Rollback: every step is a single revert or an environment variable, no
step rewrites an artefact that an earlier step wrote, and the publish branch
replay that carries any of this to the public mirror remains a manual,
curated operator action outside every card.

## Tradeoffs

1. **Exact equality after representation-only normalisation** over a
   tolerance for rounding. A rounded value is not the stated value, and a
   tolerance wide enough to accept `0.9` for `0.92` also accepts an axis
   read-off that happens to land near a printed number. The cost is that a
   model which rounds loses its chart; the table conversion then shows the
   printed precision. Rejected: a relative tolerance (1 percent, or one
   unit in the last printed place), and accepting fewer decimals than
   printed.
2. **`pdftotext -layout` as the only evidence** over a table-extraction
   library or a vision model reading the page. `-layout` keeps a row on
   one line, which is all the matcher needs, is installed (poppler 26.07),
   is deterministic, and costs 21 milliseconds per page on a 97-page
   paper. Rejected: camelot or tabula-style extractors (a Python or Java
   dependency, brittle on journal layouts, and still no better than row
   text for equality), and a VLM re-reading the page (a model checking a
   model, paid per chart, not reproducible in a fixture).
3. **Row or region matching inside a located table** over matching
   anywhere on the page. EPIC page 8 holds `0.5` and `2` as axis ticks and
   page 12 holds `15` three times; `741.3` recurs on three pages of the
   Demirer paper. Anywhere-on-page would pass both read-offs and
   mis-citations. Rejected: page-wide matching, and whole-document
   matching (`## Value matching`, neighbouring pages).
4. **Drop or table** over always dropping and over always converting. A
   stacked-on-log chart whose eighteen values are all in Table 5 is
   content the paper states; dropping it loses the data, while converting
   an unverified chart would launder invented numbers into a table.
   Rejected: both single policies.
5. **A pure gate vendored with the contract, I/O in explainer-batch** over
   keeping everything in explainer-batch. promo-flow's lint must run the
   same reject list and recognise the same verdict grammar, and the
   contract directory already has the vendoring path. Rejected: an
   explainer-batch-only module (promo-flow would re-implement the rules by
   hand and drift, which is the stage 16 defect in miniature) and a
   published package (stage 16 `## Tradeoffs` 3 rejected it for the same
   four files).
6. **No chart for an HTML URL source** over checking against the fetched
   page text. The fetched text is truncated at 200,000 characters, is not
   persisted in state, and a re-fetch is not reproducible; a check against
   it would be a check against a different document. The card's rule is
   also the operator's. Rejected: persisting `htmlContent` as evidence
   (raised as Q15 for the operator, recommended no).
7. **Retire the 6-point filter only after the gate is live and the
   operator has read the reports** over removing it in the same card as
   the gate. The filter is the only thing today that stops a thin invented
   chart; the gate must be seen to catch those first. Rejected: removing
   it with W5, and keeping it for ever as a belt and braces (it drops real
   three-bar data).
8. **Caption admissions as a reject rule** over ignoring the caption. The
   rule is cheap, catches seven live charts, and a model that writes
   "approximate read-offs" is telling the truth. Its word list excludes
   `estimates`, which is statistical vocabulary, so the Demirer caption is
   not a false hit. Rejected: ignoring captions (the EPIC chart would then
   depend on the value check alone, which it also fails, but the rule
   explains the verdict in the words the model used).
9. **One page either side on a miss** over whole-document search and over
   the cited page only. Tables straddle page breaks and printed page
   numbers differ from PDF indices by the front matter; five pages off is
   a wrong citation. Rejected: whole-document search (false positives
   across 97 pages) and no neighbours (fails a correct table on a page
   boundary).
10. **Lexical detection of projected values and time axes now, schema
    fields later** over blocking on stage 16. The regex catches every live
    case; the fields (`basis`, `x.type: time`) make the rules exact and are
    additive within version 2, so they can land in a later revision.
    Rejected: adding the fields in this design (stage 16 owns the shape)
    and leaving the rules out until the fields exist.

## Open questions

1. **Q1** The matching unit: anywhere on the page, or within the row or label region of a table, and how a table is located. **Answer:** within the table for `table`, within the quoted fragment for `text`, on the figure's page with a significant-digit floor for `value_labels`; never page-wide. The table is located by its caption line (`^\s*Table\s+<id>\b`) on the cited page or one either side, the region bounded by the next caption or a two-blank-line run, and matched by row layout (label and all values on one line) or column layout (each value on its x-label's line, within a 12-column band), tier A; tier B accepts values anywhere in the region only when the series has three or more values with three or more significant digits. See `## Value matching`.
2. **Q2** Number normalisation and tolerance. **Answer:** representation-only normalisation (trailing zeros, thousands separators, Unicode minus, percent versus fraction only when a `%` unit or header is present, scientific forms), equality within floating-point noise, no rounding tolerance. Worked examples: `11` against `11.0` and `187` against `187.0` match (Demirer Table 5, page 35); `[0.75,1.17]` tokenises as two values (Flyvbjerg page 27); `741` against `741.3` does not match; `0.5` on EPIC page 8 is an axis tick and is refused for `value_labels` by the three-significant-digit floor.
3. **Q3** Per-kind semantics of `source.kind` and what a `supplied` series is checked against. **Answer:** `table`: tier A or B inside the located table; `text`: the fragment (20 or more characters, three or more words) occurs on the page and contains every value; `value_labels`: every value on the figure's page with three or more significant digits or two decimals, caption line found or page accepted as given; `supplied`: structural rules always, plus the `table` check when the data file names a page, recorded but not blocking; `legacy`: never value-checked, structural rules in the sweep only. W6 widens the wire enum to `table | text | value_labels`, the one-array edit stage 16 Q4 anticipated.
4. **Q4** How observed versus projected is detected, and whether the v2 shape should carry it. **Answer:** lexically, on series names, x labels and the caption, with the regex in `## Reject list`; a series whose labels are all projected is not mixed and is left to the value check. The shape should carry it: a per-series `basis: observed | projected | simulated` (default `observed`, optional in both compositions) would make the rule exact and let the renderer mark projected points. **Deferred (owner: 16-design-content-contract-v2):** add `series[].basis` as an additive optional field; until then the lexical rule stands.
5. **Q5** Drop versus convert to table, and the table's `source`. **Answer:** convert when every series verified (or is `supplied`) and a structural rule hit; drop when any series failed the value check, the source kind is unverifiable, or no section is free for a table. The table keeps the orientation of the source table (operator decision): series verified by the row layout become rows (`columns: [ref, ...x.values]`), series verified by the column layout become columns (`columns: [x.label, ...series names]`), and every other case falls back to one row per x value. The table's `source {ref, page}` is copied from the series sources (distinct refs joined with `; `, first page), its cells are the matched tokens' printed text, and `(proj.)` style labels survive. A single-series two-point chart converts to nothing.
6. **Q6** Inputs with no checkable text: URL sources, scanned PDFs, arXiv HTML. **Answer:** no model-authored chart in every case, and yes the prompt is told per input type: the user turn already differs for URL sources (`src/batch.ts:111-113`); W6 adds "this source has no checkable page text, emit `charts: []` and use a table" to the URL instruction, and the gate drops anything emitted regardless. A scanned PDF is detected per page by the `usable` heuristic, not per document, so a born-digital paper with one mangled figure page still gets its table-sourced chart from another page. A PDF URL is downloaded and is a PDF. Supplied data is allowed on all of them.
7. **Q7** Where the gate's code lives so that explainer-batch and promo-flow's lint share it. **Answer:** the pure rules under `contract/chart-gate/`, vendored by `contract:build --website` with stage 16's four files; `src/page-text.ts` and `src/chart-gate.ts` (the I/O and the artefact edit) stay in explainer-batch; promo-flow's lint calls `gateCharts()` with no page text and requires a recorded verdict. This follows stage 16's sharing decision (a vendored copy, revision-checked) rather than a second mechanism.
8. **Q8** The fate of `figure-data.ts`, `applyProvenanceGate`, the ECharts mapper and `FIGURE_RECREATE`. **Answer:** the pass stays as the producer of `value_labels`, `table` and `supplied` series; `applyProvenanceGate` is deleted and the shared gate checks the model's claims; `estimated` series are dropped before the gate (stage 16 Q11's operator decision can reinstate an `estimated` kind, which this gate would then refuse to verify, so the two decisions are consistent only if the operator accepts that such a chart is never kept); `buildEChartsOption` remains as the render-and-compare mapper per stage 16 Q10, fail-open allowed; `FIGURE_RECREATE` and the `recreate:` and `data:` directives keep their meaning; the CSV reader requires `chart_type`. W8.
9. **Q9** Performance. **Answer:** one `pdftotext -f p -l p -layout` call per distinct cited page, lazily one more each side on a miss, cached per `(sha256, page)` for the run. Measured on the 97-page Demirer PDF: 21 milliseconds for one page, 251 milliseconds for the whole document, so a chart citing three pages costs under 100 milliseconds and the worst case (three series, three pages, all missing, nine calls) under 200 milliseconds. The cost does not depend on the paper's length. No disk cache is needed; the fixtures are the only persistent page texts.
10. **Q10** Fixture storage. **Answer:** wave-2 tests commit page-text excerpts, not pages: for each positive fixture the located table region as `pdftotext -layout` printed it (the Table 5 block of about 20 lines; the Table D2 block of about 30 lines), and for the EPIC negative fixture the numeric-token list of pages 8 and 12 plus the two caption lines, under `tests/unit/fixtures/chart-gate/<paper>/p<NN>.txt`; these are short excerpts of the kind the card permits and carry no prose. The synthetic cases are hand-written. A second test file, `tests/unit/chart-gate-pdf.test.ts`, runs the real `pdftotext` path end to end and is skipped unless `../explainer-batch/input/_held/w35275.pdf` exists, so it runs on the operator's machines and never in a clone of the public mirror.
11. **Q11** Whether v2 should carry `series[].basis: observed | projected | simulated` so the mixed-series rule and the renderer stop relying on label text. **Deferred (owner: 16-design-content-contract-v2):** recommended yes, additive and optional, default `observed`.
12. **Q12** Whether v2's `x.type` should gain `time` (ISO dates, quarters) so a line over `Q2 2024 ... Q3 2025` is allowed by type rather than by the gate's date grammar. **Deferred (owner: 16-design-content-contract-v2):** recommended yes; until then the gate's grammar (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `Qn YYYY`, `Mon YYYY`) decides.
13. **Q13** Stage 16 lists the ordinal, share-of-whole and stacked-on-log checks as zod refinements on `series[].values` (`## Schema v2`, charts), which would make them validator issues and therefore repair candidates, contradicting D5 here and stage 17's issue table. **Deferred (owner: 16-design-content-contract-v2):** recommended that the chart refinements be limited to shape (lengths, a unit on a numeric axis) and that every data rule live in the gate; W4 implements it that way and W1 of stage 16 should not add the three refinements.
14. **Q14** Whether `metadata.quality` should gain a structured `charts[]` verdict record (chart title, rules hit, per-series tier and page, unmatched values, flags) beside the `issues` and `dropped` string arrays. **Deferred (owner: 16-design-content-contract-v2):** recommended yes as an additive optional field. The design does not wait for it: in every mode the gate writes one line per chart in the `## On rejection` grammar, `kept:` lines into `issues` and `table:` or `dropped:` lines into `dropped` (`report:` lines into `issues` in report-only mode), and the lint and the sweep parse those lines; the structured record, when it lands, is written beside the lines and read in preference to them, so neither the lint's rule nor the gate's output section changes.
15. **Q15** Whether an HTML URL source's chart should be checked against the fetched page text, which would mean persisting `htmlContent` in state and lifting the truncation. **Deferred (owner: operator):** recommended no for now (`## Tradeoffs` 6); the card's rule stands.
16. **Q16** Who adds `page` to the two held data files. **Answer:** W8's worker, as part of the format change, since both files are gitignored fixtures on the operator's machine and the worker has the held directory; the values are 35 for `w35275.figure1.json` and 27 for `flyvbjerg-it-cost-risk.figure3.json`, verified above.
17. **Q17** Whether a share-of-whole with three or more parts should be a reject rule. **Answer:** no; the prompt keeps sending it to pills, and the gate lets the value check decide, because a verified composition drawn as bars is content.
18. **Q18** Which page the EPIC fixture cites, given that the card says 12 and the per-page call finds the caption on 8. **Answer:** 8, because the gate uses per-page calls; the test asserts the fail verdict on both pages, so the verifier's criterion 15 check on page 12 holds unchanged.
19. **Q19** When the recreations that stage 16's migration converts from `recreated_figure` (one live, the Flyvbjerg Table D2 bars; seven more in `output/`) get a gate verdict, given that they come out of `migrateV1` with `table`, `text` or `supplied` sources and no `kept:` line. **Deferred (owner: operator):** the operator decided on 2026-10-21 that the migration does not gate them; the import lint reports them as `migrated, ungated` instead of failing, and the deferred card W10 runs the gate over them against the held PDFs and records verdicts once W9 and the archive rewrite have landed. The operator queues W10 when ready.

## Wave-2 cards

Dependency order: W1 and W2 have no dependencies and claim disjoint files,
so they run in parallel. W3 depends on W1, because its `usable` heuristic
test reads the EPIC page 8 and Demirer page 35 excerpts that W1 commits
under `tests/unit/fixtures/chart-gate/`; it runs after W1 and may run
beside W2. W4 needs all three and two stage 16 cards:
`a-pure-function-migrates-v1-to-v2` (for the v1 adapter the sweep uses)
and `the-pipeline-stamps-validates-and-saves-v2` (for the live path). W5
follows W4. W6, W7 and W8 each depend on W5 and claim disjoint files, so
they run in parallel; W6 also waits for stage 16's
`the-skill-schema-block-is-generated-from-the-contract`, W7 for stage 16's
`promo-flow-reads-the-shared-contract` only (it must run **before** stage
16's `the-archives-are-rewritten-to-v2`, whose curation it informs, and its
sweep counts the pre-rewrite live JSON), and W8 for stage 16's
`figure-recreation-writes-the-v2-chart-shape`. W9 is last and needs the
operator's decision. W10 sits outside this order: it is deferred, runs
only after W9 and stage 16's archive rewrite, and is queued by the
operator (Q19). When stage 17's `one-finalise-and-repair-seam` lands
before W4, W4's hook goes into `src/finalize.ts` instead of `src/output.ts`;
the gate's interface is the same.

Frozen wave-1 contract tests the orchestrator re-freezes before the card
that invalidates them: `tests/contract/03` (asserts repair is called for an
ordinal chart) before W4; `tests/contract/02` (greps "at most one chart"
tied to URL sources) before W6; `tests/contract/02` again (pins the
`MIN_CHART_POINTS` block) before W9.

### W1. number-normaliser-and-page-text-matcher

- **Outcome:** `contract/chart-gate/numbers.ts` and `contract/chart-gate/match.ts` exist; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/chart-gate-match.test.ts` passes: the Demirer Table 5 excerpt verifies all three series at tier A (with `11` against `11.0`), the Flyvbjerg Table D2 excerpt verifies 23 values by column layout, the EPIC page 8 and page 12 token lists fail every read-off value and pass the eight Figure 10 value labels, `741` does not match `741.3`, `[0.75,1.17]` yields two tokens, `13,108.7` one, a Unicode minus matches a hyphen, `7e-05` matches `7 × 10⁻⁵`, a `text` fragment of `15 15 15` is refused, and a year token is excluded.
- **Files:** `contract/chart-gate/numbers.ts` (new), `contract/chart-gate/match.ts` (new), `tests/unit/chart-gate-match.test.ts` (new), `tests/unit/fixtures/chart-gate/w35275/p35.txt` (new), `tests/unit/fixtures/chart-gate/flyvbjerg/p27.txt` (new), `tests/unit/fixtures/chart-gate/2410.15332v3/p08-tokens.txt` (new), `tests/unit/fixtures/chart-gate/2410.15332v3/p12-tokens.txt` (new)
- **Depends on:** none

### W2. structural-reject-list

- **Outcome:** `contract/chart-gate/reject.ts` exports `rejectRules(chart)` returning the ordered rule hits and flags; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/chart-gate-reject.test.ts` passes one case per rule in `## Reject list` (doughnut in v1 form, line across categories, mixed projected, stacked on log, `[1,2,3,4,5]`, `[1.6, 98.4]`, `[2,2,2,2]`, caption admission) plus the non-hits: a uniform baseline beside a varying series, Mertens quarters as a time axis, the Demirer "Event-study estimates" caption, a four-part composition, and `[3500, 3200, 2900, 2600]` flagged `linear-series` but not rejected.
- **Files:** `contract/chart-gate/reject.ts` (new), `tests/unit/chart-gate-reject.test.ts` (new), `tests/unit/fixtures/chart-gate/synthetic/` (new: the nine fixtures in `## Test fixtures`)
- **Depends on:** none

### W3. page-text-extraction-and-pdf-url-cache

- **Outcome:** `src/page-text.ts` exports `pageText(pdfPath, page)` running `pdftotext -f N -l N -layout`, stripping control characters, caching per `(sha256, page)` and marking `usable`; `preprocessInputs` downloads a PDF URL into the file cache and records the cached path in state beside `source`; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/page-text.test.ts` passes a mocked-`pdftotext` cache test, the `usable` heuristic on the committed EPIC page 8 and Demirer page 35 excerpts, and a no-network test that a PDF URL resolves to a cached path; `tests/unit/chart-gate-pdf.test.ts` runs the real binary against `../explainer-batch/input/_held/` and is skipped when the directory is absent.
- **Files:** `src/page-text.ts` (new), `src/preprocess.ts`, `src/state.ts`, `src/output.ts` (`resolveSourcePdf` reads the cached path), `tests/unit/page-text.test.ts` (new), `tests/unit/chart-gate-pdf.test.ts` (new), `README.md` (the cache directory)
- **Depends on:** W1 (the `usable` test reads W1's `2410.15332v3/p08-tokens.txt` and `w35275/p35.txt` excerpts)

### W4. gate-runs-in-finalise-report-only

- **Outcome:** `contract/chart-gate/index.ts` exports `gateCharts()`; `src/chart-gate.ts` builds the evidence from state and applies the result; `saveResult` calls it after canonicalise and repair and before the stamp with `CHART_GATE=report` as the default, writing one line per chart in the `## On rejection` grammar into `metadata.quality` (`kept:` into `issues`, `report:` into `issues`); `chartDataIssues` is deleted from `src/quality.ts` and `grep -c 'ordinal sequence\|share-of-whole' src/quality.ts` prints 0; `npm test` passes with `tests/contract/03` re-frozen to assert that repair is never called for a chart issue; `npx ts-node scripts/chart-gate-sweep.ts output/ --pdf-dir ../explainer-batch/input/_held --cite tests/unit/fixtures/chart-gate/citations.json` prints one line per chart with the verdict, giving `dropped` for the EPIC Figure 9 chart and `table` for the `.sol.json` stacked chart (the citations file assigns `page: 8` and `{table, "Table 5", 35}` to those two).
- **Files:** `contract/chart-gate/index.ts` (new), `src/chart-gate.ts` (new), `scripts/chart-gate-sweep.ts` (new), `src/output.ts`, `src/quality.ts`, `src/repair.ts`, `tests/unit/chart-gate.test.ts` (new), `tests/unit/fixtures/chart-gate/citations.json` (new), `tests/unit/fixtures/ordinal-sequence.json`, `tests/unit/fixtures/stacked-log.json`, `tests/unit/fixtures/uniform-values.json`; re-frozen by the orchestrator: `tests/contract/03-chart-checks-run-on-structured-output.test.ts`
- **Depends on:** W1, W2, W3, stage 16 `a-pure-function-migrates-v1-to-v2`, stage 16 `the-pipeline-stamps-validates-and-saves-v2`

### W5. gate-enforces-drop-or-table

- **Outcome:** `CHART_GATE` defaults to `enforce`; a rejected verified chart is removed and its table appended to the first free section with `source {ref, page}`, with a `table:` or `dropped:` line in `quality.dropped` and a `kept:` line in `quality.issues` for every chart that stays; `npm test` passes `tests/unit/chart-gate.test.ts` cases for each verdict including the no-free-section drop and the two-point single-series drop; `npx ts-node scripts/chart-gate-sweep.ts --apply --cite tests/unit/fixtures/chart-gate/citations.json --pdf-dir ../explainer-batch/input/_held` on a copy of the `.sol.json` fixture writes a v2 file whose only chart is the `supplied` recreation (with its `kept:` line) and whose first section carries a 3-row, 7-column table (one row per series, the orientation of Table 5) with `source.page` 35, and `grep -c MIN_CHART_POINTS src/output.ts` still prints 4.
- **Files:** `contract/chart-gate/index.ts`, `src/chart-gate.ts`, `scripts/chart-gate-sweep.ts`, `tests/unit/chart-gate.test.ts`, `README.md` (the `CHART_GATE` variable)
- **Depends on:** W4

### W6. skill-chart-rules-cite-a-source-per-series

- **Outcome:** the `skill.md` prose outside the generated block says each series carries `source {kind, ref, page}`, allows `value_labels` with the figure and page named, says a URL source emits `charts: []` and uses a table, says in one or two sentences that a chart is a recreation of one source figure or table with every value from that artefact or is not made and that values scattered through the text are never assembled into one (thin data stays pills or prose, the existing `skill.md:206-208` route), and no longer says figure labels "do not count yet"; `contract/explainer-v2.ts` wire kinds are `table | text | value_labels`; `grep -c 'does not count yet' skill.md` prints 0 and `grep -c 'one source figure or table' skill.md` prints 1; `npm test` passes with `tests/contract/02` re-frozen for the URL rule; `buildUserInstruction` for a URL item contains the no-chart sentence.
- **Files:** `skill.md`, `src/prompt.ts`, `contract/explainer-v2.ts` (the one-array edit), `tests/unit/prompt.test.ts` (new); re-frozen by the orchestrator: `tests/contract/02-charts-come-only-from-stated-values.test.ts`
- **Depends on:** W5, stage 16 `the-skill-schema-block-is-generated-from-the-contract`

### W7. promo-flow-import-lint-and-live-sweep

- **Outcome:** in promo-flow, `npm run check:contract` runs `gateCharts()` with no page text over every artefact, fails a planted v2 fixture whose non-legacy chart has no `chart "<title>" kept:` line in `quality.issues` with `has no gate verdict`, passes the same fixture once the line is present, passes a copy of it carrying `metadata.migrated_from: 1` and no line while reporting `migrated, ungated`, passes the 49 live files whether still v1 or already rewritten (48 hold only `legacy` series through `migrateV1`; the Flyvbjerg file's migrated recreation is reported `migrated, ungated` and the tally line reads `migrated, ungated: 1`), and reports structural rule hits; the approve route runs the same check; `npx ts-node scripts/chart-gate-sweep.ts --website ../promo-flow/public/explainer-html --pdf-dir ../explainer-batch/input/_held --cite tests/unit/fixtures/chart-gate/citations.json` on the pre-rewrite live JSON (promo-flow at 939c0304) writes `output/chart-gate-sweep.md` with 68 rows (the 67 raw v1 entries plus the Flyvbjerg recreation marked `migrated, ungated`), 12 marked `legacy: code-only`, 5 `pie-doughnut-radar`, and value verdicts for the EPIC and Demirer files whose PDFs are on hand; nothing under `promo-flow/public/` changes.
- **Files:** `promo-flow:src/contract/chart-gate/` (new, generated), `promo-flow:scripts/check-explainer-contract.mjs`, `promo-flow:src/app/api/admin/approve/[filename]/route.ts`, `promo-flow:tests/fixtures/explainer-v2-chart-verdict.json` (new), `scripts/chart-gate-sweep.ts`, `tests/unit/fixtures/chart-gate/citations.json`, `scripts/contract-build.ts` (the subdirectory glob)
- **Depends on:** W5, stage 16 `promo-flow-reads-the-shared-contract` (and it is queued before stage 16 `the-archives-are-rewritten-to-v2`, which it informs and must not wait for)

### W8. recreation-pass-goes-through-the-gate

- **Outcome:** `applyProvenanceGate` is gone and `grep -c applyProvenanceGate src/figure-data.ts` prints 0; `recreateFigureData` returns a v2 `Chart` whose series carry `source.kind` from the reply (`table`, `value_labels`) or `supplied`, estimated series dropped with a console line; the supplied-data format accepts `page` per series and at the top level, both held files carry it, and a CSV without `chart_type` is rejected with a named reason; `npx ts-node scripts/smoke-figure-data.ts ../explainer-batch/input/_held/w35275.figure1.json` prints a chart with `supplied` sources and `page check: pass` for all three series; `npm test` passes.
- **Files:** `src/figure-data.ts`, `src/output.ts`, `scripts/smoke-figure-data.ts`, `docs/FIGURE-EXTRACTION.md`, `tests/unit/figure-data.test.ts` (new), the two held data files (gitignored, operator machine)
- **Depends on:** W5, stage 16 `figure-recreation-writes-the-v2-chart-shape`

### W9. retire-min-chart-points

- **Outcome:** `grep -c MIN_CHART_POINTS src/output.ts README.md skill.md` prints 0 for each; `skill.md` rule 4 reads "at least three stated points in its longest series" and the checklist line no longer says "at least 6 points"; the gate's three-point rule is a constant with a unit test showing a verified three-bar chart kept and a two-point single-series chart dropped; `npm test` passes with `tests/contract/02` re-frozen; the card is queued only after the operator's decision recorded in `## Retiring the 6-point rule` step 3.
- **Files:** `src/output.ts`, `skill.md`, `README.md`, `contract/chart-gate/index.ts`, `tests/unit/chart-gate.test.ts`; re-frozen by the orchestrator: `tests/contract/02-charts-come-only-from-stated-values.test.ts`
- **Depends on:** W5, W6, operator decision

### W10. gate-migrated-recreations

**Deferred** (operator decision, 2026-10-21): the migration leaves recreations ungated, so this card is named here for the operator to queue later; it runs after W9 and after stage 16's archive rewrite, and is not part of the wave-2 order above.

- **Outcome:** `npx ts-node scripts/chart-gate-sweep.ts --website ../promo-flow/public/explainer-html --pdf-dir ../explainer-batch/input/_held --migrated-only --apply` gates every chart in a `metadata.migrated_from: 1` file that has a non-`legacy` series, writes its `kept:`, `table:` or `dropped:` line in the `## On rejection` grammar (the Flyvbjerg Table D2 series verifies at tier A on page 27 of the held PDF, so its line is `kept:`), re-bakes the HTML of each file it touched, and `npm run check:contract` in promo-flow then prints `migrated, ungated: 0`.
- **Files:** `scripts/chart-gate-sweep.ts` (the `--migrated-only` flag), `promo-flow:scripts/check-explainer-contract.mjs` (the tally), `promo-flow:public/explainer-html/organisational-management/2026-07-31_flyvbjerg_it-cost-risk_explainer.json` and its `.html` (and any further migrated recreation live at the time)
- **Depends on:** W7, W9, stage 16 `the-archives-are-rewritten-to-v2`, operator decision to queue
