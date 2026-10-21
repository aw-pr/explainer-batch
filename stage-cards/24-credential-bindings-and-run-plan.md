# Stage card 24-credential-bindings-and-run-plan: every route binds one surface and one credential, and a run gets one immutable plan before any I/O

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/24-credential-bindings-and-run-plan
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Gate:** stage-completed: 23-registry-and-public-snapshot
- **Path claims:** src/routes.ts, src/run-plan.ts, tests/unit/run-plan.test.ts
- **Pairing rationale:** Judgement work with a security edge: the credential matrix decides which billing route a run consumes, and the preference walk has subtle skip-versus-error rules (all written below and pinned by the oracle). Two new pure modules with no I/O, so GPT-6.1 Sol at high effort fits without the frontier tier, and it alternates with card 23's Claude worker. The verifier is Claude Opus 5.5 from the other family at high effort, because checking that no path leaks or mixes a credential is a careful reading task the cheaper tier would rush.
- **Open decisions:** none

## Surfacing concern

Design 17 (`docs/design/provider-routes.md`, `## Routes and selection` `:236-313` and `## Run plan and tiers` `:315-400`) makes `src/routes.ts` the only credential and surface resolver and freezes each run's choices in a `RunPlan`. Today the choice is scattered and partly implicit (checked on `dev`, `77909f6`): `src/providers.ts:21-37` picks Claude auth from whichever variable is set and refuses both only in sync mode; `src/providers.ts:90-106` silently treats an API key inside `~/.codex/auth.json` as an OpenAI API credential; `src/model-config.ts:60-82` resolves vision from `FIGURE_VLM_MODEL`, which the design says vision must stop sharing with synthesis knobs; and `src/batch.ts:1204` names local runs by a `sync_<provider>_` prefix with no recorded route.

Design decisions this card settles (none needed the operator):

1. **The inventory is injected and holds no secrets.** `CredentialInventory` lists which credential kinds are present (or present but the wrong kind) and the Codex login mode, plus a `read(kind)` accessor. Resolution and planning never call `read`; only a binding's own `credential()` does, and only for its own kind. Building the inventory from the real environment and auth files is design 17 W12.
2. **Skip versus error in the preference walk.** A credential that is genuinely absent (including no Codex login at all) or a model that lacks the route is skipped and recorded. A credential of the wrong kind (`CLAUDE_OAUTH_WRONG_SURFACE`), a Codex login that is malformed or API-key-backed (`CODEX_AUTH_NOT_SUBSCRIPTION`), and model or provider mismatches are errors (`:264-272`). Resolving a binding directly (or a pinned route) treats a missing Codex login as `CODEX_AUTH_NOT_SUBSCRIPTION`, since the design names it so (`:288`).
3. **Legacy `--sync`.** Claude pins `subscription-cli` and keeps today's refusal when both an API key and OAuth are present (`MIXED_BILLING_CREDENTIALS`). OpenAI pins `sync-api` when an explicit API key is present, otherwise `subscription-cli`; an API key only in the Codex auth file is `CODEX_AUTH_NOT_SUBSCRIPTION`, not a silent route. Each emits a warning naming `--sync` as deprecated and recommending `--route` (`:302-308`).
4. **Legacy model knobs.** Synthesis: Claude on `batch-api` reads `MODEL_BATCH` then `MODEL`; Claude on any other route reads `MODEL_SYNTHESIS`; OpenAI reads `MODEL_SYNTHESIS` and logs that `MODEL_BATCH` is ignored. Vision: `FIGURE_VLM_MODEL` and `FIGURE_VLM_PROVIDER` translate once into the vision tier; `FIGURE_VLM_VERIFY_MODEL` and `FIGURE_DATA_MODEL` are checked for provider membership and logged. A legacy value that disagrees with the provider-scoped one for the same stage is `CONFLICTING_MODEL_OVERRIDE` (`:380-399`).
5. **What is deliberately narrower than the design.** `FIGURE_VLM_VERIFY_MODEL` and `FIGURE_DATA_MODEL` get membership checks and warnings only, never a conflict with `MODEL_<PROVIDER>_VISION`; turning them into explicit vision sub-call bindings belongs to design 17 W13, with design 18's locator. `buildRunPlan` takes no input-modality requirements; modality checks join with the inventory in W12 and W13.
6. **Defaults.** Per-tier `maxOutputTokens` keep today's figures (Claude synthesis 16384, OpenAI 8192, repair 8192; the worker picks a positive vision cap); concurrency 1; `maxRepairAttempts` 2 unless `MAX_REPAIR_ATTEMPTS` is set (a value that is not a non-negative integer is rejected with an error naming the variable); with `MAX_REPAIR_ATTEMPTS=0`, `tiers.repair` still holds the default repair route and model but its credential is not resolved; call timeouts 600, 300 and 180 seconds; two hours of active wall clock (`:550-558`). The figures argument is `required`, `optional` (the default) or `none`.

Cold read: a read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It asked what `tiers.repair` holds when repair is waived and how a bad `MAX_REPAIR_ATTEMPTS` behaves (decision 6), whether `childEnvironment` covers API bindings (Deliverable 1: no), whether the legacy verify and data knobs conflict or become sub-call bindings and whether modality checks are deferred (decision 5), and noted that the oracle does not exercise every refusal (criterion 5 now names the rest). All are answered on the card.

## Objective

`src/routes.ts` parses route preferences, resolves a provider and route to exactly one surface and credential kind, and builds allowlisted child environments. `src/run-plan.ts` turns a provider, an injected environment, CLI flags, a credential inventory and the card 23 registry into a frozen `RunPlan`, its digest, a secret-free selection decision and warnings, refusing every invalid combination by name before any I/O.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`## Routes and selection`, `## Run plan and tiers`, and "Local execution and explicit retry" for the timeout defaults)
- The contract module card 22 creates, src/llm-contract.ts (it does not exist on `dev` until card 22 lands; read `Route`, `RunPlan`, `StageBinding`, `LlmContractError`)
- The registry module card 23 creates, src/model-registry.ts (it does not exist on `dev` until card 23 lands; read `lookupModel`, `resolveStageModel`, `ModelRegistry`)
- `src/providers.ts:15-120` (today's auth detection, read only, for the legacy behaviour)
- `tests/contract/24-credential-bindings-and-run-plan.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. **New `src/routes.ts`**, exporting:
   - `CredentialKind` (`anthropic-api-key`, `claude-oauth-token`, `openai-api-key`, `codex-chatgpt-login`, `gemini-api-key`), `CredentialInventory` (`kinds: Partial<Record<CredentialKind, 'present' | 'wrong-kind'>>`, `codexAuth?: 'chatgpt' | 'api-key' | 'missing' | 'malformed'`, `read(kind): string`) and `CredentialBinding` (`provider`, `route`, `surface`, `credentialKind`, `credential(): string`).
   - `parseRoutePreference(value: string | undefined): Route[]`: `undefined` gives `['batch-api', 'subscription-cli', 'sync-api']`; otherwise comma-separated `batch`, `subscription` and `api` tokens, trimmed and lower-cased, mapped in order; an empty, unknown or duplicated token is `INVALID_ROUTE_PREFERENCE`.
   - `resolveCredentialBinding(provider, route, inventory)` per the design's table (`:245-251`): Claude `batch-api` and `sync-api` use surface `anthropic-api-sdk` and `anthropic-api-key`; Claude `subscription-cli` uses `claude-agent-sdk` and `claude-oauth-token`; OpenAI API routes use `openai-api` and `openai-api-key`; OpenAI `subscription-cli` uses `codex-cli` and `codex-chatgpt-login`, which requires `codexAuth: 'chatgpt'`. Errors: `MISSING_ROUTE_CREDENTIAL`, `CLAUDE_OAUTH_WRONG_SURFACE` (an `anthropic-api-key` marked `wrong-kind`), `CODEX_AUTH_NOT_SUBSCRIPTION`, `PROVIDER_DISABLED` (Gemini, until design 17 W17) and `UNKNOWN_PROVIDER`. The binding holds no credential value; `credential()` reads only its own kind.
   - `childEnvironment(binding, parentEnv)`: for subscription bindings only (an API binding throws `ROUTE_UNSUPPORTED`, because explicit clients receive their key directly, `:296-297`); a new object holding only an allowlist of non-credential variables (at least `PATH` and `HOME`, plus `CODEX_HOME` for the Codex surface) and the binding's own credential variable (`CLAUDE_CODE_OAUTH_TOKEN` for the Agent SDK); never `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` or another binding's variable; the parent is not mutated.
   - `assertSingleCredential(binding, env)`: `MIXED_BILLING_CREDENTIALS` when `env` holds any credential variable other than the binding's own.
2. **New `src/run-plan.ts`**, exporting:
   - `buildRunPlan({ provider, env, cli?: { route?, sync? }, inventory, registry, schema, figures? })` returning `{ plan, digest, decision, warnings }`:
     - `cli.route` (a canonical `Route`, else `INVALID_ROUTE_PREFERENCE`) pins the route; `cli.sync` is decision 3; both together are `CONFLICTING_ROUTE_FLAGS`; otherwise `ROUTE_PREFERENCE` from `env` is walked per decision 2, and a list with nothing usable is `NO_USABLE_ROUTE`. A model row whose `routes` list is non-empty and lacks the route skips it with `MODEL_ROUTE_UNSUPPORTED` (an error when pinned).
     - Models via `resolveStageModel` plus decision 4; every model and binding is validated before return, and `inventory.read` is never called.
     - Repair stays on the run provider: `batch-api` synthesis repairs on `sync-api`, `subscription-cli` on `subscription-cli`, `sync-api` on `sync-api`; `REPAIR_ROUTE` may pin an immediate route (`batch-api` is `ROUTE_UNSUPPORTED`) and must resolve, unless `MAX_REPAIR_ATTEMPTS=0` (`:344-351`).
     - Vision: provider from `VISION_PROVIDER` (or legacy `FIGURE_VLM_PROVIDER`), defaulting to the run provider; credentials alone never move it. Routes from `VISION_ROUTE` (pinned, `batch-api` allowed) or `VISION_ROUTE_PREFERENCE` (default `subscription,api`). With figures `optional`, an unusable vision binding gives `tiers.vision: null` and a non-empty `visionDisabledReason`; with `required` it throws; with `none` vision is `null` with a reason (`:353-362`).
     - `plan` is deeply frozen, `version: 1`, `strategy: 'single-pass'`, top-level `provider` and `route` equal to the synthesis binding, `schema` as given, `registryDigest` equal to `registry.digest`, a `policyDigest` that changes with the route policy, and decision 6's defaults.
     - `digest`: deterministic over the plan, different when any tier model changes.
     - `decision`: `{ provider, route, credentialKind, models: { synthesis, repair, vision }, policySource: 'default' | 'ROUTE_PREFERENCE' | 'route-flag' | 'sync-flag', skipped: Array<{ route, reason }> }`, holding no credential value or credential path (`:274-279`).
     - `warnings`: strings for every deprecation or ignored knob in decisions 3 and 4.
   - `planDigest(plan)` and `assertPlanProvider(plan, explicitProvider | undefined)`: `RUN_PROVIDER_MISMATCH` when an explicit provider differs from the stored plan's.
   Neither module reads `process.env`, touches the filesystem, spawns a process or imports `src/providers.ts` or `src/batch.ts`.
3. **New `tests/unit/run-plan.test.ts`:** the complete credential matrix and the model-mismatch cases with an injected inventory whose `read` records calls; runnable by `npm test`.

## Constraints

- Never open a real credential: no `.env`, `.env.local`, `op://`, `~/.codex/auth.json` or `~/.claude` reads, in code or tests. Tests use a fake inventory and fake values only.
- Secret material never enters `RunPlan`, the decision, warnings or error messages.
- No CLI wiring: `src/index.ts`, `src/providers.ts` and `src/batch.ts` are untouched (design 17 W12 and W14).
- Do not delete or reassign a global `process.env` key, now or in tests (`:298-299`).
- No network and no paid API calls while working.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Opus 5.5 verifier through the Claude CLI; no network needed. The worker runs criteria 1 to 4 in its Codex workspace-write sandbox, which is enough.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/24-credential-bindings-and-run-plan.test.ts` exits 0. It covers preference parsing; the six-row binding matrix with a lazy accessor; the named refusals of the binding resolver; allowlisted child environments and `MIXED_BILLING_CREDENTIALS`; the skip-versus-error walk; pinned routes and `CONFLICTING_ROUTE_FLAGS`; legacy `--sync`; the frozen plan, its defaults and digests with no secret and no credential read; repair and vision routing including cross-provider vision and disabled optional figures; model override validation and legacy knob translation; `RUN_PROVIDER_MISMATCH`; and the no-I/O source surface. Baseline on `dev`: red, 12 of 12 fail (first: `src/routes.ts must exist`). It reads card 23's committed snapshot and loader.
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/run-plan.test.ts`. Baseline on `dev`: green.
4. **Earlier cards still hold (verifier):** `for f in tests/contract/2[23]-*.test.ts; do TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test "$f" || exit 1; done` exits 0. Baseline: green once cards 22 and 23 have landed.
5. **No secret path, and rules beyond the oracle (verifier, reading):** no code path in `src/routes.ts` or `src/run-plan.ts` places a credential value in a returned plan, decision, warning or error message, or reads one outside `credential()`. Also by reading, since the oracle does not exercise them: `CONFLICTING_MODEL_OVERRIDE` for a legacy synthesis knob that disagrees with `MODEL_<PROVIDER>_SYNTHESIS`; a malformed Codex login met during a preference walk is an error, not a skip; an unknown `VISION_ROUTE` is `INVALID_ROUTE_PREFERENCE`; `childEnvironment` refuses API bindings; an invalid `MAX_REPAIR_ATTEMPTS` is rejected. Baseline: not applicable before the run.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/24-credential-bindings-and-run-plan.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/24-credential-bindings-and-run-plan.test.ts`
- **Assertions digest:** `sha256:ef4322cd290c15c7bfd035e82a1571f8aecd2c3c94d02233aba3d85527f29a4e`
- **Oracle proof:** On `dev` (`77909f6`) all 12 tests fail because `src/routes.ts` and `src/run-plan.ts` do not exist. A throwaway reference in a detached scratch worktree, stacked on the card 22 and 23 references (a 90-line `src/routes.ts` and a 170-line `src/run-plan.ts` following the Deliverables), passed all 12; `npx tsc --noEmit` was clean and every earlier contract test still passed. The worktree was removed and pruned. Trap the reference met: decision 2's two treatments of a missing Codex login (skipped in a walk, an error when resolved directly or pinned) are both asserted, so a single rule in `resolveCredentialBinding` is not enough; the walk must check for an absent login itself.

## Out of scope

- Building the inventory from the real environment, `.env` files and auth files, and wiring plans into `process`, `submit`, `poll` or `status` (design 17 W12).
- Provider adapters (W5 to W8), the cost ledger (W11), state persistence of plans (card 25 stores, W12 writes).
- The `op-refs.sh` route descriptor and tmux wrapper changes (`:309-315`).

## Budget

- **Worker wall-clock:** 90 minutes
- **Verifier wall-clock:** 40 minutes
- **Spend basis:** this repo's cost log: no GPT-6.1 Sol worker runs yet (Terra worker median about 0.56M tokens); Opus 5.5 verifier median about 0.93M. Expect about 2M worker tokens: two modules of about 270 lines with many small rules.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The binding matrix as implemented (provider, route, surface, credential kind).
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls and do not read real credential files.
- **Both roles:** do not create `.env.local` in the run worktree.
