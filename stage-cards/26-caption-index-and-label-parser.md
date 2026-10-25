# Stage card 26-caption-index-and-label-parser: one pass over the text layer lists every figure and table caption with its page, and labels compare by noun and number

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/26-caption-index-and-label-parser
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/figure-locator/label.ts, src/figure-locator/captions.ts, scripts/figure-captions.ts, tests/unit/figure-captions.test.ts, tests/fixtures/figure-locator/captions/
- **Pairing rationale:** A regex, an XML walk and a small selection rule, all specified in the design and pinned by the frozen test, so a mid-tier Claude worker at medium effort is enough and no frontier tier is needed. The verifier is the cheap OpenAI tier from the other family, at high effort because it must re-run poppler against the held PDFs and judge the unit test's coverage. Worker families alternate along this chain (27 has an OpenAI worker). The path claims are new files only and do not overlap any other tranche-1 card.
- **Open decisions:** none

## Surfacing concern

Wave 2 of the figure redesign, card W1 of `docs/design/figure-locator.md` (`## Wave-2 cards`, `### W1. caption-index-and-label-parser`; the rules are in `## PDF caption locator`, `### Caption regex and label parsing` and `### Page selection without a page cap`). Today the figure pipeline never reads the text layer: a vision model picks a page from thumbnails of the first 24 pages (`src/figure-vlm.ts:105`, `MAX_PAGES`; `:620-621`), so `w35275.pdf` Figures 9 to 12 (pages 38 to 43) can never be found, and labels are compared by `figureLabelKey` (`src/figure-vlm.ts:898-901`), which keeps only the leading number-and-letter run, so `Table 4` and `Figure 4` collide (design D13). This card builds the first deterministic piece: a caption index over the whole document and a label parser. Nothing calls it from the pipeline until W8 (`## Migration and rollback`, step 1; W4 adds the ladder skeleton and the prompt change, but the pipeline's switch to the locator is W8). Lines re-checked against `dev` at `77909f6` on 2026-10-21.

The design's W1 fixture `tests/fixtures/figure-locator/su-2507.14554/captions.bbox.xml` needs a network download of an arXiv paper this repo does not hold. It is replaced by a hand-written fixture of the same block structure (a sentence-end "Figure 13. All in all" inside a paragraph block), so the card needs no network; the frozen test covers the same rule with a synthetic block.

Cold read: see the note at the end of `## Family-specific notes`.

## Objective

`src/figure-locator/label.ts` parses labels and captions into `LabelKey {noun, number, panel?}` and compares them by noun and number; `src/figure-locator/captions.ts` builds a caption index from one `pdftotext -bbox-layout` pass over the whole document (no page cap) and selects the caption for a requested label, using `image_page_hint:` only as a tie-breaker; `scripts/figure-captions.ts <pdf>` prints the index. `npx ts-node scripts/figure-captions.ts ../explainer-batch/input/_held/w35275.pdf` prints 17 lines including `p5<TAB>Figure 1<TAB>...` and `p12<TAB>Figure 3<TAB>...` and no "Figure 8 presents" line.

## Inputs (read these in your own context)

- `docs/design/figure-locator.md` (sections `## PDF caption locator` up to `### Extents: what each tool reports`, `### Stop rules`, and `### W1. caption-index-and-label-parser`)
- `src/figure-vlm.ts` (lines 898-923 only: `figureLabelKey`, `matchesNamedFigure`, `pinDriftReason`, the legacy label logic this replaces; do not edit it)
- `tests/contract/26-caption-index-and-label-parser.test.ts` (frozen)
- `tests/unit/harness.test.ts` (the unit-test style)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/figure-locator/label.ts` (new), exporting:
   - `type LabelNoun = 'Figure' | 'Table' | 'Scheme' | 'Exhibit'` and `interface LabelKey { noun: LabelNoun; number: string; panel?: string }`.
   - `parseLabel(text: string): LabelKey | null`: lenient, for pins and labels. Case-insensitive noun (`Figure`, `Fig`, `Fig.`, `FIGURE` give `Figure`; `Table`, `Tab.`, `TABLE` give `Table`; `Scheme`; `Exhibit`), then a number (`3`, `A1`, `S2`, roman `IV`), an optional panel (`2b`, `2(b)`, `2 (b)`, stored lower case), an optional sub-number (`3.1` stores `number: '3.1'`). Anything else (`Chart 3`, prose, empty) is `null`. A `panel` key is present only when there is a panel.
   - `matchCaption(text: string): { key: LabelKey; continued: boolean } | null`: strict, the design's caption regex verbatim (case-sensitive nouns `Figure|Fig\.?|FIGURE|Table|Tab\.?|TABLE|Scheme|Exhibit`, then number, panel, sub-number, then `:` or `.`, or a following capital letter or bracket). `continued` is true when the first 40 characters of `text` contain `continued` or `cont.` (any case).
   - `labelsEqual(a, b): boolean`: noun and number equal; panels are ignored (a pin with a panel matches a caption without one).
   - `formatLabel(key): string`: `Figure 3`, `Figure 2b`, `Table IV`.
2. `src/figure-locator/captions.ts` (new), exporting:
   - `interface CaptionEntry { key: LabelKey; label: string; page: number; box: { xMin: number; yMin: number; xMax: number; yMax: number }; text: string; continued: boolean }` (`label` is `formatLabel(key)`).
   - `parseCaptionIndex(bboxXml: string, firstPage = 1): CaptionEntry[]`: one entry per `<block>` whose words, joined by single spaces across its lines, satisfy `matchCaption`. A reference inside a paragraph is not at a block start and is never an entry. `page` counts `<page>` elements from `firstPage`; `box` is the block's own `xMin/yMin/xMax/yMax` as numbers; `text` is the whole block with XML entities decoded (`&amp;` gives `&`). Entries are in document order.
   - `buildCaptionIndex(pdfPath: string): CaptionEntry[]`: runs `pdftotext -bbox-layout <pdf> -` once over the whole document (stdout, so nothing is written next to the PDF, and no page cap) and parses it; throws an `Error` naming the file when `pdftotext` fails or the file is missing.
   - `selectCaption(index, want: LabelKey, pageHint?: number)`: returns `{ ok: true, entry, notes }` or `{ ok: false, reason: 'label-not-found', labels }`. Candidates are the entries equal to `want` that are not continued (continued ones only when no other exists). The first candidate in document order wins; with a `pageHint`, the candidate on that page wins, and when no candidate is on the hinted page the first wins and `notes` contains `page-hint-ignored`. `labels` lists every distinct `label` in the index, in document order.
3. `scripts/figure-captions.ts` (new): `figure-captions.ts <pdf>` prints one line per entry, `p<page>\t<label>\t<first eight words of text>`, and exits 0; a missing argument or file exits non-zero with a usage line on stderr.
4. `tests/unit/figure-captions.test.ts` (new): runs offline on committed snapshots, including `Table 4` not equal to `Figure 4`, `Fig. 2(b)` parsing to `{Figure, 2, b}`, the continued-caption rule and the page-hint tie-breaker.
5. `tests/fixtures/figure-locator/captions/` (new): `w35275-p5.bbox.xml` and `w35275-p36.bbox.xml` (the output of `pdftotext -bbox-layout -f 5 -l 5` and `-f 36 -l 36` on `../explainer-batch/input/_held/w35275.pdf`, parsed with `firstPage` 5 and 36), and `synthetic.bbox.xml` (hand-written: a paragraph block containing "... sample. Figure 13. All in all, ..." mid-block, a continued caption, and a caption whose next word is lower case).

## Constraints

- `src/figure-vlm.ts`, `src/output.ts`, `src/preprocess.ts` and every other existing file are unchanged; nothing imports the new modules yet. The new modules must not import `src/figure-vlm.ts`.
- No new dependencies; poppler (`pdftotext`) is the only external tool, called with `spawnSync` and stdout capture.
- No page cap anywhere: the index covers every page.
- No network, no paid API calls, no vision calls.
- Do not commit PDFs, page images or crops; fixtures are text only.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a `node_modules` clone made as `## Family-specific notes` describes.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root, which sits beside the main checkout, so `../explainer-batch/input/_held/` holds the three PDFs. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write sandbox, no network; reads of `../explainer-batch/input/_held/` and writes under the OS temp dir are within that sandbox. Poppler 26.07 is on `PATH` (`/opt/homebrew/bin`).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/26-caption-index-and-label-parser.test.ts` exits 0 (12 tests: label parsing, equality, formatting, caption match and rejection, continued captions, index parsing with page, box and text, selection with the hint, the continued-only fallback and missing labels, the whole-document index of `w35275.pdf` with 17 captions and none from "Figure 8 presents", the other two held PDFs, a missing PDF throwing an error that names it, the CLI's exact eight-word line, and no import of the legacy module). Baseline on `dev`: red, 12 of 12 fail (first: `src/figure-locator/label.ts does not exist`).
2. **CLI (verifier):** `npx ts-node scripts/figure-captions.ts ../explainer-batch/input/_held/w35275.pdf` prints 17 lines, including lines starting `p5<TAB>Figure 1<TAB>Figure 1: Overview` and `p12<TAB>Figure 3<TAB>Figure 3: The Software` (`<TAB>` is one tab character), and `npx ts-node scripts/figure-captions.ts ../explainer-batch/input/_held/w35275.pdf | grep -c presents` prints `0`. Baseline on `dev`: red (the script does not exist).
3. **Unit test (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/figure-captions.test.ts` exits 0 and reads only files under `tests/fixtures/figure-locator/captions/` (no PDF, no poppler). Baseline on `dev`: red (no file).
4. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green (1 test).
5. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/26-caption-index-and-label-parser.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract` (this is also the evidence that `src/figure-vlm.ts` is unchanged). Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/26-caption-index-and-label-parser.test.ts`
- **Assertions digest:** `sha256:138ab32ea7a35ca6f6e7a47f1eaa26aec5a12d42aa1052356b8889d93fe72ae0`
- **Oracle proof:** On `dev` (`77909f6`) all 12 tests fail because `src/figure-locator/label.ts` and `captions.ts` do not exist. A throwaway reference in a detached scratch worktree (about 110 lines: the design's regex, a split-on-`<block` XML walk, the selection rule, a 6-line CLI) passed all 12 with `tsc --noEmit` clean; the worktree was removed and pruned. The reference met one trap the worker will meet too: the held PDFs are gitignored and exist only in the main checkout, so the test looks in `$EXPLAINER_HELD_DIR`, then `input/_held/` in the worktree, then `../explainer-batch/input/_held/`; a worktree that is not a sibling of the main checkout needs the variable. A lenient `parseLabel` regex with the `i` flag lets `[A-Z]` match lower case, so keep the number as written and lower-case only the panel.

## Out of scope

- Page geometry, ink bands, image boxes and the region rule (card 27), crops and asset files (card 28).
- Wiring the index into `attachFigureImage`, `src/figure-vlm.ts` or any pipeline path (W8); deleting legacy label code (W10).
- HTML figure labels and `--figure-label` parsing (W6); the `image_raster:` directive (W4).
- Any change to `skill.md` or prompts.

## Budget

- **Worker wall-clock:** 45 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** wave-1 medians in this repo's `state/cost-log.jsonl`: about 0.8M tokens per stage, p95 2.1M. Expect near the median: two small modules and a script against a fully specified rule.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported signatures of `label.ts` and `captions.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough; poppler reads the held PDFs outside the worktree, which the sandbox permits, and the test writes only under the OS temp dir. Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21 and reproduced the caption counts (17, 10, 22). Raised and folded in: the W4 versus W8 wording in Surfacing concern; the `node_modules` clone exempted from the outside-deliverables rule; the clean-tree criterion now also checks `git status --porcelain`; and the frozen test gained the continued-only fallback, an error that names the missing PDF and the exact eight-word CLI line. The remaining items it listed (usage text wording, one `pdftotext` call per document) are left to the verifier's reading of Deliverables 2 and 3.
