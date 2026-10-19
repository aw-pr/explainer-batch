# Stage card 14-explainer-prose-is-faithful-not-quippy: the prompt asks for faithful, plain prose and the caption prompts share its hard floor

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6 Astra <gpt-6-astra@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/14-explainer-prose-is-faithful-not-quippy
- **Worker effort:** high
- **Verifier effort:** medium
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** a rewrite of the production system prompt's voice, where the wording is the deliverable and a weak sentence changes every future explainer, so it needs a frontier writer. Astra writes it because the July GPT runs are the ones the old rules damaged most (33 of 34 sections ended on a quip), and a GPT author is best placed to word rules a GPT model will follow; Opus verifies from the other family. Card 02 before it on the same file is Opus/Astra, so the families alternate.
- **Open decisions:** none

## Surfacing concern

`skill.md:240` imported a personal Substack and LinkedIn voice into a neutral research explainer: "British dry wit and understatement", "Assertive: take positions", "Mix short punchy sentences", and "Close each section and the `end_takeaway` on a reversal or a quiet punchline". The checklist repeats the punchline rule (`:267`). The plain-terms rule (`4cceef7`, `:238`) was added beside these without removing them, so the two conflict. The pipeline reads only this file (`src/prompt.ts:4-19`), so the fix is here.

Measured over 85 real outputs: under the punchline rule 33 of 34 sections ended on an aphorism or reversal, and 8 of 8 `end_takeaway` blocks carried a bolted-on metaphor. The voice overclaims. Wu's headline says "beat bigger models, and it's not even close" while its own pill gives 46.8% vs 46.7%. Legolink's caveats section is undone by "every other approach is already on fire". The Flyvbjerg sol caption says huge overruns are "so common", but a fat tail is about size, not frequency (only 41% of IT projects overran at all); the prompt's own caption example at `skill.md:156` teaches that same gloss. Four GPT runs of the Demirer paper produced the same headline, and 16 of 19 recent headlines use "X, but Y", because the headline rules (`:221`) require a contrast clause.

The hard floor is stated three times and the two banned lists overlap (`:230`, `:243`, `:245-246`, `:265-266`); `skill.md` itself uses em dashes while banning them (`:156`, `:158`, `:230`). The caption prompts in the figure pipeline (`src/figure-vlm.ts:199`, `:821`; `src/figure-data.ts:201`) carry no em-dash or British rule and nothing stops a gloss changing what a statistic means. The British spelling rule and the no-semicolon headline rule do work (American spellings went from 169 to 0) and stay.

Cold read 2026-10-19 by the other family (codex exec, read-only, model gpt-6-sol): it asked whether the headline example, a real-sounding unsupported claim, should stay; deliverable 1 now replaces it. It also noted the rule order and the α gloss are judged by reading, not by the test; criterion 6 covers both.

## Objective

`buildSystemPrompt()` carries the 11 ranked style rules below in place of the voice rules, states the hard floor once with one merged banned list, contains no em dash, and no longer requires a contrast headline. The three caption prompts tell the vision model: British spelling, no em dash, and the plain-words gloss must not change what the statistic means.

## Inputs (read these in your own context)

- `skill.md` (whole file)
- `src/prompt.ts`
- `src/figure-vlm.ts` lines 139-205 and 805-827 (`selectionPrompt`, `candidatePrompt`)
- `src/figure-data.ts` lines 174-211 (`extractionPrompt`)
- `CLAUDE.md` (Claude-specific notes: `skill.md` is production code)
- `tests/contract/14-explainer-prose-is-faithful-not-quippy.test.ts` (the frozen oracle)
- This card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root. Line numbers are from 2026-10-19 and card 02 lands before this card on the same file, so find the sections by heading.

1. `skill.md`, "## Headline rules" (`:219-230`): the headline states the paper's main finding; "X, but Y" only when the finding really is a contrast. Drop "Plain-text lead clause + `, ` + contrast clause". Replace the example with a plainly illustrative headline whose finding really is a contrast and which names no real study. Keep the comma-before-but rule and "No semicolons". Move the em-dash bullet into the hard floor.
2. `skill.md`, "## Writing the prose" (`:234-248`): replace the voice paragraph, the plain-terms paragraph and the hard rules with these 11 rules, ranked, in this order:
   1. **Faithful.** State only what the paper supports. No invented statistics, quotes, metaphors or conclusions. Match the paper's own confidence and hedges.
   2. **Headlines and pills claim no more than the body.** Every number in them appears in the body. No claims about other researchers' motives or the whole field ("nobody", "pretending", "not even close").
   3. **Plain English.** Gloss each technical or statistical term on first use, including pills.
   4. **One idea per sentence**, about 28 words at most.
   5. **Lead each section with its finding.**
   6. **End a section on its most useful specific finding, number or caveat.** No recap and no manufactured twist. At most one figurative line per article; analogies only where they explain a mechanism.
   7. **`end_takeaway`** is the plain "so what" with the key number. Summary is allowed.
   8. **Tone is calm and neutral; dry at most.** No jokes.
   9. **Templates are capped:** ", not Y" at most twice per article; no "It is not X. It is Y." couplets; no verbless fragment closers.
   10. **Headline contrast** ("X, but Y") only when the finding really is a contrast.
   11. **Hard floor, stated once:** British English, no em dashes, one merged banned-phrase list (the union of `:245` and `:246`, plus the hedging-opener and rhetorical-question rules), each word or phrase listed once.
3. `skill.md`, "## Pre-delivery checklist": remove the punchline line (`:267`); fold the em-dash, banned-list and British lines (`:265-266`) into one line that points at the hard floor, so no banned word appears a second time.
4. `skill.md`, chart caption paragraph (`:156`, `:158`): replace the em dashes, and rewrite the α = 0.92 example so it glosses tail size, not frequency ("so common the average stops working" goes). Add to that paragraph that the plain-words gloss must not change what the statistic means. Remove any other em dash or horizontal bar left in `skill.md`.
5. `src/figure-vlm.ts`: export `selectionPrompt` and `candidatePrompt` (the test calls them as `selectionPrompt({})`, `selectionPrompt({ named: 'Figure 3' })` and `candidatePrompt({}, 4)`), and add to each prompt the caption rules: British spelling, no em dash, and the plain-words gloss must not change what the statistic means.
6. `src/figure-data.ts`: export `extractionPrompt` (called as `extractionPrompt({ sourceFigure: 'Figure 2' }, true)`) and add the same caption rules.

The test asserts these short phrases (case-insensitive unless marked). Use them as written; the sentences around them are yours:

- System prompt: `only what the paper supports`, `claim no more than the body`, `on first use`, `28 words`, `lead each section with its finding`, `no manufactured twist`, `at most one figurative line`, `so what`, `no jokes`, `at most twice`, `It is not X. It is Y.` (exact case), `only when the finding is a contrast` (`really` may sit before `is`), `British English` (exact case), `no em dashes`, `must not change what the statistic means`.
- System prompt, absent: `dry wit`, `understatement`, `assertive`, `take positions`, `punchy`, `punchline`, `reversal`, `+ contrast clause`, `so common the average stops working`, and any em dash or horizontal bar character.
- System prompt, exactly once each: `tapestry`, `delve`, `synergy`, `leverage`.
- Each caption prompt: `caption`, `no em dash`, `British` (exact case), `must not change what the statistic means`, and no em dash or horizontal bar character.

## Constraints

- Leave the chart guidance card 02 wrote alone, apart from the caption paragraph in deliverable 4.
- Keep "## JSON schema", "## Headline rules" and "## Pre-delivery checklist" as headings, and keep "No semicolons".
- The rules are prompt text, not code: no new validation, no style lint (card 15 does that).
- The caption-rule change in the figure pipeline is prompt text plus the three `export` keywords; no change to selection, cropping, parsing or provenance logic.
- En dashes between digits (`2–6`) are fine. British spelling in everything you write.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Baselines were taken on `dev` at `0cd17d7` on 2026-10-19.

1. **Contract test (verifier, Claude CLI seat):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/14-explainer-prose-is-faithful-not-quippy.test.ts` exits 0 with 6 passing tests. Baseline: red, 5 of 6 fail; the first is "system prompt is missing style rule 1 faithful", and the caption test fails at "selectionPrompt is not exported". The "rest of skill.md is still in place" test is green on the base and must stay green.
2. **Frozen block intact (verifier, same seat):** `bash scripts/check-contract-test-gate.sh print tests/contract/14-explainer-prose-is-faithful-not-quippy.test.ts` prints the digest recorded below. Baseline: green once committed to `dev`.
3. **Card 02 still holds (verifier, same seat):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/02-charts-come-only-from-stated-values.test.ts` exits 0. Baseline: red on `dev` today; green once card 02 has landed, which serial dispatch guarantees before this card runs. If card 02 has not landed, record this criterion as not applicable rather than failing it.
4. **Typecheck (verifier, same seat):** `npx tsc --noEmit` exits 0. Baseline: green.
5. **Scope (verifier, same seat):** `git diff --name-only dev...HEAD` lists only `skill.md`, `src/figure-vlm.ts` and `src/figure-data.ts`, plus this card's run state; `git diff dev...HEAD -- src/figure-vlm.ts src/figure-data.ts` shows only the `export` keywords and added prompt lines. Baseline: empty diff.
6. **Faithful wording (verifier, read of the diff):** the 11 rules appear in the order above, rule 11 is the only statement of the hard floor, and the α example glosses size, not frequency. Evidence: `git diff dev...HEAD -- skill.md`, quoted in the envelope.

## Contract test

- **Test file:** `tests/contract/14-explainer-prose-is-faithful-not-quippy.test.ts`
- **Assertions digest:** sha256:49e5b643a0c850e0667140fcf4fef2ad625af63e7efab1bf5c3f79e32a87c2b9
- **Oracle proof:** red on `dev` (`0cd17d7`, 2026-10-19): 5 of 6 tests fail, first at "system prompt is missing style rule 1 faithful"; the caption test fails because `selectionPrompt` is not exported. A throwaway reference (card 02's reference first, then the headline, prose, checklist and caption-paragraph rewrites, the three exports and one caption-rule line per prompt, in a detached scratch worktree, since removed) passed all 6, card 02's test stayed green on top of it, and `npx tsc --noEmit` stayed clean. Trap met by the reference: the "exactly once" counts fail while the checklist still lists the banned words, so the checklist line has to point at the hard floor instead of repeating it.

## Out of scope

- The chart rules (card 02) and any code-level style check (card 15).
- `src/prompt.ts`: card 02 owns its em dash and chart wording; the `image` sentence is a separate change.
- The repair prompt (`src/quality.ts:295`).
- The A/B test of old against new style (review plan item 36) and re-running any paper.
- The stale Cowork export and the `research-explainer` skill.

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** promo-flow cost log medians: Astra worker 6.8M tokens, Opus 5.5 verifier 2.6M. Three files, mostly prose; expect the worker at or below median.

## Dispatch envelope

Return:

- One result per acceptance criterion, with its evidence (command, exit code, the lines that decide it).
- The changed-file list.
- The new "## Headline rules" and "## Writing the prose" sections and the new caption-rule line, quoted in full.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Run worktree setup, every role:** the run worktree has no `node_modules`. Clone it from the shared checkout before running anything: `cp -cR ../explainer-batch/node_modules node_modules` (an APFS clone; never a symlink, never `npm install`).
- **Codex (worker):** workspace-write is enough. No network, no browser, no API keys: importing `src/figure-vlm.ts` and `src/figure-data.ts` has no side effects, and the test only calls the prompt builders.
