# Stage card 44-migrate-v1-reads-organisation-and-dated-references: migrateV1 reads organisation authors, dated years and a trailing "et al.", so every live byline is right

## Metadata

- **Authored:** 2026-10-22
- **Orchestrator:** Claude Opus 5.5 <claude-opus-5-5@local>
- **Worker:** GPT-6.1 Sol <gpt-6-1-sol@local>
- **Verifier:** Claude Sonnet 5.5 <claude-sonnet-5-5@local>
- **Base branch:** dev
- **Run branch:** autometta/44-migrate-v1-reads-organisation-and-dated-references
- **Worker effort:** medium
- **Verifier effort:** medium
- **Verifier panel:** false
- **Path claims:** contract/migrate-v1.ts, tests/unit/fixtures/v1/, docs/design/content-contract-v2.md
- **Pairing rationale:** One regular expression and one fallback inside a landed helper, plus three fixtures and two doc lines, pinned to the string by a frozen test built from the live references: GPT-6.1 Sol at medium fits, and the operator asked on 2026-10-22 to bias token spend towards OpenAI. The verifier is Claude Sonnet 5.5 at medium from the other family: verifying is running the commands and reading an 8-line diff, nothing judgement-heavy, so neither role needs Fable or Astra.
- **Open decisions:** none

## Surfacing concern

Found while carding design 16 W4 (promo-flow renders v2 natively), on 2026-10-22. W4 and W9 move the live eyebrow from the baked HTML to `eyebrow(references[0])`, so the operator reviewed what `derive.ts` would print for the 49 live explainers on `dev` at `7f0a9cb`. Thirty change. Twenty-six are the byline rule (`et al.` from three authors, `and` for two), which the operator accepted. Four are wrong because `reference()` in `contract/migrate-v1.ts` misreads the APA text:

| Live file | Eyebrow today | Derived on the base | Cause |
|---|---|---|---|
| `ai-adoption/2026-05-08_ccaf_global-ai-financial-services` | Cambridge CCAF (2026) | Ccaf | An organisation author has no `Surname, I.` pair, so the parse falls back to the slug and drops the year |
| `ai-safety/2026-04-05_expert_international-ai-safety-report` | International AI Safety Report authors (2026) | Expert | An organisation followed by a full stop, and a year written `(2026, February)` |
| `quantum-computing/2026-04-29_ibm_fault-tolerant-quantum-roadmap` | IBM Quantum (2025) | Ibm | The year is written `(2025, June 10)` |
| `ai-capabilities/2026-07-16_jumper_alphafold-protein-structure` | Jumper (2021) | J. (2021) | `Jumper, J., et al.` is read as family `J.` with given `et al.` |

A scan of all 151 explainer JSON files (the 49 live, the 11 staged in `promo-flow/explainers-new/`, `output/` and `output.local/`) found the same causes in 9 more files, and one more: a title ends at the first full stop even with no space after it, so `(SE) 3.0: How…` is cut to `(SE) 3` (`ai-adoption/2026-04-18_li_ai-teammates-se3`, live). The Chen references (`Chen, K., Patel, D., Nishball, D., et al.`) carry `{family: 'D.', given: 'et al.'}` as a third author today; the eyebrow happens to print correctly.

Operator decision, 2026-10-22: fix the reader here, in explainer-batch, before W9, rather than hand-correct the four references in W9's curation.

Settled by the orchestrator:

- **A trailing `et al.` is dropped, and the named authors are kept.** `Reference` has no field for an elided list, and inventing a placeholder author would put a name in the data that the paper does not carry. Jumper becomes `Jumper (2021)`, which is today's eyebrow; Chen keeps three named authors and `Chen et al. (2025)`.
- **An organisation is the whole author segment** when it contains no comma, with one trailing full stop removed. The CCAF eyebrow becomes `Cambridge Centre for Alternative Finance (2026)`, longer than today's hand-written `Cambridge CCAF`; the IBM eyebrow becomes `Mandelbaum et al. (2025)`, because `references[0]` is that blog post.
- **`CONTRACT_REVISION` stays 1.** The revision guards the artefact's shape. This card changes how v1 text is read, not what an `ExplainerV2` may hold, and `contract/explainer-v2.ts` and `contract/derive.ts` are unchanged (the frozen test pins both by hash).

The orchestrator's reference implementation changed 13 of the 151 files' `references[0]` and no other: the 4 above, Chen (3 copies), Li (2 copies), the 2 staged Anthropic files and the 2 `output.local/` copies of CCAF and IBM. The 138 others are identical, field for field.

## Objective

`migrateV1` parses an organisation author, a year written with a month or a date, and an author list ending in `et al.`, and a reference title runs to the first full stop followed by whitespace, so the byline derived for every live explainer names the right authors and year.

## Inputs (read these in your own context)

- `contract/migrate-v1.ts`: `reference()`, around lines 52 to 65
- `contract/derive.ts` (`byline`, `eyebrow`), read only
- `tests/unit/migrate-v1.test.ts` and `tests/unit/fixtures/v1/partial-reference.json` (the fixture shape: `{input, ok, expected?, dropped?, issues?}`; the unit test runs every `*.json` in the directory)
- `docs/design/content-contract-v2.md`: the `references[]` row of the table under `### The mapping (migrateV1())`, and `## Open questions` item 18
- `tests/contract/44-migrate-v1-reads-organisation-and-dated-references.test.ts` (frozen) and this card

Do not read anything else unless you need to; keep your context lean.

## Deliverables

Every file listed here must be created or modified, except the frozen contract test, which already exists and must not be edited. Paths are relative to the repo root.

1. `contract/migrate-v1.ts`, inside `reference()` only:
   - The year group accepts `(YYYY)` and `(YYYY, anything)`, such as `(2026, February)` or `(2025, June 10)`. The number stored is the four-digit year.
   - A trailing `et al.` (with or without the comma before it, and with or without its full stop) is removed from the author segment before the names are matched, so it is never read as a name.
   - When the remaining segment yields no `Surname, Initials` pair and contains no comma, it is one organisation author, `{family}` with no `given`, after one trailing full stop is removed.
   - The title runs to the first full stop that is followed by whitespace or ends the text, so `3.0` and `ed.)` stay inside it. The venue is the rest, as today, and is omitted when empty.
   - Everything else is unchanged: the URL from the anchor, the `partial APA parse` issue and slug fallback when there is still no author or no year, and `origin: 'legacy'`.
2. `tests/unit/fixtures/v1/reference-organisation.json`, `reference-dated-year.json` and `reference-et-al.json`, each `ok: true`, with `expected` paths for the author family, the year and (where it applies) the title. Add any further fixture you want.
3. `docs/design/content-contract-v2.md`:
   - In the `references[]` row under `### The mapping (migrateV1())`, add that an organisation author, a dated year and a trailing `et al.` parse, and that a title ends at a full stop followed by whitespace.
   - Add item 19 to `## Open questions`, recording the 2026-10-22 decision (fix the reader; `et al.` dropped, named authors kept; organisation as one family; revision stays 1).
   - Nothing else in the document changes.

## Constraints

- `migrateV1` stays pure (card 21's purity assertions still hold).
- `contract/explainer-v2.ts`, `contract/derive.ts` and `contract/generated/` do not change.
- Every frozen contract test passes unedited, cards 20, 21 and 43's above all.
- `WEBSITE_REPO= npm run contract:check` stays clean. Do not run `contract:build --website` or write anything outside this worktree: the orchestrator re-vendors into promo-flow when it queues W4.
- Nothing under `src/` or `scripts/` changes, and no file under `output/` is rewritten.
- No network and no paid API calls. British English and no em dashes in prose.
- Do not create or modify files outside the deliverables, except this card's run state. What the frozen tests do themselves when criterion 2 runs them is not a breach: cards 20, 39 and 42 write scratch files under the system temporary directory and clean up, and card 20 runs its own `contract:build` into a temporary sibling and restores `contract/generated/`. Run them as they are; do not reproduce those steps by hand.

## Acceptance criteria

The verifier will check each of these. Failure of any one is a failure of the stage. Every command runs from the run worktree root. Seat for every criterion: the Claude Sonnet 5.5 verifier through the Claude CLI, no network needed.

Baseline on `dev` at `7f0a9cb` with the frozen test present (recorded 2026-10-22, after the cold read): 1 red, 6 of 9 failing; the three passing tests are the regression guards (references that parsed before parse exactly as before; an authorless reference is still a partial parse; revision, hashes and drift gate), green on the base by design. 2 to 5 green.

1. **Contract (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/44-migrate-v1-reads-organisation-and-dated-references.test.ts` exits 0, 9 of 9.
2. **Frozen neighbours (verifier):** `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test $(ls tests/contract/*.test.ts | grep -v -e '/26-' -e '/27-' -e '/28-')` exits 0: every frozen contract, cards 20, 21 and 43 included. Contracts 26 to 28 are left out because they read the held PDFs under `input/_held/`, which a run worktree does not have; they are not a criterion, and this card touches nothing they test. Cards 39 and 42 also read held PDFs, but they find them through the sibling `../explainer-batch` checkout, which a run worktree under `~/repos` has.
3. **Types (verifier):** `npx tsc --noEmit` exits 0, and `npx tsc --noEmit --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck contract/*.ts scripts/contract-build.ts` exits 0.
4. **Unit suite (verifier):** `npm test` exits 0 and lists the three new fixtures; `partial-reference.json` still passes.
5. **Drift gate (verifier):** `WEBSITE_REPO= npm run contract:check` prints `contract: generated files up to date`.
6. **Frozen block intact (verifier):** `bash ../autometta/scripts/check-contract-test-gate.sh print tests/contract/44-migrate-v1-reads-organisation-and-dated-references.test.ts` prints the digest recorded below.
7. **Clean tree (verifier):** `git diff --check` passes, and `git status --porcelain --untracked-files=all` lists only deliverables and this card's run state, with nothing under `tests/contract`. A `node_modules` clone is gitignored and does not appear.

## Contract test

- **Test file:** `tests/contract/44-migrate-v1-reads-organisation-and-dated-references.test.ts`
- **Assertions digest:** `sha256:4802e16a719f22e6ba4dc9b2cbd879779a99cbecff2802edecbd4ca008ab2961`
- **Oracle proof:**
  - **Red on `dev` `7f0a9cb`:** 6 of 9 fail: the organisation author, the organisation with a dated year and the `ed.)` title, the dated person list and organisation, the trailing `et al.`, the `3.0` title, and the missing fixtures. The three regression guards pass by design.
  - **Green on a throwaway reference** (a detached scratch worktree, removed and pruned; nothing committed): 9 of 9; `npm test` 195 with the three fixtures; both `tsc` runs and `contract:check` green; the frozen neighbours green except the 5 tests of cards 39 and 42 that read held PDFs through the sibling checkout, which the scratch worktree's location did not have. The reference was 1 file, +5/-3.
  - **Corpus (orchestrator proof, not a criterion):** with the reference, `references[0]` changes in exactly the 13 files listed under Surfacing concern and in none of the other 138 explainer JSON files across the four corpora.

## Out of scope

- Re-vendoring into promo-flow and updating the vendored file hash pinned by promo-flow card 33's frozen test: the orchestrator does both in the commit that queues W4.
- Any change to `derive.ts`, such as shortening an organisation name or an `et al.` marker in `Reference`.
- The two `output/` files whose reference has no author at all (`2026-07-31_ai-coding_*`): they stay partial parses, for W9's curation.

## Budget

- **Worker wall-clock:** 35 minutes
- **Verifier wall-clock:** 25 minutes
- **Spend basis:** card 43, the same helper file with the same harness: 1.07M tokens for the stage. Expect less, since the reference was 8 changed lines.

## Dispatch envelope

Return:

- One result per acceptance criterion, with the command output that shows it.
- The `git diff` of `contract/migrate-v1.ts`.
- The complete changed-file list.
- `overall: PASS` or `overall: FAIL`.

Any edit to a frozen contract block fails the stage. The worker runs criteria 1 to 5 itself before returning, and surfaces a partial result and stops if it cannot finish within budget.

## Family-specific notes

- **Codex (worker):** workspace-write with no network is enough. If `node_modules` is missing in the run worktree, clone it from the main checkout (`cp -cR ../explainer-batch/node_modules node_modules`, an APFS clone, never a symlink). Run commands with stdin from `/dev/null`.
- **Claude (verifier):** runs unsandboxed; make no network calls and write nothing outside the worktree.
- **Both roles:** do not create `.env.local` in the run worktree.
- **Cold read:** a read-only Codex session (GPT-6.1 Sol, the other family from the verifier) read this card and its test on 2026-10-22. Folded in: the constraints now say that the frozen neighbours' own temporary files and card 20's self-contained build are not a breach; the test now pins `et al.` with no comma and with no full stop, a title whose full stop ends the text (no venue) or is followed by a newline; and the fixture check requires each new fixture to expect the first author's family and the year.
