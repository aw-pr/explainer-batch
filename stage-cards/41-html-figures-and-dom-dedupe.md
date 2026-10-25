# Stage card 41-html-figures-and-dom-dedupe: a web page's figures are found by their own labels and assets, with true IoU de-duplication

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/41-html-figures-and-dom-dedupe
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/preprocess.ts, src/state.ts, src/figure-locator/dom-figures.ts, tests/unit/dom-figures.test.ts, tests/fixtures/figure-locator/anthropic-expertise/
- **Pairing rationale:** A regex snapshot parser shared with the live legacy path, a persisted state type, an in-page Playwright extraction and a de-duplication rule, where one careless change silently alters what the legacy figure path fetches today; that calls for a strong Claude worker at high effort, without the frontier tier the design does not need. The verifier is the cheap OpenAI tier from the other family at high effort, to re-run the legacy contract tests and judge the regression fields. No gate: it reads card 40's contract fixture (committed with card 40, not built by its worker) and builds on cards 26 and 28's landed modules. It claims `src/preprocess.ts`, which card 42 also edits, so card 42 is gated on this card and serial; no other tranche-2 figure card overlaps. Worker families alternate (card 40 has an OpenAI worker, card 42 an OpenAI worker).
- **Open decisions:** none

## Surfacing concern

Wave 2 of the figure redesign, card W6 of `docs/design/figure-locator.md` (`### W6. html-figures-and-dom-dedupe`; the rules are `## HTML figures`, `### Evidence` and `### Design`). Today the snapshot parser `parseFigureCandidates` (`src/preprocess.ts:220-264`) records only the first `<img>` of each `<figure>` and a figure label only from the caption text (`parseSourceFigureLabel`, `:207-210`), so the Anthropic research page's labels (held in a CSS custom property, `--figure-label:"Figure 5"`) are never seen and a pin cannot match, and the arXiv render's `<object data="*.svg">` figures are dropped. Its fallback pass matches any class containing the letters `figure` (`:246`), and the live path's selector matches `class*="graph"`, so `paragraph` and `typography` wrappers count (design D10; `src/figure-vlm.ts:426`, `:775`). The live path collapses near-overlaps by intersection over the smaller area at 0.85 (`src/figure-vlm.ts:786-790`), which is 1.0 for every nested element, so a two-panel `<figure>` always loses to its first child (D9), and it resizes the viewport after measuring (`:1151`, D15). This card extends the snapshot parser, adds the new DOM module with true IoU at 0.7 and wrapper preference, and keeps every field the legacy path reads exactly as it is. Nothing calls `fromSnapshot` or `fromLivePage` from the pipeline until W8. Lines re-checked against `dev` at `8bb4372` on 2026-10-21.

**Why `imgSrc` stays as it is.** The legacy snapshot path (`extractFromSnapshot`, `src/figure-vlm.ts:936-1004`, reached from `attachFigureImage` through `resolveFigureCandidates`, `src/output.ts:241-249`) fetches `imgSrc` and pins on `sourceFigure`. Changing either would change today's figures before W8 switches the locator on. So `imgSrc`, `figcaption`, `alt` and `sourceFigure` keep today's values for every figure today's parser records (the Anthropic `imgSrc` keeps its `/_next/image` wrapper and its literal `&amp;`), and the new data goes in two new optional fields, `label` and `sources`. A figure that today's parser skips because it has no `<img>` (an arXiv `<object data>` SVG) is now recorded with `imgSrc: ''`: the legacy `fetch('')` rejects inside its `try`, so the legacy path drops it exactly as it never saw it.

The fixtures were fetched by the orchestrator on 2026-10-21 (the worker has no network): `tests/contract/fixtures/41-html-figures-and-dom-dedupe/anthropic-expertise.html` is the research page trimmed to its hero image and eight `<figure>` elements, verbatim, with all prose removed; `sources.html` and `wrappers.html` are synthetic; the arXiv render is card 40's `tests/contract/fixtures/40-arxiv-source-step/html.html`. The design names `tests/fixtures/figure-locator/hu-2410.15332v3/html.html` as shared with W5; it is not created, because the orchestrator committed the render once as card 40's contract fixture and both cards read it there.

Cold read: see the note at the end of `## Family-specific notes`.

## Objective

`parseFigureCandidates` records every `<figure>` with an asset, labelled from its caption text, `--figure-label`, `aria-label`, LaTeXML id or `data-label`, with every asset URL unwrapped in `sources`, and falls back to whole-token class wrappers only on a page with no `<figure>`; `src/figure-locator/dom-figures.ts` de-duplicates live candidates by true IoU at 0.7 with wrapper preference, returns a labelled snapshot asset as fetched with its sniffed type and no vision call, and finds the same on a live page without resizing the viewport.

## Inputs (read these in your own context)

- `docs/design/figure-locator.md` (`## HTML figures`, `### Stop rules`, `### W6. html-figures-and-dom-dedupe`)
- `src/preprocess.ts` (lines 180-264 only: `extractTagAttr`, `resolveImgSrc`, `parseSourceFigureLabel`, `parseFigureCandidates`) and `src/state.ts` (lines 12-24, `FigureCandidate`)
- `src/figure-locator/label.ts` and `src/figure-locator/asset.ts` (landed by cards 26 and 28)
- `src/figure-vlm.ts` (lines 402-408, 718-801 and 936-1116 only: `intersectionOverUnion`, `loadPlaywright`, `renderReady`, `markFigureCandidates`, the snapshot and live paths; read, do not edit)
- `tests/contract/41-html-figures-and-dom-dedupe.test.ts` (frozen), `tests/contract/fixtures/41-html-figures-and-dom-dedupe/` and `tests/contract/fixtures/40-arxiv-source-step/html.html`

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test and its fixtures, which already exist and must not be edited. Paths are relative to repo root.

1. `src/state.ts`: `FigureCandidate` keeps `imgSrc: string` (required) and its other fields, and gains `label?: string` (a `formatLabel` string such as `Figure 5`, `Table 1`, `Figure 2b`) and `sources?: string[]`.
2. `src/preprocess.ts`, `parseFigureCandidates(raw, pageUrl)` (the cap of 20 and the signature stay):
   - **Figures first.** Every `<figure ...>...</figure>` in document order becomes a candidate when it has at least one source; one with none is skipped. When the page contains any `<figure` tag, nothing else is a candidate (so a bare hero `<img>` outside a figure never is).
   - **Sources**, in this order, each resolved against `pageUrl`, HTML-entity decoded (`&amp;`), with a `/_next/image?url=<encoded>` wrapper unwrapped to the decoded inner URL, and recorded once (first occurrence wins): for each `<img>`, its `src` (or `data-src`, `data-original`) then its largest `srcset`/`srcSet` entry (by `w` descriptor, else `x`, an entry with no descriptor counting as `1x`); then each `<picture><source srcset>`'s largest entry; then each `<object data>`.
   - **Label**, the first that parses with `parseLabel`, stored as `formatLabel`: the figcaption text (tags stripped); the `--figure-label:"..."` custom property in a `style` attribute (`&quot;` decoded), the figure's own first, then the figcaption's; the figure's `aria-label`; a LaTeXML id on the figure (`S<sec>.F<n>`, `A<k>.F<n>` give `Figure <n>`, `.T<n>` gives `Table <n>`); the figure's `data-label`. No key when none parses.
   - **Legacy fields unchanged:** `imgSrc` is exactly what today's `resolveImgSrc` gives for the figure's first `<img>` (no unwrapping, no entity decoding), or `''` when there is no `<img>` or that gives nothing (a `srcset`-only image); `figcaption`, `alt` and `sourceFigure` are computed as today.
   - **Wrappers, only on a page with no `<figure>`:** a `div`, `span` or `section` whose `class`, split on whitespace and hyphens and lower-cased, has a token equal to `chart`, `figure`, `graph` or `plot`, with an `<img>` in the following 2,000 characters, as today's window; `typography`, `paragraph` and `prefigured` do not match. These candidates get `sources` and `label` by the same rules.
   - De-duplication across candidates is by `imgSrc`, or by the first source when `imgSrc` is empty.
3. `src/figure-locator/dom-figures.ts` (new), exporting:
   - `intersectionOverUnion(a, b)` on `{ x, y, w, h }` boxes (moved from `src/figure-vlm.ts:402-408`; the legacy copy stays).
   - `dedupeDomCandidates(boxes: DomBox[]): DomBox[]`, with `DomBox { key; tag; x; y; w; h; parent?: string /* key of the enclosing figure */; label?; caption? }`. Rules, in order: a `figure` box with two or more children (boxes whose `parent` is its key) is kept and its children dropped; a `figure` box with exactly one child is dropped and the child kept, taking the figure's `label` and `caption` when it has none of its own; then, visiting the remaining boxes from smallest area to largest, a box whose IoU with an already kept box is at least 0.7 is dropped (so the smaller of a near-duplicate pair stays); boxes under 0.7 are all kept. The result is in document order (`y`, then `x`).
   - `loadPlaywright()` and `renderReady(page)` (moved from `src/figure-vlm.ts:718-752`; the legacy copies stay).
   - `fromSnapshot(candidates, want: LabelKey, opts: { fetchBytes? })`: the first candidate whose `label` parses equal to `want` (`labelsEqual`); none gives `{ ok: false, reason: 'label-not-found', labels }` with every candidate label in order. Its `sources` (or `[imgSrc]` for a candidate persisted before this card) are fetched in order with `fetchBytes(url): Promise<Buffer>` (default: `fetch` with a 15 second timeout, throwing on a non-2xx status) until one sniffs as an image with `sniffImageType`; a throw or non-image bytes moves to the next source; none gives `{ ok: false, reason: 'source-unavailable' }`. Success is `{ ok: true, label, bytes, ext, width?, height?, provenance: 'dom-asset', source, captionText?, notes }` with the original bytes, `width`/`height` from `imageSize` and absent (not `undefined`) for SVG, `source` the URL that worked and `captionText` the figcaption. No vision call is ever made.
   - `fromLivePage(url, want, opts: { fetchBytes? })`: Playwright Chromium at a 1280 by 1600 viewport with device scale 2, `renderReady`, then in-page extraction of `<figure>` elements (or, on a page with none, `picture`, `svg`, `canvas`, `img` and whole-token class wrappers) with their child image, `svg`, `canvas` and `object` boxes, the same label sources and their asset URLs; `dedupeDomCandidates`; the label match as in `fromSnapshot`, with the same `label-not-found` result; the asset fetched from the match's sources (or its children's, for a figure reduced to its image); and only when nothing fetches, `locator.screenshot()` of the matched element at the measured viewport, returned as `ext: 'png'` with `source: 'screenshot'`. Never `setViewportSize`. Playwright missing, a launch failure or a navigation error gives `source-unavailable`.
4. `tests/unit/dom-figures.test.ts` (new): the snapshot parser on the committed trimmed Anthropic page (8 candidates labelled Figure 1, Figure 2, Table 1, Figure 3, Figure 4, Table 2, Figure 5, Figure 6, with unwrapped CDN URLs), on the arXiv render (`<object data>` SVG candidates labelled from their captions, `S4.F4` among them), and the IoU rule (a two-image wrapper kept over its children, the image box for a one-image wrapper).
5. `tests/fixtures/figure-locator/anthropic-expertise/page.html` (new): a byte-for-byte copy of `tests/contract/fixtures/41-html-figures-and-dom-dedupe/anthropic-expertise.html`. The unit test reads the arXiv render from `tests/contract/fixtures/40-arxiv-source-step/html.html` (read only).

## Constraints

- `imgSrc`, `figcaption`, `alt` and `sourceFigure` keep today's values for every `<figure>` candidate today's parser records; `imgSrc` stays a required string. Wrapper candidates change by design (whole tokens, and none on a page with a `<figure>`).
- `src/figure-vlm.ts`, `src/output.ts`, `src/batch.ts` and every other existing file outside the deliverables are unchanged; the new module does not import `src/figure-vlm.ts` or `src/vision.ts`.
- No class-substring selectors and no viewport resize: `grep -rnE 'class\*="graph" i|class\*="figure" i' src/figure-locator src/preprocess.ts src/state.ts` and `grep -rn setViewportSize src/figure-locator` each print nothing and exit 1. The legacy hits at `src/figure-vlm.ts:426`, `:775` and `:1151` stay until W10.
- Every frozen contract test from wave 1 and tranche 1 keeps passing unchanged, in particular `tests/contract/10`, `11` and `12` (the legacy snapshot and live paths).
- No network in any test: snapshot fetches are injected; the live case uses a local `file://` page.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a `node_modules` clone made as `## Family-specific notes` describes.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write sandbox, no network; the test writes only under the OS temp dir.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/41-html-figures-and-dom-dedupe.test.ts` exits 0 (11 tests: exports, the Anthropic labels and CDN URLs with no hero, the unchanged legacy fields, the arXiv `<object data>` candidates, every label and asset source in order, whole-token wrappers, the IoU and wrapper rules, `fromSnapshot` on the Anthropic page, source fall-through and SVG, `fromLivePage` on a local page, and the grep and type checks). The live case skips itself only when Playwright is not installed or its Chromium cannot launch from the seat; a skip there is acceptable and is reported, any failure is not. Baseline on `dev`: red, 10 of 11 fail (first: `src/figure-locator/dom-figures.ts does not exist`); the legacy-fields test is green on `dev` and guards against regression.
2. **Legacy paths still hold (verifier):** `tests/contract/10-a-pinned-figure-is-the-figure-or-nothing.test.ts`, `11-figure-directives-and-pdf-urls-are-honoured.test.ts`, `12-the-figure-picker-prefers-the-results-figure.test.ts`, `26-caption-index-and-label-parser.test.ts` and `28-pixel-space-crop-and-sidecar-asset.test.ts` (same command form) exit 0. Baseline on `dev`: green.
3. **Greps (verifier):** `grep -rnE 'class\*="graph" i|class\*="figure" i' src/figure-locator src/preprocess.ts src/state.ts` exits 1, and `grep -rn setViewportSize src/figure-locator` exits 1. Baseline on `dev`: the first exits 1 (no hits outside `src/figure-vlm.ts`), the second exits 1 for the same reason; both guard the new module.
4. **Unit test (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/dom-figures.test.ts` exits 0. Baseline on `dev`: red (no file).
5. **Fixture copied (verifier):** `cmp tests/fixtures/figure-locator/anthropic-expertise/page.html tests/contract/fixtures/41-html-figures-and-dom-dedupe/anthropic-expertise.html` exits 0. Baseline on `dev`: red (no file).
6. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green (125 of 125).
7. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
8. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/41-html-figures-and-dom-dedupe.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
9. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`; the worker leaves its changes uncommitted, so this lists the whole diff against the base (and is also the evidence that `src/figure-vlm.ts` is unchanged). Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/41-html-figures-and-dom-dedupe.test.ts`
- **Assertions digest:** `sha256:660ba10e24405e7fa30affa77f18834c050a1c25870380f3ac06894c57d6c885`
- **Oracle proof:** On `dev` (`8bb4372`) 10 of 11 tests fail (the module does not exist, labels and sources are absent, the wrappers fall back by substring); the legacy-fields test passes on `dev`, as it must. A throwaway reference (about 120 lines in `preprocess.ts` and 170 in the new module) in a detached scratch worktree, stacked with the other tranche-2 figure references, passed all 11 with the live case running (Chromium launched on the orchestrator's machine), `tsc --noEmit` was clean, every contract test from wave 1 and tranche 1 passed and `npm test` passed 125 of 125; the worktree was removed and pruned. The reference met one trap the worker will meet too: a literal `<figure>` inside an HTML comment counts as a figure for a regex scan, so the synthetic fixture's comment avoids it.

## Out of scope

- Calling `fromSnapshot` or `fromLivePage` from the ladder, the picker over same-label candidates, and the `lead_figure` record (W8).
- Composing the displayed caption, or any `alt_text` rule.
- Any edit to `src/figure-vlm.ts`, `src/output.ts`, `src/batch.ts` or `src/vision.ts`.

## Budget

- **Worker wall-clock:** 75 minutes
- **Verifier wall-clock:** 35 minutes
- **Spend basis:** wave-2 tranche-1 figure cards in this repo's `state/cost-log.jsonl` (cards 26 to 28): 0.76M to 1.96M tokens per stage. Expect the top of that range: a shared parser with regression fields plus an in-page Playwright extraction.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it, and whether the live case ran or skipped.
- The final `FigureCandidate` interface.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block or its fixtures fails the stage. The worker runs criteria 1 to 7 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; make no network calls (the live case loads only a local `file://` page). Playwright and its Chromium are installed on this machine. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough. Chromium may not launch inside the sandbox; the live case then skips itself, which criterion 1 allows. Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21. Raised and folded in: `imgSrc` for a `srcset`-only image, which `--figure-label` wins when the figure and its figcaption both carry one, the legacy-field guarantee scoped to `<figure>` candidates, the live case's two skip conditions, and the clean-tree evidence stated as the uncommitted diff. It also listed rules the frozen test does not exercise (a candidate persisted without `sources`, the default fetch's timeout, `.T<n>` ids, the cap of 20); they stay specified in Deliverables 2 and 3 for the unit test and the verifier's reading.
