# Stage card 23-registry-and-public-snapshot: models and prices resolve from one validated registry, and a public clone needs no private checkout

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/23-registry-and-public-snapshot
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Gate:** stage-completed: 22-normalised-provider-contract
- **Path claims:** src/model-registry.ts, config/models.snapshot.json, scripts/update-model-snapshot.ts, tests/unit/model-registry.test.ts, src/model-config.ts, config/models.json.example
- **Pairing rationale:** Design 17 calls W2 judgement work, but this card has already made the judgement calls (file formats, precedence, price status rules are written below and pinned by the oracle), leaving a well-specified loader, a generator script and a small bridge change. Claude Sonnet 5.5 at medium effort fits that, and alternates the worker family after card 22's GPT-6.1 Sol worker. The verifier is GPT-6.1 Sol from the other family at high effort, enough to re-run the oracle and read the precedence code against the design; Codex use stays to one verifier pass.
- **Open decisions:** none

## Surfacing concern

Design 17 (`docs/design/provider-routes.md`, `## Registry`, `:690-747`) replaces the copied price table and hard-coded defaults with a validated registry: `src/pricing.ts:9` duplicates mcp-hub's prices and returns zero for an unknown model (`src/pricing.ts:64`); `src/model-config.ts:55-85` hard-codes every default; `src/model-config.ts:88-90` classes every non-`claude-` id as OpenAI, which the design forbids (`:397`). A public clone has no `mcp-hub` checkout, so it needs a committed, reviewed snapshot.

Checked against `dev` (`77909f6`) and the fleet file `../mcp-hub/config/models.json` (`_updated: 2026-10-20`): the fleet file has per-provider tier objects (`claude.opus`, `openai.mini`, and so on), a `model_profiles` block and a `pricing` map of rows such as `{ inPer1M, outPer1M, cachedInPer1M?, introInPer1M?, introOutPer1M?, introUntil?, verified }`. It has no provider, route or modality fields per model. The fleet aliases have moved since the design was written: `openai.batch` is now `gpt-6.1-sol` (design: `gpt-5.6-terra`) and `openai.mini` is now `gpt-6-luna` (design: `gpt-5.6-luna`). The design resolves repair and vision through these aliases (`:370-375`), so the snapshot carries today's values; nothing calls the registry until design 17 W12 and W14.

Design decisions this card settles (none needed the operator):

1. **Formats.** `EXPLAINER_MODEL_REGISTRY` and `MCP_MODEL_REGISTRY` files are in the fleet format above. The local `config/models.json` keeps its legacy per-provider keys (`claude.batchModel` and so on, still read by `getModelConfig`) and adds three optional blocks: `tiers: { <provider>: { synthesis?, repair?, vision? } }` (model ids), `models: { <id>: { provider, aliases?, routes? } }` and `pricing: { <id>: <fleet-format price row> }`. The snapshot format is the worker's choice, provided the loader reads it and the oracle's checks hold.
2. **The compatibility profile is data in `src/model-registry.ts`,** not in the snapshot: Claude synthesis `claude-opus-4-8`, repair and vision the `claude.sonnet` alias; OpenAI synthesis `gpt-5.6-terra`, repair `openai.mini`, vision `openai.batch`; Gemini repair and vision `gemini.flash`, synthesis explicit only (`:370-375`). Regenerating the snapshot therefore cannot change a synthesis default (`:746-747`).
3. **Price status.** A model with no price row is `unpriced`. A row with `verified: false`, or with an `introUntil` date earlier than `now`, is `review_due` with code `PRICE_REVIEW_DUE`. Otherwise `priced`, at the list rate (`inPer1M`, `outPer1M`), as `src/pricing.ts` does today. A row is replaced whole by a higher-precedence file, never merged field by field (`:715-717`).
4. **Stage selection order.** `MODEL_<PROVIDER>_<STAGE>`, then local `tiers.<provider>.<stage>`, then the profile alias resolved through the merged registry rows. The file layers decide what an alias and a model row mean; they never override a local stage selection.
5. **Validation.** Beyond unparseable JSON, a registry layer is `REGISTRY_INVALID` when a model row names an unknown provider, a price row's `inPer1M` or `outPer1M` is not a non-negative number, or an alias equals another model's id or alias. Per-model token constraints, price currency per row and effective dates beyond `introUntil` and `verified` are deferred to the adapter and cost cards (design 17 W5 to W11); the snapshot records USD once at file level.
6. **Explicit means explicit.** A set `EXPLAINER_MODEL_REGISTRY` or `MCP_MODEL_REGISTRY` that does not exist is `REGISTRY_NOT_FOUND`; an unparseable explicit file or local `config/models.json` is `REGISTRY_INVALID`; an absent local file falls through (`:717-722`).

Cold read: a read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It asked where route and modality data come from (now Deliverable 2), what counts as structurally invalid (decision 5), which error a Gemini synthesis lookup raises (Deliverable 2), how the bridge treats an unknown id and whether it calls the registry (Deliverable 5: a prefix rule only), whether an explicit file can override a local stage selection (decision 4: no), how the bridge test squares with never reading real config (Constraints), and whether the design's token, currency and date fields are deferred (decision 5: yes). All are answered on the card.

## Objective

`src/model-registry.ts` loads the snapshot, the fleet file, local config and an explicit registry in the design's precedence, resolves each provider's synthesis, repair and vision model with ownership checks, and reports price status. `scripts/update-model-snapshot.ts` generates `config/models.snapshot.json` deterministically from a fleet file, and the committed snapshot lets a public clone resolve every default tier with no other file. `src/model-config.ts` keeps today's defaults and stops classing every non-`claude-` id as OpenAI.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`## Registry`; `## Run plan and tiers` from the tier table to the end of the section)
- The contract module card 22 creates, src/llm-contract.ts (it does not exist on `dev` until card 22 lands; read `ProviderId`, `Stage`, `LlmContractError`)
- `src/model-config.ts`, `config/models.json.example`, `src/pricing.ts` (read only)
- `../mcp-hub/config/models.json` (the fleet file to generate the committed snapshot from; read only, never edited)
- `tests/contract/23-registry-and-public-snapshot.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. **New `src/model-registry.ts`**, exporting:
   - `loadModelRegistry(opts?: { env?: Record<string, string | undefined>; repoRoot?: string }): ModelRegistry`. `env` defaults to `process.env` and `repoRoot` to the repository root; when `env` is given, `process.env` is not read. Layers, lowest first: `<repoRoot>/config/models.snapshot.json`, the file named by `MCP_MODEL_REGISTRY`, `<repoRoot>/config/models.json`, the file named by `EXPLAINER_MODEL_REGISTRY`. Relative paths resolve from `repoRoot`. Tier aliases and model rows merge key by key; price rows replace whole. No snapshot and no explicit or fleet file is `REGISTRY_UNAVAILABLE`. There is no built-in price table.
   - `ModelRegistry` carries a deterministic `digest` string (at least 16 characters) over the merged content, the local tier overrides included.
   - `lookupModel(reg, idOrAlias)`: the model row (with its canonical `id`) by exact id or a declared alias; `UNKNOWN_MODEL` otherwise.
   - `modelProvider(reg, id)`: the owning `ProviderId` from the row, never from the id's prefix.
   - `resolveStageModel(reg, provider, stage, opts?: { env? }): { model: string; source: 'env' | 'local' | 'profile' }`: `MODEL_<PROVIDER>_<STAGE>` from `env` (for example `MODEL_CLAUDE_REPAIR`), then local `tiers.<provider>.<stage>`, then the compatibility profile (aliases resolved through the merged tiers). The result must exist (`UNKNOWN_MODEL`) and belong to `provider` (`MODEL_PROVIDER_MISMATCH`).
   - `priceFor(reg, id, now: Date)`: `{ status: 'priced' | 'unpriced' | 'review_due', code?: 'PRICE_REVIEW_DUE', inputPer1M?, outputPer1M?, cachedInputPer1M? }` per decision 3.
2. **New `scripts/update-model-snapshot.ts`:** `--fleet <file>` (default `MCP_MODEL_REGISTRY`) and `--out <file>` (default `config/models.snapshot.json`). Byte-identical output for the same fleet file; records the fleet file's sha256 (hex) and its `_updated` date; includes every tier alias, every priced model with its provider, routes and image/PDF support, and every price row; contains no local path, credential reference or account data. It never edits mcp-hub, fetches anything or changes a synthesis default. Provider, route and modality data the fleet file lacks come from a reviewed table in the script, not from scraping the fleet `_comment` prose: the provider is the tier object that names the model, else the table; Claude and OpenAI models support `batch-api`, `sync-api` and `subscription-cli`, Gemini models `batch-api` and `sync-api`; every current fleet model accepts images and PDFs. A Gemini synthesis lookup with no explicit model is `UNKNOWN_MODEL` with a message naming `MODEL_GEMINI_SYNTHESIS`.
3. **New `config/models.snapshot.json`:** generated by Deliverable 2 from `../mcp-hub/config/models.json` and committed.
4. **New `tests/unit/model-registry.test.ts`:** precedence, bad overrides, and missing and stale prices, against temporary files; runnable by `npm test`.
5. **`src/model-config.ts`:** `getModelConfig` and every default it returns are unchanged. `modelBelongsToProvider` no longer classes a `gemini-` id as OpenAI: `claude-` ids are Claude, `gemini-` ids Gemini, the rest OpenAI. It stays a prefix rule and does not load the registry, so nothing calls the registry yet. All other exports unchanged.
6. **`config/models.json.example`:** adds a `tiers` block showing the provider-scoped overrides with the default values, and keeps every existing key.

## Constraints

- No edits to `../mcp-hub` or any secret mapping; the snapshot excludes local paths, credential references and account data.
- `src/pricing.ts`, `src/batch.ts`, `scripts/smoke-models.ts` and every caller are untouched; nothing calls the new registry yet (design 17 W11, W12 and W14 wire it).
- Synthesis defaults stay `claude-opus-4-8` and `gpt-5.6-terra`, whatever the fleet's `opus` or `synthesis` alias says.
- Tests never read the operator's real `config/models.json`, `.env`, `.env.local` or `op://` references; they build temporary repo roots. The one exception is the bridge test, which calls `getModelConfig` at the worktree root: that is safe because a run worktree has no `config/models.json` (it is gitignored), and neither role creates one.
- No network and no paid API calls while working.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6.1 Sol verifier under Codex workspace-write, which suffices (no network; the tests write only under the OS temp dir and spawn `node` on the update script).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/23-registry-and-public-snapshot.test.ts` exits 0. It covers a public-safe committed snapshot; a public clone resolving all six default Claude and OpenAI tiers (synthesis `claude-opus-4-8` and `gpt-5.6-terra`, repair and vision `claude-sonnet-5-5`, `gpt-6-luna` and `gpt-6.1-sol` from today's fleet aliases) with ownership and complete prices; `REGISTRY_UNAVAILABLE`; the full precedence chain; `REGISTRY_NOT_FOUND`, `REGISTRY_INVALID`, `MODEL_PROVIDER_MISMATCH` and `UNKNOWN_MODEL`; prefix-free ownership and aliases; atomic, unpriced, promotional and unverified prices; a deterministic, path-free updater that round-trips; the `model-config` bridge; and the example config. Baseline on `dev`: red, 10 of 10 fail (first: the snapshot does not exist; the bridge test fails on `gemini-2.5-flash` being classed as OpenAI).
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/model-registry.test.ts`. Baseline on `dev`: green.
4. **Card 22 and wave 1 still hold (verifier):** `for f in tests/contract/0*.test.ts tests/contract/1[0-5]-*.test.ts tests/contract/22-*.test.ts; do TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test "$f" || exit 1; done` exits 0 (card 13 reads `src/model-config.ts`). Contract test 01 creates and removes its own sentinel files under `tests/`; that is expected and not a scope breach. Baseline: green once card 22 has landed.
5. **Snapshot is current (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register scripts/update-model-snapshot.ts --fleet ../mcp-hub/config/models.json --out "$TMPDIR/snap.json" && cmp "$TMPDIR/snap.json" config/models.snapshot.json` exits 0, unless the fleet file changed after the worker ran (the verifier then reports it rather than failing). Baseline: not applicable before the run.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/23-registry-and-public-snapshot.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/23-registry-and-public-snapshot.test.ts`
- **Assertions digest:** `sha256:1e3ace4e8486a518e6d1493a51d30b2de423a966e493cd08da6b6abc7c42a10b`
- **Oracle proof:** On `dev` (`77909f6`) all 10 tests fail: the module, script and snapshot do not exist, and `modelBelongsToProvider('gemini-2.5-flash', 'openai')` returns true. A throwaway reference in a detached scratch worktree, stacked on card 22's reference (a 120-line loader, a 40-line updater, a snapshot generated from `../mcp-hub/config/models.json`, a two-line bridge fix and an example `tiers` block), passed all 10; `npx tsc --noEmit` was clean and every wave-1 contract test still passed. The worktree was removed and pruned. Trap the reference met: the fleet format has no provider per model, so a model that appears only in `pricing` needs its provider from the updater's reviewed table; tier membership alone misses `claude-opus-4-8`, which the Claude synthesis profile needs.

## Out of scope

- Replacing `src/pricing.ts` or the cost ledger (design 17 W11), and extending `scripts/smoke-models.ts`.
- Route and credential selection and run plans (card 24).
- Removing lane tiers or legacy keys (design 17 W15).
- Changing which synthesis model is the default (Q13, an operator decision).

## Budget

- **Worker wall-clock:** 60 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** this repo's cost log: Sonnet 5.5 worker median about 0.42M tokens; GPT-6.1 Sol verifier median about 1.2M. Expect about 1M worker tokens: a loader, a generator and a bridge fix, every rule written above.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The snapshot's source digest and capture date.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls, and read `../mcp-hub/config/models.json` without changing it. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough. Run commands with stdin from `/dev/null`. On macOS `$TMPDIR` is under `/var`, which some tools report as `/private/var`; the tests already allow for it.
- **Both roles:** do not create `.env.local` or `config/models.json` in the run worktree.
