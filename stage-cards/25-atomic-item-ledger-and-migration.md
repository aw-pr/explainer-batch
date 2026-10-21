# Stage card 25-atomic-item-ledger-and-migration: a version-2 state survives crashes and concurrent writers, and v1 history migrates without inventing routes

## Metadata

- **Authored:** 2026-10-21
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Verifier:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Base branch:** dev
- **Run branch:** autometta/25-atomic-item-ledger-and-migration
- **Worker effort:** high
- **Verifier effort:** high
- **Verifier panel:** false
- **Gate:** stage-completed: 22-normalised-provider-contract
- **Path claims:** src/state.ts, src/state-v2.ts, src/state-migration.ts, scripts/migrate-state-v2.ts, tests/unit/state-v2.test.ts
- **Pairing rationale:** Judgement work where mistakes lose paid results: lock ownership and reclaim, atomic writes and the migration's quarantine rules. Claude Opus 5.5 at high effort writes it; the frontier tier is not needed because the lock format, the conversion table and the refusal rules are written below and pinned by the oracle. The verifier is GPT-6.1 Sol from the other family at high effort, which can re-run the multi-process tests in its sandbox. It follows card 24's GPT-6.1 Sol worker, so worker families alternate; it claims no file card 23 or 24 claims.
- **Open decisions:** none

## Surfacing concern

Design 17 (`docs/design/provider-routes.md`, `## State and resume` `:483-614`) replaces the single read-modify-write `state.json` with a version-2 ledger. Today's state, checked on `dev` (`77909f6`):

- `src/state.ts:108-125` continues with an EMPTY state when `state.json` fails to parse, after copying it aside, so the next `writeState` replaces every batch and Files API id with nothing; the design requires `STATE_CORRUPT` and no writes (`:590-593`).
- `src/state.ts:127-133` renames a temp file into place but takes no lock, and `mergeBatch` (`:138-147`) re-reads then writes, so two processes can still lose each other's updates (`:508-513`).
- Batch records carry no route: `src/batch.ts:1204` names local runs `sync_<provider>_<ms>` and `src/batch.ts:503` `codexbatch_<ms>`; OpenAI sync runs could have used either the API or ChatGPT auth, which the design forbids inferring (`:600-607`).
- `openai_file_cache` (`src/state.ts:96-101`) has no provider or account namespace (`:579-588`).

Design decisions this card settles (none needed the operator):

1. **Lock format.** A lock is a directory created with `mkdir` (`<state>.lock` for the state, `<state>.batch-<batchId>.lock` for a batch, with unsafe characters in the id replaced) holding `owner.json` with `nonce`, `hostname`, `pid` and `startedAt`. It is reclaimed only when its hostname is this host and its pid is not alive; a foreign or live owner yields `STATE_BUSY` once the finite `lockWaitMs` wait (default a few seconds) expires, and the lock is never removed because of its age (`:515-523`). There is no re-entrancy: a second acquire of the same lock in the same process is `STATE_BUSY`.
2. **Transactions are synchronous.** `transactState(file, fn, opts)` takes the state lock, re-reads and validates, runs `fn` on the fresh state, increments `revision` by one, writes a uniquely named sibling temp file, fsyncs it, renames it over the state, fsyncs the directory and releases the lock. If `fn` throws, nothing is written. Network calls never happen inside `fn`; the batch lock is the one held across long calls.
3. **The legacy reader refuses v2.** `src/state.ts` keeps every export and still reads a v1 file exactly as now, including its existing corrupt-file behaviour; it throws `STATE_VERSION_UNSUPPORTED` when the file carries a `version` field, so a pre-migration build can never read a migrated file as empty and overwrite it. Changing the legacy corrupt-file path is left to design 17 W14, which switches entrypoints.
4. **Migration dispositions** (`:600-607`): `msgbatch_` with provider Claude or none becomes a remote Claude `batch-api` batch (a `msgbatch_` id with another provider is conflicting evidence and is archived); any other OpenAI remote batch becomes a remote OpenAI `batch-api` batch; `sync_claude_` becomes a local Claude `subscription-cli` batch with `legacy_inference` recorded, completed results kept, and pending items `outcome_unknown`; `codexbatch_` becomes a local OpenAI `subscription-cli` batch; `sync_openai_` is archived with `route: null` and `migration_status: 'needs_route_evidence'`; a lane-bearing record (`lane_model` set or any `type: 'lane'` request) is archived. A Claude remote batch whose id lacks the `msgbatch_` prefix but whose provider is Claude is a remote Claude batch; a local prefix whose provider field contradicts it (`sync_claude_` with provider OpenAI, `codexbatch_` with provider Claude) is archived as conflicting evidence. A pending `codexbatch_` item becomes `outcome_unknown` with `needs_source_recovery: true`, since migration cannot recover its source and a later card requeues it. Lane detection uses either signal alone. Archived records keep their full v1 content. Legacy file-cache entries move into the OpenAI namespace only with a confirmed account scope, otherwise they stay as unverified legacy entries. Per-batch v1 usage is kept under `legacy_usage`, never relabelled as zero.

Cold read: a read-only Codex session (GPT-6.1 Sol, other family) read this card and its test on 2026-10-21. It asked for the persisted request and plan shapes (Deliverable 1), for the unhandled migration cases (decision 4 now covers prefix-less Claude ids, contradictory local prefixes and pending `codexbatch_` items), whether contract 01's sentinel files breach scope (criterion 4: expected), and noted that the oracle exercises an exit before writing, not a crash mid-rename, and only the combined lane signals (criterion 5 now covers both by reading). All are answered on the card.

## Objective

`src/state-v2.ts` reads, validates and transactionally writes a version-2 state under same-host-reclaimable directory locks, records receipts exactly once, offers a batch execution lock and a namespaced file cache. `src/state-migration.ts` converts a v1 state purely, and `scripts/migrate-state-v2.ts` previews it read-only or applies it under the state lock with a byte-for-byte backup. The legacy `src/state.ts` refuses to read a v2 file.

## Inputs (read these in your own context)

- `docs/design/provider-routes.md` (`## State and resume`, all three subsections)
- `src/state.ts`, and `src/batch.ts:495-515` and `:1195-1210` (where local batch ids are made)
- The contract module card 22 creates, src/llm-contract.ts (it does not exist on `dev` until card 22 lands; read `LlmContractError`, `ProviderId`, `Route`, `Stage`)
- `tests/contract/25-atomic-item-ledger-and-migration.test.ts` (frozen)

Do not read anything else unless you need to; keep your context lean.

## Deliverables

All files listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to repo root.

1. **New `src/state-v2.ts`**, exporting:
   - `StateV2` with `version: 2`, `revision`, `batches` (keyed by batch id; each with `id`, `provider`, `route`, `kind: 'remote' | 'local'`, `status`, optional `remoteId` and `legacy_inference`, and `requests`), `plans`, `receipts`, `file_cache`, and optional `legacy` (`{ batches, file_cache? }`) and `legacy_usage`. The executable batch type always has a real `Route`; a nullable route exists only inside `legacy`. Item states are the design's eight (`:500-504`). Each request is the v1 request record plus a `state`; `plans` maps a run id to its frozen `RunPlan`. Attempt, intent and finalisation-receipt shapes are added by design 17 W12, which writes them; this card fixes only what it reads and writes.
   - `emptyStateV2()`.
   - `loadStateV2(file)`: an absent file is an empty state (the file is not created); invalid JSON or an invalid shape is `STATE_CORRUPT`; a missing `version` (v1) or any version other than 2 is `STATE_VERSION_UNSUPPORTED`, the v1 message naming `scripts/migrate-state-v2.ts`. The file is never modified.
   - `transactState(file, fn, opts?: { lockWaitMs?: number }): StateV2` per decision 2, refusing corrupt or unsupported state before `fn` runs.
   - `recordReceipt(state, { runId, batchId, itemId, customId, attemptId, stage, digest }): 'recorded' | 'duplicate'`, keyed on `(runId, customId, attemptId)`; a different digest under the same key is `RESULT_CONFLICT`. `listReceipts(state)` returns them.
   - `withBatchLock(file, batchId, fn, opts?)`: async; holds the batch lock across `fn` and releases it however `fn` ends.
   - `fileCachePut(state, provider, accountScope, purpose, sha256, entry)` and `fileCacheGet(...)` on `file_cache[provider][accountScope][purpose][sha256]`, entries `{ fileId, sizeBytes, uploadedAt, verifiedAt?, expiresAt? }`.
2. **New `src/state-migration.ts`:** `migrateStateV1(v1, opts?: { openaiAccountScope?: string }): { state: StateV2; report: { batches: Array<{ id, disposition, ... }> } }`, pure (its input is not mutated), per decision 4, with one report row per v1 batch.
3. **New `scripts/migrate-state-v2.ts`:** `--state <file>` (default the repo `state.json`) prints the report and writes nothing; `--apply` takes the state lock (a held lock fails non-zero), writes a uniquely named backup holding the original bytes, validates the converted state, replaces the file atomically and releases the lock. A corrupt or already-v2 file exits non-zero untouched.
4. **`src/state.ts`:** decision 3; no other change.
5. **New `tests/unit/state-v2.test.ts`:** crash and restart, concurrent processes, corrupt-state refusal and ambiguous legacy route quarantine, all on temporary files; runnable by `npm test`.

## Constraints

- Tests and the worker never read, copy or write the operator's live `state.json`; every test uses a temporary directory.
- No caller changes: `src/batch.ts`, `src/output.ts` and the CLI keep using the legacy `src/state.ts` until design 17 W12 and W14.
- Shared network-filesystem locking is unsupported; do not add it (`:521-523`).
- Do not rewrite historical output files or delete paid history; archived records keep every field.
- No network and no paid API calls while working.
- No em dashes in prose you add; British English.
- Do not create or modify files outside the deliverables, except this card's run state.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: GPT-6.1 Sol verifier under Codex workspace-write, which suffices (no network; the tests write only under the OS temp dir and spawn child `node` processes).

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/25-atomic-item-ledger-and-migration.test.ts` exits 0. It covers an empty v2 state and first write with no leftovers; refusal of corrupt, malformed, v1 and future state with bytes untouched; exactly-once receipts and a rolled-back failing transaction; four concurrent processes writing 80 receipts with none lost or doubled and the revision exact; a process that exits while holding the lock, before writing (reclaimed, its write never landing, owner fields recorded); `STATE_BUSY` for foreign and live owners with no eviction; batch locks; file-cache namespaces; every migration disposition; the preview, apply, backup, busy and corrupt behaviour of the script; and the legacy reader. Baseline on `dev`: red, 11 of 11 fail (first: `src/state-v2.ts must exist`; the legacy-reader test fails because `readState` returns a v2 file's content instead of refusing it).
2. **Types (verifier):** `npx tsc --noEmit` exits 0. Baseline on `dev`: green.
3. **Unit suite (verifier):** `npm test` exits 0 and runs `tests/unit/state-v2.test.ts`. Baseline on `dev`: green.
4. **Earlier contracts still hold (verifier):** `for f in tests/contract/0*.test.ts tests/contract/1[0-5]-*.test.ts tests/contract/22-*.test.ts; do TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test "$f" || exit 1; done` exits 0 (several wave-1 tests drive `src/state.ts` through `EXPLAINER_STATE_FILE`). Contract test 01 creates and removes its own sentinel files under `tests/`; that is expected and not a scope breach. Baseline: green once card 22 has landed.
5. **Rules beyond the oracle (verifier, reading):** a crash after the temp file is written but before the rename leaves the old state readable and the uniquely named temp file ignored; `lane_model` alone and a lane request alone each archive a batch; the script refuses an already-v2 file untouched; the conflicting-prefix and pending-`codexbatch_` rules of decision 4 hold. Baseline: not applicable before the run.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/25-atomic-item-ledger-and-migration.test.ts` prints the digest recorded below. Baseline: green once the test is committed.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. Baseline: not applicable before the run.

## Contract test

- **Test file:** `tests/contract/25-atomic-item-ledger-and-migration.test.ts`
- **Assertions digest:** `sha256:8bf33e97ca4b365170419ae7dea4cac8463e44779cf2257a64dd2bcb240d7556`
- **Oracle proof:** On `dev` (`77909f6`) all 11 tests fail: the new modules and script do not exist, and the legacy `readState` returns a v2 file's content rather than refusing it. A throwaway reference in a detached scratch worktree, stacked on card 22's reference (a 140-line `src/state-v2.ts` with `mkdir` locks and `Atomics.wait` back-off, a 60-line migration, a 30-line script and a six-line `src/state.ts` change), passed all 11 in about 3 seconds; `npx tsc --noEmit` was clean and every earlier contract test still passed. The worktree was removed and pruned. Traps the reference met: a synchronous lock wait needs a real sleep (`Atomics.wait` on a `SharedArrayBuffer`), not a busy loop, or four child processes starve each other; and `process.kill(pid, 0)` throws `EPERM` for a live process owned by another user, which must count as alive.

## Out of scope

- Writing plans, intents or finalisation receipts from the pipeline, `process --resume`, `--retry-errored` and the CLI cut-over (design 17 W12 and W14).
- Changing the legacy corrupt-file behaviour (W14).
- OpenAI file-cache validation against the API and Gemini expiry handling (adapter cards).

## Budget

- **Worker wall-clock:** 90 minutes
- **Verifier wall-clock:** 40 minutes
- **Spend basis:** this repo's cost log: Opus 5.5 worker median about 0.92M tokens; GPT-6.1 Sol verifier median about 1.2M. Expect about 2M worker tokens: three new files of about 250 lines in total plus a multi-process unit test.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The lock directory names and `owner.json` fields as implemented.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to the frozen contract block fails the stage. The worker runs criteria 1 to 4 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Claude (worker):** runs unsandboxed; still make no network calls and never touch the repo's own `state.json`. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink).
- **Codex (verifier):** workspace-write with no network is enough; the tests spawn `node` children and write only under the OS temp dir. Run commands with stdin from `/dev/null`. On macOS `$TMPDIR` is under `/var`, which some tools report as `/private/var`; the test resolves its temp dir with `realpath`.
- **Both roles:** do not create `.env.local` in the run worktree.
