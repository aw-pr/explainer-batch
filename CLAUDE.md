# CLAUDE.md

Guidance for Claude Code working in this repo. **Start with `README.md`**
(user-facing usage/config) and **`AGENTS.md`** (canonical provider rules +
agent contract). This file holds only Claude-Code-specific notes that do not
belong in either.

## Publishing

Private work → public mirror. Work on `wip/*` topic branches, squash-merge
into the **`publish`** branch, run `git publish`. Every `publish` commit goes
public; never rewrite commits already on the public remote. Full model +
one-time setup: `docs/PUBLISH-WORKFLOW.md`. Machine-specific context (remotes,
config, paths) is in the gitignored `LOCAL.md`. The `repo-publish-workflow`
skill carries the portable version of this for any repo.

## Don't duplicate

Provider rules, commands, configuration, and the website integration are
documented once: usage in `README.md`, the provider/agent contract in
`AGENTS.md`. Update those, not a copy here. (Earlier revisions duplicated this
content across three files and it drifted — keep it single-source.)

## Claude-specific notes

- **`skill.md`** is the explainer specification and JSON schema. Its body after
  the YAML frontmatter is the system prompt sent to the model verbatim — edits
  change model behaviour directly; treat it as production code.
- **Schema contract** — `src/types/explainer-json.ts` is the canonical
  `ExplainerJson` type and must stay in sync with the consuming website repo's
  equivalent. Any change lands in both.
- **`state.json`** — auto-managed (Files API IDs, batch IDs, per-request
  results), gitignored, never hand-edited.
- **Model defaults** — `src/model-config.ts`. Claude: batch/lane/synthesis
  `claude-opus-4-8`, repair `claude-sonnet-4-6`.
- **Output post-processing** — every save path funnels through `saveResult`
  (`src/output.ts`): `normalizeSchemaDrift` then `attachFigureImage`. Opus
  consistently emits `paragraphs_html`/`heading` variants; the normaliser
  derives the canonical fields. Fix drift there, not in the prompt.

## Module map

```
src/
  index.ts          CLI entry; loads fill-only .env; dispatches commands
  env.ts            Fill-only .env/.env.local loader
  preprocess.ts     Scans input/, uploads PDFs, returns InputItem[]
  prompt.ts         Strips skill.md frontmatter; builds system prompt
  batch.ts          Submit/poll/collect for both providers; repair; cost
  output.ts         Extract JSON, normalise drift, figure extract; save/stage
  figure-extract.ts pdfimages (tier 1) → pdftoppm cropped page (tier 2)
  html-export.ts    Spawns website repo's exporter (skipped if unconfigured)
  state.ts          Reads/writes state.json
  providers.ts      Claude/OpenAI providers; auth detection; codex runner
  model-config.ts   Per-provider model defaults; env/file merge
  quality.ts        JSON schema validation + repair instructions
  types/explainer-json.ts  Canonical ExplainerJson (shared with website repo)
scripts/
  render-html.ts    Wrapper around the website repo's HTML exporter
  export-html.ts    Re-renders HTML for a directory of JSON
  run-batch-tmux.sh Secure headless route (op-fetch / .env fallback)
  install-guards.sh Arms local publish git hooks
  git-hooks/        Committed pre-commit / pre-push hook sources
```
