# Stage card 10-a-pinned-figure-is-the-figure-or-nothing: a pinned figure is the figure that was asked for, or no figure at all

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Verifier:** GPT-6 Astra <gpt-6-astra@local>
- **Base branch:** dev
- **Run branch:** autometta/10-a-pinned-figure-is-the-figure-or-nothing
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** The change decides when a figure is dropped on four extraction paths (PDF, snapshot, live URL candidates, full-page tiles), two of which only a code read can check, so it is judgement work that earns the Opus 5.5 worker. The verifier is the other family's frontier tier (GPT-6 Astra), reading the fail-closed rules cold. The next card (11) has a Terra worker, so the worker family alternates. Serial because cards 11, 12 and 13 also edit `src/figure-vlm.ts`.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19, section 2b items 2 and 7 (plan item 14, last clause). Lines checked against `dev` at 0cd17d7:

- The drift guard in `extractFromPdf` (`src/figure-vlm.ts:633`) fires only when the selection reports a label and that label differs from the pin. If the model omits `source_figure`, or names the pin while showing another figure, the guard passes.
- The result is then stamped `label = baseOpts.named ?? sel.source_figure ?? 'Figure'` (`:682`; the same line on the live URL path at `:1054` and the full-page path at `:1164`). The live URL and full-page paths have no drift guard at all.
- `verifyCrop` (`:321-355`) is never told which figure was wanted (prompt at `:327-332`). It returns `ok` on an unparseable reply (`:345`) and on a transport error (`:350-353`).
- The snapshot path (`extractFromSnapshot`, `:905-968`) matches a pin on the DOM caption label (`:932-946`) and returns it with no verification at all.
- Evidence: the local, untracked `output/2026-07-31_demirer_writing-code-shipping-code_explainer.json` has `image.source_figure` "Figure 1" (pinned through `recreate: Figure 1` in its sidecar), but the pixels are Figure 3, "The Software Production Hierarchy" (PDF p.12; Figure 1 is on p.5). Its `recreated_figure` beside it is the real Figure 1, so the page shows two different figures under one label.

## Objective

When a figure is pinned (an `image:` directive or a `recreate: Figure N` target, which reach `extractFigureViaVlm` as `override.source_figure`), every extraction path returns either a crop that the selection named as the pinned figure and that verification, told the expected label, confirmed; or `null`. A selection that omits its label or names another figure, an unparseable verification reply, a verification transport error and an explicit rejection all end in `null` for a pin, never in a figure stamped with the pin. Unpinned picks keep today's behaviour, including fail-open verification, and are labelled from the selection.

## Inputs (read these in your own context)

- `AGENTS.md`, `CLAUDE.md`
- `src/figure-vlm.ts` (`verifyCrop`, `extractFromPdf`, `extractFromSnapshot`, `extractFromUrl`, `extractFromFullPage`, `figureLabelKey`, `extractFigureViaVlm`)
- `src/output.ts` (`attachFigureImage`, read only: it already drops `json.image` when extraction returns `null`)
- `docs/FIGURE-EXTRACTION.md` (the verification and pinned-figure passages)
- `tests/contract/10-a-pinned-figure-is-the-figure-or-nothing.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/figure-vlm.ts`:
   - `verifyCrop` takes an optional expected label. When one is given, its prompt names it (for example "The crop must be Figure 3 of the source document; fail the check if it shows a different figure") and the reply format stays `{"ok": <bool>, "reason": "<text>"}`. With an expected label, an unparseable reply and a transport error return `ok: false`; without one they return `ok: true` as today.
   - `extractFromPdf`: for a pin, a selection whose `source_figure` is missing or whose `figureLabelKey` differs from the pin's is treated as drift (retry with the reason, then `null`). Every `verifyCrop` call passes the pin. The label is the pin only on the pinned branch and the selection's label (or `'Figure'`) otherwise; no `named ?? ...` fallback expression remains.
   - `extractFromUrl` and `extractFromFullPage`: the same drift rule for a pin, the pin passed to `verifyCrop`, and the same labelling rule. These two paths need Playwright, so the contract test cannot reach them; the verifier checks them by reading the code.
   - `extractFromSnapshot`: exported with its current signature. A pinned caption match is verified with `verifyCrop` and the pin before it is returned, and a failed verification returns `null` (the caller then falls through to the live path as today). The unpinned snapshot pick is unchanged.
   - Every vision call made for a pinned figure names the pinned label in its system or user prompt (selection and refine already do).
2. `docs/FIGURE-EXTRACTION.md`: the verification passage says verification is told the expected label for a pin and fails closed for a pin (transport error, unparseable reply, rejection), while unpinned picks still fail open; and that the snapshot path verifies a pinned match. The known-limitations bullet "Fail-open on verification transport errors" (`:240`) is narrowed to unpinned picks, and the "Pinning means this figure or nothing" passage (`:101-107`) says a selection with no label is rejected as well as one naming a different figure.

## Constraints

- Unpinned behaviour does not change: same calls, same fail-open verification, same labels, same caption and alt text.
- `FIGURE_VLM_VERIFY=0` still disables verification for every pick, pins included: it is the operator's explicit opt-out, and the contract test runs with it set to `1`.
- `figureLabelKey` keeps its current semantics (its noun and panel-letter defects are a separate finding).
- No change to selection prompts beyond naming the pin, to the pad ladder, to crop maths, to page limits or to the model or provider resolution (cards 11, 12 and 13 own those).
- Do not make a figure failure fail a paper: `extractFigureViaVlm` still returns `null` rather than throwing.
- `src/output.ts` is not changed; it already deletes `json.image` on `null`.
- No network and no paid API calls while working; the contract test stubs `runVision`, `fetch` and the vision auth checks.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6 Astra verifier under Codex workspace-write; no network needed (`pdftoppm` and `sips` run locally).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/10-a-pinned-figure-is-the-figure-or-nothing.test.ts` exits 0. It covers the PDF path (confirmed pin, omitted label, other label, unparseable verification, transport failure, rejection, three unpinned regressions), the exported snapshot path (pinned verification with the label, unparseable and transport failures, unpinned regression) and a source scan for the `named ??` stamp. Baseline on `dev`: red, 10 of 15 tests fail (first: "every vision call for a pinned figure, verification included, must name the expected label"); the different-label, rejection and three unpinned PDF tests pass on `dev` as regression guards.
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Live paths (verifier, code read):** `grep -n "verifyCrop(" src/figure-vlm.ts` lists every call site; each one inside `extractFromUrl`, `extractFromFullPage`, `extractFromPdf` and `extractFromSnapshot` passes the pin, and `extractFromUrl` and `extractFromFullPage` reject a missing or different selection label for a pin before cropping. Quote the lines in the envelope. Baseline on `dev`: red (no call passes a label; neither live path has a drift guard).
4. **Docs (verifier):** `grep -n -i "fail.*closed\|fails closed" docs/FIGURE-EXTRACTION.md` prints the new verification passage. Baseline on `dev`: red (no match).
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/10-a-pinned-figure-is-the-figure-or-nothing.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/10-a-pinned-figure-is-the-figure-or-nothing.test.ts`
- **Assertions digest:** `sha256:d149d7f6b3fbe26851153c54e7331ff3a6972dfdbc26dce0d81627933def4864`
- **Oracle proof:** On `dev` (0cd17d7) 10 of 15 tests fail for the card's reason: the confirmed-pin test at "every vision call for a pinned figure, verification included, must name the expected label"; the omitted-label, unparseable and transport tests return a figure stamped "Figure 3" instead of `null`; `extractFromSnapshot` is not exported, so the four snapshot tests fail; the source scan finds `baseOpts.named ??` at `:682`, `:1054` and `:1164`. The different-label, rejection and three unpinned tests pass on `dev`. A throwaway reference in a detached scratch worktree (an optional label on `verifyCrop` that fails closed when set, the drift rule extended to a missing label, the pin passed at all four `verifyCrop` sites, the labelling rule on all three paths, `extractFromSnapshot` exported and verifying a pinned match) passed all 15 with `tsc --noEmit` clean; the worktree was removed and pruned. The stub model id was then changed from a placeholder to `claude-sonnet-5-5` so card 13's provider check accepts it; the base result was re-run and is unchanged. Traps: the test tells a selection call from a refine or verify call by image count (more than one image is a selection), so keep verification to one image per call; the fixture PDF is built in the test with a grey-noise image so no crop trips `looksBlank`; the test pins every `FIGURE_VLM_*` knob in `process.env` before loading `src/`, because they are read at module load.

## Out of scope

- Locating the pinned figure from the PDF text layer (`pdftotext -bbox-layout`) and any deterministic region finder: wave-2 design card 18.
- `figureLabelKey` noun and panel-letter handling, multi-panel de-duplication, the `graph` class selector, the 24-page cap.
- `src/output.ts` and `scripts/reextract-figure.ts` label handling (`pickedFigure = effOverride?.source_figure ?? result.source_figure`), which is correct once extraction returns only confirmed pins.
- Page-size crop maths and PDF URLs (card 11), selection steering (card 12), vision model resolution (card 13).

## Budget

- **Worker wall-clock:** 90 minutes
- **Verifier wall-clock:** 40 minutes
- **Spend basis:** promo-flow medians: Opus 5.5 worker about 18M tokens (p95 43M), Astra verifier about 2.6M. Expect below the median: the reference diff is about 30 lines in one file plus a docs paragraph. Hold one re-brief at the median.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it (criterion 3 quotes each `verifyCrop` call and the drift checks on the live paths).
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls.
- **Codex (verifier):** workspace-write with no network is enough; the test stubs `fetch` and the vision module and writes only under the OS temp dir. `pdftoppm` (poppler) and `sips` must be on `PATH`. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Both roles:** do not create `.env.local` in the run worktree.
