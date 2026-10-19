# Stage card 18-design-figure-locator: figures are located deterministically and a vision model only picks a number

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Fable 5.1 <claude-fable-5-1@local>
- **Verifier:** GPT-6 Astra <gpt-6-astra@local>
- **Base branch:** dev
- **Run branch:** autometta/18-design-figure-locator
- **Worker effort:** xhigh
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** docs/design/figure-locator.md
- **Pairing rationale:** The figure pipeline replaces most of a 1,222-line module, and its design choices (which tool finds which region) decide whether wave 2 works, so it gets the design tier (Fable 5.1, reserved for the four design cards). The verifier is from the other family (GPT-6 Astra) and is judgement-capable, which a prose stage needs; it can also re-run the poppler commands the evaluation set relies on. The four design cards (16 to 19) share this pairing; they claim disjoint paths, so they do not alternate worker family.
- **Open decisions:** none

## Surfacing concern

The 2026-10-19 review found that figure picks fail because a second, less-informed model chooses the figure and then guesses its coordinates. The synthesis model, which read the paper, is told never to name a figure. A vision model then picks from 820px thumbnails, is steered away from results plots, and guesses crop boxes as fractions of the page. A refine pass, a pad ladder, a full-width fallback and verify calls have built up around that guessing, and a pinned figure is stamped with its label whatever was cropped. Confirmed case: in `output/2026-07-31_demirer_writing-code-shipping-code_explainer.json` (gitignored, in the main checkout) the image is labelled "Figure 1", pinned through the `recreate: Figure 1` directive in `input/_held/w35275.focus.md` (a recreation target also pins the image pick, `src/output.ts:280-285`), but the pixels are Figure 3. `pdftotext` puts the "Figure 1:" caption on PDF page 5 and "Figure 3: The Software Production Hierarchy" on page 12 of `input/_held/w35275.pdf` (checked 2026-10-19). Wave 2 will be carded from this design document.

Defects this design must answer. Line numbers were re-checked against `dev` at 0cd17d7 on 2026-10-19; wave-1 cards (reversing the results-plot steer, label-aware verify, per-page crop size, PDF-URL download, `image_*` overrides, a separate vision model) may change some of this code before you run, so read your own base and describe what is there.

| Id | Where | Defect |
|---|---|---|
| D1 | `src/figure-vlm.ts:632-637`, `:682`, `:1054`, `:1164` | A pinned label is stamped on whatever was cropped; the drift guard fires only when the model reports a different label. |
| D2 | `src/figure-vlm.ts:321-353`, `:932-964` | Verification is not told which figure was wanted, passes on an unparseable reply (:345) and on a transport error (:350-353); the snapshot path skips it. |
| D3 | `skill.md:58`; `src/prompt.ts:25`; `src/figure-vlm.ts:101`, `:199`, `:540-551` | The synthesis model may not name the figure (and `prompt.ts` contradicts `skill.md`); the vision model picks from up to 24 thumbnails at 820px and writes the caption before any crop exists. |
| D4 | `src/figure-vlm.ts:146-155`; `src/output.ts:288-290` | Selection is steered away from the paper's results plot towards a "conceptual" figure because model-written charts "already recreate" the results. |
| D5 | `src/figure-vlm.ts:197`, `:512`, `:640-669` | The vision model guesses normalised float boxes; the pad ladder and full-width fallback pull in the next column's text. |
| D6 | `src/figure-vlm.ts:465-466`, `:579-587` | `pdfinfo` runs without `-f/-l`, so page 1's size is used for every page, and `/Rotate` is ignored. |
| D7 | `src/output.ts:160-171`; `src/preprocess.ts:568`, `:582`; `src/figure-vlm.ts:1216` | arXiv PDF URLs stay `kind: 'url'`, `resolveSourcePdf` returns null for `explainer-url-*`, and Playwright is pointed at a PDF. |
| D8 | `src/figure-vlm.ts:236-237`; `src/vision.ts:222-232` | The vision model follows `MODEL_BATCH`/`MODEL`, while the vision provider is chosen separately from ambient credentials; mismatches are swallowed (:265-267). |
| D9 | `src/figure-vlm.ts:767-774`; `src/preprocess.ts:214` | De-duplication by intersection over the smaller area (at least 0.85) always drops a multi-panel `<figure>` wrapper; the HTML parser takes only the first `<img>`. |
| D10 | `src/figure-vlm.ts:413`, `:759` | `[class*="graph" i]` matches `paragraph` and `typography`. |
| D11 | `src/preprocess.ts:116-118` | `image_page_hint`, `image_caption` and `image_alt` are dropped unless `image:` is present. |
| D12 | `src/figure-vlm.ts:100`, `:606` | Only the first 24 pages are scanned; `w35275.pdf` has 97. |
| D13 | `src/figure-vlm.ts:881-883` | `figureLabelKey` compares only the number, so "Table 4" equals "Figure 4" and panel letters break matches. |
| D14 | `src/vision.ts:31-33`; `src/figure-vlm.ts:920-964` | webp, gif and svg assets are sent labelled as png; the downscaled send copy is the one encoded. |
| D15 | `src/figure-vlm.ts:1087-1116` | The full-page URL fallback resizes the viewport after measuring, reflowing the page. |
| D16 | `src/figure-vlm.ts:617-669`, `:234` | Up to about 12 synchronous frontier vision calls per paper, never on the batch discount. |
| D17 | `src/output.ts:302-308` | The crop is stored as a base64 `data:` URL inside the JSON instead of a sidecar asset. |

Cold read on 2026-10-19 by the other family (Codex, codex-cli 0.163.0, read-only sandbox) over all four design cards; its questions, verifier-seat gaps and line corrections are folded into this card. This is a prose stage, so it has no contract test (see Contract test). The acceptance criteria are written to be checked by command wherever a command can check them.

## Objective

Write `docs/design/figure-locator.md`: the design for a deterministic-first figure pipeline in which the synthesis model names the lead figure, code locates it, and a vision model is used only to pick among numbered candidate regions. The document ends with a numbered list of wave-2 cards precise enough to card from directly.

The ladder, from the review (section 2b). Refine it; any departure is a tradeoff entry.

1. The synthesis output (already in the 50%-off batch request) names `lead_figure.label` (for example `Figure 3`) and `why`, and writes the caption, so the choice rides the batch discount. The field lives in the v2 contract (stage 16 owns its shape; report section 3 has `lead_figure {label, caption, alt_text, asset, page, provenance}` with `provenance: arxiv-source | pdf-embedded | pdf-vector-crop | dom-asset | vlm-crop`).
2. arXiv id: the e-print source's `\includegraphics` files for the figure whose `\caption` or `\label` matches, or the `arxiv.org/html/<id>` `<figure>` assets.
3. PDF: find the caption line with `pdftotext -bbox-layout` (page and y position), take the image and vector-path extents next to it, and crop at 300dpi in that page's own pixel space.
4. HTML: the DOM `<figure>`, de-duplicated by IoU, preferring a wrapper with more than one image child.
5. Only then a vision model, choosing a number among candidate regions drawn on the known page. Every provider, including the codex CLI, can reliably pick a number.

## Inputs (read these in your own context)

- `src/figure-vlm.ts` (all 1,222 lines; the deletion map needs every function), `src/vision.ts`, `src/output.ts` (`attachFigureImage`, `resolveSourcePdf`, `resolveSourceUrl`, around lines 160-330), `src/preprocess.ts` (focus directives around lines 60-130, HTML figure candidates around lines 200-240, URL handling around lines 500-600), `src/prompt.ts`, `skill.md` (the `image` rules)
- `docs/FIGURE-EXTRACTION.md` (current design and its stated caveats), `scripts/reextract-figure.ts`, `input/.focus.md.example`
- The evaluation material is gitignored and lives only in the main checkout, the run worktree's sibling: `../explainer-batch/input/_held/` (`w35275.pdf` with `w35275.focus.md`; `2410.15332v3.pdf`, the EPIC paper on arXiv, with its focus file; `flyvbjerg-it-cost-risk.pdf` with its focus file), `../explainer-batch/input/urls.txt` (one Anthropic research URL), and past picks in `../explainer-batch/output/` and `../explainer-batch/output.local/`.
- Local tools: `pdftotext`, `pdfimages`, `pdftoppm` and `pdfinfo` (poppler 26.07 is installed). Run them on the held PDFs to check what each actually reports; for example, check whether `pdfimages -list` gives page positions or only sizes before relying on it.
- Optional, read-only network use, and nothing else: the arXiv HTML render at arxiv.org/html/2410.15332v3 and the arXiv e-print listing for that id (to confirm the HTML `<figure>` structure and the source layout), the page in `input/urls.txt`, and arXiv PDFs for the unpinned evaluation cases.

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified. Paths are relative to repo root.

1. `docs/design/figure-locator.md`: the design document. It must contain these second-level headings, spelled exactly, in this order (extra headings and third-level subsections are welcome):
   - `## Summary`
   - `## Current state`: how a figure is chosen, located, cropped, verified and stored today, citing code as `path:line`.
   - `## Findings addressed`: a Markdown table with one row per defect id D1 to D17, each row starting `| Dn |`, saying how the design resolves it (or which card owns it).
   - `## Pipeline`: the ladder end to end, its stop rules, and when the answer is "no figure" (for a pin, no figure is better than a wrong one).
   - `## Synthesis names the figure`: the `lead_figure.label` and `why` fields the synthesis output carries, how the caption is written, and the prompt change in `skill.md` and `src/prompt.ts` (describe it; do not edit them).
   - `## arXiv source`: e-print versus `arxiv.org/html`, matching `\caption`/`\label`, multi-file and sub-figure panels, format conversion (pdf, eps, png), caching, and what happens when the network is unavailable at collect time.
   - `## PDF caption locator`: the caption regex and its noun and number parsing (Figure versus Table, panel letters), page selection without a page cap, how image and vector extents are found (name the tool and what it reports), the region between caption and body text, two-column pages, rotation, and the 300dpi crop in the rendered page's pixel space.
   - `## HTML figures`: DOM `<figure>` candidates, IoU de-duplication with its threshold, wrapper preference, class-token matching, image type detection, and screenshot clipping without a viewport resize.
   - `## Vision picker`: numbered candidate overlays, the prompt contract (return a number), which model tier it uses (the vision tier designed in stage 17), how many calls at most per paper, deterministic checks before any vision verify, and failing closed for pins.
   - `## Output and provenance`: the sidecar asset file, its naming, the `provenance` value per ladder step, and what is recorded for a run that found no figure.
   - `## Deletion map`: a table covering every top-level function in `src/figure-vlm.ts` with its line range and a verdict (keep, move, rewrite, delete), and the total lines deleted.
   - `## Evaluation set`: the papers and URLs, each with its expected pick (label and PDF page), the ladder step expected to find it, and pass criteria; see Q11.
   - `## Migration and rollback`: how the new locator lands beside the current one (for example behind a setting) and replaces it, re-extraction of existing outputs, and a line starting `Rollback:` for each step.
   - `## Tradeoffs`: a numbered list, at least four entries, each with a line containing `Rejected:`.
   - `## Open questions`: a numbered list including Q1 to Q12 below, each item starting `N. **Qk**`, every item carrying `**Answer:**` or `**Deferred (owner: <stage id or operator>):**`. Further questions go in as Q13 onwards under the same rule.
   - `## Wave-2 cards`: each as `### Wn. <slug>` followed by `- **Outcome:**` (one observable outcome and the command that shows it), `- **Files:**`, `- **Depends on:**` (other Wn ids, or `none`). At least five cards, dependencies first, noting which can run in parallel and which depend on stage 16 or 17 work.

Questions the document must settle (Q1 to Q12):

- **Q1** The order of the ladder and whether arXiv source is tried before the PDF even when a local PDF exists.
- **Q2** arXiv e-print versus `arxiv.org/html`: which is primary, how `\includegraphics` paths and sub-figures are resolved, and how vector sources (pdf, eps) become a raster asset.
- **Q3** How image and vector extents are found on a PDF page. `pdfimages -list` may not report page positions; name the tool that does (for example `pdftohtml -xml`, `pdftocairo -svg`, or the pdf.js operator list) and its dependency cost.
- **Q4** The region rule between a caption and the nearest body text, including figures with captions above, full-width figures on two-column pages, and figures split across pages.
- **Q5** IoU threshold and wrapper preference for HTML figures, and whether `preprocess.ts`'s regex figure parser survives once the DOM path exists.
- **Q6** The vision picker's prompt and output contract, its candidate cap, its model tier, and its fail-closed rule for pins.
- **Q7** What the synthesis model emits (`label`, `why`, caption, alt text), what happens when its label is not found by any step, and whether a second choice is allowed.
- **Q8** How sidecar overrides (`image:`, `image_page_hint:`, `image_caption:`, `image_alt:`) behave in the new pipeline, and whether a pin still exists separately from the synthesis choice.
- **Q9** Where the locator runs (at collect, inside the stage-17 orchestrator's finalise step) and how a re-run of one figure works without re-running synthesis.
- **Q10** Image handling dependencies: `sharp` versus macOS `sips` (Linux portability), and whether Playwright is still needed for anything but HTML sources.
- **Q11** The evaluation set's storage: the PDFs are gitignored and some are not redistributable, so say what wave-2 tests commit (for example `pdftotext -bbox-layout` snapshots and small crops) and what runs only locally.
- **Q12** How `recreated_figure` and the `recreate:` directive relate to `lead_figure` once stage 16's v2 contract has one chart representation (coordinate with stage 16; do not redesign the chart shape).

The evaluation set must include at least these, with the expected pick filled in from the PDFs themselves:

- `input/_held/w35275.pdf`: Figure 1 on PDF page 5, pinned through `recreate: Figure 1` rather than an `image:` line (the confirmed wrong-figure case; Figure 3 is on page 12). 97 pages, so it also exercises the 24-page cap.
- `input/_held/2410.15332v3.pdf`: pinned Figure 4 on page 5, a full-width multi-panel figure whose only large embedded image is the heatmap strip (an earlier crop got only that panel). Also on arXiv, so it exercises the e-print or HTML step, and as an `arxiv.org/pdf/` URL it exercises the PDF-URL case.
- `input/_held/flyvbjerg-it-cost-risk.pdf`: pinned Figure 3 on page 9 (CCDF curves).
- The URL in `input/urls.txt`: the HTML DOM path. The worker may load that page read-only to establish the expected pick; record the evidence (the `<figure>` count and the chosen figure's caption) in the document.
- At least two unpinned cases, with the expected pick and why: either the held PDFs taken without their pins (what the synthesis model should choose unprompted), or arXiv papers from `../explainer-batch/output.local/`, whose PDFs the worker may download read-only into a scratch directory outside the repo. Each case states its evidence source.

## Constraints

- Design only. Write no code under `src/`, `scripts/` or `tests/`, change no dependency, and edit no file other than the document. Do not edit `skill.md` or `src/prompt.ts`; describe the change.
- Cite the current state as `path:line` against the code you actually read. Every defect row cites at least one location.
- Run poppler commands on the held PDFs to support the design's claims about what each tool reports, and quote the command and a short excerpt of its output in the document where a claim depends on it. Do not copy PDF pages or crops into the repo.
- No paid model calls. The only network use allowed is the optional read-only fetches listed in Inputs.
- Respect operator decisions already made: batch and subscription runs stay first-class; the 6-point chart filter stays until the wave-2 provenance gate exists; publishing is a manual curated replay and never a card step.
- British English. No em dashes anywhere in the document.
- Where the design needs a decision only the operator can make, record it as a deferred open question with `owner: operator`.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage.

Every command runs from the run worktree root. Baselines were run on `dev` at 0cd17d7 on 2026-10-19; the document does not exist there, so every command criterion is red on the base, as expected for a new deliverable. Judge each command by what it prints, not by its exit status: several pass by printing nothing or `0`, and `grep` then exits 1.

1. **The document exists.** Seat: verifier. Command: `test -s docs/design/figure-locator.md && echo present` prints `present`. Baseline: red.
2. **Required headings, exact and in order.** Seat: verifier. Command: `grep -nE '^## ' docs/design/figure-locator.md` lists `## Summary`, `## Current state`, `## Findings addressed`, `## Pipeline`, `## Synthesis names the figure`, `## arXiv source`, `## PDF caption locator`, `## HTML figures`, `## Vision picker`, `## Output and provenance`, `## Deletion map`, `## Evaluation set`, `## Migration and rollback`, `## Tradeoffs`, `## Open questions`, `## Wave-2 cards` in that relative order. Baseline: red.
3. **Every defect has a row.** Seat: verifier. Command: `for d in D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13 D14 D15 D16 D17; do grep -qE "^\| ${d} \|" docs/design/figure-locator.md 2>/dev/null || echo "missing: $d"; done` prints nothing. Baseline: red.
4. **Every listed question is present.** Seat: verifier. Command: `for q in Q1 Q2 Q3 Q4 Q5 Q6 Q7 Q8 Q9 Q10 Q11 Q12; do grep -qE "^[0-9]+\. \*\*${q}[^0-9]" docs/design/figure-locator.md 2>/dev/null || echo "missing: $q"; done` prints nothing. Baseline: red.
5. **Every open question is answered or deferred with an owner.** Seat: verifier. Command: `sed -n '/^## Open questions$/,/^## /p' docs/design/figure-locator.md | grep -E '^[0-9]+\. ' | grep -vE '\*\*(Answer|Deferred \(owner: [^)]+\)):\*\*'` prints nothing, and criterion 4 is green. Baseline: red.
6. **Wave-2 cards are complete.** Seat: verifier. Command: `python3 -I -c 'import re,sys;t=open(sys.argv[1]).read();s=t.split("\n## Wave-2 cards\n",1)[1].split("\n## ",1)[0];b=re.split(r"\n(?=### W[0-9]+\. )","\n"+s)[1:];bad=[x.splitlines()[0] for x in b if not all(k in x for k in ("- **Outcome:**","- **Files:**","- **Depends on:**"))];print("cards:",len(b),"incomplete:",bad)' docs/design/figure-locator.md` prints `cards: N incomplete: []` with N at least 5. Baseline: red.
7. **Tradeoffs are stated.** Seat: verifier. Command: `sed -n '/^## Tradeoffs$/,/^## /p' docs/design/figure-locator.md | grep -cE '^[0-9]+\. '` prints at least 4 and `sed -n '/^## Tradeoffs$/,/^## /p' docs/design/figure-locator.md | grep -c 'Rejected:'` prints at least 4. Baseline: red.
8. **Migration has a rollback.** Seat: verifier. Command: `sed -n '/^## Migration and rollback$/,/^## /p' docs/design/figure-locator.md | grep -c 'Rollback:'` prints at least 1. Baseline: red.
9. **Current state is cited from real code.** Seat: verifier. Command: `grep -oE '(src|scripts)/[A-Za-z0-9_./-]+:[0-9]+|skill\.md:[0-9]+' docs/design/figure-locator.md | sort -u | wc -l` prints at least 20. The verifier then opens at least ten of those citations and confirms each points at the code the document says it does. Baseline: red.
10. **The deletion map covers the module.** Seat: verifier. Command: `grep -cE '^(export )?(async )?function ' src/figure-vlm.ts` gives the function count F (40 on the base); the `## Deletion map` table has a row naming each of those F functions, checked with `for f in $(grep -oE '^(export )?(async )?function [A-Za-z0-9_]+' src/figure-vlm.ts | awk '{print $NF}'); do sed -n '/^## Deletion map$/,/^## /p' docs/design/figure-locator.md | grep -q "\b$f\b" || echo "missing: $f"; done`, which prints nothing. Baseline: red (prints every function).
11. **The evaluation set names its cases.** Seat: verifier. Command: `for k in w35275 2410.15332 flyvbjerg urls.txt; do sed -n '/^## Evaluation set$/,/^## /p' docs/design/figure-locator.md | grep -q "$k" || echo "missing: $k"; done` prints nothing. Baseline: red.
12. **Style.** Seat: verifier. Command: `grep -c '—' docs/design/figure-locator.md` prints `0`. Spelling is British outside code identifiers. Baseline: red (file absent).
13. **Only the document changed.** Seat: verifier. Commands, run after the worker's commit: `git diff --name-only dev...HEAD` prints exactly `docs/design/figure-locator.md`, and `git status --porcelain -- ':!state'` prints nothing (no other uncommitted or untracked change; `state` is the orchestrator's symlink). Baseline: red (prints nothing).
14. **Each defect is genuinely resolved (verifier judgement).** Seat: verifier, reading the document against the code. For each of D1 to D17 in the Surfacing concern (by its file:line), the design removes the cause or names the wave-2 card that does; a row that only restates the defect fails. In particular: the synthesis model names the figure (D3, D16); no step asks a model for coordinates (D5); a pin is located by its caption in the text layer and fails closed (D1, D2); crops use the rendered page's own pixel space (D6).
15. **The evaluation set is real (verifier judgement).** Seat: verifier. For the three held PDFs, the verifier runs `pdftotext -f <page> -l <page> -layout <pdf> - | grep -n '<label>'` against the main checkout's `../explainer-batch/input/_held/` and confirms each expected pick's caption is on the page the document states. Each case states the ladder step expected to find it. For the URL and the unpinned cases, which the verifier cannot re-check offline unless their PDFs are local, it checks that each states its evidence and that the evidence supports the pick.
16. **The wave-2 list is cardable (verifier judgement).** Seat: verifier. Each `Wn` card has one observable outcome with a command, real or named-new files, and acyclic dependencies; together they cover the synthesis `lead_figure` field and prompt change, the PDF caption locator with crops, the arXiv source step, the HTML de-duplication fix, the numbered vision picker, the sidecar asset, the evaluation harness, and the deletion of the replaced code.

## Contract test

<!--
Prose-only stage: the deliverable is a design document, so there is nothing executable to freeze. The acceptance criteria above carry the checks by command. -->

- **Test file:** None
- **Assertions digest:** None
- **Oracle proof:** None. This is a prose design stage with no executable surface; criteria 1 to 13 are shell checks against the document and were each run on `dev` at 0cd17d7 (all red because the document is absent), and criteria 14 to 16 are verifier judgement.

## Out of scope

- Any code, prompt, dependency or test change. The wave-2 cards this document lists do that.
- The v2 contract's field shapes (stage 16), the provider and vision-tier plumbing (stage 17) and the chart value gate (stage 19). Reference them; do not redesign them.
- Re-running figure extraction on any paper or writing new outputs.
- promo-flow's figure rendering.

## Budget

- **Worker wall-clock:** 120 minutes
- **Verifier wall-clock:** 45 minutes
- **Spend basis:** Fable 5.1 worker median 11M tokens per design card in the promo-flow cost log; Astra verifier median 2.6M tokens. The full read of `src/figure-vlm.ts` plus poppler experiments puts the worker at or slightly above the median.

## Dispatch envelope

Return the standard envelope with:
- `status`: pass or fail.
- `commit`: the commit SHA on `autometta/18-design-figure-locator` that adds the document, authored as `Claude Fable 5.1 <claude-fable-5-1@local>`.
- `deliverables`: `docs/design/figure-locator.md`.
- `evidence`: the output of acceptance commands 1 to 12 as you ran them before committing, and of command 13 after committing.
- `notes`: the Wn list (ids and slugs only), every question deferred to the operator, the lines-deleted total from the deletion map, and any wave-1 change you found on your base that altered a defect in the table.

## Family-specific notes

None. The worker is a Claude role and may make the optional read-only fetches listed in Inputs. The verifier (Codex harness) runs under workspace-write, which permits reading the main checkout's gitignored `input/_held/` through `../explainer-batch` and running poppler; no criterion needs the network.
