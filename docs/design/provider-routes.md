# Provider, route and run-plan design

## Summary

Separate the model vendor (`provider`), execution and billing surface (`route`),
and immutable execution policy (`RunPlan`). One orchestrator consumes normalised
results from every surface and owns persistence, validation, bounded repair and
`finalizeResult`. Provider adapters own wire formats, schema dialect selection,
uploads and error interpretation. They do not save articles or choose credentials.

Batch API and subscription execution remain first-class. Subscription work uses
the same resumable item ledger as remote batches. Every actual call records its
provider, route, model, usage and price basis. Subscription incremental API charge
is zero; its estimated API equivalent is reported separately.

This is a design against worktree revision `37fa951`, read on 2026-10-20. No
network or model calls were made. The stage-16 design document is absent on this
base. Its shared-schema dialect generator is an external interface, not designed
here. Stage 18 owns figure selection/localisation; stage 19 owns chart evidence.
The existing six-point chart filter stays until the stage-19 provenance gate is
implemented. Public publication remains a manual curated replay, outside all
cards below.

Names and paths described as **new** are proposed wave-2 work, not existing APIs.
Default synthesis model selection remains an operator decision, Q13.

## Current state

The review's line numbers predate several wave-1 fixes. The following are the
current behaviours, including those fixes.

| Concern | Current implementation and evidence |
|---|---|
| Provider | `src/providers.ts:8` declares only Claude and OpenAI. `getProviderFromArgs` now rejects unknown names at `src/providers.ts:730`; the default remains Claude. CLI argument handling is at `src/index.ts:30`. D4's silent fallback has already been fixed. |
| Run mode and auth | `src/index.ts:40` couples `--sync` to credential checks. Claude sync requires OAuth and rejects a simultaneous API key at `src/index.ts:56`. OpenAI chooses API-key auth before ChatGPT auth at `src/providers.ts:741`, including an API key found in the Codex auth file at `src/providers.ts:101`. |
| Dispatch | Provider-specific submit and poll branches remain at `src/batch.ts:521` and `src/batch.ts:531`; sync dispatch branches at `src/batch.ts:1254`. `src/batch.ts:1289` recognises a local run by the `codexbatch_` prefix. |
| Models | Environment overrides precede the optional local file and source constants at `src/model-config.ts:55`. Claude batch uses `batchModel` at `src/batch.ts:331`, Claude sync uses `synthesisModel` at `src/batch.ts:974`, and OpenAI single-pass batch uses `synthesisModel` at `src/batch.ts:468`. A model name and route are currently entangled in the tier names. |
| Defaults and registry | Claude defaults still include `claude-opus-4-8` at `src/model-config.ts:61`. The sibling registry's `claude.opus` resolves to `claude-opus-5-5`; its pricing rows list 4/20 versus 5/25 USD per million input/output tokens for these two models. These are local registry observations, not independently refreshed prices. |
| Structured responses | OpenAI now sets `strict: true` at `src/providers.ts:381`, used in sync at `src/providers.ts:603` and batch at `src/batch.ts:472`. Claude uses a model allowlist for forced tool choice and otherwise an advisory tool at `src/providers.ts:162`. The Agent SDK call at `src/providers.ts:324` has no `outputFormat`; Codex at `src/providers.ts:668` has no output schema. |
| Finish detection | Claude token/context exhaustion is detected at `src/providers.ts:82`; OpenAI incomplete responses at `src/providers.ts:385`; batch HTTP failures at `src/providers.ts:548`. D11 is partly fixed, but these become thrown strings or untyped errors and can lose usage on failed responses. |
| Lanes | `OPENAI_USE_LANES` is now opt-in at `src/batch.ts:175`. Missing lanes fail the item at `src/batch.ts:706`, rather than supplying `(missing)`. Synthesis still consumes lane notes at `src/batch.ts:730`, and `src/model-config.ts:119` still makes `::lane::` identifiers. |
| Vision | Vision still selects its provider from credentials at `src/vision.ts:222` and independently selects a route at `src/vision.ts:79`. Its advertised subscription preference is limited by API-first OpenAI auth detection at `src/vision.ts:99`. Wave 1 gave vision independent defaults at `src/model-config.ts:65` and `src/model-config.ts:79`; it no longer inherits `MODEL` or `MODEL_BATCH`. |
| Vision checks | `src/model-config.ts:88` recognises only Claude prefixes and treats every other model as OpenAI. `src/index.ts:96` preflights vision model names; `src/figure-vlm.ts:240` uses that resolver. Operational failures still become a warning and null selection at `src/figure-vlm.ts:269`. |
| Provenance | D8 is fixed on this base: `src/state.ts:73` persists date, surname, publication date and reference; `src/batch.ts:237` constructs them and `src/batch.ts:246` passes them through the existing `finalizeResult` wrapper. |
| Repair and saving | Wave 1 extracted `repairUntilValid`, accumulates usage at `src/repair.ts:43`, retains the best parseable candidate at `src/repair.ts:52`, and calls its result `text`. However, all validator issues still feed the repair instruction (`src/quality.ts:303`). `saveResult` flags invalid output `needs_review` at `src/output.ts:568`, then saves and stages it at `src/output.ts:574`; collectors still mark that result succeeded at `src/batch.ts:636`. |
| Canonicalisation | `src/output.ts:382` canonicalises nulls, schema drift and chart forms. `src/output.ts:333` derives missing renderer fields. The six-point chart filter is at `src/output.ts:363`; figure attachment still happens inside saving at `src/output.ts:559`. |
| Persistence | `src/state.ts:127` already writes then renames atomically, and `src/state.ts:138` merges into a fresh read. Neither is a cross-process transaction. Collectors checkpoint after their loops at `src/batch.ts:599`, `src/batch.ts:661`, `src/batch.ts:945`, `src/batch.ts:1014` and `src/batch.ts:1196`. |
| Recovery | Argument-less polling now excludes `sync_*` at `src/state.ts:157`, a wave-1 fix. Corrupt state is backed up but still becomes empty state at `src/state.ts:108`. There is no version; the cache is OpenAI-specific at `src/state.ts:94`. |
| Cost | Prices are a copied table at `src/pricing.ts:9`; unknown models return zero at `src/pricing.ts:64`. `calcCost` takes `isBatch` at `src/pricing.ts:55`. `src/batch.ts:298` costs repair at standard rate, but subscription usage is also priced as API usage and figure usage is absent from that calculation. `scripts/smoke-models.ts:29` checks four tiers, omitting vision. |
| Local batch and Codex | The local-batch branch at `src/batch.ts:502` is blocked by CLI auth validation at `src/index.ts:70`. Codex receives the prompt in argv at `src/providers.ts:683`, inherits cwd/environment at `src/providers.ts:690`, and names its output using a timestamp at `src/providers.ts:669`. |
| PDF on Codex | `src/providers.ts:653` drops native PDF bytes. More seriously, `src/batch.ts:184` supplies a local path instruction, and `src/batch.ts:207` uses it when no upload exists. `src/preprocess.ts:17` has PDF bytes/path and optional HTML text, but no extracted PDF-text field. Although AGENTS describes upstream-extracted text, these call sites do not guarantee it. The replacement must explicitly supply extracted source text before dispatch. |
| Wrapper | `scripts/run-batch-tmux.sh:35` maps provider plus `--sync` to one credential, with a zero-secret Codex route; its `.env` fallback is at `scripts/run-batch-tmux.sh:25`. `op-refs.sh` holds placeholder mappings. This design changes route descriptors, not general wrapper hardening. |

The additional reads of `src/repair.ts`, the `src/preprocess.ts` input type and
`package.json` were necessary to trace the extracted repair seam, check source
delivery and establish the actual offline test command.

## Findings addressed

| Id | Present evidence and resolution |
|---|---|
| D1 | Branches at `src/batch.ts:521`, `src/batch.ts:531` and `src/batch.ts:1306` disappear into provider registration plus a route-based scheduler, W5, W6, W12 and W15. |
| D2 | Paired wrappers remain at `src/batch.ts:257`, `src/batch.ts:277`, `src/batch.ts:540` and `src/batch.ts:1018`. W10 centralises finalisation; W12 replaces the loops; W15 deletes their copies. |
| D3 | `src/index.ts:40`, `src/batch.ts:1204` and `src/pricing.ts:60` still infer mode. W3 resolves a frozen plan; W4 persists route on every new batch/request; W11 and W12 use actual per-call routes for prices and output provenance. |
| D4 | Unknown names now throw at `src/providers.ts:735`. W1/W3 preserve this, distinguish unknown from registered-but-disabled Gemini, and eliminate the remaining two-provider assumptions. |
| D5 | Strict OpenAI is already present at `src/providers.ts:381`; Claude tool fallback remains at `src/providers.ts:172`, and subscriptions lack schemas at `src/providers.ts:324` and `src/providers.ts:668`. W5 to W9 consume stage 16's dialect interface, and W10 applies identical downstream validation regardless of enforcement strength. |
| D6 | Independent vision models and checks exist at `src/model-config.ts:99`, but provider selection at `src/vision.ts:222` is ambient. W3 and W13 freeze provider, model and route explicitly and replace the permissive membership test at `src/model-config.ts:88`. |
| D7 | Wave 1 made lanes opt-in (`src/batch.ts:175`) and fails missing lanes (`src/batch.ts:706`). W15 removes the entire lane strategy and delimiter (`src/model-config.ts:119`), after draining historical jobs. |
| D8 | Provenance is already persisted at `src/state.ts:73` and forwarded at `src/batch.ts:246`. W4/W10 preserve it through migration, repair and replay; unknown historical metadata stays unknown. |
| D9 | Whole-loop saves at `src/batch.ts:599` and `src/batch.ts:1196` still permit repeated repair/vision. W4 journals every call receipt and item transition; W10/W12/W13 resume saved work without repeating completed calls. |
| D10 | Prefix exclusion is fixed at `src/state.ts:160`; corrupt-state continuation (`src/state.ts:121`) and the unversioned OpenAI cache (`src/state.ts:94`) remain. W4 provides versioned migration, fail-closed loading, locks and provider/account-keyed caching. |
| D11 | Guards at `src/providers.ts:82`, `src/providers.ts:385` and `src/providers.ts:548` already cover major failures. W1/W5 to W8 preserve usage and map all terminal outcomes into a discriminated result, including subscription failures. |
| D12 | `src/repair.ts:43` and `src/repair.ts:52` already fix usage accumulation and candidate regression. `src/output.ts:568` still saves invalid articles as reviewed successes. W10 adds issue classes, protects chart values, separates review artefacts from success, and owns the single finalisation seam. |
| D13 | `src/pricing.ts:9` and `src/pricing.ts:64` still copy prices and silently return zero. W2 loads versioned data; W11 records all synthesis, repair and vision calls, subscription zero-charge and explicit unknown-price warnings. |
| D14 | `src/providers.ts:668` still uses timestamp output, argv prompts and inherited cwd. W8 isolates each invocation with `mkdtemp`, stdin, `-C` and a schema; W9 proves the Codex schema subset with one authorised subscription call. |
| D15 | `src/batch.ts:502` and `src/batch.ts:813` conflict with the CLI gate at `src/index.ts:70`. W12 exposes a real resumable local batch; W15 deletes `codexbatch` dispatch and `collectOpenAILocal`. |
| D16 | Hard-coded Opus 4.8 defaults remain at `src/model-config.ts:61`, despite the cheaper successor row at `src/pricing.ts:13`. W2 removes model constants from executable selection, supplies registry choices and a compatibility profile; Q13/W16 gate any default synthesis change on operator evaluation. |

## Provider interface

These are proposed core signatures. Supporting domain types are explicitly
defined here so route adapters cannot pass vendor response objects to the core.

```ts
type ProviderId = 'claude' | 'openai' | 'gemini';
type Route = 'batch-api' | 'sync-api' | 'subscription-cli';
type ImmediateRoute = Exclude<Route, 'batch-api'>;
type Stage = 'synthesis' | 'repair' | 'vision';
type SchemaRef = { id: string; version: number; digest: string };
type JsonObject = Record<string, unknown>;

interface RouteCapabilities {
  structured: 'strict' | 'tool' | 'none';
  schemaEvidence: 'fixture' | 'subscription-probe' | 'unverified';
  vision: boolean;
  pdfNative: boolean;
  batch: boolean;
  subscription: boolean;
  outputTokenLimit: 'enforced' | 'advisory';
  maxBatchRequests?: number;
  maxBatchBytes?: number;
  completionWindowMs?: number;
}
interface ProviderCapabilities {
  byRoute: Partial<Record<Route, RouteCapabilities>>;
}
interface SourceSnapshot {
  digest: string;
  text: string;
  pdf?: { relativePath: string; sha256: string };
  images: ReadonlyArray<{ relativePath: string; label: string; sha256: string }>;
}
interface PreparedItem {
  itemId: string;
  customId: string;
  attemptId: string;
  instruction: string;
  source: SourceSnapshot;
  schema: SchemaRef;
}
interface ProviderRequest {
  provider: ProviderId;
  route: Route;
  stage: Stage;
  model: string;
  customId: string;
  attemptId: string;
  schema: SchemaRef;
  payload: unknown;
  wireBytes: number;
}
interface CallContext {
  signal: AbortSignal;
  deadline: string;
}
interface BatchHandle {
  provider: ProviderId;
  remoteId: string;
  submittedAt: string;
  expiresAt: string;
  requests: ReadonlyArray<
    Pick<ProviderRequest, 'customId' | 'attemptId' | 'stage' | 'model'>
  >;
}
interface BatchSnapshot {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
  counts: { pending: number; succeeded: number; failed: number };
  error?: NormalizedError;
}
interface TokenUsage {
  in: number | null;
  out: number | null;
  cacheRead: number | null;
  cacheWrite5m: number | null;
  cacheWrite1h: number | null;
  source: 'reported' | 'partial' | 'unavailable';
}
interface NormalizedError {
  code: string;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  providerCode?: string;
}
type NormalizedResult = {
  provider: ProviderId;
  route: Route;
  stage: Stage;
  model: string;
  customId: string;
  attemptId: string;
  providerRequestId?: string;
  usage: TokenUsage;
  rawFinishReason?: string;
} & (
  | { finishReason: 'stop'; text: string; error?: never }
  | { finishReason: 'length' | 'error'; text?: string; error: NormalizedError }
);
interface LlmProvider {
  readonly id: ProviderId;
  readonly routes: readonly Route[];
  readonly capabilities: ProviderCapabilities;
  buildRequest(stage: Stage, item: PreparedItem, plan: RunPlan):
    Promise<ProviderRequest>;
  submitBatch(reqs: readonly ProviderRequest[], ctx: CallContext):
    Promise<BatchHandle>;
  getBatch(handle: BatchHandle, ctx: CallContext): Promise<BatchSnapshot>;
  results(handle: BatchHandle, ctx: CallContext): AsyncIterable<NormalizedResult>;
  complete(req: ProviderRequest & { route: ImmediateRoute }, ctx: CallContext):
    Promise<NormalizedResult>;
}
```

`routes` must equal the keys of `capabilities.byRoute`. Model-registry capability
overrides further restrict a route; a provider-level capability never promises
that every model supports images or a schema. Factories receive a resolved
credential binding, file-cache service and schema service. No method reads
ambient credentials or changes route. Unsupported methods return a named
`ROUTE_UNSUPPORTED` error before I/O. Operational item failures return results;
batch transport failures throw a typed error for the polling policy.

The schema service is stage 16's **generate-provider-dialect-from-shared-schema**
interface. `buildRequest` selects its provider, route and model dialect, attaches
the resulting schema and records its digest. The generator owns optional/null
semantics and conversion back to canonical data. This document does not specify
another schema. `payload` is opaque outside its adapter; `wireBytes` includes the
encoded request envelope. Async construction permits verified file uploads via
the injected cache. Chunk measurement also counts batch envelope overhead.

Vision is a stage using `complete`, or `submitBatch` when scheduled in advance,
not a separate provider method. The stage-18 figure-choice contract can be part
of the synthesis request and schema, carrying the batch discount. A later
localisation or verification call uses `Stage = 'vision'`.

The normaliser preserves usable text for diagnosis and usage for accounting even
when generation failed. `stop` means transport completion, not valid content.
Empty output, missing output and unknown terminal statuses are errors. No adapter
sets a request to succeeded.

| Provider and route | Mapping to `finishReason` and `error` |
|---|---|
| Claude batch-api | Successful rows use the Messages mapping below. Row `errored`, `expired` or `canceled` maps to `error` with `PROVIDER_ERROR`, `BATCH_EXPIRED` or `CANCELLED`. Missing expected rows after terminal collection become `MISSING_RESULT`. |
| Claude sync-api, and successful batch messages | `stop_reason = end_turn` or a configured `stop_sequence`, with output, maps to `stop`. `tool_use` maps to `stop` only for exactly one expected emission tool with a serialisable payload; otherwise `UNEXPECTED_TOOL`. `max_tokens` and `model_context_window_exceeded` map to `length` / `OUTPUT_LIMIT`. Refusal, `pause_turn` in this single-completion contract, null or unknown reasons map to `error` with `REFUSAL` or `UNEXPECTED_FINISH`. |
| OpenAI batch-api | Check `row.error`, then require a numeric 2xx `response.status_code`, then apply the Responses mapping below. Non-2xx becomes `error` / `HTTP_ERROR`, missing status/body becomes `MALFORMED_RESULT`. Read both output and error files, keyed by `custom_id`, never arrival order. Duplicate contradictory rows fail reconciliation. |
| OpenAI sync-api, and 2xx batch bodies | `status = completed` with non-refusal output maps to `stop`. `status = incomplete` with `incomplete_details.reason = max_output_tokens` maps to `length` / `OUTPUT_LIMIT`; content filtering maps to `error` / `CONTENT_FILTER`, and another incomplete reason to `INCOMPLETE_RESPONSE`. `failed`, `cancelled`, refusal content, empty output or an unexpected non-terminal/missing status maps to `error`. HTTP errors take precedence over body status. |
| Claude subscription-cli via Agent SDK | Require a terminal result. `subtype = success`, `is_error = false`, and a complete `stop_reason` yield `stop`, serialising `structured_output` when supplied. Token/context exhaustion still yields `length`. `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries` map respectively to `SDK_EXECUTION`, `TURN_LIMIT`, `BUDGET_LIMIT`, `STRUCTURED_OUTPUT_RETRIES`, all `error`. `is_error`, an unknown subtype, contradictory terminal fields or no terminal event fails closed. `error_max_turns` is not confused with token truncation. |
| OpenAI subscription-cli via Codex | Require exit 0, a successful terminal JSONL event and a non-empty output-last-message file. Only then emit `stop`. Spawn/non-zero exit, signal/timeout, failure event, missing event/file or empty file becomes `error` / `CLI_EXIT`, `TIMEOUT`, `CLI_FAILURE` or `MISSING_OUTPUT`. A recognised explicit token-limit event maps to `length`; do not infer truncation from exit code or malformed JSON alone. File content subsequently passes common validation. |
| Gemini batch-api and sync-api, prospective | In W17, map candidate `finishReason = STOP` with content to `stop`, `MAX_TOKENS` to `length`, safety/blocklist/prohibited-content/recitation and prompt blocking to `error` / `CONTENT_FILTER`. Missing candidates, unknown reasons, per-row errors and failed/expired jobs fail closed. Preserve the raw vendor reason. Response shapes and request-key support must be established from the installed SDK/official contract in that future card; Gemini is disabled until then. |
| Gemini subscription-cli | Unsupported. Resolve `ROUTE_UNSUPPORTED`, never imitate Codex/Claude authentication or silently select an API route. |

HTTP 408/429 and 5xx can be transient; other 4xx are terminal configuration or
request failures. Retryable is diagnostic permission, not an instruction to
repeat a possibly charged POST. Only safe reads receive automatic transport
retries. Unknown submission outcomes are reconciled before any retry.

## Routes and selection

New `src/routes.ts` is the only credential/surface resolver. A credential
inventory contains availability and kind, not credentials in logs or state.
`resolveCredentialBinding(provider, route, inventory)` returns a binding with
`surface`, `credentialKind` and an opaque credential accessor. Both diagnostics
and actual client construction call this function. Secret material never enters
`RunPlan`, a batch manifest or output metadata.

| Provider | Route | Surface | Sole credential that surface may consume |
|---|---|---|---|
| Claude | `batch-api`, `sync-api` | Raw API SDK, `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` |
| Claude | `subscription-cli` | Agent SDK, `@anthropic-ai/claude-agent-sdk` | `CLAUDE_CODE_OAUTH_TOKEN`; `ANTHROPIC_API_KEY` absent |
| OpenAI | `batch-api`, `sync-api` | Files/Batches/Responses API | `OPENAI_API_KEY` |
| OpenAI | `subscription-cli` | `codex exec` | Existing Codex ChatGPT login; no API key in child environment and no API-key-mode auth file |
| Gemini, when enabled | `batch-api`, `sync-api` | Gemini API adapter | `GEMINI_API_KEY` |

An API key inside a Codex auth file is no longer an implicit source for an API
binding. Migrate by explicitly configuring `OPENAI_API_KEY`; never print its
value. Secret-manager use remains optional and orthogonal to this table.

`ROUTE_PREFERENCE` accepts a comma-separated ordered, non-empty list of `batch`,
`subscription`, `api`, mapped respectively to the three `Route` values. Trim
whitespace and lower-case tokens; reject unknown, empty and duplicate tokens
with `INVALID_ROUTE_PREFERENCE`. Default: `batch,subscription,api`. Omitted
routes are prohibited, not implicit fallbacks. A new explicit `--route` accepts
one canonical route value and pins it, overriding the preference.

For a new run, examine candidates in order for the selected provider, model and
input modalities. Skip unsupported capabilities or genuinely absent credentials
with a recorded reason. A missing preferred credential therefore falls through
only within the declared list. A malformed credential configuration, invalid
surface pairing or model/provider mismatch is an error, not a skipped candidate.
A pinned route fails on any unavailable requirement. Once resolved, quota
exhaustion, HTTP errors, schema rejection or CLI failure never changes the route
or provider. Re-poll and resume use the stored plan rather than today's
environment preference.

The selection log includes `provider`, `route`, credential **kind**, selected
models, policy source and skipped candidate reasons before dispatch. Persist
that decision and its plan digest, excluding secrets and local credential paths.
`status` needs no credentials. `poll <id>` first reads the stored provider/route
and then validates its binding; a conflicting explicit provider is
`RUN_PROVIDER_MISMATCH`.

Named refusal rules:

| Reason | Refused combination |
|---|---|
| `UNKNOWN_PROVIDER` / `PROVIDER_DISABLED` | Unknown name, or a known provider whose implementation has not been enabled |
| `CLAUDE_OAUTH_WRONG_SURFACE` | Claude Code OAuth token paired with the raw API SDK, including a caller passing it as a generic bearer token |
| `MIXED_BILLING_CREDENTIALS` | More than the selected credential in a binding or subscription child environment; legacy Claude `--sync` with both key and OAuth also retains its current rejection |
| `CODEX_AUTH_NOT_SUBSCRIPTION` | Codex login missing, malformed or API-key-backed when subscription is selected |
| `MISSING_ROUTE_CREDENTIAL` / `NO_USABLE_ROUTE` | A pinned route lacks its credential, or all declared candidates are unavailable |
| `ROUTE_UNSUPPORTED` / `MODEL_ROUTE_UNSUPPORTED` | Unsupported provider route, or a model without the required route/modalities |
| `MODEL_PROVIDER_MISMATCH` / `UNKNOWN_MODEL` | Model belongs to another provider, or is absent from validated registry data |
| `CONFLICTING_ROUTE_FLAGS` | `--sync` and `--route` supplied together |

A parent credential inventory may contain both an API key and subscription
login, allowing a batch synthesis followed by subscription vision. Each binding
and child environment contains only its permitted credential. Explicit clients
receive keys directly; subscription children get an allowlist environment.
Do not delete a global `process.env` key around concurrent calls. Do not let
`.env` loading in a child reintroduce stripped credentials. The legacy Claude
`--sync` mixed-environment refusal remains an extra compatibility guard.

During migration, `--sync` is a deprecated boundary alias. Claude pins
`subscription-cli`. OpenAI preserves its current explicit-environment API-first
behaviour, otherwise uses ChatGPT auth, logs the resulting route and recommends
`--route subscription-cli` or `--route sync-api`. The deprecated auth-file API
key shortcut produces a migration error, not a silent route change. No prefix
or `--sync` check survives inside the orchestrator.

The wrapper's future route descriptor maps these credential kinds to existing
placeholder variable names in `op-refs.sh`. It fetches only the credential for
the surface it launches. A plan with multiple stage bindings must resolve each
binding separately; it must not hydrate all secrets into a subscription child.
General tmux lifecycle/quoting hardening is outside this design and its cards.

## Run plan and tiers

```ts
interface StageBinding {
  provider: ProviderId;
  route: Route;
  model: string;
  maxOutputTokens: number;
}
interface RunPlan {
  version: 1;
  provider: ProviderId;
  route: Route;
  strategy: 'single-pass';
  tiers: {
    synthesis: StageBinding;
    repair: StageBinding & { route: ImmediateRoute };
    vision: StageBinding;
  };
  schema: SchemaRef;
  registryDigest: string;
  policyDigest: string;
  maxRepairAttempts: number;
  concurrency: number;
  callTimeoutMs: { synthesis: number; repair: number; vision: number };
  activeWallClockLimitMs: number;
}
```

The top-level provider/route equal the synthesis binding. Repair stays on that
provider. Batch synthesis defaults to `sync-api` repair on the same API key:
repair is a small, latency-sensitive second call and costs the standard rate.
Subscription synthesis defaults to subscription repair; API sync defaults to API
sync repair. A new explicit `REPAIR_ROUTE` may select an immediate route, but
must resolve before the run and never serves as automatic billing fallback.
If a required repair binding is unavailable, preflight fails unless
`maxRepairAttempts = 0` is deliberately configured.

Vision defaults to the run's provider. An explicit `VISION_PROVIDER` can select
another registered provider, but credentials alone cannot do so.
`VISION_ROUTE_PREFERENCE=subscription,api` is its separate default because later
localisation needs a prompt response. Its parser uses the same rules. An explicit
`VISION_ROUTE=batch-api` schedules deferred localisation as another batch and
keeps the article pending until that job is collected. There is no silent
conversion from a vision batch to sync. Vision binding errors surface before
submission when figures are required; optional figures receive an explicit
disabled-with-reason plan decision. A valid article may finish without an
optional figure, with that omission recorded.

The first figure **choice** travels in synthesis on the synthesis binding when
stage 18 supports the source representation. That is not a second vision-model
charge. Separate localisation/verification uses the vision binding and its own
model. This distinction preserves the batch discount without forcing all
follow-up work to wait another batch window.

| Stage | Claude | OpenAI | Gemini, prospective |
|---|---|---|---|
| Synthesis during compatibility rollout | Data profile preserving `claude-opus-4-8`; `claude.opus` currently offers `claude-opus-5-5`, subject to Q13 | Data profile preserving `gpt-5.6-terra`; no automatic promotion to the registry's `openai.synthesis` (`gpt-6-astra`) | Requires an explicit model until Q13's evaluation covers Gemini |
| Repair default | Registry `claude.sonnet`, currently `claude-sonnet-5-5` | Registry `openai.mini`, currently `gpt-5.6-luna` | Registry `gemini.flash`, currently `gemini-2.5-flash` |
| Vision default | Registry `claude.sonnet`, currently `claude-sonnet-5-5` | Registry `openai.batch`, currently `gpt-5.6-terra` | Registry `gemini.flash`, currently `gemini-2.5-flash` |

These are local registry resolutions and proposed tier bindings, not claims
that a model's current account access has been tested. W3 validates capability
data; fixture tests do not prove live entitlement.

Use provider-scoped overrides such as `MODEL_CLAUDE_SYNTHESIS`,
`MODEL_OPENAI_REPAIR` and `MODEL_OPENAI_VISION`, then the corresponding local
`tiers.<provider>.<stage>` setting, then data-profile defaults. New vision
resolution never reads `MODEL`, `MODEL_BATCH` or `MODEL_SYNTHESIS`. Legacy
`FIGURE_VLM_MODEL`, `FIGURE_VLM_VERIFY_MODEL`, `FIGURE_DATA_MODEL` and
`FIGURE_VLM_PROVIDER` are translated once into explicit vision sub-call bindings,
with warnings and membership checks; no consumer resolves them independently.
Conflicting old/new settings fail with `CONFLICTING_MODEL_OVERRIDE`.

Retain legacy synthesis overrides at the CLI boundary for compatibility:
Claude batch reads `MODEL_BATCH`/`MODEL`, Claude sync `MODEL_SYNTHESIS`, and
OpenAI single-pass uses `MODEL_SYNTHESIS`. Log ignored legacy batch-only knobs
on OpenAI rather than implying that they selected a synthesis model. All resolve
to the single synthesis tier. Do not introduce a new batch-specific model tier.

Model membership is an exact registry lookup including declared aliases and
versioned IDs. Validate every binding before uploads, subprocesses or remote
requests. Never classify every non-`claude-` ID as OpenAI. An operator can add a
validated local model row with provider/capabilities; a missing price is a
separate visible condition. Freeze the resolved IDs and registry digest so a
registry update cannot change a repair model midway through a run.

## Orchestrator

`src/orchestrator.ts` is new. Existing CLI functions become thin calls into it.
Registration chooses the adapter once; the scheduler branches on route
capability, not vendor. All paths follow:

1. Resolve and persist the plan, source digest, expected date, detected byline,
   reference, focus/figure directives and submission intent.
2. Build requests with the shared schema dialect and full source representation.
   Chunk remote batches, save each handle before starting the next chunk, and
   poll. For local execution, lease queued items and call `complete`.
3. Collect by manifest key. Persist the normalised result and usage immediately,
   before validation, repair or figure work. Record length/transport/refusal
   failures as failed attempts, never parse them into a successful article.
4. Enter the single `finalizeResult` seam for every successful synthesis receipt,
   irrespective of route. Parse, canonicalise and apply deterministic content
   fixes using stage 16's interface. Apply authoritative source metadata to the
   validation candidate so a missing date/byline does not waste a repair call.
5. Validate and classify issues. Run at most two LLM repair attempts for eligible
   content issues. Every repair receipt goes through canonicalisation and
   validation again, and every attempt's usage is appended, not overwritten.
6. Consume the stage-18 choice and complete any required, separately checkpointed
   figure work. Run stage 19's chart evidence interface when available.
7. Stamp final run provenance and costs, validate the exact final artefact again,
   and atomically save it. Checkpoint canonical success before separately
   copying/rendering destinations. Failed mirrors resume without generation.

New `src/finalize.ts` exports the seam:

```ts
finalizeResult(
  itemKey: string,
  result: NormalizedResult,
  context: FinalizeContext
): Promise<FinalizeOutcome>
```

`FinalizeContext` supplies the frozen plan/source provenance, checkpoint store,
repair/vision execution callbacks and stage-16/18/19 interfaces.
`FinalizeOutcome` is a discriminated `succeeded | needs_review | errored` result
carrying the artefact digest, destination statuses, issue codes and accumulated
cost. Providers cannot call `saveResult` directly. W10 promotes the existing
`src/batch.ts:246` name into this single substantive seam; `src/output.ts`
becomes deterministic persistence/render support, not a place to launch hidden
model calls.

| Issue class | Action |
|---|---|
| Deterministic representation/metadata | Code first: existing null and schema normalisers, plain-text derivation, canonical date/slug/byline/reference stamping and supported formatting repairs. Never invent source facts. Revalidate. |
| Repairable prose/structure | With complete source evidence, repair missing required narrative structure or style violations that code cannot safely fix. Include the source context and typed issue list; keep the best parseable candidate and all usage. A repair must reduce eligible issues without introducing hard failures. |
| Invalid JSON | Try only deterministic extraction/canonical parsing. If still unparseable, preserve the raw receipt and fail `INVALID_JSON`; retry generation only through an explicit new attempt. Do not pay for a model to reconstruct an unknown partial article. |
| Chart values or evidence | Never send chart-value issues to LLM repair. Preserve valid chart data unchanged, or omit/quarantine the chart through stage 19's policy. In prose repair, exclude chart data from the editable payload and reattach the original data; compare its digest. A repair that changes numbers/evidence is rejected. Keep the current six-point filter until the provenance gate replaces it. |
| Truncation, refusal, source missing, schema contract failure | Fail the item with the normalised reason; do not save as success. Increasing a cap or changing a model requires an explicit retry plan. |
| Remaining content issues after bounded repair | Save a review artefact in a separate review destination, mark `needs_review`, return a non-zero aggregate status, and omit normal website staging. This replaces the current invalid-as-success behaviour. |

Optional figure failure can produce a valid article without an image and a
recorded warning. A required figure failure leaves the item incomplete. Figure
bytes, provenance and warnings are checkpointed; replay does not invoke figure
vision merely because saving was interrupted.

Batch chunking uses serialised bytes, not character count or raw PDF size.
W5/W6 supply provider capability limits; the initial operational ceilings are
10,000 requests and 100,000,000 bytes per chunk, further reduced by any known
provider limit. These are conservative application caps, not claims about the
providers' maximum allowances. Count JSONL newlines, document base64 expansion
and batch wrappers; a single oversized request fails `REQUEST_TOO_LARGE` before
submission. Persist ordered chunk manifests and collision-checked identifiers
made from a hash with only letters, digits, hyphens and underscores, at most
64 characters. Do not split one paper into evidence lanes to fit a chunk.

Use the provider's 24-hour completion window, recorded at submission, rather
than treating the current 12-hour client wait as provider expiry. Default one
poll session to at most 24 hours plus a 15-minute reconciliation grace period,
bounded by the stored submission deadline plus that grace period. Check status
immediately on resume. Back off transient read failures, honour retry hints,
and pause after five consecutive failures. Reaching the local wait cap saves
state and exits resumably; it does not cancel a job or mark pending rows failed.
Only a terminal provider snapshot and reconciled result manifest establish
expiry/missing rows. If the provider is still running beyond its window, record
`POLL_WINDOW_EXCEEDED` and require a later poll, never resubmit automatically.

## State and resume

New writes use `State.version = 2`, separate from article schema version and
`RunPlan.version`. The state contains `revision`, batches, immutable plans,
per-item attempts, finalisation receipts and `file_cache`.

Each new batch records `provider`, `route`, `kind: remote | local`, plan digest,
remote chunk handles, submission/deadline timestamps and status. Each request
records synthesis `provider`/`route`, source/provenance snapshot, plan digest,
attempts and artefact receipts. Each actual call additionally records its own
stage/provider/route/model, because repair and vision may use another route.
Output receives `metadata.provider`, `metadata.route`, `metadata.run_id`,
`metadata.plan_digest` and `metadata.cost`. Optional figure provenance records
the actual vision binding. These additions must enter stage 16's shared output
contract and consuming renderer type together; they are not unilateral schema
extensions by this refactor.

Item states are `queued`, `running`, `received`, `finalising`, `succeeded`,
`needs_review`, `errored` and `outcome_unknown`. Call attempts have their own
intent/receipt state. No item is succeeded until its canonical artefact exists
and matches its recorded digest. Batch `completed` means all items have terminal
states; a separate outcome counts failures/reviews rather than hiding them.

### Writes, ownership and idempotency

Use per-transition snapshot writes, including each item completion and each
model receipt, without debounce. Acquire a short exclusive state lock, re-read
and validate the current revision, apply a targeted item/attempt update, write a
uniquely named sibling temp file, fsync it, rename it and fsync the parent
directory. Release the lock before network calls or subprocess waits. This
extends the existing atomic rename instead of assuming rename solves races.

Also acquire a batch execution lock for collection/resume, retained through
long calls. A `process` and `poll` targeting the same batch cannot both repair
it; operations on different batches can run and merge individual updates.
Implement locks with exclusive directory creation and an owner nonce, hostname,
PID and process-start identity. Never evict a lock merely because a timeout
elapsed. Reclaim only after verifying the same-host owner process has died;
foreign/uncertain ownership yields `STATE_BUSY` for operator intervention.
Lock acquisition has a finite wait and a clear error. Shared network-filesystem
locking is unsupported in this version.

The logical request key is a hash of run ID, item source digest, plan/schema
digest and stage. `attemptId` adds a monotonically increasing attempt number.
Provider `customId` is a bounded encoding of that key, checked for collisions
against the persisted manifest. Re-collect idempotency is
`(runId, customId, attemptId)` plus receipt digest. A repeated identical row is a
no-op; contradictory duplicate results are `RESULT_CONFLICT`.

Persist intent before every charged/subscription call and the receipt before
continuing. Re-poll skips succeeded items and reuses already received synthesis,
repair and vision. Crash after a call but before its receipt is inherently
ambiguous: recover from provider idempotency/retrieval or durable CLI spool when
possible, otherwise mark `outcome_unknown`. Do not claim exactly-once remote
execution or automatically repeat that call. The same rule applies to a batch
submission interrupted before its handle is durable.

Before writing an article, persist a finalisation intent with the destination,
content digest and request key. Atomically rename the prepared canonical file,
then mark success. On restart, a matching existing file completes the intent;
a different file at that path is `OUTPUT_COLLISION`, not permission to overwrite.
Destination-copy and HTML-render receipts are independent; failure there does
not rerun synthesis or repair. Store immutable source text and digests sufficient
for resume; verify file/image digests before using external source paths again.
Source snapshots and receipt spools are runtime data under the configured state
directory, never committed source files.

### Local execution and explicit retry

Subscription runs and sync API runs create local batches before any call.
Default concurrency is 1; a configured value up to 4 is allowed and frozen in
the plan. Per-call caps default to 600 seconds synthesis, 300 seconds repair,
180 seconds vision, with a cumulative two-hour active execution cap per local
run. Remote queue waiting does not consume that local cap. Terminate a timed-out
child process group, preserve any receipt and mark ambiguity where necessary.
Do not reset the active-time budget silently on resume.

New `process --resume <run-id>` resumes a local batch or orchestrated remote run
using its saved plan. It schedules queued work and resumes received/finalising
items, skipping successes. Expired in-flight ownership is reconciled as above.
`poll` without an ID selects only `kind = remote`, `route = batch-api` jobs with
outstanding collection, even if the provider job has already ended. It never
executes a local subscription job. Explicit `poll` of a local ID returns
`LOCAL_RUN_REQUIRES_RESUME` and the resume command.

`--retry-errored` with an explicit run ID creates new attempts for failed items;
it never reruns successes or resets usage. Reviews require a targeted retry
decision, not an argument-less poll. An `outcome_unknown` item additionally
requires an explicit acknowledgement flag, proposed
`--accept-unknown-outcome`, because repeating it can duplicate spend. Changing
models, routes or caps creates a recorded retry-plan revision with parent links,
rather than mutating the original plan. Preserve source metadata and expected
date across all retries.

### File cache and legacy migration

`file_cache[provider][accountScope][purpose][sha256]` holds file ID, size,
uploaded/verified times and optional expiry. `accountScope` is a non-secret
operator namespace or provider account identifier, never a raw key or token.
If a reliable scope cannot be established, disable cross-run reuse. OpenAI
validates existence when necessary; Gemini records server expiry and treats its
approximately 48-hour lifetime conservatively. Reuse for a new batch requires
validity through its expected completion deadline plus a five-minute margin;
an immediate call requires validity through its own deadline plus that margin.
Never send one provider's file ID to another. A 404/expiry invalidates that
entry; an auth error fails the binding rather than causing endless reuploads.

Loading invalid JSON, invalid state shape or an unsupported future version
raises `STATE_CORRUPT` or `STATE_VERSION_UNSUPPORTED` and prohibits all writes
and dispatch. A diagnostic byte-for-byte backup may be made, but the original
remains untouched. Only an absent state file means an empty new state.

Migration is explicit, via new `scripts/migrate-state-v2.ts`, with a read-only
preview, then an apply mode under an exclusive migration lock after all old
writers are stopped. Back up original bytes under a unique name, validate the
entire converted state, then atomically replace it. Never hand-edit `state.json`.

| Existing record | Conversion |
|---|---|
| Remote Claude/OpenAI batch with a known provider | `kind = remote`, `route = batch-api`; retain actual remote ID, request IDs, dates, outputs and known provenance. Missing historical provider follows the old Claude default only where the record is otherwise consistent; conflicting evidence is quarantined. |
| `sync_claude_*` from this OAuth-only CLI | Local subscription run with a recorded legacy inference. Completed results remain completed; unrecoverable active attempts become `outcome_unknown`. |
| `sync_openai_*` | Route cannot be inferred from prefix, model or today's credentials. Preserve it as a non-executable legacy record with `route = null`, `migration_status = needs_route_evidence`. Operator supplies historical evidence, or starts an explicit new run; do not fabricate past billing. |
| `codexbatch_*` | Known local subscription intent. Preserve any receipts; migrate single-pass pending items to the local scheduler only after source recovery. Lane-bearing records require the drain/restart policy below, not hidden lane execution. |
| Lane-bearing or otherwise ambiguous history | Retain a read-only legacy archive including old usage. Drain pending remote lane jobs on the old build before cutover; if not drainable, require an explicitly recorded abandonment and a new single-pass attempt. Never quietly discard paid work. |
| OpenAI file cache | Move known hashes/IDs into the OpenAI namespace only with a confirmed account scope; otherwise retain as unverified legacy entries and revalidate/reupload when explicitly executing work. |

The executable v2 batch/request types always require a real route; nullable
route exists only in the separate legacy archive. Preserve old aggregate cost
under `legacy_usage`, marked non-comparable when route or attempts are unknown.
Missing byline/date/reference values remain unknown unless recovered from
unchanged source evidence. Do not rewrite historical output files or
retroactively label unknown legacy charges as zero.

## Cost

Cost is a projection of the call ledger, not of the parent batch's mode.
State stores `requests[item].attempts[].calls[]`; each entry includes
`call_id`, `attempt_id`, `stage`, `provider`, `route`, `model`, `usage`,
`price_snapshot_digest`, `pricing_timestamp`, `pricing_status`,
`estimated_charge_usd`, `api_equivalent_usd` and `saving_usd`.
The shared cost summary on the request and in output `metadata.cost` contains
the same three monetary totals plus `known_charge_usd`, `pricing_status` and
`unpriced_call_ids`. Output can summarise calls without exposing raw receipts.

`estimated_charge_usd` means estimated incremental usage charge, not a provider
invoice. Subscription is exactly 0 for that field; monthly subscription fees
and quota consumption are not allocated to articles. `api_equivalent_usd` is
the same model's standard synchronous API price for the observed token classes,
at the call timestamp. It is not the price of a hypothetical cheaper model.
`saving_usd` is the difference only when both figures are known.

| Actual call route | Estimated charge | API equivalent |
|---|---|---|
| `batch-api` | Batch price for each supported token category | Standard API price for the same categories |
| `sync-api` | Standard API price | Same as estimated charge |
| `subscription-cli` | 0 | Standard API price, labelled estimated equivalent |

Repair after batch synthesis is normally `sync-api`, so only the synthesis
gets the batch discount. Report both lines, including rejected repair attempts.
Vision selection, verification and any separately authorised figure-data call
must emit ledger entries through the same execution callback. If figure choice
is part of synthesis there is no second call to cost. A failed attempt with
reported usage is still costed.

Normalised `usage.in` excludes cache-read and cache-write tokens; `out` includes
reasoning tokens when they are already counted in provider output totals.
OpenAI input totals are split by subtracting reported cached tokens; Claude
input and cache-creation/read categories are mapped without double counting.
Agent SDK aggregate usage must not be added to the same per-model usage again.
Codex terminal events are deduplicated by turn/event identity before summing.
If a subscription internally uses more than one model, retain per-model ledger
subentries or mark the equivalent partial, rather than applying one model's
rate to the entire session.

For complete prices and usage:

```text
api_equivalent_usd =
  (in * standard_input_rate
   + cacheRead * standard_cache_read_rate
   + cacheWrite5m * standard_cache_write_5m_rate
   + cacheWrite1h * standard_cache_write_1h_rate
   + out * standard_output_rate) / 1_000_000
```

Use explicit batch rates or a verified category-specific batch factor.
Do not blindly halve cache-write rates or infer absent rates from comments.
Unknown usage is null, not zero. Zero is valid only when the surface reports
zero or establishes the category is unused. Missing model/rate/category produces
a prominent `UNPRICED_MODEL` or `UNPRICED_TOKEN_CATEGORY` warning with model,
route and registry digest, and null affected totals. `known_charge_usd` remains
available as a lower-bound subtotal; the UI must not label it the full cost.
Subscription charge can still be 0 while its API equivalent is null.

Use unrounded values for aggregation and round only for display. Persist the
resolved price row, pricing date and policy digest, so re-poll does not silently
reprice earlier calls. Rate changes, promotions, context-length thresholds and
cache multipliers must be data, not provider branches in `calcCost`.
Promotional floor dates trigger a review warning when passed; they do not
prove an automatic price rise. Unknown threshold pricing is marked partial.

W11's synthetic test case uses the local registry's Terra 2/12 rates:
one million uncached input and one million output tokens cost 7 on batch,
14 on sync API, or 0 with a 14 API equivalent on subscription. A Luna repair
with the same synthetic token counts adds 1.4 at standard rate to the batch
case. This is an arithmetic fixture, not a forecast of article cost.

## Registry

New `src/model-registry.ts` loads data into a validated, versioned internal
registry. The sibling `mcp-hub/config/models.json` is the fleet source;
explainer-batch must not require a sibling checkout at runtime.
It currently supplies tier aliases and `pricing` rows, but not a complete
machine-readable model-capability, batch-limit or cache-write-rate catalogue.
Normalise its actual structure, preserve verification dates, and supplement
missing capability data in a reviewed local snapshot. Do not scrape prose
comments into executable rules.

Resolution precedence, highest first:

1. Provider-scoped model environment overrides and an explicitly selected
   `EXPLAINER_MODEL_REGISTRY` file for registry rows.
2. Local `config/models.json`, preserving its current optional override use and
   accepting the new typed tier/registry overrides.
3. Fleet registry file specified by `MCP_MODEL_REGISTRY`.
4. Committed, public-safe `config/models.snapshot.json` (**new**), generated
   from the reviewed fleet registry with source digest, capture date and
   capability/rate evidence.
5. A minimal built-in bootstrap descriptor for supported providers and error
   reporting. It has no duplicate price table and cannot silently start a
   default run if the distributed snapshot is missing.

Merge model/tier keys in that order, but treat each price row as an atomic unit:
do not combine one file's promotional input rate with another file's output
rate. An invalid explicitly selected file is `REGISTRY_INVALID`; a missing
explicit path is `REGISTRY_NOT_FOUND`, not permission to ignore it. An absent
optional local/fleet file falls through. Resolve relative configured paths from
the repository root. The operator supplies any machine-specific path through
environment/local configuration; no absolute home path or assumed sibling
lookup is committed.

Each model row has provider, aliases, route/modality support, token constraints,
and a price reference. Each price row has currency, token-category rates,
effective-date information and evidence status. Explicit custom rows may be
unpriced, producing the loud unknown-price behaviour above; shipped default
profiles must have complete ordinary input/output prices. Tier aliases are
resolved once when the plan is created. A changed registry cannot invalidate
collection of an existing frozen plan.

New `scripts/update-model-snapshot.ts` takes the configured fleet file and
produces a deterministic candidate snapshot for review. It does not update
mcp-hub, fetch secrets, publish, or automatically change synthesis defaults.
The snapshot excludes local paths, credential references and account data.
`scripts/smoke-models.ts` is extended to check synthesis, repair and vision,
provider ownership and price coverage, including a public-clone fixture with
both registry environment variables and local overrides absent.

A public clone therefore gets the same reviewed model IDs and prices without
any private checkout. "Correct prices" here means faithful calculation from a
dated, validated snapshot, not a claim that an offline bundle knows future
vendor changes. Print the price basis/date; expired evidence or unresolved
promotions raises `PRICE_REVIEW_DUE`. If the snapshot is missing and no registry
is configured, fail `REGISTRY_UNAVAILABLE` rather than report invented zeroes.
The compatibility synthesis profile remains data pinned to current behaviour
until Q13; removing constants does not authorise a model upgrade.

## Subscription routes

### Claude Code OAuth and the two SDKs

The Claude Code OAuth credential is valid on the Agent SDK and `claude` CLI.
It must never reach the raw `@anthropic-ai/sdk` API client. The operator measured
a `429 rate_limit_error` without rate-limit headers on that invalid pairing on
2026-09-01, rather than a 401. Take that observation as supplied evidence; do
not reproduce it, reinterpret it as spent quota, or retry it.

`resolveCredentialBinding` refuses the mismatch with
`CLAUDE_OAUTH_WRONG_SURFACE` before importing/constructing the raw API client.
API constructors require the API binding type; the Agent SDK adapter requires
the subscription binding. `ANTHROPIC_API_KEY`, other provider keys, proxy/base
URL overrides and secret-manager credentials are absent from the Agent SDK
child's allowlist environment. This applies equally to synthesis, repair and
vision. The same validation powers route diagnostics.

The installed Agent SDK declares `outputFormat` at
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1402`, with
`{ type: 'json_schema', schema }`, and exposes `structured_output` on success at
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2913`.
W7 uses the stage-16 dialect, consumes that structured value, and preserves
usage on every result subtype. The declarations establish an API surface,
not proof that every generated schema works with every model.

Use a temporary cwd, `settingSources: []`, `tools: []`, an explicit
`systemPrompt`, `permissionMode: 'dontAsk'`, an abort controller and a sanitised
`env`. The type definition explicitly says `tools: []` disables built-in tools
at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1160`; the existing
`allowedTools: []` is not sufficient evidence of that. Supply inline source
content as today, without loading repository instructions.
Set a bounded `maxTurns` of 3 to allow structured-output handling within a
single logical completion, with the per-call wall-clock cap and at most two
outer content-repair attempts. Do not set `maxBudgetUsd = 0` on the assumption
that the SDK's API-equivalent counter is subscription billing.

W7 must test exhaustion and missing structured output explicitly. Runtime
schema/turn behaviour remains unverified by this offline design; failure must
surface as a named result, not a fallback to paid raw API.

### Codex invocation and source delivery

The installed `codex exec --help` was read offline. It confirms:

- `--output-schema <FILE>` and `--output-last-message <FILE>`.
- `-C, --cd <DIR>` for the working root.
- Omit the prompt or use `-` to read stdin.
- `--json`, `--image`, `--sandbox read-only`, `--skip-git-repo-check`,
  `--ephemeral`, `--ignore-user-config` and `--ignore-rules`.

It does **not** establish the accepted JSON Schema subset, the exact JSONL
failure-event vocabulary, or a numerical output-token cap flag. Do not invent
such flags. `maxOutputTokens` is a requested budget on subscription surfaces
without an enforceable option; their descriptor says `outputTokenLimit =
advisory`. Wall-clock and turn limits remain enforced. A policy requiring a
hard output-token limit rejects an advisory route during preflight.
W8 fixture-tests known events and fails closed on unknown terminal
ones; W9 owns one subscription call proving the actual generated dialect on
the pinned CLI/model pair. That result proves the exercised schema, not every
possible JSON Schema feature.

W8 creates a private root using `mkdtemp`, with separate `work`, `auth` and
`artifacts` subdirectories. `work` starts empty and is both the spawned process
cwd and the `-C` argument. The generated schema and final output live under
`artifacts`, with paths unique to this invocation. An isolated Codex auth home
contains only the selected ChatGPT login material, with restrictive permissions
and no API key, global instructions, settings, plugins or hooks. Never modify
the operator's normal auth home. Keep a narrow allowlist of required runtime
environment variables.

Invoke the following argument shape with `spawn`, not a shell; bracketed
values below are conceptual path/model substitutions, not literal flags:

```text
codex exec --model <resolved-model> --json --sandbox read-only
  --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules
  -C <empty-work-dir> --output-schema <schema-file>
  --output-last-message <unique-output-file> -
```

Write the full prompt to `child.stdin`, close it, and stream bounded diagnostic
events to a private spool. `-C` prevents project `AGENTS.md` inheritance; the
auth-only home and ignored user configuration prevent global configuration
from reintroducing instructions or an API-backed provider. W8 verifies the
arguments, environment and absence of inherited configuration using a fake
CLI. W9 verifies the resulting real invocation can still authenticate.

Read the output file only after successful completion, requiring the event and
exit checks in the result mapping. Copy the receipt into the durable state
checkpoint before cleanup. The state records the temporary spool location
privately for crash recovery; if it has disappeared, an unresolved attempt is
`outcome_unknown`. Clean up auth/schema/output files in `finally` after receipt
handling. Kill the process group on timeout, not just its parent shell.

There is no native PDF flag in this evidence. W8's new shared
`src/source-snapshot.ts` prepares text before a CLI request; W12 calls it from
the common preparation boundary. No PDF-to-text helper was found in the current
TypeScript sources, so it wraps the already documented `pdftotext` prerequisite
with explicit failure handling. Preprocessing must extract the
complete supported source text and include it in stdin with page/source labels.
Do not send base64 fragments, a provider file ID, or "read this file" in place
of paper content. Text extraction failure or context overflow fails preflight
with `SOURCE_TEXT_UNAVAILABLE` or `SOURCE_TOO_LARGE`; do not silently clip the
paper or enable web search. Record `source_delivery = extracted-text`.
For stage-18 visual work, attach rendered page/candidate images with repeated
`--image` arguments and an ordered label manifest, recording the delivered
modalities. Images improve figure context; they do not make the route
PDF-native.

## Deletions

Ranges below refer to `37fa951` and include blocks to remove or extract, not
instructions to delete whole files blindly. Preserve wave-1 correctness fixes
and unrelated image sizing/cropping code.

| Order | Current code/config | Replacement and deletion gate |
|---|---|---|
| 1 | Provider-specific repair wrappers, `src/batch.ts:257` to `src/batch.ts:296`; cost merge `src/batch.ts:298` to `src/batch.ts:320` | W10/W11 supply one finaliser and ledger projection. Delete wrappers only after both adapters feed the same tests. Keep and evolve the shared `src/repair.ts` logic. |
| 2 | Submit copies, `src/batch.ts:322` to `src/batch.ts:519`; poll dispatch, `src/batch.ts:521` to `src/batch.ts:538` | W5/W6/W12 move wire construction into adapters and scheduling into the orchestrator. File caching becomes provider-keyed. |
| 3 | Collect copies, `src/batch.ts:540` to `src/batch.ts:811`; sync copies, `src/batch.ts:950` to `src/batch.ts:1198`; provider dispatch `src/batch.ts:1254` to `src/batch.ts:1258` and `src/batch.ts:1306` to `src/batch.ts:1310` | W12 selects one path for every route, then W15 removes duplicates after replay parity and migration checks. |
| 4 | `codexbatch_` construction, `src/batch.ts:502` to `src/batch.ts:516`; `collectOpenAILocal`, `src/batch.ts:813` to `src/batch.ts:947`; prefix dispatch, `src/batch.ts:1289` to `src/batch.ts:1300` | The resumable local scheduler replaces all three. Keep only historical prefix recognition in the migration reader and fixtures. |
| 5 | Lane helpers, `src/batch.ts:158` to `src/batch.ts:182`; lane request blocks at `src/batch.ts:389` to `src/batch.ts:403`, `src/batch.ts:446` to `src/batch.ts:461`; lane collection/synthesis at `src/batch.ts:666` to `src/batch.ts:810`; sync lane path at `src/batch.ts:1083` to `src/batch.ts:1144`; lane state creation at `src/batch.ts:1235` to `src/batch.ts:1248` | Delete, do not generalise. Local lane execution also disappears with `collectOpenAILocal`. Gate on drained/explicitly archived legacy jobs. Preserve full-source single-pass requests. |
| 6 | `OPENAI_LANES`, `OpenAILane`, `laneCustomId`, `parseLaneCustomId` at `src/model-config.ts:5` to `src/model-config.ts:6` and `src/model-config.ts:119` to `src/model-config.ts:127`; lane fields at `src/state.ts:50` to `src/state.ts:52` and `src/state.ts:84` to `src/state.ts:88` | Remove from active types. Read-only legacy record definitions retain historical fields solely for migration. New request IDs have no `::` separator. |
| 7 | `OPENAI_USE_LANES`, `MODEL_LANE`, `LANE_MAX_TOKENS`, `laneModel`, `laneMaxTokens`, `lane_model`, lane-only `synthesis_batch_id`; old `batchModel`/`batch` tier aliases after boundary migration | Remove live environment/config consumption, example entries, smoke tiers and README instructions. Main locations: `src/model-config.ts:8` to `src/model-config.ts:36`, `src/model-config.ts:61` to `src/model-config.ts:83`, `scripts/smoke-models.ts:29` to `scripts/smoke-models.ts:34`, `config/models.json.example`, `README.md:201`. A removed key yields an actionable config error rather than reactivating lanes. |
| 8 | Ambient vision routing, `src/vision.ts:71` to `src/vision.ts:116`, `src/vision.ts:193` to `src/vision.ts:215`, `src/vision.ts:221` to `src/vision.ts:237`; old Codex runner, `src/providers.ts:653` to `src/providers.ts:728`; copied prices, `src/pricing.ts:9` to `src/pricing.ts:41` | W13 uses the plan and adapters, W8 replaces the runner, W2/W11 replace the price table. Keep image preparation helpers. |

The fleet registry's unrelated `openai.lane` alias is not deleted from mcp-hub;
other consumers may still use it. Explainer-batch stops consuming or exposing
it. Deprecated key names may remain only in migration/error messages and tests.

## Adding Gemini

Today Gemini would require the review's approximate 11-file, 15-or-more-branch
change. The observed sources support the cause: two-provider fallback logic,
paired orchestration and independently selected vision/auth/pricing.

After this refactor, W17 adds one provider module (**new**
`src/providers/gemini.ts`, estimated 250 to 400 production lines), an explicit
registration entry in **new** `src/providers/registry.ts`, local registry
capability/price rows and schema-service registration for the stage-16-owned
Gemini dialect. Expect roughly 300 to 500 production lines across 3 to 5 files,
plus 150 to 250 lines of fixtures/tests. These are planning estimates, not
measured output or a reason to duplicate the orchestrator. A new dependency
would require its own declared package change only if the implementation
chooses an SDK instead of HTTP.

Gemini batch/sync use the same source, request, result and finalisation
contracts. Vision is a modality capability of the selected model. There is no
subscription route initially. `GEMINI_API_KEY` belongs only to the Gemini API
binding; no credential is inferred from another provider's environment.

The file adapter records provider expiry and scopes reuse to the account.
Treat uploaded files as expiring in about 48 hours. Reuse requires enough
remaining lifetime for the new batch's full completion window plus five
minutes; otherwise reupload from the source snapshot before submission.
Once a batch has been accepted, do not mutate its request or assume
reupload repairs that existing job; poll its actual outcome.

Batch JSONL uses a per-request key carrying the manifest custom ID. The adapter
must associate results with the echoed key rather than order; missing, unknown
and duplicate keys are errors. W17 must establish the chosen Gemini endpoint's
exact key field and response shape before enabling it, and fixture-test shuffled
results, expired files, blocked candidates and partial job failures. If that
endpoint lacks reliable keying or the required schema subset, keep Gemini
disabled with a named capability failure. No change to orchestration, cost
branching or finalisation is required.

## Migration and rollback

Every step runs `npm run typecheck` and the relevant offline fixture tests
before integration. Existing routes keep their old dispatch path until their
replacement and migration are ready; there is no mixed per-item fallback.
The same saved input/response fixtures exercise all routes. This is development
integration, not a public publish sequence.

1. Land W1 to W4 behind existing public entrypoints: types, registry loader,
   credential/plan resolver and v2 store/migrator. Keep v1 runtime readers and
   current CLI behaviour until cutover. Run the new state migrator only against
   disposable copies during this step.

Rollback: revert the unused modules/adapters; live v1 state has not changed.

2. Land W5 to W8 adapters alongside existing transports, consuming the shared
   schema interface. Stage 16's implementation supplies that generator; until
   delivered, a labelled compatibility adapter uses the current schema without
   claiming a redesigned contract. W9's schema probe gates Codex structured
   enforcement, not general availability of the existing subscription route.

Rollback: retain old dispatch and disable the new adapter selection. Do not
silently remove schemas on a failed new-route call.

3. Land W10/W11 finalisation and cost services with recorded-result replay tests.
   Introduce typed compatibility bridges for old `SaveResult`/usage callers;
   migrate callers together when switching them, so no route bypasses validation.
   Output metadata additions require stage 16's contract/renderer coordination.

Rollback: before live cutover, revert the unused services. After v2 operation,
return to the last v2-compatible build and retain receipts; never recreate old
costs by overwriting the ledger.

4. Land W12's orchestration and W13's figure binding against fixtures. Stage 18's
   contract integration must be ready before enabling synthesis-carried figure
   choice. Until then, preserve current figure behaviour behind an explicit
   compatibility hook, while recording every actual vision call. Stage 19's
   provenance gate lands independently; the six-point filter remains active.

Rollback: keep the old route selected for runs not yet migrated. For a v2 run,
pause and resume only with a compatible orchestrator; no dual execution.

5. W14 rehearses then performs the explicit state migration after stopping old
   writers and draining old remote/lane jobs. Preview ambiguity, back up v1
   bytes, write v2 atomically and switch entrypoints. Collect already submitted
   compatible remote jobs by their original IDs. New jobs use the frozen plan,
   result manifest, per-item ledger and local resume semantics.

Rollback: before any new dispatch, the migration tool may restore the validated
backup under the same exclusive lock. After any v2 operation, do not restore a
stale backup. Preserve v2 and use the last compatible build; export outstanding
remote handles and unresolved attempts if manual recovery is needed.

6. W15 deletes the redundant paths, lane code and deprecated configuration after
   the drain and replay gates pass. W16 records the operator's synthesis-model
   evaluation; only a subsequent explicit default-profile decision changes new
   runs. W17's Gemini implementation is optional and follows the same gates.

Rollback: revert a code deletion or profile change on the private development
line while retaining v2 readers, locks and receipts. Old lane history remains
readable but is never silently re-executed. A model-profile rollback affects
only new plans.

## Tradeoffs

1. Capabilities are per route and restricted by model, rather than one set of
   provider-wide booleans. `buildRequest` is async and submission/status have
   distinct return types; only result streaming is an `AsyncIterable`.
   These refine the review sketch because PDFs, schemas and batch support differ
   by surface, and upload preparation may perform I/O.

   Rejected: a single provider-wide `strict`/`pdfNative` promise or pretending
   submitting a batch itself streams completed articles.

2. Keep a single JSON state snapshot with short transaction locks and separate
   batch execution ownership. It extends the existing store and is sufficient
   for a small local CLI, at the cost of rewriting growing history.

   Rejected: debounce that loses item receipts, an append log without compaction,
   or adding SQLite and its migration burden in this refactor. Revisit the store
   only if measured state size/lock contention warrants it.

3. Pause uncertain remote outcomes rather than promising exactly-once charging.
   A persisted intent cannot prove a server rejected a request when the response
   was lost.

   Rejected: automatic replay of every in-flight operation after a crash, which
   can repeat repair, figure work or whole batch submission.

4. Vision has an explicit independent binding, while the initial figure choice
   rides synthesis where stage 18 permits it. Batch repair defaults to immediate
   API execution with standard-rate accounting. These departures from one
   route for every stage make latency and price visible.

   Rejected: ambient credential-driven vision, or forcing every small repair
   and localisation call through another 24-hour batch window.

5. Retain current synthesis IDs in a compatibility data profile while removing
   hard-coded executable defaults. Offer newer registry aliases and their price
   evidence without changing the operator's quality decision.

   Rejected: promoting Astra or Opus 5.5 merely because the fleet tier moved,
   and retaining a separate handwritten per-repo pricing table.

6. Strict transport output is an aid, not the canonical validator. Preserve a
   fully validated tool route where Claude models do not support forced tool
   choice; prove the concrete Codex dialect separately.

   Rejected: treating `--output-schema` help or a 2xx response as proof of a valid,
   source-grounded article.

7. Invalid content becomes a review artefact or failure, with an explicit
   migration change in success semantics. This may reduce the apparent success
   count while making the count describe usable results.

   Rejected: staging invalid JSON as normal success, repairing chart numbers
   with an LLM, or removing the six-point filter before its replacement gate.

## Open questions

1. **Q1** What are the interfaces and where does vision live? **Answer:** Use the exact signatures in Provider interface. Providers build wire requests and normalise transport results; vision is a stage through `complete` or scheduled batch methods. The provider factory composes API and subscription transports by route, never separate article orchestrators.
2. **Q2** How are routes selected? **Answer:** Parse `ROUTE_PREFERENCE=batch,subscription,api` as an ordered allowlist; skip only unavailable credentials/capabilities, fail invalid bindings, and pin explicit `--route`. Log the chosen binding kind and reasons, persist the immutable plan and route, and never fall through after dispatch failure.
3. **Q3** What is the vision tier? **Answer:** It has provider-scoped model settings, defaults to Claude Sonnet 5.5 or OpenAI Terra via registry aliases, never reads `MODEL`/`MODEL_BATCH`, and defaults to the run provider. Its separate `subscription,api` route preference is resolved before work; stage-18 figure choice remains part of synthesis when possible.
4. **Q4** Where do canonicalise, validate, stamp and repair belong? **Answer:** All live in or are called by `finalizeResult`. Apply code-derived source metadata before validation, repair only eligible prose/structure at most twice, protect chart values, then stamp execution provenance and validate the final artefact. Hard failures and unresolved reviews cannot be marked succeeded.
5. **Q5** How is per-item persistence safe? **Answer:** Save each transition/receipt using lock, fresh read, targeted revision update, fsync and atomic rename. A separate batch lock prevents concurrent collection by `process` and `poll`. Re-collect keys are `(runId, customId, attemptId)` with matching receipt digests; uncertain external outcomes require reconciliation.
6. **Q6** How do subscription local batches resume? **Answer:** Default concurrency 1, maximum configured 4; synthesis/repair/vision caps 600/300/180 seconds and two hours cumulative active run time. `process --resume` reuses saved receipts and skips successes; no-ID `poll` selects only remote batch-api work. Unknown in-flight outcomes are not silently retried.
7. **Q7** What cost fields are used? **Answer:** Call ledgers and `metadata.cost` use `estimated_charge_usd`, `api_equivalent_usd`, `saving_usd`, `known_charge_usd` and `pricing_status`. Subscription incremental charge is 0; equivalent uses the same model's standard rates and observed cache categories. Batch synthesis and standard-rate repair are separate ledger lines; vision and failed attempts are included.
8. **Q8** How is the registry loaded? **Answer:** Provider model env overrides/explicit registry, local config, `MCP_MODEL_REGISTRY`, vendored dated snapshot, then diagnostics-only bootstrap. Public clones use the snapshot and warn about stale/unpriced data; a missing snapshot without an override fails rather than fabricating prices. See Registry for atomic price-row precedence.
9. **Q9** How is Claude OAuth kept off the raw API? **Answer:** One binding resolver validates credential plus surface and refuses `CLAUDE_OAUTH_WRONG_SURFACE`. API SDK consumes only the API key; Agent SDK consumes only OAuth in a sanitised child. Preserve the supplied 429 observation as a wrong-surface diagnostic without reproducing it.
10. **Q10** Is Codex schema support verified? **Deferred (owner: W9):** CLI help confirms the flags and stdin contract, not its schema subset. W8 supplies `--output-schema`, isolated `-C`, prompt stdin and `mkdtemp` paths. W9 makes exactly one subscription call with the stage-16 dialect and records CLI/model/schema digests. PDFs reach synthesis as explicitly extracted text; visual stages receive labelled images.
11. **Q11** What are the batch/poll limits? **Answer:** Chunk by encoded count and bytes at the lower of provider limits and 10,000 requests/100,000,000 bytes, including envelopes; reject oversized individual requests. Respect the recorded 24-hour provider window plus a 15-minute reconciliation grace. A local polling cap pauses, never cancels or resubmits.
12. **Q12** In what order do stages 16 and 18 integrate? **Answer:** Interface/registry/state foundations can proceed alongside their implementations. Stage 16 owns the shared schema/dialects and output metadata compatibility; transport adapters consume that interface. Stage 18's figure-choice integration must precede enabling synthesis-carried choice in W13/W14. Then figure choice uses the synthesis route and batch discount. Stage 19 independently gates chart values; retain the existing filter until it lands.
13. **Q13** Which synthesis model becomes the default? **Deferred (owner: operator):** Retain the compatibility profile until a 3 to 4 paper comparison covers representative text-heavy, numerical and figure-dependent papers on batch and subscription routes. W16 records schema/content validity, source fidelity, figure choice, repair usage, wall time and route-specific estimated cost. The operator chooses the approved candidate set, spend authority and eventual default; registry recency or a cheaper price alone is insufficient evidence.

## Wave-2 cards

The sequence below is topologically ordered. **New** marks files that do not
exist on this base. Commands use the installed Node/ts-node test harness; these
future commands are acceptance targets, not tests run by this design stage.
Each implementation card also runs `npm run typecheck`. No card publishes to
the public mirror.

W2 and W4 can run in parallel after W1. After W3, W5/W7/W8 can run in
parallel on their disjoint adapter files; W6 also waits for W4's cache contract.
W10 and W11 can run alongside those
adapters once W4 is ready. W12 is the integration join. W9 can run after W8
and the stage-16 dialect is available. W13 to W15 are sequential. W16 and W17
are optional, separately authorised follow-ups after the indicated dependencies.
Do not concurrently edit shared registry registration or `src/batch.ts`.

### W1. normalised-provider-contract

- **Outcome:** A typed result boundary rejects incomplete/unknown success shapes and preserves failed-call usage; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/llm-contract.test.ts` passes fixtures for all terminal classes and unknown values.
- **Files:** **New** `src/llm-contract.ts`, `tests/unit/llm-contract.test.ts`.
- **Depends on:** none.
- **Tier and scope:** Judgement. Define the signatures above, error codes, capability validation and manifest identity rules. Vendor-specific wire mapping remains in the adapter cards; this card supplies shared fixtures/types, not an orchestrator.

### W2. registry-and-public-snapshot

- **Outcome:** A public-clone fixture resolves every supported default tier with provider ownership and ordinary price coverage without mcp-hub; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/model-registry.test.ts` passes including precedence, bad overrides and missing/stale prices.
- **Files:** **New** `src/model-registry.ts`, `config/models.snapshot.json`, `scripts/update-model-snapshot.ts`, `tests/unit/model-registry.test.ts`; existing `src/model-config.ts`, `config/models.json.example`.
- **Depends on:** W1.
- **Tier and scope:** Judgement. Parse the actual fleet registry, add versioned capability metadata, retain a compatibility bridge for existing callers and keep synthesis defaults unchanged. No edits to mcp-hub or secret mappings.

### W3. credential-bindings-and-run-plan

- **Outcome:** Every route resolves to one allowed surface/credential and immutable tier plan, with invalid pairings rejected before I/O; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/run-plan.test.ts` passes the complete credential matrix and model-mismatch cases.
- **Files:** **New** `src/routes.ts`, `src/run-plan.ts`, `tests/unit/run-plan.test.ts`.
- **Depends on:** W1, W2.
- **Tier and scope:** Judgement. Implement preference/pin semantics, provider-scoped vision settings, named refusals and legacy boundary translation. Inject credential inventory; never open real credentials in tests. CLI wiring is W12.

### W4. atomic-item-ledger-and-migration

- **Outcome:** A crash/restart and concurrent-process fixture preserves each receipt exactly once without lost updates; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/state-v2.test.ts` passes, including corrupt-state refusal and ambiguous legacy route quarantine.
- **Files:** Existing `src/state.ts`; **new** `src/state-v2.ts`, `src/state-migration.ts`, `scripts/migrate-state-v2.ts`, `tests/unit/state-v2.test.ts`.
- **Depends on:** W1.
- **Tier and scope:** Judgement. Implement v2 types, short transaction locks, batch ownership, atomic receipt writes, provider/account cache namespace and preview/apply migration. Keep legacy runtime exports intact until W14. All tests use temporary state, never the operator's live `state.json`.

### W5. claude-api-adapter

- **Outcome:** Claude API fixtures produce the specified requests and normalised results for both batch and sync; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/claude-api-adapter.test.ts` passes tool-choice, finish-reason, HTTP and chunk-size cases.
- **Files:** **New** `src/providers/claude-api.ts`, `tests/unit/claude-api-adapter.test.ts`.
- **Depends on:** W1, W3.
- **Tier and scope:** Mechanical, Sonnet or Terra tier, against the settled contract. Move transport/request logic, preserve the forced-tool allowlist behaviour and require an API binding. Consume stage 16's dialect service; use a clearly labelled current-schema bridge only before that implementation is ready. No article saving or shared-loop changes.

### W6. openai-api-adapter

- **Outcome:** OpenAI batch and Responses fixtures normalise strict-schema output and reject HTTP/incomplete/duplicate-row failures; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/openai-api-adapter.test.ts` passes including shuffled results and cache-file invalidation.
- **Files:** **New** `src/providers/openai-api.ts`, `tests/unit/openai-api-adapter.test.ts`.
- **Depends on:** W1, W3, W4.
- **Tier and scope:** Mechanical, Sonnet or Terra tier. Use an injected file-cache service conforming to W4's contract, a direct API binding, full-source requests and encoded byte limits. Consume the shared schema service and preserve `strict: true`. No lane support or auth-file API-key discovery.

### W7. claude-subscription-adapter

- **Outcome:** Agent SDK fixture streams yield structured output or a named failure with all usage retained, and never receive an API key; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/claude-subscription.test.ts` passes every installed SDK result subtype, timeout and environment-isolation case.
- **Files:** **New** `src/providers/claude-subscription.ts`, `tests/unit/claude-subscription.test.ts`.
- **Depends on:** W1, W3.
- **Tier and scope:** Judgement. Use `outputFormat`, `tools: []`, bounded turns/time and a temporary cwd. Validate the actual installed types and mark runtime schema evidence honestly. No raw API fallback, real token reads or paid calls in fixture tests.

### W8. isolated-codex-subscription-adapter

- **Outcome:** A fake Codex executable receives schema, stdin, isolated cwd/auth and bounded execution, and its outputs obey the result contract; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/codex-subscription.test.ts` passes long-prompt, wrong-auth, missing-file/event and crash-recovery cases.
- **Files:** **New** `src/providers/codex-subscription.ts`, `src/source-snapshot.ts`, `tests/unit/codex-subscription.test.ts`.
- **Depends on:** W1, W3.
- **Tier and scope:** Judgement. Use unique temp paths, explicit PDF-text extraction through the shared source-snapshot service and labelled image attachments. Test missing/truncated source, process-group termination and credential/config isolation without invoking a model. Schema compatibility remains explicitly unverified pending W9.

### W9. prove-codex-generated-schema

- **Outcome:** Exactly one authorised subscription call accepts the real generated dialect and produces a canonically valid response; proposed `node --require ts-node/register scripts/probe-codex-schema.ts --model gpt-5.6-terra --calls 1` writes a passing, versioned evidence report or a specific unsupported-feature failure.
- **Files:** **New** `scripts/probe-codex-schema.ts`, `docs/evidence/codex-schema-compatibility.md`.
- **Depends on:** W8.
- **Tier and scope:** Judgement, bounded live validation. Requires the stage-16 dialect implementation and separately authorised subscription execution when this future card is queued. Pin CLI/model/schema digests, fixture source, terminal result and validation outcome. No API-key billing, retry, model substitution or full-schema-subset claim from a single probe. A failure blocks new structured enforcement until the dialect owner resolves it.

### W10. one-finalise-and-repair-seam

- **Outcome:** Replaying identical completed receipts from all routes gives the same canonical article or classified failure/review result; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/finalize.test.ts` passes code-first repair, unchanged chart-data digests, bounded attempts and replay-without-extra-calls cases.
- **Files:** **New** `src/finalize.ts`, `tests/unit/finalize.test.ts`; existing `src/output.ts`, `src/repair.ts`, `src/quality.ts`.
- **Depends on:** W1, W3, W4.
- **Tier and scope:** Judgement. Promote `finalizeResult`, separate pure validation/stamping/persistence from figure calls, retain the best candidate and every usage receipt, and introduce review artefacts. Consume stage-16 validation/dialect interfaces and stage-19 issue policy without redesigning either. Preserve old exports via temporary bridges.

### W11. route-aware-cost-ledger

- **Outcome:** Every call, including failed repair/vision, reports its route-specific charge and API equivalent without unpriced zeroes; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/route-cost.test.ts` passes subscription, batch-plus-standard-repair, cache-token, promotion and unknown-price fixtures.
- **Files:** Existing `src/pricing.ts`; **new** `src/cost-ledger.ts`, `tests/unit/route-cost.test.ts`.
- **Depends on:** W1, W2, W4.
- **Tier and scope:** Mechanical, Sonnet or Terra tier. Implement the fields/formulas above with a compatibility wrapper for legacy callers. Snapshot effective prices, deduplicate usage and keep unknown totals null. The ledger consumes a stage label, so figure-specific pricing branches are unnecessary.

### W12. single-orchestrator-and-local-resume

- **Outcome:** All six target surfaces execute through one resumable loop: batch API, sync API and subscription for each of Claude and OpenAI; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/orchestrator.test.ts` passes chunk/poll/local-resume/retry fixtures with one finalisation call per completed item.
- **Files:** **New** `src/orchestrator.ts`, `src/providers/registry.ts`, `tests/unit/orchestrator.test.ts`; existing `src/batch.ts`, `src/index.ts`.
- **Depends on:** W3, W4, W5, W6, W7, W8, W10, W11.
- **Tier and scope:** Judgement. Compose provider transports by route, wire frozen plans and full-source preparation, expose resume/retry flags and replace prefix-based runtime selection. Maintain a disabled-by-default migration switch for new entrypoints until W14; do not delete historical collectors yet. Tests use fake transports, not real submissions.

### W13. planned-vision-and-synthesis-figure-choice

- **Outcome:** Figure choice travels in synthesis where supported, and any separate vision call uses the persisted vision binding and is charged once; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/planned-vision.test.ts` passes batch-choice, explicit cross-provider vision, resume and wrong-model refusal cases.
- **Files:** Existing `src/vision.ts`, `src/figure-vlm.ts`, `src/output.ts`; **new** `tests/unit/planned-vision.test.ts`.
- **Depends on:** W12.
- **Tier and scope:** Judgement at the integration boundary. Requires stage 18's figure contract and stage 16's schema support before enabling synthesis-carried choice. Preserve image geometry helpers and the stage-18 locator. Route every localisation/verification/data sub-call through the ledger callback. Do not change stage 19's chart gate or remove the six-point filter.

### W14. migrate-and-switch-entrypoints

- **Outcome:** A fixture containing old remote, sync, local and lane history migrates and resumes without submitting an existing job twice; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/migration-cutover.test.ts` passes a full preview, backup, cutover, re-poll and rollback rehearsal.
- **Files:** Existing `src/index.ts`, `src/batch.ts`, `README.md`, `AGENTS.md`; W4's `scripts/migrate-state-v2.ts`; **new** `tests/unit/migration-cutover.test.ts`.
- **Depends on:** W9, W12, W13.
- **Tier and scope:** Judgement. Remove the disabled-default migration switch once gates pass, document explicit route and resume commands, and preserve legacy Claude `--sync` safeguards. Stop old writers and drain jobs before any operator-controlled live migration. Fixtures establish acceptance; never auto-migrate a real state file during tests. Stage-16 metadata compatibility is an external cutover prerequisite.

### W15. delete-lanes-and-duplicate-paths

- **Outcome:** Live source has one orchestration/finalisation route and no executable lane or `codexbatch` path; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/removed-provider-paths.test.ts` passes removal assertions plus legacy-readability fixtures.
- **Files:** Existing `src/batch.ts`, `src/providers.ts`, `src/model-config.ts`, `src/state.ts`, `src/pricing.ts`, `scripts/smoke-models.ts`, `config/models.json.example`, `README.md`; **new** `tests/unit/removed-provider-paths.test.ts`.
- **Depends on:** W14.
- **Tier and scope:** Mechanical, Sonnet or Terra tier. Follow Deletions in order, update smoke coverage to include vision and remove temporary bridges only after callers migrate. The removal check permits legacy names solely in migration readers, diagnostics and fixtures. Re-run `npm test`, `npm run smoke` and `npm run typecheck`.

### W16. compare-synthesis-models-for-operator

- **Outcome:** A 3 to 4 paper comparison has complete, traceable quality/cost evidence and an explicit operator decision field; proposed `node --require ts-node/register scripts/compare-synthesis-models.ts --check-report docs/evidence/synthesis-model-comparison.md` verifies the report's completeness.
- **Files:** **New** `scripts/compare-synthesis-models.ts`, `docs/evidence/synthesis-model-comparison.md`.
- **Depends on:** W2, W14.
- **Tier and scope:** Judgement, operator-gated by Q13. The operator approves paper/candidate selection and spend before running comparisons; use the normal orchestrator, not another evaluation transport. Distinguish measured values, unavailable metrics and subjective review. This card records evidence and a decision, and does not silently alter the compatibility profile or publish.

### W17. add-gemini-without-core-branches

- **Outcome:** Gemini batch/sync fixtures complete through the existing orchestrator without provider branches added to it; `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/unit/gemini-provider.test.ts` passes shuffled-key, schema, finish-reason and 48-hour file-expiry cases.
- **Files:** **New** `src/providers/gemini.ts`, `tests/unit/gemini-provider.test.ts`; W12's `src/providers/registry.ts`, W2's `config/models.snapshot.json`, existing `config/models.json.example`.
- **Depends on:** W14.
- **Tier and scope:** Judgement, optional separately queued provider extension. Establish the real Gemini endpoint/key/schema contract before enabling registration, consume the stage-16-owned Gemini dialect, and add reviewed price/capability rows. No subscription emulation, orchestration fork or default synthesis-model selection.



