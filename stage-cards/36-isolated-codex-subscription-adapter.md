# Stage card 36-isolated-codex-subscription-adapter: Codex runs in a private, credential-isolated root over stdin, and every exit becomes a named result

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/36-isolated-codex-subscription-adapter
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Path claims:** src/providers/codex-subscription.ts, src/source-snapshot.ts, src/llm-contract.ts, tests/unit/codex-subscription.test.ts
- **Pairing rationale:** Design 17 W8 marks this "Judgement": process-group termination, auth-home isolation, stdin delivery, cleanup on every path and the failure-event precedence all have to be right at once. GPT-6.1 Sol at high effort (the Codex ceiling for this tranche) knows the Codex CLI it is wrapping; Claude Opus 5.5 verifies from the other family at high effort. Stage 35 has a Claude worker, so worker families alternate.
- **Open decisions:** none

## Surfacing concern

Design 17's `### Codex invocation and source delivery` (`docs/design/provider-routes.md:790-857`) fixes the Codex subscription route: a private `mkdtemp` root with `work`, `auth` and `artifacts`; an isolated auth home holding only the ChatGPT login; a narrow environment allowlist; `spawn`, not a shell, with the argument shape at `:823-826` and the prompt written to stdin; the result rule at `:227`; the process group killed on timeout; cleanup in `finally`; and source text prepared before the request by a new shared `src/source-snapshot.ts`, failing preflight with `SOURCE_TEXT_UNAVAILABLE` or `SOURCE_TOO_LARGE` rather than clipping (`:844-857`). Today's `runViaCodexCli` (`src/providers.ts:668-728`) passes the prompt as an argument, uses the operator's own `~/.codex` home and inherited environment, kills only the parent, and `flattenInputForCodex` (`:653-666`) sends "base64 PDF omitted" in place of the paper. The installed `codex-cli` 0.163.0 confirms every flag in the design's argument shape (`codex exec --help`, read offline). Checked against `dev` at `8bb4372`.

Design decisions this card settles (none needed the operator):

1. **`src/source-snapshot.ts` reuses `src/page-text.ts`** (stage 31) for per-page `pdftotext -layout` extraction and `pageCount` from `src/figure-locator/geometry.ts` (stage 27) for the page count, so no `pdftotext` handling is duplicated; the design's "no PDF-to-text helper was found" (`:846-847`) predates both. Pages are labelled `[Page N]`.
2. **The two source codes join `ERROR_CODES`.** The design names `SOURCE_TEXT_UNAVAILABLE` and `SOURCE_TOO_LARGE` but card 22 did not list them; this card appends both to `ERROR_CODES` in `src/llm-contract.ts` and changes nothing else there (frozen test 22 checks "at least" its list, so it stays green).
3. **Factory and injected seams.** `createCodexSubscriptionProvider(opts)` takes the `CredentialBinding`, `schemaFor(ref)` (the caller passes `contract/generated/model-output.openai.json`), `systemPrompt(stage)`, `sourceRoot`, `parentEnv`, `authFile` (the path of the operator's Codex `auth.json`, read but never written; resolving it is the caller's job, so the adapter never derives `~/.codex`), and optional `codexBin` (default `codex`), `tmpRoot` (default `os.tmpdir()`) and `killGraceMs` (default 5000).
4. **Failure precedence** (design `:227`): deadline `TIMEOUT`, then caller abort `CANCELLED`, then a failure event `CLI_FAILURE`, then a spawn error, non-zero exit or signal `CLI_EXIT`, then no `turn.completed` event or a missing or blank last-message file `MISSING_OUTPUT`; only then `stop`. A failure event is a `type: 'error'` event or any `turn.*` event other than `turn.started` and `turn.completed`, which is how an unknown terminal event fails closed. Non-JSON stdout lines are ignored. The design's "recognised explicit token-limit event" has no evidence in the installed CLI's event vocabulary, so no event maps to `length` yet; W9's probe is where one would be recognised.
5. **Schema compatibility stays unverified.** This card proves arguments, environment, isolation and result mapping with a fake CLI only. Whether the real CLI and model accept the generated dialect is W9's single authorised probe, not in this tranche; the capability says `schemaEvidence: 'unverified'`.
6. **Crash recovery here means the CLI crashing:** a CLI killed mid-run yields `CLI_EXIT` and the private root is still removed. The diagnostic spool (`:830`) is deferred with the receipt checkpoint and spool location in state (`:838-842`) to W12, which owns the state transaction: a spool written inside a root that this card removes in `finally` would serve no recovery. Here stdout is parsed in memory, retaining at most 8 MiB.
8. **Local filesystem failures** (creating the root, writing the schema or auth file, reading the last-message file) throw after the root is removed; they are not CLI results.
7. **Login validity.** The auth file must parse as an object with `auth_mode: 'chatgpt'`, a non-empty `tokens.access_token`, and an `OPENAI_API_KEY` that is absent, null or empty; otherwise `complete` throws `CODEX_AUTH_NOT_SUBSCRIPTION` before creating anything or starting the CLI. The isolated copy holds `{ OPENAI_API_KEY: null, auth_mode, last_refresh (when present), tokens }` and nothing else, mode `0600`.

Cold read: see `## Cold read` at the end of this card.

## Objective

`src/source-snapshot.ts` exports `buildSourceSnapshot`, which turns a PDF or a text source into a `SourceSnapshot` with page-labelled extracted text or fails with a named code; `src/providers/codex-subscription.ts` exports `createCodexSubscriptionProvider`, an `LlmProvider` for `id: 'openai'` on `subscription-cli` whose `complete` runs `codex exec` in a private root with an isolated ChatGPT login, an allowlisted environment, the dialect as `--output-schema`, the full prompt on stdin and labelled images, kills the whole process group on timeout, removes the root on every path, and returns a `NormalizedResult`.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`:220-234` mapping, `### Codex invocation and source delivery` `:790-857`, W8 `:1116-1121`)
- `src/llm-contract.ts`, `src/routes.ts` (`childEnvironment`), `src/page-text.ts`, `src/figure-locator/geometry.ts:26-31` (`pageCount`)
- `src/providers.ts:638-728` (today's Codex runner)
- `tests/contract/36-isolated-codex-subscription-adapter.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. **`src/llm-contract.ts`:** append `'SOURCE_TEXT_UNAVAILABLE'` and `'SOURCE_TOO_LARGE'` to `ERROR_CODES`. No other change.
2. **New `src/source-snapshot.ts`**, exporting `SourceInput` and `buildSourceSnapshot(input: { root, pdf?, text?, images? }, opts: { maxChars }): SourceSnapshot`:
   - With `pdf` (a path relative to `root`): `pageCount` null throws `SOURCE_TEXT_UNAVAILABLE`; for each page 1 to N, `pageText(file, p)` null throws `SOURCE_TEXT_UNAVAILABLE`; the page's text is its `lines` joined with `\n` with trailing whitespace trimmed, prefixed `[Page N]\n`; pages are joined with `\n\n`. Text with nothing but page labels and whitespace throws `SOURCE_TEXT_UNAVAILABLE`. `pdf` is `{ relativePath, sha256 }` of the file bytes.
   - Without `pdf`: `text` is used verbatim; blank or absent throws `SOURCE_TEXT_UNAVAILABLE`; `pdf` is omitted.
   - Text longer than `maxChars` throws `SOURCE_TOO_LARGE`; text is never clipped.
   - `images` keep their order, each `{ relativePath, label, sha256 }` of its bytes; absent means `[]`.
   - `digest` is a 64-character hex SHA-256 over the text, the PDF hash and the image labels and hashes, deterministic for the same input.
   - It imports `./page-text` and never runs `pdftotext` itself.
3. **New `src/providers/codex-subscription.ts`**, exporting `CodexSubscriptionOptions` and `createCodexSubscriptionProvider(opts)`:
   - **Binding check, at construction:** anything but `{ provider: 'openai', surface: 'codex-cli', credentialKind: 'codex-chatgpt-login' }` throws `CODEX_AUTH_NOT_SUBSCRIPTION`. The binding's `credential()` is never called.
   - **Identity and capabilities:** `id: 'openai'`, `routes: ['subscription-cli']`, passing `assertProviderCapabilities`, with `structured: 'strict'`, `schemaEvidence: 'unverified'`, `vision: true`, `pdfNative: false`, `batch: false`, `subscription: true`, `outputTokenLimit: 'advisory'`.
   - **`buildRequest(stage, item, plan)`:** `plan.tiers[stage]` must be an `openai` `subscription-cli` binding, else `ROUTE_UNSUPPORTED`; blank `item.source.text` throws `SOURCE_TEXT_UNAVAILABLE` (never a file reference or base64). The prompt is `systemPrompt(stage)`, a blank line, `item.instruction`, a blank line, then, when there are images, `Attached images, in order:` with one `Image <n>: <label>` line each and a blank line, then `Source text:` and the source text. `payload` is `{ prompt, schema: schemaFor(item.schema), images: [{ path, label }], sourceDelivery: 'extracted-text' }` with each image path resolved against `sourceRoot`. `wireBytes` is `Buffer.byteLength(prompt)`.
   - **`complete(req, ctx)`:** `ROUTE_UNSUPPORTED` unless an OpenAI `subscription-cli` request. Validate the login (decision 7) before creating anything. Then create the root with `mkdtemp` directly under `tmpRoot`, and `work`, `auth` and `artifacts` inside it (mode `0700`); write `auth/auth.json` (decision 7), the schema to a file under `artifacts`, and choose a distinct last-message path under `artifacts`. Spawn `codexBin` with no shell, `cwd` the `work` directory, `detached: true` (its own process group), stdio pipes, `env` as `childEnvironment(binding, parentEnv)` with `CODEX_HOME` set to the `auth` directory, and arguments exactly `exec --model <model> --json --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules -C <work> --output-schema <schema file> --output-last-message <last-message file>`, then `--image <path>` per image in order, then `-`. Write the prompt to stdin and close it. A timer at `ctx.deadline`, or `ctx.signal` aborting, sends SIGTERM to the process group, then SIGKILL after `killGraceMs`. Parse stdout as JSONL: `thread.started` gives `providerRequestId` (`thread_id`); each `turn.completed` adds `usage.input_tokens`, `output_tokens` and `cached_input_tokens` into `in`, `out` and `cacheRead` (`source: 'reported'`; both cache-write fields null; unavailable when no `turn.completed` carried usage). Map by decision 4; on `stop`, the text is the last-message file's contents. Every result goes through `checkResult`. Remove the root in a `finally`, after reading the output, on every path including spawn failure, crash and timeout.
   - **`submitBatch`, `getBatch` and `results`** throw `ROUTE_UNSUPPORTED`.
   - **Never** a shell, `exec` or `execSync`; never `os.homedir()` or a `~/.codex` path; no `process.env` reads; no `pdftotext`.
4. **New `tests/unit/codex-subscription.test.ts`**, run by `npm test`: a fake CLI covering success over stdin, a `turn.failed` event, a missing last-message file and an API-key login, plus one `buildSourceSnapshot` case with a fake `pdftotext` and `pdfinfo` on `PATH`.

## Constraints

- No change to `src/providers.ts`, `src/page-text.ts`, `src/figure-locator/`, `src/routes.ts` or any caller; `runViaCodexCli` keeps serving the legacy path until W14 switches entrypoints, and W15 deletes it.
- The frozen test reads the module's raw source for its import and environment checks, so do not name `process.env`, `os.homedir()`, a quoted `pdftotext`, `exec(` or `execSync` even in comments.
- Never read or modify the operator's real Codex home or auth file in tests; never invoke a real `codex` or any model.
- No network and no paid or subscription calls.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state, a cloned `node_modules` and files under the OS temp directory.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: Claude Opus 5.5 verifier through the Claude CLI, no network needed. The worker runs criteria 1 to 4 in its Codex workspace-write sandbox, which is enough: the test spawns only fake `node` scripts it writes under the OS temp directory, and tests 35 and 36 passed together under `codex sandbox` with workspace-write.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/36-isolated-codex-subscription-adapter.test.ts` exits 0 with 9 passing. It covers the two new error codes, page-labelled extraction through `src/page-text.ts`, the five preflight failures, the binding and login checks (API-key, malformed and missing auth, none starting the CLI), capabilities and refused requests, the exact argument list, cwd, private root layout, environment allowlist, isolated auth home and file mode, the operator auth file left untouched, a prompt over a megabyte on stdin, the success mapping and usage, eight failure shapes plus a spawn failure each removing the root, process-group kill on timeout, and the source surface. Baseline on `dev`: red, 9 of 9 fail (first: `ERROR_CODES lacks SOURCE_TEXT_UNAVAILABLE`).
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/07-truncated-and-errored-responses-are-caught.test.ts tests/contract/22-normalised-provider-contract.test.ts tests/contract/31-page-text-extraction-and-pdf-url-cache.test.ts` exits 0. Baseline on `dev`: green.
3. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
4. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/codex-subscription.test.ts`. Baseline on `dev`: green (125 tests).
5. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/36-isolated-codex-subscription-adapter.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
6. **Untested rules (verifier, reading):** `src/llm-contract.ts` differs from `dev` only by the two appended codes; a caller abort maps to `CANCELLED`; the prompt layout matches Deliverable 3; `buildSourceSnapshot` really calls `pageText` and `pageCount`; stdout retention is bounded. Baseline: not applicable before the run.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/36-isolated-codex-subscription-adapter.test.ts`
- **Assertions digest:** `sha256:72795ad6aadb4c049d37e97212926b3a824e8bef9db70d24bac23d8922f10e9b`
- **Oracle proof:** On `dev` (`8bb4372`) all 9 tests fail (the error codes are missing and neither module exists). A throwaway reference in a detached scratch worktree (the two appended codes, a 45-line `src/source-snapshot.ts` and a 150-line adapter following Deliverables 1 to 3) passed all 9, `npx tsc --noEmit` was clean, `npm test` passed 125 of 125, and contract tests 07, 22 and 31 stayed green. Mutations the test caught: killing only the child instead of its process group (the grandchild survived), and ignoring failure events. The worktree was removed and pruned. The test writes fake `codex`, `pdfinfo` and `pdftotext` scripts (shebang `process.execPath`) under the OS temp directory, prepends their directory to `PATH`, and uses a fixture ChatGPT login with fake token strings. Trap the reference hit: on macOS the temp directory is reached through `/var`, which the child's `process.cwd()` reports as `/private/var`; the test realpaths its root once, so build every path from `tmpRoot` and do not realpath again.

## Out of scope

- W9's live probe of the generated dialect, and any `length` mapping for a token-limit event.
- Recording the spool location or receipt in state (W12); calling `buildSourceSnapshot` from the preparation boundary (W12).
- Removing `runViaCodexCli` or `flattenInputForCodex` (W15).

## Budget

- **Worker wall-clock:** 75 minutes
- **Verifier wall-clock:** 30 minutes
- **Spend basis:** tranche 1 in this repo: GPT-6.1 Sol workers on cards 22, 24 and 31 used 0.9M to 1.4M tokens at high effort; Opus 5.5 verifiers about 0.5M. Expect about 1.5M worker tokens: two modules of about 200 lines between them plus a unit test with a fake CLI.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The exported names of `src/source-snapshot.ts` and `src/providers/codex-subscription.ts`, and the `git diff dev -- src/llm-contract.ts` output.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`. Never run the real `codex` binary from inside the task.
- **Claude (verifier):** runs unsandboxed; still make no network calls and start no real CLI session.
- **Both roles:** do not create `.env.local` in the run worktree. Contract tests 26 to 28 fail in a run worktree because `input/_held/` is gitignored; that is unchanged from base and not a criterion here.

## Cold read

A read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It raised: whether W8 owns the bounded spool (now decision 6: deferred to W12, with the reason, and in-memory retention bounded); local filesystem failures (now decision 8: thrown after cleanup); a W14 and W15 wording clash (fixed); the source check rejecting a legitimate `RegExp.exec` (the test now bans only a bare `exec(`, `execSync` and `execFile`); a timing-fragile timeout (deadline raised to 4 s); the operator auth file compared as parsed JSON (now byte-for-byte); and weak string checks for `./page-text` and for the CLI never starting (the first is now also a reading item in criterion 6; for the second, the empty temp root shows nothing was created, since login validation runs before `mkdtemp`). Test re-proven red 9 of 9 and green 9 of 9, new digest. It found no criterion the verifier seat cannot evidence.
