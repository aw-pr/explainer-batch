# Stage card 13-vision-has-its-own-model-per-provider: figure vision uses its own model per provider and refuses a model from the other provider

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Codex GPT-5.6 Terra <codex-gpt-5-6-terra@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/13-vision-has-its-own-model-per-provider
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Dispatch:** serial
- **Pairing rationale:** Mechanical: one new config field, one matcher, three call sites and a CLI preflight, all specified here, so the batch-lane worker tier (Terra) fits; the verifier is the other family's mechanical tier (Sonnet 5.5). Serial because it shares `src/model-config.ts` with card 05's docs claims and `src/index.ts` and the figure modules with later wave-1 cards.
- **Open decisions:** none

## Surfacing concern

Review of 2026-10-19 (plan item 10, high finding at `src/figure-vlm.ts:237`). Lines checked against `dev` at 0cd17d7:

- `src/figure-vlm.ts:236-238`: the selection model is `FIGURE_VLM_MODEL ?? getModelConfig(provider).batchModel`, and `batchModel` reads `MODEL_BATCH ?? MODEL` (`src/model-config.ts:59`, `:72`). So `MODEL_BATCH=gpt-5.6-sol` for an OpenAI synthesis run is sent as the vision model to Claude whenever Claude is the vision provider.
- `src/vision.ts:222-232`: `resolveVisionProvider()` picks the provider from whatever credentials are present (Claude OAuth first, then codex, then API keys), independently of `--provider`, so a Claude id can be sent to codex or the reverse.
- `src/figure-vlm.ts:265-267` (the review's ":265-267" is in this file, not `vision.ts`): `selectFigureOnce` catches the provider's rejection and logs a warning, and `extractFigureViaVlm` (`:1195-1222`) returns `null`, so the explainer is saved with no figure and nothing says why.
- Claims closure found two more vision-role models with the same fallback: the verify model (`src/figure-vlm.ts:326`, `FIGURE_VLM_VERIFY_MODEL ?? visionModel`) and the figure-data model (`src/figure-data.ts:42-44`, `FIGURE_DATA_MODEL ?? FIGURE_VLM_MODEL ?? batchModel`).

## Objective

`getModelConfig(provider)` carries a `visionModel` (`FIGURE_VLM_MODEL`, then `config/models.json` `visionModel`, then the default `claude-opus-4-8` for Claude and `gpt-5.6-terra` for OpenAI; `MODEL` and `MODEL_BATCH` no longer reach it). `resolveVisionModel(provider)`, exported from `src/model-config.ts`, returns that model or throws an error naming both the model and the provider when the model belongs to the other provider. The selection, verify and figure-data models all go through the same check. A mismatch makes `extractFigureViaVlm` and `recreateFigureData` reject instead of returning `null`, and the CLI (`process`, `submit`, `poll`) refuses to start with a non-zero exit before any paid call.

The defaults equal today's effective defaults, so a run with no overrides uses the same vision models as before.

## Inputs (read these in your own context)

- `AGENTS.md`, `CLAUDE.md`
- `src/model-config.ts`
- `src/vision.ts` (`resolveVisionProvider`, `visionAuthAvailable`)
- `src/figure-vlm.ts` (`visionModel`, `selectFigureOnce`, `verifyCrop`, `extractFigureViaVlm`)
- `src/figure-data.ts` (`dataModel`, `recreateFigureData`)
- `src/index.ts` (`main`, `assertProviderAuth`)
- `config/models.json.example`
- `docs/FIGURE-EXTRACTION.md` (the env table and the figure-data knobs)
- `tests/contract/13-vision-has-its-own-model-per-provider.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. `src/model-config.ts`: `visionModel` on `ModelConfig` and the file config, resolved as in the Objective. One exported matcher decides whether a model id belongs to a provider (a Claude id starts `claude-`; every other id belongs to OpenAI). Exported `resolveVisionModel(provider)` as in the Objective, plus resolvers for the verify model (`FIGURE_VLM_VERIFY_MODEL` when set, else the vision model) and the figure-data model (`FIGURE_DATA_MODEL` when set, else the vision model), each checked by the same matcher and each throwing an error that names the env knob, the model and the provider.
2. `src/figure-vlm.ts`: `visionModel()` and `verifyCrop` use the resolvers; `extractFigureViaVlm` resolves the selection and verify models immediately after choosing the provider and before its `try`, so a mismatch rejects. The `getModelConfig(...).batchModel` fallback is gone.
3. `src/figure-data.ts`: `dataModel()` uses its resolver; `recreateFigureData` resolves it immediately after choosing the provider and before any work, so a mismatch rejects.
4. `src/index.ts`: after `assertProviderAuth` and before `poll`, preprocess, submit or sync, when `visionAuthAvailable()` is true, resolve the vision provider and all three vision-role models; a mismatch exits non-zero through the existing `main().catch` with the resolver's message. `status` is not affected.
5. `config/models.json.example`: `visionModel` for both providers with the defaults above.
6. `docs/FIGURE-EXTRACTION.md`: the `FIGURE_VLM_MODEL` row says the default is the provider's `visionModel` (and no longer `batchModel`) and that a model from the other provider is refused at start-up; the `FIGURE_VLM_VERIFY_MODEL` row and the figure-data knobs paragraph say the same check applies.

## Constraints

- No change to which provider vision uses: `resolveVisionProvider()` keeps its credential order.
- With no vision overrides set, the selection, verify and figure-data models are the same ids as on `dev` with `MODEL`/`MODEL_BATCH` unset.
- One matcher, no per-call-site provider checks.
- `src/output.ts` keeps catching figure failures at save time (`attachFigureImage` and the `saveResult` catch); the CLI preflight is where a misconfiguration fails loudly. Do not make a figure failure fail a paper.
- Synthesis, lane and repair model resolution is unchanged.
- No network and no paid API calls while working; the contract test stubs `fetch` and spawns the CLI only for `poll` against an empty temp state file.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Sonnet 5.5 verifier, Claude CLI, no network needed.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/13-vision-has-its-own-model-per-provider.test.ts` exits 0. Baseline on `dev`: red, 7 of 8 tests fail (first: "Claude visionModel default"); "the CLI still starts when the vision models match their provider" passes as the regression guard.
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **No batch fallback (verifier):** `grep -n "batchModel" src/figure-vlm.ts src/figure-data.ts` prints nothing. Baseline on `dev`: red (two matches).
4. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/13-vision-has-its-own-model-per-provider.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
5. **Clean tree (verifier):** `git diff --check dev...HEAD` passes and `git diff --name-only dev...HEAD` lists only deliverables. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/13-vision-has-its-own-model-per-provider.test.ts`
- **Assertions digest:** `sha256:0e167f0161f7f1b8640339fd7aba0064520531ac70634a9e5fd58e097b692c3a`
- **Oracle proof:** On `dev` (0cd17d7) 7 of 8 tests fail for the card's reason: no `visionModel` on the config ("Claude visionModel default"), no exported `resolveVisionModel`, `extractFigureViaVlm` and `recreateFigureData` resolve instead of rejecting ("swallowed a provider/model mismatch"), the CLI exits 0 with `FIGURE_VLM_MODEL=claude-opus-4-8` on the OpenAI vision provider, and the docs row still names `batchModel`. The matching-config CLI test passes on `dev` and guards against an over-eager preflight. A throwaway reference in a detached scratch worktree (the field and three resolvers in `src/model-config.ts`, the call sites in the two figure modules, a four-line preflight in `src/index.ts`, the example config and the doc row) passed all 8 tests with `tsc --noEmit` clean; the worktree was removed and pruned. Traps: the CLI tests spawn `src/index.ts` with `ts-node`, about one second each, and pin `EXPLAINER_*`, `WEBSITE_REPO`, both API keys and `FIGURE_VLM_ROUTE=api`, because the fill-only `.env.local` loader would otherwise fill them and `~/.codex/auth.json` could select the codex route.

## Out of scope

- Recording the vision provider and route in state or output, and pricing vision calls (separate low findings).
- Moving the figure choice into the batch request, region-based figure location, and anything else in the figure-pipeline redesign (wave 2).
- `scripts/reextract-figure.ts` and `scripts/smoke-models.ts`: they keep working; a mismatch now rejects inside `reextract-figure.ts` with the resolver's message, which is the intended loud failure.
- Lanes (card 05) and batch provenance (card 06).

## Budget

- **Worker wall-clock:** 45 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** small mechanical card on the promo-flow medians: Terra worker about 6M tokens, Sonnet verifier about 0.9M. Hold one re-brief at the same size.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The CLI's stderr line for a mismatched `FIGURE_VLM_MODEL`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 3 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** runs under workspace-write with no network; the contract test needs none. It spawns `node` child processes and writes only under the OS temp dir. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Both roles:** do not create `.env.local` in the run worktree.
