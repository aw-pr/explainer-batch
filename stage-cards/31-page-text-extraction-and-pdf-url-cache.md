# Stage card 31-page-text-extraction-and-pdf-url-cache: a cited page's text is read once per file and page, and a PDF URL is kept as a local file

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/31-page-text-extraction-and-pdf-url-cache
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Gate:** stage-completed: 29-number-normaliser-and-page-text-matcher
- **Path claims:** src/page-text.ts, src/preprocess.ts, src/state.ts, src/output.ts, README.md
- **Dispatch:** serial
- **Pairing rationale:** A small file-touching module and a download step in an existing loop, fully specified: GPT-6.1 Sol at medium effort writes it, Claude Sonnet 5.5 from the other family checks it at high effort, and it can run the real `pdftotext` against the held PDFs without a sandbox. Stage 30 has a Claude worker, so worker families alternate. Gated on stage 29 because the `usable` test reads stage 29's committed page texts. Serial because it edits shared modules (`src/state.ts`, `src/preprocess.ts`, `src/output.ts`, `README.md`) that other wave-2 cards also claim.
- **Open decisions:** none

## Surfacing concern

Design stage 19 (`docs/design/chart-value-gate.md`, landed by the operator on 2026-10-21 without a final verifier pass) wave-2 card W3. The gate needs the text of a cited page (`## Gate inputs`, `:176-242`): one `pdftotext -f p -l p -layout` call per distinct page, cached by the PDF's sha256 and page, control characters stripped (EPIC page 8 emits 386 NUL bytes), and a `usable` mark that refuses a mangled text layer. A PDF URL has no local file today: `preprocessInputs` (`src/preprocess.ts:522-618`) passes it through as a URL document block (`src/batch.ts:115`), and `resolveSourcePdf` (`src/output.ts:161-173`) returns `null` for every `explainer-url-` id. Checked against `dev` at `77909f6`.

Corrections to the design entry, made here because the design landed unverified:

- **Which cache.** The design puts the download in "stage 17's file cache keyed by sha256". Stage 17's file cache (`docs/design/provider-routes.md:577-607`) maps provider, account and hash to a remote file ID; it stores no local bytes. This card owns a local download cache: `PDF_CACHE_DIR`, default `<input dir>/_cache/pdf/`, one `<sha256>.pdf` per file (`*.pdf` is already gitignored).
- **Tokens and `rootDir`.** The design's `PageText` carries `tokens`, which come from stage 29's `contract/chart-gate/numbers.ts`. `tsconfig.json` has `rootDir: src`, so `src/page-text.ts` importing from `../contract/` fails `npx tsc --noEmit` with TS6059 (checked). `pageText` therefore returns `{ page, lines, usable }`, and W4's `src/chart-gate.ts` attaches tokens with `pageTextFromLines` once the tsconfig question is settled for `contract/` (stage 20 and later).
- **Heuristic margin.** The design says glyph-shifted text "scores near zero". Measured on the four committed page texts with every lower-case letter shifted down 29 code points: 0.56 to 0.61, against 0.94 to 1.00 for the plain text. The 70 percent threshold still separates them, which is what the test pins.
- **Tests.** The design's `tests/unit/page-text.test.ts` and `tests/unit/chart-gate-pdf.test.ts` are not made: the frozen contract test covers the mocked cache, the heuristic, the no-network download and the real binary (skipped when the held PDFs are absent).

Cold read: a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21. Folded in: an unreadable PDF and a missing binary yield `null`, words are ASCII letter runs, and `resolveSourcePdf` stops at the newest request that records a path (stated below); a cached failure, an unreadable PDF, a throwing fetch, the README default and the no-fall-back rule now have assertions; the clean-tree criterion reads the working tree; temporary files and a cloned `node_modules` are named as allowed. The download timeout and not rewriting an existing cache file are stated but not asserted. Its remaining note, that the test and stage 29's fixtures are untracked, is answered by committing them before the card is queued.

## Objective

`src/page-text.ts` exports `pageText(pdfPath, page)`, which returns the page's `pdftotext -layout` lines with control characters removed and a `usable` mark, calling the binary once per (file sha256, page) per process. `preprocessInputs` downloads each PDF URL into `PDF_CACHE_DIR` and records the cached path on the item's `source`, which already flows into the request state, and `resolveSourcePdf` returns that path for a URL request. The request sent to the provider for a PDF URL is unchanged.

## Inputs (read these in your own context)

- docs/design/chart-value-gate.md (`## Gate inputs`, lines 176 to 242)
- src/preprocess.ts (`InputSource`, lines 142 to 147, and `preprocessInputs`, lines 522 to 618)
- src/state.ts (`RequestState.source`, lines 55 to 60, and `readState`)
- src/output.ts (`resolveSourcePdf`, lines 156 to 173, and its caller in `attachFigureImage`, line 258)
- src/batch.ts (line 115, the URL document block, and the request-state writes that copy `item.source`, lines 354, 379, 395, 1222 and 1241)
- tests/contract/31-page-text-extraction-and-pdf-url-cache.test.ts (frozen)
- tests/contract/fixtures/29-number-normaliser-and-page-text-matcher/ (stage 29's page texts, read by the test)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test and stage 29's fixtures, which already exist and must not be edited. Paths are relative to repo root.

1. `src/page-text.ts` (new), exporting:
   - `interface PageLines { page: number; lines: string[]; usable: boolean }`.
   - `pageUsable(text: string): boolean`: true when the text has at least 40 alphabetic words (runs of three or more ASCII letters) and at least 70 percent of them contain a vowel (`a`, `e`, `i`, `o` or `u`, either case).
   - `pageText(pdfPath: string, page: number): PageLines | null`: runs `$PDFTOTEXT_BIN` (read at call time; `pdftotext` from `PATH` when unset) with exactly the arguments `-f <page> -l <page> -layout <pdfPath> -`, removes U+0000 to U+0008 and U+000B to U+001F, splits on `\n`, and sets `usable` from `pageUsable`. It returns `null`, without throwing, when the file cannot be read (before any call), when the binary is missing or exits non-zero. Results, including `null` from the binary, are cached in memory by the sha256 of the file's bytes and the page, so the same bytes under another path do not call the binary again. No import from `contract/`.
2. `src/preprocess.ts`: `InputSource` gains `cachedPdfPath?: string`. For every `urls.txt` line that `isPdfUrl` accepts, `preprocessInputs` fetches the URL once (60-second timeout), and only when the response is OK and the body starts with `%PDF-` writes it to `<PDF_CACHE_DIR>/<sha256>.pdf` (creating the directory; an existing file is not rewritten) and sets `source.cachedPdfPath` to that absolute path. `PDF_CACHE_DIR` is read from the environment, resolved to an absolute path, defaulting to `path.join(INPUT_DIR, '_cache', 'pdf')`. A failed or non-PDF download warns and leaves `cachedPdfPath` unset; the item is still queued as today, and no inline `base64Data` is added.
3. `src/state.ts`: `RequestState.source` gains `cachedPdfPath?: string`. No other state change; the existing writes that copy `item.source` carry it.
4. `src/output.ts`: `resolveSourcePdf` is exported. For an `explainer-url-` id it reads the state, walks batches newest first, skips requests with that id that record no `source.cachedPdfPath`, and stops at the first that does: it returns that path when the file exists and `null` otherwise, never falling back to an older batch. The local-PDF branch is unchanged.
5. `README.md`: documents `PDF_CACHE_DIR`, its default, and that PDF URLs are downloaded at preprocess time.

## Constraints

- The provider request for a PDF URL is unchanged: still the URL document block at `src/batch.ts:115` (the contract test checks the source text), and no `base64Data` for URL items.
- `src/page-text.ts` imports nothing from `contract/` (tsconfig `rootDir` is `src`).
- No network in the test: it stubs `globalThis.fetch` and fails on any URL it does not expect. The download happens only for PDF URLs; HTML URLs keep their current fetch path.
- Do not change `tsconfig.json`, `package.json`, `.gitignore` or any frozen test or fixture.
- No paid API calls.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state, a cloned `node_modules` (gitignored) and files under the OS temp directory (the test writes its fixtures, fake binary and cache there).

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Sonnet 5.5 verifier through the Claude CLI, unsandboxed, no network needed; `pdftotext` is at `/opt/homebrew/bin/pdftotext` and the held PDFs are in the main checkout at `../explainer-batch/input/_held/` (gitignored, so absent from the run worktree; the test looks there).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/31-page-text-extraction-and-pdf-url-cache.test.ts` exits 0 with 6 passing and 0 skipped. Baseline on `dev`: red, 6 of 6 fail (first: `Cannot find module .../src/page-text`; the download test fails at `cached path is <PDF_CACHE_DIR>/<sha256>.pdf`).
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green.
4. **PDF URLs and figures still hold (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/11-figure-directives-and-pdf-urls-are-honoured.test.ts` and the same for `tests/contract/06-batch-results-carry-their-provenance.test.ts` exit 0. Baseline on `dev`: green.
5. **Stage 29 still holds (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/29-number-normaliser-and-page-text-matcher.test.ts` exits 0. Baseline: green once stage 29 has landed (the gate).
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/31-page-text-extraction-and-pdf-url-cache.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/31-page-text-extraction-and-pdf-url-cache.test.ts`
- **Assertions digest:** `sha256:209209e5a3e781d0b9ab093d5050e47d34dfab6bcf42ea7e6e583688e3f52070`
- **Oracle proof:** On `dev` (`77909f6`) all 6 tests fail: `src/page-text.ts` is missing, `cachedPdfPath` is never set, `resolveSourcePdf` is not exported, and the state type and README lack the field. A throwaway reference in a detached scratch worktree, stacked on stage 29's reference (a 35-line `src/page-text.ts`, a 25-line download helper in `src/preprocess.ts`, a one-line state type change, a 10-line `resolveSourcePdf` branch and a README line), passed 6 of 6 with the held PDFs present (5 pass and 1 skip without them); `npx tsc --noEmit`, `npm test` and every wave-1 contract test stayed green; the worktree was removed and pruned. Mutations the test caught: caching by path instead of sha256, dropping the `%PDF-` check, dropping the control-character strip, lowering the vowel threshold to 50 percent, and (after the cold read) letting `resolveSourcePdf` fall back past a missing cached file. Traps the worker will meet: the test sets `PDFTOTEXT_BIN` to a shell script that logs its arguments, so the binary must be resolved at call time; the test resolves the held PDFs through `HELD_PDF_DIR`, `input/_held` or `../explainer-batch/input/_held`, so a run worktree beside the main checkout finds them; macOS temp paths are compared after `realpath`.

## Out of scope

- Attaching tokens to page text, `gateCharts`, verdicts and any caller of `pageText` (W4).
- Changing how a PDF URL is sent to a provider, uploading the cached file, or stage 17's provider file cache.
- Cache eviction, and downloads for HTML URLs.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** Wave 1 in this repo: median 0.83M tokens per card, p95 2.1M. Expect about the median: one small new module and three small edits.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The final `pageText` and download helper bodies.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block or stage 29's fixtures fails the stage. The worker runs criteria 1 to 5 itself before returning (criterion 1 may report the real-binary test as skipped from the Codex sandbox if the held PDFs are not readable there; the verifier's run must not skip it), and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough; the download test stubs `fetch`, and the cache test runs a shell script from the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; still make no network calls.
- **Both roles:** do not create `.env.local` in the run worktree.
