# Stage card 40-arxiv-source-step: an arXiv paper's figure is the author's own file from the e-print, found through the HTML render's numbering

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/40-arxiv-source-step
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/figure-locator/arxiv-source.ts, scripts/figure-arxiv.ts, tests/unit/arxiv-source.test.ts
- **Pairing rationale:** HTML and TeX parsing, a tarball read through the system `tar`, a poppler render and a cache, every rule pinned by a frozen test with an injected fetcher, so the cheap OpenAI coding tier at medium effort fits and keeps Codex spend low. The verifier is a strong Claude from the other family at high effort, because the fall-through rules and the cache are where a plausible implementation goes quietly wrong. No gate: it consumes only cards 26 and 28's landed `label.ts` and `asset.ts`. Its claims are new files only and overlap no other tranche-2 card. The design's shared `tests/fixtures/figure-locator/hu-2410.15332v3/html.html` is not created: the orchestrator commits the trimmed render once, as this card's contract fixture, and both this card's unit test and card 41 read it there, so no worker claims it and card 41 needs no gate. Worker families alternate (cards 39 and 41 have Claude workers).
- **Open decisions:** none

## Surfacing concern

Wave 2 of the figure redesign, card W5 of `docs/design/figure-locator.md` (`### W5. arxiv-source-step`; the rules are `## arXiv source`, `### Evidence` and `### Design`, and ladder step 1 in `### The ladder`). Today an arXiv paper's figure is always a crop of the rendered PDF page chosen by a vision model (`extractFromPdf`, `src/figure-vlm.ts:619-715`); the author's own figure file sits in the e-print tarball, sharper than any crop and with no neighbouring text to exclude (design Tradeoff 4). The figure number is not in the TeX (`\label{fig-algo}` is a name), so the HTML render (`<figure id="S4.F4">` with `<figcaption>Figure 4: ...` and `<object data=".../fig-algo.svg">`) maps the label to an asset basename and the e-print's `\includegraphics` list supplies the bytes. Nothing calls this step from the pipeline until W8. Lines re-checked against `dev` at `8bb4372` on 2026-10-21.

Scope against the design's `### Design` list: this card builds the HTML mapping, `\includegraphics` resolution with and without an extension, the PDF, PNG and JPEG asset handling, the EPS and multi-file fall-throughs (with the pinned-panel exception), the cache and the network budget. The **e-print-only mapping** (numbering `figure` environments through `\input` when there is no HTML render, accepted on a 60 percent caption-word overlap) is not in W5's outcome and is left out: a paper with no HTML render fails the HTML fetch, the step gives `unavailable`, and the PDF locator runs instead. It is a follow-up for W8 or W9. arXiv id detection belongs to card 42 (`request.ts`).

The fixtures were fetched by the orchestrator on 2026-10-21 (the worker has no network): `tests/contract/fixtures/40-arxiv-source-step/html.html` is the `arxiv.org/html/2410.15332v3` render trimmed to its ten `<figure>` elements, verbatim, with all prose removed; `tex/fig-algo.tex` and `tex/fig-eval-data-dist.tex` are copied verbatim from the e-print; `eprint-listing.txt` is `tar -tzf` of the e-print. The real e-print (940 KB) is not committed: the frozen test builds a small tarball at run time from the two real `.tex` files, three synthetic ones and generated one-page PDFs.

Cold read: see the note at the end of `## Family-specific notes`.

## Objective

`src/figure-locator/arxiv-source.ts` maps a label to its asset through the arXiv HTML render, resolves the asset in the e-print's `\includegraphics` list, renders a PDF asset at 300 dpi as JPEG (PNG and JPEG are kept as fetched), falls through on a multi-file environment, an EPS-only asset, a missing label or asset, a network error or `FIGURE_ARXIV_SOURCE=0`, and caches the HTML, the e-print and the label mapping under `state/cache/arxiv/<id>/` with no expiry; `scripts/figure-arxiv.ts` writes the asset through card 28's `writeAsset`.

## Inputs (read these in your own context)

- `docs/design/figure-locator.md` (`## arXiv source` and `### W5. arxiv-source-step`)
- `src/figure-locator/label.ts` and `src/figure-locator/asset.ts` (landed by cards 26 and 28; use `parseLabel`, `labelsEqual`, `formatLabel`, `sniffImageType`, `imageSize`, `writeAsset`)
- `tests/contract/40-arxiv-source-step.test.ts` (frozen) and `tests/contract/fixtures/40-arxiv-source-step/`
- `tests/unit/figure-captions.test.ts` (the unit-test style)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test and its fixtures, which already exist and must not be edited. Paths are relative to repo root.

1. `src/figure-locator/arxiv-source.ts` (new), exporting:
   - `parseArxivHtmlFigures(html): Array<{ label: string; key: LabelKey; id: string; basename: string }>` in document order, one per `<figure>` that has both a label and an asset. The label is `parseLabel` of the `<figcaption>` text (tags stripped), else the LaTeXML id (`S<sec>.F<n>` and `A<k>.F<n>` give `Figure <n>`, `.T<n>` gives `Table <n>`); `label` is `formatLabel(key)`. The asset is the first `<object data>`, else the first `<img src>`; `basename` is its file name without directory or extension (`fig-algo`).
   - `includeGraphicsEnvironments(files: Array<{ path; text }>): Array<{ path: string; files: string[] }>`: one entry per `figure`, `figure*`, `table` or `table*` environment that contains at least one `\includegraphics[...]{arg}` (optional argument allowed), with every `arg` in order, trimmed. Includes outside those environments are ignored.
   - `resolveIncludePath(arg, members): string | null`: a leading `./` is ignored on both sides; an `arg` with an extension resolves only to that exact member; an extension-less `arg` tries `.pdf`, `.png`, `.jpg`, `.jpeg`, `.eps` in that order; otherwise `null`.
   - `arxivSourceFigure(id, label: LabelKey, opts: { fetchBytes?, cacheRoot?, env? })`, returning `{ ok: true, label, bytes, ext, width?, height?, provenance: 'arxiv-source', member, htmlId, notes }` or `{ ok: false, reason, notes }`. In order:
     1. `env.FIGURE_ARXIV_SOURCE === '0'` gives `disabled` with no fetch. Any other value, or none, runs the step.
     2. The cache directory is `<cacheRoot>/<id>/`, `cacheRoot` defaulting to `state/cache/arxiv` under the repo root (already gitignored by `state/**`). `html.html` and `eprint.tar.gz` are read from it when present, otherwise fetched from exactly `https://arxiv.org/html/<id>` and `https://arxiv.org/e-print/<id>` with `fetchBytes(url): Promise<Buffer>` and written there byte for byte. There is no expiry. The default `fetchBytes` uses `fetch` with a 20 second `AbortSignal.timeout` and throws on a non-2xx status.
     3. A failed HTML fetch, or a failed e-print fetch, gives `unavailable` with a note `arxiv-source: unavailable (<error message>)`.
     4. After the HTML is read, `mapping.json` in the cache directory is written as `{ "<label>": { "id": "<id>", "basename": "<basename>" }, ... }` for every figure `parseArxivHtmlFigures` returns.
     5. No HTML figure equal to `label` (by `labelsEqual`, so `Table 4` is not `Figure 4`) gives `label-not-found`.
     6. The e-print is listed and its `.tex` members are read with the system `tar` (`tar -tzf`, `tar -xzf -C <tmp>`), never with a new dependency; a temporary directory is removed afterwards. The environment whose files include the HTML basename (by file name without directory or extension) is the match, the first one in `tar -tzf` order of the `.tex` members and document order within a file when several do; none gives `no-asset`. A listing or extraction that fails, an unreadable member and a failed render each give `no-asset` with a note naming the failure.
     7. A matched environment with one file uses it. With more than one file, a label with a panel letter takes the file at that position (`b` is the second) when it exists (the design asks for as many files as panels, which nothing can count, so the position is the rule); otherwise, and always when the label has no panel, the result is `multi-file`.
     8. The file is resolved with `resolveIncludePath` against the tarball's members; `null` gives `no-asset`, and an `.eps` member gives `eps-only`.
     9. A `.pdf` member is rendered page 1 at 300 dpi with `pdftoppm -jpeg -jpegopt quality=90 -r 300 -f 1 -l 1 -singlefile`; a `.png`, `.jpg` or `.jpeg` member is returned byte for byte. `ext` comes from `sniffImageType`, `width` and `height` from `imageSize`. Bytes that do not sniff as an image give `no-asset`.
     10. `label` in the result is the HTML figure's key with the requested panel, when there was one; `member` is the resolved tarball path and `htmlId` the figure's id.
2. `scripts/figure-arxiv.ts` (new): `figure-arxiv.ts <arxiv-id> "<label>" <out-dir> [--cache-dir <dir>]` runs `arxivSourceFigure` (with `--cache-dir` as `cacheRoot`), and on success writes the asset with `writeAsset(outDir, label, bytes, { provenance: 'arxiv-source', label: formatLabel(label) })`, prints that record as one JSON line and exits 0; on a fall-through it prints the result as one JSON line, writes nothing (the out directory is not created) and exits 1; a missing argument or an unparseable label exits 2 with a usage line on stderr.
3. `tests/unit/arxiv-source.test.ts` (new): offline, reading the committed `tests/contract/fixtures/40-arxiv-source-step/` (read only; build any tarball under the OS temp dir): the `Figure 4` to `fig-algo` mapping through `S4.F4`, `figs/figs/fig-algo.pdf` resolved from the `\includegraphics` list, the extension-less `fig-eval-data-dist`, a two-file environment falling through, an EPS-only asset falling through, and `unavailable` on a simulated network error.

## Constraints

- No new dependency (no `tar`, `tar-stream`, `jszip`, `sharp`, `jsdom` or `cheerio` package); `tar`, `pdftoppm` and `fetch` only.
- No network in any test: tests inject `fetchBytes` or pre-fill the cache. The online command in the design's outcome is optional and is not a criterion here.
- `src/figure-vlm.ts`, `src/preprocess.ts` and every other existing file are unchanged; the new module does not import `src/figure-vlm.ts` and calls no vision model.
- Cards 26, 27 and 28 keep passing their frozen tests unchanged.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a `node_modules` clone made as `## Family-specific notes` describes.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Opus 5.5 verifier through the Claude CLI, no network needed; the test writes only under the OS temp dir; poppler 26.07 and `tar` are on `PATH`.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/40-arxiv-source-step.test.ts` exits 0 (12 tests: exports, the ten-figure HTML mapping with `S4.F4` and `A1.F10`, include environments and path resolution, Figure 4 as a 1983 by 838 JPEG with the cache filled and then read offline, the extension-less include, a PNG kept byte for byte, the multi-file fall-through and the pinned panel `6b`, the EPS-only fall-through, `label-not-found` and `no-asset`, `unavailable` and `disabled`, the CLI from a filled cache, and no new dependency). Baseline on `dev`: red, 12 of 12 fail (first: `src/figure-locator/arxiv-source.ts does not exist`).
2. **Earlier cards still hold (verifier):** `tests/contract/26-caption-index-and-label-parser.test.ts`, `27-page-geometry-and-region-rule.test.ts` and `28-pixel-space-crop-and-sidecar-asset.test.ts` (same command form) exit 0. Baseline on `dev`: green.
3. **Unit test (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/arxiv-source.test.ts` exits 0 and reads only `tests/contract/fixtures/40-arxiv-source-step/` plus files it writes under the OS temp dir. Baseline on `dev`: red (no file).
4. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green (125 of 125).
5. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/40-arxiv-source-step.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`; the worker leaves its changes uncommitted, so this lists the whole diff against the base (and is also the evidence that `src/figure-vlm.ts` is unchanged). Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/40-arxiv-source-step.test.ts`
- **Assertions digest:** `sha256:2ab520556f2832232c18bd39f9a0f2574ad153c2b0c997fc546d1b4ad1774974`
- **Oracle proof:** On `dev` (`8bb4372`) all 12 tests fail because `src/figure-locator/arxiv-source.ts` does not exist. A throwaway reference (about 130 lines and a 20-line CLI) in a detached scratch worktree passed all 12, `tsc --noEmit` was clean and `npm test` passed 125 of 125; the worktree was removed and pruned. Fixtures are outside the digest but read by it: `html.html`, `tex/fig-algo.tex`, `tex/fig-eval-data-dist.tex`.

## Out of scope

- The e-print-only mapping with no HTML render (see Surfacing concern), arXiv id detection (card 42), the ladder and pipeline wiring (W8).
- Rasterising SVG or EPS: both fall through, as the design says.
- Using the HTML render's own `<img srcset>` or PNG asset when the e-print is unavailable: card 41's DOM path covers HTML assets, and W8 orders the steps.
- Any edit to `src/figure-vlm.ts`, `src/preprocess.ts`, `src/output.ts` or `.gitignore`.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** wave-2 tranche-1 figure cards in this repo's `state/cost-log.jsonl` (cards 26 to 28): 0.76M to 1.96M tokens per stage. Expect the middle of that range: one module of about 130 lines and a CLI against a fully specified rule list.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block or its fixtures fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the tests write only under the OS temp dir and the cache directory they are given. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls, and do not run the CLI without `--cache-dir` (that would fetch arXiv).
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21. Raised and folded in: the reason for tarball, extraction and render failures (`no-asset` with a note), which environment wins when several hold the basename, the panel-position rule against the design's panel count, HTML-only assets named out of scope, card 27 added to criterion 2, the unsatisfiable CLI-record envelope item dropped, and the clean-tree evidence stated as the uncommitted diff. It also listed rules the frozen test does not exercise (the id fallback, table environments, JPEG passthrough, the default fetch's timeout); they stay specified in Deliverable 1 for the unit test and the verifier's reading.
