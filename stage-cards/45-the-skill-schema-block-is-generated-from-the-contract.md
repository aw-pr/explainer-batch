# Stage card 45-the-skill-schema-block-is-generated-from-the-contract: skill.md shows the model the v2 wire schema, generated from the contract, and its prose asks for v2

## Metadata

- **Authored:** 2026-10-22
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/45-the-skill-schema-block-is-generated-from-the-contract
- **Worker effort:** high
- **Verifier effort:** medium
- **Verifier panel:** false
- **Path claims:** skill.md, scripts/contract-build.ts, src/prompt.ts, tests/unit/contract.test.ts, README.md, AGENTS.md
- **Pairing rationale:** A small renderer plus a rewrite of the production system prompt, pinned by a frozen test that names every v1 field to remove, every v2 field to name and every frozen sentence to keep. GPT-6.1 Sol at high fits, and the operator asked on 2026-10-22 to bias token spend towards OpenAI. The verifier is Claude Opus 5.5 at medium from the other family, not Sonnet, because judging whether the rewritten prose still reads as one coherent instruction to the model is the judgement-heavy part. Neither role needs Fable or Astra.
- **Open decisions:** none

## Surfacing concern

Design 16 (`docs/design/content-contract-v2.md`), wave-2 card W5, the first of four cards that land back to back: W5 (this card) changes what the model is asked for, and W6a, W6b and W6c change what the pipeline accepts and stores.

**Production pause (operator decision, 2026-10-22).** No explainer-batch production run, batch or sync, from the moment this card lands until W6c lands. Between W5 and W6 the prompt asks for v2 while the pipeline still validates, repairs and saves v1, so a run in that window would write broken explainers. There is no feature flag. The four cards are carded before any is queued.

**Interactive skill.** `~/.claude/skills/explainer-batch/SKILL.md` on the operator's machine is a symlink to this file, so this card also changes the interactive explainer-batch skill. The markers are HTML comments and render as nothing.

Settled by the orchestrator:

- **The block renders the OpenAI dialect** (`contract/generated/model-output.openai.json`), the strictest, so the model reads what the API enforces (design `### Artefacts and their producers`, Q9). Editorial string bounds (`hero.title` max 80) are not in that dialect and so not in the block; array bounds (`minItems`, `maxItems`) are.
- **Pill `text` stays a lowercase continuation of `lead`.** The generated description reads "One sentence saying what the lead means"; the hand-written rule says the lead and the text read together as that one sentence, which is how all 172 live pills are written. `contract/explainer-v2.ts` does not change (cards 43 and 44 pin its hash).
- **The user instruction does not change here.** `buildUserInstruction()` still asks for `metadata.date_created`, `filename_slug` and `Published Month Year`; frozen contracts 14 and 42 pin it, and W6b rewrites it with the citation-aware turn. Between W5 and W6b the two disagree, which is one more reason for the production pause.
- **One chart for every source.** The wire schema caps `charts` at one. The URL sentence frozen by contract 02 stays true by covering both sources.
- **Frozen contracts.** Contract 42 asserts `skill.md` has no `CONTRACT-V2-BEGIN`; the orchestrator re-freezes that one assertion in the commit that queues this card (see `## Contract test`). Contracts 02, 14 and 20 survive unedited if the sentences listed under Constraints stay outside the markers.

## Objective

`skill.md` carries a schema block generated from the v2 wire contract between two markers, `contract:build` writes it and `contract:check` fails when it is stale, the hand-written prose around it asks for v2 fields only, and the system prompt the model receives contains neither marker.

## Inputs (read these in your own context)

- `skill.md` (all of it) and `src/prompt.ts`
- `scripts/contract-build.ts`, `contract/dialects.ts` (`generateSchemas`), `contract/generated/model-output.openai.json`
- `contract/explainer-v2.ts`, `ModelOutputV2` only (lines about 70 to 300), read only
- `docs/design/content-contract-v2.md`: `## Schema v2`, `### Artefacts and their producers`, `### Build and check`, Q4, Q6, Q9 under `## Open questions`, and `### W5`
- `tests/unit/contract.test.ts`
- The frozen tests whose sentences you must keep: `tests/contract/02-*.test.ts`, `14-*.test.ts`, `20-*.test.ts` (lines 391 to 418), `42-*.test.ts` (lines 217 to 247)
- `tests/contract/45-the-skill-schema-block-is-generated-from-the-contract.test.ts` (frozen) and this card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

Every file listed here must be created or modified, except the frozen contract tests, which already exist and must not be edited. Paths are relative to the repo root.

1. `scripts/contract-build.ts`:
   - Export `renderSkillBlock(): string`, a pure function of the OpenAI dialect. It returns the text that sits between the markers, the markers excluded. It renders an annotated skeleton in one fenced code block, in the style of today's block at `skill.md:36-64`: one line per property, as `"<key>": `, in the dialect's property order and nested as the schema nests. Every `description` in the dialect appears verbatim: the root's, each property's, each array's `items` and each `anyOf` branch's. Each property's line carries its type in words (`string`, `integer`, `number`, `boolean`, `object`, `array`), its `enum` values as JSON literals, `or null` when its type admits null, and its array bounds written as `minItems: N` and `maxItems: N` on the property's own line. The `top_block` alternatives each appear with their own keys (`"kind": "pills"` with `"pills"`, `"kind": "takeaway"` with `"label"` and `"body"`). Nothing in the block names a key that is not in the dialect.
   - Export `renderSkill(current: string): string`: returns `current` with everything between `<!-- CONTRACT-V2-BEGIN -->` and `<!-- CONTRACT-V2-END -->` replaced by `renderSkillBlock()`, byte-identical outside them. It throws an error naming the markers when either marker is missing or appears more than once.
   - `checkContract()` also compares `skill.md` with `renderSkill(skill.md)` and reports drift for `skill.md` by name; `contract:build` writes `skill.md` when it differs, through the same write-if-changed path, and leaves it byte-identical when it does not.
2. `skill.md`:
   - Exactly one marker pair, inside `## JSON schema`, in place of today's hand-written block; the block between them is the output of `contract:build`.
   - The prose outside the markers is rewritten for v2. Where today's prose conflicts with the dialect, the dialect wins: every key is present, so `charts` is `[]` when there is no chart and `end_takeaway`, `figure_request`, `list`, `table` and `emphasis` are `null` when unused, never omitted. It no longer mentions the `version` field, `metadata` (`title`, `eyebrow`, `date_created`, `filename_slug`), `headline_html`, `<span>`, `hero.publication_date`, `accent_color`, pill `number`/`description`, `paragraphs_html`, `align`, `config_json`, Chart.js or its option paths (`options.scales`, `title.display`), `references`, an HTML reference string, a bracketed caption source tag, or `recreated_figure`.
   - It does describe: `hero.emphasis` (a phrase copied exactly from `headline`, or null), pills as `{lead, text}` with the continuation rule above, paragraphs and list bodies as inline text that may use `<em>`, `<strong>`, `<code>`, `<sub>`, `<sup>` and `<a href>` only, `table.source {ref, page}` with a caption that carries no tag, the neutral chart (`kind`, `x`, `y`, `series[].source {kind, ref, page}`, with `x.unit`/`y.unit` replacing the Chart.js axis-title rule), at most one chart, `figure_request`, and `citation` (the paper's own citation from its front matter, `null` only when the instruction says the citation is already known; never a placeholder author).
   - The frontmatter `description` no longer says pills and references may carry inline markup.
   - The Pre-delivery checklist drops the slug, byline-in-metadata, `Published Month Year`, caption-tag and HTML-reference items and gains items for `emphasis`, `citation` and the chart's `source`.
3. `src/prompt.ts`: `buildSystemPrompt()` removes the two marker lines (each marker and its line ending) and is otherwise unchanged. `buildUserInstruction()` is unchanged.
4. `tests/unit/contract.test.ts`: tests that `renderSkill` replaces only the text between the markers, throws for a missing marker and for a duplicated one, and that `renderSkillBlock()` names every top-level wire property. The existing `checkContract()` test still passes.
5. `README.md` (around line 268) and `AGENTS.md` (around line 46): the sentence saying the body of `skill.md` is sent verbatim gains that the two contract markers are stripped and the block between them is generated by `npm run contract:build`.

## Constraints

- These sentences and words stay in `skill.md`, outside the markers, because frozen contracts 02, 14 and 42 match them:
  - Contract 02's rules, each present in some sentence of the system prompt: "never read values off", "stated in the text or a table", "names the table or page" (now said of a `source`, not a caption tag), "pie, doughnut or radar" banned, "never join categories with a line", "never split a reported range", no stacked bars on a log axis, "prefer a `table`", and "at most one chart" in a sentence that also says `URL`. Every sentence naming pie, doughnut, radar or spider also says no, never, not or banned. The prompt still contains `"table": {` (the generated block satisfies this).
  - Contract 14's rules 1 to 11 under `## Writing the prose`, "must not change what the statistic means", the headings `## JSON schema`, `## Headline rules` and `## Pre-delivery checklist`, "No semicolons", and `tapestry`, `delve`, `synergy` and `leverage` exactly once each in the system prompt (the generated block must not add any of them).
  - Contract 42's three sentences: "Do not emit an `image` field or any image bytes; name the figure in `figure_request` and the pipeline locates and attaches it.", "Figures are never a source of chart values." and the checklist line "- [ ] `figure_request` names one figure by the paper's own label, or is null."; a paragraph naming `` `figure_request.label` `` that says "key results figure" and "null"; no line starting `"image":`; and no "NEVER emit" or "vision model picks".
- No em dash anywhere in the system prompt, British English, and none of contract 02's removed phrasings ("match the axes", "faithfully recreated", "reproduce it").
- `contract/` (sources and `generated/`) does not change. `npm run contract:build` on the finished tree writes nothing.
- `buildUserInstruction()`, `src/output.ts` and everything else under `src/` except `src/prompt.ts` do not change. This card changes no pipeline behaviour.
- `WEBSITE_REPO= npm run contract:check` stays the gate. Do not run `contract:build --website` or write outside this worktree.
- No network and no paid API calls. Do not run the explainer pipeline.
- Do not create or modify files outside the deliverables, except this card's run state. What the frozen tests do themselves when criterion 2 runs them is not a breach: cards 20, 39 and 42 write scratch files under the system temporary directory and clean up, and card 20 runs its own `contract:build --website` into a directory under the system temporary directory and restores `contract/generated/`. Run them as they are.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: the Claude Opus 5.5 verifier through the Claude CLI, no network needed.

Baseline on `dev` at `a28de35` with the frozen test and the contract-42 re-freeze present (recorded 2026-10-22): 1 red, 15 of 16 failing (details under `## Contract test`); 2 red only at contract 42's marker assertion; 3, 4 and 5 green except the marker count in 5; `npm test` 195 of 195 and the frozen suite 387 of 387 before the re-freeze.

Run the frozen suites with `--test-concurrency=1`: this card's test rewrites `skill.md` for a moment and runs `contract:build`, and contract 20 corrupts and restores a generated file, so the two must not run at the same time.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/45-the-skill-schema-block-is-generated-from-the-contract.test.ts` exits 0, 16 of 16.
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test --test-concurrency=1 $(ls tests/contract/*.test.ts | grep -v -e '/26-' -e '/27-' -e '/28-')` exits 0, cards 02, 14, 20 and the re-frozen 42 included. Contracts 26 to 28 read held PDFs under `input/_held/`, which a run worktree does not have; this card touches nothing they test. Contracts 39 and 42 also read held PDFs, through the sibling `../explainer-batch` checkout, which a run worktree under `~/repos` has.
3. **Types (verifier):** `npx tsc --noEmit` exits 0, and `npx tsc --noEmit --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck contract/*.ts scripts/contract-build.ts` exits 0.
4. **Unit suite (verifier):** `npm test` exits 0 and lists the new `renderSkill` tests.
5. **Drift gate (verifier):** `WEBSITE_REPO= npm run contract:check` prints `contract: generated files up to date`; `grep -c 'CONTRACT-V2-BEGIN' skill.md` prints 1.
6. **Prose reads as one instruction (verifier, judgement):** read the system prompt as `node -e "require('ts-node/register'); console.log(require('./src/prompt').buildSystemPrompt())"` prints it. No sentence outside the block contradicts the block (a field it names that the block lacks, a shape it describes that the block does not have), and every rule in today's prompt that still applies to v2 is still there. Also check what the frozen test cannot: nested properties appear in the dialect's order, every property's annotation sits on its own line, and every array bound in the dialect is shown. Name any contradiction found.
7. **Frozen blocks intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/45-the-skill-schema-block-is-generated-from-the-contract.test.ts` prints the digest recorded below, and `git diff dev -- tests/contract` is empty.
8. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, and `git diff dev -- src/prompt.ts` changes only `buildSystemPrompt()`. A `node_modules` clone is gitignored and does not appear.

## Contract test

- **Test file:** `tests/contract/45-the-skill-schema-block-is-generated-from-the-contract.test.ts`
- **Assertions digest:** `sha256:e2be4e8b32145a3a4264cdbff1e4a749da8f2cb31a7be93708097d20fcd17469`
- **Oracle proof:**
  - **Drafted** by a read-only GPT-6.1 Sol session from this card; reviewed by the orchestrator, who removed hash pins on `src/`, `src/output.ts`, the contract tree and the user-instruction literal (each would have failed W6a or W6b when they land; criterion 8 covers "nothing else changes" for this run), let the prose say "version", and made the `NEVER emit` check case-sensitive as contract 42's is.
  - **Red on `dev` `a28de35`:** 15 of 16 fail: no markers, no `renderSkill` or `renderSkillBlock` export, v1 tokens (`headline_html` first) in the system prompt, the frontmatter allowing markup in pills and references, no README or AGENTS sentence. `contract build leaves finished artefacts untouched` passes by design (a regression guard). Re-frozen contract 42: 1 of 10 fails, the marker count.
  - **Green on a throwaway reference** (a detached scratch worktree, removed and pruned; nothing committed): 16 of 16; `npm test` 195; both `tsc` runs and `contract:check` green; the frozen suite with `--test-concurrency=1` green except 5 held-PDF tests (contract 39's picker render and four of contract 42's), which find the PDFs through the sibling `../explainer-batch` checkout that the scratch location lacked. Contracts 02, 14 and 20 passed unedited. The reference was a 90-line recursive renderer, a one-line marker strip, a rewrite of about 120 lines of `skill.md` and one sentence each in README and AGENTS.
  - **Traps the reference met:** the test reads the bounds from a `"sections":` line or the `//` comment lines right after it, as `minItems: 2` and `maxItems: 5`; a description's quoted example (`"In short"`) must not be followed by a colon or it reads as an invented key; an `anyOf` of objects (`top_block`) renders each branch's keys. Contract 02's `names the table or page` and URL-chart sentences are satisfiable with v2 wording ("Each series' `source` names the table or page...", "Every explainer, from a PDF or a URL source, gets at most one chart.").
- **Re-freeze in the same commit:** `tests/contract/42-synthesis-names-the-figure.test.ts` line 230 now asserts exactly one `CONTRACT-V2-BEGIN` in `skill.md` and none in the system prompt; nothing else in that file changed. Card 42's recorded digest is updated to `sha256:1dff820825ecc04d2bc09d4ee3e0736b7686262dd5d9931b56ad6437e0800d26`.

## Out of scope

- `buildUserInstruction()`, the citation-aware user turn and structured detection: W6b.
- The save path, the repair loop, `src/quality.ts`, `src/output.ts` and the provider schemas: W6a and W6b.
- Any change to `contract/explainer-v2.ts`, including its `.describe()` texts.
- The figure sidecar and `recreated_figure`: W6c and W8.

## Budget

- **Worker wall-clock:** 50 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** card 42 (prompt text plus frozen sentence constraints) and card 20 (the generator): about 2M tokens for the stage.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The generated block as it sits in `skill.md`, and the `git diff` of `scripts/contract-build.ts` and `src/prompt.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to a frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls and write nothing outside the worktree beyond what the frozen tests themselves write under the system temporary directory.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family from the verifier) read this card and its test on 2026-10-22. Folded in: every node's description is required, the root's included; where the old prose let `charts` or `end_takeaway` be omitted, the dialect wins (`[]` and `null`); the ban is on the `version` field, not the word; contract 20's scratch build is under the system temporary directory, and the verifier note allows what the frozen tests write there; criterion 6 now covers what the test cannot (nested order, one annotation per line, every array bound). It also noted the user instruction still asks for v1 fields; that is deliberate (Surfacing concern) and closed by W6b.
