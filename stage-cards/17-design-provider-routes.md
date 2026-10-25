# Stage card 17-design-provider-routes: providers, routes and one orchestrator are designed as separate axes

## Metadata

- **Authored:** 2026-10-19
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6 Astra <gpt-6-astra@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/17-design-provider-routes
- **Worker effort:** xhigh
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** docs/design/provider-routes.md
- **Pairing rationale:** The provider abstraction decides the shape of most wave-2 code in `src/batch.ts`, `src/providers.ts`, `src/vision.ts`, `src/state.ts` and `src/pricing.ts`, so it gets a frontier design tier. Re-paired on 2026-10-20 to spread load across providers: the worker is GPT-6 Astra (frontier reasoning) and the verifier is from the other family (Claude Opus 5.5), judgement-capable as a prose stage needs. Stages 16 and 18 keep a Fable 5.1 worker, so the worker family alternates across 16 to 19; the four claim disjoint paths.
- **Open decisions:** none

## Surfacing concern

The 2026-10-19 review found there is no provider abstraction. `src/batch.ts` (1,375 lines) holds separate Claude and OpenAI copies of submit, collect, sync and repair; run mode (batch API, sync API, subscription CLI) is pieced together from a `--sync` flag, the auth state and batch-id prefixes; cost only knows "batch or not". Adding Gemini today would touch about 11 files and 15 or more provider branches, with silent fallbacks the compiler would not catch. Batch runs, the operator's preferred route, also produce worse output than sync runs. The operator's direction is provider-agnostic, with batch (50% off) and subscription runs first-class. Wave 2 will be carded from this design document.

Defects this design must answer. Line numbers were re-checked against `dev` at 0cd17d7 on 2026-10-19; wave-1 cards (lanes off by default, provenance persisted for batch, truncation detection, unknown-provider rejection and others) may change some of this code before you run, so read your own base and describe what is there.

| Id | Where | Defect |
|---|---|---|
| D1 | `src/batch.ts:531-548`, `:1193-1250`, `:1267-1309` | Provider ternaries in `submitBatch`, `pollBatchStatus`, `runSync` and `pollAndRetrieve`. |
| D2 | `src/batch.ts:233`/`:271`, `:334`/`:379`, `:550`/`:613`/`:822`, `:951`/`:1019` | Paired per-provider copies of repair, submit, collect and sync, each repeating the save, usage and log block. |
| D3 | `src/index.ts:38-75`; `src/batch.ts:513`, `:1197`, `:1281`; `src/pricing.ts:55-80` | Run mode is inferred from the auth matrix, the `--sync` flag and `codexbatch_`/`sync_` id prefixes; cost takes only `isBatch`. |
| D4 | `src/providers.ts:647-652`; `src/index.ts:32` | An unknown provider name (including `gemini`) silently becomes Claude. |
| D5 | `src/providers.ts:522`, `:139-145`, `:286-295`, `:585-601` | No `strict: true` on OpenAI, an advisory Claude tool, and no schema at all on the subscription routes (Agent SDK and codex). |
| D6 | `src/vision.ts:222-232`; `src/figure-vlm.ts:236-237`; `src/model-config.ts:59`, `:72` | The vision provider comes from whatever credentials are present, independently of `--provider`; the vision model follows `MODEL_BATCH`/`MODEL`, so a Claude id can be sent to codex and the failure is swallowed. |
| D7 | `src/batch.ts:178-181`, `:724`, `:881`, `:1124`; `src/model-config.ts:83-91` | OpenAI lanes: synthesis sees only lane bullets, missing lanes become `(missing)`, and the `::` custom-id delimiter is rejected by Anthropic. |
| D8 | `src/batch.ts:580`, `:644`, `:788`; `src/state.ts:50-73` | Batch collect drops the detected byline, date and reference (not persisted in `RequestState`). |
| D9 | `src/batch.ts:609`, `:671`, `:818`, `:946`, `:1015`, `:1189` | State is saved once per batch, not per item; a crash or re-poll pays for repair and figure vision again. |
| D10 | `src/state.ts:152-156`, `:103-118`, `:91` | Stale `sync_*` batches break argument-less `poll`; a corrupt `state.json` is copied to a `.corrupt-*` backup but the run then continues with empty state, and the next write overwrites the original; the file cache is OpenAI-only; no state version. |
| D11 | `src/providers.ts:154-162` | Truncation and HTTP failures are not detected (`stop_reason`, Responses `status: incomplete`, batch row `status_code`). |
| D12 | `src/batch.ts:233-308` | Repair: usage overwritten per attempt, an unparseable repair replaces a parseable original, invalid output saved as success, result field named `html`. |
| D13 | `src/pricing.ts:9`, `:62` | Prices are a hand-copied mirror of the mcp-hub registry; unknown models cost zero with no warning; subscription runs are priced at API rates; vision calls are not costed. |
| D14 | `src/providers.ts:585-601` | The codex route passes the whole prompt as one argv entry, runs in the repo cwd (its `AGENTS.md` can leak in), uses no `--output-schema`, and names temp files by timestamp. |
| D15 | `src/batch.ts:512-526`, `:822-948`; `src/index.ts:68-70` | The `codexbatch` local path and `collectOpenAILocal` are unreachable from the CLI. |
| D16 | `src/model-config.ts:59-61` | Claude defaults are `claude-opus-4-8` while the registry resolves opus to `claude-opus-5-5`, which is also cheaper (`src/pricing.ts:13`, `:15`). |

Cold read on 2026-10-19 by the other family (Codex, codex-cli 0.163.0, read-only sandbox) over all four design cards; its questions, verifier-seat gaps and line corrections are folded into this card. This is a prose stage, so it has no contract test (see Contract test). The acceptance criteria are written to be checked by command wherever a command can check them.

## Objective

Write `docs/design/provider-routes.md`: the design for an LLM-agnostic core in which provider, route and run plan are separate axes behind one orchestrator, with cost per route and models and prices loaded from data. The document ends with a numbered list of wave-2 cards precise enough to card from directly.

The starting shape, from the review (section 4). Refine it; any departure is a tradeoff entry.

```ts
interface LlmProvider {
  id: 'claude' | 'openai' | 'gemini';
  capabilities: { structured: 'strict' | 'tool' | 'none'; vision; pdfNative; batch; subscription };
  routes: ('batch-api' | 'sync-api' | 'subscription-cli')[];
  buildRequest(stage, item, plan): ProviderRequest;     // the schema dialect adapter lives here
  submitBatch(reqs) / getBatch(id) / results(id): AsyncIterable<NormalizedResult>;
  complete(req): Promise<NormalizedResult>;             // sync-api and subscription-cli
}
type NormalizedResult = { customId; text?; error?; finishReason: 'stop' | 'length' | 'error'; usage: {in, out, cacheRead?} };
type RunPlan = { provider; route; strategy: 'single-pass';
                 tiers: { synthesis; repair; vision } };   // vision has its own tier
```

One orchestrator (submit, poll, collect, then canonicalise, validate, repair, finalise) saves state after each item and records `route` on the batch, each request and the output. A subscription CLI run becomes a "local batch" with resume. Cost is computed per route: subscription is 0, with the API-equivalent figure shown beside it. Route choice follows a declared preference such as `ROUTE_PREFERENCE=batch,subscription,api`.

## Inputs (read these in your own context)

- `src/batch.ts`, `src/providers.ts`, `src/vision.ts`, `src/state.ts`, `src/pricing.ts`, `src/model-config.ts`, `src/index.ts`, `src/output.ts` (`saveResult` and the normalisers), `src/quality.ts` (`validateJsonOutput`, `buildRepairInstruction`)
- `src/figure-vlm.ts` lines 230-280 (how figure vision picks its model and provider)
- `scripts/run-batch-tmux.sh`, `scripts/smoke-models.ts`, `op-refs.sh`, `config/models.json.example`, `README.md` (the configuration and auth sections), `AGENTS.md` (the provider rules)
- The fleet model registry in the mcp-hub sibling checkout: `../mcp-hub/config/models.json` (read-only). Note that a public clone of explainer-batch has no mcp-hub beside it.
- If stage 16 has landed on your base, its design document, docs/design/content-contract-v2.md (the schema dialect generator is designed there; consume it as an interface, do not redesign it). If it has not, treat "generate the provider dialect from the shared schema" as an interface owned by stage 16.
- `codex exec --help` (installed codex-cli 0.163.0 has `--output-schema <FILE>` and `-C/--cd`) and the Agent SDK's `outputFormat` option in `node_modules/@anthropic-ai/claude-agent-sdk` type definitions.

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified. Paths are relative to repo root.

1. `docs/design/provider-routes.md`: the design document. It must contain these second-level headings, spelled exactly, in this order (extra headings and third-level subsections are welcome):
   - `## Summary`
   - `## Current state`: how provider, run mode, model tier, cost and vision are chosen today, citing code as `path:line`.
   - `## Findings addressed`: a Markdown table with one row per defect id D1 to D16, each row starting `| Dn |`, saying how the design resolves it (or which card owns it).
   - `## Provider interface`: `LlmProvider`, its capability descriptor, where the schema dialect adapter sits, and `NormalizedResult` with the `finishReason` and `error` mapping for every provider and route (Claude `stop_reason`, OpenAI `status: incomplete`, batch row `status_code`, Agent SDK result subtypes, codex exit status and output file).
   - `## Routes and selection`: the `Route` values, how `ROUTE_PREFERENCE` and the credentials present select one, which credential each route may consume, and which combinations are refused with a named reason.
   - `## Run plan and tiers`: `RunPlan` with stage tiers (synthesis, repair, and vision as its own tier), per-provider defaults, and the check that a model id belongs to the provider it is sent to.
   - `## Orchestrator`: the one loop: submit, poll, collect, canonicalise, validate, repair (bounded, code-first for content issues, never for chart data), stamp and finalise. Name the single `finalizeResult` seam every route passes through.
   - `## State and resume`: per-item saves, resume, `--retry-errored`, `route` on batch, request and output, a state `version`, a provider-keyed file cache, corrupt-state behaviour, and migration of an existing `state.json`.
   - `## Cost`: cost per route (subscription = 0 with the API-equivalent shown), vision and repair calls costed, cache tokens, and a loud warning on unpriced models.
   - `## Registry`: models and prices loaded from the mcp-hub registry, how the path is resolved without an absolute path in the repo, and what a public clone with no mcp-hub does.
   - `## Subscription routes`: the gotchas in Q9 and Q10 below and how the design avoids each.
   - `## Deletions`: what is deleted (lanes and their config keys, `codexbatch`, `collectOpenAILocal`, the paired per-provider functions, `OPENAI_USE_LANES`), with line ranges and the order of deletion.
   - `## Adding Gemini`: what Gemini costs after the refactor (files, approximate lines, dialect adapter, registry and price rows, file cache expiry of about 48 hours, batch result keying), compared with today.
   - `## Migration and rollback`: how the refactor lands in steps that each keep `npm run typecheck` green and every route working, with a line starting `Rollback:` for each step.
   - `## Tradeoffs`: a numbered list, at least four entries, each with a line containing `Rejected:`.
   - `## Open questions`: a numbered list including Q1 to Q12 below, each item starting `N. **Qk**`, every item carrying `**Answer:**` or `**Deferred (owner: <stage id or operator>):**`. Further questions go in as Q13 onwards under the same rule.
   - `## Wave-2 cards`: each as `### Wn. <slug>` followed by `- **Outcome:**` (one observable outcome and the command that shows it), `- **Files:**`, `- **Depends on:**` (other Wn ids, or `none`). At least six cards, dependencies first, noting which can run in parallel. Each card must be small enough for one worker context; say which are mechanical (Sonnet or Terra tier) and which need judgement.

Questions the document must settle (Q1 to Q12):

- **Q1** The exact `LlmProvider` and `NormalizedResult` signatures, and whether vision is a method on the provider or a separate stage using `complete`.
- **Q2** `ROUTE_PREFERENCE` semantics: syntax, default, what happens when the preferred route's credential is missing (fall through or refuse), and how the chosen route is logged and persisted.
- **Q3** The vision tier: its own model setting per provider that never reads `MODEL`/`MODEL_BATCH`, its default model, and whether its route follows the run's route or has its own preference.
- **Q4** Where canonicalise, validate, stamp and repair sit, and which issue classes go to code fixes, which to LLM repair, and which fail the item.
- **Q5** Per-item persistence: write strategy (per item, debounced, or an append log), atomicity, cross-process safety for `process` plus `poll`, and the idempotency key for re-collect.
- **Q6** A subscription CLI run as a "local batch": concurrency, wall-clock caps, resume after a crash, and how it is excluded from the pending-batch lookup.
- **Q7** Cost reporting: field names in state and output, how the API-equivalent figure is computed for subscription runs, and how batch repair (standard rate) is shown.
- **Q8** Registry loading: resolution order (env override, local `config/models.json`, an mcp-hub path from an environment variable, a vendored snapshot, built-in fallback), and how a public clone with no mcp-hub still runs with correct prices.
- **Q9** The Claude subscription credential: a Claude Code OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) is valid on the Agent SDK and the `claude` CLI but not on the raw API SDK (`@anthropic-ai/sdk`), where it returns a `429 rate_limit_error` with no rate-limit headers rather than a 401 (measured by the operator on 2026-09-01; take it as given, do not reproduce it). How the design makes the surface and credential pairing one function that refuses an invalid pairing with a named reason, and keeps `ANTHROPIC_API_KEY` absent on the OAuth route.
- **Q10** The codex subscription route: `codex exec --output-schema` (the installed CLI's help confirms the flag but not which JSON Schema subset it accepts; state what offline evidence you have, and if the subset cannot be established without a model call, mark it unverified and make proving it with one subscription call the outcome of a named wave-2 card), an empty temp working directory via `-C`, the prompt on stdin, `mkdtemp` output paths, and how a PDF reaches the model on this route.
- **Q11** Batch limits: chunking by request count and byte size, and the poll cap against the provider's 24-hour completion window.
- **Q12** The order of the refactor relative to stage 16's schema work and stage 18's figure work, so that the figure choice can ride the synthesis request (and so the batch discount).

## Constraints

- Design only. Write no code under `src/`, `scripts/` or `tests/`, change no dependency or configuration, and edit no file other than the document.
- Cite the current state as `path:line` against the code you actually read. Every defect row cites at least one location.
- Respect the operator decisions already made; do not reopen them: batch and subscription runs stay first-class; OpenAI lanes are off by default from wave 1 and wave 2 deletes the lane code entirely; the 6-point chart filter stays until the wave-2 provenance gate exists; publishing to the public mirror is a manual curated replay and never a card step.
- Do not add provider-specific branching where a shared seam would do; that is the point of the design.
- No network calls and no paid model calls. Reading `codex exec --help`, installed package type definitions and the sibling mcp-hub checkout is fine.
- No secret, token, vault reference or absolute home path in the document.
- British English. No em dashes anywhere in the document.
- Where the design needs a decision only the operator can make, record it as a deferred open question with `owner: operator`.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage.

Every command runs from the run worktree root. Baselines were run on `dev` at 0cd17d7 on 2026-10-19; the document does not exist there, so every command criterion is red on the base, as expected for a new deliverable. Judge each command by what it prints, not by its exit status: several pass by printing nothing or `0`, and `grep` then exits 1.

1. **The document exists.** Seat: verifier. Command: `test -s docs/design/provider-routes.md && echo present` prints `present`. Baseline: red.
2. **Required headings, exact and in order.** Seat: verifier. Command: `grep -nE '^## ' docs/design/provider-routes.md` lists `## Summary`, `## Current state`, `## Findings addressed`, `## Provider interface`, `## Routes and selection`, `## Run plan and tiers`, `## Orchestrator`, `## State and resume`, `## Cost`, `## Registry`, `## Subscription routes`, `## Deletions`, `## Adding Gemini`, `## Migration and rollback`, `## Tradeoffs`, `## Open questions`, `## Wave-2 cards` in that relative order. Baseline: red.
3. **Every defect has a row.** Seat: verifier. Command: `for d in D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13 D14 D15 D16; do grep -qE "^\| ${d} \|" docs/design/provider-routes.md 2>/dev/null || echo "missing: $d"; done` prints nothing. Baseline: red.
4. **Every listed question is present.** Seat: verifier. Command: `for q in Q1 Q2 Q3 Q4 Q5 Q6 Q7 Q8 Q9 Q10 Q11 Q12; do grep -qE "^[0-9]+\. \*\*${q}[^0-9]" docs/design/provider-routes.md 2>/dev/null || echo "missing: $q"; done` prints nothing. Baseline: red.
5. **Every open question is answered or deferred with an owner.** Seat: verifier. Command: `sed -n '/^## Open questions$/,/^## /p' docs/design/provider-routes.md | grep -E '^[0-9]+\. ' | grep -vE '\*\*(Answer|Deferred \(owner: [^)]+\)):\*\*'` prints nothing, and criterion 4 is green. Baseline: red.
6. **Wave-2 cards are complete.** Seat: verifier. Command: `python3 -I -c 'import re,sys;t=open(sys.argv[1]).read();s=t.split("\n## Wave-2 cards\n",1)[1].split("\n## ",1)[0];b=re.split(r"\n(?=### W[0-9]+\. )","\n"+s)[1:];bad=[x.splitlines()[0] for x in b if not all(k in x for k in ("- **Outcome:**","- **Files:**","- **Depends on:**"))];print("cards:",len(b),"incomplete:",bad)' docs/design/provider-routes.md` prints `cards: N incomplete: []` with N at least 6. Baseline: red.
7. **Tradeoffs are stated.** Seat: verifier. Command: `sed -n '/^## Tradeoffs$/,/^## /p' docs/design/provider-routes.md | grep -cE '^[0-9]+\. '` prints at least 4 and `sed -n '/^## Tradeoffs$/,/^## /p' docs/design/provider-routes.md | grep -c 'Rejected:'` prints at least 4. Baseline: red.
8. **Migration has a rollback.** Seat: verifier. Command: `sed -n '/^## Migration and rollback$/,/^## /p' docs/design/provider-routes.md | grep -c 'Rollback:'` prints at least 1, and the section covers migrating an existing `state.json`. Baseline: red.
9. **Current state is cited from real code.** Seat: verifier. Command: `grep -oE '(src|scripts)/[A-Za-z0-9_./-]+:[0-9]+' docs/design/provider-routes.md | sort -u | wc -l` prints at least 20. The verifier then opens at least ten of those citations and confirms each points at the code the document says it does. Baseline: red.
10. **Style and hygiene.** Seat: verifier. Commands: `grep -c '—' docs/design/provider-routes.md` prints `0`; `grep -cE '/(Users|home)/|op://' docs/design/provider-routes.md` prints `0`. Spelling is British outside code identifiers. Baseline: red (file absent).
11. **Only the document changed.** Seat: verifier. Commands, run after the worker's commit: `git diff --name-only dev...HEAD` prints exactly `docs/design/provider-routes.md`, and `git status --porcelain -- ':!state'` prints nothing (no other uncommitted or untracked change; `state` is the orchestrator's symlink). Baseline: red (prints nothing).
12. **Each defect is genuinely resolved (verifier judgement).** Seat: verifier, reading the document against the code. For each of D1 to D16 in the Surfacing concern (by its file:line), the design removes the cause or names the wave-2 card that does; a row that only restates the defect fails. In particular: one orchestrator replaces the paired functions (D1, D2, D15); route is a persisted, first-class value that drives cost (D3, D13); every route, including both subscription CLIs, passes through one canonicalise and validate step (D5, D12); vision has its own tier and model (D6); lanes are deleted, not generalised (D7).
13. **The subscription gotchas are handled (verifier judgement).** Seat: verifier. The document states that a Claude Code OAuth token must never reach the raw API SDK, shows where that pairing is refused, and specifies the codex route's `--output-schema`, `-C` and stdin handling consistently with `codex exec --help` on the verifier's machine. The verifier does not reproduce the 429 or test schema compatibility (that needs a model call); it checks that any behaviour the document could not verify offline is labelled unverified and owned by a wave-2 card.
14. **The wave-2 list is cardable (verifier judgement).** Seat: verifier. Each `Wn` card has one observable outcome with a command, real or named-new files, and acyclic dependencies; together they cover `NormalizedResult` and finish reasons, the provider interface with Claude and OpenAI behind it, the single orchestrator with per-item state and resume, the vision tier, cost per route, the registry loader, and the deletions.

## Contract test

<!--
Prose-only stage: the deliverable is a design document, so there is nothing executable to freeze. The acceptance criteria above carry the checks by command. -->

- **Test file:** None
- **Assertions digest:** None
- **Oracle proof:** None. This is a prose design stage with no executable surface; criteria 1 to 11 are shell checks against the document and were each run on `dev` at 0cd17d7 (all red because the document is absent), and criteria 12 to 14 are verifier judgement.

## Out of scope

- Any code, configuration, dependency or test change. The wave-2 cards this document lists do that.
- The content contract and its schema dialect generator (stage 16), the figure locator (stage 18) and the chart value gate (stage 19). Reference them; do not redesign them.
- Choosing the default synthesis model. Record the question and the evidence needed (a 3 to 4 paper comparison) as an operator-owned open question.
- `scripts/run-batch-tmux.sh` hardening beyond noting what the registry-driven secret mapping changes.
- Publishing, and any change to the publish guards.

## Budget

- **Worker wall-clock:** 120 minutes
- **Verifier wall-clock:** 45 minutes
- **Spend basis:** Astra worker median 6.8M tokens in the promo-flow cost log (a design card runs higher; budget about 11M, the Fable design-card median); Opus 5.5 verifier median 2.6M tokens. This card reads the most code of the four (about 3,000 lines across seven files), so expect the worker above the median.

## Dispatch envelope

Return the standard envelope with:
- `status`: pass or fail.
- `commit`: the commit SHA on `autometta/17-design-provider-routes` that adds the document, authored as `GPT-6 Astra <gpt-6-astra@local>`.
- `deliverables`: `docs/design/provider-routes.md`.
- `evidence`: the output of acceptance commands 1 to 10 as you ran them before committing, and of command 11 after committing.
- `notes`: the Wn list (ids and slugs only), every question deferred to the operator, and any wave-1 change you found on your base that altered a defect in the table.

## Family-specific notes

- **Codex (worker):** workspace-write is enough; it permits reading the sibling `../mcp-hub` checkout and running `codex exec --help`. No network. Commit the document yourself, authored with `git commit --author="$(agent-whoami)"`.
- **Claude (verifier):** runs unsandboxed; reads `../mcp-hub` directly and makes no network calls.
