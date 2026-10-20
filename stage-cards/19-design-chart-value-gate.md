# Stage card 19-design-chart-value-gate: every chart value is checked against the cited page before a chart ships

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6 Astra <gpt-6-astra@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/19-design-chart-value-gate
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Gate:** stage-completed: 16-design-content-contract-v2
- **Path claims:** docs/design/chart-value-gate.md
- **Pairing rationale:** Fresh, high-complexity design: the gate decides which charts reach readers and replaces the 6-point rule, so its matching rules get a frontier worker, GPT-6 Astra at high effort; an OpenAI worker balances the Claude Fable worker on 18. The verifier is Claude Opus 5.5 from the other family, judgement-capable for checking matching rules against the criteria without the frontier tier. Gated on stage 16 because the gate is built on the v2 chart shape that stage 16 designs.
- **Open decisions:** none

## Surfacing concern

The 2026-10-19 review found that the bad graphs come mainly from the design, not the model. The prompt asks the synthesis model to recreate figures as Chart.js charts and "match the axes, groupings, and data points", charts carry no record of where their numbers came from, and the one code check that catches bad charts is silently off on the default structured-output route. The model reads numbers off curves or invents them, and nothing can tell those from real data. The same EPIC Figure 9 was charted three times with three different datasets, and captions admit "approximate read-offs from the published curves". The review's fix is a code gate: a chart is allowed only when its data was supplied, or when every value is found in the text layer of the page the chart cites, plus a list of encodings rejected in code. Wave 2 will be carded from this design document.

Defects this design must answer. Line numbers were re-checked against `dev` at 0cd17d7 on 2026-10-19; wave-1 cards (canonicalise before validate, validation inside `saveResult`, chart issues kept out of LLM repair) may change some of this code before you run, so read your own base and describe what is there.

| Id | Where | Defect |
|---|---|---|
| D1 | `skill.md:25`, `:142`, `:154`, `:160`, `:167`, `:211` | The prompt asks for Chart.js recreations of the paper's figures, invites radar charts and axis read-offs, and says to chart a real figure "whatever the paper's genre". |
| D2 | `src/types/explainer-json.ts:124-141` | A chart has no source, page or provenance field. |
| D3 | `src/quality.ts:57-58`; `src/schema/explainer-schema.ts:133` | The chart checks read only an object `config_json`, but structured output makes it a string, so the checks never run on the default route. |
| D4 | `src/quality.ts:73-104` | Code rejects only ordinal sequences and two-value share-of-whole splits. The two-value check fires only on pairs summing to about 100 or 1 (`src/quality.ts:92-100`). Pie, doughnut and radar, lines across categories, stacked bars on a log axis, uniform values and mixed observed and projected values all pass (live examples: a doughnut summing to 85%, `[2,2,2,2]`, `[1,2,3,4,5]`). |
| D5 | `src/quality.ts:87`; `src/batch.ts:258-263` | A chart issue asks the repair model to "replace with measured values", but the repair model is given only the JSON, not the paper, so repair invents data. |
| D6 | `src/output.ts:358-405`; `skill.md:204` | The 6-point filter drops charts with fewer than six points: real three-bar data is lost while an invented 11-point curve passes, and it contradicts the radar guidance. 33 of the 67 live promo-flow charts have fewer than six points. |
| D7 | `src/output.ts:402`; `src/quality.ts:248` | Chart caps disagree (3 versus 4). |
| D8 | `src/figure-data.ts:230-279`, `:246`, `:341-400`, `:429`, `:432` | The recreation pass's provenance gate trusts a self-declared `exact`, its source is optional, its verify step fails open, CSV data defaults to a line chart, and supplied data is stamped `exact` without structural checks. |
| D9 | `src/preprocess.ts:509` | URL sources are stripped to text, yet the prompt still asks for recreated figures, so charts are built from prose (the Hitzig chart split a reported 28 to 33% range into two invented points). |
| D10 | `src/output.ts:516-546` | `saveResult` never validates, so a chart that fails every check still ships. |
| D11 | promo-flow `src/lib/explainer-to-html-core.mjs:102-103` | promo-flow renders whatever `charts[]` holds; the 49 live explainers have never been re-checked against later rules. |

Cold read on 2026-10-19 by the other family (Codex, codex-cli 0.163.0, read-only sandbox) over all four design cards; its questions, verifier-seat gaps and line corrections are folded into this card. This is a prose stage, so it has no contract test (see Contract test). The acceptance criteria are written to be checked by command wherever a command can check them.

## Objective

Write `docs/design/chart-value-gate.md`: the design for a deterministic chart gate that runs after canonicalisation, checks every chart value against `pdftotext -layout` text of the cited page (or against a supplied data file), applies a reject list in code, and on rejection drops the chart or converts it to a table, never sending it to LLM repair. It also retires the 6-point rule. The document ends with a numbered list of wave-2 cards precise enough to card from directly.

The rule, from the review (sections 2a and 3). Refine it; any departure is a tradeoff entry.

- Allow a chart only when its data was supplied by the operator, or when every value is found in the text layer of the cited page.
- Each series carries `source{kind: table | value_labels | text | supplied, ref, page}` (the v2 chart shape from stage 16).
- Reject in code: pie, doughnut and radar; a line across categorical x values (lines need a numeric or time x axis); observed and projected values in one series; stacked bars on a log axis; ordinal sequences and two-value splits.
- On rejection: drop the chart, or convert it to a section table when its values verified; never LLM repair.
- Text-layer checking only works for born-digital PDFs. For a model-authored chart, a scanned paper or an HTML URL source produces no chart (a table or the figure crop instead), which is the right failure. A PDF URL is downloaded and treated as a PDF. Operator-supplied data is allowed whatever the input kind; it gets the structural checks, and the page check too when the data file cites a checkable page.

## Inputs (read these in your own context)

- docs/design/content-contract-v2.md, from stage 16 (this card's gate guarantees it is on your base): the v2 chart and table shapes, the `source` semantics and the quality record. Build on them; do not redesign them.
- `src/quality.ts` (`chartDataIssues`, `validateJsonOutput`, `buildRepairInstruction`), `src/output.ts` (normalisers, `MIN_CHART_POINTS`, `saveResult`), `src/figure-data.ts` (the recreation pass and `applyProvenanceGate`), `src/batch.ts` lines 230-310 (the repair loops), `src/preprocess.ts` around lines 500-600 (URL and PDF inputs)
- `skill.md` (the chart rules, lines 135-215, and the checklist near the end)
- The live charts, read-only in the promo-flow sibling checkout: `../promo-flow/public/explainer-html/` (49 `*_explainer.json` files) and `../promo-flow/src/lib/explainer-to-html-core.mjs`. A short script that lists every chart's type, series lengths and caption is fine.
- Fixture material is gitignored and lives only in the main checkout, the run worktree's sibling: `../explainer-batch/input/_held/` (PDFs, focus files, and the two supplied data files `w35275.figure1.json` and `flyvbjerg-it-cost-risk.figure3.json`) and past outputs in `../explainer-batch/output/` (the EPIC, Demirer, Hitzig and Flyvbjerg runs).
- `pdftotext` (poppler 26.07 is installed). Checked on 2026-10-19: the Demirer supplied values (for example `741.3`) appear on PDF pages 34, 35 and 96 of `w35275.pdf`, with "Table 5" captioned on page 35; the Flyvbjerg value `7.836` (Table D2) appears on page 27 of `flyvbjerg-it-cost-risk.pdf`.

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified. Paths are relative to repo root.

1. `docs/design/chart-value-gate.md`: the design document. It must contain these second-level headings, spelled exactly, in this order (extra headings and third-level subsections are welcome):
   - `## Summary`
   - `## Current state`: every chart check that exists today, where it runs, which routes skip it, and what reaches promo-flow, citing code as `path:line`.
   - `## Findings addressed`: a Markdown table with one row per defect id D1 to D11, each row starting `| Dn |`, saying how the design resolves it (or which card owns it).
   - `## Gate inputs`: what the gate reads (the canonical v2 explainer, the source PDF or a supplied data file, the input kind), and what it does for each input kind: local PDF, PDF URL, arXiv source, HTML URL, scanned PDF with no text layer.
   - `## Value matching`: the algorithm that matches each value against the cited page's `pdftotext -layout` text: number normalisation (decimal places, trailing zeros, thousands separators, Unicode minus, percent versus fraction, scientific notation), tolerance, what counts as a match for each `source.kind`, how false positives from small common numbers are avoided (for example requiring the row or series label nearby, or a minimum of significant digits), and whether neighbouring pages are searched.
   - `## Reject list`: each rule with its exact detection logic and a live or fixture example that it catches. At least: pie, doughnut and radar; lines across categories; mixed observed and projected values in one series; stacked on a log scale; ordinal sequences; two-value splits. Also say whether uniform values, constant first differences and caption admissions ("approximate", "read off", "traced", "illustrative") are rules.
   - `## On rejection`: when a chart is dropped and when it becomes a table, what is recorded in the artefact's quality record, and confirmation that no chart issue is ever sent to LLM repair.
   - `## Retiring the 6-point rule`: what replaces `MIN_CHART_POINTS` and the `skill.md:204` rule, the order of retirement (the filter stays until the gate is live, an operator decision), and what thin verified data becomes.
   - `## Where the gate runs`: in the stage-17 orchestrator's finalise step (or `saveResult` until then), as a shared module or CLI that promo-flow's import can run, and as a one-off sweep of the 49 live explainers; and what happens to `figure-data.ts`'s recreation pass.
   - `## Test fixtures`: each fixture with its source, the cited page, and the expected verdict; see Q10.
   - `## Migration and rollback`: landing the gate (for example report-only first, then enforcing), the prompt change in `skill.md`, the live sweep, and a line starting `Rollback:` for each step.
   - `## Tradeoffs`: a numbered list, at least four entries, each with a line containing `Rejected:`.
   - `## Open questions`: a numbered list including Q1 to Q10 below, each item starting `N. **Qk**`, every item carrying `**Answer:**` or `**Deferred (owner: <stage id or operator>):**`. Further questions go in as Q11 onwards under the same rule.
   - `## Wave-2 cards`: each as `### Wn. <slug>` followed by `- **Outcome:**` (one observable outcome and the command that shows it), `- **Files:**`, `- **Depends on:**` (other Wn ids, stage-16-derived cards by slug, or `none`). At least four cards, dependencies first, noting which can run in parallel.

Questions the document must settle (Q1 to Q10):

- **Q1** The matching unit: does each value match anywhere on the cited page, or must it match within the row or label region of a table? How is a table located on the page?
- **Q2** Number normalisation and tolerance rules, with worked examples from the fixtures.
- **Q3** Per-kind semantics of `source.kind` (`table`, `value_labels`, `text`, `supplied`) and what a `supplied` series is checked against (structure only, or the cited page too when the data file names one).
- **Q4** How "observed versus projected" is detected (series name keywords, caption, a field in the v2 shape), and whether the v2 shape should carry it explicitly (if so, raise it against stage 16's design as a deferred question with that stage as owner).
- **Q5** Drop versus convert-to-table: the rule, and the table's own `source`.
- **Q6** Inputs with no checkable text: URL sources, scanned PDFs, arXiv HTML. Is the answer "no chart" in every case, and is the prompt told so per input type?
- **Q7** Where the gate's code lives so that explainer-batch and promo-flow's import lint share it (ties to stage 16's sharing decision).
- **Q8** The fate of `figure-data.ts` (the recreation pass, `applyProvenanceGate`, the ECharts mapper) and the `FIGURE_RECREATE` directive.
- **Q9** Performance: one `pdftotext` call per cited page, caching, and the cost on a 97-page paper.
- **Q10** Fixture storage: the PDFs are gitignored and not all are redistributable, so say what wave-2 tests commit (for example page-text snapshots from `pdftotext -layout`) and what runs only locally.

The fixture list must include at least these, with the expected verdict worked out from the files:

- Demirer, `input/_held/w35275.pdf` with the supplied `input/_held/w35275.figure1.json` (Table 5 values on PDF page 35): expected to pass the value check. Also note that its supplied data draws a bar chart across categorical production layers, and say what the reject list does with that.
- Flyvbjerg, `input/_held/flyvbjerg-it-cost-risk.pdf` with `input/_held/flyvbjerg-it-cost-risk.figure3.json` (Table D2 on page 27).
- EPIC Figure 9 read-offs from `output/2026-05-28_hu_epic-legolink-position-independent-caching_explainer.json` against `input/_held/2410.15332v3.pdf` (Figure 9 is captioned on PDF page 12; the v1 chart cites no page, so the fixture assigns it): expected to fail the value check.
- The Hitzig URL chart (`output/2026-06-17_hitzig_agentic-coding-expertise_explainer.json`): a URL source.
- The stacked-on-log chart in `output/2026-07-31_demirer_writing-code-shipping-code_explainer.sol.json`.
- Synthetic cases for the reject list: a doughnut, `[2,2,2,2]`, `[1,2,3,4,5]`, a line over categorical x values, and a series mixing observed and projected values.

## Constraints

- Design only. Write no code under `src/`, `scripts/` or `tests/`, change no dependency, and edit no file other than the document. Do not edit `skill.md`; describe the change.
- Do not remove or weaken the 6-point filter in this stage; it stays until the wave-2 gate is live (operator decision). Design its retirement.
- No chart issue may be routed to LLM repair in the design.
- Build on stage 16's v2 chart shape; where the gate needs a field the shape lacks, record it as a question deferred to `owner: 16-design-content-contract-v2` or the wave-2 card that owns the schema.
- Cite the current state as `path:line` against the code you actually read. Every defect row cites at least one location.
- Run `pdftotext` on the held PDFs to work out each fixture's expected verdict, and quote the command and a short excerpt where a verdict depends on it. Do not copy PDF text beyond short excerpts into the repo.
- No network calls and no paid model calls.
- Respect operator decisions already made: batch and subscription runs stay first-class; publishing is a manual curated replay and never a card step.
- British English. No em dashes anywhere in the document.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage.

Every command runs from the run worktree root. Baselines were run on `dev` at 0cd17d7 on 2026-10-19; the document does not exist there, so every command criterion is red on the base, as expected for a new deliverable. Judge each command by what it prints, not by its exit status: several pass by printing nothing or `0`, and `grep` then exits 1.

1. **The document exists.** Seat: verifier. Command: `test -s docs/design/chart-value-gate.md && echo present` prints `present`. Baseline: red.
2. **Required headings, exact and in order.** Seat: verifier. Command: `grep -nE '^## ' docs/design/chart-value-gate.md` lists `## Summary`, `## Current state`, `## Findings addressed`, `## Gate inputs`, `## Value matching`, `## Reject list`, `## On rejection`, `## Retiring the 6-point rule`, `## Where the gate runs`, `## Test fixtures`, `## Migration and rollback`, `## Tradeoffs`, `## Open questions`, `## Wave-2 cards` in that relative order. Baseline: red.
3. **Every defect has a row.** Seat: verifier. Command: `for d in D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11; do grep -qE "^\| ${d} \|" docs/design/chart-value-gate.md 2>/dev/null || echo "missing: $d"; done` prints nothing. Baseline: red.
4. **Every listed question is present.** Seat: verifier. Command: `for q in Q1 Q2 Q3 Q4 Q5 Q6 Q7 Q8 Q9 Q10; do grep -qE "^[0-9]+\. \*\*${q}[^0-9]" docs/design/chart-value-gate.md 2>/dev/null || echo "missing: $q"; done` prints nothing. Baseline: red.
5. **Every open question is answered or deferred with an owner.** Seat: verifier. Command: `sed -n '/^## Open questions$/,/^## /p' docs/design/chart-value-gate.md | grep -E '^[0-9]+\. ' | grep -vE '\*\*(Answer|Deferred \(owner: [^)]+\)):\*\*'` prints nothing, and criterion 4 is green. Baseline: red.
6. **Wave-2 cards are complete.** Seat: verifier. Command: `python3 -I -c 'import re,sys;t=open(sys.argv[1]).read();s=t.split("\n## Wave-2 cards\n",1)[1].split("\n## ",1)[0];b=re.split(r"\n(?=### W[0-9]+\. )","\n"+s)[1:];bad=[x.splitlines()[0] for x in b if not all(k in x for k in ("- **Outcome:**","- **Files:**","- **Depends on:**"))];print("cards:",len(b),"incomplete:",bad)' docs/design/chart-value-gate.md` prints `cards: N incomplete: []` with N at least 4. Baseline: red.
7. **Tradeoffs are stated.** Seat: verifier. Command: `sed -n '/^## Tradeoffs$/,/^## /p' docs/design/chart-value-gate.md | grep -cE '^[0-9]+\. '` prints at least 4 and `sed -n '/^## Tradeoffs$/,/^## /p' docs/design/chart-value-gate.md | grep -c 'Rejected:'` prints at least 4. Baseline: red.
8. **Migration has a rollback.** Seat: verifier. Command: `sed -n '/^## Migration and rollback$/,/^## /p' docs/design/chart-value-gate.md | grep -c 'Rollback:'` prints at least 1. Baseline: red.
9. **The reject list covers the named rules.** Seat: verifier. Command: `for k in pie doughnut radar categor projected stacked ordinal two-value; do sed -n '/^## Reject list$/,/^## /p' docs/design/chart-value-gate.md | grep -qi "$k" || echo "missing: $k"; done` prints nothing. Baseline: red.
10. **The fixtures are named.** Seat: verifier. Command: `for k in w35275 flyvbjerg 2410.15332 hitzig sol.json; do sed -n '/^## Test fixtures$/,/^## /p' docs/design/chart-value-gate.md | grep -q "$k" || echo "missing: $k"; done` prints nothing. Baseline: red.
11. **Current state is cited from real code.** Seat: verifier. Command: `grep -oE '(src|scripts)/[A-Za-z0-9_./-]+:[0-9]+|skill\.md:[0-9]+' docs/design/chart-value-gate.md | sort -u | wc -l` prints at least 12. The verifier then opens at least eight of those citations and confirms each points at the code the document says it does. Baseline: red.
12. **Style.** Seat: verifier. Command: `grep -c '—' docs/design/chart-value-gate.md` prints `0`. Spelling is British outside code identifiers. Baseline: red (file absent).
13. **Only the document changed.** Seat: verifier. Commands, run after the worker's commit: `git diff --name-only dev...HEAD` prints exactly `docs/design/chart-value-gate.md`, and `git status --porcelain -- ':!state'` prints nothing (no other uncommitted or untracked change; `state` is the orchestrator's symlink). Baseline: red (prints nothing).
14. **Each defect is genuinely resolved (verifier judgement).** Seat: verifier, reading the document against the code. For each of D1 to D11 in the Surfacing concern (by its file:line), the design removes the cause or names the wave-2 card that does; a row that only restates the defect fails. In particular: the gate runs on the canonical object on every route (D3, D10); chart issues never reach LLM repair (D5); a self-declared provenance is never trusted without the text-layer check (D8); the 6-point rule is retired only after the gate is live (D6).
15. **The fixture verdicts are real (verifier judgement).** Seat: verifier. For the Demirer and Flyvbjerg fixtures, the verifier runs `pdftotext -f <page> -l <page> -layout <pdf> -` on the main checkout's `../explainer-batch/input/_held/` copy and confirms that a sample of at least three values from each supplied data file appears on the page the document cites. For the EPIC fixture, it confirms that at least one charted read-off value does not appear on PDF page 12, where Figure 9 is captioned.
16. **The design is consistent with stage 16 (verifier judgement).** Seat: verifier. The gate reads and writes only fields that `docs/design/content-contract-v2.md` defines, or it records the missing field as a question deferred to stage 16's owner.
17. **The wave-2 list is cardable (verifier judgement).** Seat: verifier. Each `Wn` card has one observable outcome with a command, real or named-new files, and acyclic dependencies; together they cover the value matcher with its fixtures, the reject list, drop-or-table handling with the quality record, the `skill.md` chart-rule rewrite, the retirement of `MIN_CHART_POINTS`, and the live sweep or import lint for promo-flow.

## Contract test

<!--
Prose-only stage: the deliverable is a design document, so there is nothing executable to freeze. The acceptance criteria above carry the checks by command. -->

- **Test file:** None
- **Assertions digest:** None
- **Oracle proof:** None. This is a prose design stage with no executable surface; criteria 1 to 13 are shell checks against the document and were each run on `dev` at 0cd17d7 (all red because the document is absent), and criteria 14 to 17 are verifier judgement.

## Out of scope

- Any code, prompt, dependency or test change, including removing `MIN_CHART_POINTS`. The wave-2 cards this document lists do that.
- Redesigning the v2 chart or table shape (stage 16), the orchestrator (stage 17) or the figure locator (stage 18).
- promo-flow's chart rendering and the live sweep itself; design them, do not run them.
- Style and prose rules in `skill.md` other than the chart rules.

## Budget

- **Worker wall-clock:** 120 minutes
- **Verifier wall-clock:** 45 minutes
- **Spend basis:** GPT-6.1 Sol worker; stage 17 (the same shape under Astra) is the nearest comparison. Budget about 6M worker and 1.5M Opus 5.5 verifier tokens. Fewer files than stages 17 and 18 but more fixture work.

## Dispatch envelope

Return the standard envelope with:
- `status`: pass or fail.
- `commit`: the commit SHA on `autometta/19-design-chart-value-gate` that adds the document, authored as `GPT-6.1 Sol <gpt-6-1-sol@local>`.
- `deliverables`: `docs/design/chart-value-gate.md`.
- `evidence`: the output of acceptance commands 1 to 12 as you ran them before committing, and of command 13 after committing.
- `notes`: the Wn list (ids and slugs only), every question deferred to the operator or to stage 16's owner, and any wave-1 change you found on your base that altered a defect in the table.

## Family-specific notes

- **Codex (worker):** workspace-write is enough; it permits reading `../promo-flow` and the main checkout's gitignored `input/_held/` through `../explainer-batch`, and running `pdftotext`. No network. Commit the document yourself, authored with `git commit --author="$(agent-whoami)"`.
- **Claude (verifier):** runs unsandboxed; re-runs the `pdftotext` checks against `../explainer-batch/input/_held/` and makes no network calls.
