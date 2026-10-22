# CLAUDE.md

Guidance for Claude Code working in this repo. **Start with `README.md`**
(user-facing usage/config) and **`AGENTS.md`** (canonical provider rules +
agent contract). This file holds only Claude-Code-specific notes that do not
belong in either.

## Publishing

Private work to public mirror. Work on `wip/*` topic branches with atomic,
per-agent-attributed commits, merge into the **`publish`** branch keeping
those commits (history mode `preserve`; fast-forward, or `--no-ff` for a named
merge commit), run `git publish`. Squash is a per-merge opt-out for genuinely
messy WIP only. Every `publish` commit goes public; never rewrite commits
already on the public remote. Full model +
one-time setup: `docs/PUBLISH-WORKFLOW.md`. Machine-specific context (remotes,
config, paths) is in the gitignored `LOCAL.md`. The `repo-publish-workflow`
skill carries the portable version of this for any repo.

## Don't duplicate

Provider rules, commands, configuration, and the website integration are
documented once: usage in `README.md`, the provider/agent contract in
`AGENTS.md`. Update those, not a copy here. (Earlier revisions duplicated this
content across three files and it drifted; keep it single-source.)

## Claude-specific notes

- **`skill.md`** is the explainer specification and JSON schema. Its body after
  the YAML frontmatter is the system prompt sent to the model verbatim, so
  edits change model behaviour directly; treat it as production code.
- **Schema contract**: the seam saves v2 articles defined in
  `contract/explainer-v2.ts`. Generated dialects in `contract/generated/` describe
  model output, while `src/wire-schema.ts` loads the provider-specific schema.
  Keep the consuming website's contract in sync with stored articles.
- **`state.json`**: auto-managed (Files API IDs, batch IDs, per-request
  results), gitignored, never hand-edited.
- **Model defaults**: `src/model-config.ts`. Claude: batch/lane/synthesis
  `claude-opus-4-8`, repair `claude-sonnet-5-5`.
- **Output post-processing**: every save path in `src/batch.ts` calls
  `finalizeResult` in `src/finalize.ts`. The seam canonicalises v2 wire output,
  validates it, bounds prose repair at two attempts and drops invalid or thin
  charts. It stamps provenance from the request and provider receipt, then
  persists the article through `persistArtefact` in `src/output.ts`.
  Canonicalisation fixes belong in the seam. Generated provider dialects live
  in `contract/generated/` and are loaded by `src/wire-schema.ts`.

## Module map

```
src/
  index.ts          CLI entry; loads fill-only .env; dispatches commands
  env.ts            Fill-only .env/.env.local loader
  preprocess.ts     Scans input/, uploads PDFs, returns InputItem[]
  prompt.ts         Strips skill.md frontmatter; builds system prompt
  batch.ts          Submit/poll/collect for both providers; repair; cost
  output.ts         Extract JSON, drop thin charts, figure helpers; persist/stage/mirror
  finalize.ts       Canonicalise v2 wire output, repair, validate, stamp and persist
  wire-schema.ts    Load generated provider dialects from contract/generated/
  figure-vlm.ts     VLM figure pick: URL DOM-candidate choose / PDF two-pass zoom-refine, crop + verify
  vision.ts         Provider-agnostic single-shot vision call; subscription-first routing (OAuth / codex)
  html-export.ts    Spawns website repo's exporter (skipped if unconfigured)
  text.ts           Shared HTML-to-text helpers (htmlToPlain, stripHtml)
  state.ts          Reads/writes state.json
  providers.ts      Claude/OpenAI providers; auth detection; codex runner
  model-config.ts   Per-provider model defaults; env/file merge
  quality.ts        Structured chart checks + wire repair instructions
  repair.ts         Shared repair attempt bound
  types/explainer-json.ts  Legacy v1 types retained for figure and migration tools
scripts/
  render-html.ts    Wrapper around the website repo's HTML exporter
  export-html.ts    Re-renders HTML for a directory of JSON
  run-batch-tmux.sh Secure headless route (op-fetch / .env fallback)
  install-guards.sh Arms local publish git hooks
  git-hooks/        Committed pre-commit / pre-push hook sources
```
