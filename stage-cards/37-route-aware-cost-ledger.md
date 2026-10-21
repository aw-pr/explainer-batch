# Stage card 37-route-aware-cost-ledger: every call is costed by its own route, with unknown prices and usage left null, never zero

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/37-route-aware-cost-ledger
- **Worker effort:** medium
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/cost-ledger.ts, src/pricing.ts, tests/unit/route-cost.test.ts
- **Pairing rationale:** Design 17 marks W11 mechanical (Sonnet or Terra tier): the formulas, field names and every edge rule are written out below and pinned by the frozen test, so Claude Sonnet 5.5 at medium effort fits. GPT-6.1 Sol from the other family verifies at high effort; checking arithmetic and null rules is a reading task. Card 38, the other design 17 card in this tranche, has a Codex worker, so the worker families alternate.
- **Open decisions:** none

## Surfacing concern

Design 17 (`docs/design/provider-routes.md`) `## Cost` (`:616-688`) makes cost a projection of a per-call ledger instead of the parent batch's mode. Today `src/pricing.ts` copies a price table (`:9-41`), halves every category for batch (`BATCH_DISCOUNT`, `:43`) and returns zero for an unknown model (`:61-72`), which is finding D13 (`:74`). Card 23 landed the registry (`src/model-registry.ts`): `priceFor(reg, id, now)` returns `priced`, `unpriced` or `review_due` (code `PRICE_REVIEW_DUE`) at the list rate, and `reg.pricing[id]` holds the raw row (`inPer1M`, `outPer1M`, optional `cachedInPer1M`, `introInPer1M`, `introOutPer1M`, `introUntil`, `verified`; the loader keeps any further numeric fields as written). Card 22 landed `TokenUsage` and `LlmContractError` (`src/llm-contract.ts:76-83`, `:163`). Nothing calls a ledger yet: design 17 W12 wires it into the orchestrator, so this card adds the module and moves `calcCost` onto the registry, and changes no caller. Checked against `dev` at `8bb4372`.

Design decisions this card settles (none needed the operator):

1. **Batch rates.** The design says "use explicit batch rates or a verified category-specific batch factor; do not blindly halve cache-write rates" (`:670-671`), and no snapshot row carries a batch rate today. A row's explicit `batchInPer1M`, `batchOutPer1M`, `batchCachedInPer1M`, `batchCacheWrite5mPer1M` or `batchCacheWrite1hPer1M` wins. Failing that, input and output only take the provider factor `BATCH_RATE_FACTORS` (`claude: 0.5`, `openai: 0.5`, both providers' published batch discount on input and output tokens; Gemini has none yet). Cache categories never take the factor. This reproduces the design's Terra fixture (batch 7, `:684-688`).
2. **Cache-write rates** come from optional row fields `cacheWrite5mPer1M` and `cacheWrite1hPer1M`; cache read from the existing `cachedInPer1M`. No snapshot row has a cache-write rate yet, so a call that reports cache-write tokens is `partial` until the registry adds one. That is the design's rule, not a gap.
3. **Promotions follow card 23.** `priceFor` prices at the list rate (card 23 decision 3), so the ledger does too: an active promotion is `priced` at list; a passed `introUntil` (or `verified: false`) is `review_due` with a `PRICE_REVIEW_DUE` warning, still at list rate, never an inferred rise (`:681-683`). Applying intro rates is a registry decision for a later card.
4. **Status ranking.** Per call and per summary: `unpriced` (no price row) over `partial` (some needed category has no rate, or some usage category is null) over `review_due` over `priced`.
5. **Unknown usage gets a code.** The design names `UNPRICED_MODEL` and `UNPRICED_TOKEN_CATEGORY`; a null usage category gets `UNKNOWN_USAGE` so the warning says why the total is null.
6. **The legacy wrapper keeps numbers.** `calcCost` keeps its signature and result fields for `src/batch.ts` and `scripts/smoke-models.ts`, which cannot take null. It reads rates through the ledger from the registry as `loadModelRegistry()` resolves it (the committed snapshot, plus any `MCP_MODEL_REGISTRY`, local `config/models.json` or `EXPLAINER_MODEL_REGISTRY` layer, in card 23's precedence), passes zero cache counts (legacy callers report only input and output tokens, so those categories are unused), and labels its result with `pricing_status`. The label is visible on the returned breakdown only: `applyUsage` in `src/batch.ts:298-320` does not read it until design 17 W12 moves callers onto the ledger. `BATCH_DISCOUNT` and `formatUsd` stay exported (the batch status line prints both).

Cold read: a read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It raised: which registry `calcCost` reads (now decision 6: the layered loader, with the test clearing the override variables); that the wrapper must pass zero cache counts (now decision 6 and Deliverable 2); context-length thresholds and a separate policy digest from the design (`:677-682`), which have no registry data yet (now Out of scope; the entry records the registry digest and the copied row); that `pricing_status` is not yet visible in `batch.ts` totals (now said in decision 6); the `BATCH_RATE_FACTORS` exception to "no rates in code" (now in Constraints); and that the source checks read comments too (now stated in Deliverables 1 and 2). Nothing else was open.

## Objective

`src/cost-ledger.ts` turns one call (provider, route, model, stage, usage, time) and the model registry into a ledger entry with the route's estimated charge, the standard-rate API equivalent and the saving, with null wherever a rate or a usage count is unknown and a warning that names why; `summariseLedger` sums entries into the design's cost summary. `src/pricing.ts` loses its copied price table and becomes a wrapper over the ledger.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`## Cost`, `:616-688`)
- `src/pricing.ts`, `src/model-registry.ts`, `src/llm-contract.ts` (`TokenUsage`, `LlmContractError`)
- `scripts/smoke-models.ts` (a `calcCost` caller; do not change it)
- `tests/contract/37-route-aware-cost-ledger.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. **New `src/cost-ledger.ts`**, importing only `./llm-contract` and `./model-registry` (static `import ... from` syntax), with no filesystem, environment or clock access (the call time is an input); the text `process.env`, `Date.now()` and `new Date()` appears nowhere in the file, comments included. It exports:
   - Types `PricingStatus` (`'priced' | 'review_due' | 'partial' | 'unpriced'`), `CostWarningCode` (`'UNPRICED_MODEL' | 'UNPRICED_TOKEN_CATEGORY' | 'UNKNOWN_USAGE' | 'PRICE_REVIEW_DUE'`), `TokenCategory` (`'in' | 'out' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h'`), `CostWarning` (`code`, `call_id`, `model`, `route`, `registry_digest`, optional `category`, non-empty `message`), `CallInput` (`callId`, `attemptId`, `stage`, `provider`, `route`, `model`, `usage: TokenUsage`, `at: Date`), `LedgerEntry` and `CostSummary` with the fields below.
   - `BATCH_RATE_FACTORS: Partial<Record<ProviderId, number>>` = `{ claude: 0.5, openai: 0.5 }`.
   - `costCall(reg: ModelRegistry, call: CallInput): LedgerEntry`. Extra fields on `call` are ignored, so a `NormalizedResult` spread with `callId` and `at` is a valid input (a failed call with usage is costed like any other). The entry carries `call_id`, `attempt_id`, `stage`, `provider`, `route`, `model`, `usage`, `price_snapshot_digest` (`reg.digest`), `pricing_timestamp` (`at.toISOString()`), `price_row` (a copy of `reg.pricing[model]`, or `null`; later registry changes do not alter the entry), `pricing_status`, `estimated_charge_usd`, `api_equivalent_usd`, `saving_usd` and `warnings`. Rules:
     1. No price row: `pricing_status: 'unpriced'`, one `UNPRICED_MODEL` warning and no other, `api_equivalent_usd: null`, `estimated_charge_usd` `0` on `subscription-cli` and `null` otherwise, `saving_usd: null`.
     2. Otherwise, for each category with a token count: `0` contributes nothing and needs no rate; `null` makes both totals null (subscription charge stays `0`) with an `UNKNOWN_USAGE` warning for that category; a positive count is priced at the standard rate (`inPer1M`, `outPer1M`, `cachedInPer1M`, `cacheWrite5mPer1M`, `cacheWrite1hPer1M`) and, on `batch-api`, at the batch rate of decision 1. A missing rate gives an `UNPRICED_TOKEN_CATEGORY` warning naming the category and nulls the total it affects (standard: the equivalent, and the charge on `sync-api`; batch: the charge only).
     3. `api_equivalent_usd` is the standard-rate sum divided by 1,000,000. `estimated_charge_usd` is `0` on `subscription-cli`, the batch sum on `batch-api`, and the equivalent on `sync-api`. `saving_usd` is equivalent minus charge when both are known, else `null`. Nothing is rounded.
     4. `priceFor` `review_due` adds a `PRICE_REVIEW_DUE` warning; prices stay at the list rate. Status per decision 4.
     5. Every warning carries `call_id`, `model`, `route` and `registry_digest`; at most one warning per code and category.
   - `summariseLedger(entries: LedgerEntry[]): CostSummary`: entries with the same `call_id` and identical content count once; the same `call_id` with different content throws `LlmContractError('RESULT_CONFLICT', ...)`. `estimated_charge_usd`, `api_equivalent_usd` and `saving_usd` are sums, each `null` when any entry's value is null; `known_charge_usd` sums the non-null charges; `pricing_status` is the worst per decision 4; `unpriced_call_ids` lists, in first-seen order, the calls whose status is `unpriced` or `partial`. An empty ledger sums to `0` with status `priced`.
2. **`src/pricing.ts`:** `STANDARD_PRICES` and every literal per-model rate are removed; neither the name `STANDARD_PRICES` nor any `input:` or `output:` property with a numeric literal appears in the file, comments included. `calcCost(provider, model, inputTokens, outputTokens, isBatch = true)` keeps its signature and `CostBreakdown` fields, loads the registry once per process with `loadModelRegistry()`, and costs the call through `costCall` on `batch-api` or `sync-api` with `cacheRead`, `cacheWrite5m` and `cacheWrite1h` set to 0: `standard_cost_usd` is the equivalent, `batch_cost_usd` the charge, `saving_usd` their difference, each rounded to four places as today, with `0` in place of null; `CostBreakdown` gains `pricing_status: PricingStatus`. `BATCH_DISCOUNT` (`0.5`) and `formatUsd` stay as they are.
3. **New `tests/unit/route-cost.test.ts`**, run by `npm test`: the design's subscription, batch-plus-standard-repair, cache-token, promotion and unknown-price fixtures (`:684-688` and the rules above), against a registry object built in the test.

## Constraints

- No caller changes: `src/batch.ts`, `scripts/smoke-models.ts`, `src/model-registry.ts`, `config/` and the state modules stay as they are. Wiring the ledger into state and `metadata.cost` is design 17 W12.
- Prices are data: no provider branches in the arithmetic, and no rates in code apart from the `BATCH_RATE_FACTORS` table, which is a discount policy rather than a price.
- Tests build their own registry object or read the committed snapshot; they never read `MCP_MODEL_REGISTRY`, `EXPLAINER_MODEL_REGISTRY`, `.env.local` or a live `state.json`.
- No network and no paid API calls.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state and a cloned `node_modules` (gitignored).

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6.1 Sol verifier through the Codex CLI, workspace-write sandbox, no network needed. The worker (Claude CLI, unsandboxed) runs criteria 1 to 4 itself.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/37-route-aware-cost-ledger.test.ts` exits 0 with 14 passing. It covers the Terra fixture on all three routes; the entry's identity, digest, timestamp and copied row; batch synthesis plus a Luna repair (8.4, 15.4, 7); a failed call costed from a spread result; explicit batch rates over the factor and no Gemini factor; cache read and 5-minute write priced, a missing 1-hour rate and a batch cache read nulling their totals; unknown usage; an unpriced model and its summary; ended and active promotions; status ranking and the empty ledger; deduplication and `RESULT_CONFLICT`; unrounded totals; the import surface; and the `calcCost` wrapper. Baseline on `dev`: red, 14 of 14 fail (first: `src/cost-ledger.ts must exist`).
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/route-cost.test.ts`. Baseline on `dev`: green.
4. **Smoke (verifier):** `npm run smoke` exits 0 and prints `PASS: every provider tier resolves and is priced.` Baseline on `dev`: green.
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/37-route-aware-cost-ledger.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/37-route-aware-cost-ledger.test.ts`
- **Assertions digest:** `sha256:5cdf2669b863234d4b77f3e7c1f8c151446990e5a50f7b58cf6f2edea73c2d47`
- **Oracle proof:** On `dev` (`8bb4372`) all 14 tests fail because `src/cost-ledger.ts` does not exist. A throwaway reference in a detached scratch worktree (a 170-line `src/cost-ledger.ts` following Deliverable 1 and a 45-line `src/pricing.ts` wrapper) passed 14 of 14; `npx tsc --noEmit`, `npm test` (125) and `npm run smoke` were green, and every other contract test passed except 26, 27 and 28, which need the held PDFs beside a sibling `explainer-batch` checkout and fail the same way in any scratch worktree (they pass in a run worktree). The worktree was removed and pruned.

## Out of scope

- Writing ledger entries to state or `metadata.cost`, and printing warnings: design 17 W12.
- Per-model subentries for multi-model subscription sessions and Codex event deduplication: the subscription adapter cards (design 17 W7, W8) produce the usage this card prices.
- Adding batch or cache-write rates to `config/models.snapshot.json`, or changing `priceFor`: registry work.
- Deleting `calcCost`: design 17 W15.
- Context-length threshold pricing and a pricing-policy digest separate from the registry digest (design `:677-682`): no registry row carries threshold data yet.

## Budget

- **Worker wall-clock:** 45 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** tranche 1 in this repo: Sonnet 5.5 worker cards 0.6M to 1.4M tokens (card 23 1.40M, card 32 0.58M), Sol verifier about 0.3M. Expect about 1M: one new module of about 170 lines, a wrapper and a unit test.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported names of `src/cost-ledger.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; make no network calls. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough. If `node_modules` is missing, clone it as above. Run commands with stdin from `/dev/null`.
- **Both roles:** do not create `.env.local` or `config/models.json` in the run worktree.
