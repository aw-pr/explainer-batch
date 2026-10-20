# Stage card 16-design-content-contract-v2: one zod schema defines a content-only v2 explainer contract

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/16-design-content-contract-v2
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** docs/design/content-contract-v2.md
- **Pairing rationale:** Design work whose output every wave-2 contract card is carded from, so it gets the strongest design tier (Fable 5.1 is reserved for the four design cards). The verifier is from the other family (GPT-6 Astra) and is judgement-capable, which a prose stage needs: most criteria are greppable, but the defect-coverage and citation checks need a reader who can open the code. The four design cards (16 to 19) all use this pairing; they claim disjoint paths, so they do not alternate worker family. Re-pinned 2026-10-20 evening for spend: Fable 5.1 to Claude Opus 5.5 and GPT-6 Astra to GPT-6.1 Sol (Autometta's new Codex default, about a fifth of Astra's rate), keeping the cross-family pairing and the equal Claude/OpenAI split.
- **Open decisions:** none

## Surfacing concern

The 2026-10-19 review of explainer-batch and the promo-flow import found that the JSON contract carries presentation, is defined in six or seven places, and has drifted. The baked HTML has quietly become the real contract: promo-flow serves baked HTML for all 49 live explainers and uses the JSON only for card pills and dates. The review recommends keeping the JSON intermediate (it is the only clean seam that keeps explainer-batch provider-agnostic and lets promo-flow own the design) but redefining it as a content-only v2. Wave 2 (the schema, prompt, migration and promo-flow native-render cards) will be carded from this design document, so the design has to exist first.

Defects this design must answer. Line numbers were re-checked against `dev` at 0cd17d7 on 2026-10-19; wave-1 cards may move them, so re-check against your own base and cite what you see.

| Id | Where | Defect |
|---|---|---|
| D1 | `src/types/explainer-json.ts:124-141` | `ExplainerChart` has only title, caption, `config_json` (a Chart.js config) and `config_raw` (executable JavaScript, deserialised with `new Function`, :137). No field records where the data came from. |
| D2 | `src/schema/explainer-schema.ts:127-136` | The model-facing schema makes `config_json` a string, so the typed chart checks cannot see it (`src/quality.ts:57-58` only reads objects). |
| D3 | `src/schema/explainer-schema.ts:120`, `:170`; `src/types/explainer-json.ts:52`, `:226`, `:248`, `:259` | Every text is written twice: `headline`/`headline_html`, `paragraphs`/`paragraphs_html`, `intro`/`intro_html`, `body`/`body_html`. The renderer prefers the HTML copy. |
| D4 | `src/types/explainer-json.ts:121`; `src/schema/explainer-schema.ts:61` | The model chooses pill `accent_color` hex values; headline spans carry highlight markup. Presentation in the content contract. |
| D5 | `src/schema/explainer-schema.ts:157-174`, `:187`; `src/quality.ts:123-125`; `src/output.ts:489-513`, `:531` | The model generates fields the pipeline already knows: `date_created` is validated against a date the harness supplies, and `filename_slug`, `eyebrow`, `publication_date` and `references` are conditionally overwritten from detected metadata. Stamping runs after validation, so repair can spend a call fixing a field that is then replaced. |
| D6 | `src/output.ts:302-308` | The figure is a base64 `data:` URL inside the JSON (300 to 680 KB per file); promo-flow ships `scripts/extract-explainer-media.mjs` to undo it. |
| D7 | `skill.md:36-64`; `src/schema/explainer-schema.ts:23`; `src/quality.ts:106`; promo-flow `src/lib/explainer-json.ts`, `src/types/explainer-json.ts`, `src/lib/explainers.ts:649` | The contract lives in six or seven hand-kept places that disagree; `version` has stayed `1` (`src/types/explainer-json.ts:19`) through several shape changes. |
| D8 | `src/output.ts:402`, `:405`; `src/quality.ts:248`; promo-flow `src/lib/explainer-to-html-core.mjs:103` | Chart caps disagree (4 in the prompt and validator, 3 in the normaliser and renderer); a legacy `chart` copy of `charts[0]` is written on every save. |
| D9 | `src/types/explainer-json.ts:83`, `:168`; `src/output.ts:203` | `recreated_figure` is a second, parallel chart path (the only one with provenance), off by default and rendered nowhere in promo-flow. |
| D10 | `src/schema/explainer-schema.ts:184`; `skill.md:58`; `src/prompt.ts:25` | `image` is in the model schema although `skill.md` says never emit it, and the user instruction says to emit it. |
| D11 | `src/quality.ts:194` | The validator rejects table-only sections that the schema and `skill.md` allow. |
| D12 | `src/providers.ts:522`, `:139-145` | Structured output is not strict on OpenAI and advisory on Claude; whatever v2 is must be expressible as the OpenAI strict subset, a Claude tool `input_schema` and a Gemini `responseSchema` (no `additionalProperties`). |
| D13 | promo-flow `src/lib/explainer-to-html-core.mjs:110`, `:112`, `:220`; `src/components/explainers/ExplainerChartCanvas.tsx:91` | The renderer writes model HTML and chart config into the page and evaluates `config_raw` as code. The v2 contract must carry no HTML beyond a tiny allowlist and no executable content. |

Cold read on 2026-10-19 by the other family (Codex, codex-cli 0.163.0, read-only sandbox) over all four design cards; its questions, verifier-seat gaps and line corrections are folded into this card. This is a prose stage, so it has no contract test (see Contract test). The acceptance criteria are therefore written to be checked by command wherever a command can check them.

## Objective

Write `docs/design/content-contract-v2.md`: the design for a slim, content-only, versioned v2 explainer contract defined once as a zod schema, from which the TypeScript type, the provider schema dialects, the validator and the `skill.md` schema block are generated; how promo-flow shares it; how v1 artefacts migrate; and what promo-flow's native renderer can rely on. The document ends with a numbered list of wave-2 cards precise enough to card from directly.

The starting shape, from the review (section 3). Refine it; any departure is a tradeoff entry.

```
metadata    {version: 2, date_created*, slug*, model*, route*, source{kind, ref}}        * stamped by code
hero        {headline, emphasis?, subtitle, eyebrow*, byline*, publication_date*}
top_block   {kind, pills[{lead, text, tone?}] | takeaway}
sections[]  {label, paragraphs[] (plain text plus a tiny inline allowlist: em, strong, a, code, sub, sup),
             list?, table?{columns, rows, source{ref, page}}}
lead_figure {label, caption, alt_text, asset: "<slug>/figure-3.jpg", page,
             provenance: arxiv-source | pdf-embedded | pdf-vector-crop | dom-asset | vlm-crop}
charts[]    0..1 {kind: bar | line | scatter, title, caption, x{label, type, unit}, y{label, unit, scale},
             series[{name, values, source{kind: table | value_labels | text | supplied, ref, page}}]}
end_takeaway, references[{authors, year, title, venue, url}]
```

Dropped from the contract: every `*_html` twin, `accent_color`, `config_raw`, the Chart.js `config_json`, the legacy `chart`, `echarts_option`, and the base64 `image.src` (the figure becomes a sidecar asset file referenced by path).

## Inputs (read these in your own context)

- `src/types/explainer-json.ts`, `src/schema/explainer-schema.ts`, `src/quality.ts`, `src/output.ts` (normalisers, stamping, `saveResult`), `src/prompt.ts`, `src/figure-data.ts` (the neutral `RecreatedSeries` shape and its ECharts mapper)
- `skill.md` (the schema prose at lines 36-64 and the chart rules; its body is the production system prompt)
- `src/providers.ts` lines 100-160 and 500-530 (how the schema reaches Claude and OpenAI today)
- `docs/FIGURE-EXTRACTION.md` (current figure output fields)
- `output/2026-04-16_alenezi_agentic-ai-architecture_explainer.json` (the one tracked v1 sample)
- promo-flow, the sibling checkout (read-only): `../promo-flow/src/lib/explainer-json.ts`, `../promo-flow/src/types/explainer-json.ts`, `../promo-flow/src/lib/explainers.ts` (normalisers around line 600-722), `../promo-flow/src/lib/explainer-to-html-core.mjs`, `../promo-flow/scripts/extract-explainer-media.mjs`, `../promo-flow/scripts/check-explainer-sidecars.mjs`, `../promo-flow/package.json`, and the April plan `../promo-flow/docs/plans/2026-04-13-1431-explainer-publishing-hybrid.md`
- The 49 live explainers: `../promo-flow/public/explainer-html/` (one `*_explainer.json` per article). Sample them; do not read all 49 in full. A short script that tallies field usage across them is fine.
- The local v1 archive is gitignored and lives only in the main checkout, the run worktree's sibling: `../explainer-batch/output/` and `../explainer-batch/output.local/`. Use it for field-usage counts only.

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified. Paths are relative to repo root.

1. `docs/design/content-contract-v2.md`: the design document. It must contain these second-level headings, spelled exactly, in this order (extra headings and third-level subsections are welcome):
   - `## Summary`: the decision in one screen.
   - `## Current state`: where the contract lives today and how it drifts, citing code as `path:line`.
   - `## Findings addressed`: a Markdown table with one row per defect id D1 to D13, each row starting `| Dn |`, saying how the design resolves it (or why it is out of this design's scope and which card owns it).
   - `## Schema v2`: every field, its type, whether the model emits it or code stamps it, and which consumer needs it. Distinguish the model-facing output schema from the stored artefact schema if they differ, and show how both come from one zod source.
   - `## Dialects and generation`: how the TS type, the OpenAI strict JSON Schema, the Claude tool `input_schema`, a Gemini `responseSchema`, the runtime validator and the generated `skill.md` schema block are all produced from the zod source; what the build or check command is; and how dialect limits (OpenAI strict requires every property and `additionalProperties: false`; Gemini rejects `additionalProperties`; nullable handling differs) are handled without hand-written copies.
   - `## Sharing with promo-flow`: compare at least a published package, a vendored copy with a drift check, and a generated file; choose one; state how drift is detected in each repo.
   - `## What the promo-flow renderer needs`: what the native renderer can rely on (field guarantees, plain-text versus inline-allowlist fields, the chart island's input, the figure asset path and how it reaches `public/`). Do not design the renderer itself.
   - `## Migration and rollback`: v1 to v2 for existing outputs (`output/`, `output.local/`) and for the 49 live promo-flow explainers, including the 12 legacy `config_raw` charts and base64 images; a v1 reader kept in promo-flow until migration completes; ordering across the two repos and the publish branch; and a line starting `Rollback:` for each step that says how to undo it.
   - `## Tradeoffs`: a numbered list, at least four entries, each naming the choice and a line containing `Rejected:` with the alternative and why.
   - `## Open questions`: a numbered list. It must include Q1 to Q10 below, each item starting `N. **Qk**` (for example `1. **Q1** ...`), and every item must carry either `**Answer:**` or `**Deferred (owner: <stage id or operator>):**`. Add any further questions you find as Q11 onwards, under the same rule.
   - `## Wave-2 cards`: the cards this design implies, each as a third-level heading `### Wn. <slug>` (slug in the stage-card style: a sentence describing the outcome), followed by the bullets `- **Outcome:**` (one observable outcome and the command that shows it), `- **Files:**` (repo-relative paths, prefixed `promo-flow:` for that repo), `- **Depends on:**` (other Wn ids, or `none`). At least five cards, ordered so dependencies come first. Note which cards can run in parallel.

Questions the document must settle (Q1 to Q10):

- **Q1** Which zod version and JSON Schema path: zod 4 with its native JSON Schema output, or zod 3 with `zod-to-json-schema`. The operator's direction is a zod source; TypeBox belongs in `## Tradeoffs` as a rejected alternative unless the document makes a strong case, which then goes to the operator as a deferred question. Neither repo depends on zod today. Choose by what each can emit for the three dialects, citing the library's own documentation (installing it is out of scope).
- **Q2** How promo-flow consumes the contract (package, vendored copy with a drift check, or generated file), and how a contract change is landed in both repos without breaking the live site.
- **Q3** Inline markup: the allowlist (em, strong, a, code, sub, sup) as an HTML subset, a markdown-lite syntax, or `{text, marks}` runs; where sanitisation happens, and how search and plain text are derived.
- **Q4** The chart shape: axis types, `y.scale`, the series `source{kind, ref, page}` semantics per kind, the cap (0 or 1 chart), and how tables carry `source{ref, page}`. Stage 19 designs the value gate on top of this shape, so make the shape complete enough for it.
- **Q5** `lead_figure` as a sidecar asset: file naming, who writes it, the `provenance` enum, `label` and `why` emitted by the synthesis model (stage 18 designs the locator), and how promo-flow ingests the asset.
- **Q6** Stamped fields: the exact list the model no longer emits (date, slug, eyebrow, byline, publication date, detected reference, model, route), the order stamp then validate, and where a quality record (issues found, items dropped) lives in the artefact.
- **Q7** Structured references (`authors, year, title, venue, url`) versus the current HTML reference strings, and how a detected reference overrides the model's.
- **Q8** Versioning: how `version: 2` is checked, how a v1 artefact is read, and when the v1 reader is deleted.
- **Q9** How the `skill.md` schema block is generated and kept in sync (a marker-delimited block rewritten by a script, and a check that fails on drift), given that `skill.md`'s body is the production system prompt.
- **Q10** What happens to `recreated_figure`, `figure-data.ts`'s ECharts mapper and the `echarts` dependency once the neutral chart shape is the only chart format.

## Constraints

- Design only. Write no code under `src/`, `scripts/` or `tests/`, change no dependency, and do not edit `skill.md`, the promo-flow checkout, or any other file. The one deliverable is the document.
- Cite the current state as `path:line` against the code you actually read. Every defect row in `## Findings addressed` cites at least one location.
- Keep batch (50% off) and subscription runs first-class: nothing in the contract may assume a particular provider or route.
- Operator decisions already made, which the design must respect, not reopen: the 6-point chart filter (`src/output.ts` `MIN_CHART_POINTS`) stays until the wave-2 provenance gate exists; promo-flow's native renderer is a wave-2 card and is not designed here; publishing to the public mirror is a manual curated replay and is never a card step.
- Do not make network calls or paid model calls. Reading the sibling checkouts is fine.
- British English. No em dashes anywhere in the document.
- Where the design needs a decision only the operator can make, record it as a deferred open question with `owner: operator`; do not guess.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage.

Every command runs from the run worktree root. Baselines were run on `dev` at 0cd17d7 on 2026-10-19; the document does not exist there, so every command criterion is red on the base, as expected for a new deliverable. Judge each command by what it prints, not by its exit status: several pass by printing nothing or `0`, and `grep` then exits 1.

1. **The document exists.** Seat: verifier. Command: `test -s docs/design/content-contract-v2.md && echo present` prints `present`. Baseline: red (no output, exit 1).
2. **Required headings, exact and in order.** Seat: verifier. Command: `grep -nE '^## ' docs/design/content-contract-v2.md` lists `## Summary`, `## Current state`, `## Findings addressed`, `## Schema v2`, `## Dialects and generation`, `## Sharing with promo-flow`, `## What the promo-flow renderer needs`, `## Migration and rollback`, `## Tradeoffs`, `## Open questions`, `## Wave-2 cards` in that relative order (other headings may sit between them). Baseline: red (file absent).
3. **Every defect has a row.** Seat: verifier. Command: `for d in D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13; do grep -qE "^\| ${d} \|" docs/design/content-contract-v2.md 2>/dev/null || echo "missing: $d"; done` prints nothing. Baseline: red (prints all thirteen).
4. **Every listed question is present.** Seat: verifier. Command: `for q in Q1 Q2 Q3 Q4 Q5 Q6 Q7 Q8 Q9 Q10; do grep -qE "^[0-9]+\. \*\*${q}[^0-9]" docs/design/content-contract-v2.md 2>/dev/null || echo "missing: $q"; done` prints nothing. Baseline: red.
5. **Every open question is answered or deferred with an owner.** Seat: verifier. Command: `sed -n '/^## Open questions$/,/^## /p' docs/design/content-contract-v2.md | grep -E '^[0-9]+\. ' | grep -vE '\*\*(Answer|Deferred \(owner: [^)]+\)):\*\*'` prints nothing, and criterion 4 is green. Baseline: red (criterion 4 red).
6. **Wave-2 cards are complete.** Seat: verifier. Command: `python3 -I -c 'import re,sys;t=open(sys.argv[1]).read();s=t.split("\n## Wave-2 cards\n",1)[1].split("\n## ",1)[0];b=re.split(r"\n(?=### W[0-9]+\. )","\n"+s)[1:];bad=[x.splitlines()[0] for x in b if not all(k in x for k in ("- **Outcome:**","- **Files:**","- **Depends on:**"))];print("cards:",len(b),"incomplete:",bad)' docs/design/content-contract-v2.md` prints `cards: N incomplete: []` with N at least 5. Baseline: red (FileNotFoundError).
7. **Tradeoffs are stated.** Seat: verifier. Command: `sed -n '/^## Tradeoffs$/,/^## /p' docs/design/content-contract-v2.md | grep -cE '^[0-9]+\. '` prints at least 4, and `sed -n '/^## Tradeoffs$/,/^## /p' docs/design/content-contract-v2.md | grep -c 'Rejected:'` prints at least 4. Baseline: red.
8. **Migration has a rollback.** Seat: verifier. Command: `sed -n '/^## Migration and rollback$/,/^## /p' docs/design/content-contract-v2.md | grep -c '^.*Rollback:'` prints at least 1, and the section names the 49 live promo-flow explainers and the v1 reader. Baseline: red.
9. **Current state is cited from real code.** Seat: verifier. Command: `grep -oE '(src|scripts)/[A-Za-z0-9_./-]+:[0-9]+|skill\.md:[0-9]+' docs/design/content-contract-v2.md | sort -u | wc -l` prints at least 15. Then the verifier opens at least ten of those citations, chosen across both repos, and confirms each points at the code the document says it does (promo-flow citations are read in `../promo-flow`). Baseline: red.
10. **Style.** Seat: verifier. Command: `grep -c '—' docs/design/content-contract-v2.md` prints `0`. Spelling is British (the verifier reads for American spellings such as "normalize", "color" outside code identifiers). Baseline: red (file absent).
11. **Only the document changed.** Seat: verifier. Commands, run after the worker's commit: `git diff --name-only dev...HEAD` prints exactly `docs/design/content-contract-v2.md`, and `git status --porcelain -- ':!state'` prints nothing (no other uncommitted or untracked change; `state` is the orchestrator's symlink). Baseline: red (prints nothing).
12. **Each defect is genuinely resolved (verifier judgement).** Seat: verifier, by reading the document against the code. For each of D1 to D13 in the Surfacing concern (by its file:line), the design either removes the cause or names the wave-2 card that does; a row that only restates the defect fails. In particular: no executable or HTML-beyond-allowlist field survives in v2 (D1, D3, D13); exactly one chart representation remains (D9); every model-overwritten field is stamped, not generated (D5); the three dialects are generated, not hand-written (D7, D12). Dialect support is judged from the design's reasoning and the cited library documentation; nobody installs or runs the library in this stage.
13. **The wave-2 list is cardable (verifier judgement).** Seat: verifier. Each `Wn` card has one observable outcome with a command, files that exist today or are named as new, and dependencies that form no cycle. Together the cards cover: the zod source and generators, the `skill.md` block generation, the stamped-field move, the figure sidecar asset, the promo-flow shared contract and `parseExplainerJson()` entry point, and the v1 to v2 migration including the 49 live explainers.

## Contract test

<!--
Prose-only stage: the deliverable is a design document, so there is nothing executable to freeze. The acceptance criteria above carry the checks by command. -->

- **Test file:** None
- **Assertions digest:** None
- **Oracle proof:** None. This is a prose design stage with no executable surface; criteria 1 to 11 are shell checks against the document and were each run on `dev` at 0cd17d7 (all red because the document is absent), and criteria 12 and 13 are verifier judgement.

## Out of scope

- Any code, schema, prompt, test or dependency change in either repo. The wave-2 cards this document lists do that.
- Designing promo-flow's native renderer (components, styling, chart island internals). Only its needs from the contract are in scope.
- The chart value gate and its reject list (stage 19) and the figure locator pipeline (stage 18). This document defines the shapes they write into, and should not redesign them.
- The provider, route and orchestrator design (stage 17).
- The promo-flow security fixes (sanitiser, script escaping, iframe sandbox), which are wave-1 promo-flow cards.
- The `skill.md` style-section rewrite.

## Budget

- **Worker wall-clock:** 120 minutes
- **Verifier wall-clock:** 45 minutes
- **Spend basis:** Opus 5.5 worker; attempt 3 used 3.9M worker and 1.0M verifier tokens under Fable/Astra. This attempt edits the preserved attempt-3 document rather than rewriting it, so budget about 4M worker and 1.5M Sol verifier tokens.

## Dispatch envelope

Return the standard envelope with:
- `status`: pass or fail.
- `commit`: the commit SHA on `autometta/16-design-content-contract-v2` that adds the document, authored as `Claude Opus 5.5 <claude-opus-5-5@local>`.
- `deliverables`: `docs/design/content-contract-v2.md`.
- `evidence`: the output of acceptance commands 1 to 10 as you ran them before committing, and of command 11 after committing.
- `notes`: the Wn list (ids and slugs only), every question deferred to the operator, and any defect row you judged out of scope with the owning stage.

## Family-specific notes

None. The worker is a Claude role and reads the sibling checkouts directly. The verifier (Codex harness) runs under workspace-write, which permits reading `../promo-flow` and needs no network for any criterion.

## Re-brief 2026-10-20 (attempt 2)

Attempt 1 (WIP preserved at `a52eb33` on `wip/16-design-content-contract-v2-attempt-1`) passed every criterion except 12 (D5) and 13 (the wave-2 list is cardable). The verifier's findings are correct. The document is otherwise sound, so **do not rewrite it**: start from current `dev`, restore the attempt-1 document with `git checkout a52eb33 -- docs/design/content-contract-v2.md`, and fix only what follows. Line numbers below refer to the attempt-1 document.

1. **D5, one owner per field.** The draft makes the model emit exactly one reference unconditionally (`:378`), labels its fields model/detection (`:320-324`), then replaces it wholesale when detection succeeds (`:734`), while `:733` claims the model no longer emits it, and repair validates a `ModelOutputV2` that still requires it (`:733`, `:766`). That is today's generate-then-overwrite. Define the boundary once: which schema the model fills, which fields are stamped after it, what the model emits for the reference when detection has a value and when it does not, and what repair validates. No field may be both required of the model and overwritten by a stamp. The same rule applies to every stamped field (author, date, provider, route), not only the reference.
2. **Migration must produce a valid v2.** The stored schema requires `metadata.provider` and `metadata.route` (`:187-189`, `:235-247`), but migration omits them when unknown (`:597`), and 43 of the 49 live files carry no `run_mode`. Pick a truthful representation (for example an explicit `unknown` value or a `migrated_from_v1` provenance marker) so that every migrated file parses as `ExplainerV2`, and say so in the schema and the migration section.
3. **Each Wn outcome is satisfiable by its own Files and dependencies.** W7's grep outcome (`:790`) needs files that belong to W9 (`promo-flow/src/lib/explainer-to-html-core.mjs`, `promo-flow/src/components/explainers/ExplainerChartCanvas.tsx`), and W9 depends on W7. Fix the scope or the order.
4. **Order matches dependencies.** List the Wn cards in dependency order (W8 currently precedes its dependency W9, `:794-804`), and make the migration sequence (`:630-660`) agree: the archive rewrite cannot come before the baker it needs.
5. **Parallelism claims are true.** W4 and W5 are called disjoint (`:749-750`) but both claim `src/output.ts`, `docs/FIGURE-EXTRACTION.md` and `tests/unit/fixtures/` (`:773`, `:779`). Either make the claims disjoint or mark the pair serial. Check every other parallel claim the same way.
6. **Citation.** `:504-505` cites `promo-flow/src/app/api/admin/approve/[filename]/route.ts:90` for the JSON read; the read and parse are at `:73-74`, and `:90` calls `renderExplainerToHtml(json)`.

**Self-audit before returning.** For every Wn card, check (a) its outcome command can pass after only its own Files change on top of its dependencies, (b) every dependency appears earlier in the list, (c) every parallel pair has disjoint Files. Quote the audit as a table in the envelope's `notes`.

All other deliverables, constraints and acceptance criteria stand. Cards 17, 18 and 19 may already be reading this document; if a fix changes a field or name that stage 19 relies on (the v2 chart shape and `source`), keep the name stable or record the rename in Open questions.

## Re-brief 2026-10-20 (attempt 4, supersedes the attempt-2 restore step)

Attempt 3 (WIP preserved at `5142989` on `wip/16-design-content-contract-v2-attempt-3`) passed every criterion except 12 (D5). **Start from attempt 3, not attempt 1:** from current `dev`, run `git checkout 514298943f543f3c047fe41c40fec613e6ef06d6 -- docs/design/content-contract-v2.md` and fix only what follows. Do not rewrite the document. The attempt-2 instructions above are already applied in that file. Line numbers refer to the attempt-3 document.

1. **Wire nulls survive validation and repair.** `:405` makes `onWire.opt` nullable and `:426-440` makes `citation` a required nullable property, but Q6 (`:861`) drops nulls *before* validating with `modelOutputValidator`. A compliant detected-reference response (`citation: null`, per Q7 at `:862`) then fails the required-property check and triggers repair for a field the harness owns. Reorder: validate and repair the model output with its wire nulls intact, and strip nulls only when composing the stored artefact. The null-strip today is `src/output.ts:139-153`.
2. **Canonicalise an ignored citation before validation.** When detection owns the reference, set the model's `citation` to `null` before validation, so a malformed citation the harness will discard cannot trigger repair.
3. **One story everywhere.** The schema section, Q6, Q7, D5's row (`:191`) and the pipeline description must describe the same order: canonicalise, validate/repair with nulls, stamp, strip nulls, store. Check every other stamped field (author, date, provider, route) against the same order.

All other deliverables, constraints and acceptance criteria stand. Keep the names stage 19 relies on (the v2 chart shape and `source`) stable.
