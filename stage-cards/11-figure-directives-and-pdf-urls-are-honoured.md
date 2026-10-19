# Stage card 11-figure-directives-and-pdf-urls-are-honoured: image hints work on their own, PDF URLs get a figure, and crops use the picked page's size

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/11-figure-directives-and-pdf-urls-are-honoured
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** Three small mechanical fixes in the figure plumbing, each pinned by the contract test, so a Terra worker fits. The verifier is the other family's mechanical tier (Sonnet 5.5). Cards 10 and 12 have Claude workers, so the worker family alternates. Serial because cards 10, 12 and 13 also edit `src/figure-vlm.ts`. Kept as one card: the reference diff is about 60 lines across five files, well inside one context.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19, section 2b items 4, 5 and 9 (plan item 14, first three clauses). Lines checked against `dev` at 0cd17d7:

- **Sidecar hints are dropped.** `parseFocusDirectives` consumes `image_caption:`, `image_alt:` and `image_page_hint:` lines (`src/preprocess.ts:94-102`) but builds `imageOverride` only when `image: Figure N` is present (`:116-118`). A bare page hint or caption is silently lost, although `src/figure-vlm.ts:10-20` (`ImageOverride` with an optional `source_figure`), `docs/FIGURE-EXTRACTION.md:95-99` and `README.md:175-177` all present them as standalone. An unknown key such as `image_raster: true` (a retired directive still in a held sidecar) is not recognised, so it stays in `focusHint` and is sent to the synthesis model.
- **PDF URLs never get a figure.** `isPdfUrl` (`src/preprocess.ts:169-172`) skips the HTML fetch (`:568`), but the source stays `kind: 'url'`. `resolveSourcePdf` returns `null` for every `explainer-url-*` id (`src/output.ts:160-161`), so `extractFigureViaVlm` takes the live URL branch (`src/figure-vlm.ts:1211-1216`) and Playwright is pointed at a PDF. The README's own example input is `https://arxiv.org/pdf/2411.13768` (`README.md:91`).
- **Crop maths uses page 1's size.** `pageSizePts` runs `pdfinfo <pdf>` with no `-f/-l` (`src/figure-vlm.ts:465-473`), which reports page 1 only, and `cropPdfBboxPng` (`:579-587`) converts the normalised box of page N with that size. `/Rotate` is never read, but `pdftoppm` renders the rotated page, so width and height swap on a rotated page. `docs/FIGURE-EXTRACTION.md:249-250` lists this as "could crop slightly off".

## Objective

Three outcomes, one per surface:

1. Any recognised `image_*` sidecar key (`image:`, `image_caption:`, `image_alt:`, `image_page_hint:`) builds an `imageOverride`, with `source_figure` set only by `image: Figure N`. An unrecognised `image_*` key is reported with a `console.warn` naming it and kept out of `focusHint`.
2. `extractFigureViaVlm` given a PDF URL (the same rule as today's `isPdfUrl`: a path ending `.pdf`, or an `arxiv.org/pdf/` URL) downloads it to a temporary file, runs the PDF path on it, and removes the file afterwards. A failed download returns `null` without throwing and without opening a browser. HTML URLs are unchanged.
3. PDF crops are computed from the size of the page that was picked, as rendered (rotation applied), so a crop on a page that differs from page 1 in size or rotation covers the box the model returned.

## Inputs (read these in your own context)

- `AGENTS.md`, `CLAUDE.md`
- `src/preprocess.ts` (`ImageOverride`, `parseFocusDirectives`, `isPdfUrl`, the two `image override:` log lines in `preprocessInputs`)
- `src/figure-vlm.ts` (`ImageOverride`, `pageSizePts`, `cropPdfBboxPng`, `extractFromPdf`, `extractFigureViaVlm`)
- `src/state.ts` (`RequestState.imageOverride`)
- `src/output.ts` (`lookupImageOverride`, `resolveSourcePdf`, `attachFigureImage`)
- `docs/FIGURE-EXTRACTION.md`
- `README.md` (the sidecar directive table)
- `tests/contract/11-figure-directives-and-pdf-urls-are-honoured.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/preprocess.ts`:
   - `parseFocusDirectives` is exported (the contract test calls it).
   - `imageOverride` is built when any recognised `image_*` key was seen; `source_figure` is optional on the exported `ImageOverride`.
   - A line matching `image_<anything>:` that is not a recognised key produces one `console.warn` naming the key and is not added to `focusHint`. A sidecar with no `image_*` key warns nothing.
   - The two `image override:` log lines in `preprocessInputs` print something sensible when there is no `source_figure` (not the text `undefined`).
   - `isPdfUrl` moves to `src/figure-vlm.ts` (exported) and `preprocess.ts` imports it, so there is one implementation. `figure-vlm.ts` must not import `preprocess.ts` (that would be an import cycle through `output.ts`).
2. `src/figure-vlm.ts`:
   - `pageSizePts(pdfPath, page)` runs `pdfinfo -f <page> -l <page>`, reads that page's size and rotation, and swaps width and height when the rotation is 90 or 270. `cropPdfBboxPng` passes the page. (Alternatively, derive the size from a render of that page; either satisfies the test.)
   - `extractFigureViaVlm`: when `input.url` passes `isPdfUrl` (and no local `pdfPath` is given), download it with `fetch` to a file in a fresh temp directory, call `extractFromPdf` on it, and remove the directory in a `finally`. A non-OK response or a fetch error returns `null`.
3. `src/state.ts`: `RequestState.imageOverride.source_figure` becomes optional.
4. `src/output.ts`: `lookupImageOverride`'s return type allows a missing `source_figure`. No other change.
5. `docs/FIGURE-EXTRACTION.md`: say that a PDF URL source is downloaded and takes the PDF path; drop or rewrite the "Per-page point sizes" known-limitation bullet (`:249-250`).
6. `README.md`: the sidecar directive table says each `image_*` key works on its own and an unknown `image_*` key is warned about and ignored.

## Constraints

- `image: Figure N` keeps its normalisation (`fig. 3` becomes `Figure 3`) and still pins.
- `recreate:`, `recreate_x:`, `recreate_y:` and `data:` parsing is unchanged.
- No change to the synthesis request for PDF URLs: preprocess still sends them as URL document blocks; only figure extraction downloads the file.
- No change to the HTML URL path, the snapshot path or the live Playwright path for HTML pages.
- The download uses the global `fetch` (the contract test stubs it); no new dependency.
- Do not change the pad ladder, the refine pass, page limits, label handling (card 10), selection prompts (card 12) or model resolution (card 13).
- Runtime downloads need the network, but nothing in this card's work or tests may use it: the contract test stubs `fetch` and points `PLAYWRIGHT_BROWSERS_PATH` at an empty directory.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Sonnet 5.5 verifier, Claude CLI, no network needed (`pdftoppm`, `pdfinfo` and `sips` run locally).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/11-figure-directives-and-pdf-urls-are-honoured.test.ts` exits 0. It covers the six directive cases, the PDF URL download, a failed download, an HTML URL that must not be downloaded, and crops on a letter page, a rotated 400x200pt page and a 300x300pt page of one PDF. Baseline on `dev`: red, 10 of 12 tests fail (first: "parseFocusDirectives is exported"; the crop tests fail at "rotated page 2 width: 834px is not about 0.505 of the displayed page (833px)" and "page 3 height: 442px"); the HTML URL and page-1 crop tests pass on `dev` as regression guards.
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **One isPdfUrl (verifier):** `grep -rn "function isPdfUrl" src` prints exactly one line, in `src/figure-vlm.ts`, and `grep -n "from './preprocess'" src/figure-vlm.ts` prints nothing. Baseline on `dev`: red (the function is in `src/preprocess.ts`).
4. **Per-page pdfinfo (verifier):** `grep -n "'pdfinfo'" src/figure-vlm.ts` shows the page-size call passing `-f` and `-l`, or the page size no longer comes from `pdfinfo` at all. Baseline on `dev`: red.
5. **Docs (verifier):** `grep -n "Per-page point sizes" docs/FIGURE-EXTRACTION.md` prints nothing, and `grep -n -i "pdf url" docs/FIGURE-EXTRACTION.md` prints the new download sentence. Baseline on `dev`: red (the bullet is present; no PDF URL sentence).
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/11-figure-directives-and-pdf-urls-are-honoured.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/11-figure-directives-and-pdf-urls-are-honoured.test.ts`
- **Assertions digest:** `sha256:fd042f3dc1930528612cfe93c60f51c53956274c9724b6086ba3adfe853be9e2`
- **Oracle proof:** On `dev` (0cd17d7) 10 of 12 tests fail for the card's reason: `parseFocusDirectives` is not exported, so the six directive tests fail; the PDF URL goes to Playwright, which cannot start, so nothing is fetched and the result is `null`; the rotated page crop comes out 834px wide (the whole rotated page, from page 1's 612pt width) and the 300pt page crop 442px tall. The HTML URL and page-1 crop tests pass on `dev`. A throwaway reference in a detached scratch worktree (export and a `sawImageKey` flag plus an unknown-key warning in `parseFocusDirectives`, `isPdfUrl` moved and exported, `pdfinfo -f N -l N` with a rotation swap, a fetch-to-temp branch in `extractFigureViaVlm`, the three optional `source_figure` types) passed all 12 with `tsc --noEmit` clean; the worktree was removed and pruned. The stub model id was then changed from a placeholder to `claude-sonnet-5-5` so card 13's provider check accepts it; the base result was re-run and is unchanged. Traps: with `-f/-l`, `pdfinfo` prints `Page    2 size:  400 x 200 pts` and `Page    2 rot:   90`, not `Page size:`, so the old regex no longer matches; a selection call is told apart from a refine or verify call by image count, so keep verification to one image per call; the test pins every `FIGURE_VLM_*` knob before loading `src/`, because `src/output.ts` runs the fill-only `.env` loader at import.

## Out of scope

- Using the arXiv HTML page or e-print source instead of the PDF, and any deterministic figure locator: wave-2 design card 18.
- Passing the downloaded PDF to the figure-data recreation pass (`recreateFigureData` still gets `pdfPath: null` for URL sources).
- Changing how preprocess or the providers send a PDF URL to the synthesis model.
- Pin labelling and fail-closed verification (card 10), selection steering (card 12), vision model resolution (card 13).

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** promo-flow medians: Terra worker about 6M tokens, Sonnet verifier about 0.9M. The reference diff is about 60 lines across five source files plus two doc edits. Hold one re-brief at the median.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the test stubs `fetch` and the vision module and writes only under the OS temp dir. `pdftoppm`, `pdfinfo` (poppler) and `sips` must be on `PATH`. Run `codex exec` with stdin redirected from `/dev/null`. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
