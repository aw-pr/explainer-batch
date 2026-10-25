# Stage card 39-numbered-vision-picker: when the text layer leaves more than one region beside a caption, a vision model picks one by number and nothing else

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/39-numbered-vision-picker
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/figure-locator/picker.ts, tests/unit/figure-picker.test.ts
- **Pairing rationale:** One new module with a fully specified reply grammar, fail-closed table and render helper, pinned by a frozen test that injects a fake vision function, so a mid-tier Claude worker at medium effort is enough and no frontier tier is needed. The verifier is the cheap OpenAI tier from the other family at high effort, because it must judge the stop rules against the design and re-run the 100 dpi renders on a held PDF. No gate: the module consumes only cards 27 and 28's landed `Rect` and `cropPdfRegion`. Its claims are new files only and overlap no other tranche-2 card, so it may pipeline with its neighbours (card 40 has an OpenAI worker, so worker families alternate).
- **Open decisions:** none

## Surfacing concern

Wave 2 of the figure redesign, card W7 of `docs/design/figure-locator.md` (`### W7. numbered-vision-picker`; the rules are `## Vision picker` and `### Stop rules`). Today a vision model chooses the figure itself and writes its caption and label: `candidatePrompt` (`src/figure-vlm.ts:821-844`) asks for a JSON selection with `source_figure`, `caption` and `alt_text`, `parseCandidateSelection` (`:846-867`) reads it, `chooseCandidateOnce` (`:869-891`) makes the call, and `verifyCrop` (`:328-368`) passes an unpinned pick on an unparseable reply (`:357`) or a transport error (`:366`) (design D2, D3, D16). In the new locator the text layer has already found the caption, so the model only chooses which of the regions beside it is the figure's complete body: the reply is one integer, `0` declines, and a pin fails closed. This card builds that picker as a pure function over injected vision plus one adapter to today's `runVision` (`src/vision.ts:179-219`), the single edit point stage 17 W13 will swap for its vision binding. Nothing calls it from the pipeline until W8. Lines re-checked against `dev` at `8bb4372` on 2026-10-21.

The stop names follow W7's outcome and `### Optional verify and failing closed for pins` (`picker-declined`, `picker-unavailable`, `verify-rejected`); the design's `### Stop rules` list folds a pinned unavailable picker into `picker-declined`, and W8 decides how the ladder reports either. The design's region rule (card 27) caps candidates at five bands plus the union region, so the picker's cap of six is never reached by today's caller; the cap is still asserted.

Cold read: see the note at the end of `## Family-specific notes`.

## Objective

`src/figure-locator/picker.ts` sends two to six labelled candidate crops (and the page, when given) in one vision call whose reply must be a single integer, maps the reply through the stop rules (a pin ends with no figure on a decline, an unparseable reply or a transport error; an unpinned request takes the largest candidate only when the picker is unavailable), never calls a model for a single candidate, adds exactly one yes/no verify call when `FIGURE_VERIFY=1`, renders candidate crops and the page at 100 dpi with poppler, and reaches a real model only through one adapter that calls `runVision`.

## Inputs (read these in your own context)

- `docs/design/figure-locator.md` (`## Vision picker`, `### Stop rules`, `### W7. numbered-vision-picker`)
- `src/figure-locator/geometry.ts` (`Rect`) and `src/figure-locator/pdf-crop.ts` (`cropPdfRegion`), landed by cards 27 and 28
- `src/vision.ts` (lines 160-232 only: `VisionCallOptions`, `runVision`, `resolveVisionProvider`) and `src/model-config.ts` (lines 100-102, `resolveVisionModel`); read, do not edit
- `src/figure-vlm.ts` (lines 328-368 and 821-891 only, the legacy verify and candidate selection this replaces; read, do not edit)
- `tests/contract/39-numbered-vision-picker.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/figure-locator/picker.ts` (new), exporting:
   - `PICKER_SYSTEM`, exactly `You are checking a figure crop for a research explainer. Reply with a single integer and nothing else.`
   - `VERIFY_SYSTEM`, exactly `You are checking a figure crop for a research explainer. Reply yes or no.`, and `VERIFY_PROMPT`, exactly `Is this one complete figure with no body text? Reply yes or no.`
   - `interface VisionRequest { system: string; prompt: string; imagePaths: string[]; labels: string[] }` and `type VisionFn = (req: VisionRequest) => Promise<string>` (the reply text).
   - `interface PickInput { label: string; captionText: string; candidates: Array<{ image: string; region: Rect }>; pageImage?: string; page?: number; pinned: boolean }`.
   - `parsePick(reply, count): number | null`: strip one surrounding code fence (with or without a language tag) and whitespace; the rest must match `^\s*(\d+)\s*$`. `0` returns `0` (a decline); `1` to `count` returns that number; anything else (a number above `count`, `2.`, `Candidate 2`, prose, JSON, a negative, empty) returns `null`.
   - `pickerPrompt(label, captionText, count, withPage): string`, exactly: `The caption on this page reads: <captionText>. Candidates 1 to <count> are regions beside that caption; the last image is the page. Which candidate is the complete body of <label> (every panel, axis and legend, no body text, no other figure)? Reply with the candidate number, or 0 if none is complete.`, where `; the last image is the page` is present only when `withPage` is true.
   - `pickRegion(input, vision = runPickerVision, env = process.env): Promise<PickResult>`, with `PickResult` either `{ ok: true, index, via: 'single' | 'picker' | 'largest', calls: { picker, verify }, notes }` (`index` is 0-based into `input.candidates`) or `{ ok: false, reason: 'picker-declined' | 'picker-unavailable' | 'verify-rejected', calls, notes }`. Rules, in order:
     1. Zero candidates rejects with an `Error` (a caller bug).
     2. One candidate returns `{ ok: true, index: 0, via: 'single', calls: { picker: 0, verify: 0 }, notes: [] }` with no call, whatever `FIGURE_VERIFY` says.
     3. Otherwise the first six candidates are sent in one call: `system` is `PICKER_SYSTEM`, `prompt` is `pickerPrompt(label, captionText, sent, Boolean(pageImage))`, `imagePaths` are the candidate images in order then `pageImage` when given, and `labels` are `Candidate 1` to `Candidate <sent>` then, when a page image is given, `Page <page>` (just `Page` when `page` is absent). `calls.picker` is 1 from here on. No retry is ever made.
     4. A reply that parses to `0` gives `picker-declined`, pinned or not.
     5. A reply that does not parse, or a thrown error, gives `picker-unavailable` when pinned. Unpinned, it gives `{ ok: true, via: 'largest' }` with `index` the sent candidate (one of the first six) with the largest region area (the first on a tie) and `notes` containing exactly `picker-unavailable: largest region taken`; this fallback is never verified.
     6. A reply `n` from 1 to `sent` picks `index = n - 1`. When `env.FIGURE_VERIFY` is exactly `1`, one more call is made with `system` `VERIFY_SYSTEM`, `prompt` `VERIFY_PROMPT`, `imagePaths` the picked candidate's image only and `labels` `['Candidate <n>']`; `calls.verify` is 1. The reply passes only when, after stripping a fence, whitespace and one trailing full stop, it is `yes` in any case; `no`, anything else and a thrown error give `verify-rejected`, pinned or not. Any other `FIGURE_VERIFY` value (unset, `0`, `yes`) makes no verify call.
     7. A successful pick returns `{ ok: true, index, via: 'picker', calls, notes: [] }`.
   - `runPickerVision(req): Promise<string>`: the adapter, and the only place in `src/figure-locator/` that calls a model. It calls `runVision` from `../vision` once, with `provider: resolveVisionProvider()`, `model: resolveVisionModel(provider)`, a small `maxTokens` (16 is enough), and the request's system, prompt, image paths and labels, and returns the reply's `text`.
   - `renderPickerImages(pdfPath, page, regions: Rect[], dir): { candidates: string[]; page: string } | null`: creates `dir`, writes `candidate-<i>.jpg` for each region with `cropPdfRegion(pdfPath, page, region, 100)` and the whole page at 100 dpi (`pdftoppm -jpeg -r 100 -f P -l P -singlefile`) as a JPEG in `dir`, and returns their paths; `null` when the PDF is missing or any render fails.
2. `tests/unit/figure-picker.test.ts` (new): the reply grammar, each stop rule and the verify rule with an injected fake vision function; no poppler and no model.

## Constraints

- The picker never chooses which figure, never writes a caption, alt text or label, and never asks for coordinates: the reply is a number.
- `src/figure-vlm.ts`, `src/vision.ts`, `src/model-config.ts` and every other existing file are unchanged; the new module does not import `src/figure-vlm.ts`, and no other file in `src/figure-locator/` imports `../vision`.
- Cards 26, 27 and 28 keep passing their frozen tests unchanged.
- No network, no paid API calls and no real vision calls in any test: every vision function in a test is a fake.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a `node_modules` clone made as `## Family-specific notes` describes.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root, which sits beside the main checkout, so `../explainer-batch/input/_held/` holds the held PDFs. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write sandbox, no network; reads of `../explainer-batch/input/_held/` and writes under the OS temp dir are within that sandbox; poppler 26.07 is on `PATH`.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/39-numbered-vision-picker.test.ts` exits 0 (11 tests: exports and the three exact strings, the reply grammar, the two-candidate call shape, the no-page prompt, the pinned stops, the unpinned largest-region fallback and its tie, the single candidate and zero candidates, the verify rule, the six-candidate cap, the 100 dpi renders on `w35275.pdf` page 5, and the single `runVision` call site). Baseline on `dev`: red, 11 of 11 fail (first: `src/figure-locator/picker.ts does not exist`).
2. **Earlier cards still hold (verifier):** `tests/contract/26-caption-index-and-label-parser.test.ts`, `27-page-geometry-and-region-rule.test.ts` and `28-pixel-space-crop-and-sidecar-asset.test.ts` (same command form) exit 0. Baseline on `dev`: green.
3. **Unit test (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/figure-picker.test.ts` exits 0. Baseline on `dev`: red (no file).
4. **Unit suite (verifier):** `npm test` exits 0. Baseline on `dev`: green (125 of 125).
5. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/39-numbered-vision-picker.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`; the worker leaves its changes uncommitted, so this lists the whole diff against the base (and is also the evidence that `src/figure-vlm.ts` and `src/vision.ts` are unchanged). Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/39-numbered-vision-picker.test.ts`
- **Assertions digest:** `sha256:482b74c81260ac05896573fceb4b61c90a4c611160fcc1e16214cb784f9bda1c`
- **Oracle proof:** On `dev` (`8bb4372`) all 11 tests fail because `src/figure-locator/picker.ts` does not exist. A throwaway reference (about 100 lines) in a detached scratch worktree, stacked with the other tranche-2 figure references, passed all 11, `tsc --noEmit` was clean, cards 26 to 28 still passed and `npm test` passed 125 of 125; the worktree was removed and pruned. Its renders on `w35275.pdf` page 5 were 279 by 279 and 500 by 139 pixels for the two test regions and 850 by 1100 for the page.

## Out of scope

- Calling the picker from the ladder, building candidate regions or choosing provenance (`vlm-crop` is W8's mapping of `via: 'picker'`).
- Stage 17's vision binding (W13 swaps `runPickerVision`'s body).
- DOM candidates (card 41) and the arXiv step (card 40).
- Any edit to `src/figure-vlm.ts`, `src/vision.ts`, `src/model-config.ts` or `src/output.ts`.

## Budget

- **Worker wall-clock:** 40 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** wave-2 tranche-1 figure cards in this repo's `state/cost-log.jsonl` (cards 26 to 28): 0.76M to 1.96M tokens per stage. Expect below that: one module of about 100 lines against a fully specified table.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The final `src/figure-locator/picker.ts` export list.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls and no real vision calls. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough; poppler reads the held PDFs outside the worktree, which the sandbox permits, and the test writes only under the OS temp dir. Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family) read this card and its test on 2026-10-21. Raised and folded in: the page label when `page` is absent, the largest-region fallback counting only the six sent candidates, the stop names against the design's `### Stop rules`, and the clean-tree criterion's evidence now stated as the uncommitted diff. It also noted that the frozen test checks prompt fragments plus `pickerPrompt` equality rather than the full literal, and the adapter by its call site only; Deliverable 1 states the exact strings and arguments for the verifier's reading and the unit test.
